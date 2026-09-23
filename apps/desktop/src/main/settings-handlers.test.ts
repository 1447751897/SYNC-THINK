import { describe, expect, it, vi } from 'vitest';
import { registerSettingsHandlers, type SettingsHost } from './settings-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { settings: {} };
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
    requestSettings: request as SettingsHost<string>['requestSettings'],
  };
  registerSettingsHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Settings IPC boundary', () => {
  it('registers the complete Settings command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:settings-get',
      'runtime:settings-set',
    ]);
  });

  it.each([
    ['runtime:settings-get', { keys: [' appearance '] }, 'settings.get', { keys: ['appearance'] }],
    [
      'runtime:settings-set',
      { key: ' appearance ', value: { theme: 'dark' } },
      'settings.set',
      { key: 'appearance', value: { theme: 'dark' } },
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
    await expect(handlers.get('runtime:settings-set')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:settings-get')!('trusted', { keys: [null] }),
    ).rejects.toThrow('Invalid get-settings payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:settings-get')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:settings-set')!('trusted', {
        key: 'appearance',
        value: null,
      }),
    ).rejects.toBe(failure);
  });
});
