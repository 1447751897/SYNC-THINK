import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteArtifactStore,
  SqliteOrchestrationStore,
  type BetterSQLite3Raw,
} from '@sync-think/storage';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type {
  AgentVersionId,
  PlanStepDraft,
  StepId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import { openPersistentRuntime } from '../src/persistence.js';
import { Scheduler } from '../src/orchestration/scheduler.js';
import type { StepExecutionContext, StepExecutor } from '../src/orchestration/step-executor.js';

const workspaceId = 'workspace-recovery' as WorkspaceId;
const taskId = 'task-recovery' as TaskId;
const agentVersionId = 'agent-version-recovery' as AgentVersionId;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return { dir, dbPath: join(dir, 'sync-think.db') };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function seed(raw: BetterSQLite3Raw): void {
  raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES (?, ?, 'Recovery', 't0', 't0')`,
    )
    .run(workspaceId, 'D:\\projects\\recovery');
  raw
    .prepare(
      `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, 'Recovery', 'Recover DAG', 'active', 'automatic', '[]', 0, 't0', 't0')`,
    )
    .run(taskId, workspaceId);
  raw
    .prepare(`INSERT INTO thread (id, task_id, created_at) VALUES ('thread-recovery', ?, 't0')`)
    .run(taskId);
  raw
    .prepare(
      `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, created_at
     ) VALUES (?, 'agent-recovery', 1, 'Recovery worker', 'worker', '', '', '',
       'model-recovery', 'group-recovery', NULL, 1, '[]', 'task', '[]', '[]',
       NULL, 'request', 't0')`,
    )
    .run(agentVersionId);
}

function step(id: string): PlanStepDraft {
  return {
    id: id as StepId,
    title: id,
    instructions: id,
    agentVersionId,
    dependsOn: [],
  };
}

function approve(store: SqliteOrchestrationStore, id: string) {
  const draft = store.createPlanDraft({ taskId, title: id, steps: [step(id)], now: 't0' });
  return store.approvePlan({ planId: draft.planId, revision: 1, now: 't0' });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for recovery');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('orchestration crash-window recovery', () => {
  it('retries a persisted started intent that never reached the executor with the same Step ID and key', async () => {
    const { dbPath } = makeDbPath('sync-think-started-window-');
    await runMigrations(dbPath);
    const first = await openDatabaseAsync({ path: dbPath });
    seed(first.raw);
    const firstStore = new SqliteOrchestrationStore(first.raw);
    const graph = approve(firstStore, 'started-window');
    const claim = firstStore.claimReadySteps({
      runId: graph.run.id,
      stepIds: ['started-window' as StepId],
      ownerId: 'stopped-owner',
      leaseExpiresAt: '2026-07-12T00:01:00.000Z',
      now: '2026-07-12T00:00:00.000Z',
    });
    const stableKey = claim.claimedSteps[0]!.idempotencyKey!;
    first.raw.close();

    const second = await openDatabaseAsync({ path: dbPath });
    try {
      const contexts: StepExecutionContext[] = [];
      const scheduler = new Scheduler({
        store: new SqliteOrchestrationStore(second.raw),
        executor: {
          async execute(context) {
            contexts.push(context);
            return {};
          },
        },
      });
      await scheduler.recover(graph.run.id);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({
        idempotencyKey: stableKey,
        step: { id: 'started-window' },
      });
      expect(new SqliteOrchestrationStore(second.raw).getGraph(graph.run.id)!.run.state).toBe(
        'completed',
      );
    } finally {
      second.raw.close();
    }
  });

  it('reuses an externally completed idempotency key and commits one artifact and terminal event', async () => {
    const { dbPath } = makeDbPath('sync-think-completion-window-');
    await runMigrations(dbPath);
    const first = await openDatabaseAsync({ path: dbPath });
    seed(first.raw);
    const firstStore = new SqliteOrchestrationStore(first.raw);
    const graph = approve(firstStore, 'completion-window');
    const artifactStore = new SqliteArtifactStore(first.raw);
    const artifact = artifactStore.createArtifact({
      workspaceId,
      taskId,
      runId: graph.run.id,
      name: 'result.txt',
      now: 't0',
    });
    const claim = firstStore.claimReadySteps({
      runId: graph.run.id,
      stepIds: ['completion-window' as StepId],
      ownerId: 'stopped-owner',
      leaseExpiresAt: '2026-07-12T00:01:00.000Z',
      now: '2026-07-12T00:00:00.000Z',
    });
    const stableKey = claim.claimedSteps[0]!.idempotencyKey!;
    first.raw.exec(`
      CREATE TABLE fake_adapter_result (
        idempotency_key TEXT PRIMARY KEY,
        actual_effect_count INTEGER NOT NULL,
        result_json TEXT NOT NULL
      );
    `);
    first.raw
      .prepare(
        'INSERT INTO fake_adapter_result (idempotency_key, actual_effect_count, result_json) VALUES (?, 1, ?)',
      )
      .run(stableKey, JSON.stringify({ content: 'external result' }));
    first.raw.close();

    const second = await openDatabaseAsync({ path: dbPath });
    try {
      let adapterCalls = 0;
      const scheduler = new Scheduler({
        store: new SqliteOrchestrationStore(second.raw),
        executor: {
          async execute(context) {
            adapterCalls += 1;
            expect(context.idempotencyKey).toBe(stableKey);
            const cached = second.raw
              .prepare('SELECT result_json FROM fake_adapter_result WHERE idempotency_key = ?')
              .get(context.idempotencyKey) as { result_json: string };
            const result = JSON.parse(cached.result_json) as { content: string };
            return {
              outputVersions: [
                {
                  artifactId: artifact.id,
                  content: result.content,
                  mimeType: 'text/plain',
                  status: 'candidate',
                },
              ],
            };
          },
        },
      });
      await scheduler.recover(graph.run.id);
      await scheduler.recover(graph.run.id);
      expect(adapterCalls).toBe(1);
      expect(
        second.raw.prepare('SELECT actual_effect_count FROM fake_adapter_result').get(),
      ).toEqual({ actual_effect_count: 1 });
      expect(new SqliteArtifactStore(second.raw).listVersions(artifact.id)).toHaveLength(1);
      expect(
        second.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.completed'",
          )
          .get(graph.run.id),
      ).toEqual({ count: 1 });
    } finally {
      second.raw.close();
    }
  });
});

describe('Runtime orchestration startup recovery', () => {
  it('auto-schedules queued/running/reviewing/revising but leaves paused and terminal runs stopped', async () => {
    const { dir, dbPath } = makeDbPath('sync-think-runtime-recovery-');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    seed(setup.raw);
    const store = new SqliteOrchestrationStore(setup.raw);
    const queued = approve(store, 'queued-step');
    const running = approve(store, 'running-step');
    const reviewing = approve(store, 'reviewing-step');
    const revising = approve(store, 'revising-step');
    const paused = approve(store, 'paused-step');
    const terminal = approve(store, 'terminal-step');
    for (const graph of [running, reviewing, revising, paused, terminal]) {
      const claimed = store.claimReadySteps({
        runId: graph.run.id,
        stepIds: [graph.steps[0]!.id],
        ownerId: 'stopped-owner',
        leaseExpiresAt: '2026-07-12T00:01:00.000Z',
        now: '2026-07-12T00:00:00.000Z',
      });
      expect(claimed.claimedSteps).toHaveLength(1);
    }
    setup.raw.prepare("UPDATE run SET state = 'reviewing' WHERE id = ?").run(reviewing.run.id);
    setup.raw.prepare("UPDATE run SET state = 'revising' WHERE id = ?").run(revising.run.id);
    store.pauseRun(paused.run.id, 't2');
    store.completeStep({
      runId: terminal.run.id,
      stepId: terminal.steps[0]!.id,
      idempotencyKey: store.getGraph(terminal.run.id)!.steps[0]!.idempotencyKey!,
      ownerId: 'stopped-owner',
      executionAttempt: store.getGraph(terminal.run.id)!.steps[0]!.executionAttempt,
      now: '2026-07-12T00:00:01.000Z',
    });
    setup.raw.close();

    const executed: string[] = [];
    const executor: StepExecutor = {
      async execute(context) {
        executed.push(context.step.id);
        return {};
      },
    };
    const session = await openPersistentRuntime({
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      installId: `recovery-${randomBytes(5).toString('hex')}`,
      allowNoToken: true,
      stepExecutor: executor,
    });
    try {
      await session.runtime.start();
      await waitFor(() => executed.length === 4);
      expect(new Set(executed)).toEqual(
        new Set(['queued-step', 'running-step', 'reviewing-step', 'revising-step']),
      );
      expect(executed).not.toContain('paused-step');
      expect(executed).not.toContain('terminal-step');
    } finally {
      await session.close();
    }
  });

  it('recovers an expired gated target lease only after a post-restart resume', async () => {
    const { dir, dbPath } = makeDbPath('sync-think-runtime-resume-recovery-');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    seed(setup.raw);
    const setupStore = new SqliteOrchestrationStore(setup.raw);
    const graph = approve(setupStore, 'paused-gated-target');
    const gate = setupStore.createAcceptanceGate({
      id: 'gate-paused-gated-target' as never,
      runId: graph.run.id,
      targetStepId: graph.steps[0]!.id,
      reviewerAgentVersionId: agentVersionId,
      maxIterations: 1,
      onLimitReached: 'pause',
      criteria: [{ id: 'criterion-resume', description: 'Recovered output is complete' }],
      now: new Date().toISOString(),
    });
    const leaseExpiresAtMs = Date.now() + 1_000;
    const claimed = setupStore.claimReadySteps({
      runId: graph.run.id,
      stepIds: [graph.steps[0]!.id],
      ownerId: 'crashed-before-resume-owner',
      leaseExpiresAt: new Date(leaseExpiresAtMs).toISOString(),
      now: new Date().toISOString(),
    }).claimedSteps[0]!;
    expect(claimed).toMatchObject({ state: 'running', executionAttempt: 1 });
    const stableKey = claimed.idempotencyKey!;
    expect(setupStore.pauseRun(graph.run.id, new Date().toISOString()).run.state).toBe('paused');
    setup.raw.close();

    const targetEntered = deferred<StepExecutionContext>();
    const releaseTarget = deferred<void>();
    const contexts: StepExecutionContext[] = [];
    const executor: StepExecutor = {
      async execute(context) {
        contexts.push(context);
        if (!context.reviewContext) {
          targetEntered.resolve(context);
          await releaseTarget.promise;
          return {
            outputVersions: [{
              artifactName: 'recovered-target.txt',
              content: 'recovered gated output',
              mimeType: 'text/plain',
              status: 'candidate',
            }],
          };
        }
        if (context.reviewContext.kind !== 'reviewer') {
          throw new Error('Unexpected rework during accepted recovery');
        }
        return {
          reviewOutcome: {
            verdict: 'accept',
            explanation: 'Recovered target satisfies the exact Gate',
            criteria: context.reviewContext.criteria.map((criterion) => ({
              criterionId: criterion.id,
              verdict: 'pass',
              explanation: `Satisfied ${criterion.id}`,
            })),
            reviewedArtifactVersionIds: context.reviewContext.reviewedArtifactVersions.map(
              (version) => version.id,
            ),
          },
        };
      },
    };
    const installId = `resume-recovery-${randomBytes(5).toString('hex')}`;
    const session = await openPersistentRuntime({
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      installId,
      allowNoToken: true,
      stepExecutor: executor,
    });
    await session.runtime.start();
    const inspect = await openDatabaseAsync({ path: dbPath });
    const socket = connect(pipePathPortable(installId));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const reader = frameReader(socket);
    try {
      expect(Date.now()).toBeLessThan(leaseExpiresAtMs);
      expect(contexts).toEqual([]);
      await send(socket, reader, 'hello-resume-recovery', '__hello', {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: randomBytes(8).toString('hex'),
        features: ['run.resume'],
      });
      await new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, leaseExpiresAtMs - Date.now() + 25));
      });

      const scope = { workspaceId, taskId, runId: graph.run.id };
      expect(
        (await send(socket, reader, 'resume-expired-lease', 'run.resume', {
          ...scope,
          expectedTaskVersion: 0,
        })).payload,
      ).toMatchObject({ run: { state: 'running' }, taskVersion: 1 });
      await waitFor(() => contexts.some((context) => !context.reviewContext));
      const recoveredTarget = await targetEntered.promise;
      expect(recoveredTarget).toMatchObject({
        idempotencyKey: stableKey,
        step: {
          id: claimed.id,
          idempotencyKey: stableKey,
          executionAttempt: 2,
        },
      });

      expect(
        (await send(socket, reader, 'resume-current-replay', 'run.resume', {
          ...scope,
          expectedTaskVersion: 1,
        })).payload,
      ).toMatchObject({ run: { state: 'running' }, taskVersion: 1 });
      releaseTarget.resolve();
      await waitFor(
        () => new SqliteOrchestrationStore(inspect.raw).getGraph(graph.run.id)?.run.state === 'completed',
      );

      expect(contexts.filter((context) => !context.reviewContext)).toHaveLength(1);
      expect(contexts.filter((context) => context.reviewContext?.kind === 'reviewer')).toHaveLength(1);
      expect(new SqliteOrchestrationStore(inspect.raw).listReviewEvidence(gate.id)).toMatchObject([
        { iteration: 0, verdict: 'accept' },
      ]);
      expect(
        inspect.raw.prepare(
          "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.completed'",
        ).get(graph.run.id),
      ).toEqual({ count: 1 });
    } finally {
      releaseTarget.resolve();
      socket.destroy();
      await session.close();
      inspect.raw.close();
    }
  });

  it('shuts down the Scheduler and settles active recovery before closing SQLite', async () => {
    const { dir, dbPath } = makeDbPath('sync-think-runtime-shutdown-');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    seed(setup.raw);
    const graph = approve(new SqliteOrchestrationStore(setup.raw), 'shutdown-recovery');
    setup.raw.close();
    const entered = deferred<StepExecutionContext>();
    const session = await openPersistentRuntime({
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      installId: `shutdown-${randomBytes(5).toString('hex')}`,
      allowNoToken: true,
      stepExecutor: {
        execute(context) {
          entered.resolve(context);
          return new Promise((resolve) => {
            context.signal.addEventListener('abort', () => resolve({}), { once: true });
          });
        },
      },
    });
    await session.runtime.start();
    const context = await entered.promise;

    await session.close();
    expect(context.signal.aborted).toBe(true);
    const reopened = await openDatabaseAsync({ path: dbPath });
    try {
      expect(new SqliteOrchestrationStore(reopened.raw).getGraph(graph.run.id)!.steps[0]).toMatchObject({
        state: 'running',
        executionOwnerId: expect.any(String),
        leaseExpiresAt: expect.any(String),
      });
    } finally {
      reopened.raw.close();
    }
  });
});

function frameReader(socket: Socket) {
  const queued: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queued.push(frame);
    }
  });
  return {
    read(): Promise<Frame> {
      const frame = queued.shift();
      return frame ? Promise.resolve(frame) : new Promise((resolve) => waiters.push(resolve));
    },
  };
}

async function send(
  socket: Socket,
  reader: ReturnType<typeof frameReader>,
  id: string,
  type: string,
  payload: unknown,
): Promise<Frame> {
  const response = reader.read();
  socket.write(encodeFrame({ id, kind: 'request', type, payload }));
  return response;
}

describe('online plan approval scheduling', () => {
  it('starts a post-commit background drain and executes every DAG layer exactly once', async () => {
    const { dir, dbPath } = makeDbPath('sync-think-online-approve-');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    seed(setup.raw);
    setup.raw
      .prepare("UPDATE task SET participation_mode = 'collaboration' WHERE id = ?")
      .run(taskId);
    const setupStore = new SqliteOrchestrationStore(setup.raw);
    const draft = setupStore.createPlanDraft({
      taskId,
      title: 'Online approval',
      steps: [
        step('online-root'),
        { ...step('online-middle'), dependsOn: ['online-root' as StepId] },
        { ...step('online-leaf'), dependsOn: ['online-middle' as StepId] },
      ],
      now: 't0',
    });
    setup.raw.close();

    const executed: string[] = [];
    const installId = `online-approve-${randomBytes(5).toString('hex')}`;
    const session = await openPersistentRuntime({
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      installId,
      allowNoToken: true,
      stepExecutor: {
        async execute(context) {
          executed.push(context.step.id);
          return {};
        },
      },
    });
    await session.runtime.start();
    const inspect = await openDatabaseAsync({ path: dbPath });
    inspect.raw.exec(`
      CREATE TRIGGER fail_online_plan_approval
      BEFORE INSERT ON event WHEN NEW.type = 'plan.approved'
      BEGIN
        SELECT RAISE(ABORT, 'forced online approval rollback');
      END;
    `);
    const socket = connect(pipePathPortable(installId));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const reader = frameReader(socket);
    try {
      await send(socket, reader, 'hello-online-approve', '__hello', {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: randomBytes(8).toString('hex'),
        features: ['plan.approve'],
      });
      const failed = await send(socket, reader, 'approve-fails', 'plan.approve', {
        planId: draft.planId,
        revision: 1,
      });
      expect(failed.error).toMatchObject({ code: 'storage.write_failed' });
      expect(executed).toEqual([]);
      expect(inspect.raw.prepare('SELECT COUNT(*) AS count FROM run').get()).toEqual({ count: 0 });
      expect(inspect.raw.prepare('SELECT state FROM plan_revision WHERE id = ?').get(draft.id)).toEqual({
        state: 'draft',
      });

      inspect.raw.exec('DROP TRIGGER fail_online_plan_approval');
      const approved = await send(socket, reader, 'approve-retry', 'plan.approve', {
        planId: draft.planId,
        revision: 1,
      });
      expect(approved.error).toBeUndefined();
      const runId = (approved.payload as { run: { id: string } }).run.id as never;
      await waitFor(
        () => new SqliteOrchestrationStore(inspect.raw).getGraph(runId)?.run.state === 'completed',
      );
      expect(executed).toEqual(['online-root', 'online-middle', 'online-leaf']);
      expect(
        inspect.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.completed'")
          .get(runId),
      ).toEqual({ count: 1 });
    } finally {
      socket.destroy();
      await session.close();
      inspect.raw.close();
    }
  });
});

describe('orchestration run commands', () => {
  it('aborts active execution only after the outer cancel unit of work commits', async () => {
    const { dir, dbPath } = makeDbPath('sync-think-cancel-post-commit-');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    seed(setup.raw);
    const graph = approve(new SqliteOrchestrationStore(setup.raw), 'cancel-post-commit');
    setup.raw.close();

    const entered = deferred<StepExecutionContext>();
    let permitAbortCompletion = false;
    let abortCount = 0;
    const executor: StepExecutor = {
      execute(context) {
        entered.resolve(context);
        return new Promise((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              abortCount += 1;
              if (permitAbortCompletion) resolve({});
            },
            { once: true },
          );
        });
      },
    };
    const installId = `cancel-post-commit-${randomBytes(5).toString('hex')}`;
    const session = await openPersistentRuntime({
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      installId,
      allowNoToken: true,
      stepExecutor: executor,
    });
    await session.runtime.start();
    const context = await entered.promise;
    const inspect = await openDatabaseAsync({ path: dbPath });
    inspect.raw.exec(`
      CREATE TRIGGER fail_cancel_task_version
      BEFORE UPDATE OF version ON task
      BEGIN
        SELECT RAISE(ABORT, 'forced outer cancel failure');
      END;
    `);
    const baselineEvents = (
      inspect.raw.prepare('SELECT COUNT(*) AS count FROM event WHERE run_id = ?').get(graph.run.id) as {
        count: number;
      }
    ).count;
    const baselineCheckpoints = (
      inspect.raw
        .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
        .get(graph.run.id) as { count: number }
    ).count;

    const socket = connect(pipePathPortable(installId));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const reader = frameReader(socket);
    try {
      const hello = await send(socket, reader, 'hello', '__hello', {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: randomBytes(8).toString('hex'),
        features: ['run.cancel'],
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const scope = { workspaceId, taskId, runId: graph.run.id, expectedTaskVersion: 0 };
      const failed = await send(socket, reader, 'cancel-fails', 'run.cancel', scope);
      expect(failed.error).toMatchObject({ code: 'storage.write_failed' });
      expect(context.signal.aborted).toBe(false);
      expect(abortCount).toBe(0);
      expect(new SqliteOrchestrationStore(inspect.raw).getGraph(graph.run.id)).toMatchObject({
        run: { state: 'running' },
        steps: [{ state: 'running' }],
      });
      expect(inspect.raw.prepare('SELECT version FROM task WHERE id = ?').get(taskId)).toEqual({
        version: 0,
      });
      expect(
        inspect.raw.prepare('SELECT COUNT(*) AS count FROM event WHERE run_id = ?').get(graph.run.id),
      ).toEqual({ count: baselineEvents });
      expect(
        inspect.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(graph.run.id),
      ).toEqual({ count: baselineCheckpoints });

      inspect.raw.exec('DROP TRIGGER fail_cancel_task_version');
      permitAbortCompletion = true;
      const retried = await send(socket, reader, 'cancel-retry', 'run.cancel', scope);
      expect(retried.error).toBeUndefined();
      expect(retried.payload).toMatchObject({ run: { state: 'cancelled' }, taskVersion: 1 });
      await waitFor(() => abortCount === 1);
      expect(context.signal.aborted).toBe(true);
      expect(
        inspect.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.cancelled'",
          )
          .get(graph.run.id),
      ).toEqual({ count: 1 });
    } finally {
      socket.destroy();
      inspect.raw.close();
      await session.close();
    }
  });

  it('enforces strict server scope and OCC while keeping terminal replay idempotent', async () => {
    const { dir, dbPath } = makeDbPath('sync-think-orchestration-commands-');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    seed(setup.raw);
    const setupStore = new SqliteOrchestrationStore(setup.raw);
    const graph = approve(setupStore, 'command-step');
    setup.raw.close();

    const installId = `commands-${randomBytes(5).toString('hex')}`;
    const executionEntered = deferred<void>();
    const session = await openPersistentRuntime({
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      installId,
      allowNoToken: true,
      stepExecutor: {
        async execute(context) {
          executionEntered.resolve();
          await new Promise<void>((resolve) => {
            if (context.signal.aborted) resolve();
            else context.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return {};
        },
      },
    });
    await session.runtime.start();
    await executionEntered.promise;
    const baselineConnection = await openDatabaseAsync({ path: dbPath });
    const baselineCheckpoints = (
      baselineConnection.raw
        .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
        .get(graph.run.id) as { count: number }
    ).count;
    baselineConnection.raw.close();
    const socket = connect(pipePathPortable(installId));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const reader = frameReader(socket);
    try {
      const hello = await send(socket, reader, 'hello', '__hello', {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: randomBytes(8).toString('hex'),
        features: ['run.getGraph', 'run.pause', 'run.resume', 'run.cancel'],
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const invalid: Array<[string, string, unknown]> = [
        ['pause-missing-scope', 'run.pause', { runId: graph.run.id }],
        [
          'pause-unknown',
          'run.pause',
          { workspaceId, taskId, runId: graph.run.id, expectedTaskVersion: 0, approved: true },
        ],
        [
          'resume-oversize',
          'run.resume',
          { workspaceId: 'x'.repeat(257), taskId, runId: graph.run.id, expectedTaskVersion: 0 },
        ],
        ['graph-missing-scope', 'run.getGraph', { runId: graph.run.id }],
        [
          'graph-unknown',
          'run.getGraph',
          { workspaceId, taskId, runId: graph.run.id, secret: true },
        ],
        [
          'graph-oversize',
          'run.getGraph',
          { workspaceId, taskId, runId: 'x'.repeat(257) },
        ],
      ];
      for (const [id, type, payload] of invalid) {
        expect((await send(socket, reader, id, type, payload)).error).toMatchObject({
          code: 'protocol.frame_malformed',
        });
      }

      expect(
        (
          await send(socket, reader, 'cancel-conversation-shape', 'run.cancel', {
            runId: graph.run.id,
          })
        ).error,
      ).toMatchObject({
        code: 'protocol.unexpected_request',
      });
      expect(
        (
          await send(socket, reader, 'pause-forged', 'run.pause', {
            workspaceId: 'workspace-forged',
            taskId,
            runId: graph.run.id,
            expectedTaskVersion: 0,
          })
        ).error,
      ).toMatchObject({ code: 'protocol.unexpected_request' });

      expect(
        (
          await send(socket, reader, 'graph-valid', 'run.getGraph', {
            workspaceId,
            taskId,
            runId: graph.run.id,
          })
        ).payload,
      ).toMatchObject({ run: { id: graph.run.id }, steps: [{ instructions: 'command-step' }] });
      for (const [id, forgedScope] of [
        ['graph-forged-workspace', { workspaceId: 'workspace-forged', taskId }],
        ['graph-forged-task', { workspaceId, taskId: 'task-forged' }],
      ] as const) {
        const response = await send(socket, reader, id, 'run.getGraph', {
          ...forgedScope,
          runId: graph.run.id,
        });
        expect(response.error).toMatchObject({ code: 'protocol.unexpected_request' });
        expect(JSON.stringify(response)).not.toContain('command-step');
      }

      const scope = { workspaceId, taskId, runId: graph.run.id };
      expect(
        (
          await send(socket, reader, 'pause-stale', 'run.pause', {
            ...scope,
            expectedTaskVersion: 9,
          })
        ).error,
      ).toMatchObject({
        code: 'task.version_mismatch',
      });
      expect(
        (await send(socket, reader, 'pause', 'run.pause', { ...scope, expectedTaskVersion: 0 }))
          .payload,
      ).toMatchObject({
        run: { state: 'paused' },
        taskVersion: 1,
      });
      expect(
        (
          await send(socket, reader, 'pause-replay', 'run.pause', {
            ...scope,
            expectedTaskVersion: 0,
          })
        ).error,
      ).toMatchObject({
        code: 'task.version_mismatch',
      });
      expect(
        (
          await send(socket, reader, 'pause-current-noop', 'run.pause', {
            ...scope,
            expectedTaskVersion: 1,
          })
        ).payload,
      ).toMatchObject({
        run: { state: 'paused' },
        taskVersion: 1,
      });
      expect(
        (await send(socket, reader, 'resume', 'run.resume', { ...scope, expectedTaskVersion: 1 }))
          .payload,
      ).toMatchObject({
        run: { state: 'running' },
        taskVersion: 2,
      });
      expect(
        (
          await send(socket, reader, 'resume-stale-noop', 'run.resume', {
            ...scope,
            expectedTaskVersion: 1,
          })
        ).error,
      ).toMatchObject({ code: 'task.version_mismatch' });
      expect(
        (
          await send(socket, reader, 'resume-current-noop', 'run.resume', {
            ...scope,
            expectedTaskVersion: 2,
          })
        ).payload,
      ).toMatchObject({ run: { state: 'running' }, taskVersion: 2 });
      expect(
        (await send(socket, reader, 'cancel', 'run.cancel', { ...scope, expectedTaskVersion: 2 }))
          .payload,
      ).toMatchObject({
        run: { state: 'cancelled' },
        taskVersion: 3,
      });
      expect(
        (
          await send(socket, reader, 'pause-terminal-stale', 'run.pause', {
            ...scope,
            expectedTaskVersion: 0,
          })
        ).payload,
      ).toMatchObject({ run: { state: 'cancelled' }, taskVersion: 3 });
      expect(
        (
          await send(socket, reader, 'resume-terminal', 'run.resume', {
            ...scope,
            expectedTaskVersion: 3,
          })
        ).payload,
      ).toMatchObject({
        run: { state: 'cancelled' },
        taskVersion: 3,
      });
      expect(
        (
          await send(socket, reader, 'cancel-replay', 'run.cancel', {
            ...scope,
            expectedTaskVersion: 2,
          })
        ).payload,
      ).toMatchObject({
        run: { state: 'cancelled' },
        taskVersion: 3,
      });
    } finally {
      socket.destroy();
      await session.close();
    }

    const verify = await openDatabaseAsync({ path: dbPath });
    try {
      expect(
        verify.raw
          .prepare(
            "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.cancelled'",
          )
          .get(graph.run.id),
      ).toEqual({ count: 1 });
      expect(verify.raw.prepare('SELECT version FROM task WHERE id = ?').get(taskId)).toEqual({
        version: 3,
      });
      expect(
        verify.raw
          .prepare(
            `SELECT type, COUNT(*) AS count FROM event
             WHERE run_id = ? AND type IN ('run.paused', 'run.running', 'run.cancelled')
             GROUP BY type ORDER BY type`,
          )
          .all(graph.run.id),
      ).toEqual([
        { type: 'run.cancelled', count: 1 },
        { type: 'run.paused', count: 1 },
        { type: 'run.running', count: 2 },
      ]);
      expect(
        verify.raw
          .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
          .get(graph.run.id),
      ).toEqual({ count: baselineCheckpoints + 3 });
    } finally {
      verify.raw.close();
    }
  });
});
