import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BetterSQLite3Raw } from './connection.js';

export const DATABASE_GOVERNANCE_REPORT_VERSION = 1 as const;
export const DATABASE_MAINTENANCE_PLAN_VERSION = 1 as const;

export type DatabaseGovernanceMode = 'quick' | 'deep';
export type GovernanceSeverity = 'info' | 'warning' | 'critical';
export type GovernanceDisposition = 'candidate' | 'protected' | 'no-op';

export interface DatabaseGovernanceOptions {
  databasePath: string;
  backupsDirectory?: string;
  mode?: DatabaseGovernanceMode;
  now?: Date;
  backupPolicy?: {
    keepLatest: number;
    maxTotalBytes: number;
  };
  largeDatabaseBytes?: number;
  largeWalBytes?: number;
  eventSampleSize?: number;
  includePhysicalTableSizes?: boolean;
}

export interface GovernanceFinding {
  code: string;
  severity: GovernanceSeverity;
  summary: string;
  evidence: Record<string, string | number | boolean | null>;
  recommendation: string;
}

export interface DatabaseTableGovernanceStats {
  name: string;
  rowCount: number;
  estimatedBytes?: number;
}

export interface DatabaseEventCategoryStats {
  category: string;
  count: number;
  fullyGlobalCount: number;
  scopedCount: number;
  payloadBytes: number;
}

export interface DatabaseEventTypeStats {
  type: string;
  category: string;
  count: number;
  fullyGlobalCount: number;
  scopedCount: number;
  payloadBytes: number;
  maxPayloadBytes: number;
}

export interface DatabaseEventSampleTypeStats {
  type: string;
  category: string;
  count: number;
  share: number;
  fullyGlobalCount: number;
  scopedCount: number;
}

export interface DatabaseGovernanceReport {
  version: typeof DATABASE_GOVERNANCE_REPORT_VERSION;
  generatedAt: string;
  mode: DatabaseGovernanceMode;
  database: {
    path: string;
    fileBytes: number;
    walBytes: number;
    pageSize: number;
    pageCount: number;
    freelistCount: number;
    journalMode: string;
    autoVacuum: string;
    physicalTableSizesPerformed: boolean;
  };
  tables: DatabaseTableGovernanceStats[];
  events: {
    total: number;
    tasklessCount: number;
    taskScopedCount: number;
    fullyGlobalCount: number | null;
    scopedCount: number | null;
    minSequence: number | null;
    maxSequence: number | null;
    deepScanPerformed: boolean;
    sample: {
      requested: number;
      observed: number;
      rowidMin: number | null;
      rowidMax: number | null;
      byType: DatabaseEventSampleTypeStats[];
    };
    byCategory: DatabaseEventCategoryStats[];
    byType: DatabaseEventTypeStats[];
    topPayloadBytes: DatabaseEventTypeStats[];
  };
  checkpoints: {
    count: number;
    minSequence: number | null;
    maxSequence: number | null;
  };
  backups: {
    directory: string;
    count: number;
    totalBytes: number;
    oldest: string | null;
    newest: string | null;
  };
  findings: GovernanceFinding[];
}

export interface DatabaseMaintenanceAction {
  id: string;
  resource: 'event' | 'checkpoint' | 'backup' | 'database';
  disposition: GovernanceDisposition;
  estimatedRows: number;
  estimatedBytes: number | null;
  selector: string;
  reason: string;
  requiresConfirmation: boolean;
  targetNames?: string[];
}

export interface DatabaseMaintenancePlan {
  version: typeof DATABASE_MAINTENANCE_PLAN_VERSION;
  generatedAt: string;
  mode: 'dry-run';
  actions: DatabaseMaintenanceAction[];
}

export interface DatabaseGovernanceInspection {
  report: DatabaseGovernanceReport;
  maintenancePlan: DatabaseMaintenancePlan;
}

interface CountRow {
  count: number;
}

interface EventScopeRow {
  total: number;
  taskScopedCount: number;
}

