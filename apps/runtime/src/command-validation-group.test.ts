import { describe, expect, it } from 'vitest';
import {
  parseCreateGroupTaskPayload,
  parseCreateGroupPayload,
  parseListGroupsPayload,
  parseSetGroupLeadPayload,
  parseUpdateGroupMemberResponsibilityPayload,
  parseUpdateGroupPayload,
} from './command-validation.js';

describe('group command validation', () => {
  const valid = {
    name: ' 全栈特攻队 ',
    description: ' 分析、实现和审查 ',
    kind: 'fixed',
    leadAgentVersionId: 'agent-version-lead',
    approvalMode: 'full',
    collaborationMode: 'parallel',
    maxConcurrency: 3,
    members: [
      { agentVersionId: 'agent-version-lead', responsibility: ' 统筹与总结 ' },
      { agentVersionId: 'agent-version-coder', responsibility: ' 编码实现 ' },
    ],
  };

  it('normalizes a complete group definition', () => {
    expect(parseCreateGroupPayload(valid)).toEqual({
      name: '全栈特攻队',
      description: '分析、实现和审查',
      kind: 'fixed',
      leadAgentVersionId: 'agent-version-lead',
      approvalMode: 'full',
      collaborationMode: 'parallel',
      maxConcurrency: 3,
      members: [
        { agentVersionId: 'agent-version-lead', responsibility: '统筹与总结' },
        { agentVersionId: 'agent-version-coder', responsibility: '编码实现' },
      ],
    });
  });

  it('rejects duplicate members, missing lead, blank responsibility and unsafe bounds', () => {
    expect(
      parseCreateGroupPayload({
        ...valid,
        members: [valid.members[0], valid.members[0]],
      }),
    ).toBeUndefined();
    expect(
      parseCreateGroupPayload({
        ...valid,
        leadAgentVersionId: 'agent-version-missing',
      }),
    ).toBeUndefined();
    expect(
      parseCreateGroupPayload({
        ...valid,
        members: [{ agentVersionId: 'agent-version-lead', responsibility: ' ' }],
      }),
    ).toBeUndefined();
    expect(parseCreateGroupPayload({ ...valid, maxConcurrency: 0 })).toBeUndefined();
    expect(parseCreateGroupPayload({ ...valid, maxConcurrency: 17 })).toBeUndefined();
  });

  it('validates list filters and optimistic group updates', () => {
    expect(parseListGroupsPayload({ kind: 'temporary', limit: 25 })).toEqual({
      kind: 'temporary',
      limit: 25,
    });
    expect(parseListGroupsPayload({ kind: 'unknown' })).toBeUndefined();
    expect(
      parseUpdateGroupPayload({
        groupId: 'group-1',
        expectedVersion: 2,
        description: ' 新描述 ',
        maxConcurrency: 4,
      }),
    ).toEqual({
      groupId: 'group-1',
      expectedVersion: 2,
      description: '新描述',
      maxConcurrency: 4,
    });
    expect(
      parseUpdateGroupPayload({ groupId: 'group-1', expectedVersion: -1, name: 'x' }),
    ).toBeUndefined();
  });

  it('validates focused member mutations without rejecting their own fields', () => {
    expect(
      parseUpdateGroupMemberResponsibilityPayload({
        groupId: 'group-1',
        expectedVersion: 2,
        agentVersionId: 'agent-version-coder',
        responsibility: ' 实现并回传验收证据 ',
      }),
    ).toEqual({
      groupId: 'group-1',
      expectedVersion: 2,
      agentVersionId: 'agent-version-coder',
      responsibility: '实现并回传验收证据',
    });
    expect(
      parseSetGroupLeadPayload({
        groupId: 'group-1',
        expectedVersion: 2,
        agentVersionId: 'agent-version-coder',
      }),
    ).toEqual({
      groupId: 'group-1',
      expectedVersion: 2,
      agentVersionId: 'agent-version-coder',
    });
  });

  it('validates a task created inside a group', () => {
    expect(
      parseCreateGroupTaskPayload({
        groupId: 'group-1',
        workspaceId: 'workspace-1',
        title: ' 完成上下文接入 ',
        goal: ' 验证多轮历史隔离 ',
        acceptanceCriteria: ['第二轮包含第一轮问答'],
      }),
    ).toEqual({
      groupId: 'group-1',
      workspaceId: 'workspace-1',
      title: ' 完成上下文接入 ',
      goal: ' 验证多轮历史隔离 ',
      acceptanceCriteria: ['第二轮包含第一轮问答'],
    });
  });
});
