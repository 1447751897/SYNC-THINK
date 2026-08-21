import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import { SqliteOrchestrationStore } from './orchestration-store.js';
import { MIGRATIONS, runMigrations } from './scripts/migrate.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-review-migration-'));
  dirs.push(dir);
  return join(dir, 'sync-think.db');
}

function takeMigrationTail(firstName: string): Array<(typeof MIGRATIONS)[number]> {
  const index = MIGRATIONS.findIndex((migration) => migration.name === firstName);
  if (index < 0) throw new Error(`${firstName} migration missing`);
  return MIGRATIONS.splice(index);
}

function restoreMigrationTail(migrations: readonly (typeof MIGRATIONS)[number][]): void {
  for (const migration of migrations) {
    if (!MIGRATIONS.includes(migration)) MIGRATIONS.push(migration);
  }
}

function seedAcceptanceGate(raw: BetterSQLite3Raw): void {
  raw.exec(`
    INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
    VALUES ('workspace-bounds', 'D:\\bounds', 'Bounds', 't0', 't0');
    INSERT INTO task (
      id, workspace_id, title, goal, status, participation_mode,
      acceptance_criteria_json, version, created_at, updated_at
    ) VALUES (
      'task-bounds', 'workspace-bounds', 'Bounds', 'Bounds', 'active', 'automatic',
      '["Criterion zero"]', 0, 't0', 't0'
    );
    INSERT INTO agent_version (
      id, agent_id, version, name, role, developer_instructions, input_contract,
      output_contract, default_model_id, default_credential_group_id,
      pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
      memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
      approval_mode, review_behavior_json, created_at
    ) VALUES (
      'agent-target-bounds', 'agent-target-bounds-root', 1, 'Target', 'worker', '', '', '',
      'model-target', 'group-target', NULL, 1, '[]', 'task', '[]', '[]', NULL,
      'request', '{"role":"none","maxIterations":0,"onLimitReached":"pause"}', 't0'
    );
    INSERT INTO agent_version (
      id, agent_id, version, name, role, developer_instructions, input_contract,
      output_contract, default_model_id, default_credential_group_id,
      pinned_credential_ref_id, pause_on_failure, fallback_model_ids_json,
      memory_scope, skill_version_ids_json, mcp_server_ids_json, policy_id,
      approval_mode, review_behavior_json, created_at
    ) VALUES (
      'agent-reviewer-bounds', 'agent-reviewer-bounds-root', 1, 'Reviewer', 'reviewer', '', '', '',
      'model-reviewer', 'group-reviewer', NULL, 1, '[]', 'task', '[]', '[]', NULL,
      'request', '{"role":"reviewer","maxIterations":1,"onLimitReached":"pause"}', 't0'
    );
  `);
  const hasStepKind = (
    raw.prepare("PRAGMA table_info('step')").all() as Array<{ name: string }>
  ).some((column) => column.name === 'kind');
  if (!hasStepKind) {
    raw.exec(`
      INSERT INTO plan (id, task_id, created_at, updated_at)
      VALUES ('plan-bounds', 'task-bounds', 't0', 't0');
      INSERT INTO plan_revision (
        id, plan_id, revision, title, steps_json, diff_json,
        state, created_at, approved_at
      ) VALUES (
        'plan-revision-bounds', 'plan-bounds', 1, 'Bounds plan',
        '[{"id":"target-bounds","title":"Target","instructions":"Produce output","agentVersionId":"agent-target-bounds","dependsOn":[]}]',
        '{"added":[],"removed":[],"changed":[]}',
        'approved', 't0', 't0'
      );
      INSERT INTO run (
        id, task_id, plan_revision_id, workflow_version_id, state, created_at, updated_at
      ) VALUES (
        'run-bounds', 'task-bounds', 'plan-revision-bounds', NULL, 'queued', 't0', 't0'
      );
      INSERT INTO step (
        id, run_id, plan_order, title, instructions, agent_version_id,
        model_override_id, state, retries, retry_of_step_id, idempotency_key,
        created_at, updated_at
      ) VALUES (
        'target-bounds', 'run-bounds', 0, 'Target', 'Produce output',
        'agent-target-bounds', NULL, 'pending', 0, NULL, NULL, 't0', 't0'
      );
      INSERT INTO acceptance_gate (
        id, run_id, target_step_id, reviewer_agent_version_id,
        backup_agent_version_id, max_iterations, on_limit_reached,
        state, reassigned, created_at
      ) VALUES (
        'gate-bounds', 'run-bounds', 'target-bounds', 'agent-reviewer-bounds',
        NULL, 1, 'pause', 'active', 0, 't0'
      );
      INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
      VALUES ('gate-bounds', 'criterion-0', 'Criterion zero', 0);
    `);
    return;
  }
  const store = new SqliteOrchestrationStore(raw);
  const draft = store.createPlanDraft({
    taskId: 'task-bounds' as never,
    title: 'Bounds plan',
    steps: [
      {
        id: 'target-bounds' as never,
        title: 'Target',
        instructions: 'Produce output',
        agentVersionId: 'agent-target-bounds' as never,
        dependsOn: [],
      },
    ],
    now: '2026-07-14T00:00:00.000Z',
  });
  const graph = store.approvePlan({
    planId: draft.planId,
    revision: 1,
    now: '2026-07-14T00:00:01.000Z',
  });
  store.createAcceptanceGate({
    id: 'gate-bounds' as never,
    runId: graph.run.id,
    targetStepId: 'target-bounds' as never,
    reviewerAgentVersionId: 'agent-reviewer-bounds' as never,
    maxIterations: 1,
    onLimitReached: 'pause',
    criteria: [{ id: 'criterion-0', description: 'Criterion zero' }],
    now: '2026-07-14T00:00:02.000Z',
  });
}

