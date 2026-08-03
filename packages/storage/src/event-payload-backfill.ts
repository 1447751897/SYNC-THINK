import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { BetterSQLite3Raw } from './connection.js';
import {
  captureDatabaseMaintenanceFingerprint,
  type DatabaseMaintenanceFingerprint,
} from './database-maintenance-executor.js';
import {
  assertEventPayloadSidecarManifestIntegrity,
  captureEventPayloadSidecarManifest,
  eventPayloadSidecarManifestHash,
  type EventPayloadSidecarManifest,
} from './event-payload-backup.js';
import {
  EVENT_PAYLOAD_ENVELOPE_KEY,
  parseStoredEventPayloadReference,
  planEventPayloadSidecarWrite,
  validateEventPayloadReference,
  type EventPayloadEnvelopeV1,
  type EventPayloadReferenceV1,
} from './event-payload-sidecar.js';

export const EVENT_PAYLOAD_BACKFILL_PLAN_VERSION = 1 as const;
export const EVENT_PAYLOAD_BACKFILL_SELECTOR_VERSION = 1 as const;
export const EVENT_PAYLOAD_PROJECTION_BUILDER_VERSION = 1 as const;
export const EVENT_PAYLOAD_PROJECTION_BUILDER_ID = 'context-packet-query-v1' as const;
export const DEFAULT_EVENT_PAYLOAD_BACKFILL_MINIMUM_BYTES = 64 * 1024;
export const EVENT_PAYLOAD_BACKFILL_EVENT_TYPES = ['context.packet.built'] as const;

interface EventPayloadBackfillRow {
  rowid: number;
  id: string;
  category: string;
  type: string;
  sequence: number;
  occurredAt: string;
  payloadJson: string;
}

export interface EventPayloadBackfillCandidate {
  eventId: string;
  rowid: number;
  category: string;
  type: string;
  sequence: number;
  occurredAt: string;
  sourcePayload: {
    sha256: string;
    byteLength: number;
  };
  projection: Record<string, unknown>;
  destinationReference: EventPayloadReferenceV1;
  envelopeByteLength: number;
  logicalSqlitePayloadBytesDelta: number;
  destinationAlreadyReferenced: boolean;
}

interface EventPayloadBackfillPlanUnsigned {
  version: typeof EVENT_PAYLOAD_BACKFILL_PLAN_VERSION;
  planId: string;
  generatedAt: string;
  mode: 'dry-run';
  databasePath: string;
  sidecarRootDirectory: string;
  selector: {
    version: typeof EVENT_PAYLOAD_BACKFILL_SELECTOR_VERSION;
    eventTypes: string[];
    minimumPayloadBytes: number;
  };
  projectionBuilder: {
    id: typeof EVENT_PAYLOAD_PROJECTION_BUILDER_ID;
    version: typeof EVENT_PAYLOAD_PROJECTION_BUILDER_VERSION;
  };
  sourceFingerprint: DatabaseMaintenanceFingerprint;
  sourceSelectionHash: string;
  sourceSidecars: EventPayloadSidecarManifest;
  sourceSidecarReferenceHash: string;
  scan: {
    matchedEventCount: number;
    inlineCandidateCount: number;
    alreadyExternalizedCount: number;
    belowThresholdCount: number;
    destinationReferenceHash: string;
  };
  estimates: {
    sqlitePayloadBytesBefore: number;
    sqlitePayloadBytesAfter: number;
    logicalSqlitePayloadBytesReduced: number;
    sidecarReferencedStoredBytes: number;
    sidecarUniqueStoredBytes: number;
    sidecarNewStoredBytes: number;
    sidecarDeduplicatedStoredBytes: number;
  };
  candidates: EventPayloadBackfillCandidate[];
}

export interface EventPayloadBackfillPlan extends EventPayloadBackfillPlanUnsigned {
  planHash: string;
}

export interface PrepareEventPayloadBackfillPlanOptions {
  databasePath: string;
  sidecarRootDirectory: string;
  minimumPayloadBytes?: number;
  now?: Date;
  planId?: string;
}

