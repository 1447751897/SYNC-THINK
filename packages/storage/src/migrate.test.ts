import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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

function migrationIndex(name: string): number {
  const index = MIGRATIONS.findIndex((migration) => migration.name === name);
  if (index < 0) throw new Error(`${name} migration missing`);
  return index;
}

function migrationNamesBetween(firstName: string, lastName: string): string[] {
  const firstIndex = migrationIndex(firstName);
  const lastIndex = migrationIndex(lastName);
  return MIGRATIONS.slice(firstIndex, lastIndex + 1).map((migration) => migration.name);
}

function migrationNamesThrough(lastName: string): string[] {
  return MIGRATIONS.slice(0, migrationIndex(lastName) + 1).map((migration) => migration.name);
}

function takeMigrationTail(firstName: string): Array<(typeof MIGRATIONS)[number]> {
  return MIGRATIONS.splice(migrationIndex(firstName));
}

function restoreMigrationTail(
  firstName: string,
  migrations: readonly (typeof MIGRATIONS)[number][],
): void {
  const currentStart = MIGRATIONS.findIndex((migration) => migration.name === firstName);
  if (currentStart >= 0) MIGRATIONS.splice(currentStart);
  MIGRATIONS.push(...migrations);
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
  it('keeps message pagination, the event cursor, and Browser persistence ordered last', () => {
    expect(
      migrationNamesBetween('0022_optional_project_folder', '0030_browser_persistence_permissions'),
    ).toEqual([
      '0022_optional_project_folder',
      '0023_provider_execution_checkpoint',
      '0024_mutable_agent_team_conversation',
      '0025_conversation_task_binding',
      '0026_provider_source_config',
      '0027_skill_archive',
      '0028_message_pagination',
      '0029_event_global_cursor',
      '0030_browser_persistence_permissions',
    ]);
  });

  it.runIf(canOpenNativeSqlite())(
    'makes workspace folder_path nullable without losing rows',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sync-think-project-folder-migration-'));
      const dbPath = join(dir, 'sync-think.db');
      try {
        const trailing = MIGRATIONS.splice(
          MIGRATIONS.findIndex((migration) => migration.name === '0022_optional_project_folder'),
        );
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
          '0030_browser_persistence_permissions',
          '0031_desktop_command',
          '0032_scheduler_fencing_repair',
          '0033_image_generation_config',
          '0034_agent_context_usage',
          '0035_review_image_selection_freeze',
          '0036_browser_profile_site_sessions',
          '0037_browser_recording',
          '0038_browser_automation_workflow',
          '0039_capability_enablement',
          '0040_capability_governance',
          '0041_task_plan',
          '0042_conversation_interaction_mode',
          '0043_conversation_plan',
          '0044_scheduled_task',
          '0045_scheduled_task_scope',
          '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
    expect(
      migrationNamesBetween('0017_reviewer_rework', '0030_browser_persistence_permissions'),
    ).toEqual([
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
      '0030_browser_persistence_permissions',
    ]);
  });

  it('reserves 0016 for production execution fencing after frozen 0015', () => {
    expect(migrationNamesBetween('0015_capability_authorization', '0017_reviewer_rework')).toEqual([
      '0015_capability_authorization',
      '0016_production_execution',
      '0017_reviewer_rework',
    ]);
    const through0015 = migrationNamesThrough('0015_capability_authorization');
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
    ]);
  });

  it('appends capability authorization after the frozen 0014 migration', () => {
    expect(
      migrationNamesBetween('0014_scheduler_fencing', '0015_capability_authorization'),
    ).toEqual(['0014_scheduler_fencing', '0015_capability_authorization']);
    const through0014 = migrationNamesThrough('0014_scheduler_fencing');
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      '0030_browser_persistence_permissions',
      '0031_desktop_command',
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
      '0041_task_plan',
      '0042_conversation_interaction_mode',
      '0043_conversation_plan',
      '0044_scheduled_task',
      '0045_scheduled_task_scope',
      '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
  it('skips backup creation for a fresh database and a no-op rerun', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-storage-noop-backup-'));
    const dbPath = join(dir, 'sync-think.db');
    const backupDir = join(dir, 'backups');
    try {
      const initial = await runMigrations(dbPath);
      expect(initial.backupPath).toBeUndefined();
      expect(existsSync(backupDir)).toBe(false);

      const rerun = await runMigrations(dbPath);
      expect(rerun.applied).toEqual([]);
      expect(rerun.skipped).toEqual(MIGRATIONS.map((migration) => migration.name));
      expect(rerun.backupPath).toBeUndefined();
      expect(existsSync(backupDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates exactly one backup before applying a pending migration to an existing database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-storage-pending-backup-'));
    const dbPath = join(dir, 'sync-think.db');
    const backupDir = join(dir, 'backups');
    const pendingMigration = {
      name: '9998_test_pending_backup',
      sql: 'CREATE TABLE pending_backup_evidence (id TEXT PRIMARY KEY);',
    };
    try {
      await runMigrations(dbPath);
      MIGRATIONS.push(pendingMigration);
      try {
        const result = await runMigrations(dbPath);
        expect(result.applied).toEqual([pendingMigration.name]);
        expect(result.backupPath).toBeDefined();
        expect(existsSync(result.backupPath!)).toBe(true);
        expect(readdirSync(backupDir)).toHaveLength(1);
      } finally {
        expect(MIGRATIONS.pop()).toBe(pendingMigration);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the pre-migration backup when a pending migration fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-storage-failed-backup-'));
    const dbPath = join(dir, 'sync-think.db');
    const backupDir = join(dir, 'backups');
    const failingMigration = {
      name: '9999_test_failed_backup',
      sql: 'THIS IS NOT VALID SQL;',
    };
    try {
      await runMigrations(dbPath);
      MIGRATIONS.push(failingMigration);
      try {
        await expect(runMigrations(dbPath)).rejects.toThrow(
          `migration ${failingMigration.name} failed`,
        );
        expect(readdirSync(backupDir)).toHaveLength(1);
      } finally {
        expect(MIGRATIONS.pop()).toBe(failingMigration);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never creates a backup for an in-memory database', async () => {
    const result = await runMigrations(':memory:');
    expect(result.applied).toEqual(MIGRATIONS.map((migration) => migration.name));
    expect(result.backupPath).toBeUndefined();
  });

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
    const trailingMigrations = takeMigrationTail('0018_complete_agent_version');
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

      MIGRATIONS.push(...trailingMigrations);
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      restoreMigrationTail('0018_complete_agent_version', trailingMigrations);
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
      // Idempotent restore: the inner try/finally already pushed the tail when
      // runMigrations ran. This outer guard only restores when the splice left
      // MIGRATIONS truncated (e.g. the tail assertion failed before the inner
      // finally). Checking for the tail's first migration is stable across
      // appends — a hard-coded "last name" check breaks when new migrations are
      // added after this one.
      if (!MIGRATIONS.some((migration) => migration.name === '0009_participation_policy')) {
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
    expect(MIGRATIONS[migrationIndex('0014_scheduler_fencing')]?.name).toBe(
      '0014_scheduler_fencing',
    );
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

  it('repairs legacy strict scheduler fencing without clearing terminal execution identity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-scheduler-fencing-repair-'));
    const dbPath = join(dir, 'sync-think.db');
    try {
      await runMigrations(dbPath);
      const legacy = await openDatabaseAsync({ path: dbPath });
      try {
        legacy.raw.exec(`
          DELETE FROM migration_record WHERE name = '0032_scheduler_fencing_repair';
          DROP TRIGGER IF EXISTS step_execution_insert_guard;
          DROP TRIGGER IF EXISTS step_execution_update_guard;
          CREATE TRIGGER step_execution_insert_guard
          BEFORE INSERT ON step
          WHEN NEW.execution_attempt < 0
            OR (NEW.execution_owner_id IS NULL) <> (NEW.lease_expires_at IS NULL)
            OR (NEW.state = 'running' AND NEW.execution_owner_id IS NULL)
            OR (NEW.state <> 'running' AND NEW.execution_owner_id IS NOT NULL)
          BEGIN
            SELECT RAISE(ABORT, 'step.execution_fence invalid');
          END;
          CREATE TRIGGER step_execution_update_guard
          BEFORE UPDATE OF state, execution_owner_id, lease_expires_at, execution_attempt ON step
          WHEN NEW.execution_attempt < 0
            OR (NEW.execution_owner_id IS NULL) <> (NEW.lease_expires_at IS NULL)
            OR (NEW.state = 'running' AND NEW.execution_owner_id IS NULL)
            OR (NEW.state <> 'running' AND NEW.execution_owner_id IS NOT NULL)
          BEGIN
            SELECT RAISE(ABORT, 'step.execution_fence invalid');
          END;
          PRAGMA foreign_keys = OFF;
          INSERT INTO step (
            id, run_id, plan_order, title, instructions, agent_version_id, state,
            retries, idempotency_key, created_at, updated_at, execution_owner_id,
            lease_expires_at, execution_attempt
          ) VALUES (
            'step-repair', 'run-repair', 0, 'Repair', 'Repair fencing',
            'agent-version-repair', 'running', 0, '${'a'.repeat(64)}', 't0', 't0',
            'runtime-repair', '2099-01-01T00:00:00.000Z', 7
          );
          PRAGMA foreign_keys = ON;
        `);
        expect(() =>
          legacy.raw
            .prepare(
              `UPDATE step SET state = 'failed', lease_expires_at = NULL
               WHERE run_id = 'run-repair' AND id = 'step-repair'`,
            )
            .run(),
        ).toThrow('step.execution_fence invalid');
      } finally {
        legacy.raw.close();
      }

      expect((await runMigrations(dbPath)).applied).toEqual(['0032_scheduler_fencing_repair']);
      const repaired = await openDatabaseAsync({ path: dbPath });
      try {
        const triggerSql = repaired.raw
          .prepare(
            `SELECT sql FROM sqlite_master
             WHERE type = 'trigger' AND name = 'step_execution_update_guard'`,
          )
          .get() as { sql: string };
        expect(triggerSql.sql).toContain("NEW.state IN ('pending', 'ready', 'awaitingApproval'");
        expect(triggerSql.sql).not.toContain(
          '(NEW.execution_owner_id IS NULL) <> (NEW.lease_expires_at IS NULL)',
        );
        repaired.raw
          .prepare(
            `UPDATE step SET state = 'failed', lease_expires_at = NULL
             WHERE run_id = 'run-repair' AND id = 'step-repair'`,
          )
          .run();
        expect(
          repaired.raw
            .prepare(
              `SELECT state, execution_owner_id, lease_expires_at, execution_attempt
               FROM step WHERE run_id = 'run-repair' AND id = 'step-repair'`,
            )
            .get(),
        ).toEqual({
          state: 'failed',
          execution_owner_id: 'runtime-repair',
          lease_expires_at: null,
          execution_attempt: 7,
        });
      } finally {
        repaired.raw.close();
      }
      expect((await runMigrations(dbPath)).applied).toEqual([]);
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
        '0030_browser_persistence_permissions',
        '0031_desktop_command',
        '0032_scheduler_fencing_repair',
        '0033_image_generation_config',
        '0034_agent_context_usage',
        '0035_review_image_selection_freeze',
        '0036_browser_profile_site_sessions',
        '0037_browser_recording',
        '0038_browser_automation_workflow',
        '0039_capability_enablement',
        '0040_capability_governance',
        '0041_task_plan',
        '0042_conversation_interaction_mode',
        '0043_conversation_plan',
        '0044_scheduled_task',
        '0045_scheduled_task_scope',
        '0046_scheduled_task_history',
      '0047_daemon_task_queue',
      '0048_daemon_external_event',
      '0049_run_index',
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
    const trailingMigrations = takeMigrationTail('0028_message_pagination');
    const messagePaginationMigration = trailingMigrations[0];
    expect(messagePaginationMigration.name).toBe('0028_message_pagination');
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

      MIGRATIONS.push(messagePaginationMigration);
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
      restoreMigrationTail('0028_message_pagination', trailingMigrations);
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

describe('0033 image generation config migration', () => {
  it('is ordered after scheduler fencing repair', () => {
    expect(
      migrationNamesBetween('0032_scheduler_fencing_repair', '0040_capability_governance'),
    ).toEqual([
      '0032_scheduler_fencing_repair',
      '0033_image_generation_config',
      '0034_agent_context_usage',
      '0035_review_image_selection_freeze',
      '0036_browser_profile_site_sessions',
      '0037_browser_recording',
      '0038_browser_automation_workflow',
      '0039_capability_enablement',
      '0040_capability_governance',
    ]);
  });

  it.runIf(canOpenNativeSqlite())(
    'adds a nullable checked Step column and remains idempotent',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'sync-think-image-generation-migration-'));
      const dbPath = join(dir, 'sync-think.db');
      try {
        await runMigrations(dbPath);
        expect((await runMigrations(dbPath)).applied).toEqual([]);

        const { raw } = await openDatabaseAsync({ path: dbPath });
        try {
          const column = (
            raw.prepare("PRAGMA table_info('step')").all() as Array<{
              name: string;
              notnull: number;
              dflt_value: string | null;
            }>
          ).find((candidate) => candidate.name === 'image_generation_config_json');
          expect(column).toMatchObject({
            name: 'image_generation_config_json',
            notnull: 0,
            dflt_value: null,
          });

          raw.pragma('foreign_keys = OFF');
          const insert = raw.prepare(
            `INSERT INTO step (
               id, run_id, kind, plan_order, title, instructions, agent_version_id,
               image_generation_config_json, state, retries, created_at, updated_at
             ) VALUES (?, ?, 'execution', ?, 'Image', 'Generate', 'agent-version-image',
               ?, 'pending', 0, 't0', 't0')`,
          );
          insert.run('step-image-legacy', 'run-image-legacy', 0, null);
          insert.run(
            'step-image-valid',
            'run-image-valid',
            0,
            JSON.stringify({ size: '1536x1024', quality: 'high', count: 4 }),
          );

          const invalidConfigs = [
            { size: '512x512', quality: 'high', count: 1 },
            { size: '1024x1024', quality: 'ultra', count: 1 },
            { size: '1024x1024', quality: 'medium', count: 0 },
            { size: '1024x1024', quality: 'medium', count: 5 },
            { size: '1024x1024', quality: 'medium', count: 1.5 },
          ];
          for (const [index, config] of invalidConfigs.entries()) {
            expect(() =>
              insert.run(
                `step-image-invalid-${index}`,
                `run-image-invalid-${index}`,
                0,
                JSON.stringify(config),
              ),
            ).toThrow(/CHECK constraint failed/i);
          }

          expect(
            raw
              .prepare(
                `SELECT id, image_generation_config_json
                 FROM step WHERE id IN ('step-image-legacy', 'step-image-valid') ORDER BY id`,
              )
              .all(),
          ).toEqual([
            { id: 'step-image-legacy', image_generation_config_json: null },
            {
              id: 'step-image-valid',
              image_generation_config_json: JSON.stringify({
                size: '1536x1024',
                quality: 'high',
                count: 4,
              }),
            },
          ]);
        } finally {
          raw.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0036 Browser Profile schema contract', () => {
  it.runIf(canOpenNativeSqlite())(
    'keeps Drizzle declarations aligned with the published migration',
    async () => {
      const schema = await import('./schema/index.js');
      const profileConfig = getTableConfig(schema.browserProfile);
      const siteConfig = getTableConfig(schema.browserSiteSession);
      const commandConfig = getTableConfig(schema.browserCommand);

      expect(profileConfig.indexes.map((index) => index.config.name)).toEqual([
        'browser_profile_active_idx',
        'browser_profile_single_default_uidx',
      ]);
      expect(profileConfig.checks.map((check) => check.name)).toEqual([
        'browser_profile_revision_check',
        'browser_profile_default_check',
      ]);
      expect(siteConfig.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual(
        [['profile_id', 'site_key']],
      );
      expect(siteConfig.checks.map((check) => check.name)).toEqual([
        'browser_site_session_origins_json_check',
        'browser_site_session_storage_types_json_check',
        'browser_site_session_state_check',
        'browser_site_session_cookie_count_check',
        'browser_site_session_storage_bytes_check',
      ]);
      expect(commandConfig.indexes.map((index) => index.config.name)).toContain(
        'browser_command_profile_state_idx',
      );
      const siteForeignKey = siteConfig.foreignKeys
        .map((key) => key.reference())
        .find(
          (reference) => reference.columns.map((column) => column.name).join() === 'profile_id',
        );
      expect(siteForeignKey).toMatchObject({
        columns: [expect.objectContaining({ name: 'profile_id' })],
        foreignColumns: [expect.objectContaining({ name: 'id' })],
      });
      expect(getTableName(siteForeignKey!.foreignTable)).toBe('browser_profile');

      const dir = mkdtempSync(join(tmpdir(), 'sync-think-browser-schema-contract-'));
      const dbPath = join(dir, 'sync-think.db');
      try {
        await runMigrations(dbPath);
        const { raw } = await openDatabaseAsync({ path: dbPath });
        try {
          const profileColumns = raw
            .prepare("PRAGMA table_info('browser_profile')")
            .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;
          expect(profileColumns.map((column) => column.name)).toEqual([
            'id',
            'name',
            'revision',
            'is_default',
            'created_at',
            'updated_at',
            'last_used_at',
            'deleted_at',
          ]);
          expect(profileColumns.find((column) => column.name === 'revision')).toMatchObject({
            notnull: 1,
            dflt_value: '1',
          });

          const siteColumns = raw
            .prepare("PRAGMA table_info('browser_site_session')")
            .all() as Array<{ name: string; pk: number }>;
          expect(
            siteColumns.filter((column) => column.pk > 0).map((column) => column.name),
          ).toEqual(['profile_id', 'site_key']);

          const profileIndexes = raw
            .prepare("PRAGMA index_list('browser_profile')")
            .all() as Array<{ name: string; unique: number }>;
          expect(profileIndexes.map((index) => index.name)).toEqual(
            expect.arrayContaining([
              'browser_profile_active_idx',
              'browser_profile_single_default_uidx',
            ]),
          );
          expect(
            raw
              .prepare(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'browser_profile_single_default_uidx'",
              )
              .get(),
          ).toMatchObject({ sql: expect.stringMatching(/WHERE\s+is_default\s*=\s*1/i) });

          const commandIndexes = raw
            .prepare("PRAGMA index_list('browser_command')")
            .all() as Array<{ name: string }>;
          expect(commandIndexes.map((index) => index.name)).toContain(
            'browser_command_profile_state_idx',
          );
          expect(
            raw
              .prepare(
                "SELECT name FROM migration_record WHERE name = '0036_browser_profile_site_sessions'",
              )
              .get(),
          ).toEqual({ name: '0036_browser_profile_site_sessions' });
          expect(
            raw.prepare("SELECT id, is_default FROM browser_profile WHERE id = 'default'").get(),
          ).toEqual({ id: 'default', is_default: 1 });
        } finally {
          raw.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe('0037 Browser recording schema contract', () => {
  it.runIf(canOpenNativeSqlite())(
    'keeps durable recording intent, bounded steps, and one active claim per Profile',
    async () => {
      const schema = await import('./schema/index.js');
      const recordingConfig = getTableConfig(schema.browserRecording);
      const stepConfig = getTableConfig(schema.browserRecordingStep);

      expect(recordingConfig.indexes.map((index) => index.config.name)).toEqual([
        'browser_recording_profile_state_idx',
        'browser_recording_one_active_profile_uidx',
      ]);
      expect(recordingConfig.checks.map((check) => check.name)).toEqual([
        'browser_recording_status_check',
        'browser_recording_revision_check',
        'browser_recording_step_count_check',
        'browser_recording_lease_pair_check',
        'browser_recording_stop_reason_check',
      ]);
      expect(stepConfig.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual(
        [['recording_id', 'sequence']],
      );
      expect(stepConfig.checks.map((check) => check.name)).toEqual([
        'browser_recording_step_sequence_check',
        'browser_recording_step_kind_check',
        'browser_recording_step_payload_json_check',
        'browser_recording_step_payload_size_check',
      ]);

      const dir = mkdtempSync(join(tmpdir(), 'sync-think-browser-recording-schema-'));
      const dbPath = join(dir, 'sync-think.db');
      try {
        await runMigrations(dbPath);
        const { raw } = await openDatabaseAsync({ path: dbPath });
        try {
          expect(
            raw
              .prepare("SELECT name FROM migration_record WHERE name = '0037_browser_recording'")
              .get(),
          ).toEqual({ name: '0037_browser_recording' });

          const activeIndex = raw
            .prepare(
              "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'browser_recording_one_active_profile_uidx'",
            )
            .get() as { sql: string };
          expect(activeIndex.sql).toMatch(
            /UNIQUE[\s\S]+profile_id[\s\S]+WHERE[\s\S]+starting[\s\S]+recording[\s\S]+stopping/i,
          );

          raw
            .prepare(
              `INSERT INTO browser_recording (
               id, profile_id, owner_id, lease_id, page_id, status, revision,
               start_url, current_url, step_count, stop_reason, error_code,
               created_at, started_at, stopped_at, updated_at
             ) VALUES (
               'recording-schema-1', 'default', 'recording:recording-schema-1', NULL, NULL,
               'starting', 1, NULL, NULL, 0, NULL, NULL, 't0', NULL, NULL, 't0'
             )`,
            )
            .run();
          expect(() =>
            raw
              .prepare(
                `INSERT INTO browser_recording (
                 id, profile_id, owner_id, lease_id, page_id, status, revision,
                 start_url, current_url, step_count, stop_reason, error_code,
                 created_at, started_at, stopped_at, updated_at
               ) VALUES (
                 'recording-schema-2', 'default', 'recording:recording-schema-2', NULL, NULL,
                 'recording', 1, NULL, NULL, 0, NULL, NULL, 't0', 't0', NULL, 't0'
               )`,
              )
              .run(),
          ).toThrow(/UNIQUE constraint failed/i);
          expect(() =>
            raw
              .prepare(
                `INSERT INTO browser_recording_step (
                 recording_id, sequence, kind, payload_json, recorded_at, updated_at
               ) VALUES ('recording-schema-1', 201, 'navigate', '{}', 't0', 't0')`,
              )
              .run(),
          ).toThrow(/CHECK constraint failed/i);
        } finally {
          raw.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
