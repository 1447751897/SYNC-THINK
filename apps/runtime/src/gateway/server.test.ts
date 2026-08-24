import { describe, it, expect, afterEach } from 'vitest';
import {
  GatewayPortInUseError,
  createExternalGatewayToken,
  matchGatewayRoute,
  startOpenGatewayServer,
  upstreamUrlFor,
  type OpenGatewayServer,
} from './server.js';
import { GatewayTicketRegistry, type GatewayRunUsage } from './tickets.js';

const openAiRoute = {
  baseUrl: 'https://relay.example.com/v1',
  protocol: 'openai-chat' as const,
  providerModelId: 'gpt-5.6-sol',
  apiKey: 'sk-upstream-secret',
  providerId: 'prov-a',
};

const anthropicRoute = {
  baseUrl: 'https://claude-relay.example.com/v1',
  protocol: 'anthropic-messages' as const,
  providerModelId: 'claude-sonnet-4',
  apiKey: 'sk-ant-upstream',
  providerId: 'prov-c',
};

const responsesRoute = {
  baseUrl: 'https://relay.example.com/v1',
  protocol: 'openai-responses' as const,
  providerModelId: 'gpt-5.6-luna',
  apiKey: 'sk-responses-secret',
  providerId: 'prov-r',
};

let active: OpenGatewayServer | undefined;
afterEach(async () => {
  await active?.close();
  active = undefined;
});

/** Build a fetch stub that records the upstream call and replays SSE bytes. */
function sseFetch(chunks: string[], init: { status?: number; body?: string } = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const impl = (async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (options?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(options?.body ?? '{}')),
    });
    if (init.status && init.status >= 400) {
      return new Response(init.body ?? 'upstream rejected', { status: init.status });
    }
    const encoder = new TextEncoder();
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(chunks[index++]));
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function startServer(
  overrides: Partial<Parameters<typeof startOpenGatewayServer>[0]> = {},
): Promise<{ server: OpenGatewayServer; externalToken: string }> {
  const externalToken = createExternalGatewayToken();
  const server = await startOpenGatewayServer({
    port: 0,
    externalToken,
    resolveTicket: () => undefined,
    ...overrides,
  });
  active = server;
  return { server, externalToken };
}

