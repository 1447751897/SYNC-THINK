import { describe, expect, it, vi } from 'vitest';
import type {
  ConversationReadContentPayload,
  ConversationReadContentResponse,
} from '@sync-think/protocol';
import { RunProcessHistoryRequestPool } from './run-process-history-loader.js';
import { DeferredContentReader } from './deferred-content-reader.js';

const payload = {
  conversationId: 'conversation-a',
  reference: { source: 'event', id: 'event-a', path: ['result'] },
} as ConversationReadContentPayload;
const response: ConversationReadContentResponse = {
  content: {
    text: 'exact content',
    offset: 0,
    utf16Length: 13,
    utf8Bytes: 13,
    version: 'a'.repeat(64),
    format: 'text',
  },
};

describe('foreground deferred content request scheduling', () => {
  it('shares real in-flight slots and gives a user content request priority over background history', async () => {
    const pool = new RunProcessHistoryRequestPool();
    for (const id of ['a', 'b', 'c']) pool.start(id);
    pool.attach({}, () => {
      if (pool.hasCapacity) pool.start('background-next');
    });
    const load = vi.fn(async () => response);
    const reader = new DeferredContentReader(load, pool);
    const pending = reader.read(payload);
    expect(load).not.toHaveBeenCalled();
    pool.finish('a');
    await expect(pending).resolves.toEqual(response);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cancels queued work and retains a dispatched slot until the actual request settles', async () => {
    const pool = new RunProcessHistoryRequestPool();
    let resolveRequest!: (response: ConversationReadContentResponse) => void;
    const load = vi.fn(
      () =>
        new Promise<ConversationReadContentResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const reader = new DeferredContentReader(load, pool);
    pool.start('a');
    pool.start('b');
    const firstAbort = new AbortController();
    const first = reader.read(payload, firstAbort.signal);
    await Promise.resolve();
    expect(pool.hasCapacity).toBe(false);
    firstAbort.abort();
    await expect(first).rejects.toThrow('content.cancelled');
    expect(pool.hasCapacity).toBe(false);
    const queuedAbort = new AbortController();
    const queued = reader.read(payload, queuedAbort.signal);
    queuedAbort.abort();
    await expect(queued).rejects.toThrow('content.cancelled');
    expect(load).toHaveBeenCalledTimes(1);
    resolveRequest(response);
    await vi.waitFor(() => expect(pool.hasCapacity).toBe(true));
  });

  it('rejects malformed or mixed-version chunks and bounds the waiting queue', async () => {
    const reader = new DeferredContentReader(
      async () => ({ content: { ...response.content, nextOffset: 0 } }),
      new RunProcessHistoryRequestPool(),
    );
    await expect(reader.read(payload)).rejects.toThrow('content.invalid-response');
    const versioned = new DeferredContentReader(
      async () => response,
      new RunProcessHistoryRequestPool(),
    );
    await expect(versioned.read({ ...payload, version: 'b'.repeat(64) })).rejects.toThrow(
      'content.version-changed',
    );
    const pool = new RunProcessHistoryRequestPool();
    pool.start('a');
    pool.start('b');
    pool.start('c');
    const bounded = new DeferredContentReader(async () => response, pool, 1);
    const controller = new AbortController();
    const first = bounded.read(payload, controller.signal);
    await expect(bounded.read(payload)).rejects.toThrow('content.busy');
    controller.abort();
    await expect(first).rejects.toThrow('content.cancelled');
  });
});
