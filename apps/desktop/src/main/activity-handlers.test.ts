import { describe, expect, it, vi } from 'vitest';
import { registerActivityHandlers, type ActivityHost } from './activity-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { entries: [] };
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
    requestActivity: request as ActivityHost<string>['requestActivity'],
  };
  registerActivityHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Activity Center IPC boundary', () => {
  it('registers the Activity Center command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:activity-list-runs',
      'runtime:activity-list-external-events',
      'runtime:activity-retry-anchor',
    ]);
  });

  it.each([
    [
      'runtime:activity-list-runs',
      {
        workspaceId: 'workspace-1',
        states: ['running', 'invalid'],
        sources: ['chat', 'unknown'],
        cursor: 'cursor-1',
        limit: 20,
      },
      'activity.listRuns',
      {
        workspaceId: 'workspace-1',
        states: ['running'],
        sources: ['chat'],
        cursor: 'cursor-1',
        limit: 20,
      },
    ],
    [
      'runtime:activity-list-external-events',
      { workspaceId: 'workspace-1', states: ['pending', 'invalid'], limit: 10 },
      'activity.listExternalEvents',
      { workspaceId: 'workspace-1', states: ['pending'], limit: 10 },
    ],
    [
      'runtime:activity-retry-anchor',
      { runId: ' run-1 ' },
      'activity.retryAnchor',
      { runId: 'run-1' },
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
    await expect(handlers.get('runtime:activity-retry-anchor')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting missing retry anchors without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get('runtime:activity-retry-anchor')!('trusted', {})).rejects.toThrow(
      'Invalid activity-retry-anchor payload',
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
      connectionFixture.handlers.get('runtime:activity-list-runs')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:activity-list-external-events')!('trusted', {}),
    ).rejects.toBe(failure);
  });
});
