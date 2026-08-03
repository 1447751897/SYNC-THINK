import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import {
  assertEventPayloadBackfillPlanFresh,
  assertEventPayloadBackfillPlanIntegrity,
  type EventPayloadBackfillCandidate,
  type EventPayloadBackfillPlan,
} from './event-payload-backfill.js';
import {
  captureEventPayloadSidecarManifest,
  createEventPayloadSidecarBackup,
  verifyEventPayloadSidecarBackup,
  type EventPayloadSidecarBackupVerification,
} from './event-payload-backup.js';
import {
  EVENT_PAYLOAD_ENVELOPE_KEY,
  EventPayloadSidecarStore,
  parseStoredEventPayloadReference,
  type EventPayloadEnvelopeV1,
} from './event-payload-sidecar.js';
import {
  captureDatabaseMaintenanceFingerprint,
  type DatabaseMaintenanceFingerprint,
} from './database-maintenance-executor.js';

export const EVENT_PAYLOAD_BACKFILL_AUDIT_VERSION = 1 as const;
export const DEFAULT_EVENT_PAYLOAD_BACKFILL_BATCH_SIZE = 100;
export const MAX_EVENT_PAYLOAD_BACKFILL_BATCH_SIZE = 5_000;

export type EventPayloadBackfillAuditStatus =
  | 'preparing'
  | 'running'
  | 'cancelled'
  | 'completed'
  | 'failed';

export interface EventPayloadBackfillRecoverySet {
  databasePath: string;
  databaseBytes: number;
  quickCheck: 'ok';
  sidecarRootDirectory: string;
  sidecars: EventPayloadSidecarBackupVerification;
}

export interface EventPayloadBackfillAudit {
  version: typeof EVENT_PAYLOAD_BACKFILL_AUDIT_VERSION;
  planId: string;
  planHash: string;
  databasePath: string;
  sidecarRootDirectory: string;
  auditPath: string;
  status: EventPayloadBackfillAuditStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  recoverySet?: EventPayloadBackfillRecoverySet;
  progress: {
    candidateCount: number;
    nextCandidateIndex: number;
    rowsConverted: number;
    rowsAlreadyConverted: number;
    batchesCommitted: number;
    uniqueDestinationReferencesVerified: number;
  };
  error?: string;
}

export interface ExecuteEventPayloadBackfillOptions {
  plan: EventPayloadBackfillPlan;
  confirmationToken: string;
  maintenanceWindowConfirmed: boolean;
  auditPath?: string;
  batchSize?: number;
  now?: () => Date;
  signal?: AbortSignal;
  /** Test/diagnostic hook: runs after SQLite commit and before the durable audit cursor advances. */
  onBatchDatabaseCommitted?: (audit: EventPayloadBackfillAudit) => void;
  onBatchCommitted?: (audit: EventPayloadBackfillAudit) => void;
}

