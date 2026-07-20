import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@sync-think/protocol';
import type { Event, GroupDefinition } from '@sync-think/shared';
import {
  projectAgentGroupMemberships,
  projectAgentRelatedTasks,
  projectConversationMentionLabel,
  projectTaskConversationSummaries,
  projectTaskGroupIds,
  projectTaskPrimaryAgentVersions,
} from '../src/renderer/agent-profile-projection.js';

const task = (taskId: string, updatedAt: string): TaskSummary => ({
  taskId: taskId as never,
  workspaceId: 'workspace-1' as never,
  title: taskId,
  goal: `${taskId} goal`,
  status: 'active',
  participationMode: 'conversation',
  executionMode: 'workspace',
  taskVersion: 1,
  threadId: `thread-${taskId}` as never,
  createdAt: updatedAt,
  updatedAt,
});

const event = (taskId: string, payload: Record<string, unknown>): Event => ({
  id: `event-${taskId}-${JSON.stringify(payload)}` as never,
  workspaceId: 'workspace-1' as never,
  taskId: taskId as never,
  category: 'run',
  type: 'run.started',
  sequence: 1,
  occurredAt: '2026-07-18T00:00:00.000Z',
  payload,
});

describe('Agent profile projection', () => {
  it('hides the implicit direct target but keeps explicit and group mentions', () => {
    const agents = new Map([
      ['lead-v1', '规划官'],
      ['review-v1', '审查官'],
    ]);
    const groups = new Map([['group-1', { name: '发布小队', leadAgentVersionId: 'lead-v1' }]]);

    expect(
      projectConversationMentionLabel(
        { role: 'user', text: '继续处理', targetAgentVersionId: 'lead-v1' },
        agents,
        groups,
      ),
    ).toBeUndefined();
    expect(
      projectConversationMentionLabel(
        { role: 'user', text: '@审查官 看一下', targetAgentVersionId: 'review-v1' },
        agents,
        groups,
      ),
    ).toBe('审查官');
    expect(
      projectConversationMentionLabel(
        {
          role: 'user',
          text: '继续处理',
          targetAgentVersionId: 'lead-v1',
          targetGroupId: 'group-1',
        },
        agents,
        groups,
      ),
    ).toBe('发布小队');
  });

  it('projects the latest primary AgentVersion for each isolated task', () => {
    const projected = projectTaskPrimaryAgentVersions([
      {
        ...event('task-a', { agentVersionId: 'agent-a-v1' }),
        type: 'task.agent-bound',
        sequence: 1,
      },
      {
        ...event('task-b', { agentVersionId: 'agent-b-v1' }),
        type: 'subtask.agent-assigned',
        sequence: 2,
      },
      { ...event('task-a', { reviewerAgentVersionId: 'reviewer-v1' }), sequence: 3 },
      {
        ...event('task-a', { agentVersionId: 'agent-a-v2' }),
        type: 'task.agent-bound',
        sequence: 4,
      },
      {
        ...event('ignored-event-task', { taskId: 'task-c', leadAgentVersionId: 'lead-c-v1' }),
        taskId: undefined,
        type: 'group.task-created',
        sequence: 5,
      },
    ]);

    expect(projected.get('task-a')).toBe('agent-a-v2');
    expect(projected.get('task-b')).toBe('agent-b-v1');
    expect(projected.get('task-c')).toBe('lead-c-v1');
    expect(projected.has('ignored-event-task')).toBe(false);
    expect([...projected.values()]).not.toContain('reviewer-v1');
  });

  it('does not replace the parent primary Agent with a child message sender', () => {
    const projected = projectTaskPrimaryAgentVersions([
      {
        ...event('parent-task', { agentVersionId: 'lead-v1' }),
        type: 'task.agent-bound',
        sequence: 1,
      },
      {
        ...event('parent-task', {
          messageAgentVersionId: 'worker-v1',
          fromAgentVersionId: 'worker-v1',
          toAgentVersionId: 'lead-v1',
          text: 'Worker completed the delegated task.',
        }),
        type: 'subtask.completed',
        sequence: 2,
      },
    ]);

    expect(projected.get('parent-task')).toBe('lead-v1');
  });

  it('does not replace a stable task binding with a temporary run target', () => {
    const projected = projectTaskPrimaryAgentVersions([
      {
        ...event('direct-task', { threadId: 'thread-direct', agentVersionId: 'direct-agent-v1' }),
        type: 'task.agent-bound',
        sequence: 1,
      },
      {
        ...event('ignored-run-task', {
          threadId: 'thread-direct',
          agentVersionId: 'temporary-mentioned-agent-v1',
        }),
        taskId: undefined,
        type: 'run.started',
        sequence: 2,
      },
    ]);

    expect(projected.get('direct-task')).toBe('direct-agent-v1');
    expect(projected.has('ignored-run-task')).toBe(false);
  });

  it('projects group bindings by task without replacing them with the lead Agent', () => {
    const projected = projectTaskGroupIds([
      {
        ...event('task-group', {
          groupId: 'group-1',
          leadAgentVersionId: 'lead-v1',
        }),
        type: 'group.task-created',
      },
      { ...event('task-direct', { agentVersionId: 'agent-v1' }), sequence: 2 },
    ]);

    expect(projected.get('task-group')).toBe('group-1');
    expect(projected.has('task-direct')).toBe(false);
  });

  it('projects the latest non-empty summary for every task and keeps prior text during empty streaming', () => {
    const tasks = [
      task('task-a', '2026-07-18T00:00:00.000Z'),
      task('task-b', '2026-07-18T00:01:00.000Z'),
    ];
    const projected = projectTaskConversationSummaries(
      [
        {
          ...event('task-a', { threadId: 'thread-task-a', role: 'user', text: 'A 用户消息' }),
          type: 'message.appended',
          sequence: 1,
        },
        {
          ...event('task-b', { threadId: 'thread-task-b', role: 'user', text: 'B 用户消息' }),
          type: 'message.appended',
          sequence: 2,
        },
        {
          ...event('task-a', { threadId: 'thread-task-a' }),
          runId: 'run-a' as never,
          sequence: 3,
        },
        {
          ...event('task-b', { threadId: 'thread-task-b' }),
          runId: 'run-b' as never,
          sequence: 4,
        },
        {
          ...event('task-b', { textDelta: 'B Agent 回复' }),
          type: 'message.delta',
          runId: 'run-b' as never,
          sequence: 5,
        },
      ],
      tasks,
    );

    expect(projected.get('task-a')).toBe('A 用户消息');
    expect(projected.get('task-b')).toBe('B Agent 回复');
  });

  it('projects recent tasks across immutable Agent versions without duplicates', () => {
    const projected = projectAgentRelatedTasks(
      [
        event('task-old', { agentVersionId: 'agent-v1' }),
        event('task-new', { agentVersionId: 'agent-v2' }),
        event('task-new', { reviewerAgentVersionId: 'agent-v2' }),
        event('task-other', { agentVersionId: 'other-v1' }),
      ],
      [
        task('task-old', '2026-07-17T00:00:00.000Z'),
        task('task-new', '2026-07-18T00:00:00.000Z'),
        task('task-other', '2026-07-18T01:00:00.000Z'),
      ],
      [
        { agentId: 'agent-1', agentVersionId: 'agent-v1' },
        { agentId: 'agent-1', agentVersionId: 'agent-v2' },
        { agentId: 'agent-2', agentVersionId: 'other-v1' },
      ],
    );

    expect(projected.get('agent-1')?.map((item) => item.taskId)).toEqual(['task-new', 'task-old']);
    expect(projected.get('agent-2')?.map((item) => item.taskId)).toEqual(['task-other']);
  });

  it('projects group responsibilities and lead membership across Agent versions', () => {
    const group = {
      id: 'group-1',
      name: '发布小队',
      description: 'Ship safely',
      kind: 'fixed',
      leadAgentVersionId: 'agent-v2',
      approvalMode: 'full',
      collaborationMode: 'parallel',
      maxConcurrency: 3,
      members: [
        { agentVersionId: 'agent-v2', responsibility: '统筹与总结' },
        { agentVersionId: 'other-v1', responsibility: '执行验证' },
      ],
      visualIdentity: { icon: 'users', color: '#0d9488' },
      version: 1,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
    } as GroupDefinition;

    const projected = projectAgentGroupMemberships(
      [group],
      [
        { agentId: 'agent-1', agentVersionId: 'agent-v1' },
        { agentId: 'agent-1', agentVersionId: 'agent-v2' },
        { agentId: 'agent-2', agentVersionId: 'other-v1' },
      ],
    );

    expect(projected.get('agent-1')).toEqual([
      expect.objectContaining({ name: '发布小队', responsibility: '统筹与总结', isLead: true }),
    ]);
    expect(projected.get('agent-2')).toEqual([
      expect.objectContaining({ responsibility: '执行验证', isLead: false }),
    ]);
  });
});
