import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { BetterSQLite3Raw } from './connection.js';
import {
  captureEventPayloadSidecarManifest,
  eventPayloadSidecarManifestHash,
  type EventPayloadSidecarManifest,
} from './event-payload-backup.js';
import {
  captureDatabaseMaintenanceFingerprint,
  type DatabaseMaintenanceFingerprint,
} from './database-maintenance-executor.js';

export const EVENT_PAYLOAD_SIDECAR_GC_MANIFEST_VERSION = 1 as const;
export const EVENT_PAYLOAD_SIDECAR_GC_AUDIT_VERSION = 1 as const;
export const DEFAULT_EVENT_PAYLOAD_SIDECAR_GC_BATCH_SIZE = 100;
export const MAX_EVENT_PAYLOAD_SIDECAR_GC_BATCH_SIZE = 5_000;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PREFIX_PATTERN = /^[a-f0-9]{2}$/;
const BLOB_NAME_PATTERN = /^([a-f0-9]{64})\.json\.gz$/;
const SWEEP_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export interface EventPayloadSidecarOrphanEntry {
  sha256: string;
  byteLength: number;
  storedByteLength: number;
  storedSha256: string;
  modifiedAtMs: number;
  relativePath: string;
}

interface EventPayloadSidecarGcManifestUnsigned {
  version: typeof EVENT_PAYLOAD_SIDECAR_GC_MANIFEST_VERSION;
  sweepId: string;
  generatedAt: string;
  databasePath: string;
  sidecarRootDirectory: string;
  sourceFingerprint: DatabaseMaintenanceFingerprint;
  liveReferences: EventPayloadSidecarManifest;
  liveReferencesHash: string;
  orphans: EventPayloadSidecarOrphanEntry[];
}

export interface EventPayloadSidecarGcManifest extends EventPayloadSidecarGcManifestUnsigned {
  manifestHash: string;
  confirmationToken: string;
}

export interface EventPayloadSidecarGcAudit {
  version: typeof EVENT_PAYLOAD_SIDECAR_GC_AUDIT_VERSION;
  sweepId: string;
  manifestHash: string;
  databasePath: string;
  sidecarRootDirectory: string;
  auditPath: string;
  quarantineDirectory: string;
  status: 'running' | 'cancelled' | 'completed' | 'failed';
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  progress: {
    orphanCount: number;
    nextOrphanIndex: number;
    blobsQuarantined: number;
    blobsAlreadyQuarantined: number;
    bytesQuarantined: number;
    batchesCommitted: number;
  };
  error?: string;
}

export interface PrepareEventPayloadSidecarGcManifestOptions {
  databasePath: string;
  sidecarRootDirectory: string;
  sweepId?: string;
  now?: () => Date;
}

export interface ExecuteEventPayloadSidecarGcOptions {
  manifest: EventPayloadSidecarGcManifest;
  confirmationToken: string;
  maintenanceWindowConfirmed: boolean;
  auditPath?: string;
  batchSize?: number;
  now?: () => Date;
  signal?: AbortSignal;
  onBatchFilesMoved?: (audit: EventPayloadSidecarGcAudit) => void;
  onBatchCommitted?: (audit: EventPayloadSidecarGcAudit) => void;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashJson(value: unknown): string {
  return hashBytes(Buffer.from(JSON.stringify(value), 'utf8'));
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function assertWithin(root: string, target: string): void {
  const absoluteRoot = resolve(root);
  const prefix = `${absoluteRoot}${absoluteRoot.endsWith(sep) ? '' : sep}`.toLowerCase();
  if (!resolve(target).toLowerCase().startsWith(prefix)) {
    throw new Error('event payload sidecar GC path escaped its governed directory');
  }
}

function assertPlainDirectory(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a plain directory without links or reparse points`);
  }
}

function assertPlainFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a plain file without links or reparse points`);
  }
}

