import { describe, it, expect } from 'vitest';
import { FakeProvider } from './fake/fake-provider.js';
import { collect, textFromEvents } from './events.js';
import type { ProviderCallRequest } from './types.js';

function req(text: string, modelId = 'fake-mini'): ProviderCallRequest {
  return {
    protocol: 'openai-chat',
    baseUrl: 'https://fake.invalid/v1',
    modelId,
    apiKey: 'sk-test',
    idempotencyKey: 'fake-provider-test-key',
    signal: new AbortController().signal,
    messages: [{ role: 'user', content: text }],
    stream: true,
  };
}

describe('FakeProvider streaming', () => {
  it('emits usage, deltas, and stop', async () => {
    const p = new FakeProvider();
    const events = await collect(p.call(req('hello there')));
    expect(events[0].type).toBe('usage');
    const text = textFromEvents(events);
    expect(text).toContain('hello there');
    expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'stop' });
  });

  it('emits tool-call + tool-result when prompt starts with TOOL:', async () => {
    const p = new FakeProvider();
    const events = await collect(p.call(req('TOOL:weather Beijing')));
    expect(events.some((e) => e.type === 'tool-call')).toBe(true);
    expect(events.some((e) => e.type === 'tool-result')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'finished', reason: 'tool-requests' });
  });

  it('stops with an error after failAfter events', async () => {
    const p = new FakeProvider({ failAfter: 1 });
    const events = await collect(p.call(req('hello world three four')));
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('terminates promptly with an acceptance error when the signal aborts', async () => {
    const controller = new AbortController();
    const p = new FakeProvider({ tickMs: 10 });
    const iter = p.call({ ...req('a long sentence that produces many words'), signal: controller.signal });
    // Consume in the background, abort mid-stream after the first delta tick.
    const collected: Array<{ type: string }> = [];
    const consume = (async () => {
      for await (const event of iter) collected.push(event);
    })();
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    await consume;
    expect(collected.length).toBeGreaterThan(0);
    expect(collected.at(-1)).toMatchObject({ type: 'error', failureClass: 'acceptance' });
    expect(collected.some((event) => event.type === 'finished')).toBe(false);
  });

  it('never leaks the apiKey into any emitted event', async () => {
    const secret = 'sk-LIVE_SECRET_FOR_ADAPTER_LEAK_001';
    const p = new FakeProvider();
    const events = await collect(
      p.call({ ...req('anything'), apiKey: secret }),
    );
    const dump = JSON.stringify(events);
    expect(dump).not.toContain(secret);
    expect(dump).not.toContain('sk-LIVE_SECRET');
  });

  it('discoverModels returns a stable fake list', async () => {
    const p = new FakeProvider();
    const models = await p.discoverModels();
    expect(models).toEqual(['fake-mini', 'fake-large', 'fake-tool-use']);
  });
});
