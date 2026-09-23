import { describe, expect, it, vi } from 'vitest';
import type { RunId } from '@sync-think/shared';
import { PendingAskRegistry, type PendingAskEntry } from './pending-ask-registry.js';

function entry(askId: string, overrides: Partial<PendingAskEntry> = {}): PendingAskEntry {
  return {
    askId,
    runId: 'run-a' as RunId,
    threadId: 'thread-a',
    questions: [],
    createdAt: '2026-09-20T00:00:00.000Z',
    resolve: vi.fn(),
    onAbort: vi.fn(),
    ...overrides,
  };
}

describe('pending ask registry', () => {
  it('takes a registered ask exactly once', () => {
    const registry = new PendingAskRegistry();
    const pending = entry('ask-a');
    registry.register(pending);

    expect(registry.take('ask-a')).toBe(pending);
    expect(registry.take('ask-a')).toBeUndefined();
  });

  it('returns the latest ask for a thread', () => {
    const registry = new PendingAskRegistry();
    registry.register(entry('ask-old'));
    registry.register(
      entry('ask-other', {
        threadId: 'thread-b',
        createdAt: '2026-09-20T00:02:00.000Z',
      }),
    );
    registry.register(entry('ask-new', { createdAt: '2026-09-20T00:01:00.000Z' }));

    expect(registry.latestForThread('thread-a')?.askId).toBe('ask-new');
    expect(registry.latestForThread('missing')).toBeUndefined();
  });

  it('aborts and removes only asks owned by the run', () => {
    const registry = new PendingAskRegistry();
    const first = entry('ask-a');
    const second = entry('ask-b');
    const other = entry('ask-c', { runId: 'run-b' as RunId });
    registry.register(first);
    registry.register(second);
    registry.register(other);

    registry.abortRun('run-a' as RunId);

    expect(first.onAbort).toHaveBeenCalledOnce();
    expect(second.onAbort).toHaveBeenCalledOnce();
    expect(other.onAbort).not.toHaveBeenCalled();
    expect(registry.take('ask-a')).toBeUndefined();
    expect(registry.take('ask-c')).toBe(other);
  });

  it('rejects duplicate ask identities', () => {
    const registry = new PendingAskRegistry();
    registry.register(entry('ask-a'));

    expect(() => registry.register(entry('ask-a'))).toThrow(
      'Pending ask already registered: ask-a',
    );
  });
});
