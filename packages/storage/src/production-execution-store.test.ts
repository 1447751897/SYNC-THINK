import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentVersionId, StepId, TaskId, WorkspaceId } from '@sync-think/shared';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteOrchestrationStore } from './orchestration-store.js';
import { SqliteProductionExecutionStore } from './production-execution-store.js';

const dirs: string[] = [];
const workspaceId = 'workspace-production-execution' as WorkspaceId;
const taskId = 'task-production-execution' as TaskId;
const agentVersionId = 'agent-version-production-execution' as AgentVersionId;

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function seed(raw: BetterSQLite3Raw) {
  raw.prepare(
    `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES (?, 'D:\\production-execution', 'Production execution', 't0', 't0')`,
  ).run(workspaceId);
  raw.prepare(
    `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, 'Production execution', 'Fence effects', 'active',
       'automatic', '[]', 0, 't0', 't0')`,
  ).run(taskId, workspaceId);
  raw.prepare("INSERT INTO thread (id, task_id, created_at) VALUES ('thread-production-execution', ?, 't0')")
    .run(taskId);
  raw.prepare(
    `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, created_at
     ) VALUES (?, 'agent-production-execution', 1, 'Worker', 'worker', '', '', '',
       'model-production', 'group-production', NULL, 1, '[]', 'task', '[]', '[]',
       NULL, 'request', 't0')`,
  ).run(agentVersionId);
  const orchestration = new SqliteOrchestrationStore(raw);
  const draft = orchestration.createPlanDraft({
    taskId,
    title: 'Production execution',
    steps: [{
      id: 'production-step' as StepId,
      title: 'Production step',
      instructions: 'Execute once',
      agentVersionId,
      dependsOn: [],
    }],
    now: '2026-07-14T00:00:00.000Z',
  });
  const graph = orchestration.approvePlan({
    planId: draft.planId,
    revision: 1,
    now: '2026-07-14T00:00:00.000Z',
  });
  const claim = orchestration.claimReadySteps({
    runId: graph.run.id,
    stepIds: ['production-step' as StepId],
    ownerId: 'owner-production',
    leaseExpiresAt: '2026-07-14T00:10:00.000Z',
    now: '2026-07-14T00:00:01.000Z',
  });
  return { orchestration, runId: graph.run.id, step: claim.claimedSteps[0]! };
}

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-production-execution-store-'));
  dirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return { ...connection, ...seed(connection.raw) };
}

