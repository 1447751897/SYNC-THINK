import { describe, expect, it } from 'vitest';
import {
  parseClearBrowserSiteSessionPayload,
  parseCreateBrowserProfilePayload,
  parseDeleteBrowserProfilePayload,
  parseListBrowserProfilesPayload,
  parseListBrowserSiteSessionsPayload,
  parseRenameBrowserProfilePayload,
} from './browser-profile.js';

describe('Browser Profile command validation', () => {
  it('accepts and normalizes bounded Profile payloads', () => {
    expect(parseListBrowserProfilesPayload({})).toEqual({});
    expect(parseCreateBrowserProfilePayload({ name: '  Work  ' })).toEqual({ name: 'Work' });
    expect(
      parseRenameBrowserProfilePayload({
        profileId: 'profile-1',
        name: '  Personal  ',
        expectedRevision: 2,
      }),
    ).toEqual({ profileId: 'profile-1', name: 'Personal', expectedRevision: 2 });
    expect(
      parseDeleteBrowserProfilePayload({ profileId: 'profile-1', expectedRevision: 3 }),
    ).toEqual({ profileId: 'profile-1', expectedRevision: 3 });
    expect(parseListBrowserSiteSessionsPayload({ profileId: 'profile-1', refresh: true })).toEqual({
      profileId: 'profile-1',
      refresh: true,
    });
    expect(
      parseClearBrowserSiteSessionPayload({ profileId: 'profile-1', siteKey: 'Example.COM' }),
    ).toEqual({ profileId: 'profile-1', siteKey: 'example.com' });
  });

  it('rejects unknown keys, invalid revisions, and control characters', () => {
    expect(parseListBrowserProfilesPayload({ extra: true })).toBeUndefined();
    expect(parseCreateBrowserProfilePayload({ name: '\n' })).toBeUndefined();
    expect(
      parseRenameBrowserProfilePayload({
        profileId: 'profile 1',
        name: 'Work',
        expectedRevision: 1,
      }),
    ).toBeUndefined();
    expect(
      parseDeleteBrowserProfilePayload({ profileId: 'profile-1', expectedRevision: 0 }),
    ).toBeUndefined();
    expect(
      parseListBrowserSiteSessionsPayload({ profileId: 'profile-1', refresh: 'yes' }),
    ).toBeUndefined();
    expect(
      parseClearBrowserSiteSessionPayload({ profileId: 'profile-1', siteKey: 'bad site' }),
    ).toBeUndefined();
  });
});
