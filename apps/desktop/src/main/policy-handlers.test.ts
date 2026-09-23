import { describe, expect, it, vi } from 'vitest';
import { registerPolicyHandlers, type PolicyHost } from './policy-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { policies: [] };
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
    requestPolicy: request as PolicyHost<string>['requestPolicy'],
  };
  registerPolicyHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Policy IPC boundary', () => {
  it('registers the complete Policy command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual(['runtime:policy-save', 'runtime:policy-list']);
  });

  it.each([
    [
      'runtime:policy-save',
      {
        workspaceId: 'workspace-1',
        scopeType: 'task',
        scopeId: 'task-1',
        approvalMode: 'request',
        rules: [{ action: 'shell.exec', approvalMode: 'request' }],
      },
      'policy.save',
    ],
    ['runtime:policy-list', { workspaceId: 'workspace-1', taskId: 'task-1' }, 'policy.list'],
  ])('forwards %s through its typed command', async (channel, payload, command) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', payload)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:policy-save')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:policy-list')!('trusted', { workspaceId: '' }),
    ).rejects.toThrow('Invalid policy-list payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:policy-list')!('trusted', {
        workspaceId: 'workspace-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:policy-list')!('trusted', {
        workspaceId: 'workspace-1',
      }),
    ).rejects.toBe(failure);
  });
});
