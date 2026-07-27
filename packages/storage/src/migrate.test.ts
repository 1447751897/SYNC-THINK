import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabaseAsync } from './connection.js';
import { SqliteArtifactStore } from './artifact-store.js';
import { SqliteOrchestrationStore } from './orchestration-store.js';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { planMigrations, MIGRATIONS, runMigrations } from './scripts/migrate.js';

const require = createRequire(import.meta.url);

function canOpenNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

async function createLegacy0013TerminalDatabase(dbPath: string) {
  const trailingMigrations = MIGRATIONS.splice(13);
  try {
    expect(trailingMigrations.map((migration) => migration.name)).toEqual([
      '0014_scheduler_fencing',
      '0015_capability_authorization',
      '0016_production_execution',
      '0017_reviewer_rework',
      '0018_complete_agent_version',
      '0019_review_source_evidence_integrity',
      '0020_review_bounds_integrity',
      '0021_merge_step_conflict_resolution',
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    await runMigrations(dbPath);
  } finally {
    MIGRATIONS.push(...trailingMigrations);
  }

  const { raw } = await openDatabaseAsync({ path: dbPath });
  const ids = {
    workspace: 'workspace-legacy-terminal',
    task: 'task-legacy-terminal',
    agentVersion: 'agent-version-legacy-terminal',
    completedPlan: 'plan-legacy-completed',
    failedPlan: 'plan-legacy-failed',
    completedRevision: 'revision-legacy-completed',
    failedRevision: 'revision-legacy-failed',
    completedRun: 'run-legacy-completed',
    failedRun: 'run-legacy-failed',
    completedStep: 'step-legacy-completed',
    failedStep: 'step-legacy-failed',
    completedKey: 'a'.repeat(64),
    failedKey: 'b'.repeat(64),
    completedArtifact: 'artifact-legacy-completed',
    failedArtifact: 'artifact-legacy-failed',
    completedVersion: 'version-legacy-completed',
    failedVersion: 'version-legacy-failed',
  } as const;
  try {
    raw
      .prepare(
        `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
       VALUES (?, 'D:\\legacy-terminal', 'Legacy terminal', 'now', 'now')`,
      )
      .run(ids.workspace);
    raw
      .prepare(
        `INSERT INTO task (
         id, workspace_id, title, goal, status, participation_mode,
         acceptance_criteria_json, version, created_at, updated_at
       ) VALUES (?, ?, 'Legacy terminal', 'Replay after upgrade', 'active',
         'collaboration', '[]', 1, 'now', 'now')`,
      )
      .run(ids.task, ids.workspace);
    raw
      .prepare(
        `INSERT INTO agent_version (
         id, agent_id, version, name, role, developer_instructions, input_contract,
         output_contract, default_model_id, default_credential_group_id,
         pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
         memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
         approval_mode, created_at
       ) VALUES (?, 'agent-legacy-terminal', 1, 'Legacy worker', 'worker', '', '', '',
         'model-legacy', 'group-legacy', NULL, 1, '[]', 'task', '[]', '[]',
         NULL, 'request', 'now')`,
      )
      .run(ids.agentVersion);

    const insertPlan = raw.prepare(
      `INSERT INTO plan (id, task_id, created_at, updated_at) VALUES (?, ?, 'now', 'now')`,
    );
    insertPlan.run(ids.completedPlan, ids.task);
    insertPlan.run(ids.failedPlan, ids.task);
    const insertRevision = raw.prepare(
      `INSERT INTO plan_revision (
         id, plan_id, revision, title, steps_json, diff_json, state, created_at, approved_at
       ) VALUES (?, ?, 1, ?, '[]', '{"added":[],"removed":[],"changed":[]}',
         'approved', 'now', 'now')`,
    );
    insertRevision.run(ids.completedRevision, ids.completedPlan, 'Completed legacy plan');
    insertRevision.run(ids.failedRevision, ids.failedPlan, 'Failed legacy plan');
    const insertRun = raw.prepare(
      `INSERT INTO run (id, task_id, plan_revision_id, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'now', 'now')`,
    );
    insertRun.run(ids.completedRun, ids.task, ids.completedRevision, 'completed');
    insertRun.run(ids.failedRun, ids.task, ids.failedRevision, 'failed');
    const insertStep = raw.prepare(
      `INSERT INTO step (
         id, run_id, plan_order, title, instructions, agent_version_id, state,
         retries, idempotency_key, created_at, updated_at
       ) VALUES (?, ?, 0, ?, '', ?, ?, 0, ?, 'now', 'now')`,
    );
    insertStep.run(
      ids.completedStep,
      ids.completedRun,
      'Completed legacy step',
      ids.agentVersion,
      'completed',
      ids.completedKey,
    );
    insertStep.run(
      ids.failedStep,
      ids.failedRun,
      'Failed legacy step',
      ids.agentVersion,
      'failed',
      ids.failedKey,
    );

    const insertArtifact = raw.prepare(
      `INSERT INTO artifact (id, workspace_id, task_id, run_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, 'now')`,
    );
    insertArtifact.run(
      ids.completedArtifact,
      ids.workspace,
      ids.task,
      ids.completedRun,
      'completed.txt',
    );
    insertArtifact.run(ids.failedArtifact, ids.workspace, ids.task, ids.failedRun, 'failed.txt');
    const insertVersion = raw.prepare(
      `INSERT INTO artifact_version (
         id, artifact_id, source_run_id, source_step_id, status, version,
         content, content_ref, content_hash, mime_type, parent_version_ids_json,
         metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, NULL, ?, 'text/plain', '[]', '{}', 'now')`,
    );
    const completedContent = 'completed output';
    insertVersion.run(
      ids.completedVersion,
      ids.completedArtifact,
      ids.completedRun,
      ids.completedStep,
      'candidate',
      completedContent,
      createHash('sha256').update(completedContent, 'utf8').digest('hex'),
    );
    const failedContent = 'failed partial output';
    insertVersion.run(
      ids.failedVersion,
      ids.failedArtifact,
      ids.failedRun,
      ids.failedStep,
      'incomplete',
      failedContent,
      createHash('sha256').update(failedContent, 'utf8').digest('hex'),
    );

    const insertEvent = raw.prepare(
      `INSERT INTO event (
         id, workspace_id, task_id, run_id, step_id, category, type,
         sequence, occurred_at, payload_json
       ) VALUES (?, ?, ?, ?, ?, 'step', ?, ?, 'now', ?)`,
    );
    insertEvent.run(
      'event-legacy-completed',
      ids.workspace,
      ids.task,
      ids.completedRun,
      ids.completedStep,
      'step.completed',
      1,
      JSON.stringify({
        from: 'running',
        to: 'completed',
        idempotencyKey: ids.completedKey,
        artifactVersionIds: [ids.completedVersion],
      }),
    );
    insertEvent.run(
      'event-legacy-failed',
      ids.workspace,
      ids.task,
      ids.failedRun,
      ids.failedStep,
      'step.failed',
      2,
      JSON.stringify({
        from: 'running',
        to: 'failed',
        idempotencyKey: ids.failedKey,
        artifactVersionIds: [ids.failedVersion],
      }),
    );
  } finally {
    raw.close();
  }
  return ids;
}

async function createLegacy0011Database(dbPath: string, withMatchingEvent: boolean) {
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    await runMigrations(dbPath);
  } finally {
    MIGRATIONS.push(...trailingMigrations);
  }

  const { raw } = await openDatabaseAsync({ path: dbPath });
  const ids = {
    workspace: 'workspace-legacy-conflict',
    task: 'task-legacy-conflict',
    agentVersion: 'agent-version-legacy-conflict',
    plan: 'plan-legacy-conflict',
    planRevision: 'plan-revision-legacy-conflict',
    run: 'run-legacy-conflict',
    step: 'step-legacy-conflict',
    artifact: 'artifact-legacy-conflict',
    base: 'version-legacy-base',
    left: 'version-legacy-left',
    right: 'version-legacy-right',
    conflict: 'conflict-legacy',
    operation: 'operation-legacy',
  } as const;
  try {
    raw
      .prepare(
        `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
       VALUES (?, 'D:\\legacy', 'Legacy', 'now', 'now')`,
      )
      .run(ids.workspace);
    raw
      .prepare(
        `INSERT INTO task (
         id, workspace_id, title, goal, status, participation_mode,
         acceptance_criteria_json, version, created_at, updated_at
       ) VALUES (?, ?, 'Legacy conflict', 'Upgrade safely', 'active',
         'collaboration', '[]', 1, 'now', 'now')`,
      )
      .run(ids.task, ids.workspace);
    raw
      .prepare(
        `INSERT INTO agent_version (
         id, agent_id, version, name, role, developer_instructions, input_contract,
         output_contract, default_model_id, default_credential_group_id,
         pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
         memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
         approval_mode, created_at
       ) VALUES (?, 'agent-legacy', 1, 'Legacy worker', 'worker', '', '', '',
         'model-legacy', 'group-legacy', NULL, 1, '[]', 'task', '[]', '[]',
         NULL, 'request', 'now')`,
      )
      .run(ids.agentVersion);
    raw
      .prepare(`INSERT INTO plan (id, task_id, created_at, updated_at) VALUES (?, ?, 'now', 'now')`)
      .run(ids.plan, ids.task);
    raw
      .prepare(
        `INSERT INTO plan_revision (
         id, plan_id, revision, title, steps_json, diff_json, state, created_at, approved_at
       ) VALUES (?, ?, 1, 'Legacy plan', '[]',
         '{"added":[],"removed":[],"changed":[]}', 'approved', 'now', 'now')`,
      )
      .run(ids.planRevision, ids.plan);
    raw
      .prepare(
        `INSERT INTO run (id, task_id, plan_revision_id, state, created_at, updated_at)
       VALUES (?, ?, ?, 'paused', 'now', 'now')`,
      )
      .run(ids.run, ids.task, ids.planRevision);
    raw
      .prepare(
        `INSERT INTO step (
         id, run_id, plan_order, title, instructions, agent_version_id, state,
         retries, created_at, updated_at
       ) VALUES (?, ?, 0, 'Legacy merge', '', ?, 'running', 0, 'now', 'now')`,
      )
      .run(ids.step, ids.run, ids.agentVersion);
    raw
      .prepare(
        `INSERT INTO artifact (id, workspace_id, task_id, run_id, name, created_at)
       VALUES (?, ?, ?, ?, 'legacy.txt', 'now')`,
      )
      .run(ids.artifact, ids.workspace, ids.task, ids.run);
    const insertVersion = raw.prepare(
      `INSERT INTO artifact_version (
         id, artifact_id, source_run_id, source_step_id, status, version,
         content, content_ref, content_hash, mime_type, parent_version_ids_json,
         metadata_json, created_at
       ) VALUES (?, ?, ?, ?, 'candidate', ?, NULL, ?, ?, 'text/plain', ?, '{}', 'now')`,
    );
    insertVersion.run(
      ids.base,
      ids.artifact,
      ids.run,
      ids.step,
      1,
      'D:\\legacy\\base.txt',
      'a'.repeat(64),
      '[]',
    );
    insertVersion.run(
      ids.left,
      ids.artifact,
      ids.run,
      ids.step,
      2,
      'D:\\legacy\\left.txt',
      'b'.repeat(64),
      JSON.stringify([ids.base]),
    );
    insertVersion.run(
      ids.right,
      ids.artifact,
      ids.run,
      ids.step,
      3,
      'D:\\legacy\\right.txt',
      'c'.repeat(64),
      JSON.stringify([ids.base]),
    );
    raw
      .prepare(
        `INSERT INTO artifact_merge_conflict (
         id, operation_id, artifact_id, run_id, base_version_id,
         left_version_id, right_version_id, status, summary_json,
         expected_task_version, resulting_task_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 0, 1, 'now')`,
      )
      .run(
        ids.conflict,
        ids.operation,
        ids.artifact,
        ids.run,
        ids.base,
        ids.left,
        ids.right,
        JSON.stringify({
          baseHash: 'a'.repeat(64),
          leftHash: 'b'.repeat(64),
          rightHash: 'c'.repeat(64),
        }),
      );
    if (withMatchingEvent) {
      const insertEvent = raw.prepare(
        `INSERT INTO event (
           id, workspace_id, task_id, run_id, step_id, category, type,
           sequence, occurred_at, payload_json
         ) VALUES (?, ?, ?, ?, ?, 'artifact', 'artifact.merge-conflicted', ?, 'now', ?)`,
      );
      const payload = JSON.stringify({
        operationId: ids.operation,
        conflictId: ids.conflict,
      });
      insertEvent.run(
        'event-legacy-invalid-step',
        ids.workspace,
        ids.task,
        ids.run,
        'step-not-in-run',
        1,
        payload,
      );
      insertEvent.run('event-legacy-match', ids.workspace, ids.task, ids.run, ids.step, 2, payload);
      insertEvent.run(
        'event-legacy-wrong-conflict',
        ids.workspace,
        ids.task,
        ids.run,
        ids.step,
        3,
        JSON.stringify({ operationId: ids.operation, conflictId: 'different-conflict' }),
      );
    }
  } finally {
    raw.close();
  }
  return ids;
}

describe('migration planner (pure)', () => {
  it('appends message pagination after the prior storage migrations', () => {
    expect(MIGRATIONS.at(-8)?.name).toBe('0022_optional_project_folder');
    expect(MIGRATIONS.at(-7)?.name).toBe('0023_provider_execution_checkpoint');
    expect(MIGRATIONS.at(-6)?.name).toBe('0024_mutable_agent_team_conversation');
    expect(MIGRATIONS.at(-5)?.name).toBe('0025_conversation_task_binding');
    expect(MIGRATIONS.at(-4)?.name).toBe('0026_provider_source_config');
    expect(MIGRATIONS.at(-3)?.name).toBe('0027_skill_archive');
    expect(MIGRATIONS.at(-2)?.name).toBe('0028_message_pagination');
    expect(MIGRATIONS.at(-1)?.name).toBe('0029_event_global_cursor');
  });

  it.runIf(canOpenNativeSqlite())(
    'makes workspace folder_path nullable without losing rows',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sync-think-project-folder-migration-'));
      const dbPath = join(dir, 'sync-think.db');
      try {
        const trailing = MIGRATIONS.splice(-8);
        try {
          await runMigrations(dbPath);
        } finally {
          MIGRATIONS.push(...trailing);
        }
        const before = await openDatabaseAsync({ path: dbPath });
        try {
          before.raw.exec(`
          INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
          VALUES ('legacy-project', 'D:\\legacy-project', 'Legacy', 't0', 't0');
          INSERT INTO task (
            id, workspace_id, title, goal, status, participation_mode,
            acceptance_criteria_json, version, created_at, updated_at
          ) VALUES (
            'legacy-task', 'legacy-project', 'Legacy task', 'Preserve ownership',
            'active', 'conversation', '[]', 0, 't0', 't0'
          );
          INSERT INTO plan (id, task_id, created_at, updated_at)
          VALUES ('legacy-plan', 'legacy-task', 't0', 't0');
          INSERT INTO plan_revision (
            id, plan_id, revision, title, steps_json, diff_json, state, created_at, approved_at
          ) VALUES (
            'legacy-revision', 'legacy-plan', 1, 'Legacy revision', '[]',
            '{"added":[],"removed":[],"changed":[]}', 'approved', 't0', 't0'
          );
          INSERT INTO run (id, task_id, plan_revision_id, state, created_at, updated_at)
          VALUES ('legacy-run', 'legacy-task', 'legacy-revision', 'completed', 't0', 't0');
          INSERT INTO artifact (id, workspace_id, task_id, run_id, name, created_at)
          VALUES (
            'legacy-artifact', 'legacy-project', 'legacy-task', 'legacy-run',
            'legacy.txt', 't0'
          );
        `);
        } finally {
          before.raw.close();
        }

        expect((await runMigrations(dbPath)).applied).toEqual([
          '0022_optional_project_folder',
          '0023_provider_execution_checkpoint',
          '0024_mutable_agent_team_conversation',
          '0025_conversation_task_binding',
          '0026_provider_source_config',
          '0027_skill_archive',
          '0028_message_pagination',
          '0029_event_global_cursor',
        ]);
        const after = await openDatabaseAsync({ path: dbPath });
        try {
          const folderColumn = (
            after.raw.prepare("PRAGMA table_info('workspace')").all() as Array<{
              name: string;
              notnull: number;
            }>
          ).find((column) => column.name === 'folder_path');
          expect(folderColumn?.notnull).toBe(0);
          expect(
            after.raw
              .prepare('SELECT folder_path FROM workspace WHERE id = ?')
              .get('legacy-project'),
          ).toEqual({
            folder_path: 'D:\\legacy-project',
          });
          expect(
            after.raw
              .prepare(
                `SELECT artifact.id
               FROM artifact
               INNER JOIN workspace ON workspace.id = artifact.workspace_id
               INNER JOIN task ON task.id = artifact.task_id
               INNER JOIN run ON run.id = artifact.run_id
               WHERE artifact.id = 'legacy-artifact'`,
              )
              .get(),
          ).toEqual({ id: 'legacy-artifact' });
          expect(after.raw.pragma('foreign_keys', { simple: true })).toBe(1);
          expect(after.raw.pragma('foreign_key_check')).toEqual([]);
          expect(
            after.raw
              .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
              .get('workspace_folder_path_uidx'),
          ).toEqual({ name: 'workspace_folder_path_uidx' });
          const insertProject = after.raw.prepare(
            `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
           VALUES (?, ?, ?, 't1', 't1')`,
          );
          insertProject.run('unbound-one', null, 'Unbound one');
          insertProject.run('unbound-two', null, 'Unbound two');
          expect(() =>
            insertProject.run('duplicate-folder', 'd:\\LEGACY-PROJECT', 'Duplicate folder'),
          ).toThrow(/unique/i);
        } finally {
          after.raw.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('appends the complete AgentVersion migration after reviewer/rework', () => {
    expect(MIGRATIONS.at(-13)?.name).toBe('0017_reviewer_rework');
    expect(MIGRATIONS.at(-12)?.name).toBe('0018_complete_agent_version');
    expect(MIGRATIONS.at(-11)?.name).toBe('0019_review_source_evidence_integrity');
    expect(MIGRATIONS.at(-10)?.name).toBe('0020_review_bounds_integrity');
    expect(MIGRATIONS.at(-9)?.name).toBe('0021_merge_step_conflict_resolution');
    expect(MIGRATIONS.at(-8)?.name).toBe('0022_optional_project_folder');
    expect(MIGRATIONS.at(-7)?.name).toBe('0023_provider_execution_checkpoint');
    expect(MIGRATIONS.at(-6)?.name).toBe('0024_mutable_agent_team_conversation');
    expect(MIGRATIONS.at(-5)?.name).toBe('0025_conversation_task_binding');
    expect(MIGRATIONS.at(-4)?.name).toBe('0026_provider_source_config');
    expect(MIGRATIONS.at(-3)?.name).toBe('0027_skill_archive');
    expect(MIGRATIONS.at(-2)?.name).toBe('0028_message_pagination');
    expect(MIGRATIONS.at(-1)?.name).toBe('0029_event_global_cursor');
  });

  it('reserves 0016 for production execution fencing after frozen 0015', () => {
    expect(MIGRATIONS.at(-15)?.name).toBe('0015_capability_authorization');
    expect(MIGRATIONS.at(-14)?.name).toBe('0016_production_execution');
    expect(MIGRATIONS.at(-13)?.name).toBe('0017_reviewer_rework');
    expect(MIGRATIONS.at(-12)?.name).toBe('0018_complete_agent_version');
    expect(MIGRATIONS.at(-11)?.name).toBe('0019_review_source_evidence_integrity');
    expect(MIGRATIONS.at(-10)?.name).toBe('0020_review_bounds_integrity');
    expect(MIGRATIONS.at(-9)?.name).toBe('0021_merge_step_conflict_resolution');
    expect(MIGRATIONS.at(-8)?.name).toBe('0022_optional_project_folder');
    expect(MIGRATIONS.at(-7)?.name).toBe('0023_provider_execution_checkpoint');
    expect(MIGRATIONS.at(-6)?.name).toBe('0024_mutable_agent_team_conversation');
    expect(MIGRATIONS.at(-5)?.name).toBe('0025_conversation_task_binding');
    expect(MIGRATIONS.at(-4)?.name).toBe('0026_provider_source_config');
    expect(MIGRATIONS.at(-3)?.name).toBe('0027_skill_archive');
    expect(MIGRATIONS.at(-2)?.name).toBe('0028_message_pagination');
    expect(MIGRATIONS.at(-1)?.name).toBe('0029_event_global_cursor');
    const through0015 = MIGRATIONS.slice(0, -14).map((migration) => migration.name);
    expect(planMigrations(through0015).applied).toEqual([
      '0016_production_execution',
      '0017_reviewer_rework',
      '0018_complete_agent_version',
      '0019_review_source_evidence_integrity',
      '0020_review_bounds_integrity',
      '0021_merge_step_conflict_resolution',
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
  });

  it('appends capability authorization after the frozen 0014 migration', () => {
    expect(MIGRATIONS.at(-16)?.name).toBe('0014_scheduler_fencing');
    expect(MIGRATIONS.at(-15)?.name).toBe('0015_capability_authorization');
    const through0014 = MIGRATIONS.slice(0, -15).map((migration) => migration.name);
    expect(planMigrations(through0014).applied).toEqual([
      '0015_capability_authorization',
      '0016_production_execution',
      '0017_reviewer_rework',
      '0018_complete_agent_version',
      '0019_review_source_evidence_integrity',
      '0020_review_bounds_integrity',
      '0021_merge_step_conflict_resolution',
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
  });

  it('applies all baseline migrations on fresh db', () => {
    const plan = planMigrations([]);
    expect(plan.applied).toHaveLength(MIGRATIONS.length);
    expect(plan.skipped).toHaveLength(0);
  });

  it('adds artifact versions and integrity after applied 0010', () => {
    const prior = MIGRATIONS.slice(0, 10).map((migration) => migration.name);
    expect(prior.at(-1)).toBe('0010_orchestration_core');
    expect(planMigrations(prior).applied).toEqual([
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
  });

  it('adds artifact integrity as the migration after applied 0011', () => {
    const prior = MIGRATIONS.slice(0, 11).map((migration) => migration.name);
    expect(prior.at(-1)).toBe('0011_artifact_versions');
    expect(planMigrations(prior).applied).toEqual([
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
  });

  it('adds durable scheduler guards after applied 0012', () => {
    const prior = MIGRATIONS.slice(0, 12).map((migration) => migration.name);
    expect(prior.at(-1)).toBe('0012_artifact_integrity');
    expect(planMigrations(prior).applied).toEqual([
      '0013_durable_scheduler',
      '0014_scheduler_fencing',
      '0015_capability_authorization',
      '0016_production_execution',
      '0017_reviewer_rework',
      '0018_complete_agent_version',
      '0019_review_source_evidence_integrity',
      '0020_review_bounds_integrity',
      '0021_merge_step_conflict_resolution',
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
  });

  it('skips previously applied migrations idempotently', () => {
    const prior = MIGRATIONS.map((m) => m.name);
    const plan = planMigrations(prior);
    expect(plan.applied).toHaveLength(0);
    expect(plan.skipped).toHaveLength(MIGRATIONS.length);
  });

  it('applies only the missing migration when one was applied', () => {
    const plan = planMigrations(['0001_baseline_v1']);
    expect(plan.applied).toEqual([
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual(['0001_baseline_v1']);
  });

  it('applies only 0003 when first two applied', () => {
    const plan = planMigrations(['0001_baseline_v1', '0002_fts_messages']);
    expect(plan.applied).toEqual([
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual(['0001_baseline_v1', '0002_fts_messages']);
  });

  it('applies only 0004 when first three applied', () => {
    const plan = planMigrations([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
    ]);
    expect(plan.applied).toEqual([
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
    ]);
  });

  it('applies only 0005 when first four applied', () => {
    const plan = planMigrations([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
    ]);
    expect(plan.applied).toEqual([
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
    ]);
  });

  it('applies only 0006 when first five applied', () => {
    const plan = planMigrations([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
    ]);
    expect(plan.applied).toEqual([
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
    ]);
  });

  it('applies only 0007 when first six applied', () => {
    const plan = planMigrations([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
    ]);
    expect(plan.applied).toEqual([
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
    ]);
  });

  it('applies only 0008 and 0009 when first seven applied', () => {
    const plan = planMigrations([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
    ]);
    expect(plan.applied).toEqual([
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual([
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
    ]);
  });

  it('applies only 0009 when first eight applied', () => {
    const prior = [
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
    ];
    const plan = planMigrations(prior);
    expect(plan.applied).toEqual([
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual(prior);
  });

  it('applies only 0010 when the first nine migrations were applied', () => {
    const prior = [
      '0001_baseline_v1',
      '0002_fts_messages',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
    ];
    const plan = planMigrations(prior);
    expect(plan.applied).toEqual([
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual(prior);
  });

  it('preserves order regardless of prior order given', () => {
    const plan = planMigrations(['0002_fts_messages']);
    expect(plan.applied).toEqual([
      '0001_baseline_v1',
      '0003_memory_diagnostics',
      '0004_skill_version',
      '0005_mcp_server',
      '0006_approval_request',
      '0007_provider_protocol',
      '0008_provider_surface',
      '0009_participation_policy',
      '0010_orchestration_core',
      '0011_artifact_versions',
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
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
    ]);
    expect(plan.skipped).toEqual(['0002_fts_messages']);
  });
});

describe('Drizzle schema shape (no native bind required)', () => {
  it('every schema file exports a table object', async () => {
    const schema = await import('./schema/index.js');
    for (const name of [
      'workspace',
      'task',
      'thread',
      'message',
      'event',
      'checkpoint',
      'provider',
      'credentialGroup',
      'model',
      'agentVersion',
      'credentialRef',
      'migrationRecord',
      'memoryChange',
      'memoryEntry',
      'diagnosticRecord',
      'skillVersion',
      'mcpServer',
      'policyVersion',
      'plan',
      'planRevision',
      'run',
      'step',
      'stepDependency',
    ]) {
      expect(typeof (schema as Record<string, unknown>)[name]).toBe('object');
    }
  });
});

describe.skipIf(!canOpenNativeSqlite())('migration runner live sqlite', () => {
  it('applies baseline tables and FTS triggers to a real sqlite file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-storage-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      const result = await runMigrations(dbPath);
      expect(result.applied).toEqual(MIGRATIONS.map((m) => m.name));

      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const names = raw
          .prepare(
            `SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') ORDER BY name`,
          )
          .all()
          .map((row) => (row as { name: string }).name);

        expect(names).toContain('workspace');
        expect(names).toContain('memory_change');
        expect(names).toContain('memory_entry');
        expect(names).toContain('diagnostic_record');
        expect(names).toContain('task');
        expect(names).toContain('event');
        expect(names).toContain('checkpoint');
        expect(names).toContain('messages_fts');
        expect(names).toContain('messages_ai');
        expect(names).toContain('mcp_server');
        expect(names).toContain('approval_request');
        expect(names).toContain('skill_version');
        expect(names).toContain('policy_version');
        expect(names).toContain('plan');
        expect(names).toContain('plan_revision');
        expect(names).toContain('run');
        expect(names).toContain('step');
        expect(names).toContain('step_dependency');

        const stateTableSql = Object.fromEntries(
          (
            raw
              .prepare(
                `SELECT name, sql FROM sqlite_master
               WHERE type = 'table' AND name IN ('plan_revision', 'run', 'step')`,
              )
              .all() as Array<{ name: string; sql: string }>
          ).map((row) => [row.name, row.sql]),
        );
        expect(stateTableSql.plan_revision).toContain('CONSTRAINT plan_revision_state_check CHECK');
        expect(stateTableSql.run).toContain('CONSTRAINT run_state_check CHECK');
        expect(stateTableSql.step).toContain('CONSTRAINT step_state_check CHECK');

        const indexes = raw
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name`)
          .all()
          .map((row) => (row as { name: string }).name);
        expect(indexes).toEqual(
          expect.arrayContaining([
            'plan_task_idx',
            'plan_revision_plan_revision_uidx',
            'run_plan_revision_uidx',
            'run_task_state_idx',
            'step_run_order_uidx',
            'step_run_state_idx',
            'step_dependency_run_dependency_idx',
            'message_thread_sequence_uidx',
            'message_run_idx',
          ]),
        );

        const taskColumns = raw.prepare('PRAGMA table_info(task)').all() as Array<{
          name: string;
          dflt_value: string | null;
        }>;
        expect(taskColumns).toContainEqual(
          expect.objectContaining({
            name: 'participation_mode',
            dflt_value: "'conversation'",
          }),
        );
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades a complete 0017 AgentVersion without rewriting history and uses safe defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-agent-version-upgrade-'));
    const dbPath = join(dir, 'sync-think.db');
    const eventGlobalCursorMigration =
      MIGRATIONS.at(-1)?.name === '0029_event_global_cursor' ? MIGRATIONS.pop() : undefined;
    const messagePaginationMigration =
      MIGRATIONS.at(-1)?.name === '0028_message_pagination' ? MIGRATIONS.pop() : undefined;
    const skillArchiveMigration =
      MIGRATIONS.at(-1)?.name === '0027_skill_archive' ? MIGRATIONS.pop() : undefined;
    const providerSourceConfigMigration =
      MIGRATIONS.at(-1)?.name === '0026_provider_source_config' ? MIGRATIONS.pop() : undefined;
    const conversationTaskBindingMigration =
      MIGRATIONS.at(-1)?.name === '0025_conversation_task_binding' ? MIGRATIONS.pop() : undefined;
    const mutableAgentTeamMigration =
      MIGRATIONS.at(-1)?.name === '0024_mutable_agent_team_conversation'
        ? MIGRATIONS.pop()
        : undefined;
    const providerCheckpointMigration =
      MIGRATIONS.at(-1)?.name === '0023_provider_execution_checkpoint'
        ? MIGRATIONS.pop()
        : undefined;
    const optionalProjectFolderMigration =
      MIGRATIONS.at(-1)?.name === '0022_optional_project_folder' ? MIGRATIONS.pop() : undefined;
    const mergeResolutionMigration =
      MIGRATIONS.at(-1)?.name === '0021_merge_step_conflict_resolution'
        ? MIGRATIONS.pop()
        : undefined;
    const boundsMigration =
      MIGRATIONS.at(-1)?.name === '0020_review_bounds_integrity' ? MIGRATIONS.pop() : undefined;
    const sourceEvidenceMigration =
      MIGRATIONS.at(-1)?.name === '0019_review_source_evidence_integrity'
        ? MIGRATIONS.pop()
        : undefined;
    const completeMigration =
      MIGRATIONS.at(-1)?.name === '0018_complete_agent_version' ? MIGRATIONS.pop() : undefined;
    try {
      await runMigrations(dbPath);
      const before = await openDatabaseAsync({ path: dbPath });
      try {
        before.raw
          .prepare(
            `INSERT INTO agent_version (
             id, agent_id, version, name, role, developer_instructions,
             input_contract, output_contract, default_model_id,
             default_credential_group_id, pinned_credential_ref_id,
             pause_on_failure, fallback_model_ids_json, memory_scope,
             skill_version_ids_json, mcp_server_ids_json, policy_id,
             approval_mode, created_at
           ) VALUES ('agent-version-before-0018', 'agent-before-0018', 7,
             'Historical agent', 'worker', 'keep instructions', 'keep input',
             'keep output', 'model-before-0018', 'group-before-0018', NULL,
             1, '["model-fallback"]', 'project', '["skill-v1"]',
             '["mcp-v1"]', 'policy-v1', 'delegate', 't0')`,
          )
          .run();
      } finally {
        before.raw.close();
      }

      if (completeMigration) MIGRATIONS.push(completeMigration);
      if (sourceEvidenceMigration) MIGRATIONS.push(sourceEvidenceMigration);
      if (boundsMigration) MIGRATIONS.push(boundsMigration);
      if (mergeResolutionMigration) MIGRATIONS.push(mergeResolutionMigration);
      if (optionalProjectFolderMigration) MIGRATIONS.push(optionalProjectFolderMigration);
      if (providerCheckpointMigration) MIGRATIONS.push(providerCheckpointMigration);
      if (mutableAgentTeamMigration) MIGRATIONS.push(mutableAgentTeamMigration);
      if (conversationTaskBindingMigration) MIGRATIONS.push(conversationTaskBindingMigration);
      if (providerSourceConfigMigration) MIGRATIONS.push(providerSourceConfigMigration);
      if (skillArchiveMigration) MIGRATIONS.push(skillArchiveMigration);
      if (messagePaginationMigration) MIGRATIONS.push(messagePaginationMigration);
      if (eventGlobalCursorMigration) MIGRATIONS.push(eventGlobalCursorMigration);
      expect((await runMigrations(dbPath)).applied).toEqual([
        '0018_complete_agent_version',
        '0019_review_source_evidence_integrity',
        '0020_review_bounds_integrity',
        '0021_merge_step_conflict_resolution',
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      const after = await openDatabaseAsync({ path: dbPath });
      try {
        const row = after.raw
          .prepare(
            `SELECT version, name, default_model_id, fallback_model_ids_json,
                  description, visual_identity_json, mcp_tool_allowlist_json,
                  permissions_json, review_behavior_json, artifact_rules_json
           FROM agent_version WHERE id = 'agent-version-before-0018'`,
          )
          .get() as Record<string, unknown>;
        expect(row).toMatchObject({
          version: 7,
          name: 'Historical agent',
          default_model_id: 'model-before-0018',
          fallback_model_ids_json: '["model-fallback"]',
          description: '',
          visual_identity_json: '{"icon":"bot","color":"#64748b"}',
          mcp_tool_allowlist_json: '[]',
          permissions_json: '{"file":[],"command":[],"browser":[],"desktop":[],"network":[]}',
          review_behavior_json: '{"role":"none","maxIterations":0,"onLimitReached":"pause"}',
          artifact_rules_json:
            '{"retainVersions":true,"requireReview":false,"defaultStatus":"candidate"}',
        });
      } finally {
        after.raw.close();
      }
    } finally {
      for (const migration of [
        completeMigration,
        sourceEvidenceMigration,
        boundsMigration,
        mergeResolutionMigration,
        optionalProjectFolderMigration,
        providerCheckpointMigration,
        mutableAgentTeamMigration,
        conversationTaskBindingMigration,
        providerSourceConfigMigration,
        skillArchiveMigration,
        messagePaginationMigration,
      ]) {
        if (migration && !MIGRATIONS.includes(migration)) MIGRATIONS.push(migration);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('declares the merge base self-reference and conflict source Step ownership', async () => {
    const schema = await import('./schema/index.js');
    const versionForeignKeys = getTableConfig(schema.artifactVersion).foreignKeys.map((key) => {
      const reference = key.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        foreignTable: getTableName(reference.foreignTable),
      };
    });
    expect(versionForeignKeys).toContainEqual({
      columns: ['merge_base_version_id'],
      foreignColumns: ['id'],
      foreignTable: 'artifact_version',
    });

    const conflictForeignKeys = getTableConfig(schema.artifactMergeConflict).foreignKeys.map(
      (key) => {
        const reference = key.reference();
        return {
          columns: reference.columns.map((column) => column.name),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          foreignTable: getTableName(reference.foreignTable),
        };
      },
    );
    expect(conflictForeignKeys).toContainEqual({
      columns: ['run_id', 'source_step_id'],
      foreignColumns: ['run_id', 'id'],
      foreignTable: 'step',
    });
  });

  it('upgrades a pre-0009 database without losing existing tasks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-storage-upgrade-'));
    const dbPath = join(dir, 'sync-think.db');
    const trailingMigrations = MIGRATIONS.splice(8);
    try {
      expect(trailingMigrations.map((migration) => migration.name)).toEqual([
        '0009_participation_policy',
        '0010_orchestration_core',
        '0011_artifact_versions',
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
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      try {
        await runMigrations(dbPath);
      } finally {
        MIGRATIONS.push(...trailingMigrations);
      }

      const beforeUpgrade = await openDatabaseAsync({ path: dbPath });
      try {
        beforeUpgrade.raw
          .prepare(
            `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run('workspace-existing', 'D:\\projects\\existing', 'Existing', 'now', 'now');
        beforeUpgrade.raw
          .prepare(
            `INSERT INTO task (
               id, workspace_id, title, goal, status, acceptance_criteria_json,
               version, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'active', '[]', 0, ?, ?)`,
          )
          .run('task-existing', 'workspace-existing', 'Existing task', 'Keep me', 'now', 'now');
      } finally {
        beforeUpgrade.raw.close();
      }

      const result = await runMigrations(dbPath);
      expect(result.applied).toEqual([
        '0009_participation_policy',
        '0010_orchestration_core',
        '0011_artifact_versions',
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
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      const upgraded = await openDatabaseAsync({ path: dbPath });
      try {
        expect(
          upgraded.raw
            .prepare(`SELECT id, participation_mode FROM task WHERE id = 'task-existing'`)
            .get(),
        ).toEqual({ id: 'task-existing', participation_mode: 'conversation' });
      } finally {
        upgraded.raw.close();
      }
    } finally {
      if (MIGRATIONS[MIGRATIONS.length - 1]?.name !== '0029_event_global_cursor') {
        MIGRATIONS.push(...trailingMigrations);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates immutable artifact tables and guards on a fresh database', async () => {
    if (!canOpenNativeSqlite()) return;
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-artifact-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const names = raw
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE name IN (
               'artifact', 'artifact_version', 'artifact_selection',
               'artifact_merge_conflict', 'artifact_version_immutable_update'
             ) ORDER BY name`,
          )
          .all() as Array<{ name: string }>;
        expect(names.map((row) => row.name)).toEqual([
          'artifact',
          'artifact_merge_conflict',
          'artifact_selection',
          'artifact_version',
          'artifact_version_immutable_update',
        ]);
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies 0012 conflict identity and ownership integrity guards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-artifact-integrity-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const conflictColumns = raw
          .prepare('PRAGMA table_info(artifact_merge_conflict)')
          .all() as Array<{
          name: string;
        }>;
        expect(conflictColumns.map((column) => column.name)).toContain('source_step_id');

        const triggers = raw
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'trigger' AND name LIKE 'artifact%ownership_insert'
             ORDER BY name`,
          )
          .all() as Array<{ name: string }>;
        expect(triggers.map((trigger) => trigger.name)).toEqual([
          'artifact_conflict_resolution_ownership_insert',
          'artifact_merge_conflict_ownership_insert',
          'artifact_ownership_insert',
          'artifact_selection_ownership_insert',
          'artifact_version_ownership_insert',
        ]);

        const foreignKeys = raw
          .prepare('PRAGMA foreign_key_list(artifact_version)')
          .all() as Array<{
          table: string;
          from: string;
          to: string;
        }>;
        expect(foreignKeys).toContainEqual(
          expect.objectContaining({
            table: 'artifact_version',
            from: 'merge_base_version_id',
            to: 'id',
          }),
        );
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies 0013 idempotency and terminal-event uniqueness guards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-scheduler-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const names = raw
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE name IN (
               'step_idempotency_key_uidx',
               'event_run_terminal_uidx',
               'event_step_terminal_uidx',
               'step_idempotency_key_insert_guard',
               'step_idempotency_key_update_guard'
             )
             ORDER BY name`,
          )
          .all() as Array<{ name: string }>;
        expect(names.map((entry) => entry.name)).toEqual([
          'event_run_terminal_uidx',
          'event_step_terminal_uidx',
          'step_idempotency_key_insert_guard',
          'step_idempotency_key_uidx',
          'step_idempotency_key_update_guard',
        ]);
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends 0014 scheduler fencing and exact Step output mapping', async () => {
    expect(MIGRATIONS.at(-16)?.name).toBe('0014_scheduler_fencing');
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-scheduler-fencing-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const stepColumns = raw.prepare("PRAGMA table_info('step')").all() as Array<{
          name: string;
        }>;
        expect(stepColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining(['execution_owner_id', 'lease_expires_at', 'execution_attempt']),
        );
        expect(
          raw
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get('step_output_artifact'),
        ).toEqual({ name: 'step_output_artifact' });
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates immutable capability authorization grants on a fresh database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-authorization-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const columns = raw
          .prepare("PRAGMA table_info('authorization_grant_version')")
          .all() as Array<{ name: string }>;
        expect(columns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            'grant_id',
            'version',
            'scope_type',
            'scope_id',
            'agent_version_id',
            'target_type',
            'skill_version_id',
            'mcp_server_id',
            'tools_json',
            'revoked',
          ]),
        );
        const objects = raw
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE name LIKE 'authorization_grant_%'
             ORDER BY name`,
          )
          .all() as Array<{ name: string }>;
        expect(objects.map((entry) => entry.name)).toEqual(
          expect.arrayContaining([
            'authorization_grant_append_only_delete',
            'authorization_grant_append_only_update',
            'authorization_grant_version',
            'authorization_grant_version_uidx',
          ]),
        );
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates production execution reservations and MCP action intents on a fresh database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-production-execution-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const reservationColumns = raw
          .prepare("PRAGMA table_info('provider_execution_reservation')")
          .all() as Array<{ name: string }>;
        expect(reservationColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            'idempotency_key',
            'run_id',
            'step_id',
            'agent_version_id',
            'execution_owner_id',
            'execution_attempt',
            'state',
            'result_json',
          ]),
        );
        const intentColumns = raw
          .prepare("PRAGMA table_info('mcp_action_execution_intent')")
          .all() as Array<{ name: string }>;
        expect(intentColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            'run_id',
            'step_id',
            'agent_version_id',
            'execution_owner_id',
            'execution_attempt',
            'action_digest',
            'state',
          ]),
        );
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades a complete 0015 database once without rewriting its sentinel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-production-execution-upgrade-'));
    const dbPath = join(dir, 'sync-think.db');
    const trailingMigrations = MIGRATIONS.splice(15);
    try {
      expect(trailingMigrations.map((migration) => migration.name)).toEqual([
        '0016_production_execution',
        '0017_reviewer_rework',
        '0018_complete_agent_version',
        '0019_review_source_evidence_integrity',
        '0020_review_bounds_integrity',
        '0021_merge_step_conflict_resolution',
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      await runMigrations(dbPath);
    } finally {
      MIGRATIONS.push(...trailingMigrations);
    }

    try {
      const before = await openDatabaseAsync({ path: dbPath });
      try {
        before.raw
          .prepare(
            `INSERT INTO agent_version (
             id, agent_id, version, name, role, developer_instructions,
             input_contract, output_contract, default_model_id,
             default_credential_group_id, pinned_credential_ref_id,
             pause_on_failure, fallback_model_ids_json, memory_scope,
             skill_version_ids_json, mcp_server_ids_json, policy_id,
             approval_mode, created_at
           ) VALUES ('agent-before-0016', 'agent-family-before-0016', 1,
             'Before 0016', 'worker', '', '', '', 'model-before-0016',
             'credential-group-before-0016', NULL, 1, '[]', 'task', '[]',
             '["mcp-before-0016"]', NULL, 'request', 't0')`,
          )
          .run();
        before.raw
          .prepare(
            `INSERT INTO mcp_server (
             id, name, transport, endpoint, tools_json, trusted,
             max_output_bytes, timeout_ms, notes, created_at, updated_at
           ) VALUES ('mcp-before-0016', 'Before 0016', 'local-stdio',
             'node before-0016.mjs', '[{"name":"echo"}]', 0,
             65536, 15000, '', 't0', 't0')`,
          )
          .run();
        before.raw
          .prepare(
            `INSERT INTO authorization_grant_version (
             id, grant_id, version, scope_type, scope_id, agent_version_id,
             target_type, skill_version_id, mcp_server_id, tools_json, revoked, created_at
           ) VALUES ('grant-version-before-0016', 'grant-before-0016', 1, 'user',
             'user-before-0016', 'agent-before-0016', 'mcp', NULL,
             'mcp-before-0016', '[]', 0, 't0')`,
          )
          .run();
      } finally {
        before.raw.close();
      }

      expect((await runMigrations(dbPath)).applied).toEqual([
        '0016_production_execution',
        '0017_reviewer_rework',
        '0018_complete_agent_version',
        '0019_review_source_evidence_integrity',
        '0020_review_bounds_integrity',
        '0021_merge_step_conflict_resolution',
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      expect((await runMigrations(dbPath)).applied).toEqual([]);
      const after = await openDatabaseAsync({ path: dbPath });
      try {
        expect(
          after.raw
            .prepare('SELECT id FROM authorization_grant_version WHERE id = ?')
            .get('grant-version-before-0016'),
        ).toEqual({ id: 'grant-version-before-0016' });
      } finally {
        after.raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades a complete 0014 database once without rewriting existing policy history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-authorization-upgrade-'));
    const dbPath = join(dir, 'sync-think.db');
    const trailingMigrations = MIGRATIONS.splice(14);
    try {
      expect(trailingMigrations.map((migration) => migration.name)).toEqual([
        '0015_capability_authorization',
        '0016_production_execution',
        '0017_reviewer_rework',
        '0018_complete_agent_version',
        '0019_review_source_evidence_integrity',
        '0020_review_bounds_integrity',
        '0021_merge_step_conflict_resolution',
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      await runMigrations(dbPath);
    } finally {
      MIGRATIONS.push(...trailingMigrations);
    }

    try {
      const before = await openDatabaseAsync({ path: dbPath });
      try {
        before.raw
          .prepare(
            `INSERT INTO policy_version (
             id, policy_id, version, scope_type, scope_id, approval_mode, rules_json, created_at
           ) VALUES ('policy-version-before-0015', 'policy-before-0015', 1,
             'workspace', 'workspace-before-0015', 'request', '[]', 't0')`,
          )
          .run();
      } finally {
        before.raw.close();
      }

      expect((await runMigrations(dbPath)).applied).toEqual([
        '0015_capability_authorization',
        '0016_production_execution',
        '0017_reviewer_rework',
        '0018_complete_agent_version',
        '0019_review_source_evidence_integrity',
        '0020_review_bounds_integrity',
        '0021_merge_step_conflict_resolution',
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      expect((await runMigrations(dbPath)).applied).toEqual([]);
      const after = await openDatabaseAsync({ path: dbPath });
      try {
        expect(
          after.raw
            .prepare('SELECT id FROM policy_version WHERE id = ?')
            .get('policy-version-before-0015'),
        ).toEqual({ id: 'policy-version-before-0015' });
        expect(
          after.raw
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get('authorization_grant_version'),
        ).toEqual({ name: 'authorization_grant_version' });
      } finally {
        after.raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backfills 0013 terminal outputs and preserves exact replay after 0014', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-legacy-terminal-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      const ids = await createLegacy0013TerminalDatabase(dbPath);
      expect((await runMigrations(dbPath)).applied).toEqual([
        '0014_scheduler_fencing',
        '0015_capability_authorization',
        '0016_production_execution',
        '0017_reviewer_rework',
        '0018_complete_agent_version',
        '0019_review_source_evidence_integrity',
        '0020_review_bounds_integrity',
        '0021_merge_step_conflict_resolution',
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const store = new SqliteOrchestrationStore(raw);
        const completed = store.completeStep({
          runId: ids.completedRun as never,
          stepId: ids.completedStep as never,
          idempotencyKey: ids.completedKey,
          ownerId: 'post-upgrade-replay',
          executionAttempt: 1,
        });
        expect(completed.replayed).toBe(true);
        expect(completed.outputVersions.map((version) => version.id)).toEqual([
          ids.completedVersion,
        ]);

        const failed = store.failStep({
          runId: ids.failedRun as never,
          stepId: ids.failedStep as never,
          idempotencyKey: ids.failedKey,
          ownerId: 'post-upgrade-replay',
          executionAttempt: 1,
          failureClass: 'unknown',
          failureCode: 'step.executor.unknown',
          summary: 'must replay persisted failure',
        });
        expect(failed.replayed).toBe(true);
        expect(failed.partialOutputVersions.map((version) => version.id)).toEqual([
          ids.failedVersion,
        ]);
        expect(
          raw
            .prepare(
              `SELECT run_id, step_id, idempotency_key, outcome, artifact_version_id
             FROM step_output_artifact ORDER BY run_id`,
            )
            .all(),
        ).toEqual([
          {
            run_id: ids.completedRun,
            step_id: ids.completedStep,
            idempotency_key: ids.completedKey,
            outcome: 'completed',
            artifact_version_id: ids.completedVersion,
          },
          {
            run_id: ids.failedRun,
            step_id: ids.failedStep,
            idempotency_key: ids.failedKey,
            outcome: 'failed',
            artifact_version_id: ids.failedVersion,
          },
        ]);
        raw
          .prepare(
            `UPDATE step SET execution_owner_id = 'ordinary-owner'
           WHERE run_id = ? AND id = ?`,
          )
          .run(ids.completedRun, ids.completedStep);
        expect(() =>
          raw
            .prepare(
              `UPDATE step SET execution_owner_id = 'migration:0014:legacy-terminal'
             WHERE run_id = ? AND id = ?`,
            )
            .run(ids.completedRun, ids.completedStep),
        ).toThrow('step.execution_owner_reserved');
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed when a 0013 terminal event points at a cross-Run output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-invalid-terminal-migration-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      const ids = await createLegacy0013TerminalDatabase(dbPath);
      const legacy = await openDatabaseAsync({ path: dbPath });
      try {
        legacy.raw.prepare('UPDATE event SET payload_json = ? WHERE id = ?').run(
          JSON.stringify({
            from: 'running',
            to: 'failed',
            idempotencyKey: ids.failedKey,
            artifactVersionIds: [ids.completedVersion],
          }),
          'event-legacy-failed',
        );
      } finally {
        legacy.raw.close();
      }

      expect((await runMigrations(dbPath)).applied).toEqual([
        '0014_scheduler_fencing',
        '0015_capability_authorization',
        '0016_production_execution',
        '0017_reviewer_rework',
        '0018_complete_agent_version',
        '0019_review_source_evidence_integrity',
        '0020_review_bounds_integrity',
        '0021_merge_step_conflict_resolution',
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        expect(
          raw
            .prepare(
              `SELECT outcome, artifact_version_id FROM step_output_artifact ORDER BY outcome`,
            )
            .all(),
        ).toEqual([{ outcome: 'completed', artifact_version_id: ids.completedVersion }]);
        expect(
          raw
            .prepare(
              `SELECT execution_owner_id, execution_attempt FROM step
             WHERE run_id = ? AND id = ?`,
            )
            .get(ids.failedRun, ids.failedStep),
        ).toEqual({ execution_owner_id: null, execution_attempt: 0 });
        const store = new SqliteOrchestrationStore(raw);
        expect(() =>
          store.failStep({
            runId: ids.failedRun as never,
            stepId: ids.failedStep as never,
            idempotencyKey: ids.failedKey,
            ownerId: 'post-upgrade-replay',
            executionAttempt: 1,
            failureClass: 'unknown',
            failureCode: 'step.executor.unknown',
            summary: 'must not trust forged output scope',
          }),
        ).toThrow('step.fence_mismatch');
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backfills a legacy 0011 conflict only from its matching valid append-only event', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-artifact-legacy-backfill-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      const ids = await createLegacy0011Database(dbPath, true);
      expect((await runMigrations(dbPath)).applied).toEqual([
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
        '0022_optional_project_folder',
        '0023_provider_execution_checkpoint',
        '0024_mutable_agent_team_conversation',
        '0025_conversation_task_binding',
        '0026_provider_source_config',
        '0027_skill_archive',
        '0028_message_pagination',
        '0029_event_global_cursor',
      ]);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        expect(
          raw
            .prepare('SELECT source_step_id FROM artifact_merge_conflict WHERE id = ?')
            .get(ids.conflict),
        ).toEqual({ source_step_id: ids.step });
        const store = new SqliteArtifactStore(raw);
        expect(store.listMergeConflicts(ids.artifact as never)).toEqual([
          expect.objectContaining({
            id: ids.conflict,
            operationId: ids.operation,
            sourceStepId: ids.step,
            legacySourceStepUnknown: false,
          }),
        ]);
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails 0028 atomically instead of rewriting duplicate legacy sequences', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-message-pagination-upgrade-'));
    const dbPath = join(dir, 'sync-think.db');
    const eventGlobalCursorMigration =
      MIGRATIONS.at(-1)?.name === '0029_event_global_cursor' ? MIGRATIONS.pop() : undefined;
    const messagePaginationMigration =
      MIGRATIONS.at(-1)?.name === '0028_message_pagination' ? MIGRATIONS.pop() : undefined;
    expect(messagePaginationMigration?.name).toBe('0028_message_pagination');
    try {
      await runMigrations(dbPath);
      const before = await openDatabaseAsync({ path: dbPath });
      try {
        before.raw.exec(`
          INSERT INTO thread (id, task_id, created_at)
          VALUES ('thread-duplicate-sequence', 'task-duplicate-sequence', 't0');
          INSERT INTO message (
            id, thread_id, role, sequence, blocks_json, created_at
          ) VALUES
            ('message-duplicate-a', 'thread-duplicate-sequence', 'user', 1, '[]', 't0'),
            ('message-duplicate-b', 'thread-duplicate-sequence', 'assistant', 1, '[]', 't1');
        `);
      } finally {
        before.raw.close();
      }

      if (messagePaginationMigration) MIGRATIONS.push(messagePaginationMigration);
      await expect(runMigrations(dbPath)).rejects.toThrow(
        /migration 0028_message_pagination failed:.*unique constraint/i,
      );

      const after = await openDatabaseAsync({ path: dbPath });
      try {
        expect(
          after.raw
            .prepare(
              `SELECT id, sequence FROM message
               WHERE thread_id = 'thread-duplicate-sequence' ORDER BY id`,
            )
            .all(),
        ).toEqual([
          { id: 'message-duplicate-a', sequence: 1 },
          { id: 'message-duplicate-b', sequence: 1 },
        ]);
        expect(
          after.raw
            .prepare(
              `SELECT name FROM sqlite_master
               WHERE type = 'index' AND name IN (
                 'message_thread_sequence_uidx', 'message_run_idx'
               ) ORDER BY name`,
            )
            .all(),
        ).toEqual([]);
        expect(
          after.raw
            .prepare('SELECT name FROM migration_record WHERE name = ?')
            .get('0028_message_pagination'),
        ).toBeUndefined();
      } finally {
        after.raw.close();
      }
    } finally {
      if (messagePaginationMigration && !MIGRATIONS.includes(messagePaginationMigration)) {
        MIGRATIONS.push(messagePaginationMigration);
      }
      if (eventGlobalCursorMigration && !MIGRATIONS.includes(eventGlobalCursorMigration)) {
        MIGRATIONS.push(eventGlobalCursorMigration);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back all statements when a migration fails partway through', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-storage-rollback-'));
    const dbPath = join(dir, 'sync-think.db');
    const failingMigration = {
      name: '9999_test_failure_rollback',
      sql: `
        CREATE TABLE should_be_rolled_back (id TEXT PRIMARY KEY);
        THIS IS NOT VALID SQL;
      `,
    };

    try {
      await runMigrations(dbPath);
      MIGRATIONS.push(failingMigration);
      try {
        await expect(runMigrations(dbPath)).rejects.toThrow(
          'migration 9999_test_failure_rollback failed',
        );
      } finally {
        expect(MIGRATIONS.pop()).toBe(failingMigration);
      }

      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        const partialTable = raw
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get('should_be_rolled_back');
        const migrationRecord = raw
          .prepare('SELECT name FROM migration_record WHERE name = ?')
          .get(failingMigration.name);
        expect(partialTable).toBeUndefined();
        expect(migrationRecord).toBeUndefined();
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('0029 event global cursor migration', () => {
  it('creates the stable global replay index exactly once', async () => {
    if (!canOpenNativeSqlite()) return;
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-event-cursor-index-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      await runMigrations(dbPath);
      const { raw } = await openDatabaseAsync({ path: dbPath });
      try {
        expect(raw.prepare(`PRAGMA index_info('event_global_cursor_idx')`).all()).toMatchObject([
          { seqno: 0, name: 'sequence' },
          { seqno: 1, name: 'id' },
        ]);
        expect(
          raw
            .prepare('SELECT COUNT(*) AS count FROM migration_record WHERE name = ?')
            .get('0029_event_global_cursor'),
        ).toEqual({ count: 1 });
      } finally {
        raw.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
