import { describe, expect, it, vi } from 'vitest';
import {
  registerConversationApprovalHandlers,
  type ConversationApprovalHost,
} from './conversation-approval-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const request = vi.fn(async (command: string, payload: unknown) => {
    order.push(`request:${command}`);
    return { command, payload };
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      expect(handlers.has(channel)).toBe(false);
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestConversation: request as ConversationApprovalHost<string>['requestConversation'],
  };
  registerConversationApprovalHandlers(host);
  return { handlers, host, order, request };
}

describe('conversation approval IPC boundary', () => {
  it('registers and forwards approval decisions with normalized scopes', async () => {
    const { handlers, order, request } = fixture();
    expect([...handlers.keys()]).toEqual([
      'runtime:conversation-decide-tool-approval',
      'runtime:conversation-list-pending-tool-approvals',
    ]);

    await handlers.get('runtime:conversation-decide-tool-approval')!('trusted', {
      approvalId: 'approval-1',
      decision: 'approve',
    });
    expect(request).toHaveBeenLastCalledWith('conversation.decideToolApproval', {
      approvalId: 'approval-1',
      decision: 'approve',
      scope: 'once',
    });
    expect(order).toEqual(['source', 'connect', 'request:conversation.decideToolApproval']);

    order.length = 0;
    await handlers.get('runtime:conversation-decide-tool-approval')!('trusted', {
      approvalId: 'approval-2',
      decision: 'approve',
      scope: 'always-app',
    });
    expect(request).toHaveBeenLastCalledWith('conversation.decideToolApproval', {
      approvalId: 'approval-2',
      decision: 'approve',
      scope: 'always-app',
    });
    expect(order).toEqual(['source', 'connect', 'request:conversation.decideToolApproval']);
  });

  it('forwards pending approval queries with their optional run scope', async () => {
    const { handlers, order, request } = fixture();
    await handlers.get('runtime:conversation-list-pending-tool-approvals')!('trusted', {
      threadId: ' thread-1 ',
      runId: ' run-1 ',
    });
    expect(request).toHaveBeenLastCalledWith('conversation.listPendingToolApprovals', {
      threadId: 'thread-1',
      runId: 'run-1',
    });
    expect(order).toEqual([
      'source',
      'connect',
      'request:conversation.listPendingToolApprovals',
    ]);
  });

  it.each([
    ['runtime:conversation-decide-tool-approval', { approvalId: 'approval-1', decision: 'deny' }],
    ['runtime:conversation-list-pending-tool-approvals', { threadId: 'thread-1' }],
  ])('rejects an untrusted %s call before connection or transport', async (channel, payload) => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get(channel)!('untrusted', payload)).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime:conversation-decide-tool-approval', { approvalId: 'approval-1', decision: 'deny', scope: 'session' }],
    ['runtime:conversation-list-pending-tool-approvals', { threadId: '' }],
  ])('connects before rejecting malformed %s requests without transport', async (channel, payload) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', payload)).rejects.toThrow();
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get('runtime:conversation-list-pending-tool-approvals')!(
        'trusted',
        { threadId: 'thread-1' },
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const conflict = new Error('approval already settled');
    transportFixture.request.mockRejectedValue(conflict);
    await expect(
      transportFixture.handlers.get('runtime:conversation-decide-tool-approval')!('trusted', {
        approvalId: 'approval-1',
        decision: 'deny',
      }),
    ).rejects.toBe(conflict);
  });
});
