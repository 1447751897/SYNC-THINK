import { describe, expect, it, vi } from 'vitest';
import {
  registerContextPacketHandlers,
  type ContextPacketHost,
} from './context-packet-handlers.js';

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
    requestContextPacket: request as ContextPacketHost<string>['requestContextPacket'],
  };
  registerContextPacketHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Context Packet IPC boundary', () => {
  it('registers the complete Context Packet command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:context-packet-peek',
      'runtime:context-packet-amend',
    ]);
  });

  it.each([
    [
      'runtime:context-packet-peek',
      { threadId: 'thread-1', userText: 'hello' },
      'context.packet.peek',
      { threadId: 'thread-1', userText: 'hello' },
    ],
    [
      'runtime:context-packet-amend',
      { threadId: 'thread-1', excludeSourceIds: ['source-1'], clearAll: false },
      'context.packet.amend',
      { threadId: 'thread-1', excludeSourceIds: ['source-1'], clearAll: false },
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
      handlers.get('runtime:context-packet-peek')!('untrusted', { threadId: 'thread-1' }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:context-packet-amend')!('trusted', { clearAll: true }),
    ).rejects.toThrow('Invalid amend-context-packet payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:context-packet-peek')!('trusted', {
        threadId: 'thread-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:context-packet-amend')!('trusted', {
        threadId: 'thread-1',
        clearAll: true,
      }),
    ).rejects.toBe(failure);
  });
});
