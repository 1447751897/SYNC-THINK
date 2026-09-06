import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteUnitOfWork,
  type EventDraft,
  type EventDraftBatch,
} from '@sync-think/storage';
import type { Event, RunId, TaskId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import {
  applyDemoRunEvent,
  createDemoRun,
  parseDemoRuns,
  serializeDemoRun,
  type DemoRunState,
} from './demo-run.js';

type Connection = Awaited<ReturnType<typeof openDatabaseAsync>>;
type RuntimeProbe = {
  demoRuns: Map<string, DemoRunState>;
  runInUnitOfWork<T>(operation: () => T): T;
  commitProjectedEvents(
    events: EventDraftBatch,
    versions: ReadonlyMap<string, number>,
    runs: ReadonlyMap<string, DemoRunState>,
  ): Event[];
};
const resources: Array<{ directory: string; connection: Connection; runtimes: Runtime[] }> = [];
const runId = 'native-persistence-run' as RunId;
const checkpointRunId = 'native-persistence-checkpoint' as RunId;
const taskId = 'native-persistence-task' as TaskId;
const initialText = '完整原生输出🙂\n'.repeat(4000);

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    for (const runtime of resource.runtimes) await runtime.stop();
    if (resource.connection.raw.open) resource.connection.raw.close();
    const resolved = realpathSync(resource.directory);
    if (
      lstatSync(resource.directory).isSymbolicLink() ||
      dirname(resolved) !== realpathSync(tmpdir()) ||
      !basename(resolved).startsWith('sync-think-native-state-')
    ) {
      throw new Error('Unexpected test cleanup path');
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

function state(id = runId): DemoRunState {
  return {
    ...createDemoRun(id, `thread-${id}`, 'Restore the exact native state', {
      modelId: 'model-a',
      kernelId: 'native',
    }),
    assistantText: initialText,
    assistantTimeline: [
      {
        id: 'answer',
        sequence: 0,
        kind: 'text',
        phase: 'final_answer',
        status: 'streaming',
        text: initialText,
      },
    ],
  };
}

function draft(
  value: DemoRunState,
  id: string,
  type = 'provider.usage',
  payload: Record<string, unknown> = {},
): EventDraft {
  return {
    id,
    workspaceId: 'workspace-native-persistence',
    taskId,
    runId: value.runId,
    category: type.startsWith('run.') ? 'run' : type.startsWith('tool.') ? 'tool' : 'provider',
    type,
    occurredAt: '2026-09-05T12:00:00.000Z',
    payload: {
      threadId: value.threadId,
      tokensIn: 1,
      tokensOut: 2,
      run: serializeDemoRun(value),
      ...payload,
    },
  } as unknown as EventDraft;
}

function normalized(value: DemoRunState): DemoRunState {
  return parseDemoRuns([serializeDemoRun(value)])[0]!;
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-native-state-'));
  const dbPath = join(directory, 'state.db');
  await runMigrations(dbPath);
  const resource = {
    directory,
    connection: await openDatabaseAsync({ path: dbPath }),
    runtimes: [] as Runtime[],
  };
  resources.push(resource);
  let store = new SqliteEventCheckpointStore(resource.connection.raw);
  const open = () => {
    const runtime = new Runtime({
      installId: 'native-state-test',
      allowNoToken: true,
      stateStore: store,
      checkpointRunId,
      unitOfWork: new SqliteUnitOfWork(resource.connection.raw),
    });
    resource.runtimes.push(runtime);
    return runtime as unknown as RuntimeProbe;
  };
  let runtime = open();
  return {
    get connection() {
      return resource.connection;
    },
    get store() {
      return store;
    },
    get runtime() {
      return runtime;
    },
    commit(
      value: DemoRunState,
      id: string,
      type?: string,
      payload?: Record<string, unknown>,
      runs = new Map([[value.runId, value]]),
    ) {
      return runtime.commitProjectedEvents([draft(value, id, type, payload)], new Map(), runs)[0]!;
    },
    async restart() {
      for (const previous of resource.runtimes.splice(0)) await previous.stop();
      resource.connection.raw.close();
      resource.connection = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
      store = new SqliteEventCheckpointStore(resource.connection.raw);
      runtime = open();
      return runtime;
    },
    open,
  };
}

describe('native run incremental state through the Runtime and file SQLite', () => {
  it('restores exact state across checkpoint 128, model fallback, connection close and a fresh Runtime', async () => {
    const test = await fixture();
    let current = state();
    const events: Event[] = [];
    let originalPayloadBytes = 0;
    for (let sequence = 1; sequence <= 132; sequence += 1) {
      current = {
        ...current,
        assistantText: current.assistantText + `追加${sequence}🙂`,
        nextAdapterEventIndex: sequence,
        modelId: sequence >= 90 ? 'model-b' : 'model-a',
        attemptedModelIds: sequence >= 90 ? ['model-a', 'model-b'] : ['model-a'],
        assistantTimeline: [
          {
            ...current.assistantTimeline![0],
            text: current.assistantText + `追加${sequence}🙂`,
          } as NonNullable<DemoRunState['assistantTimeline']>[number],
        ],
      };
      const type =
        sequence === 1 ? 'run.started' : sequence === 90 ? 'run.model_fallback' : 'provider.usage';
      originalPayloadBytes += Buffer.byteLength(
        JSON.stringify(draft(current, `event-${sequence}`, type).payload),
      );
      events.push(test.commit(current, `event-${sequence}`, type));
    }
    expect(events[0].payload.runStateDelta).toBeUndefined();
    expect(events[89].payload.runStateDelta).toBeDefined();
    expect(events[127].payload.runStateDelta).toBeDefined();
    expect(events[128].payload.runStateDelta).toBeUndefined();
    expect(events[129].payload.runStateDelta).toBeDefined();
    const checkpoint = test.store.loadLatestCheckpoint(checkpointRunId)!;
    expect(checkpoint.lastEventSequence).toBe(128);
    const allReplayed = new Map<string, DemoRunState>();
    for (const event of test.store.listAllEvents(0)) applyDemoRunEvent(allReplayed, event);
    expect(allReplayed.get(runId)).toEqual(normalized(current));
    const stored = test.connection.raw
      .prepare('SELECT sum(length(CAST(payload_json AS BLOB))) AS bytes FROM event')
      .get() as { bytes: number };
    const checkpointBytes = Buffer.byteLength(JSON.stringify(checkpoint.state));
    expect(stored.bytes + checkpointBytes).toBeLessThan(
      (originalPayloadBytes + checkpointBytes) / 10,
    );
    expect((await test.restart()).demoRuns.get(runId)).toEqual(normalized(current));
    const next = { ...current, assistantText: current.assistantText + 'after restart' };
    expect(test.commit(next, 'after-restart').payload.runStateDelta).toBeUndefined();
    expect((await test.restart()).demoRuns.get(runId)).toEqual(normalized(next));
  });

  it('rolls back an event or checkpoint SQL failure without advancing the delta baseline', async () => {
    const test = await fixture();
    const initial = state();
    test.commit(initial, 'start', 'run.started');
    test.connection.raw.exec(
      "CREATE TRIGGER fail_event BEFORE INSERT ON event WHEN NEW.id = 'rejected' BEGIN SELECT RAISE(ABORT, 'fixture-event-failure'); END",
    );
    expect(() =>
      test.commit({ ...initial, assistantText: initialText + 'lost' }, 'rejected'),
    ).toThrow('fixture-event-failure');
    expect(test.store.getLatestEventSequence()).toBe(1);
    test.connection.raw.exec('DROP TRIGGER fail_event');
    for (let sequence = 2; sequence <= 127; sequence += 1)
      test.commit({ ...initial, nextAdapterEventIndex: sequence }, `event-${sequence}`);
    test.connection.raw.exec(
      "CREATE TRIGGER fail_checkpoint BEFORE INSERT ON checkpoint BEGIN SELECT RAISE(ABORT, 'fixture-checkpoint-failure'); END",
    );
    expect(() =>
      test.commit(
        { ...initial, assistantText: initialText + 'failed checkpoint' },
        'failed-checkpoint',
      ),
    ).toThrow('fixture-checkpoint-failure');
    expect(test.store.getLatestEventSequence()).toBe(127);
    expect(test.store.loadLatestCheckpoint(checkpointRunId)).toBeUndefined();
    test.connection.raw.exec('DROP TRIGGER fail_checkpoint');
    const retried = {
      ...initial,
      assistantText: initialText + 'committed retry',
      nextAdapterEventIndex: 128,
    };
    const committed = test.commit(retried, 'retry');
    expect(committed.sequence).toBe(128);
    expect(committed.payload.runStateDelta).toBeDefined();
    expect((await test.restart()).demoRuns.get(runId)).toEqual(normalized(retried));
    const replayed = new Map<string, DemoRunState>();
    for (const event of test.store.listAllEvents(0)) applyDemoRunEvent(replayed, event);
    expect(replayed.get(runId)).toEqual(normalized(retried));
  });

  it('restores the journal and checkpoint cursor after an outer unit-of-work rollback', async () => {
    const test = await fixture();
    const initial = state();
    test.commit(initial, 'start', 'run.started');
    expect(() =>
      test.runtime.runInUnitOfWork(() => {
        test.commit({ ...initial, assistantText: initialText + 'outer rollback' }, 'rolled-back');
        throw new Error('outer transaction failed');
      }),
    ).toThrow('outer transaction failed');
    const retried = { ...initial, assistantText: initialText + 'retry succeeds' };
    const next = test.commit(retried, 'retry');
    const replayed = new Map([[runId, normalized(initial)]]);
    applyDemoRunEvent(replayed, next);
    expect(replayed.get(runId)).toEqual(normalized(retried));
    for (let sequence = 3; sequence <= 127; sequence += 1)
      test.commit(retried, `event-${sequence}`);
    expect(() =>
      test.runtime.runInUnitOfWork(() => {
        test.commit(
          { ...retried, assistantText: initialText + 'checkpoint rollback' },
          'rolled-back-checkpoint',
        );
        throw new Error('outer checkpoint failed');
      }),
    ).toThrow('outer checkpoint failed');
    expect(test.store.getLatestEventSequence()).toBe(127);
    expect(test.store.loadLatestCheckpoint(checkpointRunId)).toBeUndefined();
    expect(test.commit(retried, 'checkpoint-retry').payload.runStateDelta).toBeDefined();
    expect(test.store.loadLatestCheckpoint(checkpointRunId)?.lastEventSequence).toBe(128);
    expect((await test.restart()).demoRuns.get(runId)).toEqual(normalized(retried));
  });

  it('resets every run baseline when another run causes a checkpoint with transient text', async () => {
    const test = await fixture();
    const first = state();
    const second = state('other-native-run' as RunId);
    test.commit(first, 'first', 'run.started');
    test.commit(second, 'second', 'run.started');
    const transientSecond = { ...second, assistantText: initialText + 'not in the event log yet' };
    for (let sequence = 3; sequence <= 128; sequence += 1) {
      test.commit(
        { ...first, nextAdapterEventIndex: sequence },
        `first-${sequence}`,
        'provider.usage',
        {},
        new Map([
          [first.runId, first],
          [second.runId, transientSecond],
        ]),
      );
    }
    const next = { ...second, assistantText: initialText + 'next durable value' };
    expect(test.commit(next, 'other-after-checkpoint').payload.runStateDelta).toBeUndefined();
    const final = { ...next, assistantText: next.assistantText + 'tail' };
    expect(test.commit(final, 'other-delta').payload.runStateDelta).toBeDefined();
    expect((await test.restart()).demoRuns.get(second.runId)).toEqual(normalized(final));
    const allReplayed = new Map<string, DemoRunState>();
    for (const event of test.store.listAllEvents(0)) applyDemoRunEvent(allReplayed, event);
    expect(allReplayed.get(second.runId)).toEqual(normalized(final));
  });

  it('rejects corrupt persisted deltas during actual Runtime restoration', async () => {
    const test = await fixture();
    const initial = state();
    test.commit(initial, 'full', 'run.started');
    test.commit({ ...initial, assistantText: initialText + 'tail' }, 'delta');
    test.connection.raw
      .prepare(
        "UPDATE event SET payload_json = json_set(payload_json, '$.runStateDelta.resultHash', ?) WHERE id = 'delta'",
      )
      .run('0'.repeat(64));
    expect(() => test.open()).toThrow('run-state.result-mismatch');
  });

  it('keeps native tasks, process metadata and approvals readable without leaking the replay delta', async () => {
    const test = await fixture();
    const initial = state();
    test.commit(initial, 'full', 'run.started');
    const current = { ...initial, assistantText: initialText + 'changed' };
    const request = test.commit(current, 'task-request', 'tool.requested', {
      toolCall: {
        id: 'plan-call',
        name: 'TodoWrite',
        argumentsJson: '{"todos":[{"content":"详细任务","status":"pending"}]}',
      },
    });
    const approval = test.commit(current, 'approval-request', 'tool.approval_requested', {
      approvalId: 'approval-a',
    });
    expect(request.payload.runStateDelta).toBeDefined();
    expect(approval.payload.runStateDelta).toBeDefined();
    const process = test.store.listRunProcessEvents(runId);
    expect(process.find((event) => event.id === request.id)?.payload.run).toMatchObject({
      runId,
      threadId: current.threadId,
      modelId: current.modelId,
    });
    const tasks = test.store.listTaskPlanEvents(taskId);
    expect(tasks.some((event) => event.id === request.id)).toBe(true);
    const approvals = test.store.listToolApprovalEvents({ threadId: current.threadId });
    expect(approvals.map((event) => event.payload.approvalId)).toEqual(['approval-a']);
    for (const event of [...process, ...tasks, ...approvals]) {
      expect(event.payload.runStateDelta).toBeUndefined();
      expect(JSON.stringify(event.payload)).not.toContain(initialText);
    }
    expect((await test.restart()).demoRuns.get(runId)).toEqual(normalized(current));
  });
});
