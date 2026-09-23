import { describe, expect, it, vi } from 'vitest';
import { registerMemoryHandlers, type MemoryHost } from './memory-handlers.js';

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
    requestMemory: request as MemoryHost<string>['requestMemory'],
  };
  registerMemoryHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Memory IPC boundary', () => {
  it('registers the complete Memory command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:memory-list',
      'runtime:memory-decide',
      'runtime:memory-rollback',
    ]);
  });

  it.each([
    ['runtime:memory-list', { limit: 10 }, 'memory.list', { limit: 10 }],
    [
      'runtime:memory-decide',
      { changeId: 'change-1', decision: 'approved' },
      'memory.decide',
      { changeId: 'change-1', decision: 'approved' },
    ],
    [
      'runtime:memory-rollback',
      { changeId: 'change-1' },
      'memory.rollback',
      { changeId: 'change-1' },
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
      handlers.get('runtime:memory-decide')!('untrusted', {
        changeId: 'change-1',
        decision: 'approved',
      }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get('runtime:memory-rollback')!('trusted', {})).rejects.toThrow(
      'Invalid rollback-memory payload',
    );
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:memory-list')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:memory-rollback')!('trusted', {
        changeId: 'change-1',
      }),
    ).rejects.toBe(failure);
  });
});
