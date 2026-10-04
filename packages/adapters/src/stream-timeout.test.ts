import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect } from './events.js';
import { OpenAIResponsesAdapter } from './openai-responses-adapter.js';
import { OpenAIChatAdapter } from './openai/openai-chat-adapter.js';
import { AnthropicMessagesAdapter } from './anthropic/anthropic-messages-adapter.js';
import type { ProviderAdapter, ProviderCallRequest } from './types.js';

const providers = [
  { name: 'Responses', make: (fetchImpl: typeof fetch, idle?: number | null) => new OpenAIResponsesAdapter({ fetchImpl, streamIdleTimeoutMs: idle }), finish: 'data: {"type":"response.completed","response":{"id":"response","status":"completed"}}\n\n' },
  { name: 'Chat Completions', make: (fetchImpl: typeof fetch, idle?: number | null) => new OpenAIChatAdapter({ fetchImpl, streamIdleTimeoutMs: idle }), finish: 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' },
  { name: 'Anthropic Messages', make: (fetchImpl: typeof fetch, idle?: number | null) => new AnthropicMessagesAdapter({ fetchImpl, streamIdleTimeoutMs: idle }), finish: 'data: {"type":"message_stop"}\n\n' },
];
function request(adapter: ProviderAdapter, signal = new AbortController().signal): ProviderCallRequest {
  return { protocol: adapter.protocol, baseUrl: 'https://provider.test/v1', apiKey: 'TEST_TOKEN', modelId: 'test-model',
    systemPrompt: 'Test', messages: [{ role: 'user', content: 'Test' }], stream: true, signal, idempotencyKey: 'test-stream-watchdog' };
}
function fixture() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  return { fetchImpl, write: (text: string) => writer.enqueue(new TextEncoder().encode(text)), close: () => writer.close() };
}

afterEach(() => vi.useRealTimers());
for (const provider of providers) describe(provider.name + ' stream deadlines', () => {
  it('continues for more than five minutes when SSE heartbeats keep arriving', async () => {
    vi.useFakeTimers();
    const stream = fixture();
    const adapter = provider.make(stream.fetchImpl);
    const result = collect(adapter.call(request(adapter)));
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(120_001);
      expect(stream.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(false);
      stream.write(': keepalive\n\n');
    }
    stream.write(provider.finish);
    stream.close();
    const events = await result;
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.some((event) => event.type === 'finished')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a timeout immediately when the provider stops sending bytes', async () => {
    vi.useFakeTimers();
    const stream = fixture();
    const adapter = provider.make(stream.fetchImpl, 25);
    const result = collect(adapter.call(request(adapter)));
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toContainEqual(expect.objectContaining({ type: 'error', failureClass: 'timeout' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can be manually stopped even if a mock provider does not honor the abort signal', async () => {
    const stream = fixture();
    const adapter = provider.make(stream.fetchImpl, null);
    const stop = new AbortController();
    const result = collect(adapter.call(request(adapter, stop.signal)));
    await Promise.resolve();
    stop.abort();
    expect(await result).toContainEqual(expect.objectContaining({ type: 'error', failureClass: 'acceptance' }));
  });
});
