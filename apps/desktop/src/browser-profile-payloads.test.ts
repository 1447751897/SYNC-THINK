import { describe, expect, it } from 'vitest';
import {
  parseClearBrowserSiteSessionPayload,
  parseCreateBrowserProfilePayload,
  parseDeleteBrowserProfilePayload,
  parseListBrowserProfilesPayload,
  parseListBrowserSiteSessionsPayload,
  parseRenameBrowserProfilePayload,
} from './browser-profile-payloads.js';

describe('Desktop Browser Profile IPC payloads', () => {
  it('normalizes valid Renderer payloads', () => {
    expect(parseListBrowserProfilesPayload(undefined)).toEqual({});
    expect(parseCreateBrowserProfilePayload({ name: ' Work ' })).toEqual({ name: 'Work' });
    expect(
      parseRenameBrowserProfilePayload({
        profileId: 'profile-1',
        name: ' Personal ',
        expectedRevision: 2,
      }),
    ).toEqual({ profileId: 'profile-1', name: 'Personal', expectedRevision: 2 });
    expect(
      parseDeleteBrowserProfilePayload({ profileId: 'profile-1', expectedRevision: 2 }),
    ).toEqual({ profileId: 'profile-1', expectedRevision: 2 });
    expect(parseListBrowserSiteSessionsPayload({ profileId: 'profile-1', refresh: true })).toEqual({
      profileId: 'profile-1',
      refresh: true,
    });
    expect(
      parseClearBrowserSiteSessionPayload({ profileId: 'profile-1', siteKey: 'Example.COM' }),
    ).toEqual({ profileId: 'profile-1', siteKey: 'example.com' });
  });

  it('throws before malformed data reaches Main or Runtime', () => {
    expect(() => parseListBrowserProfilesPayload({ extra: true })).toThrow();
    expect(() => parseCreateBrowserProfilePayload({ name: '\n' })).toThrow();
    expect(() =>
      parseRenameBrowserProfilePayload({
        profileId: 'profile 1',
        name: 'Work',
        expectedRevision: 1,
      }),
    ).toThrow();
    expect(() =>
      parseDeleteBrowserProfilePayload({ profileId: 'profile-1', expectedRevision: 0 }),
    ).toThrow();
    expect(() =>
      parseListBrowserSiteSessionsPayload({ profileId: 'profile-1', refresh: 'yes' }),
    ).toThrow();
    expect(() =>
      parseClearBrowserSiteSessionPayload({ profileId: 'profile-1', siteKey: 'bad site' }),
    ).toThrow();
  });
});
