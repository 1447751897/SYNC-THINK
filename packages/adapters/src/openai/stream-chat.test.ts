import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIChatAdapter } from './openai-chat-adapter.js';
import { joinChatCompletionsUrl, streamOpenAIChatCompletions } from './stream-chat.js';
import { collect, textFromEvents } from '../events.js';
import type { ProviderCallRequest } from '../types.js';
import { scrubSecrets } from './discover-models.js';

function req(overrides: Partial<ProviderCallRequest> = {}): ProviderCallRequest {
  return {
    protocol: 'openai-chat',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-4o-mini',
    apiKey: 'sk-TEST_STREAM_KEY_ABCDEFG_123456',
    messages: [{ role: 'user', content: 'hello stream' }],
    stream: true,
    signal: new AbortController().signal,
    idempotencyKey: 'provider-call-chat-stable-key',
    ...overrides,
  } as ProviderCallRequest;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Minimal ReadableStream of SSE bytes for Node/vitest. */
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

describe('joinChatCompletionsUrl', () => {
  it('appends /chat/completions once', () => {
    expect(joinChatCompletionsUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(joinChatCompletionsUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(joinChatCompletionsUrl('https://gw.example/v1/chat/completions')).toBe(
      'https://gw.example/v1/chat/completions',
    );
  });
});

describe('streamOpenAIChatCompletions', () => {
  const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('streams text-delta events from SSE and finishes', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toBe('Hello world');
    expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'stop' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init).toMatchObject({ method: 'POST' });
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toContain('Bearer sk-TEST_STREAM_KEY');
    expect(headers['Idempotency-Key']).toBe('provider-call-chat-stable-key');
    const bodyJson = JSON.parse((init as { body: string }).body);
    expect(bodyJson.model).toBe('gpt-4o-mini');
    expect(bodyJson.stream).toBe(true);
    expect(bodyJson.stream_options).toEqual({ include_usage: true });
  });

  it('keeps reading after finish_reason so the trailing usage-only chunk is emitted', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":21,"completion_tokens":7,"total_tokens":28}}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    expect(events).toContainEqual({
      type: 'usage',
      tokensIn: 21,
      tokensOut: 7,
      totalTokens: 28,
    });
    expect(events.findIndex((event) => event.type === 'usage')).toBeLessThan(
      events.findIndex((event) => event.type === 'finished'),
    );
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'stop' });
  });

  it('parses usage and visible choices from the same chunk', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"combined"},"finish_reason":"stop"}],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    expect(textFromEvents(events)).toBe('combined');
    expect(events).toContainEqual({
      type: 'usage',
      tokensIn: 8,
      tokensOut: 2,
      totalTokens: 10,
    });
  });

  it('serializes GPT-5.6 implicit cache policy without gateway-incompatible breakpoints', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(
        req({
          modelId: 'gpt-5.6-sol',
          systemPrompt: 'stable system prompt',
          messages: [
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'next question' },
          ],
          tools: [{ name: 'read_file', inputSchema: { type: 'object' } }],
          toolChoice: 'none',
          promptCache: { key: 'thread-cache-key', strategy: 'automatic', retention: '24h' },
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.prompt_cache_key).toBe('thread-cache-key');
    expect(body.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(body).not.toHaveProperty('prompt_cache_retention');
    expect(body.tool_choice).toBe('none');
    expect(body.tools).toHaveLength(1);
    expect(JSON.stringify(body.messages)).not.toContain('prompt_cache_breakpoint');
  });

  it('keeps a stable key without unsupported retention for earlier OpenAI models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(
        req({
          modelId: 'gpt-4o-mini',
          promptCache: { key: 'legacy-thread-key', strategy: 'explicit', retention: '24h' },
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.prompt_cache_key).toBe('legacy-thread-key');
    expect(body).not.toHaveProperty('prompt_cache_retention');
    expect(body).not.toHaveProperty('prompt_cache_options');
  });

  it('uses 24h retention for an earlier model family that supports it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(
        req({
          modelId: 'gpt-5.5-sol',
          promptCache: { key: 'retained-thread-key', strategy: 'automatic', retention: '24h' },
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.prompt_cache_key).toBe('retained-thread-key');
    expect(body.prompt_cache_retention).toBe('24h');
    expect(body).not.toHaveProperty('prompt_cache_options');
  });

  it('serializes multimodal user images as image_url parts', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(
        req({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'describe' },
                { type: 'image', imageUrl: 'data:image/png;base64,xx' },
              ],
            },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );
    const bodyJson = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(bodyJson.messages[0].content).toEqual([
      { type: 'text', text: 'describe' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } },
    ]);
  });

  it('forwards reasoning_effort and streams reasoning-delta separately', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"reasoning_content":"先想一步"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req({ reasoningEffort: 'high' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'reasoning-delta', text: '先想一步' },
        { type: 'text-delta', text: '答案' },
      ]),
    );
    expect(textFromEvents(events)).toBe('答案');
    const bodyJson = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(bodyJson.reasoning_effort).toBe('high');
    // enable_thinking is gateway-specific (Qwen/GLM style); OpenAI rejects
    // unknown params, so it must NOT be sent to a gpt-* model.
    expect(bodyJson.enable_thinking).toBeUndefined();
  });

  it('accepts gateway reasoning aliases and content blocks without exposing redacted data', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.summary","summary":"先核对需求"},{"type":"reasoning.encrypted","data":"secret"}]}}]}\n\n',
      'data: {"choices":[{"delta":{"content":[{"type":"thinking","text":"再选择结构"},{"type":"text","text":"答案"}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req({ reasoningEffort: 'high' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'reasoning-delta', text: '先核对需求' },
        { type: 'reasoning-delta', text: '再选择结构' },
        { type: 'text-delta', text: '答案' },
      ]),
    );
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('preserves paragraph boundaries between structured reasoning summary blocks', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.summary","summary":"Planning project inspection"},{"type":"reasoning.summary","summary":"Listing relevant files"}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req({ reasoningEffort: 'high' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );

    expect(events).toContainEqual({
      type: 'reasoning-delta',
      text: 'Planning project inspection\n\nListing relevant files',
    });
  });

  it('preserves structured reasoning content blocks without mixing visible text', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":[{"type":"thinking","text":"Inspect current state"},{"type":"thinking","text":"Choose the smallest fix"},{"type":"text","text":"Visible answer"}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req({ reasoningEffort: 'high' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );

    expect(events).toContainEqual({
      type: 'reasoning-delta',
      text: 'Inspect current state\n\nChoose the smallest fix',
    });
    expect(events).toContainEqual({ type: 'text-delta', text: 'Visible answer' });
  });

  it('keeps ordinary string reasoning deltas contiguous across stream frames', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"reasoning_content":"Planning"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":" next step"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req({ reasoningEffort: 'high' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );

    expect(
      events
        .filter((event) => event.type === 'reasoning-delta')
        .map((event) => (event.type === 'reasoning-delta' ? event.text : '')),
    ).toEqual(['Planning', ' next step']);
  });

  it("collapses 'auto' to a valid wire effort (OpenAI rejects 'auto')", async () => {
    const body = sseStream(['data: [DONE]\n\n']);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(req({ modelId: 'gpt-5.5', reasoningEffort: 'auto' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );
    const bodyJson = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(bodyJson.reasoning_effort).toBe('high');
    expect(bodyJson.enable_thinking).toBeUndefined();
  });

  it('sends enable_thinking only to Qwen/GLM-style models', async () => {
    const body = sseStream(['data: [DONE]\n\n']);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(req({ modelId: 'qwen3-235b-a22b', reasoningEffort: 'high' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );
    const bodyJson = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(bodyJson.enable_thinking).toBe(true);
    expect(bodyJson.reasoning_effort).toBe('high');
  });

  it('maps max_tokens → max_completion_tokens and drops temperature for o-series/gpt-5', async () => {
    const body = sseStream(['data: [DONE]\n\n']);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(
        req({ modelId: 'o3-mini', maxOutputTokens: 4096, temperature: 0.2 }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );
    const bodyJson = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(bodyJson.max_completion_tokens).toBe(4096);
    expect(bodyJson.max_tokens).toBeUndefined();
    expect(bodyJson.temperature).toBeUndefined();
  });

  it('serializes tool schemas/history and assembles streamed tool calls', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(
        req({
          tools: [
            {
              name: 'read_file',
              description: 'Read a file',
              inputSchema: { type: 'object', required: ['path'] },
            },
          ],
          messages: [
            { role: 'user', content: 'Read README' },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCall: {
                    id: 'previous-call',
                    name: 'read_file',
                    argumentsJson: '{"path":"old.md"}',
                  },
                },
              ],
            },
            { role: 'tool', toolCallId: 'previous-call', content: '{"content":"old"}' },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    expect(events).toContainEqual({
      type: 'tool-call',
      toolCall: { id: 'call-1', name: 'read_file', argumentsJson: '{"path":"README.md"}' },
    });
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'tool-requests' });
    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(requestBody.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'read_file', parameters: { type: 'object' } },
    });
    expect(requestBody.messages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'previous-call', function: { name: 'read_file' } }],
    });
    expect(requestBody.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'previous-call',
    });
  });

  it('degrades adjacent commentary and tool calls into one Chat assistant turn', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(
        req({
          messages: [
            { role: 'user', content: '检查状态' },
            {
              role: 'assistant',
              phase: 'commentary',
              content: '我先检查文件。',
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCall: {
                    id: 'call-1',
                    name: 'read_file',
                    argumentsJson: '{"path":"README.md"}',
                  },
                },
              ],
            },
            { role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(requestBody.messages).toEqual([
      { role: 'user', content: '检查状态' },
      {
        role: 'assistant',
        content: '我先检查文件。',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"README.md"}',
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"ok":true}' },
    ]);
    expect(JSON.stringify(requestBody.messages)).not.toContain('phase');
  });

  it('distinguishes external cancellation from timeout', async () => {
    const external = new AbortController();
    fetchMock.mockImplementation(async (_url, initValue) => {
      const signal = (initValue as RequestInit).signal!;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      });
    });
    const eventsPromise = collect(
      streamOpenAIChatCompletions(
        req({ signal: external.signal } as Partial<ProviderCallRequest>),
        { fetchImpl: fetchMock as unknown as typeof fetch, timeoutMs: 10_000 },
      ),
    );
    await Promise.resolve();
    external.abort(new Error('run.cancelled'));
    const events = await eventsPromise;
    expect(events).toContainEqual({
      type: 'error',
      failureClass: 'acceptance',
      message: 'Provider chat call aborted',
    });
  });

  it('awaits response stream cleanup when the consumer returns early', async () => {
    const cleanup = deferred();
    const encoder = new TextEncoder();
    let emitted = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!emitted) {
          emitted = true;
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'),
          );
        }
      },
      async cancel() {
        await cleanup.promise;
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const iterator = streamOpenAIChatCompletions(req(), {
      fetchImpl: fetchMock as unknown as typeof fetch,
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'text-delta', text: 'first' },
    });
    let returned = false;
    const closing = iterator.return!().then(() => {
      returned = true;
    });
    await Promise.resolve();
    expect(returned).toBe(false);
    cleanup.resolve();
    await closing;
    expect(returned).toBe(true);
  });

  it('maps 401 to auth error without leaking key in message', async () => {
    const secret = 'sk-LEAK_ME_IN_ERROR_BODY_XYZ999';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ error: { message: `bad key ${secret}` } }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req({ apiKey: secret }), {
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
      streamOpenAIChatCompletions(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(events.some((e) => e.type === 'error' && e.failureClass === 'rate-limit')).toBe(true);
  });

  it('parses non-stream JSON completion fallback', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: 'solid reply' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 13,
            completion_tokens: 5,
            total_tokens: 18,
            prompt_tokens_details: { cached_tokens: 8, cache_write_tokens: 2 },
            completion_tokens_details: { reasoning_tokens: 3 },
          },
        }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toContain('solid reply');
    expect(events).toContainEqual({
      type: 'usage',
      tokensIn: 13,
      tokensOut: 5,
      cachedTokensHit: 8,
      cachedTokensCreated: 2,
      reasoningTokens: 3,
      totalTokens: 18,
    });
    expect(events[events.length - 1]).toMatchObject({ type: 'finished' });
  });

  it('parses non-stream reasoning alongside visible content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'solid reply',
                analysis: 'checked the constraints',
              },
              finish_reason: 'stop',
            },
          ],
        }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(events).toContainEqual({
      type: 'reasoning-delta',
      text: 'checked the constraints',
    });
    expect(textFromEvents(events)).toContain('solid reply');
  });

  it('OpenAIChatAdapter.call delegates to stream', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"via adapter"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body,
      text: async () => '',
    } as unknown as Response);

    const adapter = new OpenAIChatAdapter({ fetchImpl: fetchMock as unknown as typeof fetch });
    const events = await collect(adapter.call(req()));
    expect(textFromEvents(events)).toContain('via adapter');
  });

  it('degrades enable_thinking on 400 Unsupported parameter and retries once', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: { get: () => 'application/json' },
        body: null,
        text: async () =>
          JSON.stringify({
            error: {
              message: 'Validation: Unsupported parameter(s): `enable_thinking`',
              type: 'invalid_request_error',
            },
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']),
        text: async () => '',
      } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req({ modelId: 'z-ai/glm-5.2', reasoningEffort: 'auto' }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );
    expect(textFromEvents(events)).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    const secondBody = JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body);
    expect(firstBody.enable_thinking).toBe(true);
    expect(secondBody.enable_thinking).toBeUndefined();
    // The OpenAI-standard effort field stays on the degraded retry.
    expect(secondBody.reasoning_effort).toBe('high');
  });

  it('degrades prompt_cache_key on 400 Unsupported parameter and retries once', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: { get: () => 'application/json' },
        body: null,
        text: async () =>
          JSON.stringify({
            error: {
              message: 'Validation: Unsupported parameter(s): `prompt_cache_key`',
              type: 'invalid_request_error',
            },
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']),
        text: async () => '',
      } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(
        req({
          modelId: 'gpt-5.6-sol',
          promptCache: { key: 'thread-cache-key', strategy: 'automatic', retention: '24h' },
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );
    expect(textFromEvents(events)).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    const secondBody = JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body);
    expect(firstBody.prompt_cache_key).toBe('thread-cache-key');
    expect(secondBody.prompt_cache_key).toBeUndefined();
  });

  it('degrades stream_options on gateways that reject streamed usage', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: { get: () => 'application/json' },
        body: null,
        text: async () =>
          JSON.stringify({
            error: {
              message: 'Validation: Unsupported parameter(s): `stream_options`',
              type: 'invalid_request_error',
            },
          }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']),
        text: async () => '',
      } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req(), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );

    expect(textFromEvents(events)).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    const secondBody = JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body);
    expect(firstBody.stream_options).toEqual({ include_usage: true });
    expect(secondBody.stream_options).toBeUndefined();
  });

  it('does not send prompt_cache fields for non-gpt relay models', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    } as unknown as Response);

    await collect(
      streamOpenAIChatCompletions(
        req({
          modelId: 'glm-5.2',
          promptCache: { key: 'thread-cache-key', strategy: 'automatic' },
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body).not.toHaveProperty('prompt_cache_key');
  });

  describe('friendly failure reasons', () => {
    function errorResponse(status: number, body: unknown) {
      return {
        ok: false,
        status,
        headers: { get: () => 'application/json' },
        body: null,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }

    async function firstErrorMessage(): Promise<string | undefined> {
      const events = await collect(
        streamOpenAIChatCompletions(req(), {
          fetchImpl: fetchMock as unknown as typeof fetch,
        }),
      );
      const error = events.find((event) => event.type === 'error');
      return error?.type === 'error' ? error.message : undefined;
    }

    it('quotes the rejected parameter names for 400 unsupported-parameter', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(400, {
          error: {
            message: 'Validation: Unsupported parameter(s): `enable_thinking`, `prompt_cache_key`',
            type: 'invalid_request_error',
          },
        }),
      );
      const message = await firstErrorMessage();
      expect(message).toContain('请求被网关拒绝（400）');
      expect(message).toContain('enable_thinking');
      expect(message).toContain('prompt_cache_key');
      expect(message).toContain('请调整模型或网关配置');
    });

    it('quotes the gateway message for other 4xx rejections', async () => {
      fetchMock.mockResolvedValue(
        errorResponse(400, {
          error: { message: 'context length exceeded', type: 'invalid_request_error' },
        }),
      );
      const message = await firstErrorMessage();
      expect(message).toContain('请求被网关拒绝（400）');
      expect(message).toContain('context length exceeded');
    });

    it('explains auth failures with an actionable hint', async () => {
      fetchMock.mockResolvedValue(errorResponse(401, { error: { message: 'invalid key' } }));
      const message = await firstErrorMessage();
      expect(message).toContain('认证失败（401）');
      expect(message).toContain('API Key 无效或无权限');
      expect(message).toContain('检查密钥');
    });

    it('explains rate limits', async () => {
      fetchMock.mockResolvedValue(errorResponse(429, { error: { message: 'slow down' } }));
      const message = await firstErrorMessage();
      expect(message).toContain('请求被限流（429）');
      expect(message).toContain('请稍后重试');
    });

    it('explains upstream 5xx failures as gateway-side issues', async () => {
      fetchMock.mockResolvedValue(errorResponse(502, { error: { message: 'bad gateway' } }));
      const message = await firstErrorMessage();
      expect(message).toContain('上游服务暂不可用（502）');
      expect(message).toContain('请稍后重试或联系网关管理员');
    });
  });
});
