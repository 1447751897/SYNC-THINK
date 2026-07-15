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
  const promise = new Promise<void>((done) => { resolve = done; });
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

  it('distinguishes external cancellation from timeout', async () => {
    const external = new AbortController();
    fetchMock.mockImplementation(async (_url, initValue) => {
      const signal = (initValue as RequestInit).signal!;
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
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
    const closing = iterator.return!().then(() => { returned = true; });
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
