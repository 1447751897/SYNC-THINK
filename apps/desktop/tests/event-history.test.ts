import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import { mergeEventHistory } from '../src/event-history.js';
import { projectConversation, projectM0EventHistory } from '../src/renderer/m0-projection.js';
import {
  canSendRuntimeMessage,
  createInitialRuntimeViewState,
  runtimeViewReducer,
} from '../src/renderer/runtime-view-state.js';

function eventAt(sequence: number, overrides: Partial<Event> = {}): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-desktop' as Event['workspaceId'],
    category: 'system',
    type: `system.event-${sequence}`,
    sequence,
    occurredAt: `2026-07-11T08:00:${String(sequence).padStart(2, '0')}.000Z`,
    payload: {},
    ...overrides,
  };
}

describe('desktop runtime event history', () => {
  it('keeps Run completion separate from review and summarizes M2 orchestration events', () => {
    const threadId = 'thread-m2-trace';
    const events = [
      eventAt(1, {
        category: 'run',
        type: 'plan.approved',
        taskId: 'task-m2' as Event['taskId'],
        payload: { threadId, revision: 2, planId: 'plan-1' },
      }),
      eventAt(2, {
        category: 'run',
        type: 'step.started',
        taskId: 'task-m2' as Event['taskId'],
        runId: 'run-m2' as Event['runId'],
        stepId: 'step-design' as Event['stepId'],
        payload: { threadId, title: 'Design' },
      }),
      eventAt(3, {
        category: 'artifact',
        type: 'artifact.version-created',
        taskId: 'task-m2' as Event['taskId'],
        runId: 'run-m2' as Event['runId'],
        payload: { threadId, artifactName: 'design.md', version: 2 },
      }),
      eventAt(4, {
        category: 'review',
        type: 'review.rejected',
        taskId: 'task-m2' as Event['taskId'],
        runId: 'run-m2' as Event['runId'],
        payload: { threadId, iteration: 1 },
      }),
      eventAt(5, {
        category: 'approval',
        type: 'approval.decided',
        taskId: 'task-m2' as Event['taskId'],
        runId: 'run-m2' as Event['runId'],
        payload: { threadId, decision: 'approved', action: 'shell.exec' },
      }),
      eventAt(6, {
        category: 'run',
        type: 'run.recovered',
        taskId: 'task-m2' as Event['taskId'],
        runId: 'run-m2' as Event['runId'],
        payload: { threadId, recoveredStepCount: 1 },
      }),
      eventAt(7, {
        category: 'run',
        type: 'run.completed',
        taskId: 'task-m2' as Event['taskId'],
        runId: 'run-m2' as Event['runId'],
        payload: { threadId },
      }),
    ];

    const projection = projectConversation(events, threadId, 'task-m2');
    expect(projection.trace.map((item) => item.id)).toEqual(events.map((event) => event.id));
    expect(projection.trace.find((item) => item.id === 'event-7')?.category).toBe('run');
    expect(projection.trace.find((item) => item.id === 'event-4')?.category).toBe('review');
    expect(projection.trace.find((item) => item.id === 'event-3')).toMatchObject({
      category: 'artifact',
      summary: expect.stringMatching(/design\.md|v2/),
    });
    expect(projection.trace.find((item) => item.id === 'event-5')).toMatchObject({
      category: 'approval',
      summary: expect.stringMatching(/批准|approved|shell\.exec/i),
    });
    expect(projection.trace.find((item) => item.id === 'event-6')?.category).toBe('recovery');
  });

  it('produces the same ordered history for live-before-snapshot and snapshot-before-live', () => {
    const snapshot = [eventAt(1), eventAt(2)];
    const live = [eventAt(3)];

    const liveBeforeSnapshot = mergeEventHistory(mergeEventHistory([], live), snapshot);
    const snapshotBeforeLive = mergeEventHistory(mergeEventHistory([], snapshot), live);

    expect(liveBeforeSnapshot).toEqual(snapshotBeforeLive);
    expect(liveBeforeSnapshot.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('sorts by sequence and removes repeated sequences', () => {
    const repeated = eventAt(2);

    const history = mergeEventHistory(
      [eventAt(3), repeated],
      [eventAt(1), repeated, eventAt(4), eventAt(3)],
    );

    expect(history.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it('rebuilds user messages and the latest demo assistant without repeated output', () => {
    const threadId = 'thread-desktop-main';
    const firstUser = eventAt(1, {
      category: 'message',
      type: 'message.appended',
      payload: { threadId, role: 'user', text: 'first', taskVersion: 1 },
    });
    const latestDelta = eventAt(9, {
      category: 'message',
      type: 'message.delta',
      runId: 'run-latest' as Event['runId'],
      payload: { threadId, textDelta: 'latest answer' },
    });
    const history = [
      eventAt(10, { category: 'provider', type: 'provider.usage' }),
      latestDelta,
      eventAt(8, {
        category: 'run',
        type: 'run.started',
        runId: 'run-latest' as Event['runId'],
        payload: { threadId },
      }),
      eventAt(7, {
        category: 'message',
        type: 'message.appended',
        payload: { threadId: 'thread-other', role: 'user', text: 'other', taskVersion: 99 },
      }),
      eventAt(6, {
        category: 'message',
        type: 'message.appended',
        payload: { threadId, role: 'user', text: 'second', taskVersion: 2 },
      }),
      eventAt(5, {
        category: 'run',
        type: 'run.completed',
        runId: 'run-first' as Event['runId'],
        payload: { threadId, assistantText: 'old answer' },
      }),
      eventAt(4, {
        category: 'message',
        type: 'message.delta',
        runId: 'run-first' as Event['runId'],
        payload: { threadId, textDelta: ' answer' },
      }),
      eventAt(3, {
        category: 'message',
        type: 'message.delta',
        runId: 'run-first' as Event['runId'],
        payload: { threadId, textDelta: 'old' },
      }),
      eventAt(2, {
        category: 'run',
        type: 'run.started',
        runId: 'run-first' as Event['runId'],
        payload: { threadId },
      }),
      firstUser,
      firstUser,
      latestDelta,
    ];

    const projection = projectM0EventHistory(history, threadId);

    expect(projection.userMessages.map((message) => message.text)).toEqual(['first', 'second']);
    expect(projection.assistantText).toBe('latest answer');
  });

  it('uses the latest task version for the current thread', () => {
    const threadId = 'thread-desktop-main';
    const projection = projectM0EventHistory(
      [
        eventAt(3, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'latest', taskVersion: 4 },
        }),
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'first', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId: 'thread-other', role: 'user', text: 'other', taskVersion: 20 },
        }),
      ],
      threadId,
    );

    expect(projection.taskVersion).toBe(4);
  });

  it('keeps a richer thread-scoped trace with human summaries', () => {
    const threadId = 'thread-desktop-main';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'hello world', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-1' as Event['runId'],
          payload: { threadId, modelId: 'fake-mini' },
        }),
        eventAt(3, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-1' as Event['runId'],
          payload: { threadId, textDelta: 'hi' },
        }),
        eventAt(4, {
          category: 'run',
          type: 'run.completed',
          runId: 'run-1' as Event['runId'],
          payload: { threadId, assistantText: 'hi' },
        }),
        // Noise from other threads should not flood the active trace when scoped.
        eventAt(5, {
          category: 'system',
          type: 'system.noise',
          payload: { threadId: 'thread-other' },
        }),
      ],
      threadId,
    );

    expect(projection.trace.map((item) => item.summary)).toEqual([
      '用户消息 · hello world',
      'Run 启动 · fake-mini',
      '模型输出中…',
      'Run 完成',
    ]);
  });

  it('keeps the exact AgentVersion identity on an assistant turn through fallback and completion', () => {
    const threadId = 'thread-agent-identity';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'run',
          type: 'run.started',
          runId: 'run-agent-identity' as Event['runId'],
          payload: {
            threadId,
            modelId: 'model-primary',
            agentVersionId: 'agent-version-planner-v3',
          },
        }),
        eventAt(2, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-agent-identity' as Event['runId'],
          payload: { threadId, textDelta: 'answer' },
        }),
        eventAt(3, {
          category: 'run',
          type: 'run.fallback.selected',
          runId: 'run-agent-identity' as Event['runId'],
          payload: { threadId, toModelId: 'model-fallback' },
        }),
        eventAt(4, {
          category: 'run',
          type: 'run.completed',
          runId: 'run-agent-identity' as Event['runId'],
          payload: { threadId, assistantText: 'answer' },
        }),
      ],
      threadId,
    );

    expect(projection.messages).toHaveLength(1);
    expect(projection.messages[0]).toMatchObject({
      role: 'assistant',
      agentVersionId: 'agent-version-planner-v3',
      modelId: 'model-fallback',
      text: 'answer',
      streaming: false,
    });
  });

  it('keeps the complete task trace instead of discarding events before the newest 24', () => {
    const threadId = 'thread-complete-audit';
    const events = Array.from({ length: 30 }, (_, index) =>
      eventAt(index + 1, {
        category: 'run',
        type: 'step.completed',
        taskId: 'task-complete-audit' as Event['taskId'],
        stepId: `step-${index + 1}` as Event['stepId'],
        payload: { threadId, title: `Step ${index + 1}` },
      }),
    );

    const projection = projectConversation(events, threadId, 'task-complete-audit');

    expect(projection.trace).toHaveLength(30);
    expect(projection.trace[0]?.id).toBe('event-1');
    expect(projection.trace[29]?.id).toBe('event-30');
  });

  it('preserves full reviewer explanation, criteria, and reviewed ArtifactVersion IDs as selectable details', () => {
    const threadId = 'thread-review-details';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'review',
          type: 'review.evidence-recorded',
          taskId: 'task-review-details' as Event['taskId'],
          runId: 'run-review-details' as Event['runId'],
          stepId: 'step-review-details' as Event['stepId'],
          payload: {
            threadId,
            verdict: 'reject',
            iteration: 2,
            explanation: 'The second requirement is not satisfied and must be reworked.',
            criteria: [
              {
                criterionId: 'criterion-1',
                verdict: 'pass',
                explanation: 'The first requirement is satisfied.',
              },
              {
                criterionId: 'criterion-2',
                verdict: 'fail',
                explanation: 'Missing the required verification evidence.',
              },
            ],
            reviewedArtifactVersionIds: ['artifact-version-a', 'artifact-version-b'],
          },
        }),
      ],
      threadId,
      'task-review-details',
    );

    expect(projection.trace[0]?.details).toEqual([
      { label: '事件', value: 'review.evidence-recorded' },
      { label: 'Run', value: 'run-review-details' },
      { label: 'Step', value: 'step-review-details' },
      {
        label: '评审说明',
        value: 'The second requirement is not satisfied and must be reworked.',
      },
      {
        label: '标准 criterion-1',
        value: 'pass · The first requirement is satisfied.',
      },
      {
        label: '标准 criterion-2',
        value: 'fail · Missing the required verification evidence.',
      },
      { label: '产物版本', value: 'artifact-version-a, artifact-version-b' },
    ]);
  });

  it('summarizes real approval, review evidence and runtime recovery events', () => {
    const threadId = 'thread-real-events';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'approval',
          type: 'approval.requested',
          taskId: 'task-real' as Event['taskId'],
          payload: { threadId, action: 'shell.exec', kind: 'tool' },
        }),
        eventAt(2, {
          category: 'review',
          type: 'review.evidence-recorded',
          taskId: 'task-real' as Event['taskId'],
          payload: { threadId, verdict: 'accept', iteration: 1 },
        }),
        eventAt(3, {
          category: 'review',
          type: 'review.evidence-recorded',
          taskId: 'task-real' as Event['taskId'],
          payload: { threadId, verdict: 'reject', iteration: 2 },
        }),
        eventAt(4, {
          category: 'step',
          type: 'step.ready',
          taskId: 'task-real' as Event['taskId'],
          stepId: 'step-2' as Event['stepId'],
          payload: { threadId, reason: 'runtime-recovery' },
        }),
      ],
      threadId,
      'task-real',
    );

    expect(projection.trace[0]).toMatchObject({
      category: 'approval',
      summary: expect.stringMatching(/shell\.exec/),
    });
    expect(projection.trace[1]).toMatchObject({
      category: 'review',
      summary: expect.stringMatching(/accept|pass|通过/i),
    });
    expect(projection.trace[2]).toMatchObject({
      category: 'review',
      summary: expect.stringMatching(/reject|return|退回/i),
    });
    expect(projection.trace[3]).toMatchObject({
      category: 'recovery',
      summary: expect.stringMatching(/runtime|recover|恢复/i),
    });
  });
});

