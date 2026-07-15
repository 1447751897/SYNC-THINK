import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type {
  AgentVersionId,
  ArtifactId,
  ArtifactVersion,
  RunId,
  RunState,
  StepId,
  TaskId,
  WorkspaceId,
} from '@sync-think/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import { ArtifactDataError, SqliteArtifactStore } from './artifact-store.js';
import { MIGRATIONS, runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];
const nodeRequire = createRequire(import.meta.url);
const betterSqlite3ModulePath = nodeRequire.resolve('better-sqlite3');
const workspaceId = 'workspace-artifacts' as WorkspaceId;
const taskId = 'task-artifacts' as TaskId;
const runId = 'run-artifacts' as RunId;
const stepId = 'step-artifacts' as StepId;
const alternateStepId = 'step-artifacts-alternate' as StepId;
const agentVersionId = 'agent-version-artifacts' as AgentVersionId;
const secondTaskId = 'task-artifacts-second' as TaskId;
const secondRunId = 'run-artifacts-second' as RunId;
const secondStepId = 'step-artifacts-second' as StepId;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-artifact-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

function seedRun(raw: BetterSQLite3Raw, withExecutionFence = true): void {
  raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    )
    .run(workspaceId, 'D:\\projects\\artifacts', 'Artifacts', 'now', 'now');
  raw
    .prepare(
      `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'active', 'collaboration', '[]', 0, ?, ?)`,
    )
    .run(taskId, workspaceId, 'Artifact task', 'Version artifacts', 'now', 'now');
  raw
    .prepare(
      `INSERT INTO agent_version (
       id, agent_id, version, name, role, developer_instructions, input_contract,
       output_contract, default_model_id, default_credential_group_id,
       pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
       memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
       approval_mode, created_at
     ) VALUES (?, ?, 1, ?, 'worker', '', '', '', ?, ?, NULL, 1, '[]', 'task', '[]', '[]', NULL, 'request', ?)`,
    )
    .run(
      agentVersionId,
      'agent-artifacts',
      'Artifact worker',
      'model-artifacts',
      'group-artifacts',
      'now',
    );
  raw
    .prepare(`INSERT INTO plan (id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run('plan-artifacts', taskId, 'now', 'now');
  raw
    .prepare(
      `INSERT INTO plan_revision (
       id, plan_id, revision, title, steps_json, diff_json, state, created_at, approved_at
     ) VALUES (?, ?, 1, ?, '[]', ?, 'approved', ?, ?)`,
    )
    .run(
      'plan-revision-artifacts',
      'plan-artifacts',
      'Artifact plan',
      '{"added":[],"removed":[],"changed":[]}',
      'now',
      'now',
    );
  raw
    .prepare(
      `INSERT INTO run (id, task_id, plan_revision_id, state, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?)`,
    )
    .run(runId, taskId, 'plan-revision-artifacts', 'now', 'now');
  if (withExecutionFence) {
    raw
      .prepare(
        `INSERT INTO step (
         id, run_id, plan_order, title, instructions, agent_version_id, state,
         retries, execution_owner_id, lease_expires_at, execution_attempt,
         created_at, updated_at
       ) VALUES (?, ?, 0, 'Write artifact', '', ?, 'running', 0, ?, ?, 1, ?, ?)`,
      )
      .run(
        stepId,
        runId,
        agentVersionId,
        'artifact-test-owner',
        '9999-12-31T23:59:59.999Z',
        'now',
        'now',
      );
    return;
  }

  raw
    .prepare(
      `INSERT INTO step (
       id, run_id, plan_order, title, instructions, agent_version_id, state,
       retries, created_at, updated_at
     ) VALUES (?, ?, 0, 'Write artifact', '', ?, 'running', 0, ?, ?)`,
    )
    .run(stepId, runId, agentVersionId, 'now', 'now');
}

function seedAlternateStep(raw: BetterSQLite3Raw): void {
  raw
    .prepare(
      `INSERT INTO step (
       id, run_id, plan_order, title, instructions, agent_version_id, state,
       retries, execution_owner_id, lease_expires_at, execution_attempt,
       created_at, updated_at
     ) VALUES (?, ?, 1, 'Resolve artifact', '', ?, 'running', 0, ?, ?, 1, ?, ?)`,
    )
    .run(
      alternateStepId,
      runId,
      agentVersionId,
      'artifact-test-owner',
      '9999-12-31T23:59:59.999Z',
      'now',
      'now',
    );
}

function seedSecondRun(raw: BetterSQLite3Raw): void {
  raw
    .prepare(
      `INSERT INTO task (
       id, workspace_id, title, goal, status, participation_mode,
       acceptance_criteria_json, version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'active', 'collaboration', '[]', 0, ?, ?)`,
    )
    .run(secondTaskId, workspaceId, 'Second artifact task', 'Isolation', 'now', 'now');
  raw
    .prepare(`INSERT INTO plan (id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run('plan-artifacts-second', secondTaskId, 'now', 'now');
  raw
    .prepare(
      `INSERT INTO plan_revision (
       id, plan_id, revision, title, steps_json, diff_json, state, created_at, approved_at
     ) VALUES (?, ?, 1, ?, '[]', ?, 'approved', ?, ?)`,
    )
    .run(
      'plan-revision-artifacts-second',
      'plan-artifacts-second',
      'Second plan',
      '{"added":[],"removed":[],"changed":[]}',
      'now',
      'now',
    );
  raw
    .prepare(
      `INSERT INTO run (id, task_id, plan_revision_id, state, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?)`,
    )
    .run(secondRunId, secondTaskId, 'plan-revision-artifacts-second', 'now', 'now');
  raw
    .prepare(
      `INSERT INTO step (
       id, run_id, plan_order, title, instructions, agent_version_id, state,
       retries, execution_owner_id, lease_expires_at, execution_attempt,
       created_at, updated_at
     ) VALUES (?, ?, 0, 'Second artifact', '', ?, 'running', 0, ?, ?, 1, ?, ?)`,
    )
    .run(
      secondStepId,
      secondRunId,
      agentVersionId,
      'artifact-test-owner',
      '9999-12-31T23:59:59.999Z',
      'now',
      'now',
    );
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  connection.raw.pragma('busy_timeout = 5000');
  seedRun(connection.raw);
  return {
    dbPath,
    raw: connection.raw,
    store: new SqliteArtifactStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

async function openLegacyConflictStore() {
  const dbPath = makeDbPath();
  const trailingMigrations = MIGRATIONS.splice(11);
  try {
    expect(trailingMigrations.map((migration) => migration.name)).toEqual([
      '0012_artifact_integrity',
      '0013_durable_scheduler',
      '0014_scheduler_fencing',
      '0015_capability_authorization',
      '0016_production_execution',
      '0017_reviewer_rework',
      '0018_complete_agent_version',
      '0019_review_source_evidence_integrity',
      '0020_review_bounds_integrity',
      '0021_merge_step_conflict_resolution',
    ]);
    await runMigrations(dbPath);
  } finally {
    MIGRATIONS.push(...trailingMigrations);
  }

  const legacy = await openDatabaseAsync({ path: dbPath });
  seedRun(legacy.raw, false);
  const legacyStore = new SqliteArtifactStore(legacy.raw);
  const artifact = createArtifact(legacyStore);
  const base = legacyStore.createVersion({
    artifactId: artifact.id,
    sourceStepId: stepId,
    content: 'base',
    mimeType: 'text/plain',
    status: 'candidate',
  });
  const left = legacyStore.createVersion({
    artifactId: artifact.id,
    sourceStepId: stepId,
    content: 'left',
    mimeType: 'text/plain',
    status: 'candidate',
    parentVersionIds: [base.id],
  });
  const right = legacyStore.createVersion({
    artifactId: artifact.id,
    sourceStepId: stepId,
    content: 'right',
    mimeType: 'text/plain',
    status: 'candidate',
    parentVersionIds: [base.id],
  });
  const conflictId = 'legacy-conflict-no-event';
  const operationId = 'legacy-operation-no-event';
  legacy.raw
    .prepare(
      `INSERT INTO artifact_merge_conflict (
       id, operation_id, artifact_id, run_id, base_version_id,
       left_version_id, right_version_id, status, summary_json,
       expected_task_version, resulting_task_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, 1, 'legacy-now')`,
    )
    .run(
      conflictId,
      operationId,
      artifact.id,
      runId,
      base.id,
      left.id,
      right.id,
      JSON.stringify({
        baseHash: base.contentHash,
        leftHash: left.contentHash,
        rightHash: right.contentHash,
      }),
    );
  legacy.raw.prepare('UPDATE run SET state = ? WHERE id = ?').run('paused', runId);
  legacy.raw.close();

  await runMigrations(dbPath);
  const upgraded = await openDatabaseAsync({ path: dbPath });
  return {
    raw: upgraded.raw,
    store: new SqliteArtifactStore(upgraded.raw),
    artifact,
    base,
    left,
    right,
    conflictId,
    operationId,
    close: () => upgraded.raw.close(),
  };
}

function createArtifact(store: SqliteArtifactStore) {
  return store.createArtifact({ workspaceId, taskId, runId, name: 'draft.txt', now: 't0' });
}

function createMergeVersions(store: SqliteArtifactStore): {
  base: ArtifactVersion;
  left: ArtifactVersion;
  right: ArtifactVersion;
} {
  const artifact = createArtifact(store);
  const base = store.createVersion({
    artifactId: artifact.id,
    sourceStepId: stepId,
    content: 'base',
    mimeType: 'text/plain',
    status: 'candidate',
  });
  const left = store.createVersion({
    artifactId: artifact.id,
    sourceStepId: stepId,
    content: 'left',
    mimeType: 'text/plain',
    status: 'candidate',
    parentVersionIds: [base.id],
  });
  const right = store.createVersion({
    artifactId: artifact.id,
    sourceStepId: stepId,
    content: 'right',
    mimeType: 'text/plain',
    status: 'candidate',
    parentVersionIds: [base.id],
  });
  return { base, left, right };
}

const EXTERNAL_VERSION_WRITER = String.raw`
  const { parentPort, workerData } = require('node:worker_threads');
  const Database = require(workerData.betterSqlite3ModulePath);
  const barrier = new Int32Array(workerData.barrier);
  const db = new Database(workerData.dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    db.exec('BEGIN IMMEDIATE');
    Atomics.store(barrier, 0, 1);
    Atomics.notify(barrier, 0);
    Atomics.wait(barrier, 1, 0, 5000);
    db.prepare(
      'INSERT INTO artifact_version (id, artifact_id, source_run_id, source_step_id, status, version, content, content_ref, content_hash, mime_type, parent_version_ids_json, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, ?, ?, ?, ?)'
    ).run(
      workerData.versionId,
      workerData.artifactId,
      workerData.runId,
      workerData.stepId,
      'candidate',
      'external',
      workerData.hash,
      'text/plain',
      '[]',
      '{}',
      'external-now'
    );
    Atomics.wait(barrier, 2, 0, 300);
    db.exec('COMMIT');
    parentPort.postMessage({ ok: true });
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    db.close();
  }
`;

async function createVersionAgainstExternalWriter(
  dbPath: string,
  artifactId: ArtifactId,
  action: () => unknown,
): Promise<void> {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
  const barrier = new Int32Array(buffer);
  const worker = new Worker(EXTERNAL_VERSION_WRITER, {
    eval: true,
    workerData: {
      barrier: buffer,
      betterSqlite3ModulePath,
      dbPath,
      artifactId,
      runId,
      stepId,
      versionId: 'external-version',
      hash: sha256('external'),
    },
  });
  const result = new Promise<void>((resolve, reject) => {
    worker.once('message', (message: { ok: boolean; error?: string }) => {
      if (message.ok) resolve();
      else reject(new Error(message.error));
    });
    worker.once('error', reject);
  });
  try {
    Atomics.wait(barrier, 0, 0, 5_000);
    expect(Atomics.load(barrier, 0)).toBe(1);
    Atomics.store(barrier, 1, 1);
    Atomics.notify(barrier, 1);
    action();
    await result;
  } finally {
    Atomics.store(barrier, 2, 1);
    Atomics.notify(barrier, 2);
    await worker.terminate();
  }
}

describe('SqliteArtifactStore immutable versions', () => {
  it('persists content and contentRef versions without mutating old content', async () => {
    const { raw, store, close } = await openStore();
    try {
      const artifact = createArtifact(store);
      const v1 = store.createVersion({
        artifactId: artifact.id,
        sourceStepId: stepId,
        content: 'base',
        mimeType: 'text/plain',
        status: 'candidate',
        metadata: { author: 'planner' },
        now: 't1',
      });
      const v2 = store.createVersion({
        artifactId: artifact.id,
        sourceStepId: stepId,
        contentRef: 'D:\\artifacts\\draft-v2.txt',
        contentHash: sha256('left'),
        mimeType: 'text/plain',
        status: 'candidate',
        parentVersionIds: [v1.id],
        metadata: { review: { passed: false } },
        now: 't2',
      });

      expect(v1).toMatchObject({ version: 1, content: 'base', contentHash: sha256('base') });
      expect(v2).toMatchObject({
        version: 2,
        contentRef: 'D:\\artifacts\\draft-v2.txt',
        parentVersionIds: [v1.id],
      });
      expect(store.getVersion(v1.id)).toEqual(v1);
      expect(() =>
        raw.prepare('UPDATE artifact_version SET content = ? WHERE id = ?').run('mutated', v1.id),
      ).toThrow(/immutable/i);
      expect(store.getVersion(v1.id)?.content).toBe('base');
    } finally {
      close();
    }
  });

  it('serializes version allocation against a real external SQLite writer', async () => {
    const { dbPath, store, close } = await openStore();
    try {
      const artifact = createArtifact(store);
      let createdVersion: number | undefined;
      await createVersionAgainstExternalWriter(dbPath, artifact.id, () => {
        createdVersion = store.createVersion({
          artifactId: artifact.id,
          sourceStepId: stepId,
          content: 'main',
          mimeType: 'text/plain',
          status: 'candidate',
        }).version;
      });
      expect(createdVersion).toBe(2);
      expect(store.listVersions(artifact.id).map((version) => version.version)).toEqual([1, 2]);
    } finally {
      close();
    }
  });

  it('fails closed for malformed persisted status, JSON, MIME, and version values', async () => {
    const { raw, store, close } = await openStore();
    try {
      const artifact = createArtifact(store);
      raw.pragma('ignore_check_constraints = ON');
      const insert = raw.prepare(
        `INSERT INTO artifact_version (
           id, artifact_id, source_run_id, source_step_id, status, version,
           content, content_ref, content_hash, mime_type,
           parent_version_ids_json, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'x', NULL, ?, ?, ?, ?, 'corrupt')`,
      );
      insert.run(
        'bad-status',
        artifact.id,
        runId,
        stepId,
        'corrupt',
        10,
        sha256('x'),
        'text/plain',
        '[]',
        '{}',
      );
      insert.run(
        'bad-json',
        artifact.id,
        runId,
        stepId,
        'candidate',
        11,
        sha256('x'),
        'text/plain',
        '[]',
        '[]',
      );
      insert.run(
        'bad-mime',
        artifact.id,
        runId,
        stepId,
        'candidate',
        12,
        sha256('x'),
        'not a mime',
        '[]',
        '{}',
      );
      insert.run(
        'bad-version',
        artifact.id,
        runId,
        stepId,
        'candidate',
        0,
        sha256('x'),
        'text/plain',
        '[]',
        '{}',
      );
      insert.run(
        'bad-hash',
        artifact.id,
        runId,
        stepId,
        'candidate',
        13,
        sha256('different'),
        'text/plain',
        '[]',
        '{}',
      );
      raw.pragma('ignore_check_constraints = OFF');

      for (const [id, path] of [
        ['bad-status', 'artifactVersion.status'],
        ['bad-json', 'artifactVersion.metadata'],
        ['bad-mime', 'artifactVersion.mimeType'],
        ['bad-version', 'artifactVersion.version'],
        ['bad-hash', 'artifactVersion.contentHash'],
      ]) {
        expect(() => store.getVersion(id as never)).toThrow(ArtifactDataError);
        expect(() => store.getVersion(id as never)).toThrow(path);
      }
    } finally {
      close();
    }
  });

  it('rejects oversized content and metadata', async () => {
    const { store, close } = await openStore();
    try {
      const artifact = createArtifact(store);
      expect(() =>
        store.createVersion({
          artifactId: artifact.id,
          sourceStepId: stepId,
          content: 'x'.repeat(48 * 1024 + 1),
          mimeType: 'text/plain',
          status: 'candidate',
        }),
      ).toThrow(/content.*too large/i);
      expect(() =>
        store.createVersion({
          artifactId: artifact.id,
          sourceStepId: stepId,
          content: 'small',
          mimeType: 'text/plain',
          status: 'candidate',
          metadata: { value: 'x'.repeat(32 * 1024) },
        }),
      ).toThrow(/metadata.*too large/i);
      expect(() =>
        store.createVersion({
          artifactId: artifact.id,
          sourceStepId: stepId,
          contentRef: 'https://example.test/not-local.txt',
          contentHash: sha256('remote'),
          mimeType: 'text/plain',
          status: 'candidate',
        }),
      ).toThrow(/contentRef.*local/i);
    } finally {
      close();
    }
  });

  it('accepts only explicit local content reference forms on write and read', async () => {
    const { raw, store, close } = await openStore();
    try {
      const artifact = createArtifact(store);
      const allowed = [
        'D:\\artifacts\\draft.txt',
        '/var/lib/sync-think/draft.txt',
        'file:///D:/artifacts/draft.txt',
        'artifact://versions/version-local',
      ];
      for (const [index, contentRef] of allowed.entries()) {
        const version = store.createVersion({
          artifactId: artifact.id,
          sourceStepId: stepId,
          contentRef,
          contentHash: sha256(`ref-${index}`),
          mimeType: 'text/plain',
          status: 'candidate',
        });
        expect(store.getVersion(version.id)?.contentRef).toBe(contentRef);
      }

      for (const contentRef of [
        '',
        '   ',
        'relative/path.txt',
        'data:text/plain,secret',
        'javascript:alert(1)',
        'http://example.test/a',
        'https://example.test/a',
        'https:relative',
        'ftp://example.test/a',
      ]) {
        expect(() =>
          store.createVersion({
            artifactId: artifact.id,
            sourceStepId: stepId,
            contentRef,
            contentHash: sha256(contentRef),
            mimeType: 'text/plain',
            status: 'candidate',
          }),
        ).toThrow(/contentRef.*local/i);
      }

      raw.prepare('DROP TRIGGER artifact_version_immutable_update').run();
      raw
        .prepare('UPDATE artifact_version SET content_ref = ? WHERE id = ?')
        .run('data:text/plain,persisted-secret', store.listVersions(artifact.id)[0]!.id);
      expect(() => store.getVersion(store.listVersions(artifact.id)[0]!.id)).toThrow(
        /contentRef.*local/i,
      );
    } finally {
      close();
    }
  });

  it('requires the merge base to be a common ancestor before creating an outcome', async () => {
    const { raw, store, close } = await openStore();
    try {
      const artifact = createArtifact(store);
      const base = store.createVersion({
        artifactId: artifact.id,
        sourceStepId: stepId,
        content: 'base',
        mimeType: 'text/plain',
        status: 'candidate',
      });
      const left = store.createVersion({
        artifactId: artifact.id,
        sourceStepId: stepId,
        content: 'unrelated-left',
        mimeType: 'text/plain',
        status: 'candidate',
      });
      const right = store.createVersion({
        artifactId: artifact.id,
        sourceStepId: stepId,
        content: 'right',
        mimeType: 'text/plain',
        status: 'candidate',
        parentVersionIds: [base.id],
      });
      const versionCount = raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get() as {
        count: number;
      };

      expect(() =>
        store.createMergedVersion({
          operationId: 'operation-no-common-ancestor',
          artifactId: artifact.id,
          baseVersionId: base.id,
          leftVersionId: left.id,
          rightVersionId: right.id,
          sourceStepId: stepId,
          content: 'merged',
          mimeType: 'text/plain',
          expectedTaskVersion: 0,
          resultingTaskVersion: 1,
        }),
      ).toThrow(/common ancestor/i);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual(
        versionCount,
      );
      expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_merge_conflict').get()).toEqual({
        count: 0,
      });
    } finally {
      close();
    }
  });

  it('rejects cyclic and cross-artifact ancestry fail-closed', async () => {
    const { raw, store, close } = await openStore();
    try {
      const first = createMergeVersions(store);
      const secondArtifact = store.createArtifact({
        workspaceId,
        taskId,
        runId,
        name: 'second.txt',
      });
      const foreign = store.createVersion({
        artifactId: secondArtifact.id,
        sourceStepId: stepId,
        content: 'foreign',
        mimeType: 'text/plain',
        status: 'candidate',
      });
      raw.prepare('DROP TRIGGER artifact_version_immutable_update').run();
      raw
        .prepare('UPDATE artifact_version SET parent_version_ids_json = ? WHERE id = ?')
        .run(JSON.stringify([first.left.id]), first.base.id);
      expect(() =>
        store.assertCommonAncestor(
          first.base.artifactId,
          first.base.id,
          first.left.id,
          first.right.id,
        ),
      ).toThrow(/parent|cycle/i);

      raw
        .prepare('UPDATE artifact_version SET parent_version_ids_json = ? WHERE id = ?')
        .run(JSON.stringify([foreign.id]), first.base.id);
      expect(() =>
        store.assertCommonAncestor(
          first.base.artifactId,
          first.base.id,
          first.left.id,
          first.right.id,
        ),
      ).toThrow(/cross-artifact|parent/i);
    } finally {
      close();
    }
  });

  it('uses the same mergeable Run-state allowlist for clean and conflict outcomes', async () => {
    const { raw, store, close } = await openStore();
    try {
      const { base, left, right } = createMergeVersions(store);
      const allowed: RunState[] = ['running', 'reviewing', 'revising', 'paused'];
      for (const state of allowed) {
        raw.prepare('UPDATE run SET state = ? WHERE id = ?').run(state, runId);
        expect(
          store.createMergedVersion({
            operationId: `allowed-clean-${state}`,
            artifactId: base.artifactId,
            baseVersionId: base.id,
            leftVersionId: left.id,
            rightVersionId: right.id,
            sourceStepId: stepId,
            content: `merged-${state}`,
            mimeType: 'text/plain',
            expectedTaskVersion: 0,
            resultingTaskVersion: 1,
          }).created,
        ).toBe(true);
        raw.prepare('UPDATE run SET state = ? WHERE id = ?').run(state, runId);
        expect(
          store.createMergeConflict({
            operationId: `allowed-conflict-${state}`,
            artifactId: base.artifactId,
            baseVersionId: base.id,
            leftVersionId: left.id,
            rightVersionId: right.id,
            sourceStepId: stepId,
            expectedTaskVersion: 0,
            resultingTaskVersion: 1,
            summary: {
              baseHash: base.contentHash,
              leftHash: left.contentHash,
              rightHash: right.contentHash,
            },
          }).created,
        ).toBe(true);
      }

      const disallowed: RunState[] = [
        'conversation',
        'planDraft',
        'awaitingPlanApproval',
        'queued',
        'awaitingToolApproval',
        'completed',
        'blocked',
        'failed',
        'cancelled',
      ];
      for (const state of disallowed) {
        raw.prepare('UPDATE run SET state = ? WHERE id = ?').run(state, runId);
        const before = {
          versions: (
            raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get() as { count: number }
          ).count,
          conflicts: (
            raw.prepare('SELECT COUNT(*) AS count FROM artifact_merge_conflict').get() as {
              count: number;
            }
          ).count,
        };
        expect(() =>
          store.createMergedVersion({
            operationId: `denied-clean-${state}`,
            artifactId: base.artifactId,
            baseVersionId: base.id,
            leftVersionId: left.id,
            rightVersionId: right.id,
            sourceStepId: stepId,
            content: 'must-not-persist',
            mimeType: 'text/plain',
            expectedTaskVersion: 0,
            resultingTaskVersion: 1,
          }),
        ).toThrow(/Run.*merge/i);
        expect(() =>
          store.createMergeConflict({
            operationId: `denied-conflict-${state}`,
            artifactId: base.artifactId,
            baseVersionId: base.id,
            leftVersionId: left.id,
            rightVersionId: right.id,
            sourceStepId: stepId,
            expectedTaskVersion: 0,
            resultingTaskVersion: 1,
            summary: {
              baseHash: base.contentHash,
              leftHash: left.contentHash,
              rightHash: right.contentHash,
            },
          }),
        ).toThrow(/Run.*merge/i);
        expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_version').get()).toEqual({
          count: before.versions,
        });
        expect(raw.prepare('SELECT COUNT(*) AS count FROM artifact_merge_conflict').get()).toEqual({
          count: before.conflicts,
        });
      }
    } finally {
      close();
    }
  });

  it('returns bounded summary-only artifact pages without loading inline content', async () => {
    const { raw, store, close } = await openStore();
    try {
      for (let index = 0; index < 5; index += 1) {
        const artifact = store.createArtifact({
          workspaceId,
          taskId,
          runId,
          name: `artifact-${index}.txt`,
          now: `t${index}`,
        });
        store.createVersion({
          artifactId: artifact.id,
          sourceStepId: stepId,
          content: index === 0 ? '\u0000'.repeat(48 * 1024) : `content-${index}`,
          mimeType: 'text/plain',
          status: 'candidate',
        });
      }
      raw.prepare('DROP TRIGGER artifact_version_immutable_update').run();
      raw
        .prepare(
          `UPDATE artifact_version SET content = ?, content_hash = ?
         WHERE artifact_id = (SELECT id FROM artifact ORDER BY created_at, id LIMIT 1)`,
        )
        .run('x'.repeat(64 * 1024), sha256('x'.repeat(64 * 1024)));

      const first = store.listArtifacts({ workspaceId, taskId, runId }, { limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(first.items[0]!.versions[0]).toMatchObject({
        hasInlineContent: true,
        hasContentRef: false,
      });
      expect(first.items[0]!.versions[0]).not.toHaveProperty('content');
      expect(first.items[0]!.versions[0]).not.toHaveProperty('contentRef');
      expect(first.items[0]!.versions[0]).not.toHaveProperty('metadata');

      const second = store.listArtifacts(
        { workspaceId, taskId, runId },
        { limit: 2, cursor: first.nextCursor },
      );
      expect(second.items).toHaveLength(2);
      expect(second.items.map((item) => item.artifact.id)).not.toEqual(
        first.items.map((item) => item.artifact.id),
      );
    } finally {
      close();
    }
  });

  it('records one idempotent conflict and pauses its owning Run', async () => {
    const { raw, store, close } = await openStore();
    try {
      const artifact = createArtifact(store);
      const base = store.createVersion({
        artifactId: artifact.id,
        sourceStepId: stepId,
        content: 'base',
        mimeType: 'text/plain',
        status: 'candidate',
      });
      const versions = [
        base,
        ...['left', 'right'].map((content) =>
          store.createVersion({
            artifactId: artifact.id,
            sourceStepId: stepId,
            content,
            mimeType: 'text/plain',
            status: 'candidate',
            parentVersionIds: [base.id],
          }),
        ),
      ];
      const input = {
        operationId: 'operation-conflict',
        artifactId: artifact.id,
        baseVersionId: versions[0]!.id,
        leftVersionId: versions[1]!.id,
        rightVersionId: versions[2]!.id,
        sourceStepId: stepId,
        expectedTaskVersion: 0,
        resultingTaskVersion: 1,
        summary: {
          baseHash: versions[0]!.contentHash,
          leftHash: versions[1]!.contentHash,
          rightHash: versions[2]!.contentHash,
        },
        now: 'conflict-now',
      } as const;

      const first = store.createMergeConflict(input);
      const retry = store.createMergeConflict(input);

      expect(first.created).toBe(true);
      expect(retry).toEqual({ created: false, conflict: first.conflict });
      expect(first.conflict.sourceStepId).toBe(stepId);
      expect(store.listMergeConflicts(artifact.id)).toEqual([first.conflict]);
      expect(raw.prepare('SELECT state FROM run WHERE id = ?').get(runId)).toEqual({
        state: 'paused',
      });
      expect(() =>
        store.selectVersion({
          operationId: input.operationId,
          artifactId: artifact.id,
          versionId: versions[0]!.id,
          expectedTaskVersion: 0,
          resultingTaskVersion: 1,
        }),
      ).toThrow(/operation ID.*different artifact mutation/i);
    } finally {
      close();
    }
  });

  it.each([
    ['left', undefined, 'left'],
    ['right', undefined, 'right'],
    ['manual', 'left\nright', 'left\nright'],
  ] as const)(
    'appends one %s conflict resolution without mutating the open conflict',
    async (strategy, content, expectedContent) => {
      const { raw, store, close } = await openStore();
      try {
        const { base, left, right } = createMergeVersions(store);
        const conflict = store.createMergeConflict({
          operationId: `conflict-${strategy}`,
          artifactId: base.artifactId,
          baseVersionId: base.id,
          leftVersionId: left.id,
          rightVersionId: right.id,
          sourceStepId: stepId,
          expectedTaskVersion: 0,
          resultingTaskVersion: 1,
          summary: {
            baseHash: base.contentHash,
            leftHash: left.contentHash,
            rightHash: right.contentHash,
          },
        }).conflict;
        const input = {
          operationId: `resolution-${strategy}`,
          conflictId: conflict.id,
          strategy,
          ...(content === undefined ? {} : { content }),
          expectedTaskVersion: 1,
          resultingTaskVersion: 2,
        };

        const first = store.resolveMergeConflict(input);
        const replay = store.resolveMergeConflict(input);

        expect(first.created).toBe(true);
        expect(replay).toEqual({
          created: false,
          resolution: first.resolution,
          version: first.version,
        });
        expect(first.version).toMatchObject({
          content: expectedContent,
          sourceStepId: stepId,
          status: 'merged',
          parentVersionIds: [left.id, right.id],
        });
        expect(store.getMergeConflict(conflict.id)).toEqual(conflict);
        expect(store.listMergeConflictsForScope({ workspaceId, taskId, runId })).toEqual([
          { conflict, resolution: first.resolution },
        ]);
        expect(store.hasUnresolvedMergeConflicts(runId)).toBe(false);
        expect(
          raw.prepare('SELECT COUNT(*) AS count FROM artifact_merge_conflict_resolution').get(),
        ).toEqual({ count: 1 });
        expect(() =>
          store.resolveMergeConflict({
            ...input,
            operationId: `second-resolution-${strategy}`,
          }),
        ).toThrow(/already has an append-only resolution/i);
      } finally {
        close();
      }
    },
  );

  it('rejects conflict operation replay from a different source Step', async () => {
    const { raw, store, close } = await openStore();
    try {
      seedAlternateStep(raw);
      const { base, left, right } = createMergeVersions(store);
      const input = {
        operationId: 'operation-conflict-step-identity',
        artifactId: base.artifactId,
        baseVersionId: base.id,
        leftVersionId: left.id,
        rightVersionId: right.id,
        sourceStepId: stepId,
        expectedTaskVersion: 0,
        resultingTaskVersion: 1,
        summary: {
          baseHash: base.contentHash,
          leftHash: left.contentHash,
          rightHash: right.contentHash,
        },
      } as const;
      const first = store.createMergeConflict(input);

      expect(() => store.createMergeConflict({ ...input, sourceStepId: alternateStepId })).toThrow(
        /operation ID.*different conflict input/i,
      );
      expect(store.listMergeConflicts(base.artifactId)).toEqual([first.conflict]);
    } finally {
      close();
    }
  });

  it('lists an uncorrelated legacy conflict explicitly but refuses operation replay', async () => {
    const fixture = await openLegacyConflictStore();
    try {
      const conflicts = fixture.store.listMergeConflicts(fixture.artifact.id);
      expect(conflicts).toEqual([
        expect.objectContaining({
          id: fixture.conflictId,
          operationId: fixture.operationId,
          legacySourceStepUnknown: true,
        }),
      ]);
      expect(conflicts[0]).not.toHaveProperty('sourceStepId');
      expect(() => fixture.store.getMergeOutcomeByOperationId(fixture.operationId)).toThrow(
        /artifact\.legacy_conflict_step_unknown/,
      );
      expect(fixture.raw.prepare('SELECT state FROM run WHERE id = ?').get(runId)).toEqual({
        state: 'paused',
      });
    } finally {
      fixture.close();
    }
  });

  it('blocks cross-scope ownership pollution with 0012 integrity triggers', async () => {
    const { raw, store, close } = await openStore();
    try {
      seedSecondRun(raw);
      const firstArtifact = createArtifact(store);
      const secondArtifact = store.createArtifact({
        workspaceId,
        taskId: secondTaskId,
        runId: secondRunId,
        name: 'second-run.txt',
      });
      const firstVersion = store.createVersion({
        artifactId: firstArtifact.id,
        sourceStepId: stepId,
        content: 'first',
        mimeType: 'text/plain',
        status: 'candidate',
      });
      const secondVersion = store.createVersion({
        artifactId: secondArtifact.id,
        sourceStepId: secondStepId,
        content: 'second',
        mimeType: 'text/plain',
        status: 'candidate',
      });

      expect(() =>
        raw
          .prepare(
            `INSERT INTO artifact (id, workspace_id, task_id, run_id, name, created_at)
           VALUES ('polluted-artifact', ?, ?, ?, 'bad', 'now')`,
          )
          .run(workspaceId, secondTaskId, runId),
      ).toThrow(/artifact ownership/i);
      expect(() =>
        raw
          .prepare(
            `INSERT INTO artifact_version (
             id, artifact_id, source_run_id, source_step_id, status, version,
             content, content_hash, mime_type, parent_version_ids_json, metadata_json, created_at
           ) VALUES ('polluted-version', ?, ?, ?, 'candidate', 2, 'bad', ?, 'text/plain', '[]', '{}', 'now')`,
          )
          .run(firstArtifact.id, secondRunId, secondStepId, sha256('bad')),
      ).toThrow(/version ownership/i);
      expect(() =>
        raw
          .prepare(
            `INSERT INTO artifact_selection (
             id, operation_id, artifact_id, selected_version_id,
             expected_task_version, resulting_task_version, created_at
           ) VALUES ('polluted-selection', 'polluted-selection-op', ?, ?, 0, 1, 'now')`,
          )
          .run(firstArtifact.id, secondVersion.id),
      ).toThrow(/selection ownership/i);
      expect(() =>
        raw
          .prepare(
            `INSERT INTO artifact_merge_conflict (
         id, operation_id, artifact_id, run_id, source_step_id,
             base_version_id, left_version_id, right_version_id, status,
             summary_json, expected_task_version, resulting_task_version, created_at
           ) VALUES (
             'polluted-conflict', 'polluted-conflict-op', ?, ?, ?, ?, ?, ?, 'open',
             ?, 0, 1, 'now'
           )`,
          )
          .run(
            firstArtifact.id,
            runId,
            stepId,
            firstVersion.id,
            secondVersion.id,
            firstVersion.id,
            JSON.stringify({
              baseHash: firstVersion.contentHash,
              leftHash: secondVersion.contentHash,
              rightHash: firstVersion.contentHash,
            }),
          ),
      ).toThrow(/conflict ownership/i);
    } finally {
      close();
    }
  });

  it('fails closed when reading legacy rows with legal FKs but invalid ownership', async () => {
    const { raw, store, close } = await openStore();
    try {
      seedSecondRun(raw);
      const firstArtifact = createArtifact(store);
      const secondArtifact = store.createArtifact({
        workspaceId,
        taskId: secondTaskId,
        runId: secondRunId,
        name: 'legacy-second.txt',
      });
      const firstVersion = store.createVersion({
        artifactId: firstArtifact.id,
        sourceStepId: stepId,
        content: 'first',
        mimeType: 'text/plain',
        status: 'candidate',
      });
      const secondVersion = store.createVersion({
        artifactId: secondArtifact.id,
        sourceStepId: secondStepId,
        content: 'second',
        mimeType: 'text/plain',
        status: 'candidate',
      });
      for (const trigger of [
        'artifact_ownership_insert',
        'artifact_version_ownership_insert',
        'artifact_selection_ownership_insert',
        'artifact_merge_conflict_ownership_insert',
      ]) {
        raw.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run();
      }

      raw
        .prepare(
          `INSERT INTO artifact (id, workspace_id, task_id, run_id, name, created_at)
         VALUES ('legacy-artifact', ?, ?, ?, 'bad', 'now')`,
        )
        .run(workspaceId, secondTaskId, runId);
      expect(() => store.getArtifact('legacy-artifact' as ArtifactId)).toThrow(ArtifactDataError);

      raw
        .prepare(
          `INSERT INTO artifact_version (
           id, artifact_id, source_run_id, source_step_id, status, version,
           content, content_hash, mime_type, parent_version_ids_json, metadata_json, created_at
         ) VALUES ('legacy-version', ?, ?, ?, 'candidate', 2, 'bad', ?, 'text/plain', '[]', '{}', 'now')`,
        )
        .run(firstArtifact.id, secondRunId, secondStepId, sha256('bad'));
      expect(() => store.getVersion('legacy-version' as never)).toThrow(ArtifactDataError);

      raw
        .prepare(
          `INSERT INTO artifact_selection (
           id, operation_id, artifact_id, selected_version_id,
           expected_task_version, resulting_task_version, created_at
         ) VALUES ('legacy-selection', 'legacy-selection-op', ?, ?, 0, 1, 'now')`,
        )
        .run(firstArtifact.id, secondVersion.id);
      expect(() => store.listSelections(firstArtifact.id)).toThrow(ArtifactDataError);

      raw
        .prepare(
          `INSERT INTO artifact_merge_conflict (
           id, operation_id, artifact_id, run_id, source_step_id,
           base_version_id, left_version_id, right_version_id, status,
           summary_json, expected_task_version, resulting_task_version, created_at
         ) VALUES (
           'legacy-conflict', 'legacy-conflict-op', ?, ?, NULL, ?, ?, ?, 'open',
           ?, 0, 1, 'now'
         )`,
        )
        .run(
          firstArtifact.id,
          runId,
          firstVersion.id,
          secondVersion.id,
          firstVersion.id,
          JSON.stringify({
            baseHash: firstVersion.contentHash,
            leftHash: secondVersion.contentHash,
            rightHash: firstVersion.contentHash,
          }),
        );
      expect(() => store.listMergeConflicts(firstArtifact.id)).toThrow(ArtifactDataError);
    } finally {
      close();
    }
  });
});
