import { describe, expect, it, vi } from 'vitest';
import { RUN_CONTROL_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import { registerRunControlHandlers, type RunControlHost } from './run-control-handlers.js';

const scope = { workspaceId: 'workspace-1', taskId: 'task-1', runId: 'run-1' };

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { runId: 'run-1' };
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
    requestRunControl: request as RunControlHost<string>['requestRunControl'],
  };
  registerRunControlHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Run control IPC boundary', () => {
  it('registers both cancel surfaces and the orchestration controls', () => {
    expect([...fixture().handlers.keys()]).toEqual(Object.values(RUN_CONTROL_RUNTIME_IPC_CHANNELS));
  });

  it.each([
    [
      RUN_CONTROL_RUNTIME_IPC_CHANNELS.cancelConversation,
      { runId: 'run-1' },
      'run.cancel',
      { runId: 'run-1' },
    ],
    [RUN_CONTROL_RUNTIME_IPC_CHANNELS.getGraph, scope, 'run.getGraph', scope],
    [
      RUN_CONTROL_RUNTIME_IPC_CHANNELS.pause,
      { ...scope, expectedTaskVersion: 3 },
      'run.pause',
      { ...scope, expectedTaskVersion: 3 },
    ],
    [
      RUN_CONTROL_RUNTIME_IPC_CHANNELS.resume,
      { ...scope, expectedTaskVersion: 3 },
      'run.resume',
      { ...scope, expectedTaskVersion: 3 },
    ],
    [
      RUN_CONTROL_RUNTIME_IPC_CHANNELS.cancelOrchestration,
      { ...scope, expectedTaskVersion: 3 },
      'run.cancel',
      { ...scope, expectedTaskVersion: 3 },
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
      handlers.get(RUN_CONTROL_RUNTIME_IPC_CHANNELS.getGraph)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [RUN_CONTROL_RUNTIME_IPC_CHANNELS.cancelConversation, { runId: '' }],
    [RUN_CONTROL_RUNTIME_IPC_CHANNELS.getGraph, { runId: 'run-1' }],
    [RUN_CONTROL_RUNTIME_IPC_CHANNELS.pause, { ...scope, expectedTaskVersion: -1 }],
    [RUN_CONTROL_RUNTIME_IPC_CHANNELS.resume, scope],
    [RUN_CONTROL_RUNTIME_IPC_CHANNELS.cancelOrchestration, { ...scope, expectedTaskVersion: -1 }],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(RUN_CONTROL_RUNTIME_IPC_CHANNELS.getGraph)!('trusted', scope),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(RUN_CONTROL_RUNTIME_IPC_CHANNELS.cancelConversation)!(
        'trusted',
        { runId: 'run-1' },
      ),
    ).rejects.toBe(failure);
  });
});
