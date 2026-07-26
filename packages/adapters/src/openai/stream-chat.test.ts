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
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIChatCompletions(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toContain('solid reply');
    expect(events.some((e) => e.type === 'usage')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'finished' });
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
});