function assertPlainDirectoryChain(root: string, directory: string, label: string): void {
  const absoluteRoot = resolve(root);
  const absoluteDirectory = resolve(directory);
  if (!samePath(absoluteRoot, absoluteDirectory)) assertWithin(absoluteRoot, absoluteDirectory);
  if (!existsSync(absoluteRoot)) throw new Error(`${label} root is missing`);
  assertPlainDirectory(absoluteRoot, `${label} root`);
  const relative = absoluteDirectory.slice(absoluteRoot.length).split(sep).filter(Boolean);
  let current = absoluteRoot;
  for (const part of relative) {
    current = join(current, part);
    if (!existsSync(current)) break;
    assertPlainDirectory(current, label);
  }
}

function blobIdentity(root: string, relativePath: string): EventPayloadSidecarOrphanEntry {
  const match = BLOB_NAME_PATTERN.exec(relativePath.split('/').at(-1) ?? '');
  if (!match) throw new Error(`uncontrolled event payload sidecar path: ${relativePath}`);
  const sha256 = match[1]!;
  const expected = `v1/sha256/${sha256.slice(0, 2)}/${sha256}.json.gz`;
  if (relativePath !== expected) throw new Error(`event payload sidecar path/hash mismatch: ${relativePath}`);
  const path = resolve(root, ...relativePath.split('/'));
  assertWithin(root, path);
  assertPlainFile(path, 'event payload sidecar blob');
  const stat = lstatSync(path);
  const stored = readFileSync(path);
  let payload: Buffer;
  try {
    payload = gunzipSync(stored);
  } catch (error) {
    throw new Error(`event payload sidecar decompression failed for ${sha256}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (hashBytes(payload) !== sha256) throw new Error(`event payload sidecar digest mismatch for ${sha256}`);
  try {
    const parsed = JSON.parse(payload.toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('payload is not an object');
  } catch (error) {
    throw new Error(`event payload sidecar JSON is invalid for ${sha256}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    sha256,
    byteLength: payload.byteLength,
    storedByteLength: stored.byteLength,
    storedSha256: hashBytes(stored),
    modifiedAtMs: stat.mtimeMs,
    relativePath,
  };
}

function enumerateGovernedBlobs(rootDirectory: string): EventPayloadSidecarOrphanEntry[] {
  const root = resolve(rootDirectory);
  if (!existsSync(root)) return [];
  assertPlainDirectory(root, 'event payload sidecar root');
  const rootEntries = readdirSync(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.name !== 'v1' && entry.name !== '.quarantine') {
      throw new Error(`uncontrolled entry in event payload sidecar root: ${entry.name}`);
    }
    const path = join(root, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`event payload sidecar root entry is not a plain directory: ${entry.name}`);
    assertPlainDirectory(path, 'event payload sidecar root entry');
  }
  const v1 = join(root, 'v1');
  if (!existsSync(v1)) return [];
  const v1Entries = readdirSync(v1, { withFileTypes: true });
  if (v1Entries.some((entry) => entry.name !== 'sha256' || entry.isSymbolicLink() || !entry.isDirectory())) {
    throw new Error('uncontrolled layout under event payload sidecar v1 directory');
  }
  const hashRoot = join(v1, 'sha256');
  if (!existsSync(hashRoot)) return [];
  assertPlainDirectory(hashRoot, 'event payload sidecar hash root');
  const blobs: EventPayloadSidecarOrphanEntry[] = [];
  for (const prefix of readdirSync(hashRoot, { withFileTypes: true })) {
    if (!PREFIX_PATTERN.test(prefix.name) || prefix.isSymbolicLink() || !prefix.isDirectory()) {
      throw new Error(`uncontrolled event payload sidecar hash prefix: ${prefix.name}`);
    }
    const prefixPath = join(hashRoot, prefix.name);
    assertPlainDirectory(prefixPath, 'event payload sidecar hash prefix');
    for (const file of readdirSync(prefixPath, { withFileTypes: true })) {
      if (file.isSymbolicLink() || !file.isFile() || !BLOB_NAME_PATTERN.test(file.name)) {
        throw new Error(`uncontrolled event payload sidecar blob entry: ${prefix.name}/${file.name}`);
      }
      blobs.push(blobIdentity(root, `v1/sha256/${prefix.name}/${file.name}`));
    }
  }
  return blobs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function unsignedManifest(manifest: EventPayloadSidecarGcManifest): EventPayloadSidecarGcManifestUnsigned {
  return {
    version: manifest.version,
    sweepId: manifest.sweepId,
    generatedAt: manifest.generatedAt,
    databasePath: manifest.databasePath,
    sidecarRootDirectory: manifest.sidecarRootDirectory,
    sourceFingerprint: manifest.sourceFingerprint,
    liveReferences: manifest.liveReferences,
    liveReferencesHash: manifest.liveReferencesHash,
    orphans: manifest.orphans,
  };
}

export function expectedEventPayloadSidecarGcConfirmationToken(
  manifest: Pick<EventPayloadSidecarGcManifest, 'sweepId' | 'manifestHash'>,
): string {
  return `QUARANTINE-EVENT-PAYLOAD-ORPHANS:${manifest.sweepId}:${manifest.manifestHash.slice(0, 16)}`;
}

export function assertEventPayloadSidecarGcManifestIntegrity(manifest: EventPayloadSidecarGcManifest): void {
  if (
    manifest.version !== EVENT_PAYLOAD_SIDECAR_GC_MANIFEST_VERSION ||
    !SWEEP_ID_PATTERN.test(manifest.sweepId) ||
    resolve(manifest.databasePath) !== manifest.databasePath ||
    resolve(manifest.sidecarRootDirectory) !== manifest.sidecarRootDirectory ||
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    !HASH_PATTERN.test(manifest.liveReferencesHash) ||
    eventPayloadSidecarManifestHash(manifest.liveReferences) !== manifest.liveReferencesHash ||
    !samePath(manifest.liveReferences.sourceRootDirectory ?? manifest.sidecarRootDirectory, manifest.sidecarRootDirectory)
  ) throw new Error('event payload sidecar GC manifest metadata is invalid');
  let previous = '';
  const seen = new Set<string>();
  const liveHashes = new Set(manifest.liveReferences.blobs.map((blob) => blob.sha256));
  for (const orphan of manifest.orphans) {
    const expectedPath = `v1/sha256/${orphan.sha256.slice(0, 2)}/${orphan.sha256}.json.gz`;
    if (
      !HASH_PATTERN.test(orphan.sha256) || !HASH_PATTERN.test(orphan.storedSha256) ||
      orphan.relativePath !== expectedPath || seen.has(orphan.sha256) || liveHashes.has(orphan.sha256) ||
      orphan.relativePath.localeCompare(previous) < 0 ||
      !Number.isSafeInteger(orphan.byteLength) || orphan.byteLength < 2 ||
      !Number.isSafeInteger(orphan.storedByteLength) || orphan.storedByteLength < 1 ||
      !Number.isFinite(orphan.modifiedAtMs) || orphan.modifiedAtMs < 0
    ) throw new Error('event payload sidecar GC orphan identity is invalid');
    seen.add(orphan.sha256);
    previous = orphan.relativePath;
  }
  if (hashJson(unsignedManifest(manifest)) !== manifest.manifestHash) {
    throw new Error('event payload sidecar GC manifest hash mismatch');
  }
  if (manifest.confirmationToken !== expectedEventPayloadSidecarGcConfirmationToken(manifest)) {
    throw new Error('event payload sidecar GC confirmation token mismatch');
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, absolute);
}

export function writeEventPayloadSidecarGcManifest(path: string, manifest: EventPayloadSidecarGcManifest): void {
  assertEventPayloadSidecarGcManifestIntegrity(manifest);
  atomicWriteJson(path, manifest);
}

export function readEventPayloadSidecarGcManifest(path: string): EventPayloadSidecarGcManifest {
  const manifest = JSON.parse(readFileSync(resolve(path), 'utf8')) as EventPayloadSidecarGcManifest;
  assertEventPayloadSidecarGcManifestIntegrity(manifest);
  return manifest;
}

export function prepareEventPayloadSidecarGcManifest(
  raw: BetterSQLite3Raw,
  options: PrepareEventPayloadSidecarGcManifestOptions,
): EventPayloadSidecarGcManifest {
  const databasePath = resolve(options.databasePath);
  const sidecarRootDirectory = resolve(options.sidecarRootDirectory);
  const liveReferences = captureEventPayloadSidecarManifest(raw, sidecarRootDirectory);
  const liveHashes = new Set(liveReferences.blobs.map((blob) => blob.sha256));
  const orphans = enumerateGovernedBlobs(sidecarRootDirectory).filter((blob) => !liveHashes.has(blob.sha256));
  const unsigned: EventPayloadSidecarGcManifestUnsigned = {
    version: EVENT_PAYLOAD_SIDECAR_GC_MANIFEST_VERSION,
    sweepId: options.sweepId ?? randomUUID(),
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    databasePath,
    sidecarRootDirectory,
    sourceFingerprint: captureDatabaseMaintenanceFingerprint(raw),
    liveReferences,
    liveReferencesHash: eventPayloadSidecarManifestHash(liveReferences),
    orphans,
  };
  const manifestHash = hashJson(unsigned);
  const manifest: EventPayloadSidecarGcManifest = {
    ...unsigned,
    manifestHash,
    confirmationToken: `QUARANTINE-EVENT-PAYLOAD-ORPHANS:${unsigned.sweepId}:${manifestHash.slice(0, 16)}`,
  };
  assertEventPayloadSidecarGcManifestIntegrity(manifest);
  return manifest;
}

function fingerprintsMatch(left: DatabaseMaintenanceFingerprint, right: DatabaseMaintenanceFingerprint): boolean {
  return hashJson(left) === hashJson(right);
}

function assertManifestFresh(raw: BetterSQLite3Raw, manifest: EventPayloadSidecarGcManifest): void {
  enumerateGovernedBlobs(manifest.sidecarRootDirectory);
  const fingerprint = captureDatabaseMaintenanceFingerprint(raw);
  if (!fingerprintsMatch(fingerprint, manifest.sourceFingerprint)) throw new Error('database changed after event payload sidecar GC mark');
  const live = captureEventPayloadSidecarManifest(raw, manifest.sidecarRootDirectory);
  if (eventPayloadSidecarManifestHash(live) !== manifest.liveReferencesHash) {
    throw new Error('event payload sidecar references changed after GC mark');
  }
}

function sameIdentity(actual: EventPayloadSidecarOrphanEntry, expected: EventPayloadSidecarOrphanEntry): boolean {
  return hashJson(actual) === hashJson(expected);
}

function quarantineDirectory(manifest: EventPayloadSidecarGcManifest): string {
  return resolve(manifest.sidecarRootDirectory, '.quarantine', manifest.sweepId);
}

function entryLocations(manifest: EventPayloadSidecarGcManifest, entry: EventPayloadSidecarOrphanEntry): { source: string; target: string } {
  const source = resolve(manifest.sidecarRootDirectory, ...entry.relativePath.split('/'));
  const targetRoot = quarantineDirectory(manifest);
  const target = resolve(targetRoot, ...entry.relativePath.split('/'));
  assertWithin(manifest.sidecarRootDirectory, source);
  assertWithin(targetRoot, target);
  assertPlainDirectoryChain(manifest.sidecarRootDirectory, dirname(source), 'event payload sidecar source directory');
  assertPlainDirectoryChain(manifest.sidecarRootDirectory, dirname(target), 'event payload sidecar quarantine directory');
  return { source, target };
}

function verifyIdentityAt(root: string, path: string, entry: EventPayloadSidecarOrphanEntry): void {
  const relative = path.slice(`${resolve(root)}${sep}`.length).split(sep).join('/');
  const actual = blobIdentity(root, relative);
  if (!sameIdentity(actual, entry)) throw new Error(`event payload sidecar orphan identity changed for ${entry.sha256}`);
}

function assertSweepState(manifest: EventPayloadSidecarGcManifest, audit: EventPayloadSidecarGcAudit): void {
  for (let index = 0; index < manifest.orphans.length; index += 1) {
    const entry = manifest.orphans[index]!;
    const { source, target } = entryLocations(manifest, entry);
    const sourceExists = existsSync(source);
    const targetExists = existsSync(target);
    if (sourceExists && targetExists) throw new Error(`event payload sidecar orphan exists in both source and quarantine: ${entry.sha256}`);
    if (index < audit.progress.nextOrphanIndex) {
      if (!targetExists) throw new Error(`processed event payload sidecar orphan is missing from quarantine: ${entry.sha256}`);
      verifyIdentityAt(quarantineDirectory(manifest), target, entry);
    } else if (sourceExists) {
      verifyIdentityAt(manifest.sidecarRootDirectory, source, entry);
    } else if (targetExists) {
      verifyIdentityAt(quarantineDirectory(manifest), target, entry);
    } else {
      throw new Error(`event payload sidecar orphan is missing: ${entry.sha256}`);
    }
  }
}

function initialAudit(manifest: EventPayloadSidecarGcManifest, auditPath: string, now: () => Date): EventPayloadSidecarGcAudit {
  const timestamp = now().toISOString();
  return {
    version: EVENT_PAYLOAD_SIDECAR_GC_AUDIT_VERSION,
    sweepId: manifest.sweepId,
    manifestHash: manifest.manifestHash,
    databasePath: manifest.databasePath,
    sidecarRootDirectory: manifest.sidecarRootDirectory,
    auditPath,
    quarantineDirectory: quarantineDirectory(manifest),
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
    progress: {
      orphanCount: manifest.orphans.length,
      nextOrphanIndex: 0,
      blobsQuarantined: 0,
      blobsAlreadyQuarantined: 0,
      bytesQuarantined: 0,
      batchesCommitted: 0,
    },
  };
}

function readAudit(path: string): EventPayloadSidecarGcAudit | undefined {
  if (!existsSync(path)) return undefined;
  const audit = JSON.parse(readFileSync(path, 'utf8')) as EventPayloadSidecarGcAudit;
  if (audit.version !== EVENT_PAYLOAD_SIDECAR_GC_AUDIT_VERSION) throw new Error('event payload sidecar GC audit version is unsupported');
  return audit;
}

function assertAuditMatches(audit: EventPayloadSidecarGcAudit, manifest: EventPayloadSidecarGcManifest, auditPath: string): void {
  const progress = audit.progress;
  const startedAt = Date.parse(audit.startedAt);
  const updatedAt = Date.parse(audit.updatedAt);
  const completedAt = audit.completedAt === undefined ? undefined : Date.parse(audit.completedAt);
  const expectedBytes = manifest.orphans
    .slice(0, progress.nextOrphanIndex)
    .reduce((total, entry) => total + entry.storedByteLength, 0);
  const completionIsValid = audit.status === 'completed'
    ? Number.isFinite(completedAt) && completedAt! >= startedAt && completedAt! <= updatedAt &&
      progress.nextOrphanIndex === manifest.orphans.length
    : audit.completedAt === undefined;
  const errorIsValid = audit.status === 'failed'
    ? typeof audit.error === 'string' && audit.error.length > 0
    : audit.error === undefined;
  if (
    audit.version !== EVENT_PAYLOAD_SIDECAR_GC_AUDIT_VERSION ||
    audit.sweepId !== manifest.sweepId || audit.manifestHash !== manifest.manifestHash ||
    !samePath(audit.databasePath, manifest.databasePath) ||
    !samePath(audit.sidecarRootDirectory, manifest.sidecarRootDirectory) ||
    !samePath(audit.auditPath, auditPath) ||
    !samePath(audit.quarantineDirectory, quarantineDirectory(manifest)) ||
    !['running', 'cancelled', 'completed', 'failed'].includes(audit.status) ||
    !Number.isFinite(startedAt) || !Number.isFinite(updatedAt) || updatedAt < startedAt ||
    !completionIsValid || !errorIsValid ||
    progress.orphanCount !== manifest.orphans.length ||
    !Number.isSafeInteger(progress.nextOrphanIndex) || progress.nextOrphanIndex < 0 || progress.nextOrphanIndex > manifest.orphans.length ||
    !Number.isSafeInteger(progress.blobsQuarantined) || progress.blobsQuarantined < 0 ||
    !Number.isSafeInteger(progress.blobsAlreadyQuarantined) || progress.blobsAlreadyQuarantined < 0 ||
    progress.blobsQuarantined + progress.blobsAlreadyQuarantined !== progress.nextOrphanIndex ||
    !Number.isSafeInteger(progress.bytesQuarantined) || progress.bytesQuarantined !== expectedBytes ||
    !Number.isSafeInteger(progress.batchesCommitted) || progress.batchesCommitted < 0 || progress.batchesCommitted > progress.nextOrphanIndex
  ) throw new Error('event payload sidecar GC audit does not match the manifest');
}

function updateAudit(audit: EventPayloadSidecarGcAudit, now: () => Date, update: (current: EventPayloadSidecarGcAudit) => void): void {
  update(audit);
  audit.updatedAt = now().toISOString();
  atomicWriteJson(audit.auditPath, audit);
}

export async function executeEventPayloadSidecarGc(
  raw: BetterSQLite3Raw,
  options: ExecuteEventPayloadSidecarGcOptions,
): Promise<EventPayloadSidecarGcAudit> {
  const { manifest } = options;
  assertEventPayloadSidecarGcManifestIntegrity(manifest);
  if (!options.maintenanceWindowConfirmed) throw new Error('event payload sidecar GC requires an explicit offline maintenance window');
  if (options.confirmationToken !== expectedEventPayloadSidecarGcConfirmationToken(manifest)) throw new Error('event payload sidecar GC explicit confirmation did not match');
  assertManifestFresh(raw, manifest);
  const now = options.now ?? (() => new Date());
  const batchSize = Math.max(1, Math.min(options.batchSize ?? DEFAULT_EVENT_PAYLOAD_SIDECAR_GC_BATCH_SIZE, MAX_EVENT_PAYLOAD_SIDECAR_GC_BATCH_SIZE));
  const auditPath = resolve(options.auditPath ?? resolve(dirname(manifest.databasePath), 'sidecar-gc-audits', `${manifest.sweepId}.audit.json`));
  const audit = readAudit(auditPath) ?? initialAudit(manifest, auditPath, now);
  try {
    assertAuditMatches(audit, manifest, auditPath);
    assertSweepState(manifest, audit);
    if (audit.status === 'completed') return audit;
    if (!existsSync(auditPath)) atomicWriteJson(auditPath, audit);
    if (audit.status !== 'running') updateAudit(audit, now, (current) => { current.status = 'running'; delete current.error; });
    while (audit.progress.nextOrphanIndex < manifest.orphans.length) {
      if (options.signal?.aborted) {
        updateAudit(audit, now, (current) => { current.status = 'cancelled'; });
        return audit;
      }
      const batch = manifest.orphans.slice(audit.progress.nextOrphanIndex, audit.progress.nextOrphanIndex + batchSize);
      let quarantined = 0;
      let alreadyQuarantined = 0;
      let bytes = 0;
      for (const entry of batch) {
        const { source, target } = entryLocations(manifest, entry);
        if (existsSync(target)) {
          if (existsSync(source)) throw new Error(`event payload sidecar orphan exists in source and quarantine: ${entry.sha256}`);
          verifyIdentityAt(quarantineDirectory(manifest), target, entry);
          alreadyQuarantined += 1;
          bytes += entry.storedByteLength;
          continue;
        }
        verifyIdentityAt(manifest.sidecarRootDirectory, source, entry);
        mkdirSync(dirname(target), { recursive: true });
        assertPlainDirectoryChain(manifest.sidecarRootDirectory, dirname(target), 'event payload sidecar quarantine directory');
        renameSync(source, target);
        verifyIdentityAt(quarantineDirectory(manifest), target, entry);
        quarantined += 1;
        bytes += entry.storedByteLength;
      }
      options.onBatchFilesMoved?.(audit);
      updateAudit(audit, now, (current) => {
        current.progress.nextOrphanIndex += batch.length;
        current.progress.blobsQuarantined += quarantined;
        current.progress.blobsAlreadyQuarantined += alreadyQuarantined;
        current.progress.bytesQuarantined += bytes;
        current.progress.batchesCommitted += 1;
      });
      options.onBatchCommitted?.(audit);
    }
    assertManifestFresh(raw, manifest);
    assertSweepState(manifest, audit);
    updateAudit(audit, now, (current) => { current.status = 'completed'; current.completedAt = now().toISOString(); });
    return audit;
  } catch (error) {
    if (!existsSync(auditPath)) atomicWriteJson(auditPath, audit);
    updateAudit(audit, now, (current) => { current.status = 'failed'; current.error = error instanceof Error ? error.message : 'event payload sidecar GC failed'; });
    throw error;
  }
}
