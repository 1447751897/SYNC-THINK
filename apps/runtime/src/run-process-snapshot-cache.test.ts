import { describe, expect, it } from 'vitest';
import type { RunProcessView } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';
import { RunProcessSnapshotCache } from './run-process-snapshot-cache.js';

const cursor = { sequence: 1, eventId: 'event' };
const snapshot = (runId: string, padding = '') => ({
  cursor,
  process: {
    runId: runId as RunId,
    steps: [],
    fileChanges: [],
    running: false,
    doneCount: 0,
    errorCount: 0,
    modelId: padding,
  } as RunProcessView,
});
describe('Worker process snapshot cache', () => {
  it('bounds snapshot count and refreshes least-recently-used order', () => {
    const cache = new RunProcessSnapshotCache(10000, 2);
    cache.set('one' as RunId, snapshot('one'));
    cache.set('two' as RunId, snapshot('two'));
    expect(cache.get('one' as RunId, cursor)).toBeTruthy();
    cache.set('three' as RunId, snapshot('three'));
    expect(cache.get('two' as RunId, cursor)).toBeUndefined();
    expect(cache.get('one' as RunId, cursor)).toBeTruthy();
  });
  it('rejects snapshots beyond the JSON byte budget and invalidates a changed cursor', () => {
    const cache = new RunProcessSnapshotCache(400, 8);
    cache.set('one' as RunId, snapshot('one', 'x'.repeat(500)));
    expect(cache.get('one' as RunId, cursor)).toBeUndefined();
    cache.set('one' as RunId, snapshot('one'));
    expect(cache.get('one' as RunId, { sequence: 2, eventId: 'changed' })).toBeUndefined();
    expect(cache.get('one' as RunId, cursor)).toBeUndefined();
  });
  it('evicts by combined byte budget rather than only per-entry size', () => {
    const size = Buffer.byteLength(JSON.stringify(snapshot('one').process));
    const cache = new RunProcessSnapshotCache(size * 2 - 1, 8);
    cache.set('one' as RunId, snapshot('one'));
    cache.set('two' as RunId, snapshot('two'));
    expect(cache.get('one' as RunId, cursor)).toBeUndefined();
    expect(cache.get('two' as RunId, cursor)).toBeTruthy();
  });
});
