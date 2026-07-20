import { describe, expect, it } from 'vitest';
import type { RunGraphResponse } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import { projectConversationTaskProgress } from '../src/renderer/conversation-progress-projection.js';
import type { ConversationLogTurn } from '../src/renderer/conversation-log-projection.js';

const emptyTurn: ConversationLogTurn = {
  id: 'turn-empty',
  index: 1,
  userMessage: '先记录问题',
  state: 'unknown',
  startedAt: '2026-07-18T08:00:00.000Z',
  runIds: [],
  modelCallCount: 0,
  toolCallCount: 0,
  artifactCount: 0,
  errorCount: 0,
  stages: [],
};

const graph = {
  run: {
    id: 'run-progress',
    taskId: 'task-progress',
    state: 'running',
    planRevisionId: 'plan-revision',
    createdAt: '2026-07-18T07:55:00.000Z',
    updatedAt: '2026-07-18T08:00:00.000Z',
    stepIds: ['step-build', 'step-review'],
  },
  steps: [
    {
      id: 'step-build',
      runId: 'run-progress',
      kind: 'execution',
      agentVersionId: 'agent-builder',
      dependsOn: [],
      planOrder: 0,
      title: '实现界面',
      instructions: '实现',
      state: 'completed',
      retries: 0,
      createdAt: '2026-07-18T07:55:00.000Z',
      updatedAt: '2026-07-18T08:00:20.000Z',
    },
    {
      id: 'step-review',
      runId: 'run-progress',
      kind: 'review',
      agentVersionId: 'agent-builder',
      dependsOn: ['step-build'],
      planOrder: 1,
      title: '审查界面',
      instructions: '审查',
      state: 'running',
      retries: 0,
      createdAt: '2026-07-18T07:55:00.000Z',
      updatedAt: '2026-07-18T08:00:30.000Z',
    },
  ],
  dependencies: [],
} as unknown as RunGraphResponse;

const runningTurn: ConversationLogTurn = {
  ...emptyTurn,
  id: 'turn-running',
  state: 'running',
  runIds: ['run-progress'],
  stages: [
    {
      id: 'step:step-build',
      title: '实现界面',
      agentVersionId: 'agent-builder',
      agentName: 'Builder',
      role: '执行智能体',
      modelLabel: 'gpt-5.6',
      state: 'completed',
      events: [],
    },
    {
      id: 'step:step-review',
      title: '审查界面',
      agentVersionId: 'agent-builder',
      agentName: 'Builder',
      role: '执行智能体',
      modelLabel: 'claude-sonnet-4-fallback',
      state: 'running',
      events: [],
    },
  ],
};

