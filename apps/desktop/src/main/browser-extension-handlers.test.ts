import { describe, expect, it, vi } from 'vitest';
import {
  registerBrowserExtensionHandlers,
  type BrowserExtensionHost,
} from './browser-extension-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string) => Promise<unknown>>();
  const order: string[] = [];
  const response = { ok: true };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestBrowserExtension: request as BrowserExtensionHost<string>['requestBrowserExtension'],
  };
  registerBrowserExtensionHandlers(host);
  return { handlers, host, order, request, response };
}

describe('browser extension IPC boundary', () => {
  it('registers the complete Browser Extension command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:browser-extension-status',
      'runtime:browser-extension-restart',
      'runtime:browser-extension-reset-pairing',
      'runtime:browser-extension-open-folder',
    ]);
  });

  it.each([
    ['runtime:browser-extension-status', 'browser.extension.status'],
    ['runtime:browser-extension-restart', 'browser.extension.restart'],
    ['runtime:browser-extension-reset-pairing', 'browser.extension.resetPairing'],
    ['runtime:browser-extension-open-folder', 'browser.extension.openFolder'],
  ])('forwards %s through its typed command', async (channel, command) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted')).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, {});
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:browser-extension-restart')!('untrusted')).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:browser-extension-status')!('trusted'),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:browser-extension-open-folder')!('trusted'),
    ).rejects.toBe(failure);
  });
});
