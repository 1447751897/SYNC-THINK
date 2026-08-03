import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabaseAsync } from '../connection.js';
import {
  DEFAULT_EVENT_PAYLOAD_BACKFILL_MINIMUM_BYTES,
  prepareEventPayloadBackfillPlan,
  readEventPayloadBackfillPlan,
  writeEventPayloadBackfillPlan,
} from '../event-payload-backfill.js';
import {
  executeEventPayloadBackfill,
  expectedEventPayloadBackfillConfirmationToken,
  readEventPayloadBackfillAudit,
} from '../event-payload-backfill-executor.js';
import {
  expectedEventPayloadBackfillRollbackConfirmationToken,
  rollbackEventPayloadBackfill,
} from '../event-payload-backfill-rollback.js';
import {
  executeEventPayloadSidecarGc,
  expectedEventPayloadSidecarGcConfirmationToken,
  prepareEventPayloadSidecarGcManifest,
  readEventPayloadSidecarGcManifest,
  writeEventPayloadSidecarGcManifest,
} from '../event-payload-sidecar-gc.js';
import {
  executeEventRetentionArchive,
  expectedEventRetentionArchiveConfirmationToken,
  expectedEventRetentionArchiveRollbackToken,
  prepareEventRetentionArchiveManifest,
  readEventRetentionArchiveManifest,
  rollbackEventRetentionArchive,
  writeEventRetentionArchiveManifest,
} from '../event-retention-archive.js';
import {
  executeDatabaseMaintenance,
  prepareDatabaseMaintenanceManifest,
  readDatabaseMaintenanceManifest,
  writeDatabaseMaintenanceManifest,
} from '../database-maintenance-executor.js';
import {
  executeIncrementalVacuum,
  executeOfflineDatabaseCompaction,
  expectedDatabaseCompactionConfirmationToken,
  prepareDatabaseCompactionManifest,
  readDatabaseCompactionManifest,
  writeDatabaseCompactionManifest,
  type DatabaseCompactionOperation,
} from '../database-compaction.js';
import { inspectDatabaseGovernance, type DatabaseGovernanceMode } from '../database-governance.js';

interface CommonCliOptions {
  databasePath: string;
  backupsDirectory?: string;
  backupKeepLatest: number;
  backupMaxBytes: number;
}

export interface InspectCliOptions extends CommonCliOptions {
  command: 'inspect';
  mode: DatabaseGovernanceMode;
  json: boolean;
  includePhysicalTableSizes: boolean;
}

export interface PrepareManifestCliOptions extends CommonCliOptions {
  command: 'prepare-manifest';
  manifestPath: string;
  eventPayloadSidecarDirectory?: string;
}

export interface PrepareBackfillPlanCliOptions {
  command: 'prepare-backfill-plan';
  databasePath: string;
  sidecarRootDirectory: string;
  planPath: string;
  minimumPayloadBytes: number;
  json: boolean;
}

export interface ExecuteBackfillPlanCliOptions {
  command: 'execute-backfill-plan';
  planPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  batchSize?: number;
  auditPath?: string;
  json: boolean;
}

export interface RollbackBackfillPlanCliOptions {
  command: 'rollback-backfill-plan';
  planPath: string;
  executionAuditPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  batchSize?: number;
  auditPath?: string;
  json: boolean;
}

export interface ExecuteManifestCliOptions {
  command: 'execute-manifest';
  manifestPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  batchSize?: number;
  auditPath?: string;
  json: boolean;
}

export interface PrepareSidecarGcCliOptions {
  command: 'prepare-sidecar-gc';
  databasePath: string;
  sidecarRootDirectory: string;
  manifestPath: string;
  json: boolean;
}

export interface ExecuteSidecarGcCliOptions {
  command: 'execute-sidecar-gc';
  manifestPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  batchSize?: number;
  auditPath?: string;
  json: boolean;
}

export interface PrepareEventArchiveCliOptions {
  command: 'prepare-event-archive';
  databasePath: string;
  archiveRootDirectory: string;
  manifestPath: string;
  cutoff: string;
  maxRows: number;
  maxBytes: number;
  archiveId?: string;
  json: boolean;
}

export interface ExecuteEventArchiveCliOptions {
  command: 'execute-event-archive';
  manifestPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  batchSize?: number;
  auditPath?: string;
  json: boolean;
}

export interface RollbackEventArchiveCliOptions {
  command: 'rollback-event-archive';
  manifestPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  batchSize?: number;
  executionAuditPath?: string;
  auditPath?: string;
  json: boolean;
}

export interface PrepareCompactionCliOptions {
  command: 'prepare-compaction';
  databasePath: string;
  governanceRootDirectory: string;
  manifestPath: string;
  operation: DatabaseCompactionOperation;
  planId?: string;
  json: boolean;
}

export interface ExecuteIncrementalVacuumCliOptions {
  command: 'execute-incremental-vacuum';
  manifestPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  pageBudget: number;
  batchPages?: number;
  timeBudgetMs?: number;
  auditPath?: string;
  json: boolean;
}

