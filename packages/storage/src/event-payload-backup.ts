import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { BetterSQLite3Raw } from './connection.js';
import {
  EventPayloadSidecarStore,
  parseStoredEventPayloadReference,
  validateEventPayloadReference,
  type EventPayloadReferenceV1,
} from './event-payload-sidecar.js';

export const EVENT_PAYLOAD_SIDECAR_MANIFEST_VERSION = 1 as const;
export const EVENT_PAYLOAD_SIDECAR_BACKUP_MANIFEST_NAME = 'event-payload-sidecars.manifest.json';

export interface EventPayloadSidecarBlobManifestEntry extends EventPayloadReferenceV1 {
  referenceCount: number;
}

export interface EventPayloadSidecarManifest {
  version: typeof EVENT_PAYLOAD_SIDECAR_MANIFEST_VERSION;
  sourceRootDirectory: string | null;
  eventReferenceCount: number;
  referenceHash: string;
  blobs: EventPayloadSidecarBlobManifestEntry[];
}

interface EventPayloadSidecarBackupManifestUnsigned {
  version: typeof EVENT_PAYLOAD_SIDECAR_MANIFEST_VERSION;
  eventReferenceCount: number;
  referenceHash: string;
  blobs: EventPayloadSidecarBlobManifestEntry[];
}

export interface EventPayloadSidecarBackupManifest extends EventPayloadSidecarBackupManifestUnsigned {
  manifestHash: string;
}

export interface EventPayloadSidecarBackupVerification {
  rootDirectory: string;
  manifestPath: string;
  manifestHash: string;
  eventReferenceCount: number;
  blobCount: number;
  storedBytes: number;
}

