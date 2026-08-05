import { describe, expect, it } from 'vitest';
import {
  parseGetBrowserRecordingPayload,
  parseListBrowserRecordingsPayload,
  parseStartBrowserRecordingPayload,
  parseStopBrowserRecordingPayload,
} from './browser-recording.js';

describe('Browser recording command validation', () => {
  it('accepts bounded list, snapshot, start, and stop payloads', () => {
    expect(parseListBrowserRecordingsPayload({ profileId: 'profile-1', limit: 20 })).toEqual({
      profileId: 'profile-1',
      limit: 20,
    });
    expect(
      parseGetBrowserRecordingPayload({
        recordingId: 'recording-1',
        afterSequence: 12,
        limit: 100,
      }),
    ).toEqual({ recordingId: 'recording-1', afterSequence: 12, limit: 100 });
    expect(
      parseStartBrowserRecordingPayload({
        profileId: 'profile-1',
        expectedProfileRevision: 3,
        startUrl: ' https://example.test/path?query=kept-until-service ',
      }),
    ).toEqual({
      profileId: 'profile-1',
      expectedProfileRevision: 3,
      startUrl: 'https://example.test/path?query=kept-until-service',
    });
    expect(parseStopBrowserRecordingPayload({ recordingId: 'recording-1' })).toEqual({
      recordingId: 'recording-1',
    });
  });

  it('rejects extra keys, invalid URLs, revisions, and pagination', () => {
    expect(parseListBrowserRecordingsPayload({ profileId: 'profile-1', limit: 0 })).toBeUndefined();
    expect(parseGetBrowserRecordingPayload({ recordingId: 'recording 1' })).toBeUndefined();
    expect(
      parseGetBrowserRecordingPayload({ recordingId: 'recording-1', afterSequence: 201 }),
    ).toBeUndefined();
    expect(
      parseStartBrowserRecordingPayload({
        profileId: 'profile-1',
        expectedProfileRevision: 0,
        startUrl: 'https://example.test',
      }),
    ).toBeUndefined();
    expect(
      parseStartBrowserRecordingPayload({
        profileId: 'profile-1',
        expectedProfileRevision: 1,
        startUrl: 'file:///C:/secret.txt',
      }),
    ).toBeUndefined();
    expect(
      parseStopBrowserRecordingPayload({ recordingId: 'recording-1', extra: true }),
    ).toBeUndefined();
  });
});
