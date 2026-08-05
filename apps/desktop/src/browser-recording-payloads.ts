import type {
  GetBrowserRecordingPayload,
  ListBrowserRecordingsPayload,
  StartBrowserRecordingPayload,
  StopBrowserRecordingPayload,
} from '@sync-think/protocol';
import { BROWSER_RECORDING_MAX_STEPS, BROWSER_RECORDING_MAX_URL_CHARS } from '@sync-think/shared';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !/\s/u.test(value)
  );
}

function validPositiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max;
}

function invalidPayload(command: string): never {
  throw new Error(`Invalid ${command} payload`);
}

export function parseListBrowserRecordingsPayload(value: unknown): ListBrowserRecordingsPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'limit']) ||
    !validId(value.profileId) ||
    (value.limit !== undefined && !validPositiveInteger(value.limit, 50))
  ) {
    invalidPayload('list-browser-recordings');
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function parseGetBrowserRecordingPayload(value: unknown): GetBrowserRecordingPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['recordingId', 'afterSequence', 'limit']) ||
    !validId(value.recordingId) ||
    (value.afterSequence !== undefined &&
      (!Number.isSafeInteger(value.afterSequence) ||
        Number(value.afterSequence) < 0 ||
        Number(value.afterSequence) > BROWSER_RECORDING_MAX_STEPS)) ||
    (value.limit !== undefined && !validPositiveInteger(value.limit, BROWSER_RECORDING_MAX_STEPS))
  ) {
    invalidPayload('get-browser-recording');
  }
  return {
    recordingId: value.recordingId.trim(),
    ...(typeof value.afterSequence === 'number' ? { afterSequence: value.afterSequence } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function parseStartBrowserRecordingPayload(value: unknown): StartBrowserRecordingPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'expectedProfileRevision', 'startUrl']) ||
    !validId(value.profileId) ||
    !validPositiveInteger(value.expectedProfileRevision) ||
    (value.startUrl !== undefined && !validRecordingUrl(value.startUrl))
  ) {
    invalidPayload('start-browser-recording');
  }
  return {
    profileId: value.profileId.trim(),
    expectedProfileRevision: value.expectedProfileRevision,
    ...(typeof value.startUrl === 'string' ? { startUrl: value.startUrl.trim() } : {}),
  };
}

export function parseStopBrowserRecordingPayload(value: unknown): StopBrowserRecordingPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['recordingId']) || !validId(value.recordingId)) {
    invalidPayload('stop-browser-recording');
  }
  return { recordingId: value.recordingId.trim() };
}

function validRecordingUrl(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > BROWSER_RECORDING_MAX_URL_CHARS ||
    hasAsciiControlCharacter(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
