import { BROWSER_RECORDING_MAX_STEPS, BROWSER_RECORDING_MAX_URL_CHARS } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import {
  parseGetBrowserRecordingPayload,
  parseListBrowserRecordingsPayload,
  parseStartBrowserRecordingPayload,
  parseStopBrowserRecordingPayload,
} from './browser-recording-payloads.js';

describe('Desktop Browser Recording IPC payloads', () => {
  it('normalizes valid Renderer payloads', () => {
    expect(parseListBrowserRecordingsPayload({ profileId: 'profile-1', limit: 50 })).toEqual({
      profileId: 'profile-1',
      limit: 50,
    });
    expect(
      parseGetBrowserRecordingPayload({
        recordingId: 'recording-1',
        afterSequence: 0,
        limit: BROWSER_RECORDING_MAX_STEPS,
      }),
    ).toEqual({
      recordingId: 'recording-1',
      afterSequence: 0,
      limit: BROWSER_RECORDING_MAX_STEPS,
    });
    expect(
      parseStartBrowserRecordingPayload({
        profileId: 'profile-1',
        expectedProfileRevision: 3,
        startUrl: ' https://example.test/path?query=kept-until-runtime ',
        draftId: ' browser-draft-1 ',
      }),
    ).toEqual({
      profileId: 'profile-1',
      expectedProfileRevision: 3,
      startUrl: 'https://example.test/path?query=kept-until-runtime',
      draftId: 'browser-draft-1',
    });
    expect(
      parseStartBrowserRecordingPayload({ profileId: 'profile-1', expectedProfileRevision: 1 }),
    ).toEqual({ profileId: 'profile-1', expectedProfileRevision: 1 });
    expect(parseStopBrowserRecordingPayload({ recordingId: 'recording-1' })).toEqual({
      recordingId: 'recording-1',
    });
  });

  it('accepts exact identifier, pagination, and URL boundaries', () => {
    const exactId = 'i'.repeat(256);
    const urlPrefix = 'https://example.test/';
    const exactUrl = `${urlPrefix}${'a'.repeat(BROWSER_RECORDING_MAX_URL_CHARS - urlPrefix.length)}`;

    expect(parseListBrowserRecordingsPayload({ profileId: exactId, limit: 1 })).toEqual({
      profileId: exactId,
      limit: 1,
    });
    expect(
      parseGetBrowserRecordingPayload({
        recordingId: exactId,
        afterSequence: BROWSER_RECORDING_MAX_STEPS,
        limit: 1,
      }),
    ).toEqual({
      recordingId: exactId,
      afterSequence: BROWSER_RECORDING_MAX_STEPS,
      limit: 1,
    });
    expect(
      parseStartBrowserRecordingPayload({
        profileId: exactId,
        expectedProfileRevision: Number.MAX_SAFE_INTEGER,
        startUrl: exactUrl,
      }),
    ).toEqual({
      profileId: exactId,
      expectedProfileRevision: Number.MAX_SAFE_INTEGER,
      startUrl: exactUrl,
    });
  });

  it('rejects malformed identifiers and extra keys', () => {
    for (const profileId of ['', 'profile 1', 'profile\n1', 'i'.repeat(257)]) {
      expect(() => parseListBrowserRecordingsPayload({ profileId })).toThrow();
    }
    for (const draftId of ['', 'draft 1', 'draft\n1', 'i'.repeat(257)]) {
      expect(() =>
        parseStartBrowserRecordingPayload({
          profileId: 'profile-1',
          expectedProfileRevision: 1,
          draftId,
        }),
      ).toThrow();
    }
    expect(() => parseListBrowserRecordingsPayload(undefined)).toThrow();
    expect(() =>
      parseGetBrowserRecordingPayload({ recordingId: 'recording-1', extra: true }),
    ).toThrow();
    expect(() =>
      parseStartBrowserRecordingPayload({
        profileId: 'profile-1',
        expectedProfileRevision: 1,
        extra: true,
      }),
    ).toThrow();
    expect(() => parseStopBrowserRecordingPayload({ recordingId: 'recording\t1' })).toThrow();
  });

  it('rejects unsafe pagination and revisions', () => {
    for (const limit of [0, 51, 1.5, Number.NaN]) {
      expect(() => parseListBrowserRecordingsPayload({ profileId: 'profile-1', limit })).toThrow();
    }
    for (const afterSequence of [-1, BROWSER_RECORDING_MAX_STEPS + 1, 0.5]) {
      expect(() =>
        parseGetBrowserRecordingPayload({ recordingId: 'recording-1', afterSequence }),
      ).toThrow();
    }
    for (const limit of [0, BROWSER_RECORDING_MAX_STEPS + 1, 1.5]) {
      expect(() =>
        parseGetBrowserRecordingPayload({ recordingId: 'recording-1', limit }),
      ).toThrow();
    }
    for (const expectedProfileRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parseStartBrowserRecordingPayload({ profileId: 'profile-1', expectedProfileRevision }),
      ).toThrow();
    }
  });

  it('rejects unsupported, overlong, controlled, or malformed start URLs', () => {
    const validPrefix = 'https://example.test/';
    const overlongUrl = `${validPrefix}${'a'.repeat(
      BROWSER_RECORDING_MAX_URL_CHARS - validPrefix.length + 1,
    )}`;
    for (const startUrl of [
      'file:///C:/secret.txt',
      'ftp://example.test/file',
      'https://example.test/\nnext',
      'not a url',
      overlongUrl,
    ]) {
      expect(() =>
        parseStartBrowserRecordingPayload({
          profileId: 'profile-1',
          expectedProfileRevision: 1,
          startUrl,
        }),
      ).toThrow();
    }
  });
});
