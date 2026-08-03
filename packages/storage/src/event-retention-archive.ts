import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import { isGlobalTelemetryCandidateIdentity } from './database-governance.js';
import { captureDatabaseMaintenanceFingerprint, type DatabaseMaintenanceFingerprint } from './database-maintenance-executor.js';

export const EVENT_RETENTION_ARCHIVE_MANIFEST_VERSION = 1 as const;
export const EVENT_RETENTION_ARCHIVE_SELECTOR_VERSION = 1 as const;
export const EVENT_RETENTION_ARCHIVE_SEGMENT_VERSION = 1 as const;
export const EVENT_RETENTION_ARCHIVE_AUDIT_VERSION = 1 as const;
export const EVENT_RETENTION_ROLLBACK_AUDIT_VERSION = 1 as const;
export const DEFAULT_EVENT_RETENTION_ARCHIVE_BATCH_SIZE = 500;
export const MAX_EVENT_RETENTION_ARCHIVE_BATCH_SIZE = 5_000;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MANIFEST_FILE = 'manifest.json';
const SEGMENT_FILE = 'events.jsonl.gz';
const DESCRIPTOR_FILE = 'segment.json';
const EXECUTE_AUDIT_FILE = 'execute.audit.json';
const ROLLBACK_AUDIT_FILE = 'rollback.audit.json';

export interface EventRetentionArchiveRow {
  id: string; workspaceId: string; taskId: string | null; runId: string | null;
  stepId: string | null; messageId: string | null; category: string; type: string;
  sequence: number; occurredAt: string; payloadJson: string;
}
export interface EventRetentionArchiveRowDescriptor {
  id: string; workspaceId: string; category: string; type: string; sequence: number;
  occurredAt: string; payloadByteLength: number; payloadSha256: string;
  fullRowByteLength: number; fullRowSha256: string;
}
export interface EventRetentionArchiveHighWaterFence { sequence: number; id: string; fullRowSha256: string }
export interface EventRetentionArchiveManifest {
  version: typeof EVENT_RETENTION_ARCHIVE_MANIFEST_VERSION;
  selectorVersion: typeof EVENT_RETENTION_ARCHIVE_SELECTOR_VERSION;
  archiveId: string; generatedAt: string; databasePath: string; archiveRootDirectory: string;
  sourceFingerprint: DatabaseMaintenanceFingerprint; schemaHash: string; cutoff: string;
  budget: { maxRows: number; maxBytes: number };
  highWaterFence: EventRetentionArchiveHighWaterFence | null;
  protectedEventCount: number; protectedEventSetHash: string;
  rows: EventRetentionArchiveRowDescriptor[];
  totals: { rowCount: number; payloadBytes: number; fullRowBytes: number };
  manifestHash: string; confirmationToken: string; rollbackToken: string;
}
export interface EventRetentionArchiveSegmentDescriptor {
  version: typeof EVENT_RETENTION_ARCHIVE_SEGMENT_VERSION; relativePath: typeof SEGMENT_FILE;
  encoding: 'gzip-jsonl-utf8'; rowCount: number; uncompressedBytes: number;
  uncompressedSha256: string; storedBytes: number; storedSha256: string;
}
export type EventRetentionArchiveAuditStatus = 'preparing' | 'running' | 'cancelled' | 'completed' | 'failed';
export interface EventRetentionArchiveAudit {
  version: typeof EVENT_RETENTION_ARCHIVE_AUDIT_VERSION; operation: 'execute';
  archiveId: string; manifestHash: string; databasePath: string; archiveDirectory: string;
  auditPath: string; segment: EventRetentionArchiveSegmentDescriptor; status: EventRetentionArchiveAuditStatus;
  startedAt: string; updatedAt: string; completedAt?: string; error?: string;
  progress: { rowCount: number; nextRowIndex: number; rowsDeleted: number; batchesCommitted: number; pendingBatchEndIndex?: number };
  auditHash: string;
}
export interface EventRetentionRollbackAudit {
  version: typeof EVENT_RETENTION_ROLLBACK_AUDIT_VERSION; operation: 'rollback';
  archiveId: string; manifestHash: string; databasePath: string; archiveDirectory: string;
  auditPath: string; segment: EventRetentionArchiveSegmentDescriptor; status: EventRetentionArchiveAuditStatus;
  startedAt: string; updatedAt: string; completedAt?: string; error?: string;
  progress: { rowCount: number; nextRowIndex: number; rowsInserted: number; rowsAlreadyRestored: number; batchesCommitted: number; pendingBatchEndIndex?: number };
  auditHash: string;
}
export interface PrepareEventRetentionArchiveOptions {
  databasePath: string; archiveRootDirectory: string; cutoff: string; maxRows: number; maxBytes: number;
  archiveId?: string; now?: () => Date;
}
export interface ExecuteEventRetentionArchiveOptions {
  manifest: EventRetentionArchiveManifest; confirmationToken: string; maintenanceWindowConfirmed: boolean;
  auditPath?: string; batchSize?: number; now?: () => Date; signal?: AbortSignal;
  onBatchDatabaseCommitted?: (audit: EventRetentionArchiveAudit) => void;
  onBatchCommitted?: (audit: EventRetentionArchiveAudit) => void;
}
export interface RollbackEventRetentionArchiveOptions {
  manifest: EventRetentionArchiveManifest; rollbackToken: string; maintenanceWindowConfirmed: boolean;
  executeAuditPath?: string; auditPath?: string; batchSize?: number; now?: () => Date; signal?: AbortSignal;
  onBatchDatabaseCommitted?: (audit: EventRetentionRollbackAudit) => void;
  onBatchCommitted?: (audit: EventRetentionRollbackAudit) => void;
}
type RawEventRow = EventRetentionArchiveRow;

