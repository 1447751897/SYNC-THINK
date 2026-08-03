import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteArtifactStore,
  SqliteApprovalStore,
  SqliteAgentContextStore,
  SqliteOrchestrationStore,
  SqliteUnitOfWork,
  type BetterSQLite3Raw,
} from '@sync-think/storage';
import type {
  AgentVersionId,
  PlanStepDraft,
  StepId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import { Scheduler } from './scheduler.js';
import {
  StepAwaitingApprovalError,
  StepExecutionError,
  type StepExecutionContext,
  type StepExecutor,
} from './step-executor.js';

const workspaceId = 'workspace-scheduler' as WorkspaceId;
const taskId = 'task-scheduler' as TaskId;
const firstAgent = 'agent-version-first' as AgentVersionId;
const secondAgent = 'agent-version-second' as AgentVersionId;
const tempDirs: string[] = [];
const closers: Array<() => void> = [];

afterEach(() => {
  for (const close of closers.splice(0).reverse()) close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitUntilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs = 100): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class PersistentFakeAdapterResultStore {
  adapterCalls = 0;

  constructor(private readonly raw: BetterSQLite3Raw) {
    raw.exec(`
      CREATE TABLE fake_adapter_result (
        idempotency_key TEXT PRIMARY KEY,
        result_json TEXT NOT NULL
      );
      CREATE TABLE fake_adapter_effect_count (count INTEGER NOT NULL);
      INSERT INTO fake_adapter_effect_count (count) VALUES (0);
    `);
  }

  execute(idempotencyKey: string): Record<string, never> {
    this.adapterCalls += 1;
    return this.raw
      .transaction(() => {
        const existing = this.raw
          .prepare('SELECT result_json FROM fake_adapter_result WHERE idempotency_key = ?')
          .get(idempotencyKey) as { result_json: string } | undefined;
        if (existing) return JSON.parse(existing.result_json) as Record<string, never>;
        this.raw.prepare('UPDATE fake_adapter_effect_count SET count = count + 1').run();
        const result = {};
        this.raw
          .prepare('INSERT INTO fake_adapter_result (idempotency_key, result_json) VALUES (?, ?)')
          .run(idempotencyKey, JSON.stringify(result));
        return result;
      })
      .immediate();
  }

  actualEffectCount(): number {
    return (
      this.raw.prepare('SELECT count FROM fake_adapter_effect_count').get() as { count: number }
    ).count;
  }
}

function planStep(
  id: string,
  agentVersionId: AgentVersionId,
  dependsOn: string[] = [],
): PlanStepDraft {
  return {
    id: id as StepId,
    title: id,
    instructions: `execute ${id}`,
    agentVersionId,
    dependsOn: dependsOn as StepId[],
  };
}

function seed(raw: BetterSQLite3Raw): void {
  raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES (?, ?, ?, 't0', 't0')`,
    )
    .run(workspaceId, 'D:\\projects\\scheduler', 'Scheduler');
  raw
    .prepare(
      `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, 'Scheduler', 'Execute DAG', 'active', 'automatic', '[]', 0, 't0', 't0')`,
    )
    .run(taskId, workspaceId);
  const insertAgent = raw.prepare(
    `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, created_at
     ) VALUES (?, ?, 1, ?, 'worker', '', '', '', ?, ?, NULL, 1, '[]', 'task',
       '[]', '[]', NULL, 'request', 't0')`,
  );
  insertAgent.run(firstAgent, `agent-${firstAgent}`, firstAgent, 'model-first', 'group-first');
  insertAgent.run(secondAgent, `agent-${secondAgent}`, secondAgent, 'model-second', 'group-second');
}

async function openFixture(secondConnection = false) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-scheduler-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const first = await openDatabaseAsync({ path: dbPath });
  first.raw.pragma('busy_timeout = 5000');
  seed(first.raw);
  closers.push(() => first.raw.close());
  const second = secondConnection ? await openDatabaseAsync({ path: dbPath }) : undefined;
  if (second) {
    second.raw.pragma('busy_timeout = 5000');
    closers.push(() => second.raw.close());
  }
  return {
    dbPath,
    raw: first.raw,
    store: new SqliteOrchestrationStore(first.raw),
    artifactStore: new SqliteArtifactStore(first.raw),
    approvalStore: new SqliteApprovalStore(first.raw),
    unitOfWork: new SqliteUnitOfWork(first.raw),
    secondStore: second ? new SqliteOrchestrationStore(second.raw) : undefined,
    secondApprovalStore: second ? new SqliteApprovalStore(second.raw) : undefined,
    secondUnitOfWork: second ? new SqliteUnitOfWork(second.raw) : undefined,
  };
}

function schedulerApprovalPolicy(
  gate: 'auto-approve' | 'require-human' | 'require-delegate' | 'deny',
) {
  return {
    evaluate() {
      return {
        workspaceId,
        taskId,
        gate,
        humanOnly: false,
        mode:
          gate === 'require-delegate'
            ? ('delegate' as const)
            : gate === 'auto-approve'
              ? ('full' as const)
              : ('request' as const),
        reason: `test policy: ${gate}`,
        labelZh: gate,
        ...(gate === 'require-delegate' ? { delegateAgentVersionId: secondAgent } : {}),
      };
    },
    validateDelegateAgentVersion(agentVersionId: AgentVersionId) {
      return agentVersionId === secondAgent;
    },
  };
}

function approve(
  store: SqliteOrchestrationStore,
  steps: PlanStepDraft[],
): ReturnType<SqliteOrchestrationStore['approvePlan']> {
  const draft = store.createPlanDraft({ taskId, title: 'Scheduler plan', steps, now: 't0' });
  return store.approvePlan({ planId: draft.planId, revision: 1, now: 't0' });
}

describe('Scheduler parallel execution', () => {
  it('never dispatches an explicit merge Step and leaves it ready after both producers complete', async () => {
    const { store } = await openFixture();
    const graph = approve(store, [
      planStep('left-producer', firstAgent),
      planStep('right-producer', secondAgent),
      {
        ...planStep('merge-output', firstAgent, ['left-producer', 'right-producer']),
        kind: 'merge' as const,
      },
    ]);
    const executed: string[] = [];
    const scheduler = new Scheduler({
      store,
      executor: {
        async execute(context) {
          executed.push(context.step.id);
          return {};
        },
      },
    });

    const result = await scheduler.runUntilIdle(graph.run.id);

    expect(executed).toEqual(['left-producer', 'right-producer']);
    expect(result.graph.steps.find((step) => step.id === 'merge-output')).toMatchObject({
      kind: 'merge',
      state: 'ready',
    });
    expect(result.graph.run.state).toBe('running');
    await scheduler.shutdown();
  });

  it('assigns a stable AgentContextThread to a Step and reuses it on retry', async () => {
    const { store, raw } = await openFixture();
    const graph = approve(store, [planStep('stable-thread-step', firstAgent)]);
    const agentContextStore = new SqliteAgentContextStore(raw);
    const contexts: StepExecutionContext[] = [];
    const scheduler = new Scheduler({
      store,
      agentContextStore,
      executor: {
        async execute(context) {
          contexts.push(context);
          return {};
        },
      },
    });

    await scheduler.tick(graph.run.id);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.taskId).toBe(taskId);
    expect(contexts[0]?.agentContextThreadId).toBeTruthy();
    expect(agentContextStore.listThreads(taskId)).toHaveLength(1);
  });

  it('uses a barrier to run every independent ready step against isolated deep-frozen snapshots', async () => {
    const { store, artifactStore } = await openFixture();
    const graph = approve(store, [
      planStep('z-design', firstAgent),
      planStep('a-image', secondAgent),
    ]);
    const artifact = artifactStore.createArtifact({
      workspaceId,
      taskId,
      runId: graph.run.id,
      name: 'input.txt',
      now: 't0',
    });
    const inputVersion = artifactStore.createVersion({
      artifactId: artifact.id,
      sourceStepId: 'z-design' as StepId,
      content: 'same input',
      mimeType: 'text/plain',
      status: 'candidate',
      metadata: { nested: { marker: 'frozen' } },
      now: 't0',
    });
    const contexts: StepExecutionContext[] = [];
    const bothEntered = deferred();
    const release = deferred();
    const executor: StepExecutor = {
      async execute(context) {
        contexts.push(context);
        if (contexts.length === 2) bothEntered.resolve();
        await release.promise;
        return {};
      },
    };
    const scheduler = new Scheduler({ store, executor });

    const ticking = scheduler.tick(graph.run.id);
    await bothEntered.promise;
    expect(contexts.map((context) => context.step.id)).toEqual(['z-design', 'a-image']);
    expect(contexts[0]!.artifactVersions).toEqual([]);
    expect(contexts[1]!.artifactVersions).toEqual([]);
    expect(contexts[0]!.artifactVersions).not.toBe(contexts[1]!.artifactVersions);
    expect(Object.isFrozen(contexts[0]!.artifactVersions)).toBe(true);
    expect(inputVersion.content).toBe('same input');

    release.resolve();
    const result = await ticking;
    expect(result.startedStepIds).toEqual(['z-design', 'a-image']);
    expect(result.graph.run.state).toBe('completed');
  });

  it('isolates each ready Step snapshot to allowed transitive ancestor outputs', async () => {
    const { raw, store, artifactStore } = await openFixture();
    const graph = approve(store, [
      planStep('grandparent', firstAgent),
      planStep('left-parent', firstAgent, ['grandparent']),
      planStep('right-parent', secondAgent),
      planStep('left-child', firstAgent, ['left-parent']),
      planStep('right-child', secondAgent, ['right-parent']),
    ]);
    for (const stepId of ['grandparent', 'left-parent', 'right-parent']) {
      raw
        .prepare("UPDATE step SET state = 'completed' WHERE run_id = ? AND id = ?")
        .run(graph.run.id, stepId);
    }
    const createOutput = (
      sourceStepId: string,
      status: 'candidate' | 'selected' | 'merged' | 'rejected' | 'incomplete',
      marker: string,
    ) => {
      const artifact = artifactStore.createArtifact({
        workspaceId,
        taskId,
        runId: graph.run.id,
        name: `${marker}.txt`,
        now: `t-${marker}`,
      });
      return artifactStore.createVersion({
        artifactId: artifact.id,
        sourceStepId: sourceStepId as StepId,
        content: marker,
        mimeType: 'text/plain',
        status,
        metadata: { nested: { marker } },
        now: `t-${marker}`,
      });
    };
    const grandparent = createOutput('grandparent', 'candidate', 'grandparent-visible');
    const left = createOutput('left-parent', 'selected', 'left-visible');
    createOutput('left-parent', 'rejected', 'rejected-secret-marker');
    createOutput('left-parent', 'incomplete', 'incomplete-secret-marker');
    const right = createOutput('right-parent', 'merged', 'sibling-secret-marker');
    const contexts = new Map<string, StepExecutionContext>();
    const scheduler = new Scheduler({
      store,
      executor: {
        async execute(context) {
          contexts.set(context.step.id, context);
          return {};
        },
      },
    });

    await scheduler.tick(graph.run.id);
    expect(contexts.get('left-child')!.artifactVersions.map((version) => version.id)).toEqual([
      grandparent.id,
      left.id,
    ]);
    expect(contexts.get('right-child')!.artifactVersions.map((version) => version.id)).toEqual([
      right.id,
    ]);
    expect(JSON.stringify(contexts.get('left-child')!.artifactVersions)).not.toContain(
      'sibling-secret-marker',
    );
    expect(JSON.stringify(contexts.get('left-child')!.artifactVersions)).not.toContain(
      'rejected-secret-marker',
    );
    expect(JSON.stringify(contexts.get('left-child')!.artifactVersions)).not.toContain(
      'incomplete-secret-marker',
    );
    expect(Object.isFrozen(contexts.get('left-child')!.artifactVersions[0]!.metadata)).toBe(true);
  });

  it('durably fails a legal 33-way fan-in snapshot exactly once across schedulers and recovery', async () => {
    const { raw, store, artifactStore, secondStore } = await openFixture(true);
    const parentIds = Array.from({ length: 33 }, (_, index) => `bounded-parent-${index}`);
    const graph = approve(store, [
      ...parentIds.map((id, index) => planStep(id, index % 2 === 0 ? firstAgent : secondAgent)),
      planStep('bounded-child', secondAgent, parentIds),
    ]);
    for (const [index, parentId] of parentIds.entries()) {
      raw
        .prepare("UPDATE step SET state = 'completed' WHERE run_id = ? AND id = ?")
        .run(graph.run.id, parentId);
      const artifact = artifactStore.createArtifact({
        workspaceId,
        taskId,
        runId: graph.run.id,
        name: `bounded-${index}.txt`,
        now: `t-artifact-${String(index).padStart(2, '0')}`,
      });
      artifactStore.createVersion({
        artifactId: artifact.id,
        sourceStepId: parentId as StepId,
        content: `parent-version-${index}`,
        mimeType: 'text/plain',
        status: 'candidate',
        now: `t-version-${String(index).padStart(2, '0')}`,
      });
    }
    let executions = 0;
    const executor: StepExecutor = {
      async execute() {
        executions += 1;
        return {};
      },
    };
    const firstScheduler = new Scheduler({
      store,
      executor,
      ownerId: 'snapshot-limit-first',
    });
    const secondScheduler = new Scheduler({
      store: secondStore!,
      executor,
      ownerId: 'snapshot-limit-second',
    });

    const [firstResult, secondResult] = await Promise.all([
      firstScheduler.tick(graph.run.id),
      secondScheduler.tick(graph.run.id),
    ]);
    expect([firstResult.graph.run.state, secondResult.graph.run.state]).toEqual([
      'failed',
      'failed',
    ]);
    expect(executions).toBe(0);
    expect(store.getGraph(graph.run.id)!.steps.at(-1)).toMatchObject({
      id: 'bounded-child',
      state: 'failed',
      leaseExpiresAt: undefined,
    });
    const failedPayload = JSON.parse(
      (
        raw
          .prepare(
            "SELECT payload_json FROM event WHERE run_id = ? AND type = 'step.failed' LIMIT 1",
          )
          .get(graph.run.id) as { payload_json: string }
      ).payload_json,
    ) as Record<string, unknown>;
    expect(failedPayload).toMatchObject({
      failureClass: 'acceptance',
      code: 'step.snapshot_limit_exceeded',
    });
    expect(String(failedPayload.summary)).toContain('bounded-child:versions');
    expect(
      raw
        .prepare(
          "SELECT type, COUNT(*) AS count FROM event WHERE run_id = ? AND type IN ('step.failed', 'run.failed') GROUP BY type ORDER BY type",
        )
        .all(graph.run.id),
    ).toEqual([
      { type: 'run.failed', count: 1 },
      { type: 'step.failed', count: 1 },
    ]);

    expect(store.recoverRun(graph.run.id).run.state).toBe('failed');
    expect((await firstScheduler.tick(graph.run.id)).startedStepIds).toEqual([]);
    expect(
      raw
        .prepare(
          "SELECT type, COUNT(*) AS count FROM event WHERE run_id = ? AND type IN ('step.failed', 'run.failed') GROUP BY type ORDER BY type",
        )
        .all(graph.run.id),
    ).toEqual([
      { type: 'run.failed', count: 1 },
      { type: 'step.failed', count: 1 },
    ]);
    await firstScheduler.shutdown();
    await secondScheduler.shutdown();
  });

  it('durably fails when an ancestor snapshot exceeds its total inline byte bound', async () => {
    const { raw, store, artifactStore } = await openFixture();
    const graph = approve(store, [
      planStep('large-parent', firstAgent),
      planStep('large-child', secondAgent, ['large-parent']),
    ]);
    raw
      .prepare("UPDATE step SET state = 'completed' WHERE run_id = ? AND id = ?")
      .run(graph.run.id, 'large-parent');
    const artifact = artifactStore.createArtifact({
      workspaceId,
      taskId,
      runId: graph.run.id,
      name: 'large.txt',
      now: 't0',
    });
    for (let index = 0; index < 6; index += 1) {
      artifactStore.createVersion({
        artifactId: artifact.id,
        sourceStepId: 'large-parent' as StepId,
        content: 'x'.repeat(44 * 1024),
        mimeType: 'text/plain',
        status: 'candidate',
        now: `t${index}`,
      });
    }
    let executions = 0;
    const scheduler = new Scheduler({
      store,
      executor: {
        async execute() {
          executions += 1;
          return {};
        },
      },
    });

    const result = await scheduler.tick(graph.run.id);
    expect(result.graph.run.state).toBe('failed');
    expect(executions).toBe(0);
    expect(result.graph.steps[1]).toMatchObject({ id: 'large-child', state: 'failed' });
    const payload = JSON.parse(
      (
        raw
          .prepare("SELECT payload_json FROM event WHERE run_id = ? AND type = 'step.failed'")
          .get(graph.run.id) as { payload_json: string }
      ).payload_json,
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      failureClass: 'acceptance',
      code: 'step.snapshot_limit_exceeded',
    });
    expect(String(payload.summary)).toContain('large-child:inline_bytes');
    await scheduler.shutdown();
  });

  it('does not start a dependent step until its dependency completion is durable', async () => {
    const { store } = await openFixture();
    const graph = approve(store, [
      planStep('root', firstAgent),
      planStep('child', secondAgent, ['root']),
    ]);
    const releaseRoot = deferred();
    const started: string[] = [];
    const executor: StepExecutor = {
      async execute(context) {
        started.push(context.step.id);
        if (context.step.id === 'root') await releaseRoot.promise;
        return {};
      },
    };
    const scheduler = new Scheduler({ store, executor });

    const firstTick = scheduler.tick(graph.run.id);
    await Promise.resolve();
    expect(started).toEqual(['root']);
    expect(
      store.getGraph(graph.run.id)!.steps.find((step) => step.id === ('child' as StepId))!.state,
    ).toBe('pending');
    releaseRoot.resolve();
    const firstResult = await firstTick;
    expect(firstResult.readyStepIds).toEqual(['child']);
    expect(started).toEqual(['root']);

    await scheduler.tick(graph.run.id);
    expect(started).toEqual(['root', 'child']);
  });

  it('drains every ready DAG layer and coalesces concurrent local drains for one Run', async () => {
    const { store } = await openFixture();
    const graph = approve(store, [
      planStep('root', firstAgent),
      planStep('middle', secondAgent, ['root']),
      planStep('leaf', firstAgent, ['middle']),
    ]);
    const rootEntered = deferred();
    const releaseRoot = deferred();
    const executed: string[] = [];
    const scheduler = new Scheduler({
      store,
      executor: {
        async execute(context) {
          executed.push(context.step.id);
          if (context.step.id === 'root') {
            rootEntered.resolve();
            await releaseRoot.promise;
          }
          return {};
        },
      },
    });

    const firstDrain = scheduler.runUntilIdle(graph.run.id);
    const secondDrain = scheduler.runUntilIdle(graph.run.id);
    expect(secondDrain).toBe(firstDrain);
    await rootEntered.promise;
    expect(executed).toEqual(['root']);
    releaseRoot.resolve();
    const result = await firstDrain;
    expect(result.startedStepIds).toEqual(['root', 'middle', 'leaf']);
    expect(executed).toEqual(['root', 'middle', 'leaf']);
    expect(result.graph.run.state).toBe('completed');
  });
});

describe('Scheduler protected Step approvals', () => {
  it('binds a ready Step to one action digest and executes once after idempotent approval', async () => {
    const { raw, store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('protected-ready', firstAgent)]);
    let executions = 0;
    const scheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        async getActionRequest() {
          return {
            kind: 'tool' as const,
            action: 'shell.exec',
            summary: 'Run the protected command',
            details: { command: 'pnpm test' },
          };
        },
        async execute() {
          executions += 1;
          return {};
        },
      },
    });

    expect((await scheduler.tick(graph.run.id)).startedStepIds).toEqual([]);
    expect(executions).toBe(0);
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'awaitingToolApproval' },
      steps: [{ id: 'protected-ready', state: 'awaitingApproval' }],
    });
    const pending = approvalStore.list({ workspaceId, state: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      runId: graph.run.id,
      stepId: 'protected-ready',
      action: 'shell.exec',
      humanOnly: false,
      metadata: {
        runId: graph.run.id,
        stepId: 'protected-ready',
        agentVersionId: firstAgent,
      },
    });
    expect(pending[0]!.metadata.actionDigest).toMatch(/^[a-f0-9]{64}$/);

    expect(scheduler.pause(graph.run.id).run.state).toBe('paused');
    expect(scheduler.resume(graph.run.id).run.state).toBe('awaitingToolApproval');

    const decided = scheduler.decideApproval({
      approvalId: pending[0]!.id,
      decision: 'approved',
      decidedBy: 'human',
    });
    expect(decided.replayed).toBe(false);
    expect(decided.graph.steps[0]!.state).toBe('ready');
    const replay = scheduler.decideApproval({
      approvalId: pending[0]!.id,
      decision: 'approved',
      decidedBy: 'human',
    });
    expect(replay.replayed).toBe(true);

    await Promise.all([scheduler.runUntilIdle(graph.run.id), scheduler.runUntilIdle(graph.run.id)]);
    expect(executions).toBe(1);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('completed');
    expect(
      raw
        .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'step.started'")
        .get(graph.run.id),
    ).toEqual({ count: 1 });
    expect(
      raw
        .prepare(
          "SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'approval.decided'",
        )
        .get(graph.run.id),
    ).toEqual({ count: 1 });
  });

  it('moves a running Step to awaitingApproval before effects and retries with the same key', async () => {
    const { store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('protected-running', firstAgent)]);
    const keys: string[] = [];
    let calls = 0;
    const scheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        async execute(context) {
          calls += 1;
          keys.push(context.idempotencyKey);
          if (calls === 1) {
            throw new StepAwaitingApprovalError({
              kind: 'tool',
              action: 'filesystem.write',
              summary: 'Write protected output',
              details: { path: 'output.txt' },
            });
          }
          return {};
        },
      },
    });

    expect((await scheduler.tick(graph.run.id)).startedStepIds).toEqual(['protected-running']);
    expect(store.getGraph(graph.run.id)!.steps[0]!.state).toBe('awaitingApproval');
    const pending = approvalStore.list({ workspaceId, state: 'pending' });
    expect(pending).toHaveLength(1);
    scheduler.decideApproval({
      approvalId: pending[0]!.id,
      decision: 'approved',
      decidedBy: 'human',
    });
    await scheduler.runUntilIdle(graph.run.id);

    expect(calls).toBe(2);
    expect(keys[1]).toBe(keys[0]);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('completed');
  });

  it('provides a live action gate to the executor and resumes an approved dynamic tool once', async () => {
    const { store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('dynamic-tool-gate', firstAgent)]);
    let effects = 0;
    let executeCalls = 0;
    const scheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        async execute(context) {
          executeCalls += 1;
          const gate = await context.gateAction!({
            kind: 'tool',
            action: 'tool.write_file',
            summary: 'Write output.txt',
            details: { path: 'output.txt' },
          });
          if (!gate.allowed) return {};
          effects += 1;
          expect(gate.actionDigest).toMatch(/^[a-f0-9]{64}$/);
          return {};
        },
      },
    });

    await scheduler.tick(graph.run.id);
    expect(executeCalls).toBe(1);
    expect(effects).toBe(0);
    expect(store.getGraph(graph.run.id)!.steps[0]!.state).toBe('awaitingApproval');
    const approval = approvalStore.list({ workspaceId, state: 'pending' })[0]!;
    scheduler.decideApproval({
      approvalId: approval.id,
      decision: 'approved',
      decidedBy: 'human',
    });
    await scheduler.runUntilIdle(graph.run.id);

    expect(executeCalls).toBe(2);
    expect(effects).toBe(1);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('completed');
  });

  it('persists rejection and never invokes the protected Step executor', async () => {
    const { store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('protected-rejected', firstAgent)]);
    let executions = 0;
    const scheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        getActionRequest() {
          return { kind: 'tool', action: 'shell.exec', summary: 'Reject me' };
        },
        async execute() {
          executions += 1;
          return {};
        },
      },
    });

    await scheduler.tick(graph.run.id);
    const approval = approvalStore.list({ workspaceId, state: 'pending' })[0]!;
    scheduler.decideApproval({
      approvalId: approval.id,
      decision: 'rejected',
      decidedBy: 'human',
    });
    await scheduler.runUntilIdle(graph.run.id);

    expect(executions).toBe(0);
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'failed' },
      steps: [{ state: 'failed' }],
    });
  });

  it('records the exact delegate AgentVersion and never delegates a human-only action', async () => {
    const { raw, store, approvalStore, unitOfWork } = await openFixture();
    const delegated = approve(store, [planStep('delegated-step', firstAgent)]);
    let delegatedExecutions = 0;
    const delegatedScheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      approvalPolicy: schedulerApprovalPolicy('require-delegate'),
      executor: {
        getActionRequest() {
          return { kind: 'tool', action: 'browser.navigate', summary: 'Navigate' };
        },
        async execute() {
          delegatedExecutions += 1;
          return {};
        },
      },
    });
    await delegatedScheduler.tick(delegated.run.id);
    const delegateApproval = approvalStore.list({ workspaceId, state: 'pending' })[0]!;
    delegatedScheduler.decideApproval({
      approvalId: delegateApproval.id,
      decision: 'approved',
      decidedBy: 'delegate',
      delegateAgentVersionId: secondAgent,
    });
    await delegatedScheduler.runUntilIdle(delegated.run.id);
    expect(delegatedExecutions).toBe(1);
    const delegateEvent = raw
      .prepare(
        "SELECT payload_json FROM event WHERE run_id = ? AND type = 'step.ready' ORDER BY sequence DESC LIMIT 1",
      )
      .get(delegated.run.id) as { payload_json: string };
    expect(JSON.parse(delegateEvent.payload_json)).toMatchObject({
      approvalId: delegateApproval.id,
      decidedBy: 'delegate',
      delegateAgentVersionId: secondAgent,
    });
    const delegateAudit = raw
      .prepare(
        "SELECT payload_json FROM event WHERE run_id = ? AND type = 'approval.decided' ORDER BY sequence DESC LIMIT 1",
      )
      .get(delegated.run.id) as { payload_json: string };
    expect(JSON.parse(delegateAudit.payload_json)).toMatchObject({
      approvalId: delegateApproval.id,
      decision: 'approved',
      decidedBy: 'delegate',
      delegateAgentVersionId: secondAgent,
    });

    const humanOnly = approve(store, [planStep('human-only-step', firstAgent)]);
    let humanOnlyExecutions = 0;
    const humanOnlyScheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      approvalPolicy: schedulerApprovalPolicy('auto-approve'),
      executor: {
        getActionRequest() {
          return {
            kind: 'human-only',
            action: 'payment-or-purchase',
            summary: 'Purchase',
          };
        },
        async execute() {
          humanOnlyExecutions += 1;
          return {};
        },
      },
    });
    await humanOnlyScheduler.tick(humanOnly.run.id);
    const humanApproval = approvalStore
      .list({ workspaceId, state: 'pending' })
      .find((entry) => entry.runId === humanOnly.run.id)!;
    expect(humanApproval).toMatchObject({ humanOnly: true, gate: 'require-human' });
    expect(() =>
      humanOnlyScheduler.decideApproval({
        approvalId: humanApproval.id,
        decision: 'approved',
        decidedBy: 'delegate',
        delegateAgentVersionId: secondAgent,
      }),
    ).toThrow('approval.human_only_requires_human');
    expect(humanOnlyExecutions).toBe(0);
    expect(store.getGraph(humanOnly.run.id)!.steps[0]!.state).toBe('awaitingApproval');
  });

  it('gates only the live owner fence and rejection never retries the Step', async () => {
    const { store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('mcp-gated-step', firstAgent)]);
    const entered = deferred<StepExecutionContext>();
    let executions = 0;
    const scheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      ownerId: 'scheduler-mcp-owner',
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        async execute(context) {
          executions += 1;
          entered.resolve(context);
          await waitUntilAborted(context.signal).catch(() => undefined);
          return {};
        },
      },
    });
    const competing = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      ownerId: 'scheduler-not-owner',
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        async execute() {
          return {};
        },
      },
    });

    const tick = scheduler.tick(graph.run.id);
    const context = await entered.promise;
    const request = {
      kind: 'mcp-permission' as const,
      action: 'mcp.tool.echo',
      summary: 'Call echo',
      details: { mcpServerId: 'mcp-1', toolName: 'echo', argumentsJson: '{}' },
    };
    expect(() =>
      competing.gateStepAction({
        runId: graph.run.id,
        stepId: context.step.id,
        agentVersionId: firstAgent,
        request,
      }),
    ).toThrow('scheduler.step_action_fence_mismatch');

    const gated = scheduler.gateStepAction({
      runId: graph.run.id,
      stepId: context.step.id,
      agentVersionId: firstAgent,
      request,
    });
    expect(gated).toMatchObject({
      allowed: false,
      approval: { state: 'pending' },
      graph: {
        run: { state: 'awaitingToolApproval' },
        steps: [{ state: 'awaitingApproval' }],
      },
    });
    await tick;
    scheduler.decideApproval({
      approvalId: gated.approval!.id,
      decision: 'rejected',
      decidedBy: 'human',
    });
    await scheduler.runUntilIdle(graph.run.id);
    expect(executions).toBe(1);
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'failed' },
      steps: [{ state: 'failed' }],
    });
    await competing.shutdown();
    await scheduler.shutdown();
  });

  it('recovers an approved gated action on the same Step and idempotency key under a new owner', async () => {
    const { store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('recover-gated-step', firstAgent)]);
    const firstEntered = deferred<StepExecutionContext>();
    const request = {
      kind: 'mcp-permission' as const,
      action: 'mcp.tool.echo',
      summary: 'Recover echo',
      details: { mcpServerId: 'mcp-1', toolName: 'echo', argumentsJson: '{}' },
    };
    const firstScheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      ownerId: 'scheduler-before-restart',
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        async execute(context) {
          firstEntered.resolve(context);
          await waitUntilAborted(context.signal).catch(() => undefined);
          return {};
        },
      },
    });
    const firstTick = firstScheduler.tick(graph.run.id);
    const firstContext = await firstEntered.promise;
    const gated = firstScheduler.gateStepAction({
      runId: graph.run.id,
      stepId: firstContext.step.id,
      agentVersionId: firstAgent,
      request,
    });
    await firstTick;
    firstScheduler.decideApproval({
      approvalId: gated.approval!.id,
      decision: 'approved',
      decidedBy: 'human',
    });
    await firstScheduler.shutdown();

    let recoveredContext: StepExecutionContext | undefined;
    const recoveredScheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      ownerId: 'scheduler-after-restart',
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        async execute(context) {
          recoveredContext = context;
          const resumed = recoveredScheduler.gateStepAction({
            runId: graph.run.id,
            stepId: context.step.id,
            agentVersionId: firstAgent,
            request,
          });
          expect(resumed.allowed).toBe(true);
          expect(resumed.approval?.id).toBe(gated.approval!.id);
          return {};
        },
      },
    });
    const recovered = await recoveredScheduler.recover(graph.run.id);
    expect(recovered.startedStepIds).toEqual(['recover-gated-step']);
    expect(recoveredContext?.step.id).toBe(firstContext.step.id);
    expect(recoveredContext?.idempotencyKey).toBe(firstContext.idempotencyKey);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('completed');
    expect(approvalStore.list({ workspaceId })).toHaveLength(1);
    await recoveredScheduler.shutdown();
  });

  it('binds an allowed action gate to the live execution fence and cancellation signal', async () => {
    const { store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('cancel-gated-step', firstAgent)]);
    const entered = deferred<StepExecutionContext>();
    const release = deferred<void>();
    const scheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      ownerId: 'scheduler-cancel-gate-owner',
      approvalPolicy: schedulerApprovalPolicy('auto-approve'),
      executor: {
        async execute(context) {
          entered.resolve(context);
          await release.promise;
          return {};
        },
      },
    });

    const tick = scheduler.tick(graph.run.id);
    const context = await entered.promise;
    const gated = scheduler.gateStepAction({
      runId: graph.run.id,
      stepId: context.step.id,
      agentVersionId: firstAgent,
      request: {
        kind: 'mcp-permission',
        action: 'mcp.tool.echo',
        summary: 'Call echo after exact fence validation',
      },
    });

    expect(gated).toMatchObject({
      allowed: true,
      ownerId: 'scheduler-cancel-gate-owner',
      executionAttempt: context.step.executionAttempt,
    });
    expect(gated.signal).toBe(context.signal);
    expect(gated.signal.aborted).toBe(false);

    scheduler.cancel(graph.run.id);
    expect(gated.signal.aborted).toBe(true);
    release.resolve();
    await tick;
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'cancelled' },
      steps: [{ id: 'cancel-gated-step', state: 'cancelled' }],
    });
    await scheduler.shutdown();
  });

  it('rolls back approval, state, event, and checkpoint together on gate failure', async () => {
    const { raw, store, approvalStore, unitOfWork } = await openFixture();
    const graph = approve(store, [planStep('approval-rollback', firstAgent)]);
    const scheduler = new Scheduler({
      store,
      approvalStore,
      unitOfWork,
      approvalPolicy: schedulerApprovalPolicy('require-human'),
      executor: {
        getActionRequest() {
          return { kind: 'tool', action: 'shell.exec', summary: 'Atomic gate' };
        },
        async execute() {
          return {};
        },
      },
    });
    const checkpointBefore = (
      raw
        .prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?')
        .get(graph.run.id) as { count: number }
    ).count;
    raw.exec(`
      CREATE TRIGGER fail_scheduler_approval_event
      BEFORE INSERT ON event
      WHEN NEW.type = 'step.awaitingApproval'
      BEGIN
        SELECT RAISE(ABORT, 'injected approval event failure');
      END;
    `);

    await expect(scheduler.tick(graph.run.id)).rejects.toThrow('injected approval event failure');
    expect(approvalStore.list({ workspaceId })).toEqual([]);
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'queued' },
      steps: [{ state: 'pending' }],
    });
    expect(
      raw
        .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type LIKE '%Approval'")
        .get(graph.run.id),
    ).toEqual({ count: 0 });
    expect(
      raw.prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?').get(graph.run.id),
    ).toEqual({ count: checkpointBefore });

    raw.exec('DROP TRIGGER fail_scheduler_approval_event');
    await scheduler.tick(graph.run.id);
    expect(approvalStore.list({ workspaceId, state: 'pending' })).toHaveLength(1);
    expect(store.getGraph(graph.run.id)!.steps[0]!.state).toBe('awaitingApproval');
  });
});

describe('Scheduler lifecycle controls', () => {
  it('does not schedule a blocked run even when its root step is pending', async () => {
    const { raw, store } = await openFixture();
    const graph = approve(store, [planStep('blocked-root', firstAgent)]);
    raw.prepare("UPDATE run SET state = 'blocked' WHERE id = ?").run(graph.run.id);
    let executions = 0;
    const scheduler = new Scheduler({
      store,
      executor: {
        async execute() {
          executions += 1;
          return {};
        },
      },
    });

    expect((await scheduler.tick(graph.run.id)).startedStepIds).toEqual([]);
    expect(executions).toBe(0);
    expect(store.getGraph(graph.run.id)!.steps[0]!.state).toBe('pending');
  });

  it('pauses without aborting active work and resumes the same graph without starting successors early', async () => {
    const { store } = await openFixture();
    const graph = approve(store, [
      planStep('root', firstAgent),
      planStep('child', secondAgent, ['root']),
    ]);
    const releaseRoot = deferred();
    const entered = deferred();
    const contexts: StepExecutionContext[] = [];
    const executor: StepExecutor = {
      async execute(context) {
        contexts.push(context);
        if (context.step.id === 'root') {
          entered.resolve();
          await releaseRoot.promise;
        }
        return {};
      },
    };
    const scheduler = new Scheduler({ store, executor });
    const ticking = scheduler.tick(graph.run.id);
    await entered.promise;
    const rootKey = contexts[0]!.idempotencyKey;

    expect((await scheduler.pause(graph.run.id)).run.state).toBe('paused');
    expect(contexts[0]!.signal.aborted).toBe(false);
    releaseRoot.resolve();
    await ticking;
    expect(store.getGraph(graph.run.id)!.run.state).toBe('paused');
    expect((await scheduler.tick(graph.run.id)).startedStepIds).toEqual([]);
    expect(contexts.map((context) => context.step.id)).toEqual(['root']);

    const resumed = await scheduler.resume(graph.run.id);
    expect(resumed.steps.map((step) => step.id)).toEqual(graph.steps.map((step) => step.id));
    await scheduler.tick(graph.run.id);
    expect(contexts.map((context) => context.step.id)).toEqual(['root', 'child']);
    expect(contexts[0]!.idempotencyKey).toBe(rootKey);
  });

  it('cancels active executors through AbortSignal and persists one terminal event', async () => {
    const { raw, store } = await openFixture();
    const graph = approve(store, [
      planStep('active', firstAgent),
      planStep('also-active', secondAgent),
    ]);
    const bothEntered = deferred();
    let entered = 0;
    const executor: StepExecutor = {
      execute(context) {
        entered += 1;
        if (entered === 2) bothEntered.resolve();
        return new Promise((_, reject) => {
          context.signal.addEventListener(
            'abort',
            () => reject(new StepExecutionError('cancelled', 'unknown')),
            { once: true },
          );
        });
      },
    };
    const scheduler = new Scheduler({ store, executor });
    const ticking = scheduler.tick(graph.run.id);
    await bothEntered.promise;

    await scheduler.cancel(graph.run.id);
    await scheduler.cancel(graph.run.id);
    await ticking;
    expect(store.getGraph(graph.run.id)!.run.state).toBe('cancelled');
    expect(store.getGraph(graph.run.id)!.steps.map((step) => step.state)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(
      raw
        .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.cancelled'")
        .get(graph.run.id),
    ).toEqual({ count: 1 });
  });

  it('fails only the crashing step, marks its partial output incomplete, and never retries permission failures', async () => {
    const { store, artifactStore } = await openFixture();
    const graph = approve(store, [
      planStep('crash', firstAgent),
      planStep('survivor', secondAgent),
    ]);
    const artifact = artifactStore.createArtifact({
      workspaceId,
      taskId,
      runId: graph.run.id,
      name: 'partial.txt',
      now: 't0',
    });
    const calls = new Map<string, number>();
    const executor: StepExecutor = {
      async execute(context) {
        calls.set(context.step.id, (calls.get(context.step.id) ?? 0) + 1);
        if (context.step.id === 'crash') {
          throw new StepExecutionError('permission denied', 'permission', [
            {
              artifactId: artifact.id,
              content: 'partial bytes',
              mimeType: 'text/plain',
              status: 'candidate',
            },
          ]);
        }
        return {};
      },
    };
    const scheduler = new Scheduler({ store, executor });

    await scheduler.tick(graph.run.id);
    const persisted = store.getGraph(graph.run.id)!;
    expect(persisted.steps.map((step) => [step.id, step.state])).toEqual([
      ['crash', 'failed'],
      ['survivor', 'completed'],
    ]);
    expect(persisted.run.state).toBe('failed');
    expect(calls).toEqual(
      new Map([
        ['crash', 1],
        ['survivor', 1],
      ]),
    );
    expect(artifactStore.listVersions(artifact.id)).toMatchObject([{ status: 'incomplete' }]);
  });

  it('scrubs and bounds executor failures before any durable event or log boundary', async () => {
    const { raw, store } = await openFixture();
    const graph = approve(store, [planStep('secret-failure', firstAgent)]);
    const secret = 'TOP-SECRET-MARKER-123456';
    const localPath = 'C:\\Users\\private-user\\secrets\\response.txt';
    const responseTail = 'RAW-RESPONSE-TAIL'.repeat(80);
    const capturedLogs: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => capturedLogs.push(args);
    try {
      const scheduler = new Scheduler({
        store,
        executor: {
          async execute() {
            throw new Error(
              `api_key=${secret} Bearer ${secret} path ${localPath} body ${responseTail}`,
            );
          },
        },
      });

      await scheduler.tick(graph.run.id);
    } finally {
      console.warn = originalWarn;
    }

    const failedEvent = raw
      .prepare("SELECT payload_json FROM event WHERE run_id = ? AND type = 'step.failed'")
      .get(graph.run.id) as { payload_json: string };
    const payload = JSON.parse(failedEvent.payload_json) as Record<string, unknown>;
    expect(payload).toMatchObject({
      failureClass: 'unknown',
      code: 'step.executor.unknown',
    });
    expect(String(payload.summary).length).toBeLessThanOrEqual(240);
    const checkpoint = raw
      .prepare('SELECT state_json FROM checkpoint WHERE run_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(graph.run.id) as { state_json: string };
    const durableAndLogs = JSON.stringify([failedEvent, checkpoint, capturedLogs]);
    expect(durableAndLogs).not.toContain(secret);
    expect(durableAndLogs).not.toContain('private-user');
    expect(durableAndLogs).not.toContain('RAW-RESPONSE-TAIL');
  });

  it('does not let an executor spoof a storage fence mismatch through its error message', async () => {
    const { raw, store } = await openFixture();
    const graph = approve(store, [planStep('fence-message-spoof', firstAgent)]);
    const scheduler = new Scheduler({
      store,
      executor: {
        async execute() {
          throw new Error('malicious adapter says step.fence_mismatch but owns no fence type');
        },
      },
      ownerId: 'scheduler-fence-message-spoof',
    });

    await scheduler.tick(graph.run.id);
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'failed' },
      steps: [{ id: 'fence-message-spoof', state: 'failed' }],
    });
    const payload = JSON.parse(
      (
        raw
          .prepare("SELECT payload_json FROM event WHERE run_id = ? AND type = 'step.failed'")
          .get(graph.run.id) as { payload_json: string }
      ).payload_json,
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      failureClass: 'unknown',
      code: 'step.executor.unknown',
      summary: 'malicious adapter says step.fence_mismatch but owns no fence type',
    });
    await scheduler.shutdown();
  });

  it('keeps an unaffected ready branch runnable when another worker fails later', async () => {
    const { store } = await openFixture();
    const graph = approve(store, [
      planStep('failing-root', firstAgent),
      planStep('healthy-root', secondAgent),
      planStep('healthy-child', secondAgent, ['healthy-root']),
    ]);
    const releaseFailure = deferred();
    const healthyReturned = deferred();
    const executor: StepExecutor = {
      async execute(context) {
        if (context.step.id === 'failing-root') {
          await releaseFailure.promise;
          throw new StepExecutionError('worker crashed', 'unknown');
        }
        if (context.step.id === 'healthy-root') healthyReturned.resolve();
        return {};
      },
    };
    const scheduler = new Scheduler({ store, executor });
    const ticking = scheduler.tick(graph.run.id);
    await healthyReturned.promise;
    while (
      store.getGraph(graph.run.id)!.steps.find((step) => step.id === ('healthy-child' as StepId))!
        .state !== 'ready'
    ) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    releaseFailure.resolve();

    const firstResult = await ticking;
    expect(firstResult.graph.run.state).toBe('running');
    expect(firstResult.readyStepIds).toEqual(['healthy-child']);
    await scheduler.tick(graph.run.id);
    expect(store.getGraph(graph.run.id)!.steps.map((step) => [step.id, step.state])).toEqual([
      ['failing-root', 'failed'],
      ['healthy-root', 'completed'],
      ['healthy-child', 'completed'],
    ]);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('failed');
  });

  it('resumes a paused failed/completed/ready graph and runs the independent ready branch', async () => {
    const { raw, store } = await openFixture();
    const graph = approve(store, [
      planStep('failed-branch', firstAgent),
      planStep('completed-root', secondAgent),
      planStep('ready-child', secondAgent, ['completed-root']),
    ]);
    raw
      .prepare("UPDATE step SET state = 'failed' WHERE run_id = ? AND id = ?")
      .run(graph.run.id, 'failed-branch');
    raw
      .prepare("UPDATE step SET state = 'completed' WHERE run_id = ? AND id = ?")
      .run(graph.run.id, 'completed-root');
    raw
      .prepare("UPDATE step SET state = 'ready' WHERE run_id = ? AND id = ?")
      .run(graph.run.id, 'ready-child');
    raw.prepare("UPDATE run SET state = 'paused' WHERE id = ?").run(graph.run.id);
    const executed: string[] = [];
    const scheduler = new Scheduler({
      store,
      executor: {
        async execute(context) {
          executed.push(context.step.id);
          return {};
        },
      },
    });

    expect(scheduler.resume(graph.run.id).run.state).toBe('running');
    await scheduler.tick(graph.run.id);
    expect(executed).toEqual(['ready-child']);
    expect(store.getGraph(graph.run.id)!.steps.map((step) => [step.id, step.state])).toEqual([
      ['failed-branch', 'failed'],
      ['completed-root', 'completed'],
      ['ready-child', 'completed'],
    ]);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('failed');
    expect(
      raw
        .prepare(
          "SELECT type, COUNT(*) AS count FROM event WHERE run_id = ? AND type IN ('run.running', 'run.failed') GROUP BY type ORDER BY type",
        )
        .all(graph.run.id),
    ).toEqual([
      { type: 'run.failed', count: 1 },
      { type: 'run.running', count: 1 },
    ]);
  });

  it('serializes two SQLite schedulers with cancel so a step starts once and terminal event stays unique', async () => {
    const { raw, store, secondStore } = await openFixture(true);
    const graph = approve(store, [planStep('only-step', firstAgent)]);
    const entered = deferred();
    const release = deferred();
    let executions = 0;
    const executor: StepExecutor = {
      async execute() {
        executions += 1;
        entered.resolve();
        await release.promise;
        return {};
      },
    };
    const firstScheduler = new Scheduler({ store, executor });
    const secondScheduler = new Scheduler({ store: secondStore!, executor });

    const firstTick = firstScheduler.tick(graph.run.id);
    await entered.promise;
    const secondTick = secondScheduler.tick(graph.run.id);
    await secondScheduler.cancel(graph.run.id);
    release.resolve();
    await Promise.all([firstTick, secondTick]);

    expect(executions).toBe(1);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('cancelled');
    expect(
      raw
        .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.cancelled'")
        .get(graph.run.id),
    ).toEqual({ count: 1 });
  });

  it('fences a live stale Scheduler after lease recovery while the adapter deduplicates the effect', async () => {
    const { raw, store, secondStore } = await openFixture(true);
    const graph = approve(store, [planStep('leased-step', firstAgent)]);
    const adapter = new PersistentFakeAdapterResultStore(raw);
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let clock = '2026-07-13T00:00:00.000Z';
    const firstScheduler = new Scheduler({
      store,
      ownerId: 'scheduler-a',
      now: () => clock,
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 60_000,
      wait: (_delay, signal) => waitUntilAborted(signal),
      executor: {
        async execute(context) {
          adapter.execute(context.idempotencyKey);
          firstEntered.resolve();
          await releaseFirst.promise;
          return {};
        },
      },
    });
    const secondScheduler = new Scheduler({
      store: secondStore!,
      ownerId: 'scheduler-b',
      now: () => clock,
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 60_000,
      wait: (_delay, signal) => waitUntilAborted(signal),
      executor: {
        async execute(context) {
          adapter.execute(context.idempotencyKey);
          return {};
        },
      },
    });

    const firstTick = firstScheduler.tick(graph.run.id);
    await firstEntered.promise;
    clock = '2026-07-13T00:00:30.000Z';
    expect((await secondScheduler.tick(graph.run.id)).startedStepIds).toEqual([]);
    clock = '2026-07-13T00:01:00.000Z';
    const recovered = await secondScheduler.recover(graph.run.id);
    expect(recovered.startedStepIds).toEqual(['leased-step']);
    expect(adapter.adapterCalls).toBe(2);
    expect(adapter.actualEffectCount()).toBe(1);
    expect(store.getGraph(graph.run.id)!.run.state).toBe('completed');

    releaseFirst.resolve();
    await firstTick;
    expect(store.getGraph(graph.run.id)!.run.state).toBe('completed');
    expect(
      raw
        .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'step.completed'")
        .get(graph.run.id),
    ).toEqual({ count: 1 });
  });

  it('heartbeats a long execution so another Scheduler cannot recover its live lease', async () => {
    const { store, secondStore } = await openFixture(true);
    const graph = approve(store, [planStep('heartbeat-step', firstAgent)]);
    const entered = deferred();
    const releaseExecution = deferred();
    const releaseHeartbeat = deferred();
    const heartbeatRefreshed = deferred();
    let waitCalls = 0;
    let clock = '2026-07-13T00:00:00.000Z';
    const scheduler = new Scheduler({
      store,
      ownerId: 'heartbeat-owner',
      now: () => clock,
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 20_000,
      wait: async (_delay, signal) => {
        waitCalls += 1;
        if (waitCalls === 1) return releaseHeartbeat.promise;
        heartbeatRefreshed.resolve();
        return waitUntilAborted(signal);
      },
      executor: {
        async execute() {
          entered.resolve();
          await releaseExecution.promise;
          return {};
        },
      },
    });
    const ticking = scheduler.tick(graph.run.id);
    await entered.promise;
    clock = '2026-07-13T00:00:40.000Z';
    releaseHeartbeat.resolve();
    await heartbeatRefreshed.promise;

    clock = '2026-07-13T00:01:00.000Z';
    expect(secondStore!.recoverRun(graph.run.id, clock).steps[0]).toMatchObject({
      state: 'running',
      leaseExpiresAt: '2026-07-13T00:01:40.000Z',
    });
    releaseExecution.resolve();
    await ticking;
  });

  it('aborts and durably fails execution when lease heartbeat refresh throws', async () => {
    const { raw, store } = await openFixture();
    const graph = approve(store, [planStep('heartbeat-failure-step', firstAgent)]);
    const entered = deferred<StepExecutionContext>();
    const heartbeatDue = deferred();
    const releaseExecution = deferred();
    const heartbeatAbortedExecution = deferred();
    store.refreshStepLease = () => {
      throw new Error('injected refresh storage failure');
    };
    const scheduler = new Scheduler({
      store,
      ownerId: 'heartbeat-failure-owner',
      heartbeatIntervalMs: 1,
      wait: () => heartbeatDue.promise,
      executor: {
        execute(context) {
          entered.resolve(context);
          return new Promise((resolve) => {
            const settle = () => {
              heartbeatAbortedExecution.resolve();
              resolve({});
            };
            context.signal.addEventListener('abort', settle, { once: true });
            void releaseExecution.promise.then(settle);
          });
        },
      },
    });

    const ticking = scheduler.tick(graph.run.id);
    const context = await entered.promise;
    heartbeatDue.resolve();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abortedByHeartbeat = await Promise.race([
      heartbeatAbortedExecution.promise.then(() => context.signal.aborted),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 100);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    releaseExecution.resolve();
    const tickError = await ticking.then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(abortedByHeartbeat).toBe(true);
    expect(tickError).toBeUndefined();
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'failed' },
      steps: [{ id: 'heartbeat-failure-step', state: 'failed' }],
    });
    const failedPayload = JSON.parse(
      (
        raw
          .prepare("SELECT payload_json FROM event WHERE run_id = ? AND type = 'step.failed'")
          .get(graph.run.id) as { payload_json: string }
      ).payload_json,
    ) as Record<string, unknown>;
    expect(failedPayload).toMatchObject({
      failureClass: 'transient',
      code: 'step.executor.transient',
      summary: 'Step lease heartbeat refresh failed',
    });
    expect(
      raw
        .prepare(
          `SELECT type, COUNT(*) AS count FROM event
           WHERE run_id = ? AND type IN ('step.failed', 'run.failed')
           GROUP BY type ORDER BY type`,
        )
        .all(graph.run.id),
    ).toEqual([
      { type: 'run.failed', count: 1 },
      { type: 'step.failed', count: 1 },
    ]);
    await scheduler.shutdown();
  });

  it('fails and cleans up when a lost lease executor ignores AbortSignal forever', async () => {
    const { raw, store } = await openFixture();
    const graph = approve(store, [planStep('lease-lost-ignoring-signal', firstAgent)]);
    const entered = deferred<StepExecutionContext>();
    const heartbeatDue = deferred();
    store.refreshStepLease = () => false;
    const scheduler = new Scheduler({
      store,
      ownerId: 'lease-lost-owner',
      heartbeatIntervalMs: 1,
      wait: () => heartbeatDue.promise,
      executor: {
        execute(context) {
          entered.resolve(context);
          return new Promise(() => undefined);
        },
      },
    });

    const ticking = scheduler.tick(graph.run.id);
    const context = await entered.promise;
    heartbeatDue.resolve();
    const tickSettled = await settlesWithin(ticking);
    const shuttingDown = scheduler.shutdown();
    const shutdownSettled = await settlesWithin(shuttingDown);
    const internals = scheduler as unknown as {
      active: Map<string, AbortController>;
      activeExecutions: Set<Promise<void>>;
    };

    expect(context.signal.aborted).toBe(true);
    expect(tickSettled).toBe(true);
    expect(shutdownSettled).toBe(true);
    expect(internals.active.size).toBe(0);
    expect(internals.activeExecutions.size).toBe(0);
    expect(store.getGraph(graph.run.id)).toMatchObject({
      run: { state: 'failed' },
      steps: [{ id: 'lease-lost-ignoring-signal', state: 'failed' }],
    });
    expect(
      raw
        .prepare(
          `SELECT type, COUNT(*) AS count FROM event
           WHERE run_id = ? AND type IN ('step.failed', 'run.failed')
           GROUP BY type ORDER BY type`,
        )
        .all(graph.run.id),
    ).toEqual([
      { type: 'run.failed', count: 1 },
      { type: 'step.failed', count: 1 },
    ]);
  });

  it('waits for an unexpired startup lease and recovers it exactly at expiry', async () => {
    const { store } = await openFixture();
    const graph = approve(store, [planStep('startup-lease', firstAgent)]);
    store.claimReadySteps({
      runId: graph.run.id,
      stepIds: ['startup-lease' as StepId],
      ownerId: 'stopped-owner',
      leaseExpiresAt: '2026-07-13T00:01:00.000Z',
      now: '2026-07-13T00:00:00.000Z',
    });
    const releaseLeaseWait = deferred();
    const scheduledDelays: number[] = [];
    const executed: string[] = [];
    let clock = '2026-07-13T00:00:00.000Z';
    const scheduler = new Scheduler({
      store,
      ownerId: 'recovery-owner',
      now: () => clock,
      wait: (delay) => {
        scheduledDelays.push(delay);
        return releaseLeaseWait.promise;
      },
      executor: {
        async execute(context) {
          executed.push(context.step.id);
          return {};
        },
      },
    });

    const recovering = scheduler.recover(graph.run.id);
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduledDelays).toEqual([60_000]);
    clock = '2026-07-13T00:01:00.000Z';
    releaseLeaseWait.resolve();
    expect((await recovering).startedStepIds).toEqual(['startup-lease']);
    expect(executed).toEqual(['startup-lease']);
  });

  it('aborts active execution and waits for it to settle during shutdown', async () => {
    const { store } = await openFixture();
    const graph = approve(store, [planStep('shutdown-step', firstAgent)]);
    const entered = deferred<StepExecutionContext>();
    const scheduler = new Scheduler({
      store,
      executor: {
        execute(context) {
          entered.resolve(context);
          return new Promise((resolve) => {
            context.signal.addEventListener('abort', () => resolve({}), { once: true });
          });
        },
      },
    });
    const ticking = scheduler.tick(graph.run.id);
    const context = await entered.promise;

    await scheduler.shutdown();
    await ticking;
    expect(context.signal.aborted).toBe(true);
    expect((await scheduler.tick(graph.run.id)).startedStepIds).toEqual([]);
    expect(store.getGraph(graph.run.id)!.steps[0]!.state).toBe('running');
  });
});
