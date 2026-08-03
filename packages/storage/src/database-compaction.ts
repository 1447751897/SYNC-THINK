import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';

export const DATABASE_COMPACTION_MANIFEST_VERSION = 1 as const;
export const DATABASE_COMPACTION_AUDIT_VERSION = 1 as const;
export const DEFAULT_INCREMENTAL_VACUUM_BATCH_PAGES = 128;
export const MAX_INCREMENTAL_VACUUM_BATCH_PAGES = 10_000;

const SAFE_PLAN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type DatabaseCompactionOperation = 'incremental-vacuum' | 'offline-compaction';
export type DatabaseAutoVacuumMode = 'NONE' | 'FULL' | 'INCREMENTAL';

export interface DatabaseCompactionHighWater {
  sequence: number;
  id: string;
}

export interface DatabaseCompactionTableRowCount {
  tableName: string;
  rowCount: number;
}

export interface DatabaseCompactionFingerprint {
  schemaVersion: number;
  schemaHash: string;
  userVersion: number;
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  autoVacuum: { code: 0 | 1 | 2; mode: DatabaseAutoVacuumMode };
  event: { count: number; highWater: DatabaseCompactionHighWater | null };
  checkpoint: { count: number; highWater: DatabaseCompactionHighWater | null };
  userTableRowCounts: DatabaseCompactionTableRowCount[];
}

interface DatabaseCompactionManifestUnsigned {
  version: typeof DATABASE_COMPACTION_MANIFEST_VERSION;
  operation: DatabaseCompactionOperation;
  planId: string;
  generatedAt: string;
  databasePath: string;
  governanceRootDirectory: string;
  sourceFingerprint: DatabaseCompactionFingerprint;
  maintenanceFingerprintHash: string;
}

export interface DatabaseCompactionManifest extends DatabaseCompactionManifestUnsigned {
  manifestHash: string;
  confirmationToken: string;
}

export interface PrepareDatabaseCompactionManifestOptions {
  databasePath: string;
  operation: DatabaseCompactionOperation;
  governanceRootDirectory?: string;
  planId?: string;
  now?: Date;
}

export type DatabaseCompactionAuditStatus =
  | 'preparing'
  | 'running'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface IncrementalVacuumPhysicalState {
  pageCount: number;
  freelistCount: number;
}

export interface IncrementalVacuumAudit {
  version: typeof DATABASE_COMPACTION_AUDIT_VERSION;
  operation: 'incremental-vacuum';
  planId: string;
  manifestHash: string;
  databasePath: string;
  auditPath: string;
  status: DatabaseCompactionAuditStatus;
  stopReason?: 'signal' | 'time-budget' | 'page-budget' | 'freelist-empty' | 'no-progress';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  limits: { pageBudget: number; batchPages: number };
  progress: {
    initial: IncrementalVacuumPhysicalState;
    current: IncrementalVacuumPhysicalState;
    pagesRequested: number;
    pagesFreed: number;
    freelistPagesConsumed: number;
    batchesCommitted: number;
    pendingBatch?: { requestedPages: number; before: IncrementalVacuumPhysicalState };
  };
  auditHash: string;
}

export interface ExecuteIncrementalVacuumOptions {
  manifest: DatabaseCompactionManifest;
  confirmationToken: string;
  maintenanceWindowConfirmed: boolean;
  auditPath?: string;
  pageBudget: number;
  batchPages?: number;
  timeBudgetMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
  signal?: AbortSignal;
  onBatchDatabaseCommitted?: (audit: IncrementalVacuumAudit) => void;
  onBatchCommitted?: (audit: IncrementalVacuumAudit) => void;
}

export interface OfflineCompactionVerification {
  quickCheck: 'ok';
  integrityCheck: 'ok';
  outputFingerprint: DatabaseCompactionFingerprint;
}

export interface OfflineCompactionAudit {
  version: typeof DATABASE_COMPACTION_AUDIT_VERSION;
  operation: 'offline-compaction';
  planId: string;
  manifestHash: string;
  databasePath: string;
  auditPath: string;
  status: DatabaseCompactionAuditStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  output: {
    path: string;
    bytes?: number;
    sha256?: string;
    verification?: OfflineCompactionVerification;
  };
  handoff: {
    sourceDatabasePath: string;
    compactedDatabasePath: string;
    sourceDatabasePreserved: true;
    automaticSwitchPerformed: false;
    switchRequiresOfflineMaintenanceWindow: true;
    rollbackDatabasePath: string;
  };
  auditHash: string;
}