describe('conversation projection', () => {
  it('interleaves multi-turn user and completed assistant messages in order', () => {
    const threadId = 'thread-a';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'q1', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-1' as Event['runId'],
          payload: { threadId, modelId: 'fake-mini' },
        }),
        eventAt(3, {
          category: 'run',
          type: 'run.completed',
          runId: 'run-1' as Event['runId'],
          payload: { threadId, assistantText: 'a1' },
        }),
        eventAt(4, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'q2', taskVersion: 2 },
        }),
        eventAt(5, {
          category: 'run',
          type: 'run.started',
          runId: 'run-2' as Event['runId'],
          payload: { threadId, modelId: 'fake-large' },
        }),
        eventAt(6, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-2' as Event['runId'],
          payload: { threadId, textDelta: 'a2' },
        }),
        eventAt(7, {
          category: 'run',
          type: 'run.completed',
          runId: 'run-2' as Event['runId'],
          payload: { threadId, assistantText: 'a2 full' },
        }),
      ],
      threadId,
    );

    expect(projection.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      'user:q1',
      'assistant:a1',
      'user:q2',
      'assistant:a2 full',
    ]);
    expect(projection.messages.every((m) => !m.streaming)).toBe(true);
    expect(projection.stream.state).toBe('completed');
    expect(projection.stream.modelId).toBe('fake-large');
  });

  it('shows a streaming assistant bubble while deltas arrive for the active run', () => {
    const threadId = 'thread-a';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'stream me', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-live' as Event['runId'],
          payload: { threadId, modelId: 'fake-mini' },
        }),
        eventAt(3, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-live' as Event['runId'],
          payload: { threadId, textDelta: 'Hel' },
        }),
        eventAt(4, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-live' as Event['runId'],
          payload: { threadId, textDelta: 'lo' },
        }),
      ],
      threadId,
    );

    expect(projection.messages).toHaveLength(2);
    expect(projection.messages[0]).toMatchObject({ role: 'user', text: 'stream me' });
    expect(projection.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'Hello',
      streaming: true,
      runId: 'run-live',
      modelId: 'fake-mini',
    });
    expect(projection.stream).toMatchObject({
      state: 'streaming',
      runId: 'run-live',
      modelId: 'fake-mini',
    });
  });

  it('retains prior assistant answers when a newer run starts', () => {
    const threadId = 'thread-a';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'first', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-old' as Event['runId'],
          payload: { threadId, modelId: 'fake-mini' },
        }),
        eventAt(3, {
          category: 'run',
          type: 'run.completed',
          runId: 'run-old' as Event['runId'],
          payload: { threadId, assistantText: 'old answer' },
        }),
        eventAt(4, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'second', taskVersion: 2 },
        }),
        eventAt(5, {
          category: 'run',
          type: 'run.started',
          runId: 'run-new' as Event['runId'],
          payload: { threadId, modelId: 'fake-large' },
        }),
        eventAt(6, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-new' as Event['runId'],
          payload: { threadId, textDelta: 'partial' },
        }),
      ],
      threadId,
    );

    expect(projection.messages.map((m) => m.text)).toEqual([
      'first',
      'old answer',
      'second',
      'partial',
    ]);
    expect(projection.messages[1].streaming).toBeFalsy();
    expect(projection.messages[3].streaming).toBe(true);
    expect(projection.stream.state).toBe('streaming');
  });

  it('marks cancelled runs and keeps partial text', () => {
    const threadId = 'thread-a';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'cancel me', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-c' as Event['runId'],
          payload: { threadId, modelId: 'fake-mini' },
        }),
        eventAt(3, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-c' as Event['runId'],
          payload: { threadId, textDelta: 'partial…' },
        }),
        eventAt(4, {
          category: 'run',
          type: 'run.cancelled',
          runId: 'run-c' as Event['runId'],
          payload: { threadId, reason: 'cancelled' },
        }),
      ],
      threadId,
    );

    expect(projection.messages[1]).toMatchObject({
      role: 'assistant',
      text: 'partial…',
      streaming: false,
    });
    expect(projection.stream.state).toBe('cancelled');
  });

  it('marks failed runs with error summary', () => {
    const threadId = 'thread-a';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'fail', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-f' as Event['runId'],
          payload: { threadId },
        }),
        eventAt(3, {
          category: 'run',
          type: 'run.failed',
          runId: 'run-f' as Event['runId'],
          payload: { threadId, failureClass: 'timeout' },
        }),
      ],
      threadId,
    );

    expect(projection.stream.state).toBe('failed');
    expect(projection.stream.errorSummary).toContain('timeout');
  });

  it('surfaces fallback selection and pause in stream + trace', () => {
    const threadId = 'thread-fallback';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'same task across models', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-fb' as Event['runId'],
          payload: {
            threadId,
            modelId: 'model-alpha',
            providerModelId: 'gpt-alpha',
            resolutionSource: 'agentDefault',
          },
        }),
        eventAt(3, {
          category: 'context',
          type: 'context.packet.built',
          runId: 'run-fb' as Event['runId'],
          payload: {
            threadId,
            modelId: 'model-alpha',
            providerModelId: 'gpt-alpha',
            resolutionSource: 'agentDefault',
            tokenEstimate: 40,
          },
        }),
        eventAt(4, {
          category: 'run',
          type: 'run.fallback.selected',
          runId: 'run-fb' as Event['runId'],
          payload: {
            threadId,
            fromModelId: 'model-alpha',
            toModelId: 'model-beta',
            fromProviderModelId: 'gpt-alpha',
            toProviderModelId: 'gpt-beta',
            failureClass: 'timeout',
            resolutionSource: 'agentFallback',
            fallbackIndex: 0,
          },
        }),
        eventAt(5, {
          category: 'context',
          type: 'context.packet.built',
          runId: 'run-fb' as Event['runId'],
          payload: {
            threadId,
            modelId: 'model-beta',
            providerModelId: 'gpt-beta',
            resolutionSource: 'agentFallback',
            tokenEstimate: 40,
          },
        }),
        eventAt(6, {
          category: 'message',
          type: 'message.delta',
          runId: 'run-fb' as Event['runId'],
          payload: { threadId, textDelta: 'recovered' },
        }),
      ],
      threadId,
    );

    expect(projection.stream.state).toBe('streaming');
    expect(projection.stream.modelId).toBe('model-beta');
    expect(projection.stream.notice).toMatch(/Fallback/i);
    expect(projection.stream.notice).toMatch(/gpt-alpha/);
    expect(projection.stream.notice).toMatch(/gpt-beta|model-beta/);
    const assistant = projection.messages.find((m) => m.role === 'assistant');
    expect(assistant?.modelId).toBe('model-beta');
    expect(assistant?.text).toBe('recovered');
    expect(projection.trace.some((t) => /Fallback|切换/.test(t.summary))).toBe(true);
    expect(
      projection.trace.some((t) => t.category === 'model-call' && /Fallback|切换/.test(t.summary)),
    ).toBe(true);
    expect(
      projection.trace.some((t) => /Manifest/.test(t.summary) && /agentFallback/.test(t.summary)),
    ).toBe(true);
  });

  it('projects run.paused as terminal with reason and no silent success', () => {
    const threadId = 'thread-paused';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'will pause', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-p' as Event['runId'],
          payload: { threadId, modelId: 'model-only', providerModelId: 'only-one' },
        }),
        eventAt(3, {
          category: 'run',
          type: 'run.paused',
          runId: 'run-p' as Event['runId'],
          payload: {
            threadId,
            reason: 'no_fallback_configured',
            failedModelId: 'model-only',
            failureClass: 'timeout',
            modelId: 'model-only',
            providerModelId: 'only-one',
          },
        }),
      ],
      threadId,
    );

    expect(projection.stream.state).toBe('paused');
    expect(projection.stream.errorSummary).toMatch(/无 fallback|未配置|pause/i);
    expect(projection.stream.modelId).toBe('model-only');
    const assistant = projection.messages.find((m) => m.role === 'assistant');
    expect(assistant?.streaming).toBeFalsy();
    expect(projection.trace.some((t) => /暂停|paused/i.test(t.summary))).toBe(true);
    expect(projection.trace.find((t) => /暂停|paused/i.test(t.summary))?.category).toBe('recovery');
  });

  it('projects inspectable Manifests from context.packet.built for each model call', () => {
    const threadId = 'thread-manifest';
    const projection = projectConversation(
      [
        eventAt(1, {
          category: 'message',
          type: 'message.appended',
          payload: { threadId, role: 'user', text: 'inspect me', taskVersion: 1 },
        }),
        eventAt(2, {
          category: 'run',
          type: 'run.started',
          runId: 'run-m1' as Event['runId'],
          payload: {
            threadId,
            modelId: 'model-primary',
            providerModelId: 'gpt-primary',
            resolutionSource: 'agentDefault',
          },
        }),
        eventAt(3, {
          id: 'event-manifest-1' as Event['id'],
          category: 'context',
          type: 'context.packet.built',
          runId: 'run-m1' as Event['runId'],
          payload: {
            threadId,
            packetId: 'pkt-primary',
            proofHash: 'abc123def456abc123def456abc123de',
            modelId: 'model-primary',
            providerModelId: 'gpt-primary',
            resolutionSource: 'agentDefault',
            agentVersionId: 'agent-v1',
            includedSourceIds: ['msg-run-m1', 'agent-instructions'],
            excludedSourceIds: ['cross-task-old'],
            includedSources: [
              { id: 'msg-run-m1', kind: 'message-excerpt', tokenEstimate: 12 },
              { id: 'agent-instructions', kind: 'agent-instructions', tokenEstimate: 32 },
            ],
            excludedSources: [{ id: 'cross-task-old', kind: 'cross-task-ref', tokenEstimate: 40 }],
            summaries: [
              { sourceId: 'msg-run-m1', summary: 'inspect me' },
              { sourceId: 'agent-instructions', summary: 'default conversation agent' },
            ],
            truncations: [
              {
                sourceId: 'msg-run-m1',
                reason: 'budget',
                beforeTokens: 80,
                afterTokens: 12,
              },
            ],
            crossTaskRefs: [],
            evidenceRefsForMemory: [],
            tokenEstimate: 44,
          },
        }),
        eventAt(4, {
          category: 'run',
          type: 'run.fallback.selected',
          runId: 'run-m1' as Event['runId'],
          payload: {
            threadId,
            fromModelId: 'model-primary',
            toModelId: 'model-fallback',
            fromProviderModelId: 'gpt-primary',
            toProviderModelId: 'claude-fallback',
            failureClass: 'rate_limit',
            resolutionSource: 'agentFallback',
            fallbackIndex: 0,
          },
        }),
        eventAt(5, {
          id: 'event-manifest-2' as Event['id'],
          category: 'context',
          type: 'context.packet.built',
          runId: 'run-m1' as Event['runId'],
          payload: {
            threadId,
            packetId: 'pkt-fallback',
            proofHash: 'fedcba9876543210fedcba9876543210',
            modelId: 'model-fallback',
            providerModelId: 'claude-fallback',
            resolutionSource: 'agentFallback',
            agentVersionId: 'agent-v1',
            fallbackIndex: 0,
            includedSourceIds: ['msg-run-m1', 'agent-instructions'],
            tokenEstimate: 40,
          },
        }),
      ],
      threadId,
    );

    expect(projection.manifests).toHaveLength(2);

    const primary = projection.manifests[0];
    expect(primary.id).toBe('event-manifest-1');
    expect(primary.packetId).toBe('pkt-primary');
    expect(primary.proofHash).toBe('abc123def456abc123def456abc123de');
    expect(primary.modelId).toBe('model-primary');
    expect(primary.providerModelId).toBe('gpt-primary');
    expect(primary.resolutionSource).toBe('agentDefault');
    expect(primary.agentVersionId).toBe('agent-v1');
    expect(primary.tokenEstimate).toBe(44);
    expect(primary.includedSourceIds).toEqual(['msg-run-m1', 'agent-instructions']);
    expect(primary.excludedSourceIds).toEqual(['cross-task-old']);
    expect(primary.included.map((s) => s.kind)).toEqual(['message-excerpt', 'agent-instructions']);
    expect(primary.excluded[0]?.id).toBe('cross-task-old');
    expect(primary.summaries.some((s) => s.summary === 'inspect me')).toBe(true);
    expect(primary.truncations[0]?.reason).toBe('budget');
    expect(primary.runId).toBe('run-m1');

    const fallback = projection.manifests[1];
    expect(fallback.packetId).toBe('pkt-fallback');
    expect(fallback.resolutionSource).toBe('agentFallback');
    expect(fallback.fallbackIndex).toBe(0);
    expect(fallback.providerModelId).toBe('claude-fallback');
    expect(fallback.includedSourceIds).toContain('agent-instructions');
    expect(fallback.tokenEstimate).toBe(40);

    expect(projection.latestManifest?.packetId).toBe('pkt-fallback');
    expect(
      projection.trace.some((t) => t.id === 'event-manifest-1' && /Manifest/.test(t.summary)),
    ).toBe(true);
    expect(projection.manifests.every((m) => projection.trace.some((t) => t.id === m.id))).toBe(
      true,
    );
  });

  it('cold-start snapshot restores multi-turn conversation + manifests for exit criterion 6', () => {
    const threadId = 'thread-cold-restore';
    // Durable events as Runtime would replay after process restart (no live stream).
    const snapshot = [
      eventAt(1, {
        category: 'message',
        type: 'message.appended',
        payload: { threadId, role: 'user', text: 'first durable question', taskVersion: 1 },
      }),
      eventAt(2, {
        category: 'run',
        type: 'run.started',
        runId: 'run-1' as Event['runId'],
        payload: {
          threadId,
          modelId: 'fake-mini',
          providerModelId: 'fake-mini',
          resolutionSource: 'agentDefault',
        },
      }),
      eventAt(3, {
        id: 'manifest-1' as Event['id'],
        category: 'context',
        type: 'context.packet.built',
        runId: 'run-1' as Event['runId'],
        payload: {
          threadId,
          packetId: 'pkt-1',
          proofHash: '11111111111111111111111111111111',
          modelId: 'fake-mini',
          providerModelId: 'fake-mini',
          resolutionSource: 'agentDefault',
          credentialResolutionSource: 'providerPrimary',
          credentialRefId: 'cred-ref-aaaa',
          includedSourceIds: ['msg-run-1', 'agent-instructions'],
          tokenEstimate: 20,
        },
      }),
      eventAt(4, {
        category: 'message',
        type: 'message.delta',
        runId: 'run-1' as Event['runId'],
        payload: { threadId, textDelta: 'answer-one' },
      }),
      eventAt(5, {
        category: 'run',
        type: 'run.completed',
        runId: 'run-1' as Event['runId'],
        payload: { threadId, assistantText: 'answer-one' },
      }),
      eventAt(6, {
        category: 'message',
        type: 'message.appended',
        payload: { threadId, role: 'user', text: 'second durable question', taskVersion: 2 },
      }),
      eventAt(7, {
        category: 'run',
        type: 'run.started',
        runId: 'run-2' as Event['runId'],
        payload: {
          threadId,
          modelId: 'fake-mini',
          providerModelId: 'fake-mini',
          resolutionSource: 'runOverride',
        },
      }),
      eventAt(8, {
        id: 'manifest-2' as Event['id'],
        category: 'context',
        type: 'context.packet.built',
        runId: 'run-2' as Event['runId'],
        payload: {
          threadId,
          packetId: 'pkt-2',
          proofHash: '22222222222222222222222222222222',
          modelId: 'fake-mini',
          providerModelId: 'fake-mini',
          resolutionSource: 'runOverride',
          credentialResolutionSource: 'agentPin',
          credentialRefId: 'cred-ref-bbbb',
          includedSourceIds: ['msg-run-2', 'agent-instructions'],
          tokenEstimate: 28,
        },
      }),
      eventAt(9, {
        category: 'message',
        type: 'message.delta',
        runId: 'run-2' as Event['runId'],
        payload: { threadId, textDelta: 'answer-two' },
      }),
      eventAt(10, {
        category: 'run',
        type: 'run.completed',
        runId: 'run-2' as Event['runId'],
        payload: { threadId, assistantText: 'answer-two' },
      }),
    ];

    // Fresh renderer process: empty state + connect-succeeded snapshot (cold start).
    let state = createInitialRuntimeViewState(true);
    expect(state.connectionState).toBe('connecting');
    expect(canSendRuntimeMessage(state.connectionState)).toBe(false);

    state = runtimeViewReducer(state, {
      type: 'connect-succeeded',
      result: {
        health: {
          ok: true,
          runtimePid: 42,
          uptimeMs: 10,
          protocolVersion: 2,
          features: [],
          inFlightRuns: 0,
        },
        snapshot,
      },
      threadId,
    });

    expect(state.connectionState).toBe('online');
    expect(canSendRuntimeMessage(state.connectionState)).toBe(true);
    expect(state.taskVersion).toBe(2);
    expect(state.eventHistory.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const projection = projectConversation(state.eventHistory, threadId);
    expect(projection.messages.map((m) => ({ role: m.role, text: m.text }))).toEqual([
      { role: 'user', text: 'first durable question' },
      { role: 'assistant', text: 'answer-one' },
      { role: 'user', text: 'second durable question' },
      { role: 'assistant', text: 'answer-two' },
    ]);
    expect(projection.stream.state).toBe('completed');
    expect(projection.manifests).toHaveLength(2);
    expect(projection.latestManifest?.packetId).toBe('pkt-2');
    expect(projection.latestManifest?.credentialResolutionSource).toBe('agentPin');
    expect(projection.latestManifest?.credentialRefId).toBe('cred-ref-bbbb');
    // No secrets in projected payloads.
    expect(JSON.stringify(projection)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);
  });
});
