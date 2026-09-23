import type {
  ClearBrowserSiteSessionPayload,
  CreateBrowserProfilePayload,
  DeleteBrowserProfilePayload,
  ListBrowserProfilesPayload,
  ListBrowserSiteSessionsPayload,
  RenameBrowserProfilePayload,
} from '@sync-think/protocol';
import {
  tryParseClearBrowserSiteSessionPayload,
  tryParseCreateBrowserProfilePayload,
  tryParseDeleteBrowserProfilePayload,
  tryParseListBrowserProfilesPayload,
  tryParseListBrowserSiteSessionsPayload,
  tryParseRenameBrowserProfilePayload,
} from '@sync-think/protocol/browser-payloads';

function requirePayload<T>(command: string, payload: T | undefined): T {
  if (payload === undefined) throw new Error(`Invalid ${command} payload`);
  return payload;
}

export function parseListBrowserProfilesPayload(value: unknown): ListBrowserProfilesPayload {
  return requirePayload('list-browser-profiles', tryParseListBrowserProfilesPayload(value ?? {}));
}

export function parseCreateBrowserProfilePayload(value: unknown): CreateBrowserProfilePayload {
  return requirePayload('create-browser-profile', tryParseCreateBrowserProfilePayload(value));
}

export function parseRenameBrowserProfilePayload(value: unknown): RenameBrowserProfilePayload {
  return requirePayload('rename-browser-profile', tryParseRenameBrowserProfilePayload(value));
}

export function parseDeleteBrowserProfilePayload(value: unknown): DeleteBrowserProfilePayload {
  return requirePayload('delete-browser-profile', tryParseDeleteBrowserProfilePayload(value));
}

export function parseListBrowserSiteSessionsPayload(value: unknown): ListBrowserSiteSessionsPayload {
  return requirePayload('list-browser-site-sessions', tryParseListBrowserSiteSessionsPayload(value));
}

export function parseClearBrowserSiteSessionPayload(value: unknown): ClearBrowserSiteSessionPayload {
  return requirePayload('clear-browser-site-session', tryParseClearBrowserSiteSessionPayload(value));
}