export interface ExecuteOfflineDatabaseCompactionOptions {
  manifest: DatabaseCompactionManifest;
  confirmationToken: string;
  maintenanceWindowConfirmed: boolean;
  outputPath: string;
  auditPath?: string;
  now?: () => Date;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizedPath(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function samePath(left: string, right: string): boolean {
  return normalizedPath(left) === normalizedPath(right);
}

function assertSafePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function assertCanonicalTimestamp(value: string, label: string): void {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
}

function assertPathWithin(root: string, target: string, label: string): void {
  const pathFromRoot = relative(resolve(root), resolve(target));
  if (
    pathFromRoot === '' ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`${label} escaped its governed root directory`);
  }
}

function assertExistingPathChainIsPlain(path: string, label: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) break;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} contains a symlink, junction, or reparse-point component`);
    }
  }
}

function assertExistingDirectory(path: string, label: string): void {
  assertExistingPathChainIsPlain(path, label);
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(`${label} must be an existing directory`);
  }
}

function assertExistingPlainFile(path: string, label: string): void {
  assertExistingPathChainIsPlain(path, label);
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(`${label} must be an existing plain file`);
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function autoVacuumMode(code: number): DatabaseCompactionFingerprint['autoVacuum'] {
  if (code === 0) return { code: 0, mode: 'NONE' };
  if (code === 1) return { code: 1, mode: 'FULL' };
  if (code === 2) return { code: 2, mode: 'INCREMENTAL' };
  throw new Error(`database returned unsupported auto_vacuum mode: ${code}`);
}

function countAndHighWater(
  raw: BetterSQLite3Raw,
  tableName: 'event' | 'checkpoint',
): { count: number; highWater: DatabaseCompactionHighWater | null } {
  const sequenceColumn = tableName === 'event' ? 'sequence' : 'last_event_sequence';
  const count = raw.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  const highWater = raw
    .prepare(
      `SELECT ${sequenceColumn} AS sequence, id
       FROM ${tableName}
       ORDER BY ${sequenceColumn} DESC, id DESC
       LIMIT 1`,
    )
    .get() as { sequence: number; id: string } | undefined;
  return {
    count: Number(count.count),
    highWater: highWater ? { sequence: Number(highWater.sequence), id: String(highWater.id) } : null,
  };
}

function captureUserTableRowCounts(raw: BetterSQLite3Raw): DatabaseCompactionTableRowCount[] {
  const tables = raw
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
       ORDER BY name`,
    )
    .all() as Array<{ name: string }>;
  return tables.map(({ name }) => {
    const result = raw.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get() as {
      count: number;
    };
    return { tableName: name, rowCount: Number(result.count) };
  });
}

export function captureDatabaseCompactionFingerprint(
  raw: BetterSQLite3Raw,
): DatabaseCompactionFingerprint {
  const schemaRows = raw
    .prepare(
      `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema
       ORDER BY type, name, tbl_name`,
    )
    .all() as Array<{ type: string; name: string; tableName: string; sql: string | null }>;
  return {
    schemaVersion: Number(raw.pragma('schema_version', { simple: true })),
    schemaHash: hashJson(schemaRows),
    userVersion: Number(raw.pragma('user_version', { simple: true })),
    pageSize: Number(raw.pragma('page_size', { simple: true })),
    pageCount: Number(raw.pragma('page_count', { simple: true })),
    freelistCount: Number(raw.pragma('freelist_count', { simple: true })),
    autoVacuum: autoVacuumMode(Number(raw.pragma('auto_vacuum', { simple: true }))),
    event: countAndHighWater(raw, 'event'),
    checkpoint: countAndHighWater(raw, 'checkpoint'),
    userTableRowCounts: captureUserTableRowCounts(raw),
  };
}

function logicalFingerprint(fingerprint: DatabaseCompactionFingerprint): unknown {
  return {
    schemaVersion: fingerprint.schemaVersion,
    schemaHash: fingerprint.schemaHash,
    userVersion: fingerprint.userVersion,
    pageSize: fingerprint.pageSize,
    autoVacuum: fingerprint.autoVacuum,
    event: fingerprint.event,
    checkpoint: fingerprint.checkpoint,
    userTableRowCounts: fingerprint.userTableRowCounts,
  };
}

function assertLogicalFingerprintMatches(
  actual: DatabaseCompactionFingerprint,
  expected: DatabaseCompactionFingerprint,
  label: string,
): void {
  if (hashJson(logicalFingerprint(actual)) !== hashJson(logicalFingerprint(expected))) {
    throw new Error(`${label} schema, high-water, or row-count projection drifted after prepare`);
  }
}

function assertExactFingerprintMatches(
  actual: DatabaseCompactionFingerprint,
  expected: DatabaseCompactionFingerprint,
  label: string,
): void {
  if (hashJson(actual) !== hashJson(expected)) {
    throw new Error(`${label} maintenance fingerprint drifted after prepare`);
  }
}

function manifestUnsigned(manifest: DatabaseCompactionManifest): DatabaseCompactionManifestUnsigned {
  const unsigned = { ...manifest } as Partial<DatabaseCompactionManifest>;
  delete unsigned.manifestHash;
  delete unsigned.confirmationToken;
  return unsigned as DatabaseCompactionManifestUnsigned;
}

export function expectedDatabaseCompactionConfirmationToken(
  manifest: Pick<DatabaseCompactionManifest, 'operation' | 'planId' | 'manifestHash'>,
): string {
  const operation =
    manifest.operation === 'incremental-vacuum' ? 'INCREMENTAL-VACUUM' : 'OFFLINE-COMPACTION';
  return `EXECUTE-${operation}:${manifest.planId}:${manifest.manifestHash.slice(0, 16)}`;
}