export interface ExecuteOfflineCompactionCliOptions {
  command: 'execute-offline-compaction';
  manifestPath: string;
  confirmationToken: string;
  maintenanceWindowConfirmed: true;
  outputPath: string;
  auditPath?: string;
  json: boolean;
}

export type DatabaseGovernanceCliOptions =
  | InspectCliOptions
  | PrepareManifestCliOptions
  | PrepareBackfillPlanCliOptions
  | ExecuteBackfillPlanCliOptions
  | RollbackBackfillPlanCliOptions
  | PrepareSidecarGcCliOptions
  | ExecuteSidecarGcCliOptions
  | PrepareEventArchiveCliOptions
  | ExecuteEventArchiveCliOptions
  | RollbackEventArchiveCliOptions
  | PrepareCompactionCliOptions
  | ExecuteIncrementalVacuumCliOptions
  | ExecuteOfflineCompactionCliOptions
  | ExecuteManifestCliOptions;

function hasArgument(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function optionalArgumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function nonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return parsed;
}

function boundedPositiveInteger(
  value: string | undefined,
  name: string,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function commonOptions(args: readonly string[]): CommonCliOptions {
  const databasePath = resolve(
    optionalArgumentValue(args, '--db') ??
      resolve(process.cwd(), '.data', 'SYNC-THINK', 'sync-think.db'),
  );
  const backups = optionalArgumentValue(args, '--backups');
  return {
    databasePath,
    ...(backups === undefined ? {} : { backupsDirectory: resolve(backups) }),
    backupKeepLatest: nonNegativeInteger(
      optionalArgumentValue(args, '--backup-keep'),
      8,
      '--backup-keep',
    ),
    backupMaxBytes: nonNegativeInteger(
      optionalArgumentValue(args, '--backup-max-bytes'),
      64 * 1024 * 1024 * 1024,
      '--backup-max-bytes',
    ),
  };
}

export function parseDatabaseGovernanceCliOptions(
  args: readonly string[],
): DatabaseGovernanceCliOptions {
  const preparePath = optionalArgumentValue(args, '--prepare-manifest');
  const backfillPlanPath = optionalArgumentValue(args, '--prepare-backfill-plan');
  const executePath = optionalArgumentValue(args, '--execute-manifest');
  const executeBackfillPath = optionalArgumentValue(args, '--execute-backfill-plan');
  const rollbackBackfillPath = optionalArgumentValue(args, '--rollback-backfill-plan');
  const prepareSidecarGcPath = optionalArgumentValue(args, '--prepare-sidecar-gc');
  const executeSidecarGcPath = optionalArgumentValue(args, '--execute-sidecar-gc');
  const prepareEventArchivePath = optionalArgumentValue(args, '--prepare-event-archive');
  const executeEventArchivePath = optionalArgumentValue(args, '--execute-event-archive');
  const rollbackEventArchivePath = optionalArgumentValue(args, '--rollback-event-archive');
  const prepareCompactionPath = optionalArgumentValue(args, '--prepare-compaction');
  const executeIncrementalVacuumPath = optionalArgumentValue(
    args,
    '--execute-incremental-vacuum',
  );
  const executeOfflineCompactionPath = optionalArgumentValue(
    args,
    '--execute-offline-compaction',
  );
  if (
    [
      preparePath,
      backfillPlanPath,
      executePath,
      executeBackfillPath,
      rollbackBackfillPath,
      prepareSidecarGcPath,
      executeSidecarGcPath,
      prepareEventArchivePath,
      executeEventArchivePath,
      rollbackEventArchivePath,
      prepareCompactionPath,
      executeIncrementalVacuumPath,
      executeOfflineCompactionPath,
    ].filter(
      (value) => value !== undefined,
    ).length > 1
  ) {
    throw new Error(
      'database governance prepare/execute/rollback modes are mutually exclusive',
    );
  }

  if (executeOfflineCompactionPath !== undefined) {
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) {
      throw new Error('--execute-offline-compaction requires --confirm with the exact compaction token');
    }
    if (!hasArgument(args, '--maintenance-window')) {
      throw new Error('--execute-offline-compaction requires --maintenance-window');
    }
    const output = optionalArgumentValue(args, '--output-db');
    if (output === undefined) {
      throw new Error('--execute-offline-compaction requires --output-db');
    }
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'execute-offline-compaction',
      manifestPath: resolve(executeOfflineCompactionPath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      outputPath: resolve(output),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (executeIncrementalVacuumPath !== undefined) {
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) {
      throw new Error('--execute-incremental-vacuum requires --confirm with the exact compaction token');
    }
    if (!hasArgument(args, '--maintenance-window')) {
      throw new Error('--execute-incremental-vacuum requires --maintenance-window');
    }
    const pageBudget = boundedPositiveInteger(
      optionalArgumentValue(args, '--page-budget'),
      '--page-budget',
      Number.MAX_SAFE_INTEGER,
    );
    if (pageBudget === undefined) {
      throw new Error('--execute-incremental-vacuum requires --page-budget');
    }
    const batchPages = boundedPositiveInteger(
      optionalArgumentValue(args, '--batch-pages'),
      '--batch-pages',
      10_000,
    );
    const timeBudgetMs = boundedPositiveInteger(
      optionalArgumentValue(args, '--time-budget-ms'),
      '--time-budget-ms',
      86_400_000,
    );
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'execute-incremental-vacuum',
      manifestPath: resolve(executeIncrementalVacuumPath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      pageBudget,
      ...(batchPages === undefined ? {} : { batchPages }),
      ...(timeBudgetMs === undefined ? {} : { timeBudgetMs }),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (prepareCompactionPath !== undefined) {
    const operation = optionalArgumentValue(args, '--compaction-operation');
    if (operation !== 'incremental-vacuum' && operation !== 'offline-compaction') {
      throw new Error(
        '--prepare-compaction requires --compaction-operation incremental-vacuum|offline-compaction',
      );
    }
    const databasePath = resolve(
      optionalArgumentValue(args, '--db') ??
        resolve(process.cwd(), '.data', 'SYNC-THINK', 'sync-think.db'),
    );
    const governanceRoot = optionalArgumentValue(args, '--governance-root');
    const planId = optionalArgumentValue(args, '--compaction-id');
    return {
      command: 'prepare-compaction',
      databasePath,
      governanceRootDirectory: resolve(governanceRoot ?? dirname(databasePath)),
      manifestPath: resolve(prepareCompactionPath),
      operation,
      ...(planId === undefined ? {} : { planId }),
      json: hasArgument(args, '--json'),
    };
  }

  if (rollbackEventArchivePath !== undefined) {
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) throw new Error('--rollback-event-archive requires --confirm with the exact rollback token');
    if (!hasArgument(args, '--maintenance-window')) throw new Error('--rollback-event-archive requires --maintenance-window');
    const batchSize = boundedPositiveInteger(optionalArgumentValue(args, '--batch-size'), '--batch-size', 5_000);
    const executionAudit = optionalArgumentValue(args, '--execution-audit');
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'rollback-event-archive',
      manifestPath: resolve(rollbackEventArchivePath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(executionAudit === undefined ? {} : { executionAuditPath: resolve(executionAudit) }),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (executeEventArchivePath !== undefined) {
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) throw new Error('--execute-event-archive requires --confirm with the exact archive token');
    if (!hasArgument(args, '--maintenance-window')) throw new Error('--execute-event-archive requires --maintenance-window');
    const batchSize = boundedPositiveInteger(optionalArgumentValue(args, '--batch-size'), '--batch-size', 5_000);
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'execute-event-archive',
      manifestPath: resolve(executeEventArchivePath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (executeSidecarGcPath !== undefined) {
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) throw new Error('--execute-sidecar-gc requires --confirm with the exact sweep token');
    if (!hasArgument(args, '--maintenance-window')) throw new Error('--execute-sidecar-gc requires --maintenance-window');
    const batchSize = boundedPositiveInteger(optionalArgumentValue(args, '--batch-size'), '--batch-size', 5_000);
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'execute-sidecar-gc',
      manifestPath: resolve(executeSidecarGcPath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (rollbackBackfillPath !== undefined) {
    const executionAuditPath = optionalArgumentValue(args, '--execution-audit');
    if (executionAuditPath === undefined) throw new Error('--rollback-backfill-plan requires --execution-audit');
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) throw new Error('--rollback-backfill-plan requires --confirm with the exact rollback token');
    if (!hasArgument(args, '--maintenance-window')) throw new Error('--rollback-backfill-plan requires --maintenance-window');
    const batchSize = boundedPositiveInteger(optionalArgumentValue(args, '--batch-size'), '--batch-size', 5_000);
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'rollback-backfill-plan',
      planPath: resolve(rollbackBackfillPath),
      executionAuditPath: resolve(executionAuditPath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (executeBackfillPath !== undefined) {
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) {
      throw new Error('--execute-backfill-plan requires --confirm with the exact plan token');
    }
    if (!hasArgument(args, '--maintenance-window')) {
      throw new Error('--execute-backfill-plan requires --maintenance-window');
    }
    const batchSize = boundedPositiveInteger(
      optionalArgumentValue(args, '--batch-size'),
      '--batch-size',
      5_000,
    );
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'execute-backfill-plan',
      planPath: resolve(executeBackfillPath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (executePath !== undefined) {
    const confirmationToken = optionalArgumentValue(args, '--confirm');
    if (confirmationToken === undefined) {
      throw new Error('--execute-manifest requires --confirm with the exact manifest token');
    }
    if (!hasArgument(args, '--maintenance-window')) {
      throw new Error('--execute-manifest requires --maintenance-window');
    }
    const batchSize = boundedPositiveInteger(
      optionalArgumentValue(args, '--batch-size'),
      '--batch-size',
      5_000,
    );
    const audit = optionalArgumentValue(args, '--audit');
    return {
      command: 'execute-manifest',
      manifestPath: resolve(executePath),
      confirmationToken,
      maintenanceWindowConfirmed: true,
      ...(batchSize === undefined ? {} : { batchSize }),
      ...(audit === undefined ? {} : { auditPath: resolve(audit) }),
      json: hasArgument(args, '--json'),
    };
  }

  if (prepareEventArchivePath !== undefined) {
    const archiveRootDirectory = optionalArgumentValue(args, '--archive-root');
    const cutoff = optionalArgumentValue(args, '--retention-cutoff');
    if (archiveRootDirectory === undefined) throw new Error('--prepare-event-archive requires --archive-root');
    if (cutoff === undefined) throw new Error('--prepare-event-archive requires --retention-cutoff');
    const maxRows = boundedPositiveInteger(optionalArgumentValue(args, '--archive-max-rows'), '--archive-max-rows', Number.MAX_SAFE_INTEGER);
    const maxBytes = boundedPositiveInteger(optionalArgumentValue(args, '--archive-max-bytes'), '--archive-max-bytes', Number.MAX_SAFE_INTEGER);
    return {
      command: 'prepare-event-archive',
      databasePath: resolve(optionalArgumentValue(args, '--db') ?? resolve(process.cwd(), '.data', 'SYNC-THINK', 'sync-think.db')),
      archiveRootDirectory: resolve(archiveRootDirectory),
      manifestPath: resolve(prepareEventArchivePath),
      cutoff,
      maxRows: maxRows ?? 10_000,
      maxBytes: maxBytes ?? 256 * 1024 * 1024,
      ...(optionalArgumentValue(args, '--archive-id') === undefined ? {} : { archiveId: optionalArgumentValue(args, '--archive-id') }),
      json: hasArgument(args, '--json'),
    };
  }

  if (prepareSidecarGcPath !== undefined) {
    const sidecarRoot = optionalArgumentValue(args, '--event-payload-sidecar');
    if (sidecarRoot === undefined) throw new Error('--prepare-sidecar-gc requires --event-payload-sidecar');
    return {
      command: 'prepare-sidecar-gc',
      databasePath: resolve(optionalArgumentValue(args, '--db') ?? resolve(process.cwd(), '.data', 'SYNC-THINK', 'sync-think.db')),
      sidecarRootDirectory: resolve(sidecarRoot),
      manifestPath: resolve(prepareSidecarGcPath),
      json: hasArgument(args, '--json'),
    };
  }

  if (backfillPlanPath !== undefined) {
    const sidecarRoot = optionalArgumentValue(args, '--event-payload-sidecar');
    if (sidecarRoot === undefined) {
      throw new Error('--prepare-backfill-plan requires --event-payload-sidecar');
    }
    return {
      command: 'prepare-backfill-plan',
      databasePath: resolve(
        optionalArgumentValue(args, '--db') ??
          resolve(process.cwd(), '.data', 'SYNC-THINK', 'sync-think.db'),
      ),
      sidecarRootDirectory: resolve(sidecarRoot),
      planPath: resolve(backfillPlanPath),
      minimumPayloadBytes:
        boundedPositiveInteger(
          optionalArgumentValue(args, '--minimum-payload-bytes'),
          '--minimum-payload-bytes',
          Number.MAX_SAFE_INTEGER,
        ) ?? DEFAULT_EVENT_PAYLOAD_BACKFILL_MINIMUM_BYTES,
      json: hasArgument(args, '--json'),
    };
  }

  const common = commonOptions(args);
  if (preparePath !== undefined) {
    const eventPayloadSidecar = optionalArgumentValue(args, '--event-payload-sidecar');
    return {
      command: 'prepare-manifest',
      ...common,
      manifestPath: resolve(preparePath),
      ...(eventPayloadSidecar === undefined
        ? {}
        : { eventPayloadSidecarDirectory: resolve(eventPayloadSidecar) }),
    };
  }

  return {
    command: 'inspect',
    ...common,
    mode: hasArgument(args, '--deep') ? 'deep' : 'quick',
    json: hasArgument(args, '--json'),
    includePhysicalTableSizes: hasArgument(args, '--physical'),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 'B';
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  return `${value.toFixed(2)} ${unit}`;
}

function printHumanReadable(result: ReturnType<typeof inspectDatabaseGovernance>): void {
  const { report, maintenancePlan } = result;
  console.log(`Database governance report v${report.version} (${report.mode}, read-only)`);
  console.log(`Database: ${report.database.path}`);
  console.log(
    `Size: ${formatBytes(report.database.fileBytes)}; WAL: ${formatBytes(report.database.walBytes)}; pages: ${report.database.pageCount}; freelist: ${report.database.freelistCount}`,
  );
  console.log(
    `Event: ${report.events.total}; task-scoped: ${report.events.taskScopedCount}; taskless: ${report.events.tasklessCount}; Checkpoint: ${report.checkpoints.count}`,
  );
  console.log(
    `Backups: ${report.backups.count}; total: ${formatBytes(report.backups.totalBytes)}; directory: ${report.backups.directory}`,
  );
  console.log('Bounded Event type sample:');
  for (const row of report.events.sample.byType.slice(0, 8)) {
    console.log(
      `- ${row.category}/${row.type}: ${row.count}/${report.events.sample.observed} (${(row.share * 100).toFixed(1)}%), scoped ${row.scopedCount}`,
    );
  }
  console.log('Findings:');
  for (const finding of report.findings) {
    console.log(`- [${finding.severity}] ${finding.code}: ${finding.summary}`);
  }
  console.log('Dry-run maintenance plan:');
  for (const action of maintenancePlan.actions) {
    const bytes =
      action.estimatedBytes === null ? 'unknown bytes' : formatBytes(action.estimatedBytes);
    console.log(
      `- [${action.disposition}] ${action.id}: ${action.estimatedRows} rows/items, ${bytes}`,
    );
  }
  if (report.events.deepScanPerformed) {
    console.log('Largest Event payload groups:');
    for (const row of report.events.topPayloadBytes.slice(0, 10)) {
      console.log(
        `- ${row.category}/${row.type}: ${row.count} events, ${formatBytes(row.payloadBytes)}`,
      );
    }
  }
  console.log('No rows, files, WAL pages, or backups were changed.');
}

async function inspect(options: InspectCliOptions): Promise<void> {
  const connection = await openDatabaseAsync({
    path: options.databasePath,
    readonly: true,
    fileMustExist: true,
  });
  try {
    const result = inspectDatabaseGovernance(connection.raw, {
      databasePath: options.databasePath,
      ...(options.backupsDirectory === undefined
        ? {}
        : { backupsDirectory: options.backupsDirectory }),
      mode: options.mode,
      backupPolicy: {
        keepLatest: options.backupKeepLatest,
        maxTotalBytes: options.backupMaxBytes,
      },
      includePhysicalTableSizes: options.includePhysicalTableSizes,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printHumanReadable(result);
  } finally {
    connection.raw.close();
  }
}

async function prepareManifest(options: PrepareManifestCliOptions): Promise<void> {
  const connection = await openDatabaseAsync({
    path: options.databasePath,
    readonly: true,
    fileMustExist: true,
  });
  try {
    const manifest = prepareDatabaseMaintenanceManifest(connection.raw, {
      databasePath: options.databasePath,
      ...(options.backupsDirectory === undefined
        ? {}
        : { backupsDirectory: options.backupsDirectory }),
      backupPolicy: {
        keepLatest: options.backupKeepLatest,
        maxTotalBytes: options.backupMaxBytes,
      },
      ...(options.eventPayloadSidecarDirectory === undefined
        ? {}
        : { eventPayloadSidecarDirectory: options.eventPayloadSidecarDirectory }),
    });
    writeDatabaseMaintenanceManifest(options.manifestPath, manifest);
    console.log(`Database maintenance manifest prepared (read-only): ${options.manifestPath}`);
    console.log(`Plan: ${manifest.planId}`);
    console.log(`Event candidates: ${manifest.eventCandidates.total}`);
    console.log(`Backup candidates: ${manifest.backupCandidates.length}`);
    console.log(`Manifest SHA-256: ${manifest.manifestHash}`);
    console.log(`Confirmation token: ${manifest.confirmationToken}`);
    console.log('No rows, files, WAL pages, or backups were changed.');
  } finally {
    connection.raw.close();
  }
}

async function prepareEventArchive(options: PrepareEventArchiveCliOptions): Promise<void> {
  const manifest = await prepareEventRetentionArchiveManifest({
    databasePath: options.databasePath,
    archiveRootDirectory: options.archiveRootDirectory,
    cutoff: options.cutoff,
    maxRows: options.maxRows,
    maxBytes: options.maxBytes,
    ...(options.archiveId === undefined ? {} : { archiveId: options.archiveId }),
  });
  writeEventRetentionArchiveManifest(options.manifestPath, manifest);
  if (options.json) { console.log(JSON.stringify(manifest, null, 2)); return; }
  console.log(`Event retention archive manifest prepared (read-only): ${options.manifestPath}`);
  console.log(`Archive: ${manifest.archiveId}`);
  console.log(`Candidates: ${manifest.totals.rowCount}`);
  console.log(`Payload/full-row bytes: ${formatBytes(manifest.totals.payloadBytes)}/${formatBytes(manifest.totals.fullRowBytes)}`);
  console.log(`Protected Events: ${manifest.protectedEventCount}`);
  console.log(`Manifest SHA-256: ${manifest.manifestHash}`);
  console.log(`Confirmation token: ${manifest.confirmationToken}`);
  console.log(`Rollback token: ${manifest.rollbackToken}`);
  console.log('No rows, archive segments, WAL pages, or backups were changed.');
}

async function executeEventArchive(options: ExecuteEventArchiveCliOptions): Promise<void> {
  const manifest = readEventRetentionArchiveManifest(options.manifestPath);
  if (options.confirmationToken !== expectedEventRetentionArchiveConfirmationToken(manifest)) throw new Error('--confirm did not match the exact archive token');
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  const connection = await openDatabaseAsync({ path: manifest.databasePath, readonly: false, fileMustExist: true });
  try {
    const audit = await executeEventRetentionArchive(connection.raw, {
      manifest,
      confirmationToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      signal: controller.signal,
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Event retention archive ${audit.status}: ${audit.archiveId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(`Segment: ${audit.archiveDirectory}`);
      console.log(`Rows deleted/cursor: ${audit.progress.rowsDeleted}/${audit.progress.nextRowIndex}/${audit.progress.rowCount}`);
    }
    if (audit.status === 'cancelled') process.exitCode = 130;
  } finally {
    process.off('SIGINT', onInterrupt);
    connection.raw.close();
  }
}

async function rollbackEventArchive(options: RollbackEventArchiveCliOptions): Promise<void> {
  const manifest = readEventRetentionArchiveManifest(options.manifestPath);
  if (options.confirmationToken !== expectedEventRetentionArchiveRollbackToken(manifest)) throw new Error('--confirm did not match the exact archive rollback token');
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  const connection = await openDatabaseAsync({ path: manifest.databasePath, readonly: false, fileMustExist: true });
  try {
    const audit = await rollbackEventRetentionArchive(connection.raw, {
      manifest,
      rollbackToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      ...(options.executionAuditPath === undefined ? {} : { executeAuditPath: options.executionAuditPath }),
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      signal: controller.signal,
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Event retention archive rollback ${audit.status}: ${audit.archiveId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(`Rows inserted/already restored: ${audit.progress.rowsInserted}/${audit.progress.rowsAlreadyRestored}`);
      console.log(`Cursor: ${audit.progress.nextRowIndex}/${audit.progress.rowCount}`);
    }
    if (audit.status === 'cancelled') process.exitCode = 130;
  } finally {
    process.off('SIGINT', onInterrupt);
    connection.raw.close();
  }
}

async function prepareSidecarGc(options: PrepareSidecarGcCliOptions): Promise<void> {
  const connection = await openDatabaseAsync({ path: options.databasePath, readonly: true, fileMustExist: true });
  try {
    const manifest = prepareEventPayloadSidecarGcManifest(connection.raw, {
      databasePath: options.databasePath,
      sidecarRootDirectory: options.sidecarRootDirectory,
    });
    writeEventPayloadSidecarGcManifest(options.manifestPath, manifest);
    if (options.json) { console.log(JSON.stringify(manifest, null, 2)); return; }
    console.log(`Event payload sidecar GC mark prepared (read-only): ${options.manifestPath}`);
    console.log(`Sweep: ${manifest.sweepId}`);
    console.log(`Live references/unique blobs: ${manifest.liveReferences.eventReferenceCount}/${manifest.liveReferences.blobs.length}`);
    console.log(`Exact orphan blobs: ${manifest.orphans.length}`);
    console.log(`Manifest SHA-256: ${manifest.manifestHash}`);
    console.log(`Confirmation token: ${manifest.confirmationToken}`);
    console.log('No rows or files were changed.');
  } finally { connection.raw.close(); }
}

async function prepareBackfillPlan(options: PrepareBackfillPlanCliOptions): Promise<void> {
  const connection = await openDatabaseAsync({
    path: options.databasePath,
    readonly: true,
    fileMustExist: true,
  });
  try {
    const plan = prepareEventPayloadBackfillPlan(connection.raw, {
      databasePath: options.databasePath,
      sidecarRootDirectory: options.sidecarRootDirectory,
      minimumPayloadBytes: options.minimumPayloadBytes,
    });
    writeEventPayloadBackfillPlan(options.planPath, plan);
    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(`Event payload backfill plan prepared (read-only): ${options.planPath}`);
    console.log(`Plan: ${plan.planId}`);
    console.log(
      `Projection builder: ${plan.projectionBuilder.id}@${plan.projectionBuilder.version}`,
    );
    console.log(
      `Matched/candidates/already externalized/below threshold: ${plan.scan.matchedEventCount}/${plan.scan.inlineCandidateCount}/${plan.scan.alreadyExternalizedCount}/${plan.scan.belowThresholdCount}`,
    );
    console.log(
      `Estimated logical SQLite payload reduction: ${formatBytes(plan.estimates.logicalSqlitePayloadBytesReduced)}`,
    );
    console.log(
      `Estimated new sidecar bytes: ${formatBytes(plan.estimates.sidecarNewStoredBytes)} (${formatBytes(plan.estimates.sidecarUniqueStoredBytes)} unique referenced bytes)`,
    );
    console.log(`Source selection SHA-256: ${plan.sourceSelectionHash}`);
    console.log(`Destination reference SHA-256: ${plan.scan.destinationReferenceHash}`);
    console.log(`Plan SHA-256: ${plan.planHash}`);
    console.log('No Event rows, sidecar blobs, WAL pages, or backups were changed.');
  } finally {
    connection.raw.close();
  }
}

async function executeBackfillPlan(options: ExecuteBackfillPlanCliOptions): Promise<void> {
  const plan = readEventPayloadBackfillPlan(options.planPath);
  const expectedToken = expectedEventPayloadBackfillConfirmationToken(plan);
  if (options.confirmationToken !== expectedToken) {
    throw new Error('--confirm did not match the exact backfill plan token');
  }

  const controller = new AbortController();
  let interruptCount = 0;
  const onInterrupt = (): void => {
    interruptCount += 1;
    if (interruptCount === 1) {
      console.error('Cancellation requested; waiting for the current transaction batch to finish...');
      controller.abort();
      return;
    }
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  const connection = await openDatabaseAsync({
    path: plan.databasePath,
    readonly: false,
    fileMustExist: true,
  });
  try {
    const audit = await executeEventPayloadBackfill(connection.raw, {
      plan,
      confirmationToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      signal: controller.signal,
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Event payload backfill ${audit.status}: ${audit.planId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(`Recovery database: ${audit.recoverySet?.databasePath ?? 'not created'}`);
      console.log(
        `Rows converted/already converted: ${audit.progress.rowsConverted}/${audit.progress.rowsAlreadyConverted}`,
      );
      console.log(
        `Batches/cursor: ${audit.progress.batchesCommitted}/${audit.progress.nextCandidateIndex}/${audit.progress.candidateCount}`,
      );
    }
    if (audit.status === 'cancelled') process.exitCode = 130;
  } finally {
    process.off('SIGINT', onInterrupt);
    connection.raw.close();
  }
}

async function rollbackBackfillPlan(options: RollbackBackfillPlanCliOptions): Promise<void> {
  const plan = readEventPayloadBackfillPlan(options.planPath);
  const executionAudit = readEventPayloadBackfillAudit(options.executionAuditPath);
  if (options.confirmationToken !== expectedEventPayloadBackfillRollbackConfirmationToken(plan)) throw new Error('--confirm did not match the exact rollback token');
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  const connection = await openDatabaseAsync({ path: plan.databasePath, readonly: false, fileMustExist: true });
  try {
    const audit = await rollbackEventPayloadBackfill(connection.raw, {
      plan, executionAudit, confirmationToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      signal: controller.signal,
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Event payload backfill rollback ${audit.status}: ${audit.planId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(`Rows restored/already original: ${audit.progress.rowsRestored}/${audit.progress.rowsAlreadyOriginal}`);
    }
    if (audit.status === 'cancelled') process.exitCode = 130;
  } finally {
    process.off('SIGINT', onInterrupt);
    connection.raw.close();
  }
}

async function executeSidecarGc(options: ExecuteSidecarGcCliOptions): Promise<void> {
  const manifest = readEventPayloadSidecarGcManifest(options.manifestPath);
  if (options.confirmationToken !== expectedEventPayloadSidecarGcConfirmationToken(manifest)) throw new Error('--confirm did not match the exact sidecar GC token');
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  const connection = await openDatabaseAsync({ path: manifest.databasePath, readonly: true, fileMustExist: true });
  try {
    const audit = await executeEventPayloadSidecarGc(connection.raw, {
      manifest,
      confirmationToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      signal: controller.signal,
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Event payload sidecar GC ${audit.status}: ${audit.sweepId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(`Quarantine: ${audit.quarantineDirectory}`);
      console.log(`Blobs quarantined/already quarantined: ${audit.progress.blobsQuarantined}/${audit.progress.blobsAlreadyQuarantined}`);
    }
    if (audit.status === 'cancelled') process.exitCode = 130;
  } finally {
    process.off('SIGINT', onInterrupt);
    connection.raw.close();
  }
}

async function prepareCompaction(options: PrepareCompactionCliOptions): Promise<void> {
  const manifest = await prepareDatabaseCompactionManifest({
    databasePath: options.databasePath,
    governanceRootDirectory: options.governanceRootDirectory,
    operation: options.operation,
    ...(options.planId === undefined ? {} : { planId: options.planId }),
  });
  writeDatabaseCompactionManifest(options.manifestPath, manifest);
  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  console.log(`Database compaction manifest prepared (read-only): ${options.manifestPath}`);
  console.log(`Operation: ${manifest.operation}`);
  console.log(`Plan: ${manifest.planId}`);
  console.log(
    `Pages/freelist: ${manifest.sourceFingerprint.pageCount}/${manifest.sourceFingerprint.freelistCount}`,
  );
  console.log(`auto_vacuum: ${manifest.sourceFingerprint.autoVacuum.mode}`);
  console.log(`Manifest SHA-256: ${manifest.manifestHash}`);
  console.log(`Confirmation token: ${manifest.confirmationToken}`);
  console.log('No database pages, rows, files, WAL pages, or backups were changed.');
}

async function executeIncrementalVacuumCommand(
  options: ExecuteIncrementalVacuumCliOptions,
): Promise<void> {
  const manifest = readDatabaseCompactionManifest(options.manifestPath);
  if (options.confirmationToken !== expectedDatabaseCompactionConfirmationToken(manifest)) {
    throw new Error('--confirm did not match the exact compaction token');
  }
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  process.once('SIGINT', onInterrupt);
  const connection = await openDatabaseAsync({
    path: manifest.databasePath,
    readonly: false,
    fileMustExist: true,
  });
  try {
    const audit = await executeIncrementalVacuum(connection.raw, {
      manifest,
      confirmationToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      pageBudget: options.pageBudget,
      ...(options.batchPages === undefined ? {} : { batchPages: options.batchPages }),
      ...(options.timeBudgetMs === undefined ? {} : { timeBudgetMs: options.timeBudgetMs }),
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      signal: controller.signal,
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Incremental vacuum ${audit.status}: ${audit.planId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(
        `Pages requested/freed: ${audit.progress.pagesRequested}/${audit.progress.pagesFreed}`,
      );
      console.log(
        `Freelist: ${audit.progress.initial.freelistCount} -> ${audit.progress.current.freelistCount}`,
      );
      console.log(`Stop reason: ${audit.stopReason ?? 'none'}`);
    }
    if (audit.status === 'cancelled') process.exitCode = 130;
  } finally {
    process.off('SIGINT', onInterrupt);
    connection.raw.close();
  }
}

async function executeOfflineCompactionCommand(
  options: ExecuteOfflineCompactionCliOptions,
): Promise<void> {
  const manifest = readDatabaseCompactionManifest(options.manifestPath);
  if (options.confirmationToken !== expectedDatabaseCompactionConfirmationToken(manifest)) {
    throw new Error('--confirm did not match the exact compaction token');
  }
  const connection = await openDatabaseAsync({
    path: manifest.databasePath,
    readonly: false,
    fileMustExist: true,
  });
  try {
    const audit = await executeOfflineDatabaseCompaction(connection.raw, {
      manifest,
      confirmationToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      outputPath: options.outputPath,
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Offline database compaction ${audit.status}: ${audit.planId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(`Compacted candidate: ${audit.output.path}`);
      console.log(`Source preserved: ${audit.handoff.sourceDatabasePath}`);
      console.log('Automatic database switch was not performed.');
    }
  } finally {
    connection.raw.close();
  }
}

async function executeManifest(options: ExecuteManifestCliOptions): Promise<void> {
  const manifest = readDatabaseMaintenanceManifest(options.manifestPath);
  if (options.confirmationToken !== manifest.confirmationToken) {
    throw new Error('--confirm did not match the exact manifest token');
  }

  const controller = new AbortController();
  let interruptCount = 0;
  const onInterrupt = (): void => {
    interruptCount += 1;
    if (interruptCount === 1) {
      console.error(
        'Cancellation requested; waiting for the current transaction batch to finish...',
      );
      controller.abort();
      return;
    }
    process.exit(130);
  };
  process.on('SIGINT', onInterrupt);

  const connection = await openDatabaseAsync({
    path: manifest.databasePath,
    readonly: false,
    fileMustExist: true,
  });
  try {
    const audit = await executeDatabaseMaintenance(connection.raw, {
      manifest,
      confirmationToken: options.confirmationToken,
      maintenanceWindowConfirmed: options.maintenanceWindowConfirmed,
      ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
      ...(options.auditPath === undefined ? {} : { auditPath: options.auditPath }),
      signal: controller.signal,
    });
    if (options.json) console.log(JSON.stringify(audit, null, 2));
    else {
      console.log(`Database maintenance ${audit.status}: ${audit.planId}`);
      console.log(`Audit: ${audit.auditPath}`);
      console.log(`Recovery backup: ${audit.recoveryBackup?.path ?? 'not created'}`);
      console.log(
        `Events deleted/already absent: ${audit.progress.eventRowsDeleted}/${audit.progress.eventRowsAlreadyAbsent}`,
      );
      console.log(
        `Backups quarantined/already quarantined: ${audit.progress.backupsQuarantined}/${audit.progress.backupsAlreadyQuarantined}`,
      );
    }
    if (audit.status === 'cancelled') process.exitCode = 130;
  } finally {
    process.off('SIGINT', onInterrupt);
    connection.raw.close();
  }
}

export async function runDatabaseGovernanceCli(args: readonly string[]): Promise<void> {
  const options = parseDatabaseGovernanceCliOptions(args);
  if (options.command === 'inspect') return inspect(options);
  if (options.command === 'prepare-manifest') return prepareManifest(options);
  if (options.command === 'prepare-backfill-plan') return prepareBackfillPlan(options);
  if (options.command === 'execute-backfill-plan') return executeBackfillPlan(options);
  if (options.command === 'rollback-backfill-plan') return rollbackBackfillPlan(options);
  if (options.command === 'prepare-sidecar-gc') return prepareSidecarGc(options);
  if (options.command === 'execute-sidecar-gc') return executeSidecarGc(options);
  if (options.command === 'prepare-event-archive') return prepareEventArchive(options);
  if (options.command === 'execute-event-archive') return executeEventArchive(options);
  if (options.command === 'rollback-event-archive') return rollbackEventArchive(options);
  if (options.command === 'prepare-compaction') return prepareCompaction(options);
  if (options.command === 'execute-incremental-vacuum') {
    return executeIncrementalVacuumCommand(options);
  }
  if (options.command === 'execute-offline-compaction') {
    return executeOfflineCompactionCommand(options);
  }
  return executeManifest(options);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await runDatabaseGovernanceCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'database governance command failed');
    process.exitCode = 1;
  }
}
