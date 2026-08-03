import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync } from '../connection.js';
import { runMigrations } from './migrate.js';
import { parseDatabaseGovernanceCliOptions, runDatabaseGovernanceCli } from './database-governance.js';

const tempDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('database governance CLI options', () => {
  it('keeps the default command read-only and quick', () => {
    expect(parseDatabaseGovernanceCliOptions([])).toMatchObject({
      command: 'inspect',
      mode: 'quick',
      json: false,
      includePhysicalTableSizes: false,
    });
  });

  it('prepares an exact manifest from an explicitly selected read-only database', () => {
    expect(
      parseDatabaseGovernanceCliOptions([
        '--deep',
        '--db',
        'fixture.db',
        '--backups',
        'fixture-backups',
        '--event-payload-sidecar',
        'fixture-sidecars',
        '--prepare-manifest',
        'maintenance.json',
      ]),
    ).toEqual({
      command: 'prepare-manifest',
      databasePath: resolve('fixture.db'),
      backupsDirectory: resolve('fixture-backups'),
      backupKeepLatest: 8,
      backupMaxBytes: 64 * 1024 * 1024 * 1024,
      manifestPath: resolve('maintenance.json'),
      eventPayloadSidecarDirectory: resolve('fixture-sidecars'),
    });
  });

  it('prepares a read-only exact Event payload backfill plan with an explicit sidecar root', () => {
    expect(
      parseDatabaseGovernanceCliOptions([
        '--db',
        'fixture.db',
        '--event-payload-sidecar',
        'fixture-sidecars',
        '--minimum-payload-bytes',
        '4096',
        '--prepare-backfill-plan',
        'backfill.json',
        '--json',
      ]),
    ).toEqual({
      command: 'prepare-backfill-plan',
      databasePath: resolve('fixture.db'),
      sidecarRootDirectory: resolve('fixture-sidecars'),
      planPath: resolve('backfill.json'),
      minimumPayloadBytes: 4096,
      json: true,
    });
  });

  it('requires an explicit sidecar root for an Event payload backfill plan', () => {
    expect(() =>
      parseDatabaseGovernanceCliOptions(['--prepare-backfill-plan', 'backfill.json']),
    ).toThrow('--event-payload-sidecar');
  });

  it('requires the confirmation token and maintenance window before execute mode exists', () => {
    expect(() =>
      parseDatabaseGovernanceCliOptions(['--execute-manifest', 'maintenance.json']),
    ).toThrow('--confirm');
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--execute-manifest',
        'maintenance.json',
        '--confirm',
        'TOKEN',
      ]),
    ).toThrow('--maintenance-window');
  });

  it('parses read-only mark and gated Event payload sidecar GC sweep modes', () => {
    expect(parseDatabaseGovernanceCliOptions([
      '--db', 'fixture.db', '--event-payload-sidecar', 'sidecars',
      '--prepare-sidecar-gc', 'sidecar-gc.json', '--json',
    ])).toEqual({
      command: 'prepare-sidecar-gc',
      databasePath: resolve('fixture.db'),
      sidecarRootDirectory: resolve('sidecars'),
      manifestPath: resolve('sidecar-gc.json'),
      json: true,
    });
    expect(parseDatabaseGovernanceCliOptions([
      '--execute-sidecar-gc', 'sidecar-gc.json', '--confirm', 'GC-TOKEN',
      '--maintenance-window', '--batch-size', '25', '--audit', 'sidecar-gc.audit.json', '--json',
    ])).toEqual({
      command: 'execute-sidecar-gc',
      manifestPath: resolve('sidecar-gc.json'),
      confirmationToken: 'GC-TOKEN',
      maintenanceWindowConfirmed: true,
      batchSize: 25,
      auditPath: resolve('sidecar-gc.audit.json'),
      json: true,
    });
    expect(() => parseDatabaseGovernanceCliOptions(['--prepare-sidecar-gc', 'sidecar-gc.json'])).toThrow('--event-payload-sidecar');
    expect(() => parseDatabaseGovernanceCliOptions(['--execute-sidecar-gc', 'sidecar-gc.json'])).toThrow('--confirm');
  });

  it('parses read-only prepare and fully gated Event retention archive modes', () => {
    expect(parseDatabaseGovernanceCliOptions([
      '--db', 'fixture.db', '--prepare-event-archive', 'archive.json',
      '--archive-root', 'archives', '--retention-cutoff', '2026-08-01T00:00:00.000Z',
      '--archive-max-rows', '100', '--archive-max-bytes', '4096', '--archive-id', 'fixture-archive', '--json',
    ])).toEqual({
      command: 'prepare-event-archive',
      databasePath: resolve('fixture.db'),
      archiveRootDirectory: resolve('archives'),
      manifestPath: resolve('archive.json'),
      cutoff: '2026-08-01T00:00:00.000Z',
      maxRows: 100,
      maxBytes: 4096,
      archiveId: 'fixture-archive',
      json: true,
    });
    expect(parseDatabaseGovernanceCliOptions([
      '--execute-event-archive', 'archive.json', '--confirm', 'ARCHIVE', '--maintenance-window',
      '--batch-size', '25', '--audit', 'execute.audit.json', '--json',
    ])).toEqual({
      command: 'execute-event-archive', manifestPath: resolve('archive.json'), confirmationToken: 'ARCHIVE',
      maintenanceWindowConfirmed: true, batchSize: 25, auditPath: resolve('execute.audit.json'), json: true,
    });
    expect(parseDatabaseGovernanceCliOptions([
      '--rollback-event-archive', 'archive.json', '--confirm', 'ROLLBACK', '--maintenance-window',
      '--execution-audit', 'execute.audit.json', '--batch-size', '50', '--audit', 'rollback.audit.json', '--json',
    ])).toEqual({
      command: 'rollback-event-archive', manifestPath: resolve('archive.json'), confirmationToken: 'ROLLBACK',
      maintenanceWindowConfirmed: true, executionAuditPath: resolve('execute.audit.json'), batchSize: 50,
      auditPath: resolve('rollback.audit.json'), json: true,
    });
    expect(() => parseDatabaseGovernanceCliOptions(['--prepare-event-archive', 'archive.json'])).toThrow('--archive-root');
    expect(() => parseDatabaseGovernanceCliOptions(['--execute-event-archive', 'archive.json'])).toThrow('--confirm');
    expect(() => parseDatabaseGovernanceCliOptions(['--rollback-event-archive', 'archive.json', '--confirm', 'ROLLBACK'])).toThrow('--maintenance-window');
  });

  it('parses the fully gated Event payload rollback mode', () => {
    expect(parseDatabaseGovernanceCliOptions([
      '--rollback-backfill-plan', 'backfill.json',
      '--execution-audit', 'execute.audit.json',
      '--confirm', 'ROLLBACK', '--maintenance-window', '--batch-size', '50',
      '--audit', 'rollback.audit.json', '--json',
    ])).toEqual({
      command: 'rollback-backfill-plan',
      planPath: resolve('backfill.json'),
      executionAuditPath: resolve('execute.audit.json'),
      confirmationToken: 'ROLLBACK',
      maintenanceWindowConfirmed: true,
      batchSize: 50,
      auditPath: resolve('rollback.audit.json'),
      json: true,
    });
    expect(() => parseDatabaseGovernanceCliOptions([
      '--rollback-backfill-plan', 'backfill.json', '--confirm', 'ROLLBACK', '--maintenance-window',
    ])).toThrow('--execution-audit');
  });

  it('parses the fully gated Event payload backfill execute mode', () => {
    expect(
      parseDatabaseGovernanceCliOptions([
        '--execute-backfill-plan',
        'backfill.json',
        '--confirm',
        'TOKEN',
        '--maintenance-window',
        '--batch-size',
        '125',
        '--audit',
        'backfill.audit.json',
        '--json',
      ]),
    ).toEqual({
      command: 'execute-backfill-plan',
      planPath: resolve('backfill.json'),
      confirmationToken: 'TOKEN',
      maintenanceWindowConfirmed: true,
      batchSize: 125,
      auditPath: resolve('backfill.audit.json'),
      json: true,
    });
    expect(() =>
      parseDatabaseGovernanceCliOptions(['--execute-backfill-plan', 'backfill.json']),
    ).toThrow('--confirm');
  });

  it('parses read-only prepare and gated database compaction modes', () => {
    expect(
      parseDatabaseGovernanceCliOptions([
        '--db',
        'fixture.db',
        '--governance-root',
        'governance',
        '--prepare-compaction',
        'governance/compaction.json',
        '--compaction-operation',
        'offline-compaction',
        '--compaction-id',
        'fixture-compaction',
        '--json',
      ]),
    ).toEqual({
      command: 'prepare-compaction',
      databasePath: resolve('fixture.db'),
      governanceRootDirectory: resolve('governance'),
      manifestPath: resolve('governance/compaction.json'),
      operation: 'offline-compaction',
      planId: 'fixture-compaction',
      json: true,
    });
    expect(
      parseDatabaseGovernanceCliOptions([
        '--execute-incremental-vacuum',
        'compaction.json',
        '--confirm',
        'TOKEN',
        '--maintenance-window',
        '--page-budget',
        '1000',
        '--batch-pages',
        '128',
        '--time-budget-ms',
        '5000',
        '--audit',
        'vacuum.audit.json',
        '--json',
      ]),
    ).toEqual({
      command: 'execute-incremental-vacuum',
      manifestPath: resolve('compaction.json'),
      confirmationToken: 'TOKEN',
      maintenanceWindowConfirmed: true,
      pageBudget: 1000,
      batchPages: 128,
      timeBudgetMs: 5000,
      auditPath: resolve('vacuum.audit.json'),
      json: true,
    });
    expect(
      parseDatabaseGovernanceCliOptions([
        '--execute-offline-compaction',
        'compaction.json',
        '--confirm',
        'TOKEN',
        '--maintenance-window',
        '--output-db',
        'compacted.db',
        '--audit',
        'compacted.audit.json',
      ]),
    ).toEqual({
      command: 'execute-offline-compaction',
      manifestPath: resolve('compaction.json'),
      confirmationToken: 'TOKEN',
      maintenanceWindowConfirmed: true,
      outputPath: resolve('compacted.db'),
      auditPath: resolve('compacted.audit.json'),
      json: false,
    });
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--prepare-compaction',
        'compaction.json',
      ]),
    ).toThrow('--compaction-operation');
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--execute-incremental-vacuum',
        'compaction.json',
        '--confirm',
        'TOKEN',
        '--maintenance-window',
      ]),
    ).toThrow('--page-budget');
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--execute-offline-compaction',
        'compaction.json',
        '--confirm',
        'TOKEN',
        '--maintenance-window',
      ]),
    ).toThrow('--output-db');
  });

  it('parses the fully gated execute mode without an implicit database override', () => {
    expect(
      parseDatabaseGovernanceCliOptions([
        '--execute-manifest',
        'maintenance.json',
        '--confirm',
        'TOKEN',
        '--maintenance-window',
        '--batch-size',
        '250',
        '--audit',
        'audit.json',
        '--json',
      ]),
    ).toEqual({
      command: 'execute-manifest',
      manifestPath: resolve('maintenance.json'),
      confirmationToken: 'TOKEN',
      maintenanceWindowConfirmed: true,
      batchSize: 250,
      auditPath: resolve('audit.json'),
      json: true,
    });
  });

  it('runs a fixture-only Event retention archive prepare, execute, and rollback round trip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-governance-cli-')); tempDirs.push(dir);
    const databasePath = join(dir, 'sync-think.db'); const archiveRoot = join(dir, 'archives'); const manifestPath = join(dir, 'archive.json');
    await runMigrations(databasePath);
    const connection = await openDatabaseAsync({ path: databasePath });
    try {
      connection.raw.prepare(`INSERT INTO event (id,workspace_id,category,type,sequence,occurred_at,payload_json) VALUES (?,?,?,?,?,?,?)`).run('candidate','workspace-cli','system','runtime.telemetry.health.sampled',1,'2026-07-01T00:00:00.000Z','opaque');
      connection.raw.prepare(`INSERT INTO event (id,workspace_id,category,type,sequence,occurred_at,payload_json) VALUES (?,?,?,?,?,?,?)`).run('high-water','workspace-cli','run','run.completed',2,'2026-07-01T00:00:01.000Z','{}');
    } finally { connection.raw.close(); }
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runDatabaseGovernanceCli([
      '--db', databasePath, '--prepare-event-archive', manifestPath, '--archive-root', archiveRoot,
      '--retention-cutoff', '2026-08-01T00:00:00.000Z', '--archive-id', 'cli-round-trip', '--json',
    ]);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { confirmationToken: string; rollbackToken: string };
    await runDatabaseGovernanceCli(['--execute-event-archive', manifestPath, '--confirm', manifest.confirmationToken, '--maintenance-window', '--json']);
    const afterExecute = await openDatabaseAsync({ path: databasePath, readonly: true, fileMustExist: true });
    try { expect(afterExecute.raw.prepare('SELECT id FROM event ORDER BY sequence').pluck().all()).toEqual(['high-water']); } finally { afterExecute.raw.close(); }
    await runDatabaseGovernanceCli(['--rollback-event-archive', manifestPath, '--confirm', manifest.rollbackToken, '--maintenance-window', '--json']);
    const afterRollback = await openDatabaseAsync({ path: databasePath, readonly: true, fileMustExist: true });
    try { expect(afterRollback.raw.prepare('SELECT id FROM event ORDER BY sequence').pluck().all()).toEqual(['candidate', 'high-water']); } finally { afterRollback.raw.close(); }
  });

  it('runs a fixture-only offline compaction prepare and execute round trip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-compaction-cli-'));
    tempDirs.push(dir);
    const databasePath = join(dir, 'sync-think.db');
    const manifestPath = join(dir, 'compaction.json');
    const outputPath = join(dir, 'sync-think.compacted.db');
    const auditPath = join(dir, 'compaction.audit.json');
    await runMigrations(databasePath);
    const source = await openDatabaseAsync({ path: databasePath });
    try {
      source.raw
        .prepare(
          `INSERT INTO event (id,workspace_id,category,type,sequence,occurred_at,payload_json) VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          'compaction-event',
          'workspace-cli',
          'run',
          'run.completed',
          1,
          '2026-08-01T00:00:00.000Z',
          '{}',
        );
    } finally {
      source.raw.close();
    }
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await runDatabaseGovernanceCli([
      '--db',
      databasePath,
      '--governance-root',
      dir,
      '--prepare-compaction',
      manifestPath,
      '--compaction-operation',
      'offline-compaction',
      '--compaction-id',
      'cli-offline-round-trip',
      '--json',
    ]);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      confirmationToken: string;
    };
    await runDatabaseGovernanceCli([
      '--execute-offline-compaction',
      manifestPath,
      '--confirm',
      manifest.confirmationToken,
      '--maintenance-window',
      '--output-db',
      outputPath,
      '--audit',
      auditPath,
      '--json',
    ]);
    expect(existsSync(databasePath)).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(auditPath)).toBe(true);
    const compacted = await openDatabaseAsync({ path: outputPath, readonly: true, fileMustExist: true });
    try {
      expect(compacted.raw.prepare('SELECT id FROM event').pluck().all()).toEqual([
        'compaction-event',
      ]);
    } finally {
      compacted.raw.close();
    }
  });

  it('rejects ambiguous modes, missing values, and invalid batch sizes', () => {
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--prepare-manifest',
        'prepare.json',
        '--execute-manifest',
        'execute.json',
        '--execute-backfill-plan',
        'backfill.json',
      ]),
    ).toThrow('mutually exclusive');
    expect(() => parseDatabaseGovernanceCliOptions(['--prepare-manifest'])).toThrow(
      'requires a value',
    );
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--prepare-manifest',
        'maintenance.json',
        '--event-payload-sidecar',
      ]),
    ).toThrow('--event-payload-sidecar requires a value');
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--prepare-manifest',
        'maintenance.json',
        '--prepare-backfill-plan',
        'backfill.json',
      ]),
    ).toThrow('mutually exclusive');
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--prepare-backfill-plan',
        'backfill.json',
        '--event-payload-sidecar',
        'sidecars',
        '--minimum-payload-bytes',
        '0',
      ]),
    ).toThrow('between 1');
    expect(() =>
      parseDatabaseGovernanceCliOptions([
        '--execute-manifest',
        'maintenance.json',
        '--confirm',
        'TOKEN',
        '--maintenance-window',
        '--batch-size',
        '5001',
      ]),
    ).toThrow('between 1 and 5000');
  });
});
