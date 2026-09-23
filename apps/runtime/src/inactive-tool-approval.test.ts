import { describe, expect, it, vi } from 'vitest';
import type { Event } from '@sync-think/shared';
import { resolveInactiveToolApproval } from './inactive-tool-approval.js';
import {
  pendingToolApprovalSummaryFromEvent,
  type DurableToolApprovalState,
} from './tool-approval-read-model.js';

const requested: Event = {
  id: 'request' as Event['id'],
  workspaceId: 'workspace' as Event['workspaceId'],
  runId: 'run' as Event['runId'],
  type: 'tool.approval_requested',
  category: 'approval',
  sequence: 1,
  occurredAt: '2026-09-19T00:00:00Z',
  payload: {
    approvalId: 'approval',
    threadId: 'thread',
    toolName: 'write_file',
    toolCallId: 'tool',
  },
};
function decided(payload: Record<string, unknown>): Event {
  return {
    ...requested,
    id: 'decision' as Event['id'],
    type: 'tool.approval_decided',
    sequence: 2,
    payload: { ...requested.payload, ...payload },
  };
}
function fixture(state?: DurableToolApprovalState) {
  return { read: vi.fn(() => state), expire: vi.fn(() => true) };
}

describe('inactive tool approval recovery', () => {
  it('returns no result for an unknown request without writing a decision', () => {
    const ports = fixture();
    expect(resolveInactiveToolApproval('unknown', ports)).toBeUndefined();
    expect(ports.read).toHaveBeenCalledWith('unknown');
    expect(ports.expire).not.toHaveBeenCalled();
  });
  it.each(['approve', 'deny'] as const)(
    'replays the durable %s and its original scope without executing or granting again',
    (decision) => {
      const ports = fixture({ requested, decided: decided({ decision, scope: 'session' }) });
      expect(resolveInactiveToolApproval('approval', ports)).toEqual({
        approvalId: 'approval',
        decision,
        scope: 'session',
      });
      expect(ports.expire).not.toHaveBeenCalled();
    },
  );
  it('normalizes legacy decision and scope values conservatively', () => {
    expect(
      resolveInactiveToolApproval(
        'approval',
        fixture({ requested, decided: decided({ decision: 'unknown', scope: 'unknown' }) }),
      ),
    ).toEqual({ approvalId: 'approval', decision: 'deny', scope: 'once' });
  });
  it('persists an orphan denial before responding and replays the same expired response afterwards', () => {
    let state: DurableToolApprovalState = { requested };
    const expire = vi.fn((request) => {
      state = { requested, decided: decided(request) };
      return true;
    });
    const ports = { read: () => state, expire };
    const response = resolveInactiveToolApproval('approval', ports);
    expect(response).toEqual({
      approvalId: 'approval',
      decision: 'deny',
      scope: 'once',
      runId: 'run',
      outcome: 'expired',
      reason: 'stale-approval',
    });
    expect(expire).toHaveBeenCalledWith({
      approvalId: 'approval',
      threadId: 'thread',
      runId: 'run',
      decision: 'deny',
      reason: 'stale-approval',
      toolCallId: 'tool',
      toolName: 'write_file',
    });
    expect(resolveInactiveToolApproval('approval', ports)).toEqual(response);
    expect(expire).toHaveBeenCalledTimes(1);
  });
  it('does not acknowledge failed expiry persistence and allows a later retry', () => {
    const ports = fixture({ requested });
    ports.expire.mockReturnValueOnce(false);
    expect(() => resolveInactiveToolApproval('approval', ports)).toThrow(
      'Tool approval expiry persistence failed',
    );
    expect(resolveInactiveToolApproval('approval', ports)?.outcome).toBe('expired');
    expect(ports.expire).toHaveBeenCalledTimes(2);
  });
  it('propagates read and write errors without converting them into success', () => {
    const failure = new Error('database unavailable');
    const ports = fixture({ requested });
    ports.read.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => resolveInactiveToolApproval('approval', ports)).toThrow(failure);
    expect(ports.expire).not.toHaveBeenCalled();
    ports.expire.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => resolveInactiveToolApproval('approval', ports)).toThrow(failure);
  });
  it('does not expire a malformed historical request', () => {
    const ports = fixture({ requested: { ...requested, payload: { approvalId: 'approval' } } });
    expect(resolveInactiveToolApproval('approval', ports)).toBeUndefined();
    expect(ports.expire).not.toHaveBeenCalled();
  });
  it('projects legacy request arguments, risk, scopes and defaults independently of Runtime', () => {
    expect(
      pendingToolApprovalSummaryFromEvent({
        ...requested,
        payload: {
          ...requested.payload,
          arguments: { path: 'a.txt' },
          allowedScopes: ['session', 'unknown', 'session'],
          risk: { reasonCodes: ['one', 2], humanOnlyAction: 'action' },
        },
      }),
    ).toMatchObject({
      arguments: { path: 'a.txt' },
      allowedScopes: ['session', 'once'],
      title: 'write_file',
      detail: '需要你的批准',
      risk: { level: 'unknown', reasonCodes: ['one'], humanOnlyAction: 'action' },
      createdAt: requested.occurredAt,
    });
  });
});
