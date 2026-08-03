import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { BetterSQLite3Raw } from './connection.js';
import {
  assertEventPayloadSidecarManifestIntegrity,
  captureEventPayloadSidecarManifest,
  createEventPayloadSidecarBackup,
  eventPayloadSidecarManifestHash,
  verifyEventPayloadSidecarBackup,
  type EventPayloadSidecarBackupVerification,
  type EventPayloadSidecarManifest,
} from './event-payload-backup.js';
import { openDatabaseAsync } from './connection.js';
import {
  inspectDatabaseGovernance,
  LOW_VALUE_EVENT_MARKERS,
  LOW_VALUE_GLOBAL_CATEGORIES,
  PROTECTED_EVENT_MARKERS,
} from './database-governance.js';

export const DATABASE_MAINTENANCE_MANIFEST_VERSION = 2 as const;
export const DATABASE_MAINTENANCE_AUDIT_VERSION = 2 as const;
export const DATABASE_MAINTENANCE_SELECTOR_VERSION = 1 as const;

const DEFAULT_MAX_EVENT_CANDIDATES = 100_000;
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 5_000;

export interface DatabaseMaintenanceFingerprint {
  schemaVersion: number;
  schemaHash: string;
  userVersion: number;
  pageCount: number;
  eventCount: number;
  eventMaxSequence: number | null;
  checkpointCount: number;
  checkpointMaxSequence: number | null;
}

export interface DatabaseMaintenanceEventCandidate {
  id: string;
  rowid: number;
  category: string;
  type: string;
  sequence: number;
  occurredAt: string;
}

export interface DatabaseMaintenanceBackupCandidate {
  name: string;
  bytes: number;
  modifiedAtMs: number;
}

interface DatabaseMaintenanceManifestUnsigned {
  version: typeof DATABASE_MAINTENANCE_MANIFEST_VERSION;
  selectorVersion: typeof DATABASE_MAINTENANCE_SELECTOR_VERSION;
  planId: string;
  generatedAt: string;
  databasePath: string;
  backupsDirectory: string;
  sourceFingerprint: DatabaseMaintenanceFingerprint;
  inspectionHash: string;
  eventCandidates: {
    complete: boolean;
    total: number;
    items: DatabaseMaintenanceEventCandidate[];
  };
  backupCandidates: DatabaseMaintenanceBackupCandidate[];
  protectedSummary: {
    durableEventRows: number;
    checkpointRows: number;
  };
  eventPayloadSidecars: EventPayloadSidecarManifest;
}

export interface DatabaseMaintenanceManifest extends DatabaseMaintenanceManifestUnsigned {
  manifestHash: string;
  confirmationToken: string;
}

export type DatabaseMaintenanceAuditStatus =
  'preparing' | 'running' | 'cancelled' | 'completed' | 'failed';

export interface DatabaseMaintenanceAudit {
  version: typeof DATABASE_MAINTENANCE_AUDIT_VERSION;
  planId: string;
  manifestHash: string;
  databasePath: string;
  auditPath: string;
  status: DatabaseMaintenanceAuditStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  recoveryBackup?: {
    path: string;
    bytes: number;
    quickCheck: 'ok';
    eventPayloadSidecars: EventPayloadSidecarBackupVerification;
  };
  progress: {
    eventCandidates: number;
    nextEventIndex: number;
    eventRowsDeleted: number;
    eventRowsAlreadyAbsent: number;
    eventBatchesCommitted: number;
    backupCandidates: number;
    nextBackupIndex: number;
    backupsQuarantined: number;
    backupsAlreadyQuarantined: number;
  };
  quarantineDirectory: string;
  error?: string;
}

export interface PrepareDatabaseMaintenanceManifestOptions {
  databasePath: string;
  backupsDirectory?: string;
  backupPolicy?: {
    keepLatest: number;
    maxTotalBytes: number;
  };
  now?: Date;
  planId?: string;
  maxEventCandidates?: number;
  eventPayloadSidecarDirectory?: string;
}

