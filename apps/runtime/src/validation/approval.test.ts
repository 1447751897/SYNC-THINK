import { describe, expect, it } from 'vitest';
import { parseConversationDecideToolApprovalPayload } from './approval.js';

describe('parseConversationDecideToolApprovalPayload', () => {
  it.each(['once', 'session', 'always-app'] as const)(
    'accepts the %s approval scope',
    (scope) => {
      expect(
        parseConversationDecideToolApprovalPayload({
          approvalId: 'approval-1',
          decision: 'approve',
          scope,
        }),
      ).toEqual({ approvalId: 'approval-1', decision: 'approve', scope });
    },
  );

  it('defaults legacy approvals to once and rejects remembered deny decisions', () => {
    expect(
      parseConversationDecideToolApprovalPayload({
        approvalId: 'approval-1',
        decision: 'approve',
      }),
    ).toEqual({ approvalId: 'approval-1', decision: 'approve', scope: 'once' });
    expect(
      parseConversationDecideToolApprovalPayload({
        approvalId: 'approval-1',
        decision: 'deny',
        scope: 'session',
      }),
    ).toBeUndefined();
    expect(
      parseConversationDecideToolApprovalPayload({
        approvalId: 'approval-1',
        decision: 'approve',
        scope: 'forever',
      }),
    ).toBeUndefined();
  });
});

it('accepts only one-shot human exclusions, rejecting denial, duplicates and persistent edits', () => {
  const payload = { approvalId: 'approval', decision: 'approve', excludedSkillTools: ['write_file'] };
  expect(parseConversationDecideToolApprovalPayload(payload)).toMatchObject({ excludedSkillTools: ['write_file'], scope: 'once' });
  for (const update of [{ decision: 'deny' }, { scope: 'session' }, { excludedSkillTools: ['write_file', 'write_file'] }, { excludedSkillTools: [''] }, { excludedSkillTools: 'write_file' }]) expect(parseConversationDecideToolApprovalPayload({ ...payload, ...update })).toBeUndefined();
});
