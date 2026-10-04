import { expect, it } from 'vitest';
import type { RunProcessView } from '@sync-think/protocol';
import {
  ConversationDisplayCache,
  type CachedConversationDisplay,
} from './conversation-display-cache.js';

function snapshot(runId = 'active'): CachedConversationDisplay {
  return {
    threadId: 'thread',
    draft: { runId, text: 'visible answer', timestamp: '2026-10-04' },
    runProcesses: new Map(),
    lastTransientSequence: 7,
    lastDurableSequence: 11,
    pendingDisplayQueue: [],
  };
}
function process(runId: string): RunProcessView {
  return {
    runId: runId as RunProcessView['runId'],
    running: true,
    steps: [],
    fileChanges: [],
    doneCount: 0,
    errorCount: 0,
  } as RunProcessView;
}
it('keeps snapshots independent of component lifetime and isolates renderer hosts', () => {
  const cache = new ConversationDisplayCache();
  cache.write('conversation/task', snapshot());
  expect(cache.read('conversation/task')).toMatchObject({
    draft: { text: 'visible answer' },
    lastTransientSequence: 7,
    lastDurableSequence: 11,
  });
  expect(cache.read('conversation/replacement-task')).toBeUndefined();
  expect(new ConversationDisplayCache().read('conversation/task')).toBeUndefined();
  cache.clear();
  expect(cache.read('conversation/task')).toBeUndefined();
});
it('evicts the least recently used conversation at the configured capacity', () => {
  const cache = new ConversationDisplayCache(2);
  cache.write('a', snapshot());
  cache.write('b', snapshot());
  cache.read('a');
  cache.write('c', snapshot());
  expect(cache.read('b')).toBeUndefined();
  expect(cache.read('a')).toBeDefined();
});
it('bounds historical processes while retaining the current live process', () => {
  const cache = new ConversationDisplayCache(2, 2);
  const value = snapshot();
  const runProcesses = new Map(['active', 'old', 'recent'].map((runId) => [runId, process(runId)]));
  cache.write('conversation', { ...value, runProcesses });
  expect([...cache.read('conversation')!.runProcesses.keys()]).toEqual(['recent', 'active']);
  expect(runProcesses.size).toBe(3);
  runProcesses.clear();
  expect(cache.read('conversation')!.runProcesses.size).toBe(2);
});
it('retains queued display boundaries without sharing the mutable queue array', () => {
  const cache = new ConversationDisplayCache();
  const value = snapshot();
  const queue = [{ source: 'snapshot' as const, draft: value.draft, streamSequence: 8 }];
  cache.write('conversation', { ...value, pendingDisplayQueue: queue });
  queue.length = 0;
  expect(cache.read('conversation')!.pendingDisplayQueue).toHaveLength(1);
});
it('rejects invalid cache limits', () => {
  expect(() => new ConversationDisplayCache(0)).toThrow();
  expect(() => new ConversationDisplayCache(2, 0)).toThrow();
  expect(() => new ConversationDisplayCache(1.5)).toThrow();
});
