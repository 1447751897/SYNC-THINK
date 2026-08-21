import { describe, expect, it } from 'vitest';
import {
  parseDecideApprovalPayload,
  parseListPendingToolApprovalsPayload,
} from '../src/approval-payloads.js';

describe('approval payloads', () => {
  it('accepts an exact pending tool approval scope', () => {
    expect(parseListPendingToolApprovalsPayload({ threadId: 'thread-a', runId: 'run-a' })).toEqual({
      threadId: 'thread-a',
      runId: 'run-a',
    });
  });

  it.each([
    {},
    { threadId: '' },
    { threadId: 'thread-a', runId: '' },
    { threadId: 'thread-a', unexpected: true },
  ])('rejects an invalid pending tool approval scope %#', (payload) => {
    expect(() => parseListPendingToolApprovalsPayload(payload)).toThrow(
      /Invalid list-pending-tool-approvals/,
    );
  });

  it('round-trips a delegated decision with its exact AgentVersion', () => {
    expect(
      parseDecideApprovalPayload({
        id: 'approval-1',
        decision: 'approved',
        decidedBy: 'delegate',
        delegateAgentVersionId: 'agent-reviewer-v3',
        decisionNote: 'Reviewed by the exact pinned reviewer.',
      }),
    ).toMatchObject({
      decidedBy: 'delegate',
      delegateAgentVersionId: 'agent-reviewer-v3',
      decisionNote: 'Reviewed by the exact pinned reviewer.',
    });
  });

  it.each([
    { decidedBy: 'delegate' },
    { decidedBy: 'human', delegateAgentVersionId: 'agent-reviewer-v3' },
    { decidedBy: 'service' },
    { unexpected: true },
  ])('rejects invalid actor or field combination %#', (extra) => {
    expect(() =>
      parseDecideApprovalPayload({ id: 'approval-1', decision: 'approved', ...extra }),
    ).toThrow(/Invalid decide-approval/);
  });
});
