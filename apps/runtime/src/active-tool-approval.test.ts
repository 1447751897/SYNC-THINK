import { describe, expect, it, vi } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import {
  ActiveToolApprovalLifecycle,
  decideActiveToolApproval,
  type ActiveToolApproval,
} from './active-tool-approval.js';

function approval(overrides: Partial<ActiveToolApproval> = {}): ActiveToolApproval {
  return {
    approvalId: 'approval-a',
    runId: 'run-a' as RunId,
    threadId: 'thread-a',
    toolCall: { id: 'call-a', name: 'write_file', argumentsJson: '{"path":"a.txt"}' },
    summary: { title: 'Write file', detail: 'a.txt', path: 'a.txt' },
    arguments: { path: 'a.txt' },
    allowedScopes: ['once', 'session'],
    resolve: vi.fn(),
    createdAt: '2026-09-19T01:00:00.000Z',
    ...overrides,
  };
}

function event(): Event {
  return {
    id: 'event-a' as Event['id'],
    workspaceId: 'workspace-a' as Event['workspaceId'],
    runId: 'run-a' as RunId,
    type: 'tool.approval_decided',
    category: 'approval',
    sequence: 1,
    occurredAt: '2026-09-19T01:01:00.000Z',
    payload: { approvalId: 'approval-a', decision: 'approve' },
  };
}

describe('ActiveToolApprovalLifecycle', () => {
  it('projects only matching approvals in creation order', () => {
    const lifecycle = new ActiveToolApprovalLifecycle();
    lifecycle.register(approval({ approvalId: 'later', createdAt: '2026-09-19T02:00:00.000Z' }));
    lifecycle.register(approval({ approvalId: 'earlier' }));
    lifecycle.register(approval({ approvalId: 'other', threadId: 'thread-b' }));

    expect(lifecycle.list({ threadId: 'thread-a' }).map((item) => item.approvalId)).toEqual([
      'earlier',
      'later',
    ]);
    expect(lifecycle.list({ threadId: 'thread-a' })[0]).toMatchObject({
      toolCallId: 'call-a',
      toolName: 'write_file',
      path: 'a.txt',
      status: 'pending',
    });
  });

  it('removes a waiter before cancellation side effects and resolves it once', () => {
    const lifecycle = new ActiveToolApprovalLifecycle();
    const pending = approval();
    lifecycle.register(pending);
    const beforeResolve = vi.fn(() => expect(lifecycle.get(pending.approvalId)).toBeUndefined());

    expect(lifecycle.settle(pending.approvalId, 'deny', beforeResolve)).toBe(pending);
    expect(beforeResolve).toHaveBeenCalledWith(pending);
    expect(pending.resolve).toHaveBeenCalledWith('deny');
    expect(lifecycle.settle(pending.approvalId, 'approve')).toBeUndefined();
    expect(pending.resolve).toHaveBeenCalledTimes(1);
  });

  it('selects and settles waiters through lifecycle methods without exposing the map', () => {
    const lifecycle = new ActiveToolApprovalLifecycle();
    const first = approval();
    const second = approval({ approvalId: 'approval-b', runId: 'run-b' as RunId });
    lifecycle.register(first);
    lifecycle.register(second);

    expect(lifecycle.size).toBe(2);
    expect(lifecycle.firstId()).toBe(first.approvalId);
    expect(lifecycle.matchingRunIds(new Set(['run-b']))).toEqual([second]);
    lifecycle.settleAll('deny');
    expect(lifecycle.size).toBe(0);
    expect(first.resolve).toHaveBeenCalledWith('deny');
    expect(second.resolve).toHaveBeenCalledWith('deny');
  });

  it('keeps a waiter active when decision persistence fails', () => {
    const lifecycle = new ActiveToolApprovalLifecycle();
    const pending = approval();
    lifecycle.register(pending);
    const failure = new Error('write failed');

    expect(() =>
      decideActiveToolApproval({
        lifecycle,
        approvalId: pending.approvalId,
        decision: 'approve',
        scope: 'session',
        commit: () => {
          throw failure;
        },
        record: vi.fn(),
        publish: vi.fn(),
      }),
    ).toThrow(failure);
    expect(lifecycle.get(pending.approvalId)).toBe(pending);
    expect(pending.resolve).not.toHaveBeenCalled();
  });

  it('records, settles and publishes a committed decision in order', () => {
    const lifecycle = new ActiveToolApprovalLifecycle();
    const pending = approval();
    const committed = event();
    const order: string[] = [];
    pending.resolve = vi.fn(() => order.push('resolve'));
    lifecycle.register(pending);

    expect(
      decideActiveToolApproval({
        lifecycle,
        approvalId: pending.approvalId,
        decision: 'approve',
        scope: 'session',
        commit: () => {
          order.push('commit');
          return committed;
        },
        record: () => order.push('record'),
        publish: () => order.push('publish'),
      }),
    ).toMatchObject({ status: 'decided', approval: pending, event: committed, scope: 'session' });
    expect(order).toEqual(['commit', 'record', 'resolve', 'publish']);
  });

  it('rejects an unsupported remembered scope without consuming the waiter', () => {
    const lifecycle = new ActiveToolApprovalLifecycle();
    const pending = approval({
      risk: { level: 'human-only', reasonCodes: ['human-only'] },
      allowedScopes: ['once'],
    });
    lifecycle.register(pending);
    const commit = vi.fn(() => event());

    expect(
      decideActiveToolApproval({
        lifecycle,
        approvalId: pending.approvalId,
        decision: 'approve',
        scope: 'session',
        commit,
        record: vi.fn(),
        publish: vi.fn(),
      }),
    ).toEqual({ status: 'unsupported-scope', humanOnly: true });
    expect(commit).not.toHaveBeenCalled();
    expect(lifecycle.get(pending.approvalId)).toBe(pending);
  });
});