async function seedInvalid0019(
  path: string,
  corrupt: (raw: BetterSQLite3Raw) => void,
): Promise<void> {
  const pendingMigrations = takeMigrationTail('0020_review_bounds_integrity');
  try {
    await runMigrations(path);
    const before = await openDatabaseAsync({ path });
    try {
      seedAcceptanceGate(before.raw);
      corrupt(before.raw);
    } finally {
      before.raw.close();
    }
  } finally {
    restoreMigrationTail(pendingMigrations);
  }
}

async function expectAtomic0020Failure(path: string, code: string): Promise<void> {
  await expect(runMigrations(path)).rejects.toThrow(code);
  const after = await openDatabaseAsync({ path });
  try {
    expect(
      after.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM migration_record
           WHERE name = '0020_review_bounds_integrity'`,
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      after.raw
        .prepare(
          `SELECT name FROM sqlite_master WHERE name IN (
             'review_bounds_0020_preflight',
             'review_bounds_0020_preflight_guard',
             'acceptance_gate_max_iterations_insert_guard',
             'acceptance_criterion_bounds_insert_guard'
           ) ORDER BY name`,
        )
        .all(),
    ).toEqual([]);
  } finally {
    after.raw.close();
  }
}

describe('0017_reviewer_rework migration', () => {
  it('is appended after the frozen 0016 migration', () => {
    const names = MIGRATIONS.map((migration) => migration.name);
    const frozenIndex = names.indexOf('0016_production_execution');
    const reviewerReworkIndex = names.indexOf('0017_reviewer_rework');
    const browserRecordingIndex = names.indexOf('0037_browser_recording');
    const browserAutomationIndex = names.indexOf('0038_browser_automation_workflow');
    const capabilityEnablementIndex = names.indexOf('0039_capability_enablement');
    const capabilityGovernanceIndex = names.indexOf('0040_capability_governance');
    const taskPlanIndex = names.indexOf('0041_task_plan');
    const interactionModeIndex = names.indexOf('0042_conversation_interaction_mode');
    const conversationPlanIndex = names.indexOf('0043_conversation_plan');

    expect(frozenIndex).toBeGreaterThanOrEqual(0);
    expect(reviewerReworkIndex).toBe(frozenIndex + 1);
    expect(browserRecordingIndex).toBe(names.indexOf('0036_browser_profile_site_sessions') + 1);
    expect(browserAutomationIndex).toBe(browserRecordingIndex + 1);
    expect(capabilityEnablementIndex).toBe(browserAutomationIndex + 1);
    expect(capabilityGovernanceIndex).toBe(capabilityEnablementIndex + 1);
    expect(taskPlanIndex).toBe(capabilityGovernanceIndex + 1);
    expect(interactionModeIndex).toBe(taskPlanIndex + 1);
    expect(conversationPlanIndex).toBe(interactionModeIndex + 1);
    const taskHistoryIndex = names.indexOf('0046_scheduled_task_history');
    const daemonTaskQueueIndex = names.indexOf('0047_daemon_task_queue');
    const daemonExternalEventIndex = names.indexOf('0048_daemon_external_event');
    expect(taskHistoryIndex).toBe(conversationPlanIndex + 3);
    expect(daemonTaskQueueIndex).toBe(taskHistoryIndex + 1);
    expect(daemonExternalEventIndex).toBe(daemonTaskQueueIndex + 1);
    expect(daemonExternalEventIndex).toBe(names.length - 1);
    expect(names.slice(frozenIndex, reviewerReworkIndex + 2)).toEqual([
      '0016_production_execution',
      '0017_reviewer_rework',
      '0018_complete_agent_version',
    ]);
  });

  it('creates the immutable image selection freeze projection and its guards', async () => {
    const path = dbPath();
    await runMigrations(path);
    const { raw } = await openDatabaseAsync({ path });
    try {
      expect(
        raw
          .prepare(
            `SELECT type, name FROM sqlite_master
             WHERE name IN (
               'review_step_artifact_selection',
               'review_step_artifact_selection_insert_guard',
               'review_step_artifact_selection_update_guard',
               'review_step_artifact_selection_delete_guard'
             ) ORDER BY name`,
          )
          .all(),
      ).toEqual([
        { type: 'table', name: 'review_step_artifact_selection' },
        { type: 'trigger', name: 'review_step_artifact_selection_delete_guard' },
        { type: 'trigger', name: 'review_step_artifact_selection_insert_guard' },
        { type: 'trigger', name: 'review_step_artifact_selection_update_guard' },
      ]);
    } finally {
      raw.close();
    }
  });

  it('guards future direct criterion inserts by shared UTF-8 bounds', async () => {
    const path = dbPath();
    await runMigrations(path);
    const { raw } = await openDatabaseAsync({ path });
    try {
      seedAcceptanceGate(raw);
      const insert = raw.prepare(
        `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
         VALUES ('gate-bounds', ?, ?, ?)`,
      );

      raw.exec('SAVEPOINT criterion_count');
      try {
        for (let index = 1; index < 64; index += 1) {
          insert.run(`criterion-${index}`, `Criterion ${index}`, index);
        }
        expect(() => insert.run('criterion-64', 'Criterion 64', 64)).toThrow(
          'acceptance_criteria.too_many',
        );
      } finally {
        raw.exec('ROLLBACK TO criterion_count; RELEASE criterion_count');
      }

      expect(() => insert.run('blank', '   ', 1)).toThrow('acceptance_criteria.empty');
      expect(() => insert.run('oversized', '\u754c'.repeat(1_334), 1)).toThrow(
        'acceptance_criteria.item_too_large',
      );

      raw.exec('SAVEPOINT criterion_total');
      try {
        for (let index = 1; index <= 16; index += 1) {
          insert.run(`total-${index}`, 'x'.repeat(4_000), index);
        }
        expect(() => insert.run('total-overflow', 'x'.repeat(1_600), 17)).toThrow(
          'acceptance_criteria.total_too_large',
        );
      } finally {
        raw.exec('ROLLBACK TO criterion_total; RELEASE criterion_total');
      }
    } finally {
      raw.close();
    }
  });

  it('rejects ECMAScript Unicode whitespace on future criterion inserts and updates', async () => {
    const path = dbPath();
    await runMigrations(path);
    const { raw } = await openDatabaseAsync({ path });
    try {
      seedAcceptanceGate(raw);
      expect(() =>
        raw
          .prepare(
            `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
             VALUES ('gate-bounds', 'unicode-blank', ?, 1)`,
          )
          .run('\u3000'),
      ).toThrow('acceptance_criteria.empty');
      expect(() =>
        raw
          .prepare(
            `UPDATE acceptance_criterion SET description = ?
             WHERE gate_id = 'gate-bounds' AND id = 'criterion-0'`,
          )
          .run('\u3000'),
      ).toThrow('acceptance_criteria.empty');
    } finally {
      raw.close();
    }
  });

  it('guards future direct Gate inserts above MAX_REVIEW_ITERATIONS', async () => {
    const path = dbPath();
    await runMigrations(path);
    const { raw } = await openDatabaseAsync({ path });
    try {
      seedAcceptanceGate(raw);
      const runId = (
        raw.prepare("SELECT run_id FROM acceptance_gate WHERE id = 'gate-bounds'").get() as {
          run_id: string;
        }
      ).run_id;
      raw
        .prepare(
          `INSERT INTO step (
             id, run_id, plan_order, title, instructions, agent_version_id,
             model_override_id, state, retries, retry_of_step_id, idempotency_key,
             execution_owner_id, lease_expires_at, execution_attempt, created_at, updated_at
           ) VALUES (
             'target-max-overflow', ?, 1, 'Overflow', '', 'agent-target-bounds',
             NULL, 'pending', 0, NULL, NULL, NULL, NULL, 0, 't0', 't0'
           )`,
        )
        .run(runId);

      expect(() =>
        raw
          .prepare(
            `INSERT INTO acceptance_gate (
               id, run_id, target_step_id, reviewer_agent_version_id,
               backup_agent_version_id, max_iterations, on_limit_reached,
               state, reassigned, created_at
             ) VALUES (
               'gate-max-overflow', ?, 'target-max-overflow', 'agent-reviewer-bounds',
               NULL, 101, 'pause', 'active', 0, 't0'
             )`,
          )
          .run(runId),
      ).toThrow('review.max_iterations_invalid');
    } finally {
      raw.close();
    }
  });

  it('fails 0020 atomically when an existing Gate exceeds MAX_REVIEW_ITERATIONS', async () => {
    const path = dbPath();
    await seedInvalid0019(path, (raw) => {
      raw.exec('DROP TRIGGER acceptance_gate_identity_guard');
      raw.prepare("UPDATE acceptance_gate SET max_iterations = 101 WHERE id = 'gate-bounds'").run();
    });

    await expectAtomic0020Failure(path, 'review.max_iterations_invalid');
  });

  it.each([
    {
      name: 'more than 64 criteria',
      code: 'acceptance_criteria.too_many',
      corrupt(raw: BetterSQLite3Raw) {
        const insert = raw.prepare(
          `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
           VALUES ('gate-bounds', ?, ?, ?)`,
        );
        for (let index = 1; index <= 64; index += 1) {
          insert.run(`criterion-${index}`, `Criterion ${index}`, index);
        }
      },
    },
    {
      name: 'a criterion above 4000 UTF-8 bytes',
      code: 'acceptance_criteria.item_too_large',
      corrupt(raw: BetterSQLite3Raw) {
        raw
          .prepare(
            `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
             VALUES ('gate-bounds', 'oversized', ?, 1)`,
          )
          .run('\u754c'.repeat(1_334));
      },
    },
    {
      name: 'criteria above 64KiB in total',
      code: 'acceptance_criteria.total_too_large',
      corrupt(raw: BetterSQLite3Raw) {
        const insert = raw.prepare(
          `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
           VALUES ('gate-bounds', ?, ?, ?)`,
        );
        for (let index = 1; index <= 17; index += 1) {
          insert.run(`total-${index}`, 'x'.repeat(4_000), index);
        }
      },
    },
    {
      name: 'a Unicode-whitespace-only criterion',
      code: 'acceptance_criteria.empty',
      corrupt(raw: BetterSQLite3Raw) {
        raw
          .prepare(
            `INSERT INTO acceptance_criterion (gate_id, id, description, plan_order)
             VALUES ('gate-bounds', 'unicode-blank', ?, 1)`,
          )
          .run('\u3000');
      },
    },
  ] as const)(
    'fails 0020 atomically when existing Gate criteria contain $name',
    async ({ code, corrupt }) => {
      const path = dbPath();
      await seedInvalid0019(path, corrupt);
      await expectAtomic0020Failure(path, code);
    },
  );

  it('upgrades a legal 0019 database to 0020 without changing Gate data', async () => {
    const path = dbPath();
    const pendingMigrations = takeMigrationTail('0020_review_bounds_integrity');
    try {
      await runMigrations(path);
      const before = await openDatabaseAsync({ path });
      try {
        seedAcceptanceGate(before.raw);
      } finally {
        before.raw.close();
      }
    } finally {
      restoreMigrationTail(pendingMigrations);
    }

    expect((await runMigrations(path)).applied).toEqual(
      pendingMigrations.map((migration) => migration.name),
    );
    const after = await openDatabaseAsync({ path });
    try {
      expect(
        after.raw
          .prepare(
            `SELECT gate_id, id, description, plan_order
             FROM acceptance_criterion WHERE gate_id = 'gate-bounds'`,
          )
          .all(),
      ).toEqual([
        {
          gate_id: 'gate-bounds',
          id: 'criterion-0',
          description: 'Criterion zero',
          plan_order: 0,
        },
      ]);
    } finally {
      after.raw.close();
    }
  });

  it('creates normalized gate, criteria, evidence, artifact, and Step mapping tables', async () => {
    const path = dbPath();
    await runMigrations(path);
    const { raw } = await openDatabaseAsync({ path });
    try {
      const names = raw
        .prepare(
          `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (
           'acceptance_gate', 'acceptance_criterion', 'review_evidence',
           'review_evidence_criterion', 'review_evidence_artifact',
           'acceptance_gate_step', 'review_step_artifact'
         ) ORDER BY name`,
        )
        .all() as Array<{ name: string }>;
      expect(names.map((row) => row.name)).toEqual([
        'acceptance_criterion',
        'acceptance_gate',
        'acceptance_gate_step',
        'review_evidence',
        'review_evidence_artifact',
        'review_evidence_criterion',
        'review_step_artifact',
      ]);
      expect(
        (raw.prepare("PRAGMA table_info('review_evidence')").all() as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      ).toEqual(
        expect.arrayContaining([
          'gate_id',
          'run_id',
          'target_step_id',
          'reviewer_step_id',
          'reviewer_agent_version_id',
          'iteration',
          'verdict',
          'explanation',
          'created_at',
        ]),
      );
    } finally {
      raw.close();
    }
  });

  it('upgrades a complete 0016 database once and preserves prior data', async () => {
    const path = dbPath();
    const pendingMigrations = takeMigrationTail('0017_reviewer_rework');
    try {
      await runMigrations(path);
      const before = await openDatabaseAsync({ path });
      try {
        before.raw.exec(
          `CREATE TABLE reviewer_upgrade_sentinel (value TEXT NOT NULL);
           INSERT INTO reviewer_upgrade_sentinel (value) VALUES ('from-0016');`,
        );
      } finally {
        before.raw.close();
      }
    } finally {
      restoreMigrationTail(pendingMigrations);
    }

    expect((await runMigrations(path)).applied).toEqual(
      pendingMigrations.map((migration) => migration.name),
    );
    expect((await runMigrations(path)).applied).toEqual([]);
    const after = await openDatabaseAsync({ path });
    try {
      expect(after.raw.prepare('SELECT value FROM reviewer_upgrade_sentinel').get()).toEqual({
        value: 'from-0016',
      });
    } finally {
      after.raw.close();
    }
  });

  it('rolls back every 0017 object when migration SQL fails', async () => {
    const path = dbPath();
    const pendingMigrations = takeMigrationTail('0017_reviewer_rework');
    const reviewMigration = pendingMigrations[0];
    if (reviewMigration?.name !== '0017_reviewer_rework') {
      restoreMigrationTail(pendingMigrations);
      throw new Error('0017 migration missing');
    }
    const originalSql = reviewMigration.sql;
    try {
      await runMigrations(path);
      MIGRATIONS.push(reviewMigration);
      reviewMigration.sql = `${originalSql}\nTHIS IS NOT VALID SQL;`;
      await expect(runMigrations(path)).rejects.toThrow('migration 0017_reviewer_rework failed');

      const after = await openDatabaseAsync({ path });
      try {
        expect(
          after.raw
            .prepare(
              `SELECT COUNT(*) AS count FROM sqlite_master
             WHERE name IN ('acceptance_gate', 'review_evidence')`,
            )
            .get(),
        ).toEqual({ count: 0 });
        expect(
          after.raw
            .prepare(
              "SELECT COUNT(*) AS count FROM migration_record WHERE name = '0017_reviewer_rework'",
            )
            .get(),
        ).toEqual({ count: 0 });
      } finally {
        after.raw.close();
      }
    } finally {
      reviewMigration.sql = originalSql;
      restoreMigrationTail(pendingMigrations);
    }
  });
});
