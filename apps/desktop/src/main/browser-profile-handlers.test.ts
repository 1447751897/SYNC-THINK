import { describe, expect, it, vi } from 'vitest';
import {
  registerBrowserProfileHandlers,
  type BrowserProfileHost,
} from './browser-profile-handlers.js';

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
    requestBrowserProfile: request as BrowserProfileHost<string>['requestBrowserProfile'],
  };
  registerBrowserProfileHandlers(host);
  return { handlers, host, order, request, response };
}

describe('browser profile IPC boundary', () => {
  it('registers the complete Profile command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:browser-profile-list',
      'runtime:browser-profile-create',
      'runtime:browser-profile-rename',
      'runtime:browser-profile-delete',
      'runtime:browser-profile-list-site-sessions',
      'runtime:browser-profile-clear-site-session',
    ]);
  });

  it.each([
    ['runtime:browser-profile-list', undefined, 'browser.profile.list', {}],
    [
      'runtime:browser-profile-create',
      { name: ' Work ' },
      'browser.profile.create',
      { name: 'Work' },
    ],
    [
      'runtime:browser-profile-rename',
      { profileId: 'profile-1', name: ' Personal ', expectedRevision: 2 },
      'browser.profile.rename',
      { profileId: 'profile-1', name: 'Personal', expectedRevision: 2 },
    ],
    [
      'runtime:browser-profile-delete',
      { profileId: 'profile-1', expectedRevision: 2 },
      'browser.profile.delete',
      { profileId: 'profile-1', expectedRevision: 2 },
    ],
    [
      'runtime:browser-profile-list-site-sessions',
      { profileId: 'profile-1', refresh: true },
      'browser.profile.listSiteSessions',
      { profileId: 'profile-1', refresh: true },
    ],
    [
      'runtime:browser-profile-clear-site-session',
      { profileId: 'profile-1', siteKey: 'Example.COM' },
      'browser.profile.clearSiteSession',
      { profileId: 'profile-1', siteKey: 'example.com' },
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
      handlers.get('runtime:browser-profile-create')!('untrusted', { name: '\n' }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:browser-profile-delete')!('trusted', {
        profileId: 'profile-1',
        expectedRevision: 0,
      }),
    ).rejects.toThrow('Invalid delete-browser-profile payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:browser-profile-list')!('trusted', undefined),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:browser-profile-list')!('trusted', undefined),
    ).rejects.toBe(failure);
  });
});
