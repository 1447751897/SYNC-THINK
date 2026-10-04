import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { MIGRATIONS, runMigrations } from './scripts/migrate.js';
import { SqliteScheduledTaskStore } from './scheduled-task-store.js';

const lifecycleMigration = '0067_scheduled_task_history_lifecycle';
const lifecycleStatuses = ['waiting_input', 'blocked', 'reconciling'] as const;
const fixturePrefix = 'sync-think-scheduled-history-lifecycle-';
const temporaryRoot = realpathSync(tmpdir());
const fixtureTime = '2026-10-02T01:00:00.000Z';
const historyColumns = 'id, task_id, status, fired_at, run_id, summary, reason, created_at';
const legacyRows = [
  {
    id: 'legacy-success',
    task_id: 'legacy-task',
    status: 'success',
    fired_at: '2026-09-28T00:00:00.000Z',
    run_id: 'legacy-run-success',
    summary: '旧摘要\n保留 Unicode 😀',
    reason: null,
    created_at: '2026-09-28T00:00:01.123Z',
  },
  {
    id: 'legacy-failed',
    task_id: 'legacy-task',
    status: 'failed',
    fired_at: '2026-09-29T00:00:00.000Z',
    run_id: null,
    summary: null,
    reason: '旧失败原因',
    created_at: '2026-09-29T00:00:02.456Z',
  },
  {
    id: 'legacy-skipped',
    task_id: 'legacy-task',
    status: 'skipped',
    fired_at: '2026-09-30T00:00:00.000Z',
    run_id: '',
    summary: '',
    reason: '',
    created_at: '2026-09-30T00:00:03.789Z',
  },
  {
    id: 'legacy-cancelled',
    task_id: 'legacy-task',
    status: 'cancelled',
    fired_at: '2026-10-01T00:00:00.000Z',
    run_id: 'legacy-run-cancelled',
    summary: '旧取消摘要',
    reason: null,
    created_at: '2026-10-01T00:00:04.000Z',
  },
];
let fixtureDirectory: string | undefined;
let dbPath: string;

