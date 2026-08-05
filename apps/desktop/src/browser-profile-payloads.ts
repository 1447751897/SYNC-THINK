import type {
  ClearBrowserSiteSessionPayload,
  CreateBrowserProfilePayload,
  DeleteBrowserProfilePayload,
  ListBrowserProfilesPayload,
  ListBrowserSiteSessionsPayload,
  RenameBrowserProfilePayload,
} from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/\s/.test(value)
  );
}

function validName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 80 &&
    !hasAsciiControlCharacter(value)
  );
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function invalidPayload(command: string): never {
  throw new Error(`Invalid ${command} payload`);
}

export function parseListBrowserProfilesPayload(value: unknown): ListBrowserProfilesPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, [])) invalidPayload('list-browser-profiles');
  return {};
}

export function parseCreateBrowserProfilePayload(value: unknown): CreateBrowserProfilePayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name']) || !validName(value.name)) {
    invalidPayload('create-browser-profile');
  }
  return { name: value.name.trim() };
}

export function parseRenameBrowserProfilePayload(value: unknown): RenameBrowserProfilePayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'name', 'expectedRevision']) ||
    !validId(value.profileId) ||
    !validName(value.name) ||
    !validRevision(value.expectedRevision)
  ) {
    invalidPayload('rename-browser-profile');
  }
  return {
    profileId: value.profileId.trim(),
    name: value.name.trim(),
    expectedRevision: value.expectedRevision,
  };
}

export function parseDeleteBrowserProfilePayload(value: unknown): DeleteBrowserProfilePayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'expectedRevision']) ||
    !validId(value.profileId) ||
    !validRevision(value.expectedRevision)
  ) {
    invalidPayload('delete-browser-profile');
  }
  return { profileId: value.profileId.trim(), expectedRevision: value.expectedRevision };
}

export function parseListBrowserSiteSessionsPayload(
  value: unknown,
): ListBrowserSiteSessionsPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['profileId', 'refresh']) ||
    !validId(value.profileId) ||
    (value.refresh !== undefined && typeof value.refresh !== 'boolean')
  ) {
    invalidPayload('list-browser-site-sessions');
  }
  return {
    profileId: value.profileId.trim(),
    ...(typeof value.refresh === 'boolean' ? { refresh: value.refresh } : {}),
  };
}

export function parseClearBrowserSiteSessionPayload(
  value: unknown,
): ClearBrowserSiteSessionPayload {
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
    invalidPayload('clear-browser-site-session');
  }
  return { profileId: value.profileId.trim(), siteKey: value.siteKey.trim().toLowerCase() };
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