describe('projectConversationTaskProgress', () => {
  it('shows not-started when a user turn exists but no Run or execution stage exists', () => {
    const result = projectConversationTaskProgress({
      runGraph: null,
      turns: [emptyTurn],
      events: [],
      agents: new Map(),
      modelLabelsById: new Map(),
      nowMs: Date.parse('2026-07-18T08:01:00.000Z'),
    });

    expect(result.summary).toEqual({
      state: 'not-started',
      completedSteps: 0,
      totalSteps: 0,
    });
  });

  it('uses run.started timing, fallback stage model, and one participant per AgentVersion', () => {
    const events = [
      {
        id: 'event-start',
        workspaceId: 'workspace-progress',
        taskId: 'task-progress',
        category: 'run',
        type: 'run.started',
        runId: 'run-progress',
        sequence: 1,
        occurredAt: '2026-07-18T08:00:00.000Z',
        payload: {},
      },
    ] as Event[];
    const result = projectConversationTaskProgress({
      runGraph: graph,
      turns: [runningTurn],
      events,
      agents: new Map([
        [
          'agent-builder',
          {
            agentVersionId: 'agent-builder',
            name: 'Builder',
            role: '执行智能体',
            responsibility: '实现与审查',
            defaultModelId: 'model-default',
          },
        ],
      ]),
      modelLabelsById: new Map([['model-default', 'OpenAI · gpt-5.6']]),
      nowMs: Date.parse('2026-07-18T08:01:00.000Z'),
    });

    expect(result.summary.durationMs).toBe(60_000);
    expect(result.participants).toHaveLength(1);
    expect(result.participants[0]).toMatchObject({
      id: 'agent-builder',
      modelLabel: 'claude-sonnet-4-fallback',
      state: 'running',
    });
  });

  it('keeps direct tool calls in execution logs and exposes one user-facing work item', () => {
    const turn: ConversationLogTurn = {
      ...runningTurn,
      runIds: ['run-direct'],
      stages: [
        {
          ...runningTurn.stages[0]!,
          id: 'run:run-direct:agent:agent-builder',
          state: 'running',
        },
      ],
    };
    const events = [
      {
        id: 'event-run',
        workspaceId: 'workspace-progress',
        taskId: 'task-progress',
        category: 'run',
        type: 'run.started',
        runId: 'run-direct',
        sequence: 1,
        occurredAt: '2026-07-18T08:00:00.000Z',
        payload: {},
      },
      {
        id: 'event-tool-started',
        workspaceId: 'workspace-progress',
        taskId: 'task-progress',
        category: 'tool',
        type: 'application.tool_started',
        runId: 'run-direct',
        sequence: 2,
        occurredAt: '2026-07-18T08:00:01.000Z',
        payload: { toolCallId: 'tool-1', toolName: 'sync_think.task.create' },
      },
      {
        id: 'event-tool-completed',
        workspaceId: 'workspace-progress',
        taskId: 'task-progress',
        category: 'tool',
        type: 'application.tool_completed',
        runId: 'run-direct',
        sequence: 3,
        occurredAt: '2026-07-18T08:00:02.000Z',
        payload: { toolCallId: 'tool-1', toolName: 'sync_think.task.create' },
      },
    ] as Event[];

    const result = projectConversationTaskProgress({
      runGraph: null,
      turns: [turn],
      events,
      agents: new Map(),
      modelLabelsById: new Map(),
      nowMs: Date.parse('2026-07-18T08:01:00.000Z'),
    });

    expect(result.steps.map((step) => step.title)).toEqual(['完成本轮需求并整理结果']);
    expect(result.steps.some((step) => /task \/ create/i.test(step.title))).toBe(false);
    expect(result.summary).toMatchObject({ completedSteps: 0, totalSteps: 1 });
  });

  it('shows only the subtasks actually delegated by the group lead', () => {
    const groupGraph = {
      run: {
        ...graph.run,
        id: 'run-group',
        stepIds: ['lead-plan', 'worker-a', 'worker-b', 'lead-final'],
      },
      steps: [
        {
          ...graph.steps[0],
          id: 'lead-plan',
          runId: 'run-group',
          agentVersionId: 'agent-lead',
          planOrder: 0,
          title: '主智能体分析并分解任务',
        },
        {
          ...graph.steps[0],
          id: 'worker-a',
          runId: 'run-group',
          agentVersionId: 'agent-worker-a',
          planOrder: 1,
          title: '实现',
        },
        {
          ...graph.steps[0],
          id: 'worker-b',
          runId: 'run-group',
          agentVersionId: 'agent-worker-b',
          planOrder: 2,
          title: '测试',
        },
        {
          ...graph.steps[0],
          id: 'lead-final',
          runId: 'run-group',
          agentVersionId: 'agent-lead',
          planOrder: 3,
          title: '主智能体检查并总结结果',
        },
      ],
      dependencies: [],
    } as unknown as RunGraphResponse;
    const events = [
      {
        id: 'event-decision',
        workspaceId: 'workspace-progress',
        taskId: 'task-progress',
        category: 'run',
        type: 'group.delegation-decided',
        runId: 'run-group',
        sequence: 1,
        occurredAt: '2026-07-18T08:00:00.000Z',
        payload: { mode: 'delegate' },
      },
      {
        id: 'event-delegated',
        workspaceId: 'workspace-progress',
        taskId: 'task-progress',
        category: 'step',
        type: 'group.subtask-delegated',
        runId: 'run-group',
        sequence: 2,
        occurredAt: '2026-07-18T08:00:01.000Z',
        payload: {
          toAgentVersionId: 'agent-worker-b',
          goal: '运行关键验证并汇总失败项',
        },
      },
    ] as Event[];

    const result = projectConversationTaskProgress({
      runGraph: groupGraph,
      turns: [],
      events,
      agents: new Map(),
      modelLabelsById: new Map(),
      nowMs: Date.parse('2026-07-18T08:01:00.000Z'),
    });

    expect(result.steps.map((step) => step.id)).toEqual(['worker-b', 'lead-final']);
    expect(result.steps[0]?.title).toBe('运行关键验证并汇总失败项');
    expect(result.steps[0]?.agentName).toBe('agent-worker-b');
    expect(result.summary.totalSteps).toBe(2);
  });
});