function hash(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex') }
function hashJson(value: unknown): string { return hash(Buffer.from(JSON.stringify(value), 'utf8')) }
function canonicalRow(row: EventRetentionArchiveRow): Buffer { return Buffer.from(JSON.stringify(row), 'utf8') }
function normalizeRow(row: RawEventRow): EventRetentionArchiveRow { return { ...row, sequence: Number(row.sequence) } }
function describeRow(row: EventRetentionArchiveRow): EventRetentionArchiveRowDescriptor {
  const payload = Buffer.from(row.payloadJson, 'utf8'); const full = canonicalRow(row);
  return { id: row.id, workspaceId: row.workspaceId, category: row.category, type: row.type,
    sequence: row.sequence, occurredAt: row.occurredAt, payloadByteLength: payload.byteLength,
    payloadSha256: hash(payload), fullRowByteLength: full.byteLength, fullRowSha256: hash(full) };
}
function samePath(a: string, b: string): boolean { return resolve(a).toLowerCase() === resolve(b).toLowerCase() }
function assertWithin(root: string, target: string): void {
  const r = resolve(root); const t = resolve(target); if (samePath(r, t)) return;
  if (!t.toLowerCase().startsWith(`${r}${r.endsWith(sep) ? '' : sep}`.toLowerCase())) throw new Error('event retention archive path escaped its governed directory');
}
function assertPlainDirectory(path: string, label: string): void {
  const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a plain directory without links or reparse points`);
}
function assertPlainFile(path: string, label: string): void {
  const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a plain file without links or reparse points`);
}
function assertSafeChain(path: string, label: string): void {
  const absolute = resolve(path); const root = parse(absolute).root; assertPlainDirectory(root, `${label} root`); let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) { current = join(current, part); if (!existsSync(current)) break; assertPlainDirectory(current, label) }
}
function positive(value: number, label: string): void { if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`event retention archive ${label} must be a positive safe integer`) }
function canonicalTimestamp(value: string, label: string): string {
  if (!CANONICAL_ISO.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`event retention archive ${label} must be a canonical ISO timestamp`);
  }
  return value;
}
function normalizeCutoff(value: string): string { return canonicalTimestamp(value, 'cutoff') }
function compareIdentity(left: { sequence: number; id: string }, right: { sequence: number; id: string }): number {
  if (left.sequence < right.sequence) return -1;
  if (left.sequence > right.sequence) return 1;
  return Buffer.compare(Buffer.from(left.id, 'utf8'), Buffer.from(right.id, 'utf8'));
}
function assertArchiveId(value: string): void { if (!SAFE_ID.test(value)) throw new Error('event retention archiveId is invalid') }
function directoryOf(m: EventRetentionArchiveManifest): string { assertArchiveId(m.archiveId); const path = resolve(m.archiveRootDirectory, m.archiveId); assertWithin(m.archiveRootDirectory, path); return path }
function pathsOf(m: EventRetentionArchiveManifest) { const directory = directoryOf(m); return { directory, manifest: resolve(directory, MANIFEST_FILE), segment: resolve(directory, SEGMENT_FILE), descriptor: resolve(directory, DESCRIPTOR_FILE), executeAudit: resolve(directory, EXECUTE_AUDIT_FILE), rollbackAudit: resolve(directory, ROLLBACK_AUDIT_FILE) } }
function atomicWrite(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true }); assertSafeChain(dirname(path), 'event retention archive output directory');
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`; const fd = openSync(temp, 'wx');
  try { writeSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, path); assertPlainFile(path, 'event retention archive output');
}
function atomicJson(path: string, value: unknown): void { atomicWrite(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')) }
function unsignedManifest(m: EventRetentionArchiveManifest): Omit<EventRetentionArchiveManifest, 'manifestHash' | 'confirmationToken' | 'rollbackToken'> {
  const unsigned: Partial<EventRetentionArchiveManifest> = { ...m }; delete unsigned.manifestHash; delete unsigned.confirmationToken; delete unsigned.rollbackToken;
  return unsigned as Omit<EventRetentionArchiveManifest, 'manifestHash' | 'confirmationToken' | 'rollbackToken'>;
}
export function expectedEventRetentionArchiveConfirmationToken(m: EventRetentionArchiveManifest): string { return `ARCHIVE-EVENT-RETENTION:${m.archiveId}:${m.manifestHash.slice(0, 16)}` }
export function expectedEventRetentionArchiveRollbackToken(m: EventRetentionArchiveManifest): string { return `ROLLBACK-EVENT-RETENTION:${m.archiveId}:${m.manifestHash.slice(0, 16)}` }
export function assertEventRetentionArchiveManifestIntegrity(m: EventRetentionArchiveManifest): void {
  assertArchiveId(m.archiveId); positive(m.budget.maxRows, 'maxRows'); positive(m.budget.maxBytes, 'maxBytes'); normalizeCutoff(m.cutoff);
  if (m.version !== 1 || m.selectorVersion !== 1 || resolve(m.databasePath) !== m.databasePath || resolve(m.archiveRootDirectory) !== m.archiveRootDirectory ||
      m.schemaHash !== m.sourceFingerprint.schemaHash || !SHA256.test(m.schemaHash) || !SHA256.test(m.protectedEventSetHash) ||
      !Number.isSafeInteger(m.protectedEventCount) || m.protectedEventCount < 0) throw new Error('event retention archive manifest metadata is invalid');
  canonicalTimestamp(m.generatedAt, 'generatedAt');
  if (m.highWaterFence !== null && (!Number.isSafeInteger(m.highWaterFence.sequence) || !m.highWaterFence.id || !SHA256.test(m.highWaterFence.fullRowSha256))) throw new Error('event retention archive high-water fence is invalid');
  let previous: EventRetentionArchiveRowDescriptor | undefined; let payloadBytes = 0; let fullRowBytes = 0; const ids = new Set<string>();
  for (const row of m.rows) {
    if (!row.id || !row.workspaceId || !row.category || !row.type || !Number.isSafeInteger(row.sequence) || !Number.isSafeInteger(row.payloadByteLength) || row.payloadByteLength < 0 ||
        !Number.isSafeInteger(row.fullRowByteLength) || row.fullRowByteLength <= 0 || !SHA256.test(row.payloadSha256) || !SHA256.test(row.fullRowSha256) ||
        !isGlobalTelemetryCandidateIdentity(row.category, row.type) || ids.has(row.id)) throw new Error('event retention archive row descriptor is invalid');
    canonicalTimestamp(row.occurredAt, 'row occurredAt');
    if (Date.parse(row.occurredAt) >= Date.parse(m.cutoff)) throw new Error('event retention archive row is not older than cutoff');
    if (m.highWaterFence === null || compareIdentity(row, m.highWaterFence) >= 0) throw new Error('event retention archive row crossed the high-water fence');
    if (previous && compareIdentity(row, previous) <= 0) throw new Error('event retention archive rows are not strictly ordered');
    ids.add(row.id); previous = row; payloadBytes += row.payloadByteLength; fullRowBytes += row.fullRowByteLength;
  }
  if (m.rows.length > m.budget.maxRows || fullRowBytes > m.budget.maxBytes || m.totals.rowCount !== m.rows.length || m.totals.payloadBytes !== payloadBytes || m.totals.fullRowBytes !== fullRowBytes) throw new Error('event retention archive totals do not match rows or budget');
  if (hashJson(unsignedManifest(m)) !== m.manifestHash) throw new Error('event retention archive manifest hash mismatch');
  if (m.confirmationToken !== expectedEventRetentionArchiveConfirmationToken(m) || m.rollbackToken !== expectedEventRetentionArchiveRollbackToken(m)) throw new Error('event retention archive token mismatch');
  directoryOf(m);
}
export function writeEventRetentionArchiveManifest(path: string, manifest: EventRetentionArchiveManifest): void { assertEventRetentionArchiveManifestIntegrity(manifest); atomicJson(resolve(path), manifest) }
export function readEventRetentionArchiveManifest(path: string): EventRetentionArchiveManifest { const absolute = resolve(path); assertPlainFile(absolute, 'event retention archive manifest'); const manifest = JSON.parse(readFileSync(absolute, 'utf8')) as EventRetentionArchiveManifest; assertEventRetentionArchiveManifestIntegrity(manifest); return manifest }

const EVENT_SELECT = `SELECT id, workspace_id AS workspaceId, task_id AS taskId, run_id AS runId,
 step_id AS stepId, message_id AS messageId, category, type, sequence,
 occurred_at AS occurredAt, payload_json AS payloadJson FROM event`;
function allRows(raw: BetterSQLite3Raw): IterableIterator<RawEventRow> { return raw.prepare(`${EVENT_SELECT} ORDER BY sequence ASC, id ASC`).iterate() as IterableIterator<RawEventRow> }
function rowById(raw: BetterSQLite3Raw, id: string): EventRetentionArchiveRow | undefined { const row = raw.prepare(`${EVENT_SELECT} WHERE id = ?`).get(id) as RawEventRow | undefined; return row ? normalizeRow(row) : undefined }
function highWater(raw: BetterSQLite3Raw): EventRetentionArchiveHighWaterFence | null { const row = raw.prepare(`${EVENT_SELECT} ORDER BY sequence DESC, id DESC LIMIT 1`).get() as RawEventRow | undefined; if (!row) return null; const normalized = normalizeRow(row); return { sequence: normalized.sequence, id: normalized.id, fullRowSha256: describeRow(normalized).fullRowSha256 } }
function protectedFingerprint(raw: BetterSQLite3Raw, selected: ReadonlySet<string>): { count: number; hash: string } {
  const digest = createHash('sha256'); let count = 0;
  for (const rawRow of allRows(raw)) { if (selected.has(rawRow.id)) continue; digest.update(describeRow(normalizeRow(rawRow)).fullRowSha256); digest.update('\n'); count += 1 }
  return { count, hash: digest.digest('hex') };
}
function candidates(raw: BetterSQLite3Raw, cutoff: string, fence: EventRetentionArchiveHighWaterFence | null, maxRows: number, maxBytes: number): EventRetentionArchiveRowDescriptor[] {
  if (!fence) return []; const selected: EventRetentionArchiveRowDescriptor[] = []; let bytes = 0; const cutoffMs = Date.parse(cutoff);
  for (const rawRow of allRows(raw)) { const row = normalizeRow(rawRow);
    if (row.taskId !== null || row.runId !== null || row.stepId !== null || row.messageId !== null || !isGlobalTelemetryCandidateIdentity(row.category, row.type)) continue;
    canonicalTimestamp(row.occurredAt, `candidate ${row.id} occurredAt`); const occurred = Date.parse(row.occurredAt);
    if (occurred >= cutoffMs || compareIdentity(row, fence) >= 0) continue;
    const descriptor = describeRow(row); if (selected.length >= maxRows || bytes + descriptor.fullRowByteLength > maxBytes) break; selected.push(descriptor); bytes += descriptor.fullRowByteLength;
  }
  return selected;
}
export async function prepareEventRetentionArchiveManifest(options: PrepareEventRetentionArchiveOptions): Promise<EventRetentionArchiveManifest> {
  positive(options.maxRows, 'maxRows'); positive(options.maxBytes, 'maxBytes'); const cutoff = normalizeCutoff(options.cutoff); const archiveId = options.archiveId ?? `event-retention-${randomUUID()}`; assertArchiveId(archiveId);
  const databasePath = resolve(options.databasePath); const archiveRootDirectory = resolve(options.archiveRootDirectory);
  const connection = await openDatabaseAsync({ path: databasePath, readonly: true, fileMustExist: true });
  try {
    if (Number(connection.raw.pragma('query_only', { simple: true })) !== 1) throw new Error('event retention archive prepare requires query_only');
    const sourceFingerprint = captureDatabaseMaintenanceFingerprint(connection.raw); const fence = highWater(connection.raw);
    const rows = candidates(connection.raw, cutoff, fence, options.maxRows, options.maxBytes); const protectedSet = protectedFingerprint(connection.raw, new Set(rows.map((row) => row.id)));
    const base = { version: 1 as const, selectorVersion: 1 as const, archiveId, generatedAt: (options.now ?? (() => new Date()))().toISOString(), databasePath, archiveRootDirectory,
      sourceFingerprint, schemaHash: sourceFingerprint.schemaHash, cutoff, budget: { maxRows: options.maxRows, maxBytes: options.maxBytes }, highWaterFence: fence,
      protectedEventCount: protectedSet.count, protectedEventSetHash: protectedSet.hash, rows,
      totals: { rowCount: rows.length, payloadBytes: rows.reduce((n, row) => n + row.payloadByteLength, 0), fullRowBytes: rows.reduce((n, row) => n + row.fullRowByteLength, 0) } };
    const manifestHash = hashJson(base); const manifest: EventRetentionArchiveManifest = { ...base, manifestHash,
      confirmationToken: `ARCHIVE-EVENT-RETENTION:${archiveId}:${manifestHash.slice(0, 16)}`, rollbackToken: `ROLLBACK-EVENT-RETENTION:${archiveId}:${manifestHash.slice(0, 16)}` };
    assertEventRetentionArchiveManifestIntegrity(manifest); return manifest;
  } finally { connection.raw.close() }
}
function assertRow(row: EventRetentionArchiveRow, descriptor: EventRetentionArchiveRowDescriptor): void { const actual = describeRow(row); if (hashJson(actual) !== hashJson(descriptor)) throw new Error(`event retention archive row identity changed for ${descriptor.id}`) }
function loadExactRows(raw: BetterSQLite3Raw, manifest: EventRetentionArchiveManifest): EventRetentionArchiveRow[] { return manifest.rows.map((descriptor) => { const row = rowById(raw, descriptor.id); if (!row) throw new Error(`event retention archive row is missing: ${descriptor.id}`); assertRow(row, descriptor); if (row.taskId !== null || row.runId !== null || row.stepId !== null || row.messageId !== null) throw new Error(`event retention archive row became scoped: ${descriptor.id}`); return row }) }
function buildSegment(rows: readonly EventRetentionArchiveRow[]): { compressed: Buffer; descriptor: EventRetentionArchiveSegmentDescriptor } {
  const plain = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8'); const compressed = gzipSync(plain, { level: 9 });
  return { compressed, descriptor: { version: 1, relativePath: SEGMENT_FILE, encoding: 'gzip-jsonl-utf8', rowCount: rows.length, uncompressedBytes: plain.byteLength, uncompressedSha256: hash(plain), storedBytes: compressed.byteLength, storedSha256: hash(compressed) } };
}
function verifySegment(manifest: EventRetentionArchiveManifest, directory: string): { rows: EventRetentionArchiveRow[]; descriptor: EventRetentionArchiveSegmentDescriptor } {
  assertSafeChain(directory, 'event retention archive directory'); assertPlainDirectory(directory, 'event retention archive directory');
  const manifestPath = resolve(directory, MANIFEST_FILE); const segmentPath = resolve(directory, SEGMENT_FILE); const descriptorPath = resolve(directory, DESCRIPTOR_FILE);
  for (const path of [manifestPath, segmentPath, descriptorPath]) { assertWithin(directory, path); assertPlainFile(path, 'event retention archive recovery file') }
  const recorded = JSON.parse(readFileSync(manifestPath, 'utf8')) as EventRetentionArchiveManifest; assertEventRetentionArchiveManifestIntegrity(recorded);
  if (hashJson(recorded) !== hashJson(manifest)) throw new Error('event retention archive recovery manifest changed');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8')) as EventRetentionArchiveSegmentDescriptor;
  const expectedUncompressedBytes = manifest.totals.fullRowBytes + manifest.rows.length;
  const maximumStoredBytes = expectedUncompressedBytes + Math.ceil(expectedUncompressedBytes / 16_384) * 8 + 1_024;
  const storedBytes = statSync(segmentPath).size;
  if (descriptor.version !== 1 || descriptor.relativePath !== SEGMENT_FILE || descriptor.encoding !== 'gzip-jsonl-utf8' || descriptor.rowCount !== manifest.rows.length ||
      descriptor.uncompressedBytes !== expectedUncompressedBytes || !SHA256.test(descriptor.uncompressedSha256) || !Number.isSafeInteger(descriptor.storedBytes) || descriptor.storedBytes < 0 ||
      descriptor.storedBytes !== storedBytes || storedBytes > maximumStoredBytes || !SHA256.test(descriptor.storedSha256)) throw new Error('event retention archive segment descriptor mismatch');
  const compressed = readFileSync(segmentPath);
  if (descriptor.storedSha256 !== hash(compressed)) throw new Error('event retention archive segment descriptor mismatch');
  let plain: Buffer; try { plain = gunzipSync(compressed, { maxOutputLength: expectedUncompressedBytes + 1 }) } catch { throw new Error('event retention archive segment is corrupt') }
  if (descriptor.uncompressedBytes !== plain.byteLength || descriptor.uncompressedSha256 !== hash(plain)) throw new Error('event retention archive segment content mismatch');
  const text = plain.toString('utf8'); const lines = text === '' ? [] : text.endsWith('\n') ? text.slice(0, -1).split('\n') : [];
  if (lines.length !== manifest.rows.length) throw new Error('event retention archive segment row count mismatch');
  const rows = lines.map((line, index) => { let row: EventRetentionArchiveRow; try { row = JSON.parse(line) as EventRetentionArchiveRow } catch { throw new Error('event retention archive segment JSONL is invalid') } if (canonicalRow(row).toString('utf8') !== line) throw new Error('event retention archive segment row is not canonical'); assertRow(row, manifest.rows[index]!); return row });
  if (hashJson(buildSegment(rows).descriptor) !== hashJson(descriptor)) throw new Error('event retention archive segment is not deterministic'); return { rows, descriptor };
}
function recoverySet(raw: BetterSQLite3Raw, manifest: EventRetentionArchiveManifest) {
  const paths = pathsOf(manifest); assertSafeChain(manifest.archiveRootDirectory, 'event retention archive root'); if (existsSync(paths.directory)) return verifySegment(manifest, paths.directory);
  const rows = loadExactRows(raw, manifest); const segment = buildSegment(rows); mkdirSync(manifest.archiveRootDirectory, { recursive: true }); assertSafeChain(manifest.archiveRootDirectory, 'event retention archive root'); assertPlainDirectory(manifest.archiveRootDirectory, 'event retention archive root');
  const staging = resolve(manifest.archiveRootDirectory, `.${manifest.archiveId}.${process.pid}.${randomUUID()}.tmp`); assertWithin(manifest.archiveRootDirectory, staging); mkdirSync(staging);
  try { atomicJson(resolve(staging, MANIFEST_FILE), manifest); atomicWrite(resolve(staging, SEGMENT_FILE), segment.compressed); atomicJson(resolve(staging, DESCRIPTOR_FILE), segment.descriptor); verifySegment(manifest, staging); renameSync(staging, paths.directory); return verifySegment(manifest, paths.directory) }
  catch (error) { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); throw error }
}
function assertProtected(raw: BetterSQLite3Raw, manifest: EventRetentionArchiveManifest): void {
  const current = captureDatabaseMaintenanceFingerprint(raw);
  if (current.schemaHash !== manifest.schemaHash || current.userVersion !== manifest.sourceFingerprint.userVersion || current.checkpointCount !== manifest.sourceFingerprint.checkpointCount || current.checkpointMaxSequence !== manifest.sourceFingerprint.checkpointMaxSequence) throw new Error('event retention archive database protected state changed');
  const protectedSet = protectedFingerprint(raw, new Set(manifest.rows.map((row) => row.id)));
  if (protectedSet.count !== manifest.protectedEventCount || protectedSet.hash !== manifest.protectedEventSetHash) throw new Error('event retention archive protected rows changed');
  if (hashJson(highWater(raw)) !== hashJson(manifest.highWaterFence)) throw new Error('event retention archive high-water fence changed');
}
function unsignedExecute(a: EventRetentionArchiveAudit): Omit<EventRetentionArchiveAudit, 'auditHash'> { const value: Partial<EventRetentionArchiveAudit> = { ...a }; delete value.auditHash; return value as Omit<EventRetentionArchiveAudit, 'auditHash'> }
function unsignedRollback(a: EventRetentionRollbackAudit): Omit<EventRetentionRollbackAudit, 'auditHash'> { const value: Partial<EventRetentionRollbackAudit> = { ...a }; delete value.auditHash; return value as Omit<EventRetentionRollbackAudit, 'auditHash'> }
function persistExecute(a: EventRetentionArchiveAudit): void { a.auditHash = hashJson(unsignedExecute(a)); atomicJson(a.auditPath, a) }
function persistRollback(a: EventRetentionRollbackAudit): void { a.auditHash = hashJson(unsignedRollback(a)); atomicJson(a.auditPath, a) }
function readExecute(path: string): EventRetentionArchiveAudit | undefined { if (!existsSync(path)) return undefined; assertPlainFile(path, 'event retention archive execute audit'); return JSON.parse(readFileSync(path, 'utf8')) as EventRetentionArchiveAudit }
function readRollback(path: string): EventRetentionRollbackAudit | undefined { if (!existsSync(path)) return undefined; assertPlainFile(path, 'event retention archive rollback audit'); return JSON.parse(readFileSync(path, 'utf8')) as EventRetentionRollbackAudit }
function timestamps(a: { startedAt: string; updatedAt: string; completedAt?: string }): boolean {
  try {
    canonicalTimestamp(a.startedAt, 'audit startedAt'); canonicalTimestamp(a.updatedAt, 'audit updatedAt');
    if (a.completedAt !== undefined) canonicalTimestamp(a.completedAt, 'audit completedAt');
  } catch { return false }
  const s = Date.parse(a.startedAt); const u = Date.parse(a.updatedAt); const c = a.completedAt === undefined ? undefined : Date.parse(a.completedAt);
  return u >= s && (c === undefined || (c >= s && c <= u));
}
function assertExecuteAudit(a: EventRetentionArchiveAudit, m: EventRetentionArchiveManifest, path: string, segment: EventRetentionArchiveSegmentDescriptor): void {
  const p = a.progress; const pending = p.pendingBatchEndIndex === undefined || (Number.isSafeInteger(p.pendingBatchEndIndex) && p.pendingBatchEndIndex > p.nextRowIndex && p.pendingBatchEndIndex <= m.rows.length);
  const completed = a.status === 'completed' ? a.completedAt !== undefined && p.nextRowIndex === m.rows.length && p.pendingBatchEndIndex === undefined : a.completedAt === undefined;
  const error = a.status === 'failed' ? typeof a.error === 'string' && a.error.length > 0 : a.error === undefined;
  if (a.version !== 1 || a.operation !== 'execute' || a.archiveId !== m.archiveId || a.manifestHash !== m.manifestHash || !samePath(a.databasePath, m.databasePath) || !samePath(a.archiveDirectory, directoryOf(m)) || !samePath(a.auditPath, path) || hashJson(a.segment) !== hashJson(segment) || !['preparing','running','cancelled','completed','failed'].includes(a.status) || !timestamps(a) || !completed || !error || p.rowCount !== m.rows.length || !Number.isSafeInteger(p.nextRowIndex) || p.nextRowIndex < 0 || p.nextRowIndex > m.rows.length || p.rowsDeleted !== p.nextRowIndex || !Number.isSafeInteger(p.batchesCommitted) || p.batchesCommitted < 0 || p.batchesCommitted > p.nextRowIndex || !pending || a.auditHash !== hashJson(unsignedExecute(a))) throw new Error('event retention archive execute audit does not match the manifest');
}
function assertRollbackAudit(a: EventRetentionRollbackAudit, m: EventRetentionArchiveManifest, path: string, segment: EventRetentionArchiveSegmentDescriptor): void {
  const p = a.progress; const pending = p.pendingBatchEndIndex === undefined || (Number.isSafeInteger(p.pendingBatchEndIndex) && p.pendingBatchEndIndex > p.nextRowIndex && p.pendingBatchEndIndex <= m.rows.length);
  const completed = a.status === 'completed' ? a.completedAt !== undefined && p.nextRowIndex === m.rows.length && p.pendingBatchEndIndex === undefined : a.completedAt === undefined;
  const error = a.status === 'failed' ? typeof a.error === 'string' && a.error.length > 0 : a.error === undefined;
  if (a.version !== 1 || a.operation !== 'rollback' || a.archiveId !== m.archiveId || a.manifestHash !== m.manifestHash || !samePath(a.databasePath, m.databasePath) || !samePath(a.archiveDirectory, directoryOf(m)) || !samePath(a.auditPath, path) || hashJson(a.segment) !== hashJson(segment) || !['preparing','running','cancelled','completed','failed'].includes(a.status) || !timestamps(a) || !completed || !error || p.rowCount !== m.rows.length || !Number.isSafeInteger(p.nextRowIndex) || p.nextRowIndex < 0 || p.nextRowIndex > m.rows.length || !Number.isSafeInteger(p.rowsInserted) || !Number.isSafeInteger(p.rowsAlreadyRestored) || p.rowsInserted < 0 || p.rowsAlreadyRestored < 0 || p.rowsInserted + p.rowsAlreadyRestored !== p.nextRowIndex || !Number.isSafeInteger(p.batchesCommitted) || p.batchesCommitted < 0 || p.batchesCommitted > p.nextRowIndex || !pending || a.auditHash !== hashJson(unsignedRollback(a))) throw new Error('event retention archive rollback audit does not match the manifest');
}
function updateExecute(a: EventRetentionArchiveAudit, now: () => Date, update: (value: EventRetentionArchiveAudit) => void): void { update(a); a.updatedAt = now().toISOString(); persistExecute(a) }
function updateRollback(a: EventRetentionRollbackAudit, now: () => Date, update: (value: EventRetentionRollbackAudit) => void): void { update(a); a.updatedAt = now().toISOString(); persistRollback(a) }
function initialExecute(m: EventRetentionArchiveManifest, path: string, segment: EventRetentionArchiveSegmentDescriptor, now: () => Date): EventRetentionArchiveAudit { const time = now().toISOString(); const a: EventRetentionArchiveAudit = { version: 1, operation: 'execute', archiveId: m.archiveId, manifestHash: m.manifestHash, databasePath: m.databasePath, archiveDirectory: directoryOf(m), auditPath: path, segment, status: 'preparing', startedAt: time, updatedAt: time, progress: { rowCount: m.rows.length, nextRowIndex: 0, rowsDeleted: 0, batchesCommitted: 0 }, auditHash: '' }; a.auditHash = hashJson(unsignedExecute(a)); return a }
function executeState(raw: BetterSQLite3Raw, m: EventRetentionArchiveManifest, a: EventRetentionArchiveAudit): void {
  assertProtected(raw, m); for (let i = 0; i < m.rows.length; i += 1) { const descriptor = m.rows[i]!; const row = rowById(raw, descriptor.id);
    if (i < a.progress.nextRowIndex) { if (row) throw new Error(`event retention archive processed row still exists: ${descriptor.id}`) }
    else if (!row) { if (a.progress.pendingBatchEndIndex === undefined || i >= a.progress.pendingBatchEndIndex) throw new Error(`event retention archive unprocessed row is missing: ${descriptor.id}`) }
    else assertRow(row, descriptor);
  }
}
function reconcileExecute(raw: BetterSQLite3Raw, m: EventRetentionArchiveManifest, a: EventRetentionArchiveAudit, now: () => Date): void {
  const end = a.progress.pendingBatchEndIndex; if (end === undefined) return; const slice = m.rows.slice(a.progress.nextRowIndex, end); const states = slice.map((row) => rowById(raw, row.id));
  const present = states.every((row, i) => { if (!row) return false; assertRow(row, slice[i]!); return true }); const absent = states.every((row) => !row); if (!present && !absent) throw new Error('event retention archive pending delete batch is partially applied');
  updateExecute(a, now, (value) => { if (absent) { const count = end - value.progress.nextRowIndex; value.progress.nextRowIndex = end; value.progress.rowsDeleted += count; value.progress.batchesCommitted += 1 } delete value.progress.pendingBatchEndIndex });
}
function deleteExact(raw: BetterSQLite3Raw, rows: readonly EventRetentionArchiveRow[]): void {
  const statement = raw.prepare(`DELETE FROM event WHERE id = ? AND workspace_id = ? AND task_id IS ? AND run_id IS ? AND step_id IS ? AND message_id IS ? AND category = ? AND type = ? AND sequence = ? AND occurred_at = ? AND payload_json = ?`);
  raw.transaction(() => { for (const row of rows) { const result = statement.run(row.id, row.workspaceId, row.taskId, row.runId, row.stepId, row.messageId, row.category, row.type, row.sequence, row.occurredAt, row.payloadJson); if (Number(result.changes) !== 1) throw new Error(`event retention archive compare-and-swap delete failed for ${row.id}`) } })();
}
export async function executeEventRetentionArchive(raw: BetterSQLite3Raw, options: ExecuteEventRetentionArchiveOptions): Promise<EventRetentionArchiveAudit> {
  const m = options.manifest; assertEventRetentionArchiveManifestIntegrity(m); if (!options.maintenanceWindowConfirmed) throw new Error('event retention archive requires an explicit offline maintenance window'); if (options.confirmationToken !== expectedEventRetentionArchiveConfirmationToken(m)) throw new Error('event retention archive explicit confirmation did not match'); if (Number(raw.pragma('query_only', { simple: true })) !== 0) throw new Error('event retention archive execution requires a writable connection');
  const now = options.now ?? (() => new Date()); const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_EVENT_RETENTION_ARCHIVE_BATCH_SIZE, MAX_EVENT_RETENTION_ARCHIVE_BATCH_SIZE));
  assertProtected(raw, m); const recovery = recoverySet(raw, m); const auditPath = resolve(options.auditPath ?? pathsOf(m).executeAudit); assertWithin(directoryOf(m), auditPath); const audit = readExecute(auditPath) ?? initialExecute(m, auditPath, recovery.descriptor, now);
  try { assertExecuteAudit(audit, m, auditPath, recovery.descriptor); if (!existsSync(auditPath)) persistExecute(audit); reconcileExecute(raw, m, audit, now); executeState(raw, m, audit); if (audit.status === 'completed') return audit;
    if (audit.status !== 'running') updateExecute(audit, now, (value) => { value.status = 'running'; delete value.error });
    while (audit.progress.nextRowIndex < m.rows.length) { if (options.signal?.aborted) { updateExecute(audit, now, (value) => { value.status = 'cancelled' }); return audit }
      const start = audit.progress.nextRowIndex; const end = Math.min(start + batchSize, m.rows.length); updateExecute(audit, now, (value) => { value.progress.pendingBatchEndIndex = end }); deleteExact(raw, recovery.rows.slice(start, end)); options.onBatchDatabaseCommitted?.(audit);
      updateExecute(audit, now, (value) => { value.progress.nextRowIndex = end; value.progress.rowsDeleted += end - start; value.progress.batchesCommitted += 1; delete value.progress.pendingBatchEndIndex }); options.onBatchCommitted?.(audit);
    }
    executeState(raw, m, audit); updateExecute(audit, now, (value) => { value.status = 'completed'; value.completedAt = now().toISOString() }); return audit;
  } catch (error) { if (!existsSync(auditPath)) persistExecute(audit); updateExecute(audit, now, (value) => { value.status = 'failed'; value.error = error instanceof Error ? error.message : 'event retention archive failed' }); throw error }
}
function initialRollback(m: EventRetentionArchiveManifest, path: string, segment: EventRetentionArchiveSegmentDescriptor, prefix: number, now: () => Date): EventRetentionRollbackAudit { const time = now().toISOString(); const a: EventRetentionRollbackAudit = { version: 1, operation: 'rollback', archiveId: m.archiveId, manifestHash: m.manifestHash, databasePath: m.databasePath, archiveDirectory: directoryOf(m), auditPath: path, segment, status: 'preparing', startedAt: time, updatedAt: time, progress: { rowCount: m.rows.length, nextRowIndex: prefix, rowsInserted: 0, rowsAlreadyRestored: prefix, batchesCommitted: 0 }, auditHash: '' }; a.auditHash = hashJson(unsignedRollback(a)); return a }
function restoredPrefix(raw: BetterSQLite3Raw, m: EventRetentionArchiveManifest): number { let prefix = 0; let absent = false; for (const descriptor of m.rows) { const row = rowById(raw, descriptor.id); if (!row) { absent = true; continue } assertRow(row, descriptor); if (absent) throw new Error('event retention archive rollback rows are not a restored prefix'); prefix += 1 } return prefix }
function rollbackState(raw: BetterSQLite3Raw, m: EventRetentionArchiveManifest, a: EventRetentionRollbackAudit): void {
  assertProtected(raw, m); for (let i = 0; i < m.rows.length; i += 1) { const descriptor = m.rows[i]!; const row = rowById(raw, descriptor.id);
    if (i < a.progress.nextRowIndex) { if (!row) throw new Error(`event retention archive restored row is missing: ${descriptor.id}`); assertRow(row, descriptor) }
    else if (row) { if (a.progress.pendingBatchEndIndex === undefined || i >= a.progress.pendingBatchEndIndex) throw new Error(`event retention archive rollback suffix already exists: ${descriptor.id}`); assertRow(row, descriptor) }
  }
}
function reconcileRollback(raw: BetterSQLite3Raw, m: EventRetentionArchiveManifest, a: EventRetentionRollbackAudit, now: () => Date): void {
  const end = a.progress.pendingBatchEndIndex; if (end === undefined) return; const slice = m.rows.slice(a.progress.nextRowIndex, end); const states = slice.map((row) => rowById(raw, row.id));
  const absent = states.every((row) => !row); const present = states.every((row, i) => { if (!row) return false; assertRow(row, slice[i]!); return true }); if (!absent && !present) throw new Error('event retention archive pending rollback batch is partially applied');
  updateRollback(a, now, (value) => { if (present) { const count = end - value.progress.nextRowIndex; value.progress.nextRowIndex = end; value.progress.rowsInserted += count; value.progress.batchesCommitted += 1 } delete value.progress.pendingBatchEndIndex });
}
function insertExact(raw: BetterSQLite3Raw, rows: readonly EventRetentionArchiveRow[]): void {
  const statement = raw.prepare(`INSERT INTO event (id, workspace_id, task_id, run_id, step_id, message_id, category, type, sequence, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  raw.transaction(() => { for (const row of rows) { if (rowById(raw, row.id)) throw new Error(`event retention archive rollback ID conflict: ${row.id}`); statement.run(row.id, row.workspaceId, row.taskId, row.runId, row.stepId, row.messageId, row.category, row.type, row.sequence, row.occurredAt, row.payloadJson) } })();
}
export async function rollbackEventRetentionArchive(raw: BetterSQLite3Raw, options: RollbackEventRetentionArchiveOptions): Promise<EventRetentionRollbackAudit> {
  const m = options.manifest; assertEventRetentionArchiveManifestIntegrity(m); if (!options.maintenanceWindowConfirmed) throw new Error('event retention archive rollback requires an explicit offline maintenance window'); if (options.rollbackToken !== expectedEventRetentionArchiveRollbackToken(m)) throw new Error('event retention archive rollback explicit confirmation did not match'); if (Number(raw.pragma('query_only', { simple: true })) !== 0) throw new Error('event retention archive rollback requires a writable connection');
  const recovery = verifySegment(m, directoryOf(m)); const executePath = resolve(options.executeAuditPath ?? pathsOf(m).executeAudit); assertWithin(directoryOf(m), executePath); const executeAudit = readExecute(executePath); if (!executeAudit) throw new Error('event retention archive execute audit is missing'); assertExecuteAudit(executeAudit, m, executePath, recovery.descriptor); if (executeAudit.status !== 'completed') throw new Error('event retention archive execute audit is not completed');
  const now = options.now ?? (() => new Date()); const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_EVENT_RETENTION_ARCHIVE_BATCH_SIZE, MAX_EVENT_RETENTION_ARCHIVE_BATCH_SIZE)); const auditPath = resolve(options.auditPath ?? pathsOf(m).rollbackAudit); assertWithin(directoryOf(m), auditPath); let audit = readRollback(auditPath);
  if (!audit) { assertProtected(raw, m); audit = initialRollback(m, auditPath, recovery.descriptor, restoredPrefix(raw, m), now) }
  try { assertRollbackAudit(audit, m, auditPath, recovery.descriptor); if (!existsSync(auditPath)) persistRollback(audit); reconcileRollback(raw, m, audit, now); rollbackState(raw, m, audit); if (audit.status === 'completed') return audit;
    if (audit.status !== 'running') updateRollback(audit, now, (value) => { value.status = 'running'; delete value.error });
    while (audit.progress.nextRowIndex < m.rows.length) { if (options.signal?.aborted) { updateRollback(audit, now, (value) => { value.status = 'cancelled' }); return audit }
      const start = audit.progress.nextRowIndex; const end = Math.min(start + batchSize, m.rows.length); updateRollback(audit, now, (value) => { value.progress.pendingBatchEndIndex = end }); insertExact(raw, recovery.rows.slice(start, end)); options.onBatchDatabaseCommitted?.(audit);
      updateRollback(audit, now, (value) => { value.progress.nextRowIndex = end; value.progress.rowsInserted += end - start; value.progress.batchesCommitted += 1; delete value.progress.pendingBatchEndIndex }); options.onBatchCommitted?.(audit);
    }
    rollbackState(raw, m, audit); if (hashJson(highWater(raw)) !== hashJson(m.highWaterFence)) throw new Error('event retention archive rollback did not preserve the high-water fence'); updateRollback(audit, now, (value) => { value.status = 'completed'; value.completedAt = now().toISOString() }); return audit;
  } catch (error) { if (!existsSync(auditPath)) persistRollback(audit); updateRollback(audit, now, (value) => { value.status = 'failed'; value.error = error instanceof Error ? error.message : 'event retention archive rollback failed' }); throw error }
}
