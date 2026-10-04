import { describe, expect, it } from 'vitest';
import { CompactionJobJournal } from './compaction-job-journal.js';
const started = {
  type: 'context.compaction_started',
  payload: {
    threadId: 't',
    operationId: 'op',
    conversationId: 'c',
    taskId: 'task',
    ownerId: 'owner',
    leaseExpiresAt: 100000,
    modelBinding: 'route',
    sourceFingerprint: 'a'.repeat(64),
    boundaryFingerprint: 'b'.repeat(64),
    coveredThroughMessageSequence: 3,
  },
};
describe('durable asynchronous compaction jobs', () => {
  it('replays a selected span and fences stale terminal receipts', () => {
    const journal = new CompactionJobJournal();
    journal.apply(started);
    const recovered = new CompactionJobJournal();
    recovered.restore(journal.snapshot());
    expect(recovered.pending()).toHaveLength(1);
    expect(recovered.owns('t', 'op', 'owner', 100)).toBe(true);
    expect(recovered.owns('t', 'op', 'owner', 100001)).toBe(false);
    recovered.apply({
      type: 'context.compaction_failed',
      payload: { threadId: 't', operationId: 'stale' },
    });
    expect(recovered.pending()).toHaveLength(1);
    recovered.apply({ type: 'context.compacted', payload: { threadId: 't', operationId: 'op' } });
    expect(recovered.pending()).toHaveLength(0);
  });
  it('stages checkpoint state without committing before the event transaction', () => {
    const journal = new CompactionJobJournal();
    journal.apply(started);
    const staged = journal.stage([
      { type: 'context.compacted', payload: { threadId: 't', operationId: 'op' } },
    ]);
    expect(staged).toEqual([]);
    expect(journal.pending()).toHaveLength(1);
  });
  it('ignores malformed and legacy job records instead of manufacturing an active lease', () => {
    const journal = new CompactionJobJournal();
    journal.restore([{ ...started.payload, leaseExpiresAt: NaN }]);
    journal.apply({
      type: 'context.compaction_started',
      payload: { threadId: 't', operationId: 'old' },
    });
    expect(journal.pending()).toEqual([]);
  });
});