interface EventRow {
  rowid: number;
  id: string;
  category: string;
  type: string;
  sequence: number;
  occurredAt: string;
  payloadJson: string;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashJson(value: unknown): string {
  return hashBytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function assertPathWithin(root: string, target: string): void {
  const normalizedRoot = `${resolve(root)}${sep}`.toLowerCase();
  const normalizedTarget = resolve(target).toLowerCase();
  if (!normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error('event payload backfill path escaped its governed directory');
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

function atomicWriteJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  renameSync(temporary, absolute);
}

function persistAudit(audit: EventPayloadBackfillAudit): void {
  atomicWriteJson(audit.auditPath, audit);
}

function updateAudit(
  audit: EventPayloadBackfillAudit,
  now: () => Date,
  update: (current: EventPayloadBackfillAudit) => void,
): void {
  update(audit);
  audit.updatedAt = now().toISOString();
  persistAudit(audit);
}

export function expectedEventPayloadBackfillConfirmationToken(
  plan: Pick<EventPayloadBackfillPlan, 'planId' | 'planHash'>,
): string {
  return `APPLY-EVENT-PAYLOAD-BACKFILL:${plan.planId}:${plan.planHash.slice(0, 16)}`;
}

export function readEventPayloadBackfillAudit(path: string): EventPayloadBackfillAudit {
  const audit = JSON.parse(readFileSync(resolve(path), 'utf8')) as EventPayloadBackfillAudit;
  if (audit.version !== EVENT_PAYLOAD_BACKFILL_AUDIT_VERSION) {
    throw new Error('event payload backfill audit version is unsupported');
  }
  return audit;
}

function readAudit(path: string): EventPayloadBackfillAudit | undefined {
  return existsSync(path) ? readEventPayloadBackfillAudit(path) : undefined;
}

function expectedRecoveryPaths(plan: EventPayloadBackfillPlan): {
  directory: string;
  databasePath: string;
  sidecarRootDirectory: string;
} {
  const governedRoot = dirname(plan.databasePath);
  const directory = resolve(governedRoot, 'backups', 'event-payload-backfill');
  const databasePath = resolve(directory, `${plan.planId}.backup.db`);
  const sidecarRootDirectory = `${databasePath}.sidecars`;
  assertPathWithin(governedRoot, databasePath);
  assertPathWithin(governedRoot, sidecarRootDirectory);
  return { directory, databasePath, sidecarRootDirectory };
}

function cleanupExactRecoverySet(
  directory: string,
  databasePath: string,
  sidecarRootDirectory: string,
): void {
  assertPathWithin(directory, databasePath);
  assertPathWithin(directory, sidecarRootDirectory);
  if (existsSync(databasePath)) {
    if (!statSync(databasePath).isFile()) throw new Error('backfill recovery database is not a file');
    unlinkSync(databasePath);
  }
  if (existsSync(sidecarRootDirectory)) {
    if (!statSync(sidecarRootDirectory).isDirectory()) {
      throw new Error('backfill recovery sidecar path is not a directory');
    }
    rmSync(sidecarRootDirectory, { recursive: true, force: true });
  }
}

async function verifyRecoverySet(
  plan: EventPayloadBackfillPlan,
  databasePath: string,
  sidecarRootDirectory: string,
): Promise<EventPayloadBackfillRecoverySet> {
  const connection = await openDatabaseAsync({
    path: databasePath,
    readonly: true,
    fileMustExist: true,
  });
  try {
    quickCheck(connection.raw);
    const fingerprint = captureDatabaseMaintenanceFingerprint(connection.raw);
    if (!sameLogicalFingerprint(fingerprint, plan.sourceFingerprint)) {
      throw new Error('event payload backfill recovery database fingerprint mismatch');
    }
    const sidecars = verifyEventPayloadSidecarBackup(
      connection.raw,
      plan.sourceSidecars,
      sidecarRootDirectory,
    );
    return {
      databasePath: resolve(databasePath),
      databaseBytes: statSync(databasePath).size,
      quickCheck: 'ok',
      sidecarRootDirectory: resolve(sidecarRootDirectory),
      sidecars,
    };
  } finally {
    connection.raw.close();
  }
}

async function createRecoverySet(
  raw: BetterSQLite3Raw,
  plan: EventPayloadBackfillPlan,
): Promise<EventPayloadBackfillRecoverySet> {
  const paths = expectedRecoveryPaths(plan);
  mkdirSync(paths.directory, { recursive: true });
  if (existsSync(paths.databasePath) || existsSync(paths.sidecarRootDirectory)) {
    throw new Error('event payload backfill recovery set already exists without a matching audit');
  }
  const stagingId = `${process.pid}.${randomUUID()}`;
  const stagingDatabase = `${paths.databasePath}.${stagingId}.tmp`;
  const stagingSidecars = `${paths.sidecarRootDirectory}.${stagingId}.tmp`;
  assertPathWithin(paths.directory, stagingDatabase);
  assertPathWithin(paths.directory, stagingSidecars);
  try {
    await raw.backup(stagingDatabase);
    createEventPayloadSidecarBackup(plan.sourceSidecars, stagingSidecars);
    await verifyRecoverySet(plan, stagingDatabase, stagingSidecars);
    renameSync(stagingDatabase, paths.databasePath);
    renameSync(stagingSidecars, paths.sidecarRootDirectory);
    return await verifyRecoverySet(plan, paths.databasePath, paths.sidecarRootDirectory);
  } catch (error) {
    cleanupExactRecoverySet(paths.directory, stagingDatabase, stagingSidecars);
    cleanupExactRecoverySet(paths.directory, paths.databasePath, paths.sidecarRootDirectory);
    throw error;
  }
}

export async function verifyEventPayloadBackfillRecoverySet(
  audit: EventPayloadBackfillAudit,
  plan: EventPayloadBackfillPlan,
): Promise<void> {
  if (audit.recoverySet === undefined) {
    throw new Error('event payload backfill recovery set is missing');
  }
  const paths = expectedRecoveryPaths(plan);
  if (
    !sameResolvedPath(audit.recoverySet.databasePath, paths.databasePath) ||
    !sameResolvedPath(audit.recoverySet.sidecarRootDirectory, paths.sidecarRootDirectory)
  ) {
    throw new Error('event payload backfill recovery set path does not match the plan');
  }
  const verified = await verifyRecoverySet(plan, paths.databasePath, paths.sidecarRootDirectory);
  if (hashJson(verified) !== hashJson(audit.recoverySet)) {
    throw new Error('event payload backfill recovery set descriptor changed after audit');
  }
}

function initialAudit(
  plan: EventPayloadBackfillPlan,
  auditPath: string,
  now: () => Date,
): EventPayloadBackfillAudit {
  const timestamp = now().toISOString();
  return {
    version: EVENT_PAYLOAD_BACKFILL_AUDIT_VERSION,
    planId: plan.planId,
    planHash: plan.planHash,
    databasePath: plan.databasePath,
    sidecarRootDirectory: plan.sidecarRootDirectory,
    auditPath,
    status: 'preparing',
    startedAt: timestamp,
    updatedAt: timestamp,
    progress: {
      candidateCount: plan.candidates.length,
      nextCandidateIndex: 0,
      rowsConverted: 0,
      rowsAlreadyConverted: 0,
      batchesCommitted: 0,
      uniqueDestinationReferencesVerified: 0,
    },
  };
}

function envelopeJson(candidate: EventPayloadBackfillCandidate): string {
  const envelope: EventPayloadEnvelopeV1 = {
    [EVENT_PAYLOAD_ENVELOPE_KEY]: candidate.destinationReference,
    projection: candidate.projection,
  };
  return JSON.stringify(envelope);
}

function readCandidateRow(raw: BetterSQLite3Raw, candidate: EventPayloadBackfillCandidate): EventRow {
  const row = raw
    .prepare(
      `SELECT rowid, id, category, type, sequence, occurred_at AS occurredAt, payload_json AS payloadJson
       FROM event WHERE id = ?`,
    )
    .get(candidate.eventId) as EventRow | undefined;
  if (row === undefined) throw new Error(`event payload backfill Event ${candidate.eventId} is missing`);
  if (
    Number(row.rowid) !== candidate.rowid ||
    row.category !== candidate.category ||
    row.type !== candidate.type ||
    Number(row.sequence) !== candidate.sequence ||
    row.occurredAt !== candidate.occurredAt
  ) {
    throw new Error(`event payload backfill Event ${candidate.eventId} metadata changed after plan`);
  }
  return { ...row, rowid: Number(row.rowid), sequence: Number(row.sequence) };
}

function isExactSource(row: EventRow, candidate: EventPayloadBackfillCandidate): boolean {
  const bytes = Buffer.from(row.payloadJson, 'utf8');
  return (
    bytes.byteLength === candidate.sourcePayload.byteLength &&
    hashBytes(bytes) === candidate.sourcePayload.sha256 &&
    parseStoredEventPayloadReference(row.payloadJson) === undefined
  );
}

function assertExactEnvelope(
  row: EventRow,
  candidate: EventPayloadBackfillCandidate,
  sidecar: EventPayloadSidecarStore,
): boolean {
  if (row.payloadJson !== envelopeJson(candidate)) return false;
  sidecar.readPayload(candidate.destinationReference);
  return true;
}

function assertProtectedFingerprint(raw: BetterSQLite3Raw, plan: EventPayloadBackfillPlan): void {
  const current = captureDatabaseMaintenanceFingerprint(raw);
  const source = plan.sourceFingerprint;
  if (
    current.schemaVersion !== source.schemaVersion ||
    current.schemaHash !== source.schemaHash ||
    current.userVersion !== source.userVersion ||
    current.eventCount !== source.eventCount ||
    current.eventMaxSequence !== source.eventMaxSequence ||
    current.checkpointCount !== source.checkpointCount ||
    current.checkpointMaxSequence !== source.checkpointMaxSequence
  ) {
    throw new Error('database protected state changed after event payload backfill plan');
  }
  if (source.eventMaxSequence !== null) {
    const row = raw
      .prepare('SELECT COUNT(*) AS count FROM event WHERE sequence > ?')
      .get(source.eventMaxSequence) as { count: number };
    if (Number(row.count) !== 0) throw new Error('new Event sequence appeared after backfill plan');
  }
}

function assertSourceSidecarReferencesUnchanged(
  raw: BetterSQLite3Raw,
  plan: EventPayloadBackfillPlan,
): void {
  const candidateIds = new Set(plan.candidates.map((candidate) => candidate.eventId));
  const rows = raw
    .prepare(
      `SELECT id, payload_json AS payloadJson
       FROM event
       WHERE json_valid(payload_json)
         AND json_type(payload_json, '$."$syncThinkPayload"') IS NOT NULL
       ORDER BY id ASC`,
    )
    .all() as Array<{ id: string; payloadJson: string }>;
  const digest = createHash('sha256');
  for (const row of rows) {
    if (candidateIds.has(row.id)) continue;
    const reference = parseStoredEventPayloadReference(row.payloadJson);
    if (reference === undefined) throw new Error(`Event ${row.id} lost its sidecar envelope`);
    digest.update(`${JSON.stringify([row.id, reference])}\n`);
  }
  if (digest.digest('hex') !== plan.sourceSidecars.referenceHash) {
    throw new Error('source event payload sidecar references changed after backfill plan');
  }
}

function assertExecutionState(
  raw: BetterSQLite3Raw,
  plan: EventPayloadBackfillPlan,
  audit: EventPayloadBackfillAudit,
): void {
  if (
    !Number.isSafeInteger(audit.progress.nextCandidateIndex) ||
    audit.progress.nextCandidateIndex < 0 ||
    audit.progress.nextCandidateIndex > plan.candidates.length ||
    audit.progress.candidateCount !== plan.candidates.length
  ) {
    throw new Error('event payload backfill audit cursor is invalid');
  }
  assertProtectedFingerprint(raw, plan);
  captureEventPayloadSidecarManifest(raw, plan.sidecarRootDirectory);
  const sidecar = new EventPayloadSidecarStore(plan.sidecarRootDirectory);
  assertSourceSidecarReferencesUnchanged(raw, plan);
  for (let index = 0; index < plan.candidates.length; index += 1) {
    const candidate = plan.candidates[index]!;
    const row = readCandidateRow(raw, candidate);
    const exactEnvelope = assertExactEnvelope(row, candidate, sidecar);
    if (index < audit.progress.nextCandidateIndex) {
      if (!exactEnvelope) {
        throw new Error(`processed Event ${candidate.eventId} no longer matches its backfill envelope`);
      }
    } else if (!exactEnvelope && !isExactSource(row, candidate)) {
      throw new Error(`unprocessed Event ${candidate.eventId} changed after backfill plan`);
    }
  }
}

function executeBatch(
  raw: BetterSQLite3Raw,
  plan: EventPayloadBackfillPlan,
  batch: readonly EventPayloadBackfillCandidate[],
): { converted: number; alreadyConverted: number; uniqueReferences: Set<string> } {
  const sidecar = new EventPayloadSidecarStore(plan.sidecarRootDirectory);
  const rows = batch.map((candidate) => ({ candidate, row: readCandidateRow(raw, candidate) }));
  let alreadyConverted = 0;
  const sources: Array<{
    candidate: EventPayloadBackfillCandidate;
    sourcePayloadJson: string;
    targetPayloadJson: string;
  }> = [];
  const uniqueReferences = new Set<string>();

  for (const { candidate, row } of rows) {
    uniqueReferences.add(candidate.destinationReference.sha256);
    if (assertExactEnvelope(row, candidate, sidecar)) {
      alreadyConverted += 1;
      continue;
    }
    if (!isExactSource(row, candidate)) {
      throw new Error(`Event ${candidate.eventId} payload changed before batch commit`);
    }
    const written = sidecar.writePayloadJson(row.payloadJson, candidate.projection);
    if (JSON.stringify(written) !== envelopeJson(candidate)) {
      throw new Error(`Event ${candidate.eventId} destination sidecar reference changed after plan`);
    }
    sidecar.readPayload(candidate.destinationReference);
    sources.push({
      candidate,
      sourcePayloadJson: row.payloadJson,
      targetPayloadJson: envelopeJson(candidate),
    });
  }

  raw.transaction(() => {
    for (const source of sources) {
      const result = raw
        .prepare(
          `UPDATE event SET payload_json = ?
           WHERE id = ? AND rowid = ? AND payload_json = ?`,
        )
        .run(
          source.targetPayloadJson,
          source.candidate.eventId,
          source.candidate.rowid,
          source.sourcePayloadJson,
        );
      if (Number(result.changes) !== 1) {
        throw new Error(`Event ${source.candidate.eventId} compare-and-swap update failed`);
      }
    }
  })();

  return { converted: sources.length, alreadyConverted, uniqueReferences };
}

export async function executeEventPayloadBackfill(
  raw: BetterSQLite3Raw,
  options: ExecuteEventPayloadBackfillOptions,
): Promise<EventPayloadBackfillAudit> {
  const { plan } = options;
  assertEventPayloadBackfillPlanIntegrity(plan);
  if (!options.maintenanceWindowConfirmed) {
    throw new Error('event payload backfill requires an explicit offline maintenance window');
  }
  if (options.confirmationToken !== expectedEventPayloadBackfillConfirmationToken(plan)) {
    throw new Error('event payload backfill explicit confirmation did not match');
  }
  if (Number(raw.pragma('query_only', { simple: true })) !== 0) {
    throw new Error('event payload backfill execution requires a writable connection');
  }
  const now = options.now ?? (() => new Date());
  const batchSize = Math.max(
    1,
    Math.min(
      options.batchSize ?? DEFAULT_EVENT_PAYLOAD_BACKFILL_BATCH_SIZE,
      MAX_EVENT_PAYLOAD_BACKFILL_BATCH_SIZE,
    ),
  );
  const auditPath = resolve(
    options.auditPath ??
      resolve(dirname(plan.databasePath), 'backfill-audits', `${plan.planId}.audit.json`),
  );
  let audit = readAudit(auditPath);

  if (audit !== undefined) {
    if (
      audit.planId !== plan.planId ||
      audit.planHash !== plan.planHash ||
      !sameResolvedPath(audit.databasePath, plan.databasePath) ||
      !sameResolvedPath(audit.sidecarRootDirectory, plan.sidecarRootDirectory) ||
      !sameResolvedPath(audit.auditPath, auditPath)
    ) {
      throw new Error('event payload backfill audit does not match the plan');
    }
    await verifyEventPayloadBackfillRecoverySet(audit, plan);
    assertExecutionState(raw, plan, audit);
    if (audit.status === 'completed') return audit;
  } else {
    assertEventPayloadBackfillPlanFresh(raw, plan);
    quickCheck(raw);
    audit = initialAudit(plan, auditPath, now);
    persistAudit(audit);
    try {
      const recoverySet = await createRecoverySet(raw, plan);
      updateAudit(audit, now, (current) => {
        current.recoverySet = recoverySet;
        current.status = 'running';
        delete current.error;
      });
    } catch (error) {
      updateAudit(audit, now, (current) => {
        current.status = 'failed';
        current.error =
          error instanceof Error ? error.message : 'event payload backfill recovery set failed';
      });
      throw error;
    }
    assertEventPayloadBackfillPlanFresh(raw, plan);
  }

  try {
    if (audit.status !== 'running') {
      updateAudit(audit, now, (current) => {
        current.status = 'running';
        delete current.error;
      });
    }
    const verifiedReferences = new Set(
      plan.candidates
        .slice(0, audit.progress.nextCandidateIndex)
        .map((candidate) => candidate.destinationReference.sha256),
    );
    while (audit.progress.nextCandidateIndex < plan.candidates.length) {
      if (options.signal?.aborted) {
        updateAudit(audit, now, (current) => {
          current.status = 'cancelled';
        });
        return audit;
      }
      const batch = plan.candidates.slice(
        audit.progress.nextCandidateIndex,
        audit.progress.nextCandidateIndex + batchSize,
      );
      const result = executeBatch(raw, plan, batch);
      for (const reference of result.uniqueReferences) verifiedReferences.add(reference);
      options.onBatchDatabaseCommitted?.(audit);
      updateAudit(audit, now, (current) => {
        current.progress.nextCandidateIndex += batch.length;
        current.progress.rowsConverted += result.converted;
        current.progress.rowsAlreadyConverted += result.alreadyConverted;
        current.progress.batchesCommitted += 1;
        current.progress.uniqueDestinationReferencesVerified = verifiedReferences.size;
      });
      options.onBatchCommitted?.(audit);
    }
    assertExecutionState(raw, plan, audit);
    quickCheck(raw);
    updateAudit(audit, now, (current) => {
      current.status = 'completed';
      current.completedAt = now().toISOString();
    });
    return audit;
  } catch (error) {
    updateAudit(audit, now, (current) => {
      current.status = 'failed';
      current.error = error instanceof Error ? error.message : 'event payload backfill failed';
    });
    throw error;
  }
}
