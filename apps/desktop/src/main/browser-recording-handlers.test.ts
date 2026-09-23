import { describe, expect, it, vi } from 'vitest';
import {
  registerBrowserRecordingHandlers,
  type BrowserRecordingHost,
} from './browser-recording-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { ok: true };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestBrowserRecording: request as BrowserRecordingHost<string>['requestBrowserRecording'],
  };
  registerBrowserRecordingHandlers(host);
  return { handlers, host, order, request, response };
}

describe('browser recording IPC boundary', () => {
  it('registers the complete Recording command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:browser-recording-list',
      'runtime:browser-recording-get',
      'runtime:browser-recording-start',
      'runtime:browser-recording-stop',
      'runtime:browser-recording-pause',
      'runtime:browser-recording-resume',
    ]);
  });

  it.each([
    [
      'runtime:browser-recording-list',
      { profileId: ' profile-1 ', limit: 20 },
      'browser.recording.list',
      { profileId: 'profile-1', limit: 20 },
    ],
    [
      'runtime:browser-recording-get',
      { recordingId: ' recording-1 ', afterSequence: 0, limit: 100 },
      'browser.recording.get',
      { recordingId: 'recording-1', afterSequence: 0, limit: 100 },
    ],
    [
      'runtime:browser-recording-start',
      {
        profileId: ' profile-1 ',
        expectedProfileRevision: 3,
        startUrl: ' https://example.test/path ',
        draftId: ' draft-1 ',
      },
      'browser.recording.start',
      {
        profileId: 'profile-1',
        expectedProfileRevision: 3,
        startUrl: 'https://example.test/path',
        draftId: 'draft-1',
      },
    ],
    [
      'runtime:browser-recording-stop',
      { recordingId: ' recording-1 ' },
      'browser.recording.stop',
      { recordingId: 'recording-1' },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get('runtime:browser-recording-start')!('untrusted', {
        profileId: 'profile-1',
        expectedProfileRevision: 0,
      }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:browser-recording-start')!('trusted', {
        profileId: 'profile-1',
        expectedProfileRevision: 0,
      }),
    ).rejects.toThrow('Invalid start-browser-recording payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:browser-recording-list')!('trusted', {
        profileId: 'profile-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:browser-recording-stop')!('trusted', {
        recordingId: 'recording-1',
      }),
    ).rejects.toBe(failure);
  });
});
