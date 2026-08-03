import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BetterSQLite3Raw } from './connection.js';
import { openDatabaseAsync } from './connection.js';
import type {
  EventPayloadBackfillCandidate,
  EventPayloadBackfillPlan,
} from './event-payload-backfill.js';
import { assertEventPayloadBackfillPlanIntegrity } from './event-payload-backfill.js';
import {
  EVENT_PAYLOAD_BACKFILL_AUDIT_VERSION,
  verifyEventPayloadBackfillRecoverySet,
  type EventPayloadBackfillAudit,
} from './event-payload-backfill-executor.js';
import { EVENT_PAYLOAD_ENVELOPE_KEY, type EventPayloadEnvelopeV1 } from './event-payload-sidecar.js';
import { captureDatabaseMaintenanceFingerprint } from './database-maintenance-executor.js';

export const EVENT_PAYLOAD_BACKFILL_ROLLBACK_AUDIT_VERSION = 1 as const;
export const DEFAULT_EVENT_PAYLOAD_BACKFILL_ROLLBACK_BATCH_SIZE = 100;
export const MAX_EVENT_PAYLOAD_BACKFILL_ROLLBACK_BATCH_SIZE = 5_000;

export interface EventPayloadBackfillRollbackAudit {
  version: typeof EVENT_PAYLOAD_BACKFILL_ROLLBACK_AUDIT_VERSION;
  planId: string;
  planHash: string;
  executionAuditPath: string;
  executionAuditUpdatedAt: string;
  databasePath: string;
  auditPath: string;
  status: 'running' | 'cancelled' | 'completed' | 'failed';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  progress: {
    candidateCount: number;
    nextCandidateIndex: number;
    rowsRestored: number;
    rowsAlreadyOriginal: number;
    batchesCommitted: number;
  };
  error?: string;
}

