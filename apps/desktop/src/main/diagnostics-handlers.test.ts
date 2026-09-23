import { describe, expect, it, vi } from 'vitest';
import { registerDiagnosticsHandlers, type DiagnosticsHost } from './diagnostics-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { diagnostics: [] };
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
    requestDiagnostics: request as DiagnosticsHost<string>['requestDiagnostics'],
  };
  registerDiagnosticsHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Diagnostics IPC boundary', () => {
  it('registers and forwards the typed diagnostics list command', async () => {
    const { handlers, order, request, response } = fixture();
    expect([...handlers.keys()]).toEqual(['runtime:diagnostics-list']);
    await expect(
      handlers.get('runtime:diagnostics-list')!('trusted', { taskId: 'task-1', limit: 20 }),
    ).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('diagnostics.list', { taskId: 'task-1', limit: 20 });
    expect(order).toEqual(['source', 'connect', 'request:diagnostics.list']);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get('runtime:diagnostics-list')!('untrusted', { limit: 20 }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:diagnostics-list')!('trusted', { limit: 0 }),
    ).rejects.toThrow('Invalid limit');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:diagnostics-list')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:diagnostics-list')!('trusted', {}),
    ).rejects.toBe(failure);
  });
});
