import { describe, expect, it, vi } from 'vitest';
import { registerApprovalHandlers, type ApprovalHost } from './approval-handlers.js';

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
    requestApproval: request as ApprovalHost<string>['requestApproval'],
  };
  registerApprovalHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Approval Center IPC boundary', () => {
  it('registers the complete Approval command surface', () => {
    const { handlers } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:approval-list',
      'runtime:approval-evaluate',
      'runtime:approval-enqueue',
      'runtime:approval-decide',
    ]);
  });

  it.each([
    ['runtime:approval-list', {}, 'approval.list', {}],
    [
      'runtime:approval-evaluate',
      { action: 'delete file' },
      'approval.evaluate',
      { action: 'delete file' },
    ],
    [
      'runtime:approval-enqueue',
      { action: 'publish', summary: 'Publish artifact' },
      'approval.enqueue',
      { action: 'publish', summary: 'Publish artifact' },
    ],
    [
      'runtime:approval-decide',
      { id: 'approval-1', decision: 'approved' },
      'approval.decide',
      { id: 'approval-1', decision: 'approved', decisionNote: undefined },
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
      handlers.get('runtime:approval-enqueue')!('untrusted', { action: 'publish' }),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('connects before rejecting malformed payloads without transport', async () => {
    const { handlers, host, order, request } = fixture();
    await expect(
      handlers.get('runtime:approval-evaluate')!('trusted', { mode: 'request' }),
    ).rejects.toThrow('Invalid evaluate-approval payload');
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:approval-list')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:approval-decide')!('trusted', {
        id: 'approval-1',
        decision: 'approved',
      }),
    ).rejects.toBe(failure);
  });
});
