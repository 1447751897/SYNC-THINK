import { describe, expect, it } from 'vitest';
import { delegatedRunFromEvent, type Event, type RunId } from '@sync-think/shared';
import { createDemoRun, serializeDemoRun } from './demo-run.js';
import { DemoRunPersistenceJournal } from './demo-run-persistence.js';
import { reconcileDelegatedRecord, withDelegatedRunSnapshot } from './delegation-event.js';

const run = createDemoRun('child' as RunId, 'thread', 'review', {
  modelId: 'model',
  globalAgentId: 'reviewer',
  globalAgentName: 'Reviewer',
  delegationParentRunId: 'parent' as RunId,
});
function event(type: string): Event {
  return {
    id: 'event' as Event['id'],
    runId: run.runId,
    workspaceId: 'workspace' as Event['workspaceId'],
    sequence: 8,
    category: 'run',
    type,
    occurredAt: '2026-09-19T00:00:00Z',
    payload: { threadId: run.threadId },
  };
}

describe('delegation event facts', () => {
  it.each([
    ['run.started', undefined, 'running'],
    ['run.completed', undefined, 'completed'],
    ['run.failed', undefined, 'failed'],
    ['run.cancelled', undefined, 'cancelled'],
    ['run.cancelled', 'timed_out', 'timed_out'],
    ['run.failed', 'timed_out', 'timed_out'],
  ] as const)('captures %s with reason %s as %s', (type, reason, status) => {
    const facts = delegatedRunFromEvent(
      withDelegatedRunSnapshot(event(type), {
        ...run,
        assistantText: ' final report ',
        delegationTerminationReason: reason,
      }),
    );
    expect(facts).toMatchObject({
      childRunId: 'child',
      parentRunId: 'parent',
      threadId: 'thread',
      status,
      sequence: 8,
    });
    expect(facts?.result).toBe(status === 'running' ? undefined : 'final report');
  });

  it('captures exact tool count before delta compaction and survives rollback/retry', () => {
    const state = { ...run, assistantText: 'large'.repeat(10000) };
    const journal = new DemoRunPersistenceJournal();
    const make = () =>
      withDelegatedRunSnapshot(
        {
          ...event('provider.usage'),
          payload: { threadId: run.threadId, run: serializeDemoRun(state) },
        },
        state,
      );
    const first = journal.stage([make()]);
    first.commit(false);
    const second = journal.stage([make()]);
    expect(second.events[0].payload.runStateDelta).toBeDefined();
    expect(delegatedRunFromEvent({ ...second.events[0], sequence: 9 })).toMatchObject({
      parentRunId: 'parent',
      status: 'running',
      toolCount: 0,
    });
    // Failed persistence leaves the journal stage uncommitted.
    expect(journal.stage([make()]).events).toEqual(second.events);
  });

  it('uses the finalized payload text rather than a previous live answer', () => {
    const terminal = event('run.completed');
    terminal.payload.assistantText = 'canonical report';
    expect(
      delegatedRunFromEvent(
        withDelegatedRunSnapshot(terminal, {
          ...run,
          assistantText: 'stale report',
        }),
      )?.result,
    ).toBe('canonical report');
  });

  it('leaves nondelegated events unchanged', () => {
    const ordinary = event('provider.usage');
    expect(withDelegatedRunSnapshot(ordinary, { ...run, delegationParentRunId: undefined })).toBe(
      ordinary,
    );
  });

  it('repairs old terminal events and preserves a newer snapshot report', () => {
    const running = delegatedRunFromEvent(withDelegatedRunSnapshot(event('run.started'), run))!;
    const legacy = { ...event('run.cancelled'), sequence: 9 };
    expect(reconcileDelegatedRecord(running, [legacy], false)).toMatchObject({
      status: 'cancelled',
      sequence: 9,
    });
    const terminal = withDelegatedRunSnapshot(
      { ...event('run.completed'), sequence: 10 },
      {
        ...run,
        assistantText: 'complete report',
      },
    );
    expect(reconcileDelegatedRecord(running, [terminal], false)).toMatchObject({
      status: 'completed',
      sequence: 10,
      result: 'complete report',
    });
    expect(reconcileDelegatedRecord(running, [], true)).toEqual(running);
    expect(reconcileDelegatedRecord(running, [], false)).toMatchObject({
      status: 'failed',
      sequence: 8,
    });
  });
});
