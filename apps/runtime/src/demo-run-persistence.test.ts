import { describe, expect, it } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import type { EventDraft, EventDraftBatch } from '@sync-think/storage';
import {
  applyDemoRunEvent,
  createDemoRun,
  parseDemoRuns,
  serializeDemoRun,
  type DemoRunState,
} from './demo-run.js';
import { DemoRunPersistenceJournal } from './demo-run-persistence.js';

const runId = 'incremental-run' as RunId;
const largeText = '完整状态🙂'.repeat(10000);
function run(): DemoRunState {
  return {
    ...createDemoRun(runId, 'incremental-thread', 'Keep the full output', { modelId: 'model-a' }),
    assistantText: largeText,
    reasoningText: '推理摘要'.repeat(1000),
    assistantTimeline: [
      {
        id: 'answer',
        sequence: 0,
        kind: 'text',
        text: largeText,
        phase: 'final_answer',
        status: 'streaming',
      },
    ],
  };
}
function draft(state: DemoRunState, id = 'event-a', type = 'provider.usage'): EventDraft {
  return {
    id,
    workspaceId: 'workspace-a',
    runId,
    category: 'provider',
    type,
    occurredAt: '2026-09-05T11:00:00Z',
    payload: { threadId: state.threadId, run: serializeDemoRun(state), tokensIn: 1, tokensOut: 2 },
  } as unknown as EventDraft;
}
function event(value: EventDraft, sequence: number): Event {
  return { ...value, sequence };
}

describe('committed native run snapshot journal', () => {
  it('writes the first full snapshot, then restores exact fallback and cumulative text from compact events', () => {
    const journal = new DemoRunPersistenceJournal();
    const initial = run();
    const first = journal.stage([draft(initial, 'start', 'run.started')]);
    expect(first.events[0].payload.runStateDelta).toBeUndefined();
    first.commit(false);
    const next = {
      ...initial,
      assistantText: largeText + '追加',
      modelId: 'model-b',
      providerModelId: 'provider-b',
      nextAdapterEventIndex: 2,
      attemptedModelIds: ['model-a', 'model-b'],
    };
    const second = journal.stage([draft(next, 'fallback', 'run.model_fallback')]);
    expect(second.events[0].payload.runStateDelta).toBeDefined();
    expect(JSON.stringify(second.events).length).toBeLessThan(5000);
    expect(second.events[0].payload.run).toMatchObject({
      runId,
      threadId: initial.threadId,
      modelId: 'model-b',
      providerModelId: 'provider-b',
    });
    const restored = new Map<string, DemoRunState>();
    applyDemoRunEvent(restored, event(first.events[0], 1));
    applyDemoRunEvent(restored, event(second.events[0], 2));
    expect(restored.get(runId)).toEqual(parseDemoRuns([serializeDemoRun(next)])[0]);
  });

  it('does not advance the baseline after a failed write', () => {
    const journal = new DemoRunPersistenceJournal();
    const initial = run();
    journal.stage([draft(initial)]).commit(false);
    const failed = journal.stage([
      draft({ ...initial, assistantText: largeText + 'not committed' }, 'failed'),
    ]);
    expect(failed.events[0].payload.runStateDelta).toBeDefined();
    const retried = journal.stage([
      draft({ ...initial, assistantText: largeText + 'committed retry' }, 'retry'),
    ]);
    const restored = new Map([[runId, parseDemoRuns([initial])[0]!]]);
    applyDemoRunEvent(restored, event(retried.events[0], 2));
    expect(restored.get(runId)?.assistantText).toBe(largeText + 'committed retry');
    retried.commit(false);
    expect(() => failed.commit(false)).toThrow('run-state.stale-stage');
  });

  it('resets all baselines after a checkpoint so independently captured transient state cannot mismatch the next event', () => {
    const journal = new DemoRunPersistenceJournal();
    const initial = run();
    journal.stage([draft(initial)]).commit(true);
    const next = { ...initial, assistantText: largeText + 'new durable text' };
    const afterCheckpoint = journal.stage([draft(next)]);
    expect(afterCheckpoint.events[0].payload.runStateDelta).toBeUndefined();
    const restored = new Map([
      [runId, { ...initial, assistantText: 'checkpoint-only transient state' }],
    ]);
    applyDemoRunEvent(restored, event(afterCheckpoint.events[0], 2));
    expect(restored.get(runId)?.assistantText).toBe(next.assistantText);
  });

  it('handles several state events atomically and releases a terminal run baseline', () => {
    const journal = new DemoRunPersistenceJournal();
    const initial = run();
    const next = { ...initial, assistantText: largeText + 'tail' };
    const staged = journal.stage([
      draft(initial, 'first'),
      draft(next, 'second'),
    ] as EventDraftBatch);
    expect(staged.events[0].payload.runStateDelta).toBeUndefined();
    expect(staged.events[1].payload.runStateDelta).toBeDefined();
    staged.commit(false);
    journal.forget(runId);
    expect(journal.stage([draft(next)]).events[0].payload.runStateDelta).toBeUndefined();
  });

  it('rejects missing baselines and mismatched run identities instead of displaying partial restored state', () => {
    const journal = new DemoRunPersistenceJournal();
    const initial = run();
    journal.stage([draft(initial)]).commit(false);
    const next = journal.stage([draft({ ...initial, assistantText: largeText + 'tail' })]);
    expect(() => applyDemoRunEvent(new Map(), event(next.events[0], 2))).toThrow(
      'run-state.base-missing',
    );
    expect(() =>
      applyDemoRunEvent(new Map([['other-run', initial]]), {
        ...event(next.events[0], 2),
        runId: 'other-run' as RunId,
      }),
    ).toThrow('run-state.identity-mismatch');
  });
});
