import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventId, RunId, TaskId, WorkspaceId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import {
  DATABASE_GOVERNANCE_REPORT_VERSION,
  inspectDatabaseGovernance,
} from './database-governance.js';
import { SqliteEventCheckpointStore } from './runtime-state-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixturePath(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-db-governance-'));
  tempDirs.push(dir);
  return { dir, dbPath: join(dir, 'sync-think.db') };
}

describe('database governance diagnostics', () => {
  it('classifies only fully-global telemetry as a dry-run candidate and never changes rows', async () => {
    const fixture = fixturePath();
    await runMigrations(fixture.dbPath);
    const connection = await openDatabaseAsync({ path: fixture.dbPath });
    const workspaceId = 'workspace-governance' as WorkspaceId;
    const taskId = 'task-governance' as TaskId;
    const runId = 'run-governance' as RunId;

    try {
      const store = new SqliteEventCheckpointStore(connection.raw);
      store.commitTransition({
        events: [
          {
            id: 'event-telemetry' as EventId,
            workspaceId,
            category: 'system',
            type: 'runtime.telemetry.health.sampled',
            occurredAt: '2026-08-02T00:00:00.000Z',
            payload: { cpu: 0.2 },
          },
          {
            id: 'event-task-message' as EventId,
            workspaceId,
            taskId,
            runId,
            category: 'message',
            type: 'message.appended',
            occurredAt: '2026-08-02T00:00:01.000Z',
            payload: { text: 'protected task context' },
          },
          {
            id: 'event-global-approval' as EventId,
            workspaceId,
            category: 'approval',
            type: 'approval.requested',
            occurredAt: '2026-08-02T00:00:02.000Z',
            payload: { decision: 'pending' },
          },
          {
            id: 'event-scoped-diagnostic' as EventId,
            workspaceId,
            runId,
            category: 'system',
            type: 'runtime.trace.sampled',
            occurredAt: '2026-08-02T00:00:03.000Z',
            payload: { trace: 'run-scoped' },
          },
        ],
        checkpoint: {
          id: 'checkpoint-governance',
          runId,
          state: { status: 'running' },
          createdAt: '2026-08-02T00:00:04.000Z',
        },
      });

      writeFileSync(join(fixture.dir, 'old-a.backup.db'), Buffer.alloc(5));
      writeFileSync(join(fixture.dir, 'old-b.backup.db'), Buffer.alloc(7));
      writeFileSync(join(fixture.dir, 'newest.backup.db'), Buffer.alloc(11));

      const before = {
        events: (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number }
        ).count,
        checkpoints: (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as {
            count: number;
          }
        ).count,
      };

      const result = inspectDatabaseGovernance(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: fixture.dir,
        mode: 'deep',
        now: new Date('2026-08-02T01:00:00.000Z'),
        backupPolicy: { keepLatest: 1, maxTotalBytes: 10 },
      });

      expect(result.report.version).toBe(DATABASE_GOVERNANCE_REPORT_VERSION);
      expect(result.report.events).toMatchObject({
        total: 4,
        fullyGlobalCount: 2,
        scopedCount: 2,
        deepScanPerformed: true,
      });
      expect(result.report.checkpoints.count).toBe(1);
      expect(result.report.backups).toMatchObject({ count: 3, totalBytes: 23 });
      expect(result.maintenancePlan.mode).toBe('dry-run');
      expect(result.maintenancePlan.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'review-global-telemetry',
            disposition: 'candidate',
            estimatedRows: 1,
          }),
          expect.objectContaining({
            id: 'protect-durable-events',
            disposition: 'protected',
            estimatedRows: 3,
          }),
          expect.objectContaining({
            id: 'review-old-migration-backups',
            disposition: 'candidate',
            estimatedRows: 2,
          }),
        ]),
      );

      expect({
        events: (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number }
        ).count,
        checkpoints: (
          connection.raw.prepare('SELECT COUNT(*) AS count FROM checkpoint').get() as {
            count: number;
          }
        ).count,
      }).toEqual(before);
    } finally {
      connection.raw.close();
    }
  });

  it('keeps quick diagnostics on covering indexes without reading Event payloads', async () => {
    const fixture = fixturePath();
    await runMigrations(fixture.dbPath);
    const connection = await openDatabaseAsync({ path: fixture.dbPath });

    try {
      const prepare = vi.spyOn(connection.raw, 'prepare');
      const result = inspectDatabaseGovernance(connection.raw, {
        databasePath: fixture.dbPath,
        backupsDirectory: join(fixture.dir, 'missing-backups'),
        mode: 'quick',
      });
      const sql = prepare.mock.calls.map(([statement]) => String(statement)).join('\n');

      expect(result.report.events.deepScanPerformed).toBe(false);
      expect(result.report.events.byCategory).toEqual([]);
      expect(result.report.events.byType).toEqual([]);
      expect(result.report.backups).toMatchObject({ count: 0, totalBytes: 0 });
      expect(result.report.database.walBytes).toBeGreaterThanOrEqual(0);
      expect(sql).toContain('event_task_idx');
      expect(sql).toContain('event_ws_seq_idx');
      expect(sql).not.toContain('payload_json');
      expect(sql).not.toContain('dbstat');
    } finally {
      connection.raw.close();
    }
  });

  it('opens the diagnostic connection in SQLite query-only mode', async () => {
    const fixture = fixturePath();
    await runMigrations(fixture.dbPath);
    const connection = await openDatabaseAsync({
      path: fixture.dbPath,
      readonly: true,
      fileMustExist: true,
    });

    try {
      expect(connection.raw.pragma('query_only', { simple: true })).toBe(1);
      expect(() =>
        connection.raw
          .prepare(
            "INSERT INTO event (id, workspace_id, category, type, sequence, occurred_at, payload_json) VALUES ('blocked', 'workspace', 'system', 'blocked', 1, '2026-08-02T00:00:00.000Z', '{}')",
          )
          .run(),
      ).toThrow();
    } finally {
      connection.raw.close();
    }
  });

  it('keeps checkpoint source-of-truth protected even when amplification is suspicious', async () => {
    const fixture = fixturePath();
    await runMigrations(fixture.dbPath);
    const connection = await openDatabaseAsync({ path: fixture.dbPath });

    try {
      connection.raw
        .prepare(
          `INSERT INTO checkpoint (id, run_id, last_event_sequence, state_json, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('checkpoint-only', 'run-only', 42, '{}', '2026-08-02T00:00:00.000Z');

      const result = inspectDatabaseGovernance(connection.raw, {
        databasePath: fixture.dbPath,
        mode: 'quick',
      });

      expect(result.report.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'checkpoint-amplification', severity: 'warning' }),
        ]),
      );
      expect(result.maintenancePlan.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'protect-checkpoint-source-of-truth',
            disposition: 'protected',
            estimatedRows: 1,
          }),
        ]),
      );
    } finally {
      connection.raw.close();
    }
  });
});
