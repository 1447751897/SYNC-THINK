import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnthropicMessagesAdapter } from './anthropic-messages-adapter.js';
import { joinMessagesUrl, streamAnthropicMessages } from './stream-messages.js';
import { joinAnthropicModelsUrl, discoverAnthropicModels } from './discover-models.js';
import { collect, textFromEvents } from '../events.js';
import type { ProviderCallRequest } from '../types.js';
import { scrubSecrets } from '../openai/discover-models.js';

function req(overrides: Partial<ProviderCallRequest> = {}): ProviderCallRequest {
  return {
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    modelId: 'claude-3-5-haiku-latest',
    apiKey: 'sk-ant-TEST_STREAM_KEY_ABCDEFG_123456',
    messages: [{ role: 'user', content: 'hello anthropic stream' }],
    stream: true,
    signal: new AbortController().signal,
    idempotencyKey: 'provider-call-anthropic-stable-key',
    ...overrides,
  } as ProviderCallRequest;
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

describe('joinMessagesUrl', () => {
  it('appends /messages once', () => {
    expect(joinMessagesUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(joinMessagesUrl('https://api.anthropic.com/v1/')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(joinMessagesUrl('https://gw.example/v1/messages')).toBe(
      'https://gw.example/v1/messages',
    );
  });
});

describe('joinAnthropicModelsUrl', () => {
  it('appends /models once', () => {
    expect(joinAnthropicModelsUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/models',
    );
  });
});

describe('streamAnthropicMessages', () => {
  const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('streams text-delta from Anthropic SSE and finishes', async () => {
    const body = sseStream([
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: content_block_delta\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" Claude"}}\n\n',
      'event: message_stop\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamAnthropicMessages(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toBe('Hello Claude');
    expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'stop' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init).toMatchObject({ method: 'POST' });
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers['x-api-key']).toContain('sk-ant-TEST_STREAM_KEY');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['Idempotency-Key']).toBe('provider-call-anthropic-stable-key');
    const bodyJson = JSON.parse((init as { body: string }).body);
    expect(bodyJson.model).toBe('claude-3-5-haiku-latest');
    expect(bodyJson.stream).toBe(true);
    expect(bodyJson.messages[0]).toMatchObject({ role: 'user', content: 'hello anthropic stream' });
  });

  it('serializes tool history and assembles Anthropic tool_use input deltas', async () => {
    const body = sseStream([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"git_status","input":{}}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamAnthropicMessages(
        req({
          tools: [
            { name: 'git_status', description: 'Read status', inputSchema: { type: 'object' } },
          ],
          messages: [
            { role: 'user', content: 'Status' },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCall: { id: 'old-tool', name: 'git_status', argumentsJson: '{}' },
                },
              ],
            },
            { role: 'tool', toolCallId: 'old-tool', content: '{"ok":true}' },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    expect(events).toContainEqual({
      type: 'tool-call',
      toolCall: { id: 'toolu_1', name: 'git_status', argumentsJson: '{}' },
    });
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'tool-requests' });
    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(requestBody.tools[0]).toMatchObject({
      name: 'git_status',
      input_schema: { type: 'object' },
    });
    expect(requestBody.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'old-tool', name: 'git_status' }],
    });
    expect(requestBody.messages[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'old-tool' }],
    });
  });

  it('maps 401 to auth error without leaking key', async () => {
    const secret = 'sk-ant-LEAK_ME_IN_ERROR_BODY_XYZ999';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ error: { message: `bad key ${secret}` } }),
    } as unknown as Response);

    const events = await collect(
      streamAnthropicMessages(req({ apiKey: secret }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );
    const err = events.find((e) => e.type === 'error');
    expect(err).toMatchObject({ type: 'error', failureClass: 'auth' });
    if (err?.type === 'error') {
      expect(err.message).not.toContain(secret);
      expect(scrubSecrets(err.message, [secret])).toBe(err.message);
    }
  });

  it('maps 429 to rate-limit', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => '{"error":{"message":"slow down"}}',
    } as unknown as Response);
    const events = await collect(
      streamAnthropicMessages(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(events.some((e) => e.type === 'error' && e.failureClass === 'rate-limit')).toBe(true);
  });

  it('parses non-stream JSON message fallback', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () =>
        JSON.stringify({
          content: [{ type: 'text', text: 'solid claude reply' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
    } as unknown as Response);

    const events = await collect(
      streamAnthropicMessages(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toContain('solid claude reply');
    expect(events.some((e) => e.type === 'usage')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'finished' });
  });

  it('AnthropicMessagesAdapter.call delegates to stream', async () => {
    const body = sseStream([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"via adapter"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const adapter = new AnthropicMessagesAdapter({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const events = await collect(adapter.call(req()));
    expect(textFromEvents(events)).toContain('via adapter');
    expect(adapter.protocol).toBe('anthropic-messages');
  });
});

describe('discoverAnthropicModels', () => {
  const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('returns model ids with x-api-key header', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: [{ id: 'claude-3-5-sonnet-latest' }, { id: 'claude-3-5-haiku-latest' }],
        }),
    } as unknown as Response);

    const models = await discoverAnthropicModels({
      apiKey: 'sk-ant-TEST_KEY_FOR_DISCOVERY_001',
      baseUrl: 'https://api.anthropic.com/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(models).toEqual(['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/models');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers['x-api-key']).toBe('sk-ant-TEST_KEY_FOR_DISCOVERY_001');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });
});
