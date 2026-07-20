import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  projectConversationLogs,
  type ConversationLogAgentIdentity,
} from '../src/renderer/conversation-log-projection.js';

const THREAD_ID = 'thread-log';
const TASK_ID = 'task-log';

function eventAt(
  sequence: number,
  type: string,
  payload: Record<string, unknown> = {},
  overrides: Partial<Event> = {},
): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-log' as Event['workspaceId'],
    taskId: TASK_ID as Event['taskId'],
    category: 'system',
    type,
    sequence,
    occurredAt: `2026-07-18T08:00:${String(sequence).padStart(2, '0')}.000Z`,
    payload: {
      ...(type === 'message.appended' ? { threadId: THREAD_ID } : {}),
      ...payload,
    },
    ...overrides,
  };
}

const agents = new Map<string, ConversationLogAgentIdentity>([
  [
    'agent-architect',
    {
      agentVersionId: 'agent-architect',
      name: 'Architect',
      role: '规划智能体',
      responsibility: '需求分析与任务拆解',
      color: '#0d9488',
    },
  ],
  [
    'agent-builder',
    {
      agentVersionId: 'agent-builder',
      name: 'Builder',
      role: '执行智能体',
      responsibility: '实现界面',
      color: '#2563eb',
    },
  ],
  [
    'agent-reviewer',
    {
      agentVersionId: 'agent-reviewer',
      name: 'Reviewer',
      role: '审查智能体',
      responsibility: '检查结果',
      color: '#7c3aed',
    },
  ],
]);

