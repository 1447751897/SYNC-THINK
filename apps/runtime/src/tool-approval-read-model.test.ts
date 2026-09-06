import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  projectToolApprovalStates,
  expiredToolApprovalSummary,
} from './tool-approval-read-model.js';

function event(type: string, sequence: number, approvalId = 'approval-a'): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-a' as Event['workspaceId'],
    category: 'approval',
    type,
    sequence,
    occurredAt: '2026-09-05T00:00:00.000Z',
    payload: { approvalId },
  };
}

describe('tool approval read model', () => {
  it('orders requests and decisions by durable sequence', () => {
    const requested = event('tool.approval_requested', 1);
    const decided = event('tool.approval_decided', 2);
    expect(projectToolApprovalStates([decided, requested]).get('approval-a')).toEqual({
      requested,
      decided,
    });
  });

  it('does not resurrect an already decided identity when a request arrives later', () => {
    const decided = event('tool.approval_decided', 1);
    const requested = event('tool.approval_requested', 2);
    expect(projectToolApprovalStates([requested, decided]).get('approval-a')).toEqual({
      requested,
      decided,
    });
  });

  it('keeps identities separate and ignores unrelated or unidentifiable records', () => {
    const states = projectToolApprovalStates([
      event('tool.approval_requested', 1),
      event('tool.approval_decided', 2, 'approval-b'),
      event('tool.completed', 3),
      event('tool.approval_requested', 4, ''),
    ]);
    expect([...states.keys()]).toEqual(['approval-a', 'approval-b']);
    expect(states.get('approval-a')?.decided).toBeUndefined();
    expect(states.get('approval-b')?.decided?.sequence).toBe(2);
  });
});

describe('expired tool approval summaries', () => {
  function state(reason = 'stale-approval') {
    const requested = event('tool.approval_requested', 1);
    requested.runId = 'source-run' as never;
    requested.payload = {
      ...requested.payload,
      threadId: 'source-thread',
      toolName: 'write_file',
      title: 'title'.repeat(1000),
      detail: 'detail'.repeat(1000),
      arguments: { secret: 'excluded' },
      command: 'excluded',
    };
    const decided = event('tool.approval_decided', 2);
    decided.runId = requested.runId;
    decided.payload = { ...decided.payload, decision: 'deny', reason, threadId: 'source-thread' };
    return { requested, decided };
  }
  it('returns bounded display fields without tool arguments or reusable scopes', () => {
    const summary = expiredToolApprovalSummary(state());
    expect(summary).toMatchObject({
      status: 'expired',
      reason: 'stale-approval',
      threadId: 'source-thread',
      runId: 'source-run',
    });
    expect(summary?.title.length).toBeLessThanOrEqual(161);
    expect(summary?.detail.length).toBeLessThanOrEqual(513);
    expect(JSON.stringify(summary)).not.toContain('excluded');
    expect(summary).not.toHaveProperty('allowedScopes');
  });
  it('does not reinterpret an explicit deny or an incomplete decision as expiry', () => {
    expect(expiredToolApprovalSummary(state('user-denied'))).toBeUndefined();
    expect(expiredToolApprovalSummary({ requested: state().requested })).toBeUndefined();
    const malformed = state();
    malformed.decided.payload.decision = 'approve';
    expect(expiredToolApprovalSummary(malformed)).toBeUndefined();
  });
  it('rejects an expiry belonging to another approval, thread or run', () => {
    const wrongId = state();
    wrongId.decided.payload.approvalId = 'other';
    const wrongThread = state();
    wrongThread.decided.payload.threadId = 'other';
    const wrongRun = state();
    wrongRun.decided.runId = 'other' as never;
    for (const invalid of [wrongId, wrongThread, wrongRun])
      expect(expiredToolApprovalSummary(invalid)).toBeUndefined();
  });
});
