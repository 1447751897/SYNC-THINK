import { BROWSER_RECORDING_MAX_STEPS, BROWSER_RECORDING_MAX_URL_CHARS } from '@sync-think/shared';
import type {
  GetBrowserRecordingPayload,
  ListBrowserRecordingsPayload,
  StartBrowserRecordingPayload,
  StopBrowserRecordingPayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './shared.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/\s/u.test(value);

const validPositiveInteger = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max;

export function parseListBrowserRecordingsPayload(
  value: unknown,
): ListBrowserRecordingsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'limit']) ||
    !validId(value.profileId) ||
    (value.limit !== undefined && !validPositiveInteger(value.limit, 50))
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function parseGetBrowserRecordingPayload(
  value: unknown,
): GetBrowserRecordingPayload | undefined {
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
    return undefined;
  }
  return {
    recordingId: value.recordingId.trim(),
    ...(typeof value.afterSequence === 'number' ? { afterSequence: value.afterSequence } : {}),
    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
  };
}

export function parseStartBrowserRecordingPayload(
  value: unknown,
): StartBrowserRecordingPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'expectedProfileRevision', 'startUrl']) ||
    !validId(value.profileId) ||
    !validPositiveInteger(value.expectedProfileRevision) ||
    (value.startUrl !== undefined && !validRecordingUrl(value.startUrl))
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    expectedProfileRevision: value.expectedProfileRevision,
    ...(typeof value.startUrl === 'string' ? { startUrl: value.startUrl.trim() } : {}),
  };
}

export function parseStopBrowserRecordingPayload(
  value: unknown,
): StopBrowserRecordingPayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['recordingId']) || !validId(value.recordingId)) {
    return undefined;
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