export interface RollbackEventPayloadBackfillOptions {
  plan: EventPayloadBackfillPlan;
  executionAudit: EventPayloadBackfillAudit;
  confirmationToken: string;
  maintenanceWindowConfirmed: boolean;
  auditPath?: string;
  batchSize?: number;
  now?: () => Date;
  signal?: AbortSignal;
  onBatchDatabaseCommitted?: (audit: EventPayloadBackfillRollbackAudit) => void;
  onBatchCommitted?: (audit: EventPayloadBackfillRollbackAudit) => void;
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

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function isIsoTimestamp(value: string | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function atomicWrite(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, absolute);
}

function updateAudit(
  audit: EventPayloadBackfillRollbackAudit,
  now: () => Date,
  update: (audit: EventPayloadBackfillRollbackAudit) => void,
): void {
  update(audit);
  audit.updatedAt = now().toISOString();
  atomicWrite(audit.auditPath, audit);
}

export function expectedEventPayloadBackfillRollbackConfirmationToken(
  plan: Pick<EventPayloadBackfillPlan, 'planId' | 'planHash'>,
): string {
  return `ROLLBACK-EVENT-PAYLOAD-BACKFILL:${plan.planId}:${plan.planHash.slice(0, 16)}`;
}

export function readEventPayloadBackfillRollbackAudit(
  path: string,
): EventPayloadBackfillRollbackAudit {
  const audit = JSON.parse(readFileSync(resolve(path), 'utf8')) as EventPayloadBackfillRollbackAudit;
  if (audit.version !== EVENT_PAYLOAD_BACKFILL_ROLLBACK_AUDIT_VERSION) {
    throw new Error('event payload backfill rollback audit version is unsupported');
  }
  return audit;
}

function envelopeJson(candidate: EventPayloadBackfillCandidate): string {
  const envelope: EventPayloadEnvelopeV1 = {
    [EVENT_PAYLOAD_ENVELOPE_KEY]: candidate.destinationReference,
    projection: candidate.projection,
  };
  return JSON.stringify(envelope);
}

function row(raw: BetterSQLite3Raw, candidate: EventPayloadBackfillCandidate): EventRow {
  const value = raw.prepare(
    `SELECT rowid, id, category, type, sequence, occurred_at AS occurredAt, payload_json AS payloadJson
     FROM event WHERE id = ?`,
  ).get(candidate.eventId) as EventRow | undefined;
  if (!value) throw new Error(`rollback Event ${candidate.eventId} is missing`);
  if (
    Number(value.rowid) !== candidate.rowid || value.category !== candidate.category ||
    value.type !== candidate.type || Number(value.sequence) !== candidate.sequence ||
    value.occurredAt !== candidate.occurredAt
  ) throw new Error(`rollback Event ${candidate.eventId} metadata changed`);
  return { ...value, rowid: Number(value.rowid), sequence: Number(value.sequence) };
}

function sourceMatches(payloadJson: string, candidate: EventPayloadBackfillCandidate): boolean {
  const bytes = Buffer.from(payloadJson, 'utf8');
  return bytes.byteLength === candidate.sourcePayload.byteLength && hashBytes(bytes) === candidate.sourcePayload.sha256;
}

function assertProtectedState(raw: BetterSQLite3Raw, plan: EventPayloadBackfillPlan): void {
  const current = captureDatabaseMaintenanceFingerprint(raw);
  const source = plan.sourceFingerprint;
  if (
    current.schemaVersion !== source.schemaVersion || current.schemaHash !== source.schemaHash ||
    current.userVersion !== source.userVersion || current.eventCount !== source.eventCount ||
    current.eventMaxSequence !== source.eventMaxSequence || current.checkpointCount !== source.checkpointCount ||
    current.checkpointMaxSequence !== source.checkpointMaxSequence
  ) throw new Error('database protected state changed before backfill rollback');
}

function initialAudit(
  plan: EventPayloadBackfillPlan,
  executionAudit: EventPayloadBackfillAudit,
  auditPath: string,
  now: () => Date,
): EventPayloadBackfillRollbackAudit {
  const timestamp = now().toISOString();
  return {
    version: EVENT_PAYLOAD_BACKFILL_ROLLBACK_AUDIT_VERSION,
    planId: plan.planId,
    planHash: plan.planHash,
    executionAuditPath: executionAudit.auditPath,
    executionAuditUpdatedAt: executionAudit.updatedAt,
    databasePath: plan.databasePath,
    auditPath,
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
    progress: { candidateCount: plan.candidates.length, nextCandidateIndex: 0, rowsRestored: 0, rowsAlreadyOriginal: 0, batchesCommitted: 0 },
  };
}

function assertAuditMatches(
  audit: EventPayloadBackfillRollbackAudit,
  plan: EventPayloadBackfillPlan,
  executionAudit: EventPayloadBackfillAudit,
  auditPath: string,
): void {
  const progress = audit.progress;
  const timestampsAreOrdered =
    isIsoTimestamp(audit.startedAt) &&
    isIsoTimestamp(audit.updatedAt) &&
    Date.parse(audit.updatedAt) >= Date.parse(audit.startedAt);
  const completionIsValid =
    audit.status === 'completed'
      ? isIsoTimestamp(audit.completedAt) &&
        Date.parse(audit.completedAt) >= Date.parse(audit.startedAt) &&
        progress.nextCandidateIndex === plan.candidates.length
      : audit.completedAt === undefined;
  if (
    audit.version !== EVENT_PAYLOAD_BACKFILL_ROLLBACK_AUDIT_VERSION ||
    audit.planId !== plan.planId || audit.planHash !== plan.planHash ||
    !samePath(audit.databasePath, plan.databasePath) || !samePath(audit.auditPath, auditPath) ||
    !samePath(audit.executionAuditPath, executionAudit.auditPath) ||
    audit.executionAuditUpdatedAt !== executionAudit.updatedAt ||
    !['running', 'cancelled', 'completed', 'failed'].includes(audit.status) ||
    !timestampsAreOrdered || !completionIsValid ||
    progress.candidateCount !== plan.candidates.length ||
    !isNonNegativeSafeInteger(progress.nextCandidateIndex) ||
    progress.nextCandidateIndex > plan.candidates.length ||
    !isNonNegativeSafeInteger(progress.rowsRestored) ||
    !isNonNegativeSafeInteger(progress.rowsAlreadyOriginal) ||
    progress.rowsRestored + progress.rowsAlreadyOriginal !== progress.nextCandidateIndex ||
    !isNonNegativeSafeInteger(progress.batchesCommitted) ||
    progress.batchesCommitted > progress.nextCandidateIndex
  ) throw new Error('event payload backfill rollback audit does not match execution');
}

function assertExecutionAuditMatchesPlan(
  executionAudit: EventPayloadBackfillAudit,
  plan: EventPayloadBackfillPlan,
): void {
  if (
    executionAudit.version !== EVENT_PAYLOAD_BACKFILL_AUDIT_VERSION ||
    executionAudit.planId !== plan.planId ||
    executionAudit.planHash !== plan.planHash ||
    !samePath(executionAudit.databasePath, plan.databasePath) ||
    !samePath(executionAudit.sidecarRootDirectory, plan.sidecarRootDirectory) ||
    resolve(executionAudit.auditPath) !== executionAudit.auditPath ||
    executionAudit.progress.candidateCount !== plan.candidates.length ||
    !isNonNegativeSafeInteger(executionAudit.progress.nextCandidateIndex) ||
    executionAudit.progress.nextCandidateIndex > plan.candidates.length
  ) {
    throw new Error('event payload backfill execution audit does not match the plan');
  }
}

function assertRollbackState(
  raw: BetterSQLite3Raw,
  recoveryRaw: BetterSQLite3Raw,
  plan: EventPayloadBackfillPlan,
  audit: EventPayloadBackfillRollbackAudit,
): void {
  assertProtectedState(raw, plan);
  for (let index = 0; index < plan.candidates.length; index += 1) {
    const candidate = plan.candidates[index]!;
    const current = row(raw, candidate);
    const original = row(recoveryRaw, candidate);
    if (!sourceMatches(original.payloadJson, candidate)) throw new Error(`recovery Event ${candidate.eventId} payload mismatch`);
    const isOriginal = current.payloadJson === original.payloadJson;
    const isEnvelope = current.payloadJson === envelopeJson(candidate);
    if (index < audit.progress.nextCandidateIndex ? !isOriginal : !isOriginal && !isEnvelope) {
      throw new Error(`rollback Event ${candidate.eventId} is outside the exact source/envelope states`);
    }
  }
}

export async function rollbackEventPayloadBackfill(
  raw: BetterSQLite3Raw,
  options: RollbackEventPayloadBackfillOptions,
): Promise<EventPayloadBackfillRollbackAudit> {
  const { plan, executionAudit } = options;
  assertEventPayloadBackfillPlanIntegrity(plan);
  assertExecutionAuditMatchesPlan(executionAudit, plan);
  if (!options.maintenanceWindowConfirmed) throw new Error('backfill rollback requires an explicit offline maintenance window');
  if (options.confirmationToken !== expectedEventPayloadBackfillRollbackConfirmationToken(plan)) throw new Error('backfill rollback explicit confirmation did not match');
  if (Number(raw.pragma('query_only', { simple: true })) !== 0) throw new Error('backfill rollback requires a writable connection');
  await verifyEventPayloadBackfillRecoverySet(executionAudit, plan);
  const recoveryPath = executionAudit.recoverySet!.databasePath;
  const recovery = await openDatabaseAsync({ path: recoveryPath, readonly: true, fileMustExist: true });
  const now = options.now ?? (() => new Date());
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_EVENT_PAYLOAD_BACKFILL_ROLLBACK_BATCH_SIZE, MAX_EVENT_PAYLOAD_BACKFILL_ROLLBACK_BATCH_SIZE));
  const auditPath = resolve(options.auditPath ?? resolve(dirname(plan.databasePath), 'backfill-audits', `${plan.planId}.rollback.audit.json`));
  const audit = existsSync(auditPath) ? readEventPayloadBackfillRollbackAudit(auditPath) : initialAudit(plan, executionAudit, auditPath, now);
  try {
    assertAuditMatches(audit, plan, executionAudit, auditPath);
    assertRollbackState(raw, recovery.raw, plan, audit);
    if (audit.status === 'completed') return audit;
    if (!existsSync(auditPath)) atomicWrite(auditPath, audit);
    if (audit.status !== 'running') updateAudit(audit, now, (current) => { current.status = 'running'; delete current.error; });
    while (audit.progress.nextCandidateIndex < plan.candidates.length) {
      if (options.signal?.aborted) {
        updateAudit(audit, now, (current) => { current.status = 'cancelled'; });
        return audit;
      }
      const batch = plan.candidates.slice(audit.progress.nextCandidateIndex, audit.progress.nextCandidateIndex + batchSize);
      let restored = 0;
      let alreadyOriginal = 0;
      const updates: Array<{ candidate: EventPayloadBackfillCandidate; source: string; target: string }> = [];
      for (const candidate of batch) {
        const current = row(raw, candidate);
        const original = row(recovery.raw, candidate);
        if (!sourceMatches(original.payloadJson, candidate)) throw new Error(`recovery Event ${candidate.eventId} payload mismatch`);
        if (current.payloadJson === original.payloadJson) { alreadyOriginal += 1; continue; }
        const target = envelopeJson(candidate);
        if (current.payloadJson !== target) throw new Error(`rollback Event ${candidate.eventId} payload changed`);
        updates.push({ candidate, source: current.payloadJson, target: original.payloadJson });
      }
      raw.transaction(() => {
        for (const update of updates) {
          const result = raw.prepare('UPDATE event SET payload_json = ? WHERE id = ? AND rowid = ? AND payload_json = ?').run(update.target, update.candidate.eventId, update.candidate.rowid, update.source);
          if (Number(result.changes) !== 1) throw new Error(`rollback Event ${update.candidate.eventId} compare-and-swap failed`);
          restored += 1;
        }
      })();
      options.onBatchDatabaseCommitted?.(audit);
      updateAudit(audit, now, (current) => {
        current.progress.nextCandidateIndex += batch.length;
        current.progress.rowsRestored += restored;
        current.progress.rowsAlreadyOriginal += alreadyOriginal;
        current.progress.batchesCommitted += 1;
      });
      options.onBatchCommitted?.(audit);
    }
    assertRollbackState(raw, recovery.raw, plan, audit);
    updateAudit(audit, now, (current) => { current.status = 'completed'; current.completedAt = now().toISOString(); });
    return audit;
  } catch (error) {
    if (!existsSync(auditPath)) atomicWrite(auditPath, audit);
    updateAudit(audit, now, (current) => { current.status = 'failed'; current.error = error instanceof Error ? error.message : 'backfill rollback failed'; });
    throw error;
  } finally {
    recovery.raw.close();
  }
}