interface EventPayloadReferenceRow {
  id: string;
  payloadJson: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function eventPayloadSidecarManifestHash(manifest: EventPayloadSidecarManifest): string {
  assertEventPayloadSidecarManifestIntegrity(manifest);
  return hashJson(manifest);
}

function portableManifest(
  manifest: EventPayloadSidecarManifest,
): EventPayloadSidecarBackupManifestUnsigned {
  return {
    version: manifest.version,
    eventReferenceCount: manifest.eventReferenceCount,
    referenceHash: manifest.referenceHash,
    blobs: manifest.blobs,
  };
}

function assertBlobEntry(entry: EventPayloadSidecarBlobManifestEntry): void {
  validateEventPayloadReference(entry);
  if (!Number.isSafeInteger(entry.referenceCount) || entry.referenceCount < 1) {
    throw new Error('event payload sidecar blob referenceCount is invalid');
  }
}

export function assertEventPayloadSidecarManifestIntegrity(
  manifest: EventPayloadSidecarManifest,
): void {
  if (manifest.version !== EVENT_PAYLOAD_SIDECAR_MANIFEST_VERSION) {
    throw new Error('event payload sidecar manifest version is unsupported');
  }
  if (
    !Number.isSafeInteger(manifest.eventReferenceCount) ||
    manifest.eventReferenceCount < 0 ||
    !SHA256_PATTERN.test(manifest.referenceHash)
  ) {
    throw new Error('event payload sidecar manifest summary is invalid');
  }
  if (
    manifest.sourceRootDirectory !== null &&
    resolve(manifest.sourceRootDirectory) !== manifest.sourceRootDirectory
  ) {
    throw new Error('event payload sidecar source root must be absolute');
  }
  if (manifest.eventReferenceCount > 0 && manifest.sourceRootDirectory === null) {
    throw new Error('event payload sidecar root is required for external references');
  }
  const hashes = new Set<string>();
  let referenceCount = 0;
  let previousHash = '';
  for (const entry of manifest.blobs) {
    assertBlobEntry(entry);
    if (hashes.has(entry.sha256) || entry.sha256.localeCompare(previousHash) < 0) {
      throw new Error('event payload sidecar blob manifest is duplicated or unsorted');
    }
    hashes.add(entry.sha256);
    previousHash = entry.sha256;
    referenceCount += entry.referenceCount;
  }
  if (referenceCount !== manifest.eventReferenceCount) {
    throw new Error('event payload sidecar reference count does not match its blobs');
  }
}

export function captureEventPayloadSidecarManifest(
  raw: BetterSQLite3Raw,
  sidecarRootDirectory?: string,
): EventPayloadSidecarManifest {
  const rows = raw
    .prepare(
      `SELECT id, payload_json AS payloadJson
       FROM event
       WHERE json_valid(payload_json)
         AND json_type(payload_json, '$."$syncThinkPayload"') IS NOT NULL
       ORDER BY id ASC`,
    )
    .all() as EventPayloadReferenceRow[];
  const resolvedRoot =
    rows.length === 0
      ? null
      : sidecarRootDirectory === undefined
        ? null
        : resolve(sidecarRootDirectory);
  if (rows.length > 0 && resolvedRoot === null) {
    throw new Error('event payload sidecar root is required for external references');
  }

  const referenceDigest = createHash('sha256');
  const blobs = new Map<string, EventPayloadSidecarBlobManifestEntry>();
  for (const row of rows) {
    const reference = parseStoredEventPayloadReference(row.payloadJson);
    if (reference === undefined) {
      throw new Error(`event payload sidecar scan lost envelope for Event ${row.id}`);
    }
    referenceDigest.update(`${JSON.stringify([row.id, reference])}\n`);
    const existing = blobs.get(reference.sha256);
    if (existing !== undefined) {
      if (
        existing.relativePath !== reference.relativePath ||
        existing.byteLength !== reference.byteLength ||
        existing.storedByteLength !== reference.storedByteLength ||
        existing.codec !== reference.codec ||
        existing.compression !== reference.compression
      ) {
        throw new Error(`event payload sidecar metadata conflicts for ${reference.sha256}`);
      }
      existing.referenceCount += 1;
    } else {
      blobs.set(reference.sha256, { ...reference, referenceCount: 1 });
    }
  }

  const manifest: EventPayloadSidecarManifest = {
    version: EVENT_PAYLOAD_SIDECAR_MANIFEST_VERSION,
    sourceRootDirectory: resolvedRoot,
    eventReferenceCount: rows.length,
    referenceHash: referenceDigest.digest('hex'),
    blobs: [...blobs.values()].sort((left, right) => left.sha256.localeCompare(right.sha256)),
  };
  assertEventPayloadSidecarManifestIntegrity(manifest);
  if (manifest.sourceRootDirectory !== null) {
    const sidecar = new EventPayloadSidecarStore(manifest.sourceRootDirectory);
    for (const entry of manifest.blobs) sidecar.readPayload(entry);
  }
  return manifest;
}

function backupManifestFrom(
  manifest: EventPayloadSidecarManifest,
): EventPayloadSidecarBackupManifest {
  const unsigned = portableManifest(manifest);
  return { ...unsigned, manifestHash: hashJson(unsigned) };
}

function assertBackupManifestIntegrity(manifest: EventPayloadSidecarBackupManifest): void {
  const sourceShape: EventPayloadSidecarManifest = {
    version: manifest.version,
    sourceRootDirectory: manifest.eventReferenceCount === 0 ? null : resolve('.'),
    eventReferenceCount: manifest.eventReferenceCount,
    referenceHash: manifest.referenceHash,
    blobs: manifest.blobs,
  };
  assertEventPayloadSidecarManifestIntegrity(sourceShape);
  if (hashJson(portableManifest(sourceShape)) !== manifest.manifestHash) {
    throw new Error('event payload sidecar backup manifest hash mismatch');
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  renameSync(temporaryPath, path);
}

export function readEventPayloadSidecarBackupManifest(
  manifestPath: string,
): EventPayloadSidecarBackupManifest {
  const parsed = JSON.parse(
    readFileSync(resolve(manifestPath), 'utf8'),
  ) as EventPayloadSidecarBackupManifest;
  assertBackupManifestIntegrity(parsed);
  return parsed;
}

function verificationDescriptor(
  rootDirectory: string,
  manifest: EventPayloadSidecarBackupManifest,
): EventPayloadSidecarBackupVerification {
  return {
    rootDirectory,
    manifestPath: join(rootDirectory, EVENT_PAYLOAD_SIDECAR_BACKUP_MANIFEST_NAME),
    manifestHash: manifest.manifestHash,
    eventReferenceCount: manifest.eventReferenceCount,
    blobCount: manifest.blobs.length,
    storedBytes: manifest.blobs.reduce((sum, entry) => sum + entry.storedByteLength, 0),
  };
}

export function createEventPayloadSidecarBackup(
  expected: EventPayloadSidecarManifest,
  destinationRootDirectory: string,
): EventPayloadSidecarBackupVerification {
  assertEventPayloadSidecarManifestIntegrity(expected);
  const destinationRoot = resolve(destinationRootDirectory);
  if (existsSync(destinationRoot)) {
    throw new Error('event payload sidecar backup destination already exists');
  }
  const temporaryRoot = `${destinationRoot}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(temporaryRoot, { recursive: true });
  try {
    if (expected.sourceRootDirectory !== null) {
      const sourceStore = new EventPayloadSidecarStore(expected.sourceRootDirectory);
      for (const entry of expected.blobs) {
        sourceStore.readPayload(entry);
        const sourcePath = resolve(expected.sourceRootDirectory, ...entry.relativePath.split('/'));
        const destinationPath = resolve(temporaryRoot, ...entry.relativePath.split('/'));
        mkdirSync(dirname(destinationPath), { recursive: true });
        copyFileSync(sourcePath, destinationPath);
      }
    }
    const portable = backupManifestFrom(expected);
    const temporaryManifestPath = join(temporaryRoot, EVENT_PAYLOAD_SIDECAR_BACKUP_MANIFEST_NAME);
    atomicWriteJson(temporaryManifestPath, portable);
    const destinationStore = new EventPayloadSidecarStore(temporaryRoot);
    for (const entry of portable.blobs) destinationStore.readPayload(entry);
    mkdirSync(dirname(destinationRoot), { recursive: true });
    renameSync(temporaryRoot, destinationRoot);
    return verificationDescriptor(destinationRoot, portable);
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export function verifyEventPayloadSidecarBackup(
  backupRaw: BetterSQLite3Raw,
  expected: EventPayloadSidecarManifest,
  backupRootDirectory: string,
): EventPayloadSidecarBackupVerification {
  assertEventPayloadSidecarManifestIntegrity(expected);
  const backupRoot = resolve(backupRootDirectory);
  const manifestPath = join(backupRoot, EVENT_PAYLOAD_SIDECAR_BACKUP_MANIFEST_NAME);
  const portable = readEventPayloadSidecarBackupManifest(manifestPath);
  if (portable.manifestHash !== backupManifestFrom(expected).manifestHash) {
    throw new Error('event payload sidecar backup does not match the maintenance manifest');
  }
  const actual = captureEventPayloadSidecarManifest(backupRaw, backupRoot);
  if (hashJson(portableManifest(actual)) !== hashJson(portableManifest(expected))) {
    throw new Error('event payload sidecar backup references do not match the database');
  }
  for (const entry of portable.blobs) {
    const path = resolve(backupRoot, ...entry.relativePath.split('/'));
    if (!existsSync(path) || statSync(path).size !== entry.storedByteLength) {
      throw new Error(`event payload sidecar backup blob is missing for ${entry.sha256}`);
    }
  }
  return verificationDescriptor(backupRoot, portable);
}
