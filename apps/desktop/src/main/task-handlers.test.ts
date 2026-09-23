import { describe, expect, it, vi } from 'vitest';
import { TASK_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import { registerTaskHandlers, type TaskHost } from './task-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { taskId: 'task-1' };
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
    requestTask: request as TaskHost<string>['requestTask'],
  };
  registerTaskHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Task directory IPC boundary', () => {
  it('registers the six task directory commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(Object.values(TASK_RUNTIME_IPC_CHANNELS));
  });

  it.each([
    [
      TASK_RUNTIME_IPC_CHANNELS.create,
      { workspaceId: 'workspace-1', title: ' Review ', goal: ' Inspect changes ' },
      'task.create',
      {
        workspaceId: 'workspace-1',
        title: 'Review',
        goal: 'Inspect changes',
        parentTaskId: undefined,
        acceptanceCriteria: undefined,
      },
    ],
    [
      TASK_RUNTIME_IPC_CHANNELS.list,
      { workspaceId: 'workspace-1', includeArchived: true },
      'task.list',
      { workspaceId: 'workspace-1', includeArchived: true },
    ],
    [TASK_RUNTIME_IPC_CHANNELS.open, { taskId: 'task-1' }, 'task.open', { taskId: 'task-1' }],
    [
      TASK_RUNTIME_IPC_CHANNELS.search,
      { workspaceId: 'workspace-1', query: 'review' },
      'task.search',
      { workspaceId: 'workspace-1', query: 'review' },
    ],
    [
      TASK_RUNTIME_IPC_CHANNELS.archive,
      { taskId: 'task-1', expectedTaskVersion: 3, cascade: false },
      'task.archive',
      { taskId: 'task-1', expectedTaskVersion: 3, cascade: false },
    ],
    [
      TASK_RUNTIME_IPC_CHANNELS.unarchive,
      { taskId: 'task-1', expectedTaskVersion: 4 },
      'task.unarchive',
      { taskId: 'task-1', expectedTaskVersion: 4, cascade: undefined },
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
    await expect(handlers.get(TASK_RUNTIME_IPC_CHANNELS.create)!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [TASK_RUNTIME_IPC_CHANNELS.create, { workspaceId: 'workspace-1' }],
    [TASK_RUNTIME_IPC_CHANNELS.list, {}],
    [TASK_RUNTIME_IPC_CHANNELS.open, { taskId: '' }],
    [TASK_RUNTIME_IPC_CHANNELS.search, { workspaceId: 'workspace-1', query: 1 }],
    [TASK_RUNTIME_IPC_CHANNELS.archive, { taskId: 'task-1', expectedTaskVersion: -1 }],
    [TASK_RUNTIME_IPC_CHANNELS.unarchive, { taskId: 'task-1' }],
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
      connectionFixture.handlers.get(TASK_RUNTIME_IPC_CHANNELS.list)!('trusted', {
        workspaceId: 'workspace-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(TASK_RUNTIME_IPC_CHANNELS.open)!('trusted', {
        taskId: 'task-1',
      }),
    ).rejects.toBe(failure);
  });
});
