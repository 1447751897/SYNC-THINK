import { describe, expect, it, vi } from 'vitest';
import {
  registerDesktopCommandHandlers,
  type DesktopCommandHost,
} from './desktop-command-handlers.js';

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
    requestDesktopCommand: request as DesktopCommandHost<string>['requestDesktopCommand'],
  };
  registerDesktopCommandHandlers(host);
  return { handlers, host, order, request, response };
}

describe('desktop waiting command IPC boundary', () => {
  it('registers the complete waiting command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:desktop-command-list-waiting',
      'runtime:desktop-command-continue',
      'runtime:desktop-command-cancel',
    ]);
  });

  it.each([
    [
      'runtime:desktop-command-list-waiting',
      { workspaceId: 'workspace-1', runId: 'run-1' },
      'desktop.command.listWaiting',
      { workspaceId: 'workspace-1', runId: 'run-1' },
    ],
    [
      'runtime:desktop-command-continue',
      { commandId: 'command-1', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      'desktop.command.continue',
      { commandId: 'command-1', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
    ],
    [
      'runtime:desktop-command-cancel',
      { commandId: 'command-1', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
      'desktop.command.cancel',
      { commandId: 'command-1', expectedUpdatedAt: '2026-08-01T00:00:00.000Z' },
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
      handlers.get('runtime:desktop-command-continue')!('untrusted', {
        commandId: 'command-1',
        expectedUpdatedAt: 'yesterday',
      }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:desktop-command-cancel')!('trusted', {
        commandId: 'command-1',
        expectedUpdatedAt: 'yesterday',
      }),
    ).rejects.toThrow('Invalid cancel-desktop-command payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:desktop-command-list-waiting')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:desktop-command-continue')!('trusted', {
        commandId: 'command-1',
        expectedUpdatedAt: '2026-08-01T00:00:00.000Z',
      }),
    ).rejects.toBe(failure);
  });
});