export function assertDatabaseCompactionManifestIntegrity(
  manifest: DatabaseCompactionManifest,
): void {
  if (manifest.version !== DATABASE_COMPACTION_MANIFEST_VERSION) {
    throw new Error('database compaction manifest version is unsupported');
  }
  if (manifest.operation !== 'incremental-vacuum' && manifest.operation !== 'offline-compaction') {
    throw new Error('database compaction manifest operation is invalid');
  }
  if (!SAFE_PLAN_ID.test(manifest.planId)) {
    throw new Error('database compaction manifest planId is invalid');
  }
  assertCanonicalTimestamp(manifest.generatedAt, 'database compaction manifest generatedAt');
  if (!isAbsolute(manifest.databasePath) || !isAbsolute(manifest.governanceRootDirectory)) {
    throw new Error('database compaction manifest paths must be absolute');
  }
  assertPathWithin(
    manifest.governanceRootDirectory,
    manifest.databasePath,
    'database compaction source path',
  );
  if (!SHA256.test(manifest.sourceFingerprint.schemaHash)) {
    throw new Error('database compaction manifest schema hash is invalid');
  }
  if (hashJson(manifest.sourceFingerprint) !== manifest.maintenanceFingerprintHash) {
    throw new Error('database compaction maintenance fingerprint hash mismatch');
  }
  if (!SHA256.test(manifest.maintenanceFingerprintHash)) {
    throw new Error('database compaction maintenance fingerprint hash is invalid');
  }
  const tableNames = manifest.sourceFingerprint.userTableRowCounts.map((row) => row.tableName);
  if (
    new Set(tableNames).size !== tableNames.length ||
    [...tableNames].sort((left, right) => left.localeCompare(right)).join('\0') !== tableNames.join('\0')
  ) {
    throw new Error('database compaction user-table projection is not unique and sorted');
  }
  for (const row of manifest.sourceFingerprint.userTableRowCounts) {
    if (!row.tableName || !Number.isSafeInteger(row.rowCount) || row.rowCount < 0) {
      throw new Error('database compaction user-table projection is invalid');
    }
  }
  const expectedHash = hashJson(manifestUnsigned(manifest));
  if (manifest.manifestHash !== expectedHash || !SHA256.test(manifest.manifestHash)) {
    throw new Error('database compaction manifest hash mismatch');
  }
  if (manifest.confirmationToken !== expectedDatabaseCompactionConfirmationToken(manifest)) {
    throw new Error('database compaction manifest confirmation token mismatch');
  }
}

function assertDatabaseIdentity(raw: BetterSQLite3Raw, expectedPath: string): void {
  const main = (raw.pragma('database_list') as Array<{ name: string; file: string }>).find(
    (entry) => entry.name === 'main',
  );
  if (!main?.file || !samePath(main.file, expectedPath)) {
    throw new Error('database compaction connection does not match the manifest database path');
  }
}

function assertWritableMaintenanceConnection(
  raw: BetterSQLite3Raw,
  manifest: DatabaseCompactionManifest,
): void {
  assertDatabaseIdentity(raw, manifest.databasePath);
  if (Number(raw.pragma('query_only', { simple: true })) !== 0) {
    throw new Error('database compaction execution requires a writable connection');
  }
  if (raw.inTransaction) {
    throw new Error('database compaction execution cannot start inside a transaction');
  }
}

