import { describe, expect, it, vi } from 'vitest';
import {
  registerBrowserHandoffHandlers,
  type BrowserHandoffHost,
} from './browser-handoff-handlers.js';

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
    requestBrowserHandoff: request as BrowserHandoffHost<string>['requestBrowserHandoff'],
  };
  registerBrowserHandoffHandlers(host);
  return { handlers, host, order, request, response };
}

describe('browser handoff IPC boundary', () => {
  it('registers the complete Handoff command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:browser-handoff-list-waiting',
      'runtime:browser-handoff-continue',
      'runtime:browser-handoff-cancel',
    ]);
  });

  it.each([
    [
      'runtime:browser-handoff-list-waiting',
      { workspaceId: 'workspace-1', runId: 'run-1' },
      'browser.handoff.listWaiting',
      { workspaceId: 'workspace-1', runId: 'run-1' },
    ],
    [
      'runtime:browser-handoff-continue',
      { handoffId: 'handoff-1', expectedRevision: 1 },
      'browser.handoff.continue',
      { handoffId: 'handoff-1', expectedRevision: 1 },
    ],
    [
      'runtime:browser-handoff-cancel',
      { handoffId: 'handoff-1', expectedRevision: 1, leaseDisposition: 'release' },
      'browser.handoff.cancel',
      { handoffId: 'handoff-1', expectedRevision: 1, leaseDisposition: 'release' },
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
      handlers.get('runtime:browser-handoff-continue')!('untrusted', {
        handoffId: 'handoff-1',
        expectedRevision: 2,
      }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:browser-handoff-cancel')!('trusted', {
        handoffId: 'handoff-1',
        expectedRevision: 2,
      }),
    ).rejects.toThrow('Invalid cancel-browser-handoff payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:browser-handoff-list-waiting')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:browser-handoff-continue')!('trusted', {
        handoffId: 'handoff-1',
        expectedRevision: 1,
      }),
    ).rejects.toBe(failure);
  });
});