describe('projectConversationLogs', () => {
  it('groups one user message and its real Run facts into one completed turn', () => {
    const logs = projectConversationLogs({
      threadId: THREAD_ID,
      taskId: TASK_ID,
      agents,
      events: [
        eventAt(1, 'message.appended', { role: 'user', text: '重新设计任务详情' }),
        eventAt(
          2,
          'run.started',
          {
            agentVersionId: 'agent-architect',
            providerModelId: 'claude-opus-4',
          },
          { runId: 'run-1' as Event['runId'], category: 'run' },
        ),
        eventAt(
          3,
          'context.packet.built',
          {
            agentVersionId: 'agent-architect',
            providerModelId: 'claude-opus-4',
            tokenEstimate: 1200,
          },
          { runId: 'run-1' as Event['runId'], category: 'context' },
        ),
        eventAt(
          4,
          'provider.usage',
          { tokensIn: 1200, tokensOut: 360 },
          { runId: 'run-1' as Event['runId'], category: 'provider' },
        ),
        eventAt(
          5,
          'tool.requested',
          { title: '读取文件' },
          { runId: 'run-1' as Event['runId'], category: 'tool' },
        ),
        eventAt(
          6,
          'message.appended',
          { role: 'assistant', text: '已完成新的任务详情设计。' },
          { runId: 'run-1' as Event['runId'], category: 'message' },
        ),
        eventAt(7, 'run.completed', {}, { runId: 'run-1' as Event['runId'], category: 'run' }),
      ],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      id: 'event-1',
      index: 1,
      userMessage: '重新设计任务详情',
      state: 'completed',
      runIds: ['run-1'],
      modelCallCount: 1,
      toolCallCount: 1,
      tokensIn: 1200,
      tokensOut: 360,
      artifactCount: 0,
      errorCount: 0,
      finalResponse: '已完成新的任务详情设计。',
    });
    expect(logs[0]?.durationMs).toBe(5000);
    expect(logs[0]?.stages).toHaveLength(1);
    expect(logs[0]?.stages[0]).toMatchObject({
      agentVersionId: 'agent-architect',
      agentName: 'Architect',
      responsibility: '需求分析与任务拆解',
      modelLabel: 'claude-opus-4',
      state: 'completed',
    });
  });

  it('keeps two user turns isolated and excludes another thread and task', () => {
    const events = [
      eventAt(1, 'message.appended', { role: 'user', text: '第一轮' }),
      eventAt(
        2,
        'run.started',
        { agentVersionId: 'agent-architect' },
        { runId: 'run-first' as Event['runId'] },
      ),
      eventAt(3, 'run.completed', {}, { runId: 'run-first' as Event['runId'] }),
      eventAt(4, 'message.appended', { role: 'user', text: '第二轮' }),
      eventAt(
        5,
        'run.started',
        { agentVersionId: 'agent-builder' },
        { runId: 'run-second' as Event['runId'] },
      ),
      eventAt(6, 'run.paused', { reason: 'manual' }, { runId: 'run-second' as Event['runId'] }),
      eventAt(7, 'message.appended', { threadId: 'thread-other', role: 'user', text: '其他线程' }),
      eventAt(
        8,
        'message.appended',
        { role: 'user', text: '其他任务' },
        { taskId: 'task-other' as Event['taskId'] },
      ),
    ];

    const logs = projectConversationLogs({
      events,
      threadId: THREAD_ID,
      taskId: TASK_ID,
      agents,
    });

    expect(logs.map((log) => log.userMessage)).toEqual(['第一轮', '第二轮']);
    expect(logs[0]).toMatchObject({ state: 'completed', runIds: ['run-first'] });
    expect(logs[1]).toMatchObject({ state: 'paused', runIds: ['run-second'] });
    expect(logs[0]?.stages.map((stage) => stage.agentName)).toEqual(['Architect']);
    expect(logs[1]?.stages.map((stage) => stage.agentName)).toEqual(['Builder']);
  });

  it('attributes multi-Agent Step logs and leaves unattributed recovery in Runtime', () => {
    const logs = projectConversationLogs({
      threadId: THREAD_ID,
      taskId: TASK_ID,
      agents,
      events: [
        eventAt(1, 'message.appended', { role: 'user', text: '并行实现并审查' }),
        eventAt(
          2,
          'run.recovered',
          { recoveredStepCount: 2 },
          { runId: 'run-group' as Event['runId'] },
        ),
        eventAt(
          3,
          'step.started',
          {
            title: '实现界面',
            agentVersionId: 'agent-builder',
            providerModelId: 'gpt-5.6',
          },
          {
            runId: 'run-group' as Event['runId'],
            stepId: 'step-build' as Event['stepId'],
          },
        ),
        eventAt(
          4,
          'context.packet.built',
          { agentVersionId: 'agent-builder', providerModelId: 'gpt-5.6' },
          {
            runId: 'run-group' as Event['runId'],
            stepId: 'step-build' as Event['stepId'],
          },
        ),
        eventAt(
          5,
          'artifact.version-created',
          { artifactName: 'detail-rail.tsx', version: 1 },
          {
            runId: 'run-group' as Event['runId'],
            stepId: 'step-build' as Event['stepId'],
            category: 'artifact',
          },
        ),
        eventAt(
          6,
          'step.completed',
          { title: '实现界面' },
          {
            runId: 'run-group' as Event['runId'],
            stepId: 'step-build' as Event['stepId'],
          },
        ),
        eventAt(
          7,
          'step.started',
          {
            title: '审查结果',
            agentVersionId: 'agent-reviewer',
            providerModelId: 'claude-sonnet-4',
          },
          {
            runId: 'run-group' as Event['runId'],
            stepId: 'step-review' as Event['stepId'],
          },
        ),
        eventAt(
          8,
          'run.fallback.selected',
          { fromProviderModelId: 'claude-sonnet-4', toProviderModelId: 'gpt-5.5' },
          {
            runId: 'run-group' as Event['runId'],
            stepId: 'step-review' as Event['stepId'],
          },
        ),
        eventAt(
          9,
          'step.failed',
          { title: '审查结果', failureClass: 'gateway-error' },
          {
            runId: 'run-group' as Event['runId'],
            stepId: 'step-review' as Event['stepId'],
          },
        ),
        eventAt(
          10,
          'run.failed',
          { failureClass: 'gateway-error' },
          { runId: 'run-group' as Event['runId'] },
        ),
      ],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      state: 'failed',
      modelCallCount: 1,
      artifactCount: 1,
      errorCount: 2,
    });
    expect(logs[0]?.stages.map((stage) => stage.agentName)).toEqual([
      'SYNC-THINK Runtime',
      'Builder',
      'Reviewer',
    ]);
    expect(logs[0]?.stages[1]).toMatchObject({
      title: '实现界面',
      modelLabel: 'gpt-5.6',
      state: 'completed',
    });
    expect(logs[0]?.stages[2]).toMatchObject({
      title: '审查结果',
      modelLabel: 'gpt-5.5',
      state: 'failed',
    });
    expect(logs[0]?.stages[2]?.events.some((event) => event.summary.includes('Fallback'))).toBe(
      true,
    );
  });

  it('keeps Runtime recovery separate after Agent resolution and does not complete on one Step', () => {
    const logs = projectConversationLogs({
      threadId: THREAD_ID,
      taskId: TASK_ID,
      agents,
      events: [
        eventAt(1, 'message.appended', { role: 'user', text: '继续执行并审查' }),
        eventAt(
          2,
          'run.started',
          { agentVersionId: 'agent-builder', providerModelId: 'gpt-5.6' },
          { runId: 'run-progress' as Event['runId'] },
        ),
        eventAt(
          3,
          'run.recovered',
          { recoveredStepCount: 1 },
          { runId: 'run-progress' as Event['runId'] },
        ),
        eventAt(
          4,
          'step.started',
          { title: '实现界面', agentVersionId: 'agent-builder' },
          {
            runId: 'run-progress' as Event['runId'],
            stepId: 'step-build' as Event['stepId'],
          },
        ),
        eventAt(
          5,
          'step.completed',
          { title: '实现界面' },
          {
            runId: 'run-progress' as Event['runId'],
            stepId: 'step-build' as Event['stepId'],
          },
        ),
        eventAt(
          6,
          'step.started',
          { title: '审查结果', agentVersionId: 'agent-reviewer' },
          {
            runId: 'run-progress' as Event['runId'],
            stepId: 'step-review' as Event['stepId'],
          },
        ),
      ],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.state).toBe('running');
    const recoveryStage = logs[0]?.stages.find((stage) =>
      stage.events.some((event) => event.type === 'run.recovered'),
    );
    expect(recoveryStage?.agentName).toBe('SYNC-THINK Runtime');
    expect(logs[0]?.stages.find((stage) => stage.id === 'step:step-review')).toMatchObject({
      agentName: 'Reviewer',
      state: 'running',
    });
  });

  it('exposes only known scrubbed details instead of arbitrary payload values', () => {
    const logs = projectConversationLogs({
      threadId: THREAD_ID,
      taskId: TASK_ID,
      agents,
      events: [
        eventAt(1, 'message.appended', { role: 'user', text: '检查上下文' }),
        eventAt(
          2,
          'context.packet.built',
          {
            agentVersionId: 'agent-architect',
            providerModelId: 'claude-opus-4',
            tokenEstimate: 720,
            apiKey: 'secret-must-not-render',
            credentialRefId: 'credential-private',
          },
          { runId: 'run-secret' as Event['runId'] },
        ),
      ],
    });

    const renderedDetails = logs[0]?.stages
      .flatMap((stage) => stage.events)
      .flatMap((event) => event.details.map((detail) => `${detail.label}:${detail.value}`))
      .join('\n');
    expect(renderedDetails).toContain('模型:claude-opus-4');
    expect(renderedDetails).toContain('Token 估算:720');
    expect(renderedDetails).not.toContain('secret-must-not-render');
    expect(renderedDetails).not.toContain('credential-private');
  });

  it('pairs real command requests with results, timing, output, and secret redaction', () => {
    const logs = projectConversationLogs({
      threadId: THREAD_ID,
      taskId: TASK_ID,
      agents,
      events: [
        eventAt(1, 'message.appended', { role: 'user', text: '运行测试' }),
        eventAt(
          2,
          'run.started',
          { threadId: THREAD_ID, agentVersionId: 'agent-builder', providerModelId: 'gpt-5.6' },
          { runId: 'run-command' as Event['runId'] },
        ),
        eventAt(
          3,
          'tool.requested',
          {
            threadId: THREAD_ID,
            agentVersionId: 'agent-builder',
            toolCall: {
              id: 'call-command',
              name: 'run_command',
              argumentsJson: '{"command":"pnpm","args":["test"],"cwd":"D:/repo"}',
            },
          },
          { runId: 'run-command' as Event['runId'], stepId: 'step-command' as Event['stepId'] },
        ),
        eventAt(
          4,
          'tool.completed',
          {
            threadId: THREAD_ID,
            toolCallId: 'call-command',
            durationMs: 830,
            result: JSON.stringify({
              ok: true,
              exitCode: 0,
              stdout: 'passed api_key=sk-THIS_SHOULD_BE_REDACTED',
              stderr: '',
            }),
          },
          { runId: 'run-command' as Event['runId'], stepId: 'step-command' as Event['stepId'] },
        ),
      ],
    });
    const toolEvents =
      logs[0]?.stages
        .flatMap((stage) => stage.events)
        .filter((event) => event.type.startsWith('tool.')) ?? [];
    expect(toolEvents[0]?.summary).toBe('执行命令');
    const details = toolEvents.flatMap((event) => event.details);
    expect(details).toContainEqual({ label: '命令', value: 'pnpm test' });
    expect(details).toContainEqual({ label: '工作目录', value: 'D:/repo' });
    expect(details).toContainEqual({ label: '退出码', value: '0' });
    expect(details).toContainEqual({ label: '耗时', value: '830 ms' });
    expect(details.find((detail) => detail.label === '标准输出')?.value).toContain('[REDACTED]');
    expect(details.find((detail) => detail.label === '标准输出')?.value).not.toContain(
      'THIS_SHOULD_BE_REDACTED',
    );
  });
});