interface EventPayloadBackfillScan {
  matchedEventCount: number;
  alreadyExternalizedCount: number;
  belowThresholdCount: number;
  sourceSelectionHash: string;
  destinationReferenceHash: string;
  candidates: EventPayloadBackfillCandidate[];
  estimates: EventPayloadBackfillPlanUnsigned['estimates'];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashJson(value: unknown): string {
  return hashBytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

function parsePayloadObject(payloadJson: string, eventId: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    throw new Error(
      `Event ${eventId} payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Event ${eventId} payload must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function projectionValue(
  payload: Record<string, unknown>,
  key: string,
): string | number | boolean | null | undefined {
  const value = payload[key];
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
    ? (value as string | number | boolean | null)
    : undefined;
}

export function buildEventPayloadBackfillProjection(
  eventType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (eventType !== 'context.packet.built') {
    throw new Error(`unsupported Event payload projection type: ${eventType}`);
  }
  const projection: Record<string, unknown> = {};
  for (const key of [
    'threadId',
    'packetId',
    'proofHash',
    'modelId',
    'providerModelId',
    'resolutionSource',
    'credentialRefId',
    'credentialResolutionSource',
    'agentVersionId',
    'policyId',
    'tokenEstimate',
  ]) {
    const value = projectionValue(payload, key);
    if (value !== undefined) projection[key] = value;
  }
  return projection;
}

function referenceWithoutCount(
  reference: EventPayloadReferenceV1 & { referenceCount?: number },
): EventPayloadReferenceV1 {
  return {
    version: reference.version,
    storage: reference.storage,
    codec: reference.codec,
    compression: reference.compression,
    sha256: reference.sha256,
    byteLength: reference.byteLength,
    storedByteLength: reference.storedByteLength,
    relativePath: reference.relativePath,
  };
}

function eventRows(
  raw: BetterSQLite3Raw,
  eventTypes: readonly string[],
): EventPayloadBackfillRow[] {
  const placeholders = eventTypes.map(() => '?').join(', ');
  return raw
    .prepare(
      `SELECT rowid, id, category, type, sequence, occurred_at AS occurredAt, payload_json AS payloadJson
       FROM event
       WHERE type IN (${placeholders})
       ORDER BY id ASC`,
    )
    .all(...eventTypes) as EventPayloadBackfillRow[];
}

function scanEventPayloadBackfill(
  raw: BetterSQLite3Raw,
  minimumPayloadBytes: number,
  sourceSidecars: EventPayloadSidecarManifest,
): EventPayloadBackfillScan {
  const rows = eventRows(raw, EVENT_PAYLOAD_BACKFILL_EVENT_TYPES);
  const sourceDigest = createHash('sha256');
  const referenceDigest = createHash('sha256');
  const existingBlobs = new Map(
    sourceSidecars.blobs.map((entry) => [entry.sha256, referenceWithoutCount(entry)] as const),
  );
  const uniqueDestinationBlobs = new Map<string, EventPayloadReferenceV1>();
  const candidates: EventPayloadBackfillCandidate[] = [];
  let alreadyExternalizedCount = 0;
  let belowThresholdCount = 0;
  let sqlitePayloadBytesBefore = 0;
  let sqlitePayloadBytesAfter = 0;
  let sidecarReferencedStoredBytes = 0;

  for (const row of rows) {
    const payloadJsonBytes = Buffer.from(row.payloadJson, 'utf8');
    sourceDigest.update(
      `${JSON.stringify([
        row.id,
        Number(row.rowid),
        row.category,
        row.type,
        Number(row.sequence),
        row.occurredAt,
        payloadJsonBytes.byteLength,
        hashBytes(payloadJsonBytes),
      ])}\n`,
    );
    const storedReference = parseStoredEventPayloadReference(row.payloadJson);
    if (storedReference !== undefined) {
      alreadyExternalizedCount += 1;
      continue;
    }
    if (payloadJsonBytes.byteLength < minimumPayloadBytes) {
      belowThresholdCount += 1;
      continue;
    }

    const payload = parsePayloadObject(row.payloadJson, row.id);
    const projection = buildEventPayloadBackfillProjection(row.type, payload);
    const planned = planEventPayloadSidecarWrite(row.payloadJson, projection);
    const plannedReference = planned.envelope[EVENT_PAYLOAD_ENVELOPE_KEY];
    const destinationReference = existingBlobs.get(plannedReference.sha256) ?? plannedReference;
    if (destinationReference.byteLength !== payloadJsonBytes.byteLength) {
      throw new Error(`existing sidecar metadata conflicts with Event ${row.id}`);
    }
    const envelope: EventPayloadEnvelopeV1 = {
      [EVENT_PAYLOAD_ENVELOPE_KEY]: destinationReference,
      projection,
    };
    const envelopeByteLength = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    const candidate: EventPayloadBackfillCandidate = {
      eventId: row.id,
      rowid: Number(row.rowid),
      category: row.category,
      type: row.type,
      sequence: Number(row.sequence),
      occurredAt: row.occurredAt,
      sourcePayload: {
        sha256: plannedReference.sha256,
        byteLength: payloadJsonBytes.byteLength,
      },
      projection,
      destinationReference,
      envelopeByteLength,
      logicalSqlitePayloadBytesDelta: payloadJsonBytes.byteLength - envelopeByteLength,
      destinationAlreadyReferenced: existingBlobs.has(plannedReference.sha256),
    };
    candidates.push(candidate);
    referenceDigest.update(
      `${JSON.stringify([candidate.eventId, candidate.destinationReference, candidate.projection])}\n`,
    );
    sqlitePayloadBytesBefore += payloadJsonBytes.byteLength;
    sqlitePayloadBytesAfter += envelopeByteLength;
    sidecarReferencedStoredBytes += destinationReference.storedByteLength;
    uniqueDestinationBlobs.set(destinationReference.sha256, destinationReference);
  }

  const uniqueReferences = [...uniqueDestinationBlobs.values()];
  const sidecarUniqueStoredBytes = uniqueReferences.reduce(
    (sum, reference) => sum + reference.storedByteLength,
    0,
  );
  const sidecarNewStoredBytes = uniqueReferences
    .filter((reference) => !existingBlobs.has(reference.sha256))
    .reduce((sum, reference) => sum + reference.storedByteLength, 0);
  return {
    matchedEventCount: rows.length,
    alreadyExternalizedCount,
    belowThresholdCount,
    sourceSelectionHash: sourceDigest.digest('hex'),
    destinationReferenceHash: referenceDigest.digest('hex'),
    candidates,
    estimates: {
      sqlitePayloadBytesBefore,
      sqlitePayloadBytesAfter,
      logicalSqlitePayloadBytesReduced: sqlitePayloadBytesBefore - sqlitePayloadBytesAfter,
      sidecarReferencedStoredBytes,
      sidecarUniqueStoredBytes,
      sidecarNewStoredBytes,
      sidecarDeduplicatedStoredBytes: sidecarReferencedStoredBytes - sidecarUniqueStoredBytes,
    },
  };
}

function planIdentifier(now: Date): string {
  return `event-payload-backfill-${now.toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
}

function unsignedPlan(plan: EventPayloadBackfillPlan): EventPayloadBackfillPlanUnsigned {
  const unsigned: Partial<EventPayloadBackfillPlan> = { ...plan };
  delete unsigned.planHash;
  return unsigned as EventPayloadBackfillPlanUnsigned;
}

export function prepareEventPayloadBackfillPlan(
  raw: BetterSQLite3Raw,
  options: PrepareEventPayloadBackfillPlanOptions,
): EventPayloadBackfillPlan {
  const minimumPayloadBytes = Math.trunc(
    options.minimumPayloadBytes ?? DEFAULT_EVENT_PAYLOAD_BACKFILL_MINIMUM_BYTES,
  );
  if (!Number.isSafeInteger(minimumPayloadBytes) || minimumPayloadBytes < 1) {
    throw new Error('event payload backfill minimum bytes must be a positive safe integer');
  }
  const now = options.now ?? new Date();
  const capture = (): EventPayloadBackfillPlan => {
    const sourceSidecars = captureEventPayloadSidecarManifest(
      raw,
      resolve(options.sidecarRootDirectory),
    );
    const scan = scanEventPayloadBackfill(raw, minimumPayloadBytes, sourceSidecars);
    const unsigned: EventPayloadBackfillPlanUnsigned = {
      version: EVENT_PAYLOAD_BACKFILL_PLAN_VERSION,
      planId: options.planId ?? planIdentifier(now),
      generatedAt: now.toISOString(),
      mode: 'dry-run',
      databasePath: resolve(options.databasePath),
      sidecarRootDirectory: resolve(options.sidecarRootDirectory),
      selector: {
        version: EVENT_PAYLOAD_BACKFILL_SELECTOR_VERSION,
        eventTypes: [...EVENT_PAYLOAD_BACKFILL_EVENT_TYPES],
        minimumPayloadBytes,
      },
      projectionBuilder: {
        id: EVENT_PAYLOAD_PROJECTION_BUILDER_ID,
        version: EVENT_PAYLOAD_PROJECTION_BUILDER_VERSION,
      },
      sourceFingerprint: captureDatabaseMaintenanceFingerprint(raw),
      sourceSelectionHash: scan.sourceSelectionHash,
      sourceSidecars,
      sourceSidecarReferenceHash: eventPayloadSidecarManifestHash(sourceSidecars),
      scan: {
        matchedEventCount: scan.matchedEventCount,
        inlineCandidateCount: scan.candidates.length,
        alreadyExternalizedCount: scan.alreadyExternalizedCount,
        belowThresholdCount: scan.belowThresholdCount,
        destinationReferenceHash: scan.destinationReferenceHash,
      },
      estimates: scan.estimates,
      candidates: scan.candidates,
    };
    const plan = { ...unsigned, planHash: hashJson(unsigned) };
    assertEventPayloadBackfillPlanIntegrity(plan);
    return plan;
  };
  return raw.transaction(capture)();
}

export function assertEventPayloadBackfillPlanIntegrity(plan: EventPayloadBackfillPlan): void {
  if (plan.version !== EVENT_PAYLOAD_BACKFILL_PLAN_VERSION || plan.mode !== 'dry-run') {
    throw new Error('event payload backfill plan version is unsupported');
  }
  if (
    plan.selector.version !== EVENT_PAYLOAD_BACKFILL_SELECTOR_VERSION ||
    JSON.stringify(plan.selector.eventTypes) !==
      JSON.stringify(EVENT_PAYLOAD_BACKFILL_EVENT_TYPES) ||
    !Number.isSafeInteger(plan.selector.minimumPayloadBytes) ||
    plan.selector.minimumPayloadBytes < 1
  ) {
    throw new Error('event payload backfill selector is unsupported');
  }
  if (
    plan.projectionBuilder.id !== EVENT_PAYLOAD_PROJECTION_BUILDER_ID ||
    plan.projectionBuilder.version !== EVENT_PAYLOAD_PROJECTION_BUILDER_VERSION
  ) {
    throw new Error('event payload backfill projection builder is unsupported');
  }
  if (
    !SHA256_PATTERN.test(plan.sourceSelectionHash) ||
    !SHA256_PATTERN.test(plan.sourceSidecarReferenceHash) ||
    !SHA256_PATTERN.test(plan.scan.destinationReferenceHash)
  ) {
    throw new Error('event payload backfill plan contains an invalid reference hash');
  }
  assertEventPayloadSidecarManifestIntegrity(plan.sourceSidecars);
  if (eventPayloadSidecarManifestHash(plan.sourceSidecars) !== plan.sourceSidecarReferenceHash) {
    throw new Error('event payload backfill sidecar reference fence mismatch');
  }
  if (
    plan.scan.inlineCandidateCount !== plan.candidates.length ||
    plan.scan.matchedEventCount !==
      plan.scan.inlineCandidateCount +
        plan.scan.alreadyExternalizedCount +
        plan.scan.belowThresholdCount
  ) {
    throw new Error('event payload backfill scan counts do not reconcile');
  }
  let previousEventId: string | undefined;
  const referenceDigest = createHash('sha256');
  const existingHashes = new Set(plan.sourceSidecars.blobs.map((entry) => entry.sha256));
  const uniqueReferences = new Map<string, EventPayloadReferenceV1>();
  let sqlitePayloadBytesBefore = 0;
  let sqlitePayloadBytesAfter = 0;
  let sidecarReferencedStoredBytes = 0;
  for (const candidate of plan.candidates) {
    if (previousEventId !== undefined && candidate.eventId.localeCompare(previousEventId) <= 0) {
      throw new Error('event payload backfill candidates are duplicated or not sorted by Event ID');
    }
    previousEventId = candidate.eventId;
    if (!SHA256_PATTERN.test(candidate.sourcePayload.sha256)) {
      throw new Error(
        `event payload backfill source hash is invalid for Event ${candidate.eventId}`,
      );
    }
    validateEventPayloadReference(candidate.destinationReference);
    if (
      candidate.sourcePayload.sha256 !== candidate.destinationReference.sha256 ||
      candidate.sourcePayload.byteLength !== candidate.destinationReference.byteLength
    ) {
      throw new Error(`event payload backfill reference does not match Event ${candidate.eventId}`);
    }
    const envelope: EventPayloadEnvelopeV1 = {
      [EVENT_PAYLOAD_ENVELOPE_KEY]: candidate.destinationReference,
      projection: candidate.projection,
    };
    const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (
      envelopeBytes !== candidate.envelopeByteLength ||
      candidate.logicalSqlitePayloadBytesDelta !==
        candidate.sourcePayload.byteLength - candidate.envelopeByteLength
    ) {
      throw new Error(
        `event payload backfill byte estimate is invalid for Event ${candidate.eventId}`,
      );
    }
    if (
      candidate.destinationAlreadyReferenced !==
      existingHashes.has(candidate.destinationReference.sha256)
    ) {
      throw new Error(
        `event payload backfill existing-reference estimate is invalid for Event ${candidate.eventId}`,
      );
    }
    const existingUnique = uniqueReferences.get(candidate.destinationReference.sha256);
    if (
      existingUnique !== undefined &&
      JSON.stringify(existingUnique) !== JSON.stringify(candidate.destinationReference)
    ) {
      throw new Error(
        `event payload backfill destination metadata conflicts for ${candidate.destinationReference.sha256}`,
      );
    }
    uniqueReferences.set(candidate.destinationReference.sha256, candidate.destinationReference);
    sqlitePayloadBytesBefore += candidate.sourcePayload.byteLength;
    sqlitePayloadBytesAfter += candidate.envelopeByteLength;
    sidecarReferencedStoredBytes += candidate.destinationReference.storedByteLength;
    referenceDigest.update(
      `${JSON.stringify([candidate.eventId, candidate.destinationReference, candidate.projection])}\n`,
    );
  }
  if (referenceDigest.digest('hex') !== plan.scan.destinationReferenceHash) {
    throw new Error('event payload backfill destination reference hash mismatch');
  }
  const uniqueReferenceList = [...uniqueReferences.values()];
  const sidecarUniqueStoredBytes = uniqueReferenceList.reduce(
    (sum, reference) => sum + reference.storedByteLength,
    0,
  );
  const expectedEstimates: EventPayloadBackfillPlanUnsigned['estimates'] = {
    sqlitePayloadBytesBefore,
    sqlitePayloadBytesAfter,
    logicalSqlitePayloadBytesReduced: sqlitePayloadBytesBefore - sqlitePayloadBytesAfter,
    sidecarReferencedStoredBytes,
    sidecarUniqueStoredBytes,
    sidecarNewStoredBytes: uniqueReferenceList
      .filter((reference) => !existingHashes.has(reference.sha256))
      .reduce((sum, reference) => sum + reference.storedByteLength, 0),
    sidecarDeduplicatedStoredBytes: sidecarReferencedStoredBytes - sidecarUniqueStoredBytes,
  };
  if (JSON.stringify(expectedEstimates) !== JSON.stringify(plan.estimates)) {
    throw new Error('event payload backfill byte estimates do not reconcile');
  }
  if (hashJson(unsignedPlan(plan)) !== plan.planHash) {
    throw new Error('event payload backfill plan hash mismatch');
  }
}

export function assertEventPayloadBackfillPlanFresh(
  raw: BetterSQLite3Raw,
  plan: EventPayloadBackfillPlan,
): void {
  assertEventPayloadBackfillPlanIntegrity(plan);
  raw.transaction(() => {
    const currentSidecars = captureEventPayloadSidecarManifest(raw, plan.sidecarRootDirectory);
    if (eventPayloadSidecarManifestHash(currentSidecars) !== plan.sourceSidecarReferenceHash) {
      throw new Error('event payload sidecar references changed after backfill plan');
    }
    const current = scanEventPayloadBackfill(
      raw,
      plan.selector.minimumPayloadBytes,
      currentSidecars,
    );
    if (
      current.sourceSelectionHash !== plan.sourceSelectionHash ||
      current.destinationReferenceHash !== plan.scan.destinationReferenceHash
    ) {
      throw new Error('event payload backfill source references changed after plan');
    }
    if (hashJson(captureDatabaseMaintenanceFingerprint(raw)) !== hashJson(plan.sourceFingerprint)) {
      throw new Error('database changed after event payload backfill plan');
    }
  })();
}

function atomicWriteJson(path: string, value: unknown): void {
  const targetPath = resolve(path);
  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  renameSync(temporaryPath, targetPath);
}

export function writeEventPayloadBackfillPlan(path: string, plan: EventPayloadBackfillPlan): void {
  assertEventPayloadBackfillPlanIntegrity(plan);
  atomicWriteJson(path, plan);
}

export function readEventPayloadBackfillPlan(path: string): EventPayloadBackfillPlan {
  const plan = JSON.parse(readFileSync(resolve(path), 'utf8')) as EventPayloadBackfillPlan;
  assertEventPayloadBackfillPlanIntegrity(plan);
  return plan;
}
