import { describe, expect, it, vi } from 'vitest';
import { registerKernelHandlers, type KernelHost } from './kernel-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string) => Promise<unknown>>();
  const order: string[] = [];
  const response = { kernels: [] };
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
    requestKernel: request as KernelHost<string>['requestKernel'],
  };
  registerKernelHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Kernel discovery IPC boundary', () => {
  it('registers and forwards kernel detection through its typed command', async () => {
    const { handlers, order, request, response } = fixture();
    expect([...handlers.keys()]).toEqual(['runtime:kernel-detect']);
    await expect(handlers.get('runtime:kernel-detect')!('trusted')).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('kernel.detect', {});
    expect(order).toEqual(['source', 'connect', 'request:kernel.detect']);
  });

  it('rejects untrusted senders before connection and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:kernel-detect')!('untrusted')).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(connectionFixture.handlers.get('runtime:kernel-detect')!('trusted')).rejects.toBe(
      offline,
    );
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(transportFixture.handlers.get('runtime:kernel-detect')!('trusted')).rejects.toBe(
      failure,
    );
  });
});
