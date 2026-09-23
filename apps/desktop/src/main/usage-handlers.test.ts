import { describe, expect, it, vi } from 'vitest';
import { registerUsageHandlers, type UsageHost } from './usage-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { rows: [], requests: [], tools: [] };
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
    requestUsage: request as UsageHost<string>['requestUsage'],
  };
  registerUsageHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Usage IPC boundary', () => {
  it('registers and forwards the typed usage summary command', async () => {
    const { handlers, order, request, response } = fixture();
    expect([...handlers.keys()]).toEqual(['runtime:usage-summary']);
    await expect(
      handlers.get('runtime:usage-summary')!('trusted', { sinceDays: 30, taskId: ' task-1 ' }),
    ).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('usage.summary', { sinceDays: 30, taskId: 'task-1' });
    expect(order).toEqual(['source', 'connect', 'request:usage.summary']);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:usage-summary')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:usage-summary')!('trusted', { sinceDays: 0 }),
    ).rejects.toThrow('Invalid usage-summary payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:usage-summary')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:usage-summary')!('trusted', {}),
    ).rejects.toBe(failure);
  });
});
