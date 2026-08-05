import type {
  ClearBrowserSiteSessionPayload,
  CreateBrowserProfilePayload,
  DeleteBrowserProfilePayload,
  ListBrowserProfilesPayload,
  ListBrowserSiteSessionsPayload,
  RenameBrowserProfilePayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './shared.js';

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/\s/.test(value);

const validName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 80 &&
  !hasAsciiControlCharacter(value);

const validRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1;

export function parseListBrowserProfilesPayload(
  value: unknown,
): ListBrowserProfilesPayload | undefined {
  return isRecord(value) && hasOnlyKeys(value, []) ? {} : undefined;
}

export function parseCreateBrowserProfilePayload(
  value: unknown,
): CreateBrowserProfilePayload | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name']) || !validName(value.name)) {
    return undefined;
  }
  return { name: value.name.trim() };
}

export function parseRenameBrowserProfilePayload(
  value: unknown,
): RenameBrowserProfilePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'name', 'expectedRevision']) ||
    !validId(value.profileId) ||
    !validName(value.name) ||
    !validRevision(value.expectedRevision)
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    name: value.name.trim(),
    expectedRevision: value.expectedRevision,
  };
}

export function parseDeleteBrowserProfilePayload(
  value: unknown,
): DeleteBrowserProfilePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'expectedRevision']) ||
    !validId(value.profileId) ||
    !validRevision(value.expectedRevision)
  ) {
    return undefined;
  }
  return { profileId: value.profileId.trim(), expectedRevision: value.expectedRevision };
}

export function parseListBrowserSiteSessionsPayload(
  value: unknown,
): ListBrowserSiteSessionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'refresh']) ||
    !validId(value.profileId) ||
    (value.refresh !== undefined && typeof value.refresh !== 'boolean')
  ) {
    return undefined;
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.refresh === 'boolean' ? { refresh: value.refresh } : {}),
  };
}

export function parseClearBrowserSiteSessionPayload(
  value: unknown,
): ClearBrowserSiteSessionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'siteKey']) ||
    !validId(value.profileId) ||
    typeof value.siteKey !== 'string' ||
    value.siteKey.trim().length === 0 ||
    value.siteKey.length > 253 ||
    /\s/.test(value.siteKey) ||
    hasAsciiControlCharacter(value.siteKey)
  ) {
    return undefined;
  }
  return { profileId: value.profileId.trim(), siteKey: value.siteKey.trim().toLowerCase() };
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
