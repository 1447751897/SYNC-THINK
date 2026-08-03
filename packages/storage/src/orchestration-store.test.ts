import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentVersionId,
  ModelId,
  PlanStepDraft,
  StepId,
  TaskId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import { SqliteArtifactStore } from './artifact-store.js';
import { SqliteOrchestrationStore } from './orchestration-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];
const nodeRequire = createRequire(import.meta.url);
const betterSqlite3ModulePath = nodeRequire.resolve('better-sqlite3');
const taskId = 'task-orchestration' as TaskId;
const plannerVersionId = 'agent-version-planner' as AgentVersionId;
const writerVersionId = 'agent-version-writer' as AgentVersionId;

function fenceTestInstant(secondsFromStart: number): string {
  return new Date(Date.UTC(2026, 6, 13, 0, 0, secondsFromStart)).toISOString();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-orchestration-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

function seedTask(raw: BetterSQLite3Raw): void {
  raw.prepare(
    `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('workspace-orchestration', 'D:\\projects\\orchestration', 'Orchestration', 'now', 'now');
  raw.prepare(
    `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'active', 'collaboration', '[]', 0, ?, ?)`,
  ).run(taskId, 'workspace-orchestration', 'Ship M2', 'Persist an approved plan', 'now', 'now');
}

function seedAgentVersion(raw: BetterSQLite3Raw, id: AgentVersionId, modelId: string): void {
  raw.prepare(
    `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, created_at
     ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL, 1, '[]', 'task', '[]', '[]', NULL, 'request', ?)`,
  ).run(
    id,
    `agent-${id}`,
    String(id),
    'worker',
    'Complete the assigned plan step.',
    'plan step',
    'step result',
    modelId,
    `credential-group-${id}`,
    '2026-07-13T01:00:00.000Z',
  );
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  seedTask(connection.raw);
  seedAgentVersion(connection.raw, plannerVersionId, 'model-planner');
  seedAgentVersion(connection.raw, writerVersionId, 'model-writer');
  return {
    raw: connection.raw,
    store: new SqliteOrchestrationStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

async function openStorePair() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const first = await openDatabaseAsync({ path: dbPath });
  seedTask(first.raw);
  seedAgentVersion(first.raw, plannerVersionId, 'model-planner');
  seedAgentVersion(first.raw, writerVersionId, 'model-writer');
  const second = await openDatabaseAsync({ path: dbPath });
  first.raw.pragma('busy_timeout = 5000');
  second.raw.pragma('busy_timeout = 5000');
  return {
    dbPath,
    firstRaw: first.raw,
    firstStore: new SqliteOrchestrationStore(first.raw),
    secondRaw: second.raw,
    secondStore: new SqliteOrchestrationStore(second.raw),
    close: () => {
      second.raw.close();
      first.raw.close();
    },
  };
}

type ExternalWriterInput =
  | {
      operation: 'revise';
      planId: string;
      expectedRevision: number;
      revisionId: string;
      title: string;
      steps: PlanStepDraft[];
      diff: unknown;
      now: string;
    }
  | {
      operation: 'approve';
      planId: string;
      revision: number;
      runId: string;
      now: string;
    };

interface ExternalWriterResult {
  operation: 'revise' | 'approve';
  revisionId?: string;
  runId?: string;
  lockAcquiredAt: number;
  committedAt: number;
}

interface WriterCompetitionResult<T> {
  mainResult?: T;
  mainError?: unknown;
  mainStartedAt: number;
  mainCompletedAt: number;
  mainWaitMs: number;
  workerResult: ExternalWriterResult;
}

const EXTERNAL_WRITER_SOURCE = String.raw`
  const { parentPort, workerData } = require('node:worker_threads');
  const Database = require(workerData.betterSqlite3ModulePath);
  const barrier = new Int32Array(workerData.barrier);
  const db = new Database(workerData.dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  function holdWriteLock() {
    const lockAcquiredAt = Date.now();
    Atomics.store(barrier, 0, 1);
    Atomics.notify(barrier, 0);
    Atomics.wait(barrier, 1, 0, 5000);
    if (Atomics.load(barrier, 1) !== 1) {
      throw new Error('main writer did not reach contention barrier');
    }
    Atomics.wait(barrier, 2, 0, workerData.holdMs);
    return lockAcquiredAt;
  }

  try {
    db.exec('BEGIN IMMEDIATE');
    let result;
    const input = workerData.input;
    if (input.operation === 'revise') {
      const latest = db
        .prepare('SELECT MAX(revision) AS revision FROM plan_revision WHERE plan_id = ?')
        .get(input.planId);
      if (latest.revision !== input.expectedRevision) {
        throw new Error('worker stale revision');
      }
      db.prepare(
        "INSERT INTO plan_revision (id, plan_id, revision, title, steps_json, diff_json, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)",
      ).run(
        input.revisionId,
        input.planId,
        input.expectedRevision + 1,
        input.title,
        JSON.stringify(input.steps),
        JSON.stringify(input.diff),
        input.now,
      );
      db.prepare('UPDATE plan SET updated_at = ? WHERE id = ?').run(input.now, input.planId);
      result = { operation: 'revise', revisionId: input.revisionId };
    } else {
      const revision = db.prepare(
        'SELECT revision_row.id, plan_row.task_id, revision_row.steps_json, revision_row.state FROM plan_revision AS revision_row JOIN plan AS plan_row ON plan_row.id = revision_row.plan_id WHERE revision_row.plan_id = ? AND revision_row.revision = ?',
      ).get(input.planId, input.revision);
      if (!revision || revision.state !== 'draft') {
        throw new Error('worker revision not approvable');
      }
      const steps = JSON.parse(revision.steps_json);
      const exactAgent = db.prepare('SELECT id FROM agent_version WHERE id = ?');
      for (const step of steps) {
        if (!exactAgent.get(step.agentVersionId)) {
          throw new Error('worker AgentVersion missing: ' + step.agentVersionId);
        }
      }
      const update = db.prepare(
        "UPDATE plan_revision SET state = 'approved', approved_at = ? WHERE id = ? AND state = 'draft'",
      ).run(input.now, revision.id);
      if (update.changes !== 1) throw new Error('worker approval conflict');
      db.prepare(
        "INSERT INTO run (id, task_id, plan_revision_id, state, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)",
      ).run(input.runId, revision.task_id, revision.id, input.now, input.now);
      const insertStep = db.prepare(
        "INSERT INTO step (id, run_id, plan_order, title, instructions, agent_version_id, model_override_id, state, retries, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)",
      );
      const insertDependency = db.prepare(
        'INSERT INTO step_dependency (run_id, step_id, depends_on_step_id) VALUES (?, ?, ?)',
      );
      for (const [planOrder, step] of steps.entries()) {
        insertStep.run(
          step.id,
          input.runId,
          planOrder,
          step.title,
          step.instructions,
          step.agentVersionId,
          step.modelOverrideId ?? null,
          input.now,
          input.now,
        );
      }
      for (const step of steps) {
        for (const dependencyId of step.dependsOn) {
          insertDependency.run(input.runId, step.id, dependencyId);
        }
      }
      result = { operation: 'approve', runId: input.runId };
    }

    const lockAcquiredAt = holdWriteLock();
    db.exec('COMMIT');
    result.lockAcquiredAt = lockAcquiredAt;
    result.committedAt = Date.now();
    Atomics.store(barrier, 0, 2);
    Atomics.notify(barrier, 0);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    Atomics.store(barrier, 0, -1);
    Atomics.notify(barrier, 0);
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    db.close();
  }
`;

async function competeWithExternalWriter<T>(
  dbPath: string,
  input: ExternalWriterInput,
  mainAction: () => T,
): Promise<WriterCompetitionResult<T>> {
  const barrierBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
  const barrier = new Int32Array(barrierBuffer);
  const worker = new Worker(EXTERNAL_WRITER_SOURCE, {
    eval: true,
    workerData: {
      barrier: barrierBuffer,
      betterSqlite3ModulePath,
      dbPath,
      holdMs: 300,
      input,
    },
  });

  const workerResult = new Promise<ExternalWriterResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('external SQLite writer timed out'));
    }, 8_000);
    worker.once('message', (message: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const response = message as
        | { ok: true; result: ExternalWriterResult }
        | { ok: false; error: string };
      if (response.ok) resolve(response.result);
      else reject(new Error(`external SQLite writer failed: ${response.error}`));
    });
    worker.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code) => {
      if (settled || code === 0) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`external SQLite writer exited with code ${code}`));
    });
  });

  try {
    Atomics.wait(barrier, 0, 0, 5_000);
    if (Atomics.load(barrier, 0) !== 1) {
      await workerResult;
      throw new Error('external SQLite writer did not acquire BEGIN IMMEDIATE lock');
    }

    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1);

    let mainResult: T | undefined;
    let mainError: unknown;
    const mainStartedAt = Date.now();
    try {
      mainResult = mainAction();
    } catch (error) {
      mainError = error;
    }
    const mainCompletedAt = Date.now();
    const mainWaitMs = mainCompletedAt - mainStartedAt;
    return {
      mainResult,
      mainError,
      mainStartedAt,
      mainCompletedAt,
      mainWaitMs,
      workerResult: await workerResult,
    };
  } finally {
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1);
    Atomics.store(barrier, 2, 1);
    Atomics.notify(barrier, 2);
    await worker.terminate();
  }
}

function expectDataError(
  action: () => unknown,
  code: string,
  path: string,
): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(TypeError);
  expect(thrown).toMatchObject({
    name: 'OrchestrationDataError',
    code,
    path,
  });
}

function planStep(
  id: string,
  agentVersionId: AgentVersionId,
  overrides: Partial<PlanStepDraft> = {},
): PlanStepDraft {
  return {
    id: id as StepId,
    title: `Step ${id}`,
    instructions: `Complete ${id}`,
    agentVersionId,
    dependsOn: [],
    ...overrides,
  };
}

function v1Steps(): PlanStepDraft[] {
  return [
    planStep('research', plannerVersionId),
    planStep('draft', writerVersionId, { dependsOn: ['research' as StepId] }),
  ];
}

it('pins explicit merge Step kind in immutable PlanRevision and Run graph snapshots', async () => {
  const { store, close } = await openStore();
  try {
    const mergeStep = {
      ...planStep('merge-output', writerVersionId, {
        dependsOn: ['research' as StepId, 'draft' as StepId],
      }),
      kind: 'merge' as const,
    };
    const revision = store.createPlanDraft({
      taskId,
      title: 'Explicit merge plan',
      steps: [
        planStep('research', plannerVersionId),
        planStep('draft', writerVersionId),
        mergeStep,
      ],
    });

    expect(revision.steps[2]).toMatchObject({ id: 'merge-output', kind: 'merge' });
    const graph = store.approvePlan({ planId: revision.planId, revision: 1 });
    expect(graph.steps[2]).toMatchObject({ id: 'merge-output', kind: 'merge' });
  } finally {
    close();
  }
});

describe('SqliteOrchestrationStore immutable revisions', () => {
  it('creates draft v1, revises to v2, rejects stale edits, and lists immutable history', async () => {
    const { store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Ship M2',
        steps: v1Steps(),
        now: '2026-07-13T02:00:00.000Z',
      });
      expect(draft.revision).toBe(1);
      expect(draft.state).toBe('draft');

      const editedSteps = [
        planStep('research', plannerVersionId),
        planStep('draft', writerVersionId, {
          instructions: 'Write the implementation',
          modelOverrideId: 'model-editor' as ModelId,
          dependsOn: ['research' as StepId],
        }),
        planStep('verify', plannerVersionId, { dependsOn: ['draft' as StepId] }),
      ];
      const edited = store.revisePlan({
        planId: draft.planId,
        expectedRevision: 1,
        title: 'Ship M2 safely',
        steps: editedSteps,
        now: '2026-07-13T03:00:00.000Z',
      });

      expect(edited.revision).toBe(2);
      expect(edited.diffFromPrevious.added.map((entry) => entry.id)).toEqual(['verify']);
      expect(edited.diffFromPrevious.changed.map((entry) => entry.id)).toEqual(['draft']);
      expect(store.getPlanRevision(draft.planId, 1)).toEqual(draft);
      expect(store.listPlanRevisions(draft.planId).map((entry) => entry.revision)).toEqual([1, 2]);

      expect(() =>
        store.revisePlan({
          planId: draft.planId,
          expectedRevision: 1,
          steps: v1Steps(),
        }),
      ).toThrow('plan.stale_revision');
      expect(store.getPlanRevision(draft.planId, 1)).toEqual(draft);
      expect(store.getPlanRevision(draft.planId, 2)).toEqual(edited);
    } finally {
      close();
    }
  });

  it('rejects invalid dependencies before persisting a plan', async () => {
    const { raw, store, close } = await openStore();
    try {
      expect(() =>
        store.createPlanDraft({
          taskId,
          title: 'Invalid',
          steps: [
            planStep('draft', writerVersionId, { dependsOn: ['missing' as StepId] }),
          ],
        }),
      ).toThrow('plan.missing_dependency');
      expect((raw.prepare('SELECT COUNT(*) AS count FROM plan').get() as { count: number }).count).toBe(0);
    } finally {
      close();
    }
  });

  it('rejects an empty Step list before persisting a plan', async () => {
    const { raw, store, close } = await openStore();
    try {
      expect(() =>
        store.createPlanDraft({ taskId, title: 'Empty plan', steps: [] }),
      ).toThrow('plan.steps_required');
      expect(raw.prepare('SELECT COUNT(*) AS count FROM plan').get()).toEqual({ count: 0 });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM plan_revision').get()).toEqual({ count: 0 });
    } finally {
      close();
    }
  });

  it('fails with recognizable paths for malformed persisted PlanStep fields', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'Decode steps', steps: v1Steps() });
      const valid = draft.steps[0]!;
      const malformed: Array<{ value: unknown; path: string }> = [
        { value: [null], path: 'steps[0]' },
        { value: [{ ...valid, id: 42 }], path: 'steps[0].id' },
        { value: [{ ...valid, title: null }], path: 'steps[0].title' },
        { value: [{ ...valid, instructions: false }], path: 'steps[0].instructions' },
        { value: [{ ...valid, agentVersionId: {} }], path: 'steps[0].agentVersionId' },
        { value: [{ ...valid, modelOverrideId: 42 }], path: 'steps[0].modelOverrideId' },
        { value: [{ ...valid, dependsOn: 'research' }], path: 'steps[0].dependsOn' },
        { value: [{ ...valid, dependsOn: [42] }], path: 'steps[0].dependsOn[0]' },
      ];

      for (const entry of malformed) {
        raw.prepare('UPDATE plan_revision SET steps_json = ? WHERE id = ?').run(
          JSON.stringify(entry.value),
          draft.id,
        );
        expectDataError(
          () => store.getPlanRevision(draft.planId, 1),
          'plan.invalid_steps_json',
          entry.path,
        );
      }
    } finally {
      close();
    }
  });

  it('fully validates persisted PlanDiff entries instead of casting nested data', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'Decode diff', steps: v1Steps() });
      const validStep = draft.steps[0]!;
      const validChange = {
        id: validStep.id,
        before: validStep,
        after: { ...validStep, instructions: 'Changed' },
        changedFields: ['instructions'],
        beforePlanOrder: 0,
        afterPlanOrder: 0,
      };
      const malformed: Array<{ value: unknown; path: string }> = [
        {
          value: { added: [null], removed: [], changed: [] },
          path: 'diff.added[0]',
        },
        {
          value: { added: [], removed: [{ ...validStep, dependsOn: 1 }], changed: [] },
          path: 'diff.removed[0].dependsOn',
        },
        {
          value: { added: [], removed: [], changed: [{ ...validChange, id: 7 }] },
          path: 'diff.changed[0].id',
        },
        {
          value: { added: [], removed: [], changed: [{ ...validChange, before: null }] },
          path: 'diff.changed[0].before',
        },
        {
          value: { added: [], removed: [], changed: [{ ...validChange, after: null }] },
          path: 'diff.changed[0].after',
        },
        {
          value: {
            added: [],
            removed: [],
            changed: [{ ...validChange, changedFields: ['not-a-field'] }],
          },
          path: 'diff.changed[0].changedFields[0]',
        },
        {
          value: {
            added: [],
            removed: [],
            changed: [{ ...validChange, beforePlanOrder: -1 }],
          },
          path: 'diff.changed[0].beforePlanOrder',
        },
      ];

      for (const entry of malformed) {
        raw.prepare('UPDATE plan_revision SET diff_json = ? WHERE id = ?').run(
          JSON.stringify(entry.value),
          draft.id,
        );
        expectDataError(
          () => store.getPlanRevision(draft.planId, 1),
          'plan.invalid_diff_json',
          entry.path,
        );
      }
    } finally {
      close();
    }
  });
});

describe('SqliteOrchestrationStore approval transaction', () => {
  it('approves one revision and atomically creates a queued exact-pinned Run graph', async () => {
    const { store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'Ship M2', steps: v1Steps() });
      const edited = store.revisePlan({
        planId: draft.planId,
        expectedRevision: 1,
        steps: [
          planStep('research', plannerVersionId),
          planStep('draft', writerVersionId, {
            modelOverrideId: 'model-editor' as ModelId,
            dependsOn: ['research' as StepId],
          }),
        ],
      });

      const approved = store.approvePlan({
        planId: draft.planId,
        revision: 2,
        now: '2026-07-13T04:00:00.000Z',
      });

      expect(store.getPlanRevision(draft.planId, 2)).toMatchObject({
        id: edited.id,
        state: 'approved',
        approvedAt: '2026-07-13T04:00:00.000Z',
      });
      expect(approved.run).toMatchObject({
        taskId,
        state: 'queued',
        planRevisionId: edited.id,
        stepIds: ['research', 'draft'],
      });
      expect(approved.steps).toEqual([
        expect.objectContaining({
          id: 'research',
          planOrder: 0,
          agentVersionId: plannerVersionId,
          modelOverrideId: undefined,
          dependsOn: [],
          state: 'pending',
        }),
        expect.objectContaining({
          id: 'draft',
          planOrder: 1,
          agentVersionId: writerVersionId,
          modelOverrideId: 'model-editor',
          dependsOn: ['research'],
          state: 'pending',
        }),
      ]);
      expect(approved.dependencies).toEqual([
        { runId: approved.run.id, stepId: 'draft', dependsOnStepId: 'research' },
      ]);
      expect(store.hasApprovedPlan(taskId)).toBe(true);
      expect(store.getRun(approved.run.id)).toEqual(approved.run);
      expect(store.getGraph(approved.run.id)).toEqual(approved);
    } finally {
      close();
    }
  });

  it('rolls back approval when an exact AgentVersion is missing', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Missing AgentVersion',
        steps: [planStep('draft', 'missing-agent-version' as AgentVersionId)],
      });

      expect(() => store.approvePlan({ planId: draft.planId, revision: 1 })).toThrow(
        'AgentVersion not found: missing-agent-version',
      );
      expect(store.getPlanRevision(draft.planId, 1)).toEqual(draft);
      expect(store.hasApprovedPlan(taskId)).toBe(false);
      expect((raw.prepare('SELECT COUNT(*) AS count FROM run').get() as { count: number }).count).toBe(0);
      expect((raw.prepare('SELECT COUNT(*) AS count FROM step').get() as { count: number }).count).toBe(0);
    } finally {
      close();
    }
  });

  it('rolls back the revision, Run, and Steps when dependency insertion fails', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'Rollback', steps: v1Steps() });
      raw.exec(`
        CREATE TRIGGER fail_step_dependency
        BEFORE INSERT ON step_dependency
        BEGIN
          SELECT RAISE(ABORT, 'forced dependency failure');
        END;
      `);

      expect(() => store.approvePlan({ planId: draft.planId, revision: 1 })).toThrow(
        'forced dependency failure',
      );
      expect(store.getPlanRevision(draft.planId, 1)).toEqual(draft);
      expect((raw.prepare('SELECT COUNT(*) AS count FROM run').get() as { count: number }).count).toBe(0);
      expect((raw.prepare('SELECT COUNT(*) AS count FROM step').get() as { count: number }).count).toBe(0);
      expect(
        (raw.prepare('SELECT COUNT(*) AS count FROM step_dependency').get() as { count: number }).count,
      ).toBe(0);
    } finally {
      close();
    }
  });

  it('creates draft v3 from approved v2 without repinning its Run and makes repeat approval idempotent', async () => {
    const { raw, store, close } = await openStore();
    try {
      const v1 = store.createPlanDraft({ taskId, title: 'Ship M2', steps: v1Steps() });
      const v2 = store.revisePlan({
        planId: v1.planId,
        expectedRevision: 1,
        steps: v1Steps(),
      });
      const firstApproval = store.approvePlan({ planId: v1.planId, revision: 2 });
      const approvedV2 = store.getPlanRevision(v1.planId, 2);

      const v3 = store.revisePlan({
        planId: v1.planId,
        expectedRevision: 2,
        steps: [
          ...v1Steps(),
          planStep('review', plannerVersionId, { dependsOn: ['draft' as StepId] }),
        ],
      });
      const repeatedApproval = store.approvePlan({ planId: v1.planId, revision: 2 });

      expect(v3).toMatchObject({ revision: 3, state: 'draft' });
      expect(store.getPlanRevision(v1.planId, 2)).toEqual(approvedV2);
      expect(store.getRun(firstApproval.run.id)?.planRevisionId).toBe(v2.id);
      expect(store.getGraph(firstApproval.run.id)).toEqual(firstApproval);
      expect(repeatedApproval).toEqual(firstApproval);
      expect((raw.prepare('SELECT COUNT(*) AS count FROM run').get() as { count: number }).count).toBe(1);
    } finally {
      close();
    }
  });

  it('fails closed when persisted Run or Step state is outside its shared whitelist', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'State checks', steps: v1Steps() });
      const approved = store.approvePlan({ planId: draft.planId, revision: 1 });

      expect(() =>
        raw.prepare("UPDATE run SET state = 'corrupt' WHERE id = ?").run(approved.run.id),
      ).toThrow(/CHECK constraint failed/);
      expect(() =>
        raw
          .prepare("UPDATE step SET state = 'corrupt' WHERE run_id = ? AND id = ?")
          .run(approved.run.id, approved.steps[0]!.id),
      ).toThrow(/CHECK constraint failed/);

      raw.pragma('ignore_check_constraints = ON');
      try {
        raw.prepare("UPDATE run SET state = 'corrupt' WHERE id = ?").run(approved.run.id);
      } finally {
        raw.pragma('ignore_check_constraints = OFF');
      }
      expectDataError(() => store.getRun(approved.run.id), 'run.invalid_state', 'run.state');

      raw.pragma('ignore_check_constraints = ON');
      try {
        raw.prepare("UPDATE run SET state = 'queued' WHERE id = ?").run(approved.run.id);
        raw
          .prepare("UPDATE step SET state = 'corrupt' WHERE run_id = ? AND id = ?")
          .run(approved.run.id, approved.steps[0]!.id);
      } finally {
        raw.pragma('ignore_check_constraints = OFF');
      }
      expectDataError(() => store.getGraph(approved.run.id), 'step.invalid_state', 'step.state');
    } finally {
      close();
    }
  });

  it('serializes revise and approve against a real external BEGIN IMMEDIATE writer', async () => {
    const { dbPath, firstRaw, firstStore, secondRaw, secondStore, close } = await openStorePair();
    try {
      const v1 = firstStore.createPlanDraft({ taskId, title: 'Cross connection', steps: v1Steps() });
      // The raw worker is only a deterministic external writer. The contending
      // main-thread operation always exercises SqliteOrchestrationStore.
      const reviseCompetition = await competeWithExternalWriter(
        dbPath,
        {
          operation: 'revise',
          planId: v1.planId,
          expectedRevision: 1,
          revisionId: 'worker-plan-revision-v2',
          title: v1.title,
          steps: v1.steps,
          diff: { added: [], removed: [], changed: [] },
          now: '2026-07-13T05:00:00.000Z',
        },
        () =>
          secondStore.revisePlan({
            planId: v1.planId,
            expectedRevision: 1,
            steps: v1Steps(),
          }),
      );
      expect(reviseCompetition.mainWaitMs).toBeGreaterThanOrEqual(150);
      expect(reviseCompetition.workerResult.lockAcquiredAt).toBeLessThanOrEqual(
        reviseCompetition.mainStartedAt,
      );
      expect(reviseCompetition.mainStartedAt).toBeLessThan(
        reviseCompetition.workerResult.committedAt,
      );
      expect(reviseCompetition.workerResult.committedAt).toBeLessThanOrEqual(
        reviseCompetition.mainCompletedAt,
      );
      expect(reviseCompetition.mainError).toBeInstanceOf(Error);
      expect((reviseCompetition.mainError as Error).message).toContain('plan.stale_revision');
      expect(reviseCompetition.workerResult).toMatchObject({
        operation: 'revise',
        revisionId: 'worker-plan-revision-v2',
      });

      const v2 = secondStore.getPlanRevision(v1.planId, 2);
      expect(v2?.id).toBe('worker-plan-revision-v2');
      expect(secondStore.listPlanRevisions(v1.planId).map((revision) => revision.id)).toEqual([
        v1.id,
        v2!.id,
      ]);
      expect(
        (
          secondRaw
            .prepare('SELECT COUNT(*) AS count FROM plan_revision WHERE plan_id = ? AND revision = 2')
            .get(v1.planId) as { count: number }
        ).count,
      ).toBe(1);

      const approveCompetition = await competeWithExternalWriter(
        dbPath,
        {
          operation: 'approve',
          planId: v1.planId,
          revision: 2,
          runId: 'worker-approved-run',
          now: '2026-07-13T06:00:00.000Z',
        },
        () => secondStore.approvePlan({ planId: v1.planId, revision: 2 }),
      );
      expect(approveCompetition.mainWaitMs).toBeGreaterThanOrEqual(150);
      expect(approveCompetition.workerResult.lockAcquiredAt).toBeLessThanOrEqual(
        approveCompetition.mainStartedAt,
      );
      expect(approveCompetition.mainStartedAt).toBeLessThan(
        approveCompetition.workerResult.committedAt,
      );
      expect(approveCompetition.workerResult.committedAt).toBeLessThanOrEqual(
        approveCompetition.mainCompletedAt,
      );
      expect(approveCompetition.mainError).toBeUndefined();
      expect(approveCompetition.workerResult).toMatchObject({
        operation: 'approve',
        runId: 'worker-approved-run',
      });
      const mainApproval = approveCompetition.mainResult!;
      expect(mainApproval.run.id).toBe('worker-approved-run');
      expect(firstStore.getGraph(mainApproval.run.id)).toEqual(mainApproval);
      expect(secondStore.getGraph(mainApproval.run.id)).toEqual(mainApproval);
      expect(
        (
          firstRaw
            .prepare('SELECT COUNT(*) AS count FROM run WHERE plan_revision_id = ?')
            .get(v2!.id) as { count: number }
        ).count,
      ).toBe(1);
      expect(
        (
          firstRaw
            .prepare('SELECT COUNT(*) AS count FROM step WHERE run_id = ?')
            .get(mainApproval.run.id) as { count: number }
        ).count,
      ).toBe(v2!.steps.length);
      expect(
        (
          firstRaw
            .prepare('SELECT COUNT(*) AS count FROM step_dependency WHERE run_id = ?')
            .get(mainApproval.run.id) as { count: number }
        ).count,
      ).toBe(v2!.steps.reduce((count, step) => count + step.dependsOn.length, 0));
    } finally {
      close();
    }
  });
});

describe('SqliteOrchestrationStore durable scheduler transitions', () => {
  it('atomically claims ready steps with stable intents and recovers the same IDs and keys', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'Durable claim', steps: v1Steps() });
      const approved = store.approvePlan({ planId: draft.planId, revision: 1, now: 't0' });

      raw.exec(`
        CREATE TRIGGER fail_scheduler_checkpoint
        BEFORE INSERT ON checkpoint
        BEGIN
          SELECT RAISE(ABORT, 'forced scheduler checkpoint failure');
        END;
      `);
      expect(() =>
        store.claimReadySteps({
          runId: approved.run.id,
          stepIds: ['research' as StepId],
          ownerId: 'storage-test-owner',
          leaseExpiresAt: 't3',
          now: 't1',
        }),
      ).toThrow('forced scheduler checkpoint failure');
      const rolledBack = store.getGraph(approved.run.id)!;
      expect(rolledBack.run.state).toBe('queued');
      expect(rolledBack.steps.find((entry) => entry.id === ('research' as StepId))).toMatchObject({
        state: 'pending',
        idempotencyKey: undefined,
      });
      expect((raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number }).count).toBe(0);

      raw.exec('DROP TRIGGER fail_scheduler_checkpoint');
      const firstClaim = store.claimReadySteps({
        runId: approved.run.id,
        stepIds: ['research' as StepId],
        ownerId: 'storage-test-owner',
        leaseExpiresAt: 't3',
        now: 't2',
      });
      expect(firstClaim.claimedSteps).toHaveLength(1);
      expect(firstClaim.claimedSteps[0]).toMatchObject({ id: 'research', state: 'running' });
      const stableKey = firstClaim.claimedSteps[0]!.idempotencyKey;
      expect(stableKey).toMatch(/^[0-9a-f]{64}$/);
      expect(
        raw.prepare('SELECT type FROM event WHERE run_id = ? ORDER BY sequence').all(approved.run.id),
      ).toEqual([
        { type: 'run.running' },
        { type: 'step.ready' },
        { type: 'step.started' },
      ]);
      expect(
        raw.prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?').get(approved.run.id),
      ).toEqual({ count: 1 });

      const recovered = store.recoverRun(approved.run.id, 't3');
      expect(recovered.steps.find((entry) => entry.id === ('research' as StepId))).toMatchObject({
        state: 'ready',
        idempotencyKey: stableKey,
      });
      const retryClaim = store.claimReadySteps({
        runId: approved.run.id,
        stepIds: ['research' as StepId],
        ownerId: 'storage-test-owner',
        leaseExpiresAt: 't9',
        now: 't4',
      });
      expect(retryClaim.claimedSteps[0]).toMatchObject({
        id: 'research',
        state: 'running',
        idempotencyKey: stableKey,
      });
    } finally {
      close();
    }
  });

  it('leases a Step to one owner and fences a stale owner after expiry recovery', async () => {
    const { store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Fenced execution',
        steps: [planStep('leased', writerVersionId)],
      });
      const graph = store.approvePlan({ planId: draft.planId, revision: 1, now: '2026-07-13T00:00:00.000Z' });
      expect(() =>
        store.claimReadySteps({
          runId: graph.run.id,
          stepIds: ['leased' as StepId],
          ownerId: 'migration:0014:legacy-terminal',
          leaseExpiresAt: '2026-07-13T00:01:00.000Z',
          now: '2026-07-13T00:00:00.000Z',
        }),
      ).toThrow('step.execution_owner_reserved');
      const firstClaim = store.claimReadySteps({
        runId: graph.run.id,
        stepIds: ['leased' as StepId],
        ownerId: 'owner-a',
        leaseExpiresAt: '2026-07-13T00:01:00.000Z',
        now: '2026-07-13T00:00:00.000Z',
      } as Parameters<typeof store.claimReadySteps>[0] & { ownerId: string; leaseExpiresAt: string });
      expect(firstClaim.claimedSteps[0]).toMatchObject({
        executionOwnerId: 'owner-a',
        executionAttempt: 1,
        leaseExpiresAt: '2026-07-13T00:01:00.000Z',
      });
      expect(
        store.claimReadySteps({
          runId: graph.run.id,
          stepIds: ['leased' as StepId],
          ownerId: 'owner-b',
          leaseExpiresAt: '2026-07-13T00:01:30.000Z',
          now: '2026-07-13T00:00:30.000Z',
        } as Parameters<typeof store.claimReadySteps>[0] & { ownerId: string; leaseExpiresAt: string }).claimedSteps,
      ).toHaveLength(0);
      expect(store.recoverRun(graph.run.id, '2026-07-13T00:00:59.000Z').steps[0]!.state).toBe('running');
      expect(store.recoverRun(graph.run.id, '2026-07-13T00:01:00.000Z').steps[0]).toMatchObject({
        state: 'ready',
        executionOwnerId: undefined,
        leaseExpiresAt: undefined,
      });

      const secondClaim = store.claimReadySteps({
        runId: graph.run.id,
        stepIds: ['leased' as StepId],
        ownerId: 'owner-b',
        leaseExpiresAt: '2026-07-13T00:02:00.000Z',
        now: '2026-07-13T00:01:00.000Z',
      } as Parameters<typeof store.claimReadySteps>[0] & { ownerId: string; leaseExpiresAt: string });
      expect(secondClaim.claimedSteps[0]).toMatchObject({
        id: 'leased',
        idempotencyKey: firstClaim.claimedSteps[0]!.idempotencyKey,
        executionOwnerId: 'owner-b',
        executionAttempt: 2,
      });
      let staleFenceError: unknown;
      try {
        store.completeStep({
          runId: graph.run.id,
          stepId: 'leased' as StepId,
          idempotencyKey: firstClaim.claimedSteps[0]!.idempotencyKey!,
          ownerId: 'owner-a',
          executionAttempt: 1,
          now: fenceTestInstant(90),
        } as Parameters<typeof store.completeStep>[0] & {
          ownerId: string;
          executionAttempt: number;
        });
      } catch (error) {
        staleFenceError = error;
      }
      expect(staleFenceError).toMatchObject({
        name: 'StepFenceMismatchError',
        code: 'step.fence_mismatch',
      });
      expect(store.getGraph(graph.run.id)!.steps[0]!.state).toBe('running');
      expect(
        store.completeStep({
          runId: graph.run.id,
          stepId: 'leased' as StepId,
          idempotencyKey: secondClaim.claimedSteps[0]!.idempotencyKey!,
          ownerId: 'owner-b',
          executionAttempt: 2,
          now: fenceTestInstant(90),
        } as Parameters<typeof store.completeStep>[0] & { ownerId: string; executionAttempt: number }).graph.run.state,
      ).toBe('completed');
      expect(() =>
        store.completeStep({
          runId: graph.run.id,
          stepId: 'leased' as StepId,
          idempotencyKey: firstClaim.claimedSteps[0]!.idempotencyKey!,
          ownerId: 'owner-a',
          executionAttempt: 1,
          now: fenceTestInstant(91),
        }),
      ).toThrow('step.fence_mismatch');
    } finally {
      close();
    }
  });

  it.each([
    { transition: 'completeStep', now: '2026-07-13T00:10:01.000Z' },
    { transition: 'failStep', now: '2026-07-13T00:10:00.000Z' },
  ] as const)(
    'rejects $transition after its persisted lease expires without side effects',
    async ({ transition, now }) => {
      const { raw, store, close } = await openStore();
      try {
        const draft = store.createPlanDraft({
          taskId,
          title: `Expired ${transition}`,
          steps: [planStep('expired-step', writerVersionId)],
          now: '2026-07-13T00:00:00.000Z',
        });
        const graph = store.approvePlan({
          planId: draft.planId,
          revision: 1,
          now: '2026-07-13T00:00:01.000Z',
        });
        const running = store.claimReadySteps({
          runId: graph.run.id,
          stepIds: ['expired-step' as StepId],
          ownerId: 'expired-owner',
          leaseExpiresAt: '2026-07-13T00:10:00.000Z',
          now: '2026-07-13T00:00:02.000Z',
        }).claimedSteps[0]!;
        const eventsBefore = raw.prepare('SELECT * FROM event ORDER BY rowid ASC').all();
        const checkpointsBefore = raw.prepare('SELECT * FROM checkpoint ORDER BY rowid ASC').all();

        let thrown: unknown;
        try {
          if (transition === 'completeStep') {
            store.completeStep({
              runId: graph.run.id,
              stepId: running.id,
              idempotencyKey: running.idempotencyKey!,
              ownerId: 'expired-owner',
              executionAttempt: running.executionAttempt,
              outputVersions: [
                {
                  artifactName: 'expired-output.txt',
                  content: 'must not persist',
                  mimeType: 'text/plain',
                  status: 'candidate',
                },
              ],
              now,
            });
          } else {
            store.failStep({
              runId: graph.run.id,
              stepId: running.id,
              idempotencyKey: running.idempotencyKey!,
              ownerId: 'expired-owner',
              executionAttempt: running.executionAttempt,
              failureClass: 'transient',
              failureCode: 'step.executor.transient',
              summary: 'expired failure must not persist',
              partialOutputVersions: [
                {
                  artifactName: 'expired-partial.txt',
                  content: 'must not persist',
                  mimeType: 'text/plain',
                  status: 'candidate',
                },
              ],
              now,
            });
          }
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toMatchObject({
          name: 'StepFenceMismatchError',
          code: 'step.fence_mismatch',
        });
        expect(store.getGraph(graph.run.id)).toMatchObject({
          run: { state: 'running' },
          steps: [
            {
              id: 'expired-step',
              state: 'running',
              leaseExpiresAt: '2026-07-13T00:10:00.000Z',
            },
          ],
        });
        for (const table of ['artifact', 'artifact_version', 'step_output_artifact']) {
          expect(raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
        }
        expect(raw.prepare('SELECT * FROM event ORDER BY rowid ASC').all()).toEqual(eventsBefore);
        expect(raw.prepare('SELECT * FROM checkpoint ORDER BY rowid ASC').all()).toEqual(
          checkpointsBefore,
        );
      } finally {
        close();
      }
    },
  );

  it('atomically commits output versions, completion, next-ready state, events, and checkpoint', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'Durable completion', steps: v1Steps() });
      const approved = store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: fenceTestInstant(0),
      });
      const artifactStore = new SqliteArtifactStore(raw);
      const artifact = artifactStore.createArtifact({
        workspaceId: 'workspace-orchestration' as never,
        taskId,
        runId: approved.run.id,
        name: 'research.txt',
        now: fenceTestInstant(0),
      });
      const claim = store.claimReadySteps({
        runId: approved.run.id,
        stepIds: ['research' as StepId],
        ownerId: 'storage-test-owner',
        leaseExpiresAt: fenceTestInstant(9),
        now: fenceTestInstant(1),
      });
      const idempotencyKey = claim.claimedSteps[0]!.idempotencyKey!;

      raw.exec(`
        CREATE TRIGGER fail_step_completed_event
        BEFORE INSERT ON event WHEN NEW.type = 'step.completed'
        BEGIN
          SELECT RAISE(ABORT, 'forced step completion failure');
        END;
      `);
      expect(() =>
        store.completeStep({
          runId: approved.run.id,
          stepId: 'research' as StepId,
          idempotencyKey,
          ownerId: 'storage-test-owner',
          executionAttempt: claim.claimedSteps[0]!.executionAttempt,
          outputVersions: [
            {
              artifactId: artifact.id,
              content: 'durable output',
              mimeType: 'text/plain',
              status: 'candidate',
            },
          ],
          now: fenceTestInstant(2),
        }),
      ).toThrow('forced step completion failure');
      expect(store.getGraph(approved.run.id)!.steps[0]!.state).toBe('running');
      expect((raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get() as { count: number }).count).toBe(0);

      raw.exec('DROP TRIGGER fail_step_completed_event');
      const completed = store.completeStep({
        runId: approved.run.id,
        stepId: 'research' as StepId,
        idempotencyKey,
        ownerId: 'storage-test-owner',
        executionAttempt: claim.claimedSteps[0]!.executionAttempt,
        outputVersions: [
          {
            artifactId: artifact.id,
            content: 'durable output',
            mimeType: 'text/plain',
            status: 'candidate',
          },
        ],
        now: fenceTestInstant(3),
      });
      expect(completed.outputVersions).toHaveLength(1);
      expect(completed.graph.steps.map((entry) => [entry.id, entry.state])).toEqual([
        ['research', 'completed'],
        ['draft', 'ready'],
      ]);
      expect(
        raw.prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'step.completed'").get(approved.run.id),
      ).toEqual({ count: 1 });

      const replay = store.completeStep({
        runId: approved.run.id,
        stepId: 'research' as StepId,
        idempotencyKey,
        ownerId: 'storage-test-owner',
        executionAttempt: claim.claimedSteps[0]!.executionAttempt,
        outputVersions: [
          {
            artifactId: artifact.id,
            content: 'durable output',
            mimeType: 'text/plain',
            status: 'candidate',
          },
        ],
        now: fenceTestInstant(4),
      });
      expect(replay.outputVersions.map((version) => version.id)).toEqual(
        completed.outputVersions.map((version) => version.id),
      );
      expect((raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get() as { count: number }).count).toBe(1);
      expect(
        raw.prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'step.completed'").get(approved.run.id),
      ).toEqual({ count: 1 });
    } finally {
      close();
    }
  });

  it('creates a production Artifact and Version only inside the successful completion transaction', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Atomic production output',
        steps: [planStep('writer', writerVersionId)],
      });
      const graph = store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: fenceTestInstant(0),
      });
      const claim = store.claimReadySteps({
        runId: graph.run.id,
        stepIds: ['writer' as StepId],
        ownerId: 'production-owner',
        leaseExpiresAt: fenceTestInstant(9),
        now: fenceTestInstant(1),
      });
      const input = {
        runId: graph.run.id,
        stepId: 'writer' as StepId,
        idempotencyKey: claim.claimedSteps[0]!.idempotencyKey!,
        ownerId: 'production-owner',
        executionAttempt: claim.claimedSteps[0]!.executionAttempt,
        outputVersions: [{
          artifactName: 'Production output',
          content: 'durable provider result',
          mimeType: 'text/plain',
          status: 'candidate' as const,
        }],
      };

      raw.exec(`
        CREATE TRIGGER fail_atomic_production_completion
        BEFORE INSERT ON event WHEN NEW.type = 'step.completed'
        BEGIN
          SELECT RAISE(ABORT, 'forced production completion failure');
        END;
      `);
      expect(() => store.completeStep({ ...input, now: fenceTestInstant(2) })).toThrow(
        'forced production completion failure',
      );
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({ count: 0 });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual({ count: 0 });

      raw.exec('DROP TRIGGER fail_atomic_production_completion');
      const completed = store.completeStep({ ...input, now: fenceTestInstant(3) });
      expect(completed.outputVersions).toEqual([
        expect.objectContaining({ content: 'durable provider result', status: 'candidate' }),
      ]);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({ count: 1 });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual({ count: 1 });
    } finally {
      close();
    }
  });

  it('does not create a production Artifact when cancellation wins the completion fence', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Cancelled production output',
        steps: [planStep('writer', writerVersionId)],
      });
      const graph = store.approvePlan({ planId: draft.planId, revision: 1, now: 't0' });
      const claim = store.claimReadySteps({
        runId: graph.run.id,
        stepIds: ['writer' as StepId],
        ownerId: 'production-owner',
        leaseExpiresAt: 't9',
        now: 't1',
      });
      store.cancelRun(graph.run.id, 't2');
      expect(() =>
        store.completeStep({
          runId: graph.run.id,
          stepId: 'writer' as StepId,
          idempotencyKey: claim.claimedSteps[0]!.idempotencyKey!,
          ownerId: 'production-owner',
          executionAttempt: claim.claimedSteps[0]!.executionAttempt,
          outputVersions: [{
            artifactName: 'Must not exist',
            content: 'cancelled output',
            mimeType: 'text/plain',
            status: 'candidate',
          }],
          now: 't3',
        }),
      ).toThrow('step.not_completable');
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact').get()).toEqual({ count: 0 });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual({ count: 0 });
    } finally {
      close();
    }
  });

  it('rejects output artifacts owned by another Run even when both Runs use the same Step ID', async () => {
    const { raw, store, close } = await openStore();
    try {
      const firstDraft = store.createPlanDraft({
        taskId,
        title: 'First Run',
        steps: [planStep('shared-step', writerVersionId)],
      });
      const secondDraft = store.createPlanDraft({
        taskId,
        title: 'Second Run',
        steps: [planStep('shared-step', writerVersionId)],
      });
      const firstRun = store.approvePlan({
        planId: firstDraft.planId,
        revision: 1,
        now: fenceTestInstant(0),
      });
      const secondRun = store.approvePlan({
        planId: secondDraft.planId,
        revision: 1,
        now: fenceTestInstant(0),
      });
      const foreignArtifact = new SqliteArtifactStore(raw).createArtifact({
        workspaceId: 'workspace-orchestration' as never,
        taskId,
        runId: secondRun.run.id,
        name: 'foreign.txt',
        now: fenceTestInstant(0),
      });
      const claim = store.claimReadySteps({
        runId: firstRun.run.id,
        stepIds: ['shared-step' as StepId],
        ownerId: 'storage-test-owner',
        leaseExpiresAt: fenceTestInstant(9),
        now: fenceTestInstant(1),
      });
      const beforeEvents = (
        raw.prepare('SELECT COUNT(*) AS count FROM event WHERE run_id = ?').get(firstRun.run.id) as {
          count: number;
        }
      ).count;
      const beforeCheckpoints = (
        raw.prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?').get(firstRun.run.id) as {
          count: number;
        }
      ).count;

      expect(() =>
        store.completeStep({
          runId: firstRun.run.id,
          stepId: 'shared-step' as StepId,
          idempotencyKey: claim.claimedSteps[0]!.idempotencyKey!,
          ownerId: 'storage-test-owner',
          executionAttempt: claim.claimedSteps[0]!.executionAttempt,
          outputVersions: [
            {
              artifactId: foreignArtifact.id,
              content: 'must not cross Run scope',
              mimeType: 'text/plain',
              status: 'candidate',
            },
          ],
          now: fenceTestInstant(2),
        }),
      ).toThrow('artifact.scope_mismatch');
      expect(store.getGraph(firstRun.run.id)!.steps[0]!.state).toBe('running');
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual({ count: 0 });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM event WHERE run_id = ?').get(firstRun.run.id)).toEqual({
        count: beforeEvents,
      });
      expect(
        raw.prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?').get(firstRun.run.id),
      ).toEqual({ count: beforeCheckpoints });

      expect(() =>
        store.failStep({
          runId: firstRun.run.id,
          stepId: 'shared-step' as StepId,
          idempotencyKey: claim.claimedSteps[0]!.idempotencyKey!,
          ownerId: 'storage-test-owner',
          executionAttempt: claim.claimedSteps[0]!.executionAttempt,
          failureClass: 'unknown',
          failureCode: 'step.executor.unknown',
          summary: 'failed with partial output',
          partialOutputVersions: [
            {
              artifactId: foreignArtifact.id,
              content: 'must not cross Run scope',
              mimeType: 'text/plain',
              status: 'incomplete',
            },
          ],
          now: fenceTestInstant(3),
        }),
      ).toThrow('artifact.scope_mismatch');
      expect(store.getGraph(firstRun.run.id)!.steps[0]!.state).toBe('running');
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual({ count: 0 });
      expect(raw.prepare('SELECT COUNT(*) AS count FROM event WHERE run_id = ?').get(firstRun.run.id)).toEqual({
        count: beforeEvents,
      });
      expect(
        raw.prepare('SELECT COUNT(*) AS count FROM checkpoint WHERE run_id = ?').get(firstRun.run.id),
      ).toEqual({ count: beforeCheckpoints });
    } finally {
      close();
    }
  });

  it('replays only ArtifactVersions mapped to the exact Step transition', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Exact output replay',
        steps: [planStep('writer', writerVersionId)],
      });
      const graph = store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: fenceTestInstant(0),
      });
      const artifactStore = new SqliteArtifactStore(raw);
      const artifact = artifactStore.createArtifact({
        workspaceId: 'workspace-orchestration' as never,
        taskId,
        runId: graph.run.id,
        name: 'writer.txt',
        now: fenceTestInstant(0),
      });
      const historical = artifactStore.createVersion({
        artifactId: artifact.id,
        sourceStepId: 'writer' as StepId,
        content: 'historical output from another transition',
        mimeType: 'text/plain',
        status: 'candidate',
        now: fenceTestInstant(0),
      });
      const claim = store.claimReadySteps({
        runId: graph.run.id,
        stepIds: ['writer' as StepId],
        ownerId: 'storage-test-owner',
        leaseExpiresAt: fenceTestInstant(9),
        now: fenceTestInstant(1),
      });
      const input = {
        runId: graph.run.id,
        stepId: 'writer' as StepId,
        idempotencyKey: claim.claimedSteps[0]!.idempotencyKey!,
        ownerId: 'storage-test-owner',
        executionAttempt: claim.claimedSteps[0]!.executionAttempt,
        outputVersions: [
          {
            artifactId: artifact.id,
            content: 'current transition output',
            mimeType: 'text/plain',
            status: 'candidate' as const,
          },
        ],
      };

      const completed = store.completeStep({ ...input, now: fenceTestInstant(2) });
      expect(completed.outputVersions).toHaveLength(1);
      expect(completed.outputVersions[0]!.id).not.toBe(historical.id);
      const replay = store.completeStep({ ...input, now: fenceTestInstant(3) });
      expect(replay.outputVersions.map((version) => version.id)).toEqual(
        completed.outputVersions.map((version) => version.id),
      );
    } finally {
      close();
    }
  });

  it('replays only incomplete ArtifactVersions mapped to the exact failed transition', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Exact failed output replay',
        steps: [planStep('failing-writer', writerVersionId)],
      });
      const graph = store.approvePlan({
        planId: draft.planId,
        revision: 1,
        now: fenceTestInstant(0),
      });
      const artifactStore = new SqliteArtifactStore(raw);
      const artifact = artifactStore.createArtifact({
        workspaceId: 'workspace-orchestration' as never,
        taskId,
        runId: graph.run.id,
        name: 'failed-writer.txt',
        now: fenceTestInstant(0),
      });
      const historical = artifactStore.createVersion({
        artifactId: artifact.id,
        sourceStepId: 'failing-writer' as StepId,
        content: 'older incomplete output',
        mimeType: 'text/plain',
        status: 'incomplete',
        now: fenceTestInstant(0),
      });
      const claim = store.claimReadySteps({
        runId: graph.run.id,
        stepIds: ['failing-writer' as StepId],
        ownerId: 'storage-test-owner',
        leaseExpiresAt: fenceTestInstant(9),
        now: fenceTestInstant(1),
      });
      const input = {
        runId: graph.run.id,
        stepId: 'failing-writer' as StepId,
        idempotencyKey: claim.claimedSteps[0]!.idempotencyKey!,
        ownerId: 'storage-test-owner',
        executionAttempt: claim.claimedSteps[0]!.executionAttempt,
        failureClass: 'unknown' as const,
        failureCode: 'step.executor.unknown',
        summary: 'failed',
        partialOutputVersions: [
          {
            artifactId: artifact.id,
            content: 'current incomplete output',
            mimeType: 'text/plain',
            status: 'candidate' as const,
          },
        ],
      };

      const failed = store.failStep({ ...input, now: fenceTestInstant(2) });
      expect(failed.partialOutputVersions).toHaveLength(1);
      expect(failed.partialOutputVersions[0]!.id).not.toBe(historical.id);
      expect(
        store.failStep({ ...input, now: fenceTestInstant(3) }).partialOutputVersions,
      ).toEqual(
        failed.partialOutputVersions,
      );
    } finally {
      close();
    }
  });

  it('cancels unfinished steps and emits one terminal event under idempotent replay', async () => {
    const { raw, store, close } = await openStore();
    try {
      const steps = [
        planStep('z-first', plannerVersionId),
        planStep('a-second', writerVersionId),
      ];
      const draft = store.createPlanDraft({ taskId, title: 'Cancel once', steps });
      const approved = store.approvePlan({ planId: draft.planId, revision: 1, now: 't0' });
      store.claimReadySteps({
        runId: approved.run.id,
        stepIds: ['z-first' as StepId, 'a-second' as StepId],
        ownerId: 'storage-test-owner',
        leaseExpiresAt: 't9',
        now: 't1',
      });

      expect(store.cancelRun(approved.run.id, 't2').run.state).toBe('cancelled');
      expect(store.cancelRun(approved.run.id, 't3').run.state).toBe('cancelled');
      expect(store.getGraph(approved.run.id)!.steps.map((entry) => entry.state)).toEqual([
        'cancelled',
        'cancelled',
      ]);
      expect(
        raw.prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.cancelled'").get(approved.run.id),
      ).toEqual({ count: 1 });
      expect(
        raw.prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'step.cancelled'").get(approved.run.id),
      ).toEqual({ count: 2 });
    } finally {
      close();
    }
  });

  it('resumes to failed only when no active, ready, approval, or dependency-ready pending step remains', async () => {
    const { raw, store, close } = await openStore();
    try {
      const steps = [
        planStep('failed-root', plannerVersionId),
        planStep('completed-root', writerVersionId),
        planStep('blocked-child', writerVersionId, {
          dependsOn: ['failed-root' as StepId],
        }),
      ];
      const draft = store.createPlanDraft({ taskId, title: 'Terminal resume', steps });
      const approved = store.approvePlan({ planId: draft.planId, revision: 1, now: 't0' });
      raw.prepare("UPDATE step SET state = 'failed' WHERE run_id = ? AND id = ?").run(
        approved.run.id,
        'failed-root',
      );
      raw.prepare("UPDATE step SET state = 'completed' WHERE run_id = ? AND id = ?").run(
        approved.run.id,
        'completed-root',
      );
      raw.prepare("UPDATE run SET state = 'paused' WHERE id = ?").run(approved.run.id);

      const resumed = store.resumeRun(approved.run.id, 't1');
      expect(resumed.run.state).toBe('failed');
      expect(resumed.steps.find((step) => step.id === ('blocked-child' as StepId))!.state).toBe(
        'pending',
      );
      expect(
        raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE run_id = ? AND type = 'run.failed'")
          .get(approved.run.id),
      ).toEqual({ count: 1 });
    } finally {
      close();
    }
  });

  it('fails closed when a persisted idempotency key is blank', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({ taskId, title: 'Invalid key', steps: v1Steps() });
      const approved = store.approvePlan({ planId: draft.planId, revision: 1 });
      raw.exec('DROP TRIGGER step_idempotency_key_insert_guard');
      raw.exec('DROP TRIGGER step_idempotency_key_update_guard');
      raw.prepare('UPDATE step SET idempotency_key = ? WHERE run_id = ? AND id = ?').run(
        '   ',
        approved.run.id,
        'research',
      );

      expectDataError(
        () => store.getGraph(approved.run.id),
        'step.invalid_idempotency_key',
        'step.idempotencyKey',
      );
    } finally {
      close();
    }
  });
});


describe('image generation plan persistence', () => {
  it('persists exact settings into approved Steps and keeps legacy null compatible', async () => {
    const { raw, store, close } = await openStore();
    try {
      const draft = store.createPlanDraft({
        taskId,
        title: 'Image settings',
        steps: [
          planStep('image', writerVersionId, {
            imageGeneration: { size: '1536x1024', quality: 'high', count: 3 },
          }),
          planStep('legacy', plannerVersionId),
        ],
      });
      expect(draft.steps[0]?.imageGeneration).toEqual({
        size: '1536x1024',
        quality: 'high',
        count: 3,
      });

      const graph = store.approvePlan({ planId: draft.planId, revision: 1 });
      expect(graph.steps[0]?.imageGeneration).toEqual({
        size: '1536x1024',
        quality: 'high',
        count: 3,
      });
      expect(graph.steps[1]?.imageGeneration).toBeUndefined();
      expect(
        raw.prepare('SELECT image_generation_config_json AS value FROM step WHERE id = ?').get('image'),
      ).toEqual({ value: JSON.stringify({ size: '1536x1024', quality: 'high', count: 3 }) });
    } finally {
      close();
    }
  });

  it('rejects malformed and merge-only image generation settings before persistence', async () => {
    const { store, close } = await openStore();
    try {
      expect(() =>
        store.createPlanDraft({
          taskId,
          title: 'Invalid image settings',
          steps: [planStep('image', writerVersionId, { imageGeneration: { size: 'auto', quality: 'high', count: 5 } as never })],
        }),
      ).toThrow(/imageGeneration/);
      expect(() =>
        store.createPlanDraft({
          taskId,
          title: 'Invalid merge settings',
          steps: [planStep('merge', writerVersionId, { kind: 'merge', imageGeneration: { size: 'auto', quality: 'auto', count: 1 } })],
        }),
      ).toThrow(/imageGeneration/);
    } finally {
      close();
    }
  });
});
