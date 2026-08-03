import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export const EVENT_PAYLOAD_ENVELOPE_KEY = '$syncThinkPayload';
export const EVENT_PAYLOAD_ENVELOPE_VERSION = 1;

export type EventPayloadSidecarErrorCode =
  | 'event-payload.sidecar-required'
  | 'event-payload.invalid-envelope'
  | 'event-payload.missing'
  | 'event-payload.corrupt';

export class EventPayloadSidecarError extends Error {
  constructor(
    readonly code: EventPayloadSidecarErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EventPayloadSidecarError';
  }
}

export interface EventPayloadReferenceV1 {
  version: 1;
  storage: 'sidecar';
  codec: 'json-utf8';
  compression: 'gzip';
  sha256: string;
  byteLength: number;
  storedByteLength: number;
  relativePath: string;
}

export interface EventPayloadEnvelopeV1 {
  [EVENT_PAYLOAD_ENVELOPE_KEY]: EventPayloadReferenceV1;
  projection: Record<string, unknown>;
}

export interface EventPayloadSidecarWritePlan {
  envelope: EventPayloadEnvelopeV1;
  payloadBytes: Buffer;
  storedBytes: Buffer;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(json: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new EventPayloadSidecarError(
      'event-payload.corrupt',
      `${field} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new EventPayloadSidecarError(
      'event-payload.corrupt',
      `${field} must contain a JSON object`,
    );
  }
  return parsed;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedRelativePath(hash: string): string {
  return `v1/sha256/${hash.slice(0, 2)}/${hash}.json.gz`;
}

export function validateEventPayloadReference(value: unknown): EventPayloadReferenceV1 {
  if (!isRecord(value)) {
    throw new EventPayloadSidecarError(
      'event-payload.invalid-envelope',
      'event payload reference must be an object',
    );
  }
  const reference = value as Partial<EventPayloadReferenceV1>;
  if (
    reference.version !== EVENT_PAYLOAD_ENVELOPE_VERSION ||
    reference.storage !== 'sidecar' ||
    reference.codec !== 'json-utf8' ||
    reference.compression !== 'gzip' ||
    typeof reference.sha256 !== 'string' ||
    !SHA256_PATTERN.test(reference.sha256) ||
    !Number.isSafeInteger(reference.byteLength) ||
    Number(reference.byteLength) < 2 ||
    !Number.isSafeInteger(reference.storedByteLength) ||
    Number(reference.storedByteLength) < 1 ||
    typeof reference.relativePath !== 'string' ||
    reference.relativePath !== expectedRelativePath(reference.sha256)
  ) {
    throw new EventPayloadSidecarError(
      'event-payload.invalid-envelope',
      'event payload reference is invalid or uses an unsupported version',
    );
  }
  return reference as EventPayloadReferenceV1;
}

export function isEventPayloadEnvelope(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, EVENT_PAYLOAD_ENVELOPE_KEY);
}

export function parseStoredEventPayloadReference(
  payloadJson: string,
): EventPayloadReferenceV1 | undefined {
  const parsed = parseJsonObject(payloadJson, 'event.payload_json');
  if (!isEventPayloadEnvelope(parsed)) return undefined;
  if (!isRecord(parsed.projection)) {
    throw new EventPayloadSidecarError(
      'event-payload.invalid-envelope',
      'event payload envelope projection must be an object',
    );
  }
  return validateEventPayloadReference(parsed[EVENT_PAYLOAD_ENVELOPE_KEY]);
}

export function planEventPayloadSidecarWrite(
  payloadJson: string,
  projection: Record<string, unknown> = {},
): EventPayloadSidecarWritePlan {
  const payload = parseJsonObject(payloadJson, 'event payload');
  if (isEventPayloadEnvelope(payload)) {
    throw new EventPayloadSidecarError(
      'event-payload.invalid-envelope',
      `${EVENT_PAYLOAD_ENVELOPE_KEY} is reserved for sidecar references`,
    );
  }
  if (!isRecord(projection)) {
    throw new EventPayloadSidecarError(
      'event-payload.invalid-envelope',
      'event payload projection must be an object',
    );
  }

  const payloadBytes = Buffer.from(payloadJson, 'utf8');
  const storedBytes = gzipSync(payloadBytes, { level: 9 });
  const hash = sha256(payloadBytes);
  const reference: EventPayloadReferenceV1 = {
    version: EVENT_PAYLOAD_ENVELOPE_VERSION,
    storage: 'sidecar',
    codec: 'json-utf8',
    compression: 'gzip',
    sha256: hash,
    byteLength: payloadBytes.byteLength,
    storedByteLength: storedBytes.byteLength,
    relativePath: expectedRelativePath(hash),
  };
  return {
    envelope: {
      [EVENT_PAYLOAD_ENVELOPE_KEY]: reference,
      projection: { ...projection },
    },
    payloadBytes,
    storedBytes,
  };
}

export class EventPayloadSidecarStore {
  readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  writePayloadJson(
    payloadJson: string,
    projection: Record<string, unknown> = {},
  ): EventPayloadEnvelopeV1 {
    const planned = planEventPayloadSidecarWrite(payloadJson, projection);
    const reference = planned.envelope[EVENT_PAYLOAD_ENVELOPE_KEY];
    const targetPath = this.resolveReferencePath(reference.relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });

    if (!existsSync(targetPath)) {
      const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
      let descriptor: number | undefined;
      try {
        descriptor = openSync(temporaryPath, 'wx', 0o600);
        writeFileSync(descriptor, planned.storedBytes);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(temporaryPath, targetPath);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        rmSync(temporaryPath, { force: true });
        if (!existsSync(targetPath)) throw error;
      }
    }

    const actualReference: EventPayloadReferenceV1 = {
      ...reference,
      storedByteLength: statSync(targetPath).size,
    };
    this.readPayload(actualReference);
    return {
      [EVENT_PAYLOAD_ENVELOPE_KEY]: actualReference,
      projection: { ...planned.envelope.projection },
    };
  }

  readPayload(referenceInput: EventPayloadReferenceV1): Record<string, unknown> {
    const reference = validateEventPayloadReference(referenceInput);
    const targetPath = this.resolveReferencePath(reference.relativePath);
    if (!existsSync(targetPath)) {
      throw new EventPayloadSidecarError(
        'event-payload.missing',
        `event payload sidecar is missing for ${reference.sha256}`,
      );
    }
    const storedBytes = readFileSync(targetPath);
    if (storedBytes.byteLength !== reference.storedByteLength) {
      throw new EventPayloadSidecarError(
        'event-payload.corrupt',
        `event payload sidecar size mismatch for ${reference.sha256}`,
      );
    }

    let rawBytes: Buffer;
    try {
      rawBytes = gunzipSync(storedBytes);
    } catch (error) {
      throw new EventPayloadSidecarError(
        'event-payload.corrupt',
        `event payload sidecar decompression failed for ${reference.sha256}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (rawBytes.byteLength !== reference.byteLength || sha256(rawBytes) !== reference.sha256) {
      throw new EventPayloadSidecarError(
        'event-payload.corrupt',
        `event payload sidecar digest mismatch for ${reference.sha256}`,
      );
    }
    return parseJsonObject(rawBytes.toString('utf8'), 'event payload sidecar');
  }

  resolveEnvelope(envelopeInput: Record<string, unknown>): Record<string, unknown> {
    if (!isEventPayloadEnvelope(envelopeInput)) return envelopeInput;
    if (!isRecord(envelopeInput.projection)) {
      throw new EventPayloadSidecarError(
        'event-payload.invalid-envelope',
        'event payload envelope projection must be an object',
      );
    }
    return this.readPayload(
      validateEventPayloadReference(envelopeInput[EVENT_PAYLOAD_ENVELOPE_KEY]),
    );
  }

  private resolveReferencePath(relativePath: string): string {
    const targetPath = resolve(this.rootDirectory, ...relativePath.split('/'));
    const rootPrefix = `${this.rootDirectory}${this.rootDirectory.endsWith(sep) ? '' : sep}`;
    if (!targetPath.startsWith(rootPrefix)) {
      throw new EventPayloadSidecarError(
        'event-payload.invalid-envelope',
        'event payload reference escapes the sidecar root',
      );
    }
    return targetPath;
  }
}

export function parseStoredEventPayload(
  payloadJson: string,
  sidecar?: EventPayloadSidecarStore,
): Record<string, unknown> {
  const parsed = parseJsonObject(payloadJson, 'event.payload_json');
  if (!isEventPayloadEnvelope(parsed)) return parsed;
  if (!sidecar) {
    throw new EventPayloadSidecarError(
      'event-payload.sidecar-required',
      'event payload requires its configured sidecar store',
    );
  }
  return sidecar.resolveEnvelope(parsed);
}