interface SequenceRangeRow {
  minSequence: number | null;
  maxSequence: number | null;
}

interface EventAggregateRow {
  category: string;
  type: string;
  count: number;
  fullyGlobalCount: number;
  scopedCount: number;
  payloadBytes: number;
  maxPayloadBytes: number;
}

interface EventSampleRow {
  category: string;
  type: string;
  taskId: string | null;
  runId: string | null;
  stepId: string | null;
  messageId: string | null;
}

interface BackupFileStats {
  name: string;
  bytes: number;
  modifiedAtMs: number;
}

const DEFAULT_BACKUP_POLICY = {
  keepLatest: 8,
  maxTotalBytes: 64 * 1024 * 1024 * 1024,
};
const DEFAULT_LARGE_DATABASE_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_LARGE_WAL_BYTES = 256 * 1024 * 1024;
const DEFAULT_EVENT_SAMPLE_SIZE = 4_096;
const MAX_EVENT_SAMPLE_SIZE = 8_192;
export const LOW_VALUE_GLOBAL_CATEGORIES = [
  'telemetry',
  'diagnostic',
  'system',
  'provider',
] as const;
export const LOW_VALUE_EVENT_MARKERS = [
  'telemetry',
  'diagnostic',
  'health.sampled',
  'heartbeat',
  'trace.sampled',
] as const;
export const PROTECTED_EVENT_MARKERS = [
  'approval',
  'artifact',
  'browser',
  'checkpoint',
  'compact',
  'context',
  'conversation',
  'desktop',
  'message',
  'recovery',
  'run.',
  'step.',
  'task.',
  'thread',
  'waiting_user',
];

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function fileBytes(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

function simplePragma(raw: BetterSQLite3Raw, name: string): string | number {
  return raw.pragma(name, { simple: true }) as string | number;
}

function numberPragma(raw: BetterSQLite3Raw, name: string): number {
  const value = Number(simplePragma(raw, name));
  return Number.isFinite(value) ? value : 0;
}

function autoVacuumName(value: number): string {
  if (value === 1) return 'full';
  if (value === 2) return 'incremental';
  return 'none';
}

function listBackupFiles(directory: string): BackupFileStats[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.backup.db'))
    .map((entry) => {
      const path = resolve(directory, entry.name);
      const stats = statSync(path);
      return { name: entry.name, bytes: stats.size, modifiedAtMs: stats.mtimeMs };
    })
    .sort(
      (left, right) =>
        right.modifiedAtMs - left.modifiedAtMs || right.name.localeCompare(left.name),
    );
}

function tableNames(raw: BetterSQLite3Raw): string[] {
  return (
    raw
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name ASC`,
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function tablePhysicalBytes(raw: BetterSQLite3Raw): Map<string, number> {
  try {
    const rows = raw
      .prepare(
        `SELECT master.tbl_name AS tableName, SUM(dbstat.pgsize) AS estimatedBytes
         FROM dbstat
         JOIN sqlite_master AS master ON master.name = dbstat.name
         WHERE master.type IN ('table', 'index')
         GROUP BY master.tbl_name`,
      )
      .all() as Array<{ tableName: string; estimatedBytes: number }>;
    return new Map(rows.map((row) => [row.tableName, Number(row.estimatedBytes)]));
  } catch {
    return new Map();
  }
}

function inspectTables(
  raw: BetterSQLite3Raw,
  includePhysicalTableSizes: boolean,
  knownCounts: ReadonlyMap<string, number>,
): DatabaseTableGovernanceStats[] {
  const physicalBytes = includePhysicalTableSizes
    ? tablePhysicalBytes(raw)
    : new Map<string, number>();
  return tableNames(raw).map((name) => {
    const rowCount =
      knownCounts.get(name) ??
      Number(
        (raw.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get() as CountRow)
          .count,
      );
    const estimatedBytes = physicalBytes.get(name);
    return estimatedBytes === undefined ? { name, rowCount } : { name, rowCount, estimatedBytes };
  });
}

function inspectEventSample(
  raw: BetterSQLite3Raw,
  requestedSize: number,
): DatabaseGovernanceReport['events']['sample'] {
  const bounds = raw
    .prepare('SELECT MIN(rowid) AS rowidMin, MAX(rowid) AS rowidMax FROM event')
    .get() as { rowidMin: number | null; rowidMax: number | null };
  if (bounds.rowidMin === null || bounds.rowidMax === null || requestedSize === 0) {
    return {
      requested: requestedSize,
      observed: 0,
      rowidMin: bounds.rowidMin,
      rowidMax: bounds.rowidMax,
      byType: [],
    };
  }

  const span = Math.max(0, bounds.rowidMax - bounds.rowidMin);
  const count = Math.min(requestedSize, span + 1);
  const rowids = Array.from({ length: count }, (_, index) =>
    count === 1 ? bounds.rowidMin! : Math.round(bounds.rowidMin! + (span * index) / (count - 1)),
  );
  const rows: EventSampleRow[] = [];
  for (let offset = 0; offset < rowids.length; offset += 400) {
    const chunk = rowids.slice(offset, offset + 400);
    const placeholders = chunk.map(() => '?').join(', ');
    rows.push(
      ...(raw
        .prepare(
          `SELECT
             category,
             type,
             task_id AS taskId,
             run_id AS runId,
             step_id AS stepId,
             message_id AS messageId
           FROM event
           WHERE rowid IN (${placeholders})`,
        )
        .all(...chunk) as EventSampleRow[]),
    );
  }

  const groups = new Map<string, Omit<DatabaseEventSampleTypeStats, 'share'>>();
  for (const row of rows) {
    const key = `${row.category}\u0000${row.type}`;
    const current = groups.get(key) ?? {
      category: row.category,
      type: row.type,
      count: 0,
      fullyGlobalCount: 0,
      scopedCount: 0,
    };
    current.count += 1;
    if (
      row.taskId === null &&
      row.runId === null &&
      row.stepId === null &&
      row.messageId === null
    ) {
      current.fullyGlobalCount += 1;
    } else {
      current.scopedCount += 1;
    }
    groups.set(key, current);
  }

  return {
    requested: requestedSize,
    observed: rows.length,
    rowidMin: bounds.rowidMin,
    rowidMax: bounds.rowidMax,
    byType: [...groups.values()]
      .map((row) => ({ ...row, share: rows.length === 0 ? 0 : row.count / rows.length }))
      .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
  };
}

function inspectEventAggregates(raw: BetterSQLite3Raw): EventAggregateRow[] {
  return raw
    .prepare(
      `SELECT
         category,
         type,
         COUNT(*) AS count,
         SUM(CASE
           WHEN task_id IS NULL AND run_id IS NULL AND step_id IS NULL AND message_id IS NULL
           THEN 1 ELSE 0 END) AS fullyGlobalCount,
         SUM(CASE
           WHEN task_id IS NOT NULL OR run_id IS NOT NULL OR step_id IS NOT NULL OR message_id IS NOT NULL
           THEN 1 ELSE 0 END) AS scopedCount,
         SUM(LENGTH(CAST(payload_json AS BLOB))) AS payloadBytes,
         MAX(LENGTH(CAST(payload_json AS BLOB))) AS maxPayloadBytes
       FROM event
       GROUP BY category, type
       ORDER BY count DESC, category ASC, type ASC`,
    )
    .all() as EventAggregateRow[];
}

function summarizeCategories(rows: EventAggregateRow[]): DatabaseEventCategoryStats[] {
  const categories = new Map<string, DatabaseEventCategoryStats>();
  for (const row of rows) {
    const current = categories.get(row.category) ?? {
      category: row.category,
      count: 0,
      fullyGlobalCount: 0,
      scopedCount: 0,
      payloadBytes: 0,
    };
    current.count += Number(row.count);
    current.fullyGlobalCount += Number(row.fullyGlobalCount);
    current.scopedCount += Number(row.scopedCount);
    current.payloadBytes += Number(row.payloadBytes);
    categories.set(row.category, current);
  }
  return [...categories.values()].sort(
    (left, right) => right.count - left.count || left.category.localeCompare(right.category),
  );
}

function normalizeEventRows(rows: EventAggregateRow[]): DatabaseEventTypeStats[] {
  return rows.map((row) => ({
    category: row.category,
    type: row.type,
    count: Number(row.count),
    fullyGlobalCount: Number(row.fullyGlobalCount),
    scopedCount: Number(row.scopedCount),
    payloadBytes: Number(row.payloadBytes),
    maxPayloadBytes: Number(row.maxPayloadBytes),
  }));
}

export function isGlobalTelemetryCandidateIdentity(category: string, type: string): boolean {
  if (!LOW_VALUE_GLOBAL_CATEGORIES.some((candidate) => candidate === category.toLowerCase())) {
    return false;
  }
  const identity = `${category}.${type}`.toLowerCase();
  return (
    LOW_VALUE_EVENT_MARKERS.some((marker) => identity.includes(marker)) &&
    !PROTECTED_EVENT_MARKERS.some((marker) => identity.includes(marker))
  );
}

function isGlobalTelemetryCandidate(row: DatabaseEventTypeStats): boolean {
  return row.fullyGlobalCount > 0 && isGlobalTelemetryCandidateIdentity(row.category, row.type);
}

function createFindings(input: {
  fileBytes: number;
  walBytes: number;
  pageCount: number;
  freelistCount: number;
  eventCount: number;
  eventTasklessCount: number;
  eventSample: DatabaseGovernanceReport['events']['sample'];
  checkpointCount: number;
  backupCount: number;
  backupBytes: number;
  backupKeepLatest: number;
  backupMaxBytes: number;
  largeDatabaseBytes: number;
  largeWalBytes: number;
  deepScanPerformed: boolean;
}): GovernanceFinding[] {
  const findings: GovernanceFinding[] = [];
  if (input.fileBytes >= input.largeDatabaseBytes) {
    findings.push({
      code: 'database-size-budget-exceeded',
      severity: 'critical',
      summary: '数据库主文件已超过治理预算。',
      evidence: { fileBytes: input.fileBytes, budgetBytes: input.largeDatabaseBytes },
      recommendation: '先运行深度只读诊断定位物理占用，再单独审批维护方案。',
    });
  }
  if (input.walBytes >= input.largeWalBytes) {
    findings.push({
      code: 'wal-size-budget-exceeded',
      severity: 'warning',
      summary: 'WAL 文件已超过治理预算。',
      evidence: { walBytes: input.walBytes, budgetBytes: input.largeWalBytes },
      recommendation: '在 Runtime 停写窗口评估 checkpoint；不要在启动路径强制执行。',
    });
  }
  if (input.pageCount > 0 && input.freelistCount / input.pageCount >= 0.2) {
    findings.push({
      code: 'freelist-ratio-high',
      severity: 'warning',
      summary: '数据库存在较高比例的可复用空闲页。',
      evidence: {
        pageCount: input.pageCount,
        freelistCount: input.freelistCount,
        ratio: input.freelistCount / input.pageCount,
      },
      recommendation: '优先复用空闲页；物理压缩必须在独立维护窗口和回滚点后评估。',
    });
  }
  if (input.eventCount >= 1_000 && input.eventTasklessCount / input.eventCount >= 0.8) {
    findings.push({
      code: 'taskless-event-ratio-high',
      severity: 'critical',
      summary: '绝大多数 Event 没有 Task 归属。',
      evidence: {
        eventCount: input.eventCount,
        tasklessCount: input.eventTasklessCount,
        ratio: input.eventTasklessCount / input.eventCount,
      },
      recommendation:
        '结合有界类型样本定位异常写入循环，不要把 taskless 直接等同于可删除 telemetry。',
    });
  }
  const dominantSample = input.eventSample.byType[0];
  if (
    input.eventSample.observed >= 1_000 &&
    dominantSample !== undefined &&
    dominantSample.share >= 0.4
  ) {
    findings.push({
      code: 'event-sample-dominant-type',
      severity: 'warning',
      summary: '有界 Event 样本由少数事件类型主导。',
      evidence: {
        category: dominantSample.category,
        type: dominantSample.type,
        sampleCount: dominantSample.count,
        sampleObserved: input.eventSample.observed,
        sampleShare: dominantSample.share,
      },
      recommendation: '审计该事件的生产路径、幂等 fence 与 checkpoint 频率。',
    });
  }
  if (
    input.checkpointCount > 0 &&
    (input.eventCount === 0 || input.checkpointCount / input.eventCount >= 0.5)
  ) {
    findings.push({
      code: 'checkpoint-amplification',
      severity: 'warning',
      summary: 'Checkpoint 与 Event 的比例异常接近逐事件写入。',
      evidence: {
        checkpointCount: input.checkpointCount,
        eventCount: input.eventCount,
        ratio: input.eventCount === 0 ? null : input.checkpointCount / input.eventCount,
      },
      recommendation: '后续单独设计有界 checkpoint 策略；本计划继续保护现有恢复真源。',
    });
  }
  if (input.backupCount > input.backupKeepLatest || input.backupBytes > input.backupMaxBytes) {
    findings.push({
      code: 'backup-budget-exceeded',
      severity: 'warning',
      summary: '迁移备份数量或总体积超过当前治理预算。',
      evidence: {
        backupCount: input.backupCount,
        backupBytes: input.backupBytes,
        budgetBytes: input.backupMaxBytes,
      },
      recommendation: '只生成旧备份候选清单，确认恢复点后再执行独立清理。',
    });
  }
  if (!input.deepScanPerformed) {
    findings.push({
      code: 'deep-event-scan-not-run',
      severity: 'info',
      summary: '快速诊断未扫描 Event payload 或按类型聚合。',
      evidence: { deepScanPerformed: false },
      recommendation: '仅在维护窗口使用 --deep 执行一次完整聚合。',
    });
  }
  return findings;
}

function createMaintenancePlan(input: {
  generatedAt: string;
  eventRows: DatabaseEventTypeStats[];
  eventTotal: number;
  checkpointCount: number;
  backupFiles: BackupFileStats[];
  backupPolicy: { keepLatest: number; maxTotalBytes: number };
  pageCount: number;
  freelistCount: number;
}): DatabaseMaintenancePlan {
  const candidates = input.eventRows.filter(isGlobalTelemetryCandidate);
  const telemetryRows = candidates.reduce((sum, row) => sum + row.fullyGlobalCount, 0);
  const telemetryBytes = candidates.reduce((sum, row) => {
    if (row.count === 0) return sum;
    return sum + Math.round((row.payloadBytes * row.fullyGlobalCount) / row.count);
  }, 0);
  const protectedEventRows = Math.max(0, input.eventTotal - telemetryRows);
  const backupBytes = input.backupFiles.reduce((sum, file) => sum + file.bytes, 0);
  const retained = input.backupFiles.slice(0, input.backupPolicy.keepLatest);
  const oldBackups = input.backupFiles.slice(input.backupPolicy.keepLatest);
  const backupCandidates =
    input.backupFiles.length > input.backupPolicy.keepLatest ||
    backupBytes > input.backupPolicy.maxTotalBytes
      ? oldBackups
      : [];

  return {
    version: DATABASE_MAINTENANCE_PLAN_VERSION,
    generatedAt: input.generatedAt,
    mode: 'dry-run',
    actions: [
      {
        id: 'review-global-telemetry',
        resource: 'event',
        disposition: telemetryRows > 0 ? 'candidate' : 'no-op',
        estimatedRows: telemetryRows,
        estimatedBytes: telemetryRows > 0 ? telemetryBytes : 0,
        selector:
          'all scope ids are NULL AND low-value telemetry markers match AND protected markers are excluded',
        reason: '只把无 Task/Run/Step/Message 归属的低价值遥测列为人工复核候选。',
        requiresConfirmation: true,
      },
      {
        id: 'protect-durable-events',
        resource: 'event',
        disposition: 'protected',
        estimatedRows: protectedEventRows,
        estimatedBytes: null,
        selector: 'all Event rows outside the conservative global telemetry candidate set',
        reason: 'Task、Run、Message、审批、Artifact、上下文、Browser/Desktop 与恢复事实保持真源。',
        requiresConfirmation: true,
      },
      {
        id: 'protect-checkpoint-source-of-truth',
        resource: 'checkpoint',
        disposition: 'protected',
        estimatedRows: input.checkpointCount,
        estimatedBytes: null,
        selector: 'all checkpoint rows',
        reason: 'P0.1 仅诊断写入放大，不删除恢复真源。',
        requiresConfirmation: true,
      },
      {
        id: 'review-old-migration-backups',
        resource: 'backup',
        disposition: backupCandidates.length > 0 ? 'candidate' : 'no-op',
        estimatedRows: backupCandidates.length,
        estimatedBytes: backupCandidates.reduce((sum, file) => sum + file.bytes, 0),
        selector: `preserve newest ${retained.length}; review older migration backups`,
        reason: '保留最新恢复点，旧迁移备份仅生成候选清单。',
        requiresConfirmation: true,
        targetNames: backupCandidates.map((file) => file.name),
      },
      {
        id: 'review-physical-compaction',
        resource: 'database',
        disposition:
          input.pageCount > 0 && input.freelistCount / input.pageCount >= 0.2
            ? 'candidate'
            : 'no-op',
        estimatedRows: input.freelistCount,
        estimatedBytes: null,
        selector: 'PRAGMA freelist_count / page_count >= 0.20',
        reason: '物理压缩与逻辑清理分离；当前只提示维护窗口候选。',
        requiresConfirmation: true,
      },
    ],
  };
}

export function inspectDatabaseGovernance(
  raw: BetterSQLite3Raw,
  options: DatabaseGovernanceOptions,
): DatabaseGovernanceInspection {
  const mode = options.mode ?? 'quick';
  const generatedAt = (options.now ?? new Date()).toISOString();
  const databasePath = resolve(options.databasePath);
  const backupsDirectory = resolve(
    options.backupsDirectory ?? resolve(dirname(databasePath), 'backups'),
  );
  const backupPolicy = options.backupPolicy ?? DEFAULT_BACKUP_POLICY;
  const pageSize = numberPragma(raw, 'page_size');
  const pageCount = numberPragma(raw, 'page_count');
  const freelistCount = numberPragma(raw, 'freelist_count');
  const fileSize = fileBytes(databasePath);
  const walBytes = fileBytes(`${databasePath}-wal`);
  const eventSampleSize = Math.max(
    0,
    Math.min(
      MAX_EVENT_SAMPLE_SIZE,
      Math.trunc(options.eventSampleSize ?? DEFAULT_EVENT_SAMPLE_SIZE),
    ),
  );
  const includePhysicalTableSizes = options.includePhysicalTableSizes ?? false;

  const eventScope = raw
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(task_id) AS taskScopedCount
       FROM event INDEXED BY event_task_idx`,
    )
    .get() as EventScopeRow;
  const eventRange = raw
    .prepare(
      `SELECT MIN(sequence) AS minSequence, MAX(sequence) AS maxSequence
       FROM event INDEXED BY event_ws_seq_idx`,
    )
    .get() as SequenceRangeRow;
  const checkpoint = raw
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(last_event_sequence) AS minSequence,
              MAX(last_event_sequence) AS maxSequence
       FROM checkpoint INDEXED BY checkpoint_run_seq_idx`,
    )
    .get() as CountRow & SequenceRangeRow;
  const eventSample = inspectEventSample(raw, eventSampleSize);
  const aggregateRows = mode === 'deep' ? normalizeEventRows(inspectEventAggregates(raw)) : [];
  const fullyGlobalCount =
    mode === 'deep' ? aggregateRows.reduce((sum, row) => sum + row.fullyGlobalCount, 0) : null;
  const scopedCount =
    mode === 'deep' ? aggregateRows.reduce((sum, row) => sum + row.scopedCount, 0) : null;
  const backupFiles = listBackupFiles(backupsDirectory);
  const backupBytes = backupFiles.reduce((sum, file) => sum + file.bytes, 0);
  const knownCounts = new Map<string, number>([
    ['event', Number(eventScope.total)],
    ['checkpoint', Number(checkpoint.count)],
  ]);
  const tables = inspectTables(raw, includePhysicalTableSizes, knownCounts);
  const findings = createFindings({
    fileBytes: fileSize,
    walBytes,
    pageCount,
    freelistCount,
    eventCount: Number(eventScope.total),
    eventTasklessCount: Number(eventScope.total) - Number(eventScope.taskScopedCount),
    eventSample,
    checkpointCount: Number(checkpoint.count),
    backupCount: backupFiles.length,
    backupBytes,
    backupKeepLatest: backupPolicy.keepLatest,
    backupMaxBytes: backupPolicy.maxTotalBytes,
    largeDatabaseBytes: options.largeDatabaseBytes ?? DEFAULT_LARGE_DATABASE_BYTES,
    largeWalBytes: options.largeWalBytes ?? DEFAULT_LARGE_WAL_BYTES,
    deepScanPerformed: mode === 'deep',
  });

  const report: DatabaseGovernanceReport = {
    version: DATABASE_GOVERNANCE_REPORT_VERSION,
    generatedAt,
    mode,
    database: {
      path: databasePath,
      fileBytes: fileSize,
      walBytes,
      pageSize,
      pageCount,
      freelistCount,
      journalMode: String(simplePragma(raw, 'journal_mode')),
      autoVacuum: autoVacuumName(numberPragma(raw, 'auto_vacuum')),
      physicalTableSizesPerformed: includePhysicalTableSizes,
    },
    tables,
    events: {
      total: Number(eventScope.total),
      tasklessCount: Number(eventScope.total) - Number(eventScope.taskScopedCount),
      taskScopedCount: Number(eventScope.taskScopedCount),
      fullyGlobalCount,
      scopedCount,
      minSequence: eventRange.minSequence === null ? null : Number(eventRange.minSequence),
      maxSequence: eventRange.maxSequence === null ? null : Number(eventRange.maxSequence),
      deepScanPerformed: mode === 'deep',
      sample: eventSample,
      byCategory: summarizeCategories(aggregateRows),
      byType: aggregateRows,
      topPayloadBytes: [...aggregateRows]
        .sort(
          (left, right) =>
            right.payloadBytes - left.payloadBytes || left.type.localeCompare(right.type),
        )
        .slice(0, 20),
    },
    checkpoints: {
      count: Number(checkpoint.count),
      minSequence: checkpoint.minSequence === null ? null : Number(checkpoint.minSequence),
      maxSequence: checkpoint.maxSequence === null ? null : Number(checkpoint.maxSequence),
    },
    backups: {
      directory: backupsDirectory,
      count: backupFiles.length,
      totalBytes: backupBytes,
      oldest: backupFiles.length === 0 ? null : (backupFiles[backupFiles.length - 1]?.name ?? null),
      newest: backupFiles[0]?.name ?? null,
    },
    findings,
  };

  return {
    report,
    maintenancePlan: createMaintenancePlan({
      generatedAt,
      eventRows: aggregateRows,
      eventTotal: Number(eventScope.total),
      checkpointCount: Number(checkpoint.count),
      backupFiles,
      backupPolicy,
      pageCount,
      freelistCount,
    }),
  };
}
