import { describe, expect, it, vi } from 'vitest';
import {
  registerScheduledTaskHandlers,
  type ScheduledTaskHost,
} from './scheduled-task-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { tasks: [] };
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
    requestScheduledTask: request as ScheduledTaskHost<string>['requestScheduledTask'],
  };
  registerScheduledTaskHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Scheduled Task IPC boundary', () => {
  it('registers the Scheduled Task lifecycle', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:scheduled-task-create',
      'runtime:scheduled-task-list',
      'runtime:scheduled-task-update',
      'runtime:scheduled-task-delete',
      'runtime:scheduled-task-trigger',
      'runtime:scheduled-task-history',
    ]);
  });

  it.each([
    [
      'runtime:scheduled-task-create',
      {
        name: ' Daily review ',
        instruction: ' Review changes ',
        target: { kind: 'agent', agentId: 'agent-1' },
        rule: { kind: 'every', intervalMinutes: 5 },
        enabled: true,
      },
      'scheduledTask.create',
      {
        name: 'Daily review',
        instruction: 'Review changes',
        target: { kind: 'agent', agentId: 'agent-1' },
        rule: { kind: 'every', intervalMinutes: 5 },
        enabled: true,
      },
    ],
    [
      'runtime:scheduled-task-list',
      { includeDisabled: true },
      'scheduledTask.list',
      { includeDisabled: true },
    ],
    [
      'runtime:scheduled-task-update',
      { taskId: ' task-1 ', patch: { name: 'Renamed', enabled: false } },
      'scheduledTask.update',
      { taskId: 'task-1', patch: { name: 'Renamed', enabled: false } },
    ],
    [
      'runtime:scheduled-task-delete',
      { taskId: ' task-1 ' },
      'scheduledTask.delete',
      { taskId: 'task-1' },
    ],
    [
      'runtime:scheduled-task-trigger',
      { taskId: ' task-1 ' },
      'scheduledTask.trigger',
      { taskId: 'task-1' },
    ],
    [
      'runtime:scheduled-task-history',
      { taskId: ' task-1 ', limit: 20 },
      'scheduledTask.history',
      { taskId: 'task-1', limit: 20 },
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
    await expect(handlers.get('runtime:scheduled-task-create')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed task definitions without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:scheduled-task-create')!('trusted', {
        name: 'Incomplete',
      }),
    ).rejects.toThrow('Invalid scheduled-task-create payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects missing task IDs before transport', async () => {
    const { handlers, request } = fixture();
    await expect(handlers.get('runtime:scheduled-task-trigger')!('trusted', {})).rejects.toThrow(
      'Invalid scheduled-task-trigger payload',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:scheduled-task-list')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:scheduled-task-delete')!('trusted', {
        taskId: 'task-1',
      }),
    ).rejects.toBe(failure);
  });
});