export async function prepareDatabaseCompactionManifest(
  options: PrepareDatabaseCompactionManifestOptions,
): Promise<DatabaseCompactionManifest> {
  const databasePath = resolve(options.databasePath);
  const governanceRootDirectory = resolve(
    options.governanceRootDirectory ?? dirname(databasePath),
  );
  const now = options.now ?? new Date();
  const planId =
    options.planId ??
    `compaction-${now.toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  if (!SAFE_PLAN_ID.test(planId)) throw new Error('database compaction planId is invalid');
  if (options.operation !== 'incremental-vacuum' && options.operation !== 'offline-compaction') {
    throw new Error('database compaction operation is invalid');
  }
  assertExistingDirectory(governanceRootDirectory, 'database compaction governance root');
  assertPathWithin(governanceRootDirectory, databasePath, 'database compaction source path');
  assertExistingPlainFile(databasePath, 'database compaction source database');

  const { raw } = await openDatabaseAsync({ path: databasePath, readonly: true, fileMustExist: true });
  try {
    if (Number(raw.pragma('query_only', { simple: true })) !== 1) {
      throw new Error('database compaction prepare requires a query-only connection');
    }
    assertDatabaseIdentity(raw, databasePath);
    const sourceFingerprint = captureDatabaseCompactionFingerprint(raw);
    const unsigned: DatabaseCompactionManifestUnsigned = {
      version: DATABASE_COMPACTION_MANIFEST_VERSION,
      operation: options.operation,
      planId,
      generatedAt: now.toISOString(),
      databasePath,
      governanceRootDirectory,
      sourceFingerprint,
      maintenanceFingerprintHash: hashJson(sourceFingerprint),
    };
    const manifestHash = hashJson(unsigned);
    const manifest: DatabaseCompactionManifest = {
      ...unsigned,
      manifestHash,
      confirmationToken: '',
    };
    manifest.confirmationToken = expectedDatabaseCompactionConfirmationToken(manifest);
    assertDatabaseCompactionManifestIntegrity(manifest);
    return manifest;
  } finally {
    raw.close();
  }
}

export function writeDatabaseCompactionManifest(
  path: string,
  manifest: DatabaseCompactionManifest,
): void {
  assertDatabaseCompactionManifestIntegrity(manifest);
  atomicWriteJson(
    path,
    manifest,
    manifest.governanceRootDirectory,
    'database compaction manifest path',
  );
}

export function readDatabaseCompactionManifest(path: string): DatabaseCompactionManifest {
  const absolute = resolve(path);
  assertExistingPlainFile(absolute, 'database compaction manifest');
  const manifest = JSON.parse(readFileSync(absolute, 'utf8')) as DatabaseCompactionManifest;
  assertDatabaseCompactionManifestIntegrity(manifest);
  assertPathWithin(
    manifest.governanceRootDirectory,
    absolute,
    'database compaction manifest path',
  );
  return manifest;
}

function atomicWriteJson(path: string, value: unknown, root: string, label: string): void {
  const absolute = resolve(path);
  assertPathWithin(root, absolute, label);
  assertExistingDirectory(dirname(absolute), `${label} directory`);
  assertExistingPathChainIsPlain(absolute, label);
  if (existsSync(absolute) && !lstatSync(absolute).isFile()) {
    throw new Error(`${label} is not a plain file`);
  }
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  assertPathWithin(root, temporary, `${label} temporary path`);
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, undefined, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    assertExistingPathChainIsPlain(absolute, label);
    renameSync(temporary, absolute);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function auditUnsigned<T extends IncrementalVacuumAudit | OfflineCompactionAudit>(
  audit: T,
): Omit<T, 'auditHash'> {
  const unsigned = { ...audit } as Partial<T>;
  delete unsigned.auditHash;
  return unsigned as Omit<T, 'auditHash'>;
}

function refreshAuditHash<T extends IncrementalVacuumAudit | OfflineCompactionAudit>(audit: T): T {
  audit.auditHash = hashJson(auditUnsigned(audit));
  return audit;
}

function persistAudit(
  audit: IncrementalVacuumAudit | OfflineCompactionAudit,
  root: string,
): void {
  refreshAuditHash(audit);
  atomicWriteJson(audit.auditPath, audit, root, 'database compaction audit path');
}

function assertAuditHash(audit: IncrementalVacuumAudit | OfflineCompactionAudit): void {
  if (!SHA256.test(audit.auditHash) || audit.auditHash !== hashJson(auditUnsigned(audit))) {
    throw new Error('database compaction audit hash mismatch');
  }
}

function readAuditFile(path: string, root: string): IncrementalVacuumAudit | OfflineCompactionAudit {
  const absolute = resolve(path);
  assertPathWithin(root, absolute, 'database compaction audit path');
  assertExistingPlainFile(absolute, 'database compaction audit');
  const audit = JSON.parse(readFileSync(absolute, 'utf8')) as
    | IncrementalVacuumAudit
    | OfflineCompactionAudit;
  assertAuditHash(audit);
  return audit;
}

function validateAuditCommon(
  audit: IncrementalVacuumAudit | OfflineCompactionAudit,
  manifest: DatabaseCompactionManifest,
  auditPath: string,
): void {
  if (audit.version !== DATABASE_COMPACTION_AUDIT_VERSION) {
    throw new Error('database compaction audit version is unsupported');
  }
  assertAuditHash(audit);
  if (
    audit.planId !== manifest.planId ||
    audit.manifestHash !== manifest.manifestHash ||
    !samePath(audit.databasePath, manifest.databasePath) ||
    !samePath(audit.auditPath, auditPath)
  ) {
    throw new Error('database compaction audit does not match the manifest or requested path');
  }
  assertCanonicalTimestamp(audit.startedAt, 'database compaction audit startedAt');
  assertCanonicalTimestamp(audit.updatedAt, 'database compaction audit updatedAt');
  if (audit.completedAt !== undefined) {
    assertCanonicalTimestamp(audit.completedAt, 'database compaction audit completedAt');
  }
  if (audit.status === 'completed' && audit.completedAt === undefined) {
    throw new Error('completed database compaction audit is missing completedAt');
  }
  if (audit.status !== 'completed' && audit.completedAt !== undefined) {
    throw new Error('incomplete database compaction audit unexpectedly has completedAt');
  }
}

function physicalState(fingerprint: DatabaseCompactionFingerprint): IncrementalVacuumPhysicalState {
  return { pageCount: fingerprint.pageCount, freelistCount: fingerprint.freelistCount };
}

function samePhysicalState(
  left: IncrementalVacuumPhysicalState,
  right: IncrementalVacuumPhysicalState,
): boolean {
  return left.pageCount === right.pageCount && left.freelistCount === right.freelistCount;
}

function defaultIncrementalAuditPath(manifest: DatabaseCompactionManifest): string {
  return resolve(
    manifest.governanceRootDirectory,
    `${manifest.planId}.incremental-vacuum.audit.json`,
  );
}

function validateIncrementalAudit(
  audit: IncrementalVacuumAudit,
  manifest: DatabaseCompactionManifest,
  auditPath: string,
  pageBudget: number,
  batchPages: number,
): void {
  validateAuditCommon(audit, manifest, auditPath);
  if (audit.operation !== 'incremental-vacuum') {
    throw new Error('database compaction audit operation mismatch');
  }
  if (audit.limits.pageBudget !== pageBudget || audit.limits.batchPages !== batchPages) {
    throw new Error('incremental vacuum resume limits do not match the durable audit');
  }
  for (const value of [
    audit.progress.initial.pageCount,
    audit.progress.initial.freelistCount,
    audit.progress.current.pageCount,
    audit.progress.current.freelistCount,
    audit.progress.pagesRequested,
    audit.progress.pagesFreed,
    audit.progress.freelistPagesConsumed,
    audit.progress.batchesCommitted,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('incremental vacuum audit progress is invalid');
    }
  }
  if (audit.progress.pagesRequested > pageBudget) {
    throw new Error('incremental vacuum audit exceeded its page budget');
  }
  if (audit.progress.pendingBatch) {
    assertSafePositiveInteger(
      audit.progress.pendingBatch.requestedPages,
      'incremental vacuum pending batch requestedPages',
    );
    if (!samePhysicalState(audit.progress.pendingBatch.before, audit.progress.current)) {
      throw new Error('incremental vacuum pending batch does not begin at the audited current state');
    }
  }
}

function updateIncrementalAudit(
  audit: IncrementalVacuumAudit,
  root: string,
  now: () => Date,
  update: (value: IncrementalVacuumAudit) => void,
): void {
  update(audit);
  audit.updatedAt = now().toISOString();
  persistAudit(audit, root);
}

function reconcilePendingIncrementalBatch(
  raw: BetterSQLite3Raw,
  manifest: DatabaseCompactionManifest,
  audit: IncrementalVacuumAudit,
  now: () => Date,
): void {
  const pending = audit.progress.pendingBatch;
  if (!pending) return;
  const current = captureDatabaseCompactionFingerprint(raw);
  assertLogicalFingerprintMatches(current, manifest.sourceFingerprint, 'incremental vacuum source');
  const currentPhysical = physicalState(current);
  if (
    currentPhysical.pageCount > pending.before.pageCount ||
    currentPhysical.freelistCount > pending.before.freelistCount
  ) {
    throw new Error('incremental vacuum pending batch physical state drifted unexpectedly');
  }
  updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
    if (!samePhysicalState(currentPhysical, pending.before)) {
      value.progress.pagesRequested += pending.requestedPages;
      value.progress.pagesFreed += pending.before.pageCount - currentPhysical.pageCount;
      value.progress.freelistPagesConsumed +=
        pending.before.freelistCount - currentPhysical.freelistCount;
      value.progress.batchesCommitted += 1;
      value.progress.current = currentPhysical;
    }
    delete value.progress.pendingBatch;
  });
}

export async function executeIncrementalVacuum(
  raw: BetterSQLite3Raw,
  options: ExecuteIncrementalVacuumOptions,
): Promise<IncrementalVacuumAudit> {
  const manifest = options.manifest;
  assertDatabaseCompactionManifestIntegrity(manifest);
  if (manifest.operation !== 'incremental-vacuum') {
    throw new Error('database compaction manifest is not for incremental vacuum');
  }
  if (!options.maintenanceWindowConfirmed) {
    throw new Error('incremental vacuum requires an explicit offline maintenance window');
  }
  if (options.confirmationToken !== expectedDatabaseCompactionConfirmationToken(manifest)) {
    throw new Error('incremental vacuum explicit confirmation did not match');
  }
  assertSafePositiveInteger(options.pageBudget, 'incremental vacuum pageBudget');
  const batchPages = options.batchPages ?? DEFAULT_INCREMENTAL_VACUUM_BATCH_PAGES;
  assertSafePositiveInteger(batchPages, 'incremental vacuum batchPages');
  if (batchPages > MAX_INCREMENTAL_VACUUM_BATCH_PAGES) {
    throw new Error('incremental vacuum batchPages exceeds the supported maximum');
  }
  if (
    options.timeBudgetMs !== undefined &&
    (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs <= 0)
  ) {
    throw new Error('incremental vacuum timeBudgetMs must be positive and finite');
  }
  assertWritableMaintenanceConnection(raw, manifest);
  if (manifest.sourceFingerprint.autoVacuum.mode !== 'INCREMENTAL') {
    throw new Error('incremental vacuum requires auto_vacuum=INCREMENTAL at prepare time');
  }
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const startedMonotonic = monotonicNow();
  const auditPath = resolve(options.auditPath ?? defaultIncrementalAuditPath(manifest));
  assertPathWithin(
    manifest.governanceRootDirectory,
    auditPath,
    'incremental vacuum audit path',
  );
  assertExistingDirectory(dirname(auditPath), 'incremental vacuum audit directory');

  let audit: IncrementalVacuumAudit;
  if (existsSync(auditPath)) {
    const existing = readAuditFile(auditPath, manifest.governanceRootDirectory);
    if (existing.operation !== 'incremental-vacuum') {
      throw new Error('incremental vacuum audit operation mismatch');
    }
    audit = existing;
    validateIncrementalAudit(audit, manifest, auditPath, options.pageBudget, batchPages);
    reconcilePendingIncrementalBatch(raw, manifest, audit, now);
    const current = captureDatabaseCompactionFingerprint(raw);
    assertLogicalFingerprintMatches(current, manifest.sourceFingerprint, 'incremental vacuum source');
    if (!samePhysicalState(physicalState(current), audit.progress.current)) {
      throw new Error('incremental vacuum physical state drifted from the durable audit');
    }
    if (audit.status === 'completed') return audit;
  } else {
    const current = captureDatabaseCompactionFingerprint(raw);
    assertExactFingerprintMatches(current, manifest.sourceFingerprint, 'incremental vacuum source');
    const timestamp = now().toISOString();
    audit = refreshAuditHash({
      version: DATABASE_COMPACTION_AUDIT_VERSION,
      operation: 'incremental-vacuum',
      planId: manifest.planId,
      manifestHash: manifest.manifestHash,
      databasePath: manifest.databasePath,
      auditPath,
      status: 'preparing',
      startedAt: timestamp,
      updatedAt: timestamp,
      limits: { pageBudget: options.pageBudget, batchPages },
      progress: {
        initial: physicalState(current),
        current: physicalState(current),
        pagesRequested: 0,
        pagesFreed: 0,
        freelistPagesConsumed: 0,
        batchesCommitted: 0,
      },
      auditHash: '',
    });
    persistAudit(audit, manifest.governanceRootDirectory);
  }

  try {
    updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
      value.status = 'running';
      delete value.error;
      delete value.stopReason;
    });
    while (audit.progress.pagesRequested < options.pageBudget) {
      if (options.signal?.aborted) {
        updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
          value.status = 'cancelled';
          value.stopReason = 'signal';
        });
        return audit;
      }
      if (
        options.timeBudgetMs !== undefined &&
        monotonicNow() - startedMonotonic >= options.timeBudgetMs
      ) {
        updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
          value.status = 'cancelled';
          value.stopReason = 'time-budget';
        });
        return audit;
      }
      if (audit.progress.current.freelistCount === 0) {
        updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
          value.status = 'completed';
          value.stopReason = 'freelist-empty';
          value.completedAt = now().toISOString();
        });
        return audit;
      }
      const requestedPages = Math.min(
        batchPages,
        options.pageBudget - audit.progress.pagesRequested,
        audit.progress.current.freelistCount,
      );
      const before = { ...audit.progress.current };
      updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
        value.progress.pendingBatch = { requestedPages, before };
      });
      raw.pragma(`incremental_vacuum(${requestedPages})`);
      const afterFingerprint = captureDatabaseCompactionFingerprint(raw);
      assertLogicalFingerprintMatches(
        afterFingerprint,
        manifest.sourceFingerprint,
        'incremental vacuum source',
      );
      const after = physicalState(afterFingerprint);
      if (after.pageCount > before.pageCount || after.freelistCount > before.freelistCount) {
        throw new Error('incremental vacuum increased page or freelist counts unexpectedly');
      }
      options.onBatchDatabaseCommitted?.(audit);
      const afterCallback = captureDatabaseCompactionFingerprint(raw);
      assertLogicalFingerprintMatches(
        afterCallback,
        manifest.sourceFingerprint,
        'incremental vacuum source',
      );
      if (!samePhysicalState(physicalState(afterCallback), after)) {
        throw new Error('incremental vacuum physical state changed inside the batch callback');
      }
      updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
        value.progress.pagesRequested += requestedPages;
        value.progress.pagesFreed += before.pageCount - after.pageCount;
        value.progress.freelistPagesConsumed += before.freelistCount - after.freelistCount;
        value.progress.batchesCommitted += 1;
        value.progress.current = after;
        delete value.progress.pendingBatch;
      });
      options.onBatchCommitted?.(audit);
      if (samePhysicalState(before, after)) {
        updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
          value.status = 'completed';
          value.stopReason = 'no-progress';
          value.completedAt = now().toISOString();
        });
        return audit;
      }
    }
    updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
      value.status = 'completed';
      value.stopReason = 'page-budget';
      value.completedAt = now().toISOString();
    });
    return audit;
  } catch (error) {
    updateIncrementalAudit(audit, manifest.governanceRootDirectory, now, (value) => {
      value.status = 'failed';
      value.error = error instanceof Error ? error.message : 'incremental vacuum failed';
    });
    throw error;
  }
}

function pragmaIntegrity(raw: BetterSQLite3Raw, pragma: 'quick_check(1)' | 'integrity_check'): 'ok' {
  const rows = raw.pragma(pragma) as Array<Record<string, unknown>>;
  const values = rows.flatMap((row) => Object.values(row)).map(String);
  if (values.length !== 1 || values[0]?.toLowerCase() !== 'ok') {
    throw new Error(`database ${pragma} failed: ${values.join('; ')}`);
  }
  return 'ok';
}

async function hashFile(path: string): Promise<{ bytes: number; sha256: string }> {
  assertExistingPlainFile(path, 'compacted database output');
  const before = statSync(path);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    hash.update(buffer);
  }
  const after = statSync(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes !== after.size) {
    throw new Error('compacted database output changed while it was being hashed');
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function verifyCompactedDatabase(
  path: string,
  source: DatabaseCompactionFingerprint,
): Promise<OfflineCompactionVerification> {
  const { raw } = await openDatabaseAsync({ path, readonly: true, fileMustExist: true });
  try {
    if (Number(raw.pragma('query_only', { simple: true })) !== 1) {
      throw new Error('compacted database verification requires a query-only connection');
    }
    const quickCheck = pragmaIntegrity(raw, 'quick_check(1)');
    const integrityCheck = pragmaIntegrity(raw, 'integrity_check');
    const outputFingerprint = captureDatabaseCompactionFingerprint(raw);
    const normalizedOutputFingerprint = {
      ...outputFingerprint,
      schemaVersion: source.schemaVersion,
    };
    assertLogicalFingerprintMatches(
      normalizedOutputFingerprint,
      source,
      'compacted database output',
    );
    if (
      outputFingerprint.schemaVersion !== source.schemaVersion + 1 ||
      outputFingerprint.userVersion !== source.userVersion
    ) {
      throw new Error(
        'compacted database schema version did not reflect VACUUM and user version did not match',
      );
    }
    return { quickCheck, integrityCheck, outputFingerprint };
  } finally {
    raw.close();
  }
}

function defaultOfflineAuditPath(outputPath: string): string {
  return `${outputPath}.audit.json`;
}

function validateOfflineAudit(
  audit: OfflineCompactionAudit,
  manifest: DatabaseCompactionManifest,
  auditPath: string,
  outputPath: string,
): void {
  validateAuditCommon(audit, manifest, auditPath);
  if (audit.operation !== 'offline-compaction') {
    throw new Error('offline compaction audit operation mismatch');
  }
  if (!samePath(audit.output.path, outputPath)) {
    throw new Error('offline compaction audit output path mismatch');
  }
  if (
    !samePath(audit.handoff.sourceDatabasePath, manifest.databasePath) ||
    !samePath(audit.handoff.compactedDatabasePath, outputPath) ||
    !samePath(audit.handoff.rollbackDatabasePath, manifest.databasePath) ||
    audit.handoff.sourceDatabasePreserved !== true ||
    audit.handoff.automaticSwitchPerformed !== false ||
    audit.handoff.switchRequiresOfflineMaintenanceWindow !== true
  ) {
    throw new Error('offline compaction handoff metadata is invalid');
  }
  if (audit.status === 'completed') {
    if (
      !Number.isSafeInteger(audit.output.bytes) ||
      (audit.output.bytes ?? 0) <= 0 ||
      !audit.output.sha256 ||
      !SHA256.test(audit.output.sha256) ||
      !audit.output.verification
    ) {
      throw new Error('completed offline compaction audit output metadata is invalid');
    }
  }
}

function updateOfflineAudit(
  audit: OfflineCompactionAudit,
  root: string,
  now: () => Date,
  update: (value: OfflineCompactionAudit) => void,
): void {
  update(audit);
  audit.updatedAt = now().toISOString();
  persistAudit(audit, root);
}

export async function executeOfflineDatabaseCompaction(
  raw: BetterSQLite3Raw,
  options: ExecuteOfflineDatabaseCompactionOptions,
): Promise<OfflineCompactionAudit> {
  const manifest = options.manifest;
  assertDatabaseCompactionManifestIntegrity(manifest);
  if (manifest.operation !== 'offline-compaction') {
    throw new Error('database compaction manifest is not for offline compaction');
  }
  if (!options.maintenanceWindowConfirmed) {
    throw new Error('offline compaction requires an explicit offline maintenance window');
  }
  if (options.confirmationToken !== expectedDatabaseCompactionConfirmationToken(manifest)) {
    throw new Error('offline compaction explicit confirmation did not match');
  }
  assertWritableMaintenanceConnection(raw, manifest);
  const outputPath = resolve(options.outputPath);
  const auditPath = resolve(options.auditPath ?? defaultOfflineAuditPath(outputPath));
  assertPathWithin(
    manifest.governanceRootDirectory,
    outputPath,
    'offline compaction output path',
  );
  assertPathWithin(
    manifest.governanceRootDirectory,
    auditPath,
    'offline compaction audit path',
  );
  if (samePath(outputPath, manifest.databasePath) || samePath(auditPath, manifest.databasePath)) {
    throw new Error('offline compaction output and audit must not replace the source database');
  }
  if (samePath(outputPath, auditPath)) {
    throw new Error('offline compaction output and audit paths must be different');
  }
  assertExistingDirectory(dirname(outputPath), 'offline compaction output directory');
  assertExistingDirectory(dirname(auditPath), 'offline compaction audit directory');
  assertExistingPathChainIsPlain(outputPath, 'offline compaction output path');
  assertExistingPathChainIsPlain(auditPath, 'offline compaction audit path');
  if (existsSync(outputPath)) {
    throw new Error('offline compaction refuses to overwrite an existing output');
  }
  if (existsSync(auditPath)) {
    const existing = readAuditFile(auditPath, manifest.governanceRootDirectory);
    if (existing.operation !== 'offline-compaction') {
      throw new Error('offline compaction audit operation mismatch');
    }
    validateOfflineAudit(existing, manifest, auditPath, outputPath);
    throw new Error('offline compaction refuses to overwrite an existing audit');
  }
  const sourceBefore = captureDatabaseCompactionFingerprint(raw);
  assertExactFingerprintMatches(sourceBefore, manifest.sourceFingerprint, 'offline compaction source');
  const now = options.now ?? (() => new Date());
  const timestamp = now().toISOString();
  const audit = refreshAuditHash({
    version: DATABASE_COMPACTION_AUDIT_VERSION,
    operation: 'offline-compaction',
    planId: manifest.planId,
    manifestHash: manifest.manifestHash,
    databasePath: manifest.databasePath,
    auditPath,
    status: 'preparing',
    startedAt: timestamp,
    updatedAt: timestamp,
    output: { path: outputPath },
    handoff: {
      sourceDatabasePath: manifest.databasePath,
      compactedDatabasePath: outputPath,
      sourceDatabasePreserved: true,
      automaticSwitchPerformed: false,
      switchRequiresOfflineMaintenanceWindow: true,
      rollbackDatabasePath: manifest.databasePath,
    },
    auditHash: '',
  });
  persistAudit(audit, manifest.governanceRootDirectory);
  try {
    updateOfflineAudit(audit, manifest.governanceRootDirectory, now, (value) => {
      value.status = 'running';
    });
    raw.exec(`VACUUM INTO ${quoteSqlString(outputPath)}`);
    assertExistingPlainFile(outputPath, 'offline compaction output');
    const sourceAfter = captureDatabaseCompactionFingerprint(raw);
    assertExactFingerprintMatches(sourceAfter, manifest.sourceFingerprint, 'offline compaction source');
    const verification = await verifyCompactedDatabase(outputPath, manifest.sourceFingerprint);
    const stored = await hashFile(outputPath);
    updateOfflineAudit(audit, manifest.governanceRootDirectory, now, (value) => {
      value.status = 'completed';
      value.completedAt = now().toISOString();
      value.output.bytes = stored.bytes;
      value.output.sha256 = stored.sha256;
      value.output.verification = verification;
    });
    return audit;
  } catch (error) {
    updateOfflineAudit(audit, manifest.governanceRootDirectory, now, (value) => {
      value.status = 'failed';
      value.error = error instanceof Error ? error.message : 'offline compaction failed';
    });
    throw error;
  }
}

export async function verifyOfflineDatabaseCompactionResult(
  manifest: DatabaseCompactionManifest,
  auditPath: string,
): Promise<OfflineCompactionAudit> {
  assertDatabaseCompactionManifestIntegrity(manifest);
  if (manifest.operation !== 'offline-compaction') {
    throw new Error('database compaction manifest is not for offline compaction');
  }
  const absoluteAuditPath = resolve(auditPath);
  const audit = readAuditFile(absoluteAuditPath, manifest.governanceRootDirectory);
  if (audit.operation !== 'offline-compaction') {
    throw new Error('offline compaction audit operation mismatch');
  }
  validateOfflineAudit(audit, manifest, absoluteAuditPath, audit.output.path);
  if (audit.status !== 'completed') {
    throw new Error('offline compaction audit is not completed');
  }
  assertPathWithin(
    manifest.governanceRootDirectory,
    audit.output.path,
    'offline compaction output path',
  );
  assertExistingPlainFile(audit.output.path, 'offline compaction output');
  const stored = await hashFile(audit.output.path);
  if (stored.bytes !== audit.output.bytes || stored.sha256 !== audit.output.sha256) {
    throw new Error('offline compaction output bytes or hash mismatch');
  }
  const verification = await verifyCompactedDatabase(
    audit.output.path,
    manifest.sourceFingerprint,
  );
  if (hashJson(verification) !== hashJson(audit.output.verification)) {
    throw new Error('offline compaction output verification projection mismatch');
  }
  return audit;
}