export interface ExecuteDatabaseMaintenanceOptions {
  manifest: DatabaseMaintenanceManifest;
  confirmationToken: string;
  maintenanceWindowConfirmed: boolean;
  auditPath?: string;
  batchSize?: number;
  now?: () => Date;
  signal?: AbortSignal;
  onEventBatchCommitted?: (audit: DatabaseMaintenanceAudit) => void;
}

interface CountRow {
  count: number;
}

interface CandidateRow {
  id: string;
  rowid: number;
  category: string;
  type: string;
  sequence: number;
  occurredAt: string;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function markerPredicate(markers: readonly string[]): string {
  const identity = "LOWER(category || '.' || type)";
  return markers.map((marker) => `INSTR(${identity}, ${sqlLiteral(marker)}) > 0`).join(' OR ');
}

export const DATABASE_MAINTENANCE_EVENT_CANDIDATE_WHERE_SQL = `
  task_id IS NULL
  AND run_id IS NULL
  AND step_id IS NULL
  AND message_id IS NULL
  AND LOWER(category) IN (${LOW_VALUE_GLOBAL_CATEGORIES.map(sqlLiteral).join(', ')})
  AND (${markerPredicate(LOW_VALUE_EVENT_MARKERS)})
  AND NOT (${markerPredicate(PROTECTED_EVENT_MARKERS)})
`;

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function planIdentifier(now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return `maintenance-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function assertSafePlanId(planId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(planId)) {
    throw new Error('database maintenance planId is invalid');
  }
}

function assertPathWithin(root: string, target: string): void {
  const normalizedRoot = `${resolve(root)}${sep}`.toLowerCase();
  const normalizedTarget = resolve(target).toLowerCase();
  if (!normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error('database maintenance path escaped its governed directory');
  }
}

function quickCheck(raw: BetterSQLite3Raw): 'ok' {
  const rows = raw.pragma('quick_check(1)') as Array<Record<string, unknown>>;
  const values = rows.flatMap((row) => Object.values(row)).map(String);
  if (values.length !== 1 || values[0]?.toLowerCase() !== 'ok') {
    throw new Error(`database quick_check failed: ${values.join('; ')}`);
  }
  return 'ok';
}

export function captureDatabaseMaintenanceFingerprint(
  raw: BetterSQLite3Raw,
): DatabaseMaintenanceFingerprint {
  const event = raw
    .prepare('SELECT COUNT(*) AS count, MAX(sequence) AS maxSequence FROM event')
    .get() as { count: number; maxSequence: number | null };
  const schemaRows = raw
    .prepare(
      'SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema ORDER BY type, name, tbl_name',
    )
    .all() as Array<{ type: string; name: string; tableName: string; sql: string | null }>;
  const checkpoint = raw
    .prepare('SELECT COUNT(*) AS count, MAX(last_event_sequence) AS maxSequence FROM checkpoint')
    .get() as { count: number; maxSequence: number | null };
  return {
    schemaVersion: Number(raw.pragma('schema_version', { simple: true })),
    schemaHash: hashJson(schemaRows),
    userVersion: Number(raw.pragma('user_version', { simple: true })),
    pageCount: Number(raw.pragma('page_count', { simple: true })),
    eventCount: Number(event.count),
    eventMaxSequence: event.maxSequence === null ? null : Number(event.maxSequence),
    checkpointCount: Number(checkpoint.count),
    checkpointMaxSequence: checkpoint.maxSequence === null ? null : Number(checkpoint.maxSequence),
  };
}

function sameFingerprint(
  left: DatabaseMaintenanceFingerprint,
  right: DatabaseMaintenanceFingerprint,
): boolean {
  return hashJson(left) === hashJson(right);
}

function sameLogicalFingerprint(
  left: DatabaseMaintenanceFingerprint,
  right: DatabaseMaintenanceFingerprint,
): boolean {
  return (
    left.schemaHash === right.schemaHash &&
    left.userVersion === right.userVersion &&
    left.eventCount === right.eventCount &&
    left.eventMaxSequence === right.eventMaxSequence &&
    left.checkpointCount === right.checkpointCount &&
    left.checkpointMaxSequence === right.checkpointMaxSequence
  );
}

function candidateRows(
  raw: BetterSQLite3Raw,
  maxCandidates: number,
): { total: number; complete: boolean; items: DatabaseMaintenanceEventCandidate[] } {
  const count = raw
    .prepare(
      `SELECT COUNT(*) AS count FROM event WHERE ${DATABASE_MAINTENANCE_EVENT_CANDIDATE_WHERE_SQL}`,
    )
    .get() as CountRow;
  const total = Number(count.count);
  const rows = raw
    .prepare(
      `SELECT rowid, id, category, type, sequence, occurred_at AS occurredAt
       FROM event
       WHERE ${DATABASE_MAINTENANCE_EVENT_CANDIDATE_WHERE_SQL}
       ORDER BY rowid ASC
       LIMIT ?`,
    )
    .all(maxCandidates + 1) as CandidateRow[];
  return {
    total,
    complete: total <= maxCandidates && rows.length <= maxCandidates,
    items: rows.slice(0, maxCandidates).map((row) => ({
      id: row.id,
      rowid: Number(row.rowid),
      category: row.category,
      type: row.type,
      sequence: Number(row.sequence),
      occurredAt: row.occurredAt,
    })),
  };
}

function backupCandidateMetadata(
  directory: string,
  names: readonly string[],
): DatabaseMaintenanceBackupCandidate[] {
  if (!existsSync(directory)) return [];
  const allowed = new Set(names);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && allowed.has(entry.name))
    .map((entry) => {
      if (basename(entry.name) !== entry.name || !entry.name.endsWith('.backup.db')) {
        throw new Error('database maintenance backup candidate name is invalid');
      }
      const path = resolve(directory, entry.name);
      assertPathWithin(directory, path);
      const stats = statSync(path);
      return { name: entry.name, bytes: stats.size, modifiedAtMs: Math.trunc(stats.mtimeMs) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function unsignedManifest(
  manifest: DatabaseMaintenanceManifest,
): DatabaseMaintenanceManifestUnsigned {
  return {
    version: manifest.version,
    selectorVersion: manifest.selectorVersion,
    planId: manifest.planId,
    generatedAt: manifest.generatedAt,
    databasePath: manifest.databasePath,
    backupsDirectory: manifest.backupsDirectory,
    sourceFingerprint: manifest.sourceFingerprint,
    inspectionHash: manifest.inspectionHash,
    eventCandidates: manifest.eventCandidates,
    backupCandidates: manifest.backupCandidates,
    protectedSummary: manifest.protectedSummary,
    eventPayloadSidecars: manifest.eventPayloadSidecars,
  };
}

export function expectedDatabaseMaintenanceConfirmationToken(
  manifest: Pick<DatabaseMaintenanceManifest, 'planId' | 'manifestHash'>,
): string {
  return `APPLY-DATABASE-MAINTENANCE:${manifest.planId}:${manifest.manifestHash.slice(0, 16)}`;
}

export function assertDatabaseMaintenanceManifestIntegrity(
  manifest: DatabaseMaintenanceManifest,
): void {
  if (manifest.version !== DATABASE_MAINTENANCE_MANIFEST_VERSION) {
    throw new Error('database maintenance manifest version is unsupported');
  }
  if (manifest.selectorVersion !== DATABASE_MAINTENANCE_SELECTOR_VERSION) {
    throw new Error('database maintenance selector version is unsupported');
  }
  assertSafePlanId(manifest.planId);
  if (hashJson(unsignedManifest(manifest)) !== manifest.manifestHash) {
    throw new Error('database maintenance manifest hash mismatch');
  }
  if (expectedDatabaseMaintenanceConfirmationToken(manifest) !== manifest.confirmationToken) {
    throw new Error('database maintenance confirmation token mismatch');
  }
  if (
    new Set(manifest.eventCandidates.items.map((item) => item.id)).size !==
    manifest.eventCandidates.items.length
  ) {
    throw new Error('database maintenance manifest contains duplicate Event ids');
  }
  assertEventPayloadSidecarManifestIntegrity(manifest.eventPayloadSidecars);
}

export function prepareDatabaseMaintenanceManifest(
  raw: BetterSQLite3Raw,
  options: PrepareDatabaseMaintenanceManifestOptions,
): DatabaseMaintenanceManifest {
  quickCheck(raw);
  const now = options.now ?? new Date();
  const planId = options.planId ?? planIdentifier(now);
  assertSafePlanId(planId);
  const databasePath = resolve(options.databasePath);
  const backupsDirectory = resolve(
    options.backupsDirectory ?? join(dirname(databasePath), 'backups'),
  );
  const maxEventCandidates = Math.max(
    0,
    Math.min(options.maxEventCandidates ?? DEFAULT_MAX_EVENT_CANDIDATES, 1_000_000),
  );
  const inspection = inspectDatabaseGovernance(raw, {
    databasePath,
    backupsDirectory,
    mode: 'deep',
    now,
    ...(options.backupPolicy === undefined ? {} : { backupPolicy: options.backupPolicy }),
  });
  const exactEvents = candidateRows(raw, maxEventCandidates);
  const backupAction = inspection.maintenancePlan.actions.find(
    (action) => action.id === 'review-old-migration-backups',
  );
  const protectedEvents = inspection.maintenancePlan.actions.find(
    (action) => action.id === 'protect-durable-events',
  );
  const protectedCheckpoints = inspection.maintenancePlan.actions.find(
    (action) => action.id === 'protect-checkpoint-source-of-truth',
  );
  const unsigned: DatabaseMaintenanceManifestUnsigned = {
    version: DATABASE_MAINTENANCE_MANIFEST_VERSION,
    selectorVersion: DATABASE_MAINTENANCE_SELECTOR_VERSION,
    planId,
    generatedAt: now.toISOString(),
    databasePath,
    backupsDirectory,
    sourceFingerprint: captureDatabaseMaintenanceFingerprint(raw),
    inspectionHash: hashJson(inspection),
    eventCandidates: exactEvents,
    backupCandidates: backupCandidateMetadata(backupsDirectory, backupAction?.targetNames ?? []),
    protectedSummary: {
      durableEventRows: protectedEvents?.estimatedRows ?? inspection.report.events.total,
      checkpointRows: protectedCheckpoints?.estimatedRows ?? inspection.report.checkpoints.count,
    },
    eventPayloadSidecars: captureEventPayloadSidecarManifest(
      raw,
      options.eventPayloadSidecarDirectory,
    ),
  };
  const manifestHash = hashJson(unsigned);
  return {
    ...unsigned,
    manifestHash,
    confirmationToken: expectedDatabaseMaintenanceConfirmationToken({ planId, manifestHash }),
  };
}

function atomicWriteJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, absolute);
}

export function writeDatabaseMaintenanceManifest(
  path: string,
  manifest: DatabaseMaintenanceManifest,
): void {
  assertDatabaseMaintenanceManifestIntegrity(manifest);
  atomicWriteJson(path, manifest);
}

export function readDatabaseMaintenanceManifest(path: string): DatabaseMaintenanceManifest {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as DatabaseMaintenanceManifest;
  assertDatabaseMaintenanceManifestIntegrity(parsed);
  return parsed;
}

function readAudit(path: string): DatabaseMaintenanceAudit | undefined {
  if (!existsSync(path)) return undefined;
  const audit = JSON.parse(readFileSync(path, 'utf8')) as DatabaseMaintenanceAudit;
  if (audit.version !== DATABASE_MAINTENANCE_AUDIT_VERSION) {
    throw new Error('database maintenance audit version is unsupported');
  }
  return audit;
}

function persistAudit(audit: DatabaseMaintenanceAudit): void {
  atomicWriteJson(audit.auditPath, audit);
}

function updateAudit(
  audit: DatabaseMaintenanceAudit,
  now: () => Date,
  update: (current: DatabaseMaintenanceAudit) => void,
): void {
  update(audit);
  audit.updatedAt = now().toISOString();
  persistAudit(audit);
}

async function verifyRecoveryBackup(
  backupPath: string,
  expected: DatabaseMaintenanceFingerprint,
  expectedSidecars: EventPayloadSidecarManifest,
  backupSidecarRoot: string,
): Promise<{
  bytes: number;
  quickCheck: 'ok';
  eventPayloadSidecars: EventPayloadSidecarBackupVerification;
}> {
  const connection = await openDatabaseAsync({
    path: backupPath,
    readonly: true,
    fileMustExist: true,
  });
  try {
    quickCheck(connection.raw);
    const fingerprint = captureDatabaseMaintenanceFingerprint(connection.raw);
    if (!sameLogicalFingerprint(fingerprint, expected)) {
      throw new Error(
        `database maintenance recovery backup fingerprint mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(fingerprint)}`,
      );
    }
    const eventPayloadSidecars = verifyEventPayloadSidecarBackup(
      connection.raw,
      expectedSidecars,
      backupSidecarRoot,
    );
    return {
      bytes: statSync(backupPath).size,
      quickCheck: 'ok',
      eventPayloadSidecars,
    };
  } finally {
    connection.raw.close();
  }
}

function expectedRecoveryPaths(manifest: DatabaseMaintenanceManifest): {
  backupDirectory: string;
  backupPath: string;
  backupSidecarRoot: string;
} {
  const backupDirectory = resolve(dirname(manifest.databasePath), 'backups', 'maintenance');
  const backupPath = resolve(backupDirectory, `${manifest.planId}.backup.db`);
  const backupSidecarRoot = `${backupPath}.sidecars`;
  assertPathWithin(dirname(manifest.databasePath), backupPath);
  assertPathWithin(dirname(manifest.databasePath), backupSidecarRoot);
  return { backupDirectory, backupPath, backupSidecarRoot };
}

function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function cleanupExactRecoverySet(
  backupDirectory: string,
  backupPath: string,
  backupSidecarRoot: string,
): void {
  assertPathWithin(backupDirectory, backupPath);
  assertPathWithin(backupDirectory, backupSidecarRoot);
  if (existsSync(backupPath)) {
    if (!statSync(backupPath).isFile()) {
      throw new Error('database maintenance recovery backup path is not a file');
    }
    unlinkSync(backupPath);
  }
  if (existsSync(backupSidecarRoot)) {
    if (!statSync(backupSidecarRoot).isDirectory()) {
      throw new Error('database maintenance recovery sidecar path is not a directory');
    }
    rmSync(backupSidecarRoot, { recursive: true, force: true });
  }
}

async function createRecoveryBackupSet(
  raw: BetterSQLite3Raw,
  manifest: DatabaseMaintenanceManifest,
  backupPath: string,
  backupSidecarRoot: string,
): Promise<{
  bytes: number;
  quickCheck: 'ok';
  eventPayloadSidecars: EventPayloadSidecarBackupVerification;
}> {
  const backupDirectory = dirname(backupPath);
  const stagingId = `${process.pid}.${randomUUID()}`;
  const stagingBackupPath = `${backupPath}.${stagingId}.tmp`;
  const stagingSidecarRoot = `${backupSidecarRoot}.${stagingId}.tmp`;
  assertPathWithin(backupDirectory, stagingBackupPath);
  assertPathWithin(backupDirectory, stagingSidecarRoot);
  try {
    await raw.backup(stagingBackupPath);
    createEventPayloadSidecarBackup(manifest.eventPayloadSidecars, stagingSidecarRoot);
    await verifyRecoveryBackup(
      stagingBackupPath,
      manifest.sourceFingerprint,
      manifest.eventPayloadSidecars,
      stagingSidecarRoot,
    );
    renameSync(stagingBackupPath, backupPath);
    renameSync(stagingSidecarRoot, backupSidecarRoot);
    return await verifyRecoveryBackup(
      backupPath,
      manifest.sourceFingerprint,
      manifest.eventPayloadSidecars,
      backupSidecarRoot,
    );
  } catch (error) {
    cleanupExactRecoverySet(backupDirectory, stagingBackupPath, stagingSidecarRoot);
    cleanupExactRecoverySet(backupDirectory, backupPath, backupSidecarRoot);
    throw error;
  }
}

async function verifyRecordedRecoveryBackup(
  audit: DatabaseMaintenanceAudit,
  manifest: DatabaseMaintenanceManifest,
): Promise<void> {
  const recovery = audit.recoveryBackup;
  if (recovery === undefined) {
    throw new Error('database maintenance recovery backup is missing');
  }
  const expected = expectedRecoveryPaths(manifest);
  if (
    !sameResolvedPath(recovery.path, expected.backupPath) ||
    !sameResolvedPath(recovery.eventPayloadSidecars.rootDirectory, expected.backupSidecarRoot)
  ) {
    throw new Error('database maintenance recovery backup path does not match the manifest');
  }
  const verified = await verifyRecoveryBackup(
    recovery.path,
    manifest.sourceFingerprint,
    manifest.eventPayloadSidecars,
    recovery.eventPayloadSidecars.rootDirectory,
  );
  if (
    verified.bytes !== recovery.bytes ||
    verified.quickCheck !== recovery.quickCheck ||
    hashJson(verified.eventPayloadSidecars) !== hashJson(recovery.eventPayloadSidecars)
  ) {
    throw new Error('database maintenance recovery backup descriptor changed after audit');
  }
}

function assertNoPostManifestEvents(
  raw: BetterSQLite3Raw,
  fingerprint: DatabaseMaintenanceFingerprint,
): void {
  if (fingerprint.eventMaxSequence === null) {
    const row = raw.prepare('SELECT COUNT(*) AS count FROM event').get() as CountRow;
    if (Number(row.count) !== 0) throw new Error('database changed after maintenance manifest');
    return;
  }
  const row = raw
    .prepare('SELECT COUNT(*) AS count FROM event WHERE sequence > ?')
    .get(fingerprint.eventMaxSequence) as CountRow;
  if (Number(row.count) !== 0) throw new Error('database changed after maintenance manifest');
}

function assertResumeFingerprint(
  raw: BetterSQLite3Raw,
  manifest: DatabaseMaintenanceManifest,
): void {
  const current = captureDatabaseMaintenanceFingerprint(raw);
  if (
    current.schemaVersion !== manifest.sourceFingerprint.schemaVersion ||
    current.userVersion !== manifest.sourceFingerprint.userVersion ||
    current.checkpointCount !== manifest.sourceFingerprint.checkpointCount ||
    current.checkpointMaxSequence !== manifest.sourceFingerprint.checkpointMaxSequence
  ) {
    throw new Error('database protected state changed after maintenance manifest');
  }
  assertNoPostManifestEvents(raw, manifest.sourceFingerprint);
}

function initialAudit(
  manifest: DatabaseMaintenanceManifest,
  auditPath: string,
  now: () => Date,
): DatabaseMaintenanceAudit {
  const timestamp = now().toISOString();
  const quarantineDirectory = resolve(manifest.backupsDirectory, 'quarantine', manifest.planId);
  assertPathWithin(manifest.backupsDirectory, quarantineDirectory);
  return {
    version: DATABASE_MAINTENANCE_AUDIT_VERSION,
    planId: manifest.planId,
    manifestHash: manifest.manifestHash,
    databasePath: manifest.databasePath,
    auditPath,
    status: 'preparing',
    startedAt: timestamp,
    updatedAt: timestamp,
    progress: {
      eventCandidates: manifest.eventCandidates.items.length,
      nextEventIndex: 0,
      eventRowsDeleted: 0,
      eventRowsAlreadyAbsent: 0,
      eventBatchesCommitted: 0,
      backupCandidates: manifest.backupCandidates.length,
      nextBackupIndex: 0,
      backupsQuarantined: 0,
      backupsAlreadyQuarantined: 0,
    },
    quarantineDirectory,
  };
}

function eventBatch(raw: BetterSQLite3Raw, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  return raw.transaction(() => {
    const protectedRows = raw
      .prepare(
        `SELECT id FROM event
         WHERE id IN (${placeholders})
           AND NOT (${DATABASE_MAINTENANCE_EVENT_CANDIDATE_WHERE_SQL})`,
      )
      .all(...ids) as Array<{ id: string }>;
    if (protectedRows.length > 0) {
      throw new Error('database maintenance candidate no longer matches the protected selector');
    }
    const result = raw
      .prepare(
        `DELETE FROM event
         WHERE id IN (${placeholders})
           AND ${DATABASE_MAINTENANCE_EVENT_CANDIDATE_WHERE_SQL}`,
      )
      .run(...ids);
    return Number(result.changes);
  })();
}

function quarantineBackup(
  manifest: DatabaseMaintenanceManifest,
  audit: DatabaseMaintenanceAudit,
  candidate: DatabaseMaintenanceBackupCandidate,
): 'moved' | 'already-moved' {
  if (basename(candidate.name) !== candidate.name || !candidate.name.endsWith('.backup.db')) {
    throw new Error('database maintenance backup candidate name is invalid');
  }
  const source = resolve(manifest.backupsDirectory, candidate.name);
  const target = resolve(audit.quarantineDirectory, candidate.name);
  assertPathWithin(manifest.backupsDirectory, source);
  assertPathWithin(manifest.backupsDirectory, target);
  const sourceExists = existsSync(source);
  const targetExists = existsSync(target);
  if (!sourceExists && targetExists) {
    const targetStats = statSync(target);
    if (
      targetStats.size !== candidate.bytes ||
      Math.trunc(targetStats.mtimeMs) !== candidate.modifiedAtMs
    ) {
      throw new Error('database maintenance quarantined backup identity mismatch');
    }
    return 'already-moved';
  }
  if (!sourceExists || targetExists) {
    throw new Error('database maintenance backup candidate state is ambiguous');
  }
  const sourceStats = statSync(source);
  if (
    sourceStats.size !== candidate.bytes ||
    Math.trunc(sourceStats.mtimeMs) !== candidate.modifiedAtMs
  ) {
    throw new Error('database maintenance backup candidate changed after manifest');
  }
  mkdirSync(audit.quarantineDirectory, { recursive: true });
  renameSync(source, target);
  return 'moved';
}

export async function executeDatabaseMaintenance(
  raw: BetterSQLite3Raw,
  options: ExecuteDatabaseMaintenanceOptions,
): Promise<DatabaseMaintenanceAudit> {
  const { manifest } = options;
  assertDatabaseMaintenanceManifestIntegrity(manifest);
  if (!options.maintenanceWindowConfirmed) {
    throw new Error('database maintenance requires an explicit offline maintenance window');
  }
  if (options.confirmationToken !== manifest.confirmationToken) {
    throw new Error('database maintenance explicit confirmation did not match');
  }
  if (!manifest.eventCandidates.complete) {
    throw new Error('database maintenance manifest is truncated and cannot execute');
  }
  if (Number(raw.pragma('query_only', { simple: true })) !== 0) {
    throw new Error('database maintenance execution requires a writable connection');
  }
  const now = options.now ?? (() => new Date());
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE));
  const auditPath = resolve(
    options.auditPath ??
      join(dirname(manifest.databasePath), 'maintenance-audits', `${manifest.planId}.audit.json`),
  );
  let audit = readAudit(auditPath);
  if (audit !== undefined) {
    if (
      audit.planId !== manifest.planId ||
      audit.manifestHash !== manifest.manifestHash ||
      resolve(audit.databasePath) !== resolve(manifest.databasePath)
    ) {
      throw new Error('database maintenance audit does not match the manifest');
    }
    if (audit.status === 'completed') {
      await verifyRecordedRecoveryBackup(audit, manifest);
      return audit;
    }
    assertResumeFingerprint(raw, manifest);
    await verifyRecordedRecoveryBackup(audit, manifest);
  } else {
    const currentFingerprint = captureDatabaseMaintenanceFingerprint(raw);
    if (!sameFingerprint(currentFingerprint, manifest.sourceFingerprint)) {
      throw new Error('database changed after maintenance manifest');
    }
    const currentSidecars = captureEventPayloadSidecarManifest(
      raw,
      manifest.eventPayloadSidecars.sourceRootDirectory ?? undefined,
    );
    if (
      eventPayloadSidecarManifestHash(currentSidecars) !==
      eventPayloadSidecarManifestHash(manifest.eventPayloadSidecars)
    ) {
      throw new Error('event payload sidecar references changed after maintenance manifest');
    }
    quickCheck(raw);
    audit = initialAudit(manifest, auditPath, now);
    persistAudit(audit);
    const { backupDirectory, backupPath, backupSidecarRoot } = expectedRecoveryPaths(manifest);
    mkdirSync(backupDirectory, { recursive: true });
    if (existsSync(backupPath)) {
      throw new Error('database maintenance recovery backup already exists without an audit');
    }
    if (existsSync(backupSidecarRoot)) {
      throw new Error(
        'database maintenance sidecar recovery backup already exists without an audit',
      );
    }
    try {
      const verified = await createRecoveryBackupSet(raw, manifest, backupPath, backupSidecarRoot);
      updateAudit(audit, now, (current) => {
        current.recoveryBackup = { path: backupPath, ...verified };
        current.status = 'running';
        delete current.error;
      });
    } catch (error) {
      cleanupExactRecoverySet(backupDirectory, backupPath, backupSidecarRoot);
      updateAudit(audit, now, (current) => {
        delete current.recoveryBackup;
        current.status = 'failed';
        current.error =
          error instanceof Error ? error.message : 'database maintenance recovery backup failed';
      });
      throw error;
    }
    const afterBackup = captureDatabaseMaintenanceFingerprint(raw);
    if (!sameFingerprint(afterBackup, manifest.sourceFingerprint)) {
      throw new Error('database changed while the maintenance recovery backup was created');
    }
  }

  try {
    if (audit.status !== 'running') {
      updateAudit(audit, now, (current) => {
        current.status = 'running';
        delete current.error;
      });
    }
    while (audit.progress.nextEventIndex < manifest.eventCandidates.items.length) {
      if (options.signal?.aborted) {
        updateAudit(audit, now, (current) => {
          current.status = 'cancelled';
        });
        return audit;
      }
      const batch = manifest.eventCandidates.items.slice(
        audit.progress.nextEventIndex,
        audit.progress.nextEventIndex + batchSize,
      );
      const deleted = eventBatch(
        raw,
        batch.map((candidate) => candidate.id),
      );
      updateAudit(audit, now, (current) => {
        current.progress.nextEventIndex += batch.length;
        current.progress.eventRowsDeleted += deleted;
        current.progress.eventRowsAlreadyAbsent += batch.length - deleted;
        current.progress.eventBatchesCommitted += 1;
      });
      options.onEventBatchCommitted?.(audit);
    }

    while (audit.progress.nextBackupIndex < manifest.backupCandidates.length) {
      if (options.signal?.aborted) {
        updateAudit(audit, now, (current) => {
          current.status = 'cancelled';
        });
        return audit;
      }
      const candidate = manifest.backupCandidates[audit.progress.nextBackupIndex];
      if (candidate === undefined) break;
      const result = quarantineBackup(manifest, audit, candidate);
      updateAudit(audit, now, (current) => {
        current.progress.nextBackupIndex += 1;
        if (result === 'moved') current.progress.backupsQuarantined += 1;
        else current.progress.backupsAlreadyQuarantined += 1;
      });
    }

    quickCheck(raw);
    updateAudit(audit, now, (current) => {
      current.status = 'completed';
      current.completedAt = now().toISOString();
    });
    return audit;
  } catch (error) {
    updateAudit(audit, now, (current) => {
      current.status = 'failed';
      current.error = error instanceof Error ? error.message : 'database maintenance failed';
    });
    throw error;
  }
}
