import { describe, expect, it } from 'vitest';
import { parseDecideApprovalPayload } from '../src/approval-payloads.js';

describe('approval payloads', () => {
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