function urlFor(server: OpenGatewayServer, path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

/** Read a whole SSE response body as text. */
async function readAll(response: Response): Promise<string> {
  return await response.text();
}

function captureUsage(): {
  records: Array<{ runId: string; usage: GatewayRunUsage }>;
  recordRunUsage(runId: string, usage: GatewayRunUsage): void;
} {
  const records: Array<{ runId: string; usage: GatewayRunUsage }> = [];
  return {
    records,
    recordRunUsage: (runId, usage) => records.push({ runId, usage }),
  };
}

describe('matchGatewayRoute', () => {
  it('recognizes both dialects with or without the version segment', () => {
    expect(matchGatewayRoute('/anthropic/v1/messages')).toBe('anthropic-messages');
    expect(matchGatewayRoute('/anthropic/messages')).toBe('anthropic-messages');
    expect(matchGatewayRoute('/openai/v1/chat/completions')).toBe('openai-chat');
    expect(matchGatewayRoute('/openai/chat/completions')).toBe('openai-chat');
    expect(matchGatewayRoute('/healthz')).toBe('health');
    expect(matchGatewayRoute('/v1/models')).toBe('models');
    expect(matchGatewayRoute('/openai/v1/models')).toBe('models');
    expect(matchGatewayRoute('/anthropic/v1/messages/')).toBe('anthropic-messages');
    expect(matchGatewayRoute('/nope')).toBeUndefined();
  });
});

describe('upstreamUrlFor', () => {
  it('appends the endpoint only when it is missing', () => {
    expect(upstreamUrlFor('https://a/v1', 'openai-chat')).toBe('https://a/v1/chat/completions');
    expect(upstreamUrlFor('https://a/v1/chat/completions', 'openai-chat')).toBe(
      'https://a/v1/chat/completions',
    );
    expect(upstreamUrlFor('https://a/v1/', 'anthropic-messages')).toBe('https://a/v1/messages');
    expect(upstreamUrlFor('https://a/v1/messages', 'anthropic-messages')).toBe(
      'https://a/v1/messages',
    );
  });

  it('normalizes a host-only base URL with /v1 (CC Switch imports)', () => {
    // Bare origins must become /v1/... — appending the endpoint directly would
    // hit the upstream SPA fallback HTML instead of the API.
    expect(upstreamUrlFor('https://www.kamenking.top', 'openai-chat')).toBe(
      'https://www.kamenking.top/v1/chat/completions',
    );
    expect(upstreamUrlFor('https://relay.example.com', 'anthropic-messages')).toBe(
      'https://relay.example.com/v1/messages',
    );
  });

  it('leaves an explicit non-/v1 API prefix untouched', () => {
    expect(upstreamUrlFor('https://a/api/openai', 'openai-chat')).toBe(
      'https://a/api/openai/chat/completions',
    );
    expect(upstreamUrlFor('https://a/custom/anthropic', 'anthropic-messages')).toBe(
      'https://a/custom/anthropic/messages',
    );
  });

  it('targets the responses endpoint for the openai-responses dialect', () => {
    expect(upstreamUrlFor('https://a', 'openai-responses')).toBe(
      'https://a/v1/responses',
    );
    expect(upstreamUrlFor('https://a/v1', 'openai-responses')).toBe(
      'https://a/v1/responses',
    );
    expect(upstreamUrlFor('https://a/v1/responses', 'openai-responses')).toBe(
      'https://a/v1/responses',
    );
  });
});

describe('open gateway server', () => {
  it('serves healthz without a credential', async () => {
    const { server } = await startServer();
    const response = await fetch(urlFor(server, '/healthz'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('rejects unknown paths and non-POST methods', async () => {
    const { server } = await startServer();
    expect((await fetch(urlFor(server, '/nope'))).status).toBe(404);
    expect((await fetch(urlFor(server, '/anthropic/v1/messages'))).status).toBe(405);
  });

  it('serves the model list from GET /v1/models (no auth needed)', async () => {
    const { server } = await startServer({
      listModels: () => [
        { id: 'gpt-5.6-sol', providerId: 'prov-a', providerName: 'Relay A' },
        { id: 'claude-sonnet-4', providerId: 'prov-c', providerName: 'Relay C' },
      ],
    });
    const response = await fetch(urlFor(server, '/v1/models'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      object: 'list',
      data: [
        { id: 'gpt-5.6-sol', object: 'model', created: 0, owned_by: 'Relay A' },
        { id: 'claude-sonnet-4', object: 'model', created: 0, owned_by: 'Relay C' },
      ],
    });
    expect((await fetch(urlFor(server, '/v1/models'), { method: 'POST' })).status).toBe(405);
    expect((await fetch(urlFor(server, '/openai/v1/models'))).status).toBe(200);
  });

  it('rejects a missing or wrong credential with 401', async () => {
    const { server } = await startServer();
    const noKey = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      body: '{}',
    });
    expect(noKey.status).toBe(401);
    const wrongKey = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': 'stgw_not_a_real_ticket' },
      body: '{}',
    });
    expect(wrongKey.status).toBe(401);
  });

  it('translates an Anthropic request onto an OpenAI upstream and streams back', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-1', openAiRoute);
    const usage = captureUsage();
    const upstream = sseFetch([
      'data: {"choices":[{"index":0,"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"lo"}}]}\n\n',
      'data: {"id":"chatcmpl-upstream-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":2,"total_tokens":11,"prompt_tokens_details":{"cached_tokens":4,"cache_write_tokens":1},"completion_tokens_details":{"reasoning_tokens":2}}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      recordRunUsage: usage.recordRunUsage,
      fetchImpl: upstream.impl,
    });

    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id, 'content-type': 'application/json' },
      // The kernel sends whatever model string it was configured with...
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        max_tokens: 1024,
        system: 'be brief',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await readAll(response);
    expect(body).toContain('event: message_start');
    expect(body).toContain('"text_delta"');
    expect(body).toContain('event: message_stop');
    expect(body).toContain('"input_tokens":9');

    // ...and the gateway overwrites it with the ticket's provider model id.
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0].url).toBe('https://relay.example.com/v1/chat/completions');
    expect((upstream.calls[0].body as { model: string }).model).toBe('gpt-5.6-sol');
    expect((upstream.calls[0].body as { messages: unknown[] }).messages[0]).toEqual({
      role: 'system',
      content: 'be brief',
    });
    expect(upstream.calls[0].headers.Authorization).toBe('Bearer sk-upstream-secret');
    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({
      runId: 'run-1',
      usage: {
        providerResponseId: 'chatcmpl-upstream-1',
        providerId: 'prov-a',
        providerModelId: 'gpt-5.6-sol',
        tokensIn: 9,
        tokensOut: 2,
        cachedTokensHit: 4,
        cachedTokensCreated: 1,
        reasoningTokens: 2,
        totalTokens: 11,
      },
    });
  });

  it('captures DeepSeek-style prompt_cache_hit_tokens as cache hits', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-deepseek-cache', openAiRoute);
    const usage = captureUsage();
    const upstream = sseFetch([
      'data: {"id":"chatcmpl-ds-1","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
      'data: {"id":"chatcmpl-ds-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16,"prompt_cache_hit_tokens":8,"prompt_cache_miss_tokens":4}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      recordRunUsage: usage.recordRunUsage,
      fetchImpl: upstream.impl,
    });

    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        max_tokens: 1024,
        system: 'be brief',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    expect(response.status).toBe(200);
    expect(usage.records).toHaveLength(1);
    expect(usage.records[0]).toMatchObject({
      runId: 'run-deepseek-cache',
      usage: {
        providerModelId: 'gpt-5.6-sol',
        tokensIn: 12,
        tokensOut: 4,
        cachedTokensHit: 8,
        totalTokens: 16,
      },
    });
  });

  it('translates an OpenAI request onto an Anthropic upstream and streams back', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-2', anthropicRoute);
    const usage = captureUsage();
    const upstream = sseFetch([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":5,"output_tokens":0,"cache_read_input_tokens":2,"cache_creation_input_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":3,"cache_read_input_tokens":2,"cache_creation_input_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      recordRunUsage: usage.recordRunUsage,
      fetchImpl: upstream.impl,
    });

    const response = await fetch(urlFor(server, '/openai/v1/chat/completions'), {
      method: 'POST',
      headers: { authorization: `Bearer ${ticket.id}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const body = await readAll(response);
    expect(body).toContain('"chat.completion.chunk"');
    expect(body).toContain('"content":"Hi"');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('"prompt_tokens":7');
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);

    expect(upstream.calls[0].url).toBe('https://claude-relay.example.com/v1/messages');
    const sent = upstream.calls[0].body as { model: string; system: string; max_tokens: number };
    expect(sent.model).toBe('claude-sonnet-4');
    expect(sent.system).toBe('be brief');
    expect(sent.max_tokens).toBeGreaterThan(0);
    expect(upstream.calls[0].headers['x-api-key']).toBe('sk-ant-upstream');
    expect(upstream.calls[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(usage.records.at(-1)).toMatchObject({
      runId: 'run-2',
      usage: {
        providerResponseId: 'msg_1',
        providerId: 'prov-c',
        providerModelId: 'claude-sonnet-4',
        tokensIn: 8,
        tokensOut: 3,
        cachedTokensHit: 2,
        cachedTokensCreated: 1,
        totalTokens: 11,
      },
    });
  });

  it('passes a same-dialect request straight through with the model rewritten', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-3', anthropicRoute);
    const usage = captureUsage();
    const upstream = sseFetch([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_x","usage":{"input_tokens":6,"output_tokens":0}}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"input_tokens":6,"output_tokens":2},"delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      recordRunUsage: usage.recordRunUsage,
      fetchImpl: upstream.impl,
    });

    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id },
      body: JSON.stringify({
        model: 'whatever-the-kernel-said',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    const body = await readAll(response);
    // Bytes are forwarded verbatim — no translation layer in the way.
    expect(body).toContain('"msg_x"');
    expect((upstream.calls[0].body as { model: string }).model).toBe('claude-sonnet-4');
    expect(usage.records.at(-1)).toMatchObject({
      runId: 'run-3',
      usage: {
        providerResponseId: 'msg_x',
        tokensIn: 6,
        tokensOut: 2,
        totalTokens: 8,
      },
    });
  });

  it('resolves by model name only for the external token', async () => {
    const upstream = sseFetch([
      'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const { server, externalToken } = await startServer({
      resolveModelName: (model) =>
        model === 'gpt-5.6-sol' ? openAiRoute : undefined,
      fetchImpl: upstream.impl,
    });

    const ok = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': externalToken },
      body: JSON.stringify({ model: 'gpt-5.6-sol', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(ok.status).toBe(200);

    const unknown = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': externalToken },
      body: JSON.stringify({ model: 'not-in-catalog', messages: [] }),
    });
    expect(unknown.status).toBe(404);
    expect(JSON.stringify(await unknown.json())).toContain('not-in-catalog');
  });

  it('rejects a malformed JSON body with 400', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-4', openAiRoute);
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
    });
    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id },
      body: '{not json',
    });
    expect(response.status).toBe(400);
  });

  it('preserves the upstream status on failure and never echoes the secret', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-5', openAiRoute);
    const upstream = sseFetch([], { status: 401, body: 'invalid api key' });
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      fetchImpl: upstream.impl,
    });
    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id },
      body: JSON.stringify({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(response.status).toBe(401);
    const text = await response.text();
    expect(text).toContain('authentication_error');
    expect(text).not.toContain('sk-upstream-secret');
  });

  it('surfaces a busy port as GatewayPortInUseError', async () => {
    const { server } = await startServer();
    await expect(
      startOpenGatewayServer({
        port: server.port,
        externalToken: 'stgx_x',
        resolveTicket: () => undefined,
      }),
    ).rejects.toBeInstanceOf(GatewayPortInUseError);
  });

  it('stops accepting connections after close', async () => {
    const { server } = await startServer();
    const port = server.port;
    await server.close();
    active = undefined;
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toBeTruthy();
  });

  it('translates anthropic inbound → responses upstream end to end', async () => {
    const usage = captureUsage();
    const { impl, calls } = sseFetch([
      'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant","content":[]}}\n\n',
      'data: {"type":"response.output_text.delta","output_index":0,"delta":"你好"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":7,"output_tokens":2,"total_tokens":9,"input_tokens_details":{"cached_tokens":3,"cache_write_tokens":1},"output_tokens_details":{"reasoning_tokens":1}}}}\n\n',
    ]);
    const { server } = await startServer({
      resolveTicket: () => ({ runId: 'run-responses-1', route: responsesRoute }),
      recordRunUsage: usage.recordRunUsage,
      fetchImpl: impl,
    });
    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': 'ticket-1' },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        max_tokens: 128,
        system: 'be brief',
        messages: [{ role: 'user', content: 'ping' }],
        stream: true,
      }),
    });
    expect(response.status).toBe(200);
    const text = await readAll(response);

    // Upstream call: responses endpoint, ticket-resolved model, translated body.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://relay.example.com/v1/responses');
    expect(calls[0].body).toMatchObject({
      model: 'gpt-5.6-luna',
      instructions: 'be brief',
      stream: true,
      input: [{ role: 'user', content: 'ping' }],
    });

    // Downstream: Anthropic SSE envelope with streamed text.
    expect(text).toContain('event: message_start');
    expect(text).toContain('event: content_block_start');
    expect(text).toContain('"type":"text_delta"');
    expect(text).toContain('你好');
    expect(text).toContain('event: message_stop');
    // The upstream secret must never leak into the response.
    expect(text).not.toContain('sk-responses-secret');
    expect(usage.records.at(-1)).toMatchObject({
      runId: 'run-responses-1',
      usage: {
        providerResponseId: 'resp_1',
        providerId: 'prov-r',
        providerModelId: 'gpt-5.6-luna',
        tokensIn: 7,
        tokensOut: 2,
        cachedTokensHit: 3,
        cachedTokensCreated: 1,
        reasoningTokens: 1,
        totalTokens: 9,
      },
    });
  });

  it('continues a streamed Responses tool call over a second Anthropic HTTP request', async () => {
    const persisted = new Map<string, readonly (readonly [string, string])[]>();
    const createTickets = () =>
      new GatewayTicketRegistry({
        load: (scopeId) => persisted.get(scopeId),
        save: (scopeId, items) =>
          persisted.set(
            scopeId,
            items.map(([callId, itemId]) => [callId, itemId]),
          ),
        remove: (scopeId) => {
          persisted.delete(scopeId);
        },
      });
    let tickets = createTickets();
    const sessionRoute = {
      ...responsesRoute,
      responseContinuationScopeId: 'gateway.response-continuation.test-session',
    };
    const firstTicket = tickets.issue('run-responses-stream-1', sessionRoute);
    const calls: Array<{ body: unknown }> = [];
    const responses = [
      [
        'data: {"type":"response.created","response":{"id":"resp_stream_1","status":"in_progress"}}\n\n',
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_item_1"}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_item_1","output_index":0,"delta":"{\\"value\\":"}\n\n',
        'data: {"type":"response.function_call_arguments.delta","item_id":"fc_item_1","output_index":0,"delta":"\\"ok\\"}"}\n\n',
        'data: {"type":"response.function_call_arguments.done","item_id":"fc_item_1","output_index":0,"call_id":"call_1","name":"Write-Output","arguments":"{\\"value\\":\\"ok\\"}"}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_item_1","call_id":"call_1","name":"Write-Output","arguments":"{\\"value\\":\\"ok\\"}"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_stream_1","status":"completed","output":[]}}\n\n',
      ],
      [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant","content":[]}}\n\n',
        'data: {"type":"response.output_text.delta","output_index":0,"delta":"完成"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
      ],
    ];
    const fetchImpl = (async (_url: string | URL | Request, options?: RequestInit) => {
      calls.push({ body: JSON.parse(String(options?.body ?? '{}')) });
      const chunks = responses[calls.length - 1] ?? [];
      const encoder = new TextEncoder();
      let index = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index >= chunks.length) {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(chunks[index++]));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof fetch;
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      resolveContinuationItem: (scopeId, callId) =>
        tickets.resolveContinuationItem(scopeId, callId),
      recordContinuationItem: (scopeId, callId, itemId) =>
        tickets.recordContinuationItem(scopeId, callId, itemId),
      fetchImpl,
    });

    const first = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': firstTicket.id },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'run it' }],
        stream: true,
      }),
    });
    const firstText = await readAll(first);
    expect(first.status).toBe(200);
    expect(firstText).toContain('"type":"tool_use","id":"call_1"');

    tickets.revokeRun('run-responses-stream-1');
    tickets.clear();
    tickets = createTickets();
    const secondTicket = tickets.issue('run-responses-stream-2', sessionRoute);
    const second = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': secondTicket.id },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        messages: [
          { role: 'user', content: 'run it' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'Write-Output',
                input: { value: 'ok' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: 'ok',
              },
            ],
          },
        ],
        stream: true,
      }),
    });
    const secondText = await readAll(second);

    expect(second.status).toBe(200);
    expect(secondText).toContain('"text":"完成"');
    expect(calls).toHaveLength(2);
    expect((calls[1].body as { previous_response_id?: string }).previous_response_id).toBeUndefined();
    expect(calls[1].body).toMatchObject({
      input: [
        { role: 'user', content: 'run it' },
        {
          type: 'function_call',
          id: 'fc_item_1',
          call_id: 'call_1',
          name: 'Write-Output',
          arguments: '{"value":"ok"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'ok',
        },
      ],
    });
  });

  it('continues a non-streaming Responses tool call by replaying function_call + output', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-responses-json', responsesRoute);
    const calls: Array<{ body: unknown }> = [];
    const payloads = [
      {
        id: 'resp_json_1',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'fc_item_json',
            call_id: 'call_json',
            name: 'Write-Output',
            arguments: '{"value":"ok"}',
          },
        ],
      },
      {
        id: 'resp_json_2',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'json-complete' }],
          },
        ],
      },
    ];
    const fetchImpl = (async (_url: string | URL | Request, options?: RequestInit) => {
      calls.push({ body: JSON.parse(String(options?.body ?? '{}')) });
      return Response.json(payloads[calls.length - 1], { status: 200 });
    }) as unknown as typeof fetch;
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      resolveContinuationItem: (scopeId, callId) =>
        tickets.resolveContinuationItem(scopeId, callId),
      recordContinuationItem: (scopeId, callId, itemId) =>
        tickets.recordContinuationItem(scopeId, callId, itemId),
      fetchImpl,
    });

    const first = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        messages: [{ role: 'user', content: 'run json' }],
        stream: false,
      }),
    });
    expect(await readAll(first)).toContain('"type":"tool_use","id":"call_json"');

    const second = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        messages: [
          { role: 'user', content: 'run json' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_json',
                name: 'Write-Output',
                input: { value: 'ok' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_json',
                content: 'ok',
              },
            ],
          },
        ],
        stream: false,
      }),
    });
    expect(await readAll(second)).toContain('"text":"json-complete"');
    expect((calls[1].body as { previous_response_id?: string }).previous_response_id).toBeUndefined();
    expect(calls[1].body).toMatchObject({
      input: [
        { role: 'user', content: 'run json' },
        {
          type: 'function_call',
          id: 'fc_item_json',
          call_id: 'call_json',
          name: 'Write-Output',
          arguments: '{"value":"ok"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_json',
          output: 'ok',
        },
      ],
    });
  });

  it('fails loudly when the inbound is openai-chat against a responses upstream', async () => {
    const { impl } = sseFetch([]);
    const { server } = await startServer({
      resolveTicket: () => ({ runId: 'run-responses-unsupported', route: responsesRoute }),
      fetchImpl: impl,
    });
    const response = await fetch(urlFor(server, '/openai/v1/chat/completions'), {
      method: 'POST',
      headers: { 'x-api-key': 'ticket-1' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(response.status).toBe(502);
    expect(await response.text()).toContain('not supported yet');
  });

  it('injects a stable Codex prompt-cache key for same-dialect Responses traffic', async () => {
    const upstream = sseFetch(['data: [DONE]\n\n']);
    const route = { ...responsesRoute, responseContinuationScopeId: 'kernel_codex-cache-test' };
    const { server } = await startServer({
      resolveTicket: () => ({ runId: 'run-codex-cache', route, kernelId: 'codex' }),
      fetchImpl: upstream.impl,
    });

    const request = {
      method: 'POST',
      headers: { authorization: 'Bearer ticket-codex-cache' },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        stream: true,
      }),
    };
    const firstResponse = await fetch(urlFor(server, '/openai/v1/responses'), request);
    const secondResponse = await fetch(urlFor(server, '/openai/v1/responses'), request);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await firstResponse.text();
    await secondResponse.text();

    expect(upstream.calls).toHaveLength(2);
    const firstBody = upstream.calls[0].body as Record<string, unknown>;
    const secondBody = upstream.calls[1].body as Record<string, unknown>;
    expect(firstBody.prompt_cache_key).toMatch(/^stx-codex-[a-f0-9]{32}$/);
    expect(secondBody.prompt_cache_key).toBe(firstBody.prompt_cache_key);
    expect(firstBody.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
  });

  it('retries Codex Responses once when the upstream rejects prompt-cache fields', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
      calls.push(body);
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message: 'Unsupported parameter(s): `prompt_cache_key`, `prompt_cache_options`',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;
    const route = { ...responsesRoute, responseContinuationScopeId: 'kernel_codex-degrade-test' };
    const { server } = await startServer({
      resolveTicket: () => ({ runId: 'run-codex-degrade', route, kernelId: 'codex' }),
      fetchImpl,
    });

    const response = await fetch(urlFor(server, '/openai/v1/responses'), {
      method: 'POST',
      headers: { authorization: 'Bearer ticket-codex-degrade' },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].prompt_cache_key).toBeTruthy();
    expect(calls[0].prompt_cache_options).toBeTruthy();
    expect(calls[1].prompt_cache_key).toBeUndefined();
    expect(calls[1].prompt_cache_options).toBeUndefined();
  });

  it('replays function_call + output pairs in one request (HTTP Responses shape)', async () => {
    const tickets = new GatewayTicketRegistry();
    // Simulate a stateless HTTP Responses relay: it accepts tool results only
    // when the answering function_call is replayed in the SAME request input
    // and rejects the `item_reference` field outright (KMKAPI-style strict
    // schema) — the pair is matched by call_id alone.
    tickets.recordContinuationItem('scope-fallback', 'call_fb', 'fc_item_fb');
    const calls: Array<{ body: unknown }> = [];
    const fetchImpl = (async (_url: string | URL | Request, options?: RequestInit) => {
      calls.push({ body: JSON.parse(String(options?.body ?? '{}')) });
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant","content":[]}}\n\n',
        'data: {"type":"response.output_text.delta","output_index":0,"delta":"回放成功"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
      ];
      let index = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (index >= chunks.length) {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(chunks[index++]));
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof fetch;
    const { server } = await startServer({
      resolveTicket: () => ({
        runId: 'run-responses-replay',
        route: { ...responsesRoute, responseContinuationScopeId: 'scope-fallback' },
      }),
      resolveContinuationItem: (scopeId, callId) =>
        scopeId === 'scope-fallback' ? tickets.resolveContinuationItem(scopeId, callId) : undefined,
      recordContinuationItem: (scopeId, callId, itemId) =>
        tickets.recordContinuationItem(scopeId, callId, itemId),
      fetchImpl,
    });

    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': 'ticket-fallback' },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        messages: [
          { role: 'user', content: 'run it' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_fb',
                name: 'Write-Output',
                input: { value: 'ok' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_fb',
                content: 'ok',
              },
            ],
          },
        ],
        stream: true,
      }),
    });
    const text = await readAll(response);

    expect(response.status).toBe(200);
    expect(text).toContain('"text":"回放成功"');
    expect(calls).toHaveLength(1);
    const body = calls[0].body as { input: Array<Record<string, unknown>> };
    // The replayed function_call carries the provider item id…
    expect(body.input).toContainEqual({
      type: 'function_call',
      id: 'fc_item_fb',
      call_id: 'call_fb',
      name: 'Write-Output',
      arguments: '{"value":"ok"}',
    });
    // …and the answering function_call_output pairs to it by call_id only
    // (no item_reference: strict HTTP relays reject that field).
    expect(body.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_fb',
      output: 'ok',
    });
    // The replayed pair must not carry item_reference anywhere.
    const serialized = JSON.stringify(body.input);
    expect(serialized).not.toContain('item_reference');
  });

  it('translates a Codex Responses request onto a Chat upstream and streams Responses events back', async () => {
    const chatSse = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"role":"assistant","content":"你"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"deepseek-v4-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n\n',
      'data: [DONE]\n\n',
    ];
    const upstream = sseFetch(chatSse);
    const { server } = await startServer({
      resolveTicket: () => ({ runId: 'run-r2c', route: openAiRoute }),
      fetchImpl: upstream.impl,
    });
    const response = await fetch(urlFor(server, '/openai/v1/responses'), {
      method: 'POST',
      headers: { 'x-api-key': 'ticket-r2c' },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        instructions: 'be brief',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        stream: true,
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('event: response.created');
    expect(text).toContain('event: response.output_text.delta');
    expect(text).toContain('event: response.completed');
    // The upstream must have received a Chat body at /chat/completions, with
    // the model rewritten to the ticket's provider model (routing is
    // authoritative over whatever the kernel wrote).
    expect(upstream.calls[0].url).toContain('/chat/completions');
    expect(upstream.calls[0].body).toMatchObject({
      model: 'gpt-5.6-sol',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hello' },
      ],
      stream: true,
    });
  });

  it('translates a Responses tool loop onto Chat tool messages and back', async () => {
    const chatSse = [
      'data: {"id":"c","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"shell_ls","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"c","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"dir\\":\\".\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const upstream = sseFetch(chatSse);
    const { server } = await startServer({
      resolveTicket: () => ({ runId: 'run-r2c-tool', route: openAiRoute }),
      fetchImpl: upstream.impl,
    });
    const response = await fetch(urlFor(server, '/openai/v1/responses'), {
      method: 'POST',
      headers: { 'x-api-key': 'ticket-r2c-tool' },
      body: JSON.stringify({
        model: 'm',
        input: [
          { role: 'user', content: 'list' },
          { type: 'function_call', call_id: 'call_1', name: 'shell_ls', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_1', output: 'file.txt' },
        ],
        stream: true,
      }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('event: response.function_call_arguments.delta');
    expect(text).toContain('event: response.completed');
    expect(upstream.calls[0].body).toMatchObject({
      messages: [
        { role: 'user', content: 'list' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'shell_ls', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'file.txt' },
      ],
    });
  });

  it('audits a translated request with the kernel id and both bodies', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-audit-1', openAiRoute, 'claude-code');
    const entries: Array<import('@sync-think/protocol').GatewayRequestLogEntry> = [];
    const upstream = sseFetch([
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
      'data: {"id":"chatcmpl-audit-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      fetchImpl: upstream.impl,
      onRequest: (entry) => entries.push(entry),
    });

    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        max_tokens: 1024,
        system: 'be brief',
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      }),
    });
    await readAll(response);
    expect(response.status).toBe(200);

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.kernelId).toBe('claude-code');
    expect(entry.runId).toBe('run-audit-1');
    expect(entry.inboundDialect).toBe('anthropic-messages');
    expect(entry.upstreamProtocol).toBe('openai-chat');
    expect(entry.converted).toBe(true);
    expect(entry.model).toBe('gpt-5.6-sol');
    expect(entry.status).toBe('success');
    expect(entry.truncated).toBe(false);
    expect(typeof entry.latencyMs).toBe('number');
    // 原始格式：inbound body 原样记录
    expect(JSON.parse(entry.rawRequest)).toMatchObject({ model: 'claude-sonnet-4' });
    // 转换后格式：目标模型已被票据覆盖
    const converted = JSON.parse(entry.convertedRequest) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(converted).toMatchObject({ model: 'gpt-5.6-sol' });
    expect(converted.messages[0]).toEqual({ role: 'system', content: 'be brief' });
  });

  it('audits an upstream failure with status code and truncates oversized bodies', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-audit-fail', openAiRoute, 'codex');
    const entries: Array<import('@sync-think/protocol').GatewayRequestLogEntry> = [];
    const upstream = sseFetch([], { status: 401, body: '{"error":{"message":"bad key"}}' });
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      fetchImpl: upstream.impl,
      onRequest: (entry) => entries.push(entry),
    });

    // 超过 AUDIT_BODY_CAP 的大 body 应被截断标记。
    const bigText = 'x'.repeat(40_000);
    const response = await fetch(urlFor(server, '/anthropic/v1/messages'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        max_tokens: 1024,
        messages: [{ role: 'user', content: bigText }],
        stream: true,
      }),
    });
    await readAll(response);

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.status).toBe('error');
    expect(entry.statusCode).toBe(401);
    expect(entry.kernelId).toBe('codex');
    expect(entry.truncated).toBe(true);
    expect(entry.rawRequest.length).toBeLessThan(40_000);
    expect(entry.convertedRequest.length).toBeLessThan(40_000);
  });

  it('records a same-dialect proxy as converted=false', async () => {
    const tickets = new GatewayTicketRegistry();
    const ticket = tickets.issue('run-audit-proxy', openAiRoute, 'codex');
    const entries: Array<import('@sync-think/protocol').GatewayRequestLogEntry> = [];
    const upstream = sseFetch([
      'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n',
      'data: {"id":"chatcmpl-proxy-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]);
    const { server } = await startServer({
      resolveTicket: (key) => tickets.resolveWithRun(key),
      fetchImpl: upstream.impl,
      onRequest: (entry) => entries.push(entry),
    });

    const response = await fetch(urlFor(server, '/openai/v1/chat/completions'), {
      method: 'POST',
      headers: { 'x-api-key': ticket.id, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'anything', messages: [{ role: 'user', content: 'hi' }], stream: true }),
    });
    await readAll(response);

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.converted).toBe(false);
    expect(entry.inboundDialect).toBe('openai-chat');
    expect(entry.upstreamProtocol).toBe('openai-chat');
    expect(entry.status).toBe('success');
    expect(JSON.parse(entry.convertedRequest)).toMatchObject({ model: 'gpt-5.6-sol' });
  });
});
