import { describe, expect, it } from 'vitest';
import {
  parseCreateGroupPayload,
  parseSetGroupLeadPayload,
  parseUpdateGroupMemberResponsibilityPayload,
} from '../src/group-payloads.js';

describe('desktop group payload boundary', () => {
  it('accepts group definitions and focused member mutations', () => {
    expect(
      parseCreateGroupPayload({
        name: '全栈特攻队',
        kind: 'fixed',
        leadAgentVersionId: 'agent-lead',
        members: [{ agentVersionId: 'agent-lead', responsibility: '统筹' }],
      }).name,
    ).toBe('全栈特攻队');
    expect(
      parseUpdateGroupMemberResponsibilityPayload({
        groupId: 'group-1',
        expectedVersion: 2,
        agentVersionId: 'agent-coder',
        responsibility: '实现',
      }).responsibility,
    ).toBe('实现');
    expect(
      parseSetGroupLeadPayload({
        groupId: 'group-1',
        expectedVersion: 3,
        agentVersionId: 'agent-coder',
      }).agentVersionId,
    ).toBe('agent-coder');
  });

  it('rejects incomplete group mutations before IPC forwarding', () => {
    expect(() => parseCreateGroupPayload({ name: 'x', members: [] })).toThrow();
    expect(() =>
      parseSetGroupLeadPayload({
        groupId: 'group-1',
        expectedVersion: 0,
        agentVersionId: 'agent-coder',
      }),
    ).toThrow();
  });
});