describe('SqliteProductionExecutionStore', () => {
  it('reserves a stable Provider key once and replays the completed result', async () => {
    const f = await fixture();
    try {
      const store = new SqliteProductionExecutionStore(f.raw);
      const input = {
        idempotencyKey: f.step.idempotencyKey!,
        runId: f.runId,
        stepId: f.step.id,
        agentVersionId,
        ownerId: 'owner-production',
        executionAttempt: f.step.executionAttempt,
        now: '2026-07-14T00:00:02.000Z',
      };
      expect(store.reserveProviderExecution(input)).toMatchObject({
        state: 'started',
        created: true,
      });
      expect(store.reserveProviderExecution(input)).toMatchObject({
        state: 'started',
        created: false,
      });
      expect(
        store.releaseProviderExecution({ ...input, now: '2026-07-14T00:00:03.000Z' }),
      ).toMatchObject({ state: 'released' });
      expect(
        store.reserveProviderExecution({ ...input, now: '2026-07-14T00:00:04.000Z' }),
      ).toMatchObject({ state: 'started', created: true });

      const result = {
        outputVersions: [{
          artifactName: 'Production output',
          content: 'provider result',
          mimeType: 'text/plain',
          status: 'candidate' as const,
          metadata: { modelId: 'model-production' },
        }],
      };
      expect(
        store.completeProviderExecution({
          ...input,
          result,
          now: '2026-07-14T00:09:59.999Z',
        }),
      ).toMatchObject({
        state: 'completed',
        result,
      });
      expect(
        store.reserveProviderExecution({ ...input, now: '2026-07-14T00:11:00.000Z' }),
      ).toMatchObject({
        state: 'completed',
        created: false,
        result,
      });
      expect(
        f.raw.prepare('SELECT COUNT(*) AS count FROM provider_execution_reservation').get(),
      ).toEqual({ count: 1 });
    } finally {
      f.raw.close();
    }
  });

  it('persists referenced image results and rejects invalid content representations', async () => {
    const f = await fixture();
    try {
      const store = new SqliteProductionExecutionStore(f.raw);
      const input = {
        idempotencyKey: f.step.idempotencyKey!,
        runId: f.runId,
        stepId: f.step.id,
        agentVersionId,
        ownerId: 'owner-production',
        executionAttempt: f.step.executionAttempt,
        now: '2026-07-14T00:00:02.000Z',
      };
      store.reserveProviderExecution(input);
      const result = {
        outputVersions: [{
          artifactName: 'Generated image',
          contentRef: 'D:\\artifacts\\generated.png',
          contentHash: 'a'.repeat(64),
          mimeType: 'image/png',
          status: 'candidate' as const,
          metadata: { generationKind: 'image' },
        }],
      };
      expect(store.completeProviderExecution({ ...input, result })).toMatchObject({ result });
      expect(store.getCompletedProviderExecution(input)?.result).toEqual(result);

      const unsafeStore = store as unknown as {
        completeProviderExecution(input: unknown): unknown;
      };
      for (const output of [
        { artifactName: 'Missing', mimeType: 'image/png', status: 'candidate' },
        { artifactName: 'Both', content: 'x', contentRef: 'D:\\x.png', contentHash: 'a'.repeat(64), mimeType: 'image/png', status: 'candidate' },
        { artifactName: 'Remote', contentRef: 'https://cdn.test/x.png', contentHash: 'a'.repeat(64), mimeType: 'image/png', status: 'candidate' },
        { artifactName: 'No hash', contentRef: 'D:\\x.png', mimeType: 'image/png', status: 'candidate' },
      ]) {
        expect(() => unsafeStore.completeProviderExecution({
          ...input,
          idempotencyKey: `invalid-${output.artifactName}`,
          result: { outputVersions: [output] },
        })).toThrow();
      }
    } finally {
      f.raw.close();
    }
  });

  it('rejects Provider completion at or after the persisted Step lease expiry', async () => {
    const f = await fixture();
    try {
      const store = new SqliteProductionExecutionStore(f.raw);
      const fence = {
        idempotencyKey: f.step.idempotencyKey!,
        runId: f.runId,
        stepId: f.step.id,
        agentVersionId,
        ownerId: 'owner-production',
        executionAttempt: f.step.executionAttempt,
      };
      store.reserveProviderExecution({ ...fence, now: '2026-07-14T00:09:00.000Z' });
      const result = {
        outputVersions: [
          {
            artifactName: 'Expired output',
            content: 'must not persist',
            mimeType: 'text/plain',
            status: 'candidate' as const,
          },
        ],
      };

      for (const now of ['2026-07-14T00:10:00.000Z', '2026-07-14T00:11:00.000Z']) {
        expect(() => store.completeProviderExecution({ ...fence, result, now })).toThrow(
          'provider.execution_fence_mismatch',
        );
        expect(
          f.raw
            .prepare(
              `SELECT state, result_json AS resultJson
               FROM provider_execution_reservation WHERE idempotency_key = ?`,
            )
            .get(fence.idempotencyKey),
        ).toEqual({ state: 'started', resultJson: null });
      }
    } finally {
      f.raw.close();
    }
  });

  it.each([null, 'not-a-canonical-iso-instant'])(
    'rejects Provider completion when the persisted Step lease is %s',
    async (leaseExpiresAt) => {
      const f = await fixture();
      try {
        const store = new SqliteProductionExecutionStore(f.raw);
        const fence = {
          idempotencyKey: f.step.idempotencyKey!,
          runId: f.runId,
          stepId: f.step.id,
          agentVersionId,
          ownerId: 'owner-production',
          executionAttempt: f.step.executionAttempt,
        };
        store.reserveProviderExecution({ ...fence, now: '2026-07-14T00:09:00.000Z' });
        if (leaseExpiresAt === null) {
          f.raw.exec('DROP TRIGGER step_execution_update_guard');
        }
        f.raw
          .prepare('UPDATE step SET lease_expires_at = ? WHERE run_id = ? AND id = ?')
          .run(leaseExpiresAt, f.runId, f.step.id);

        expect(() =>
          store.completeProviderExecution({
            ...fence,
            result: { outputVersions: [] },
            now: '2026-07-14T00:09:30.000Z',
          }),
        ).toThrow('provider.execution_fence_mismatch');
        expect(
          f.raw
            .prepare(
              `SELECT state, result_json AS resultJson
               FROM provider_execution_reservation WHERE idempotency_key = ?`,
            )
            .get(fence.idempotencyKey),
        ).toEqual({ state: 'started', resultJson: null });
      } finally {
        f.raw.close();
      }
    },
  );

  it('persists an exact MCP intent but refuses to start it after Run cancellation', async () => {
    const f = await fixture();
    try {
      const store = new SqliteProductionExecutionStore(f.raw);
      const intent = store.createMcpActionIntent({
        runId: f.runId,
        stepId: f.step.id,
        agentVersionId,
        ownerId: 'owner-production',
        executionAttempt: f.step.executionAttempt,
        actionDigest: 'a'.repeat(64),
        now: '2026-07-14T00:00:02.000Z',
      });
      expect(intent).toMatchObject({
        runId: f.runId,
        stepId: 'production-step',
        agentVersionId,
        executionOwnerId: 'owner-production',
        executionAttempt: 1,
        actionDigest: 'a'.repeat(64),
        state: 'intent',
      });

      f.orchestration.cancelRun(f.runId, '2026-07-14T00:00:03.000Z');
      expect(() =>
        store.startMcpAction({
          runId: f.runId,
          stepId: f.step.id,
          agentVersionId,
          ownerId: 'owner-production',
          executionAttempt: f.step.executionAttempt,
          actionDigest: 'a'.repeat(64),
          now: '2026-07-14T00:00:04.000Z',
        }),
      ).toThrow('mcp.action_fence_mismatch');
      expect(store.getMcpActionIntent(f.runId, f.step.id, 'a'.repeat(64))).toMatchObject({
        state: 'intent',
      });
    } finally {
      f.raw.close();
    }
  });

  it('rejects MCP start at the persisted Step lease expiry', async () => {
    const f = await fixture();
    try {
      const store = new SqliteProductionExecutionStore(f.raw);
      const fence = {
        runId: f.runId,
        stepId: f.step.id,
        agentVersionId,
        ownerId: 'owner-production',
        executionAttempt: f.step.executionAttempt,
        actionDigest: 'b'.repeat(64),
      };
      store.createMcpActionIntent({ ...fence, now: '2026-07-14T00:09:00.000Z' });

      expect(() =>
        store.startMcpAction({ ...fence, now: '2026-07-14T00:10:00.000Z' }),
      ).toThrow('mcp.action_fence_mismatch');
      expect(store.getMcpActionIntent(f.runId, f.step.id, fence.actionDigest)).toMatchObject({
        state: 'intent',
      });
    } finally {
      f.raw.close();
    }
  });

  it('rejects MCP completion after the persisted Step lease expiry', async () => {
    const f = await fixture();
    try {
      const store = new SqliteProductionExecutionStore(f.raw);
      const fence = {
        runId: f.runId,
        stepId: f.step.id,
        agentVersionId,
        ownerId: 'owner-production',
        executionAttempt: f.step.executionAttempt,
        actionDigest: 'c'.repeat(64),
      };
      store.createMcpActionIntent({ ...fence, now: '2026-07-14T00:09:00.000Z' });
      expect(
        store.startMcpAction({ ...fence, now: '2026-07-14T00:09:30.000Z' }),
      ).toMatchObject({ state: 'started', startedNow: true });

      expect(() =>
        store.completeMcpAction({ ...fence, now: '2026-07-14T00:11:00.000Z' }),
      ).toThrow('mcp.action_fence_mismatch');
      expect(
        f.raw
          .prepare(
            `SELECT state, completed_at AS completedAt
             FROM mcp_action_execution_intent
             WHERE run_id = ? AND step_id = ? AND action_digest = ?`,
          )
          .get(f.runId, f.step.id, fence.actionDigest),
      ).toEqual({ state: 'started', completedAt: null });
    } finally {
      f.raw.close();
    }
  });

  it('completes MCP before expiry and replays the durable completion after expiry', async () => {
    const f = await fixture();
    try {
      const store = new SqliteProductionExecutionStore(f.raw);
      const fence = {
        runId: f.runId,
        stepId: f.step.id,
        agentVersionId,
        ownerId: 'owner-production',
        executionAttempt: f.step.executionAttempt,
        actionDigest: 'd'.repeat(64),
      };
      store.createMcpActionIntent({ ...fence, now: '2026-07-14T00:09:00.000Z' });
      store.startMcpAction({ ...fence, now: '2026-07-14T00:09:30.000Z' });
      expect(
        store.completeMcpAction({ ...fence, now: '2026-07-14T00:09:59.999Z' }),
      ).toMatchObject({ state: 'completed' });
      expect(
        store.completeMcpAction({ ...fence, now: '2026-07-14T00:11:00.000Z' }),
      ).toMatchObject({ state: 'completed' });
    } finally {
      f.raw.close();
    }
  });
});