beforeEach(async () => {
  fixtureDirectory = undefined;
  fixtureDirectory = mkdtempSync(join(temporaryRoot, fixturePrefix));
  dbPath = join(fixtureDirectory, 'legacy.db');
  const migrationIndex = MIGRATIONS.findIndex(({ name }) => name === lifecycleMigration);
  if (migrationIndex < 1) throw new Error('DB0067 lifecycle migration is missing');
  const { raw } = await openDatabaseAsync({ path: dbPath });
  try {
    // Actual pre-DB0067 schema, with applied records so the public runner upgrades it.
    // Never truncate or mutate the shared migration inventory.
    raw.transaction(() => {
      for (const migration of MIGRATIONS.slice(0, migrationIndex)) {
        raw.exec(migration.sql);
        raw
          .prepare('INSERT INTO migration_record (name, applied_at) VALUES (?, ?)')
          .run(migration.name, fixtureTime);
      }
      const insert = raw.prepare(
        `INSERT INTO scheduled_task_history (${historyColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of legacyRows) {
        insert.run(
          row.id,
          row.task_id,
          row.status,
          row.fired_at,
          row.run_id,
          row.summary,
          row.reason,
          row.created_at,
        );
      }
    })();
  } finally {
    raw.close();
  }
});

afterEach(() => {
  const directory = fixtureDirectory;
  fixtureDirectory = undefined;
  if (!directory) return;
  const target = realpathSync(directory);
  if (
    target !== resolve(directory) ||
    dirname(target) !== temporaryRoot ||
    !basename(target).startsWith(fixturePrefix)
  )
    throw new Error('Unexpected lifecycle migration fixture cleanup path');
  // Includes only this test's database, WAL, backup and migration-lock fixture files.
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 });
});

describe('DB0067 scheduled history lifecycle migration', () => {
  it('preserves all four legacy statuses and every stored column verbatim', async () => {
    const plan = await runMigrations(dbPath);
    expect(plan.applied).toContain(lifecycleMigration);
    expect(plan.skipped).toContain('0066_scheduled_task_automation');
    const { raw } = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
    try {
      // The migration contract includes created_at and null-vs-empty values that
      // are not exposed by the history store's domain projection.
      expect(
        raw
          .prepare(`SELECT ${historyColumns} FROM scheduled_task_history ORDER BY fired_at ASC`)
          .all(),
      ).toEqual(legacyRows);
      const store = new SqliteScheduledTaskStore(raw);
      expect(store.listHistory('legacy-task').map(({ id, status }) => ({ id, status }))).toEqual([
        { id: 'legacy-cancelled', status: 'cancelled' },
        { id: 'legacy-skipped', status: 'skipped' },
        { id: 'legacy-failed', status: 'failed' },
        { id: 'legacy-success', status: 'success' },
      ]);
      expect(raw.prepare('PRAGMA index_list(scheduled_task_history)').all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'scheduled_task_history_task_fired_idx' }),
        ]),
      );
    } finally {
      raw.close();
    }
  });

  it.each(lifecycleStatuses)(
    'allows inserting and updating %s only after upgrading the old constraint',
    async (status) => {
      const entry = {
        id: `new-${status}`,
        taskId: 'legacy-task',
        status,
        firedAt: fixtureTime,
        runId: `run-${status}`,
        reason: `Waiting state: ${status}`,
        now: fixtureTime,
      };
      const before = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
      try {
        // Negative control: this exact fixture would fail if DB0067 were skipped.
        const store = new SqliteScheduledTaskStore(before.raw);
        expect(() => store.addHistoryEntry(entry)).toThrow(/CHECK constraint failed/);
        expect(store.listHistory('legacy-task')).toHaveLength(4);
      } finally {
        before.raw.close();
      }

      expect((await runMigrations(dbPath)).applied).toContain(lifecycleMigration);
      const after = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
      try {
        const store = new SqliteScheduledTaskStore(after.raw);
        store.addHistoryEntry(entry);
        store.updateHistorySummary(entry.id, 'Host-owned lifecycle summary');
        expect(store.listHistory('legacy-task')[0]).toEqual({
          id: entry.id,
          taskId: entry.taskId,
          status,
          firedAt: fixtureTime,
          runId: entry.runId,
          reason: entry.reason,
          summary: 'Host-owned lifecycle summary',
        });
        expect(store.hasHistoryResult(entry.taskId, fixtureTime, status)).toBe(true);
        // Host lifecycle reconciliation also updates the same durable entry id.
        store.updateHistoryResult(entry.id, 'success');
        store.updateHistoryResult(entry.id, status, entry.reason);
        expect(store.listHistory('legacy-task')[0]).toMatchObject({
          id: entry.id,
          status,
          reason: entry.reason,
          summary: 'Host-owned lifecycle summary',
        });
        expect(
          after.raw
            .prepare(
              `SELECT ${historyColumns} FROM scheduled_task_history WHERE id LIKE 'legacy-%' ORDER BY fired_at ASC`,
            )
            .all(),
        ).toEqual(legacyRows);
      } finally {
        after.raw.close();
      }
    },
  );

  it('repeated migrations preserve legacy and lifecycle rows without duplicate migration records or backups', async () => {
    expect((await runMigrations(dbPath)).applied).toContain(lifecycleMigration);
    const first = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
    let historyBefore: unknown[];
    let recordsBefore: unknown[];
    let schemaBefore: unknown;
    try {
      const store = new SqliteScheduledTaskStore(first.raw);
      for (const status of lifecycleStatuses) {
        store.addHistoryEntry({
          id: `new-${status}`,
          taskId: 'legacy-task',
          status,
          firedAt: fixtureTime,
          runId: `run-${status}`,
          reason: status,
          now: fixtureTime,
        });
        store.updateHistorySummary(`new-${status}`, `Summary: ${status}`);
      }
      historyBefore = first.raw
        .prepare(`SELECT ${historyColumns} FROM scheduled_task_history ORDER BY id`)
        .all();
      recordsBefore = first.raw
        .prepare('SELECT id, name, applied_at FROM migration_record ORDER BY id')
        .all();
      schemaBefore = first.raw
        .prepare(
          "SELECT name, type, sql FROM sqlite_master WHERE name IN ('scheduled_task_history', 'scheduled_task_history_task_fired_idx') ORDER BY name",
        )
        .all();
      expect(historyBefore).toHaveLength(7);
    } finally {
      first.raw.close();
    }

    for (let rerun = 0; rerun < 2; rerun++) {
      const plan = await runMigrations(dbPath);
      expect(plan.applied).toEqual([]);
      expect(plan.skipped).toContain(lifecycleMigration);
      expect(plan.backupPath).toBeUndefined();
      const reopened = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
      try {
        expect(
          reopened.raw
            .prepare(`SELECT ${historyColumns} FROM scheduled_task_history ORDER BY id`)
            .all(),
        ).toEqual(historyBefore);
        expect(
          reopened.raw
            .prepare('SELECT id, name, applied_at FROM migration_record ORDER BY id')
            .all(),
        ).toEqual(recordsBefore);
        expect(
          reopened.raw
            .prepare(
              "SELECT name, type, sql FROM sqlite_master WHERE name IN ('scheduled_task_history', 'scheduled_task_history_task_fired_idx') ORDER BY name",
            )
            .all(),
        ).toEqual(schemaBefore);
        expect(
          reopened.raw
            .prepare('SELECT COUNT(*) AS count FROM migration_record WHERE name = ?')
            .get(lifecycleMigration),
        ).toEqual({ count: 1 });
      } finally {
        reopened.raw.close();
      }
    }
  });

  it('retains a bounded status constraint after upgrade and leaves the old row intact on invalid updates', async () => {
    await runMigrations(dbPath);
    const { raw } = await openDatabaseAsync({ path: dbPath, fileMustExist: true });
    try {
      const store = new SqliteScheduledTaskStore(raw);
      expect(() => store.updateHistoryResult('legacy-success', 'running' as never)).toThrow(
        /CHECK constraint failed/,
      );
      expect(
        raw
          .prepare(`SELECT ${historyColumns} FROM scheduled_task_history ORDER BY fired_at ASC`)
          .all(),
      ).toEqual(legacyRows);
    } finally {
      raw.close();
    }
  });
});
