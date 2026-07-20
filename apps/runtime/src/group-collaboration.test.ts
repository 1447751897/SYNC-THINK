import { describe, expect, it } from 'vitest';
import type { AgentVersionId, Event, GroupDefinition, GroupId } from '@sync-think/shared';
import {
  buildGroupCollaborationPlan,
  collectGroupCollaborationRunIds,
  GROUP_DELEGATION_DECISION_STEP_TITLE,
  GROUP_FINAL_SUMMARY_STEP_TITLE,
  parseGroupDelegationDecision,
} from './group-collaboration.js';

function group(mode: GroupDefinition['collaborationMode'] = 'parallel'): GroupDefinition {
  return {
    id: 'group-design' as GroupId,
    name: '产品小队',
    description: '完成产品任务',
    kind: 'fixed',
    visualIdentity: { icon: 'users', color: '#0d9488' },
    leadAgentVersionId: 'agent-lead' as AgentVersionId,
    approvalMode: 'full',
    collaborationMode: mode,
    maxConcurrency: 3,
    version: 1,
    members: [
      {
        agentVersionId: 'agent-lead' as AgentVersionId,
        responsibility: '统筹与最终总结',
        sortOrder: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
      },
      {
        agentVersionId: 'agent-research' as AgentVersionId,
        responsibility: '调研用户需求',
        sortOrder: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
      },
      {
        agentVersionId: 'agent-build' as AgentVersionId,
        responsibility: '完成实现',
        sortOrder: 2,
        createdAt: '2026-07-18T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

describe('group collaboration plan', () => {
  it('lets the lead decide first, then runs delegated candidates in parallel and summarizes', () => {
    let index = 0;
    const steps = buildGroupCollaborationPlan({
      group: group('parallel'),
      taskTitle: '重构工作台',
      taskGoal: '让新人可以直接使用',
      userMessage: '分析、实现并检查这个需求',
      createStepId: () => `step-${++index}`,
    });

    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({
      id: 'step-1',
      title: GROUP_DELEGATION_DECISION_STEP_TITLE,
      agentVersionId: 'agent-lead',
      dependsOn: [],
    });
    expect(steps[0]?.instructions).toContain('single|delegate');
    expect(steps[1]).toMatchObject({
      id: 'step-2',
      agentVersionId: 'agent-research',
      dependsOn: ['step-1'],
    });
    expect(steps[1]?.instructions).not.toContain('分析、实现并检查这个需求');
    expect(steps[2]).toMatchObject({
      id: 'step-3',
      agentVersionId: 'agent-build',
      dependsOn: ['step-1'],
    });
    expect(steps[3]).toMatchObject({
      id: 'step-4',
      title: GROUP_FINAL_SUMMARY_STEP_TITLE,
      agentVersionId: 'agent-lead',
      dependsOn: ['step-1', 'step-2', 'step-3'],
    });
    expect(steps[3]?.instructions).toContain('统一总结');
    expect(steps[3]?.instructions).toContain('分析、实现并检查这个需求');
  });

  it('chains member work for sequential groups before the lead summary', () => {
    let index = 0;
    const steps = buildGroupCollaborationPlan({
      group: group('sequential'),
      taskTitle: '顺序任务',
      taskGoal: '逐步完成',
      userMessage: '开始',
      createStepId: () => `sequential-${++index}`,
    });

    expect(steps.map((step) => step.dependsOn)).toEqual([
      [],
      ['sequential-1'],
      ['sequential-2'],
      ['sequential-1', 'sequential-2', 'sequential-3'],
    ]);
  });

  it('accepts only exact, unique member assignments or an empty single decision', () => {
    const definition = group();
    expect(
      parseGroupDelegationDecision(
        JSON.stringify({ mode: 'single', reason: '主智能体可直接完成', assignments: [] }),
        definition,
      ),
    ).toEqual({ mode: 'single', reason: '主智能体可直接完成', assignments: [] });

    expect(
      parseGroupDelegationDecision(
        JSON.stringify({
          mode: 'delegate',
          reason: '需要调研',
          assignments: [
            {
              agentVersionId: 'agent-research',
              goal: '验证目标用户问题',
              requiredEvidence: ['访谈摘录'],
              acceptanceConditions: ['给出三条结论'],
              allowedTools: [],
            },
          ],
        }),
        definition,
      ),
    ).toMatchObject({ mode: 'delegate', assignments: [{ agentVersionId: 'agent-research' }] });

    expect(
      parseGroupDelegationDecision(
        JSON.stringify({
          mode: 'delegate',
          reason: 'invalid',
          assignments: [
            {
              agentVersionId: 'agent-outside',
              goal: '越权',
              requiredEvidence: [],
              acceptanceConditions: [],
              allowedTools: [],
            },
          ],
        }),
        definition,
      ),
    ).toBeUndefined();
  });

  it('recovers each persisted group run exactly once for conversation projection', () => {
    const base = {
      id: 'event-1',
      workspaceId: 'workspace-1',
      category: 'run',
      occurredAt: '2026-07-18T00:00:00.000Z',
      sequence: 1,
      payload: {},
    } as Event;
    expect(
      collectGroupCollaborationRunIds([
        { ...base, type: 'group.collaboration.started', runId: 'run-1' } as Event,
        {
          ...base,
          id: 'event-2',
          sequence: 2,
          type: 'step.completed',
          runId: 'run-2',
        } as Event,
        {
          ...base,
          id: 'event-3',
          sequence: 3,
          type: 'group.collaboration.started',
          runId: 'run-1',
        } as Event,
        {
          ...base,
          id: 'event-4',
          sequence: 4,
          type: 'group.collaboration.started',
          runId: 'run-3',
        } as Event,
      ]),
    ).toEqual(['run-1', 'run-3']);
  });
});
