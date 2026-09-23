import { describe, expect, it, vi } from 'vitest';
import { registerGatewayHandlers, type GatewayHost } from './gateway-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value?: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { ok: true };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value?: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestGateway: request as GatewayHost<string>['requestGateway'],
  };
  registerGatewayHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Open Gateway IPC boundary', () => {
  it('registers the complete Gateway command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:gateway-status',
      'runtime:gateway-logs',
      'runtime:gateway-logs-clear',
    ]);
  });

  it.each([
    ['runtime:gateway-status', undefined, 'gateway.status', {}],
    ['runtime:gateway-logs', { offset: 10, limit: 20 }, 'gateway.logs', { offset: 10, limit: 20 }],
    ['runtime:gateway-logs-clear', undefined, 'gateway.logs.clear', {}],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('preserves Runtime-owned permissive log query normalization', async () => {
    const { handlers, request } = fixture();
    await handlers.get('runtime:gateway-logs')!('trusted', 'legacy-value');
    expect(request).toHaveBeenCalledWith('gateway.logs', 'legacy-value');
  });

  it('rejects untrusted senders before connection and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:gateway-logs')!('untrusted', {})).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(connectionFixture.handlers.get('runtime:gateway-status')!('trusted')).rejects.toBe(
      offline,
    );
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:gateway-logs-clear')!('trusted'),
    ).rejects.toBe(failure);
  });
});
