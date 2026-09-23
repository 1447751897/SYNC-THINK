import { describe, expect, it, vi } from 'vitest';
import { PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerParticipationModeHandlers,
  type ParticipationModeHost,
} from './participation-mode-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { task: { taskId: 'task-1', participationMode: 'collaboration' } };
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
    requestParticipationMode:
      request as ParticipationModeHost<string>['requestParticipationMode'],
  };
  registerParticipationModeHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Participation Mode IPC boundary', () => {
  it('registers the execution-participation command', () => {
    expect([...fixture().handlers.keys()]).toEqual(
      Object.values(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS),
    );
  });

  it('forwards a valid mode change through its typed command', async () => {
    const { handlers, order, request, response } = fixture();
    const payload = { taskId: 'task-1', mode: 'collaboration', expectedTaskVersion: 4 };
    await expect(
      handlers.get(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set)!('trusted', payload),
    ).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith('task.setParticipationMode', payload);
    expect(order).toEqual(['source', 'connect', 'request:task.setParticipationMode']);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(
      handlers.get(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [{ taskId: '', mode: 'conversation', expectedTaskVersion: 0 }],
    [{ taskId: 'task-1', mode: 'manual', expectedTaskVersion: 0 }],
    [{ taskId: 'task-1', mode: 'automatic', expectedTaskVersion: -1 }],
  ])('connects before rejecting invalid payloads without transport', async (payload) => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set)!('trusted', payload),
    ).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const payload = { taskId: 'task-1', mode: 'conversation', expectedTaskVersion: 2 };
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set)!(
        'trusted',
        payload,
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set)!(
        'trusted',
        payload,
      ),
    ).rejects.toBe(failure);
  });
});
