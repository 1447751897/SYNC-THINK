import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import { projectConversationUsageMetrics } from './chat-usage.js';

function event(input: {
  id: string;
  sequence: number;
  type: string;
  occurredAt?: string;
  taskId?: string;
  runId?: string;
  payload?: Record<string, unknown>;
}): Event {
  return {
    id: input.id as Event['id'],
    workspaceId: 'workspace-usage' as Event['workspaceId'],
    ...(input.taskId ? { taskId: input.taskId as Event['taskId'] } : {}),
    ...(input.runId ? { runId: input.runId as Event['runId'] } : {}),
    category: input.type.startsWith('provider.') ? 'provider' : 'run',
    type: input.type,
    sequence: input.sequence,
    occurredAt: input.occurredAt ?? `2026-08-08T00:00:0${input.sequence}.000Z`,
    payload: input.payload ?? {},
  };
}

describe('conversation usage projection', () => {
  it('takes progressive maxima for one request and sums distinct requests', () => {
    const metrics = projectConversationUsageMetrics({
      events: [
        event({
          id: 'start',
          sequence: 1,
          type: 'run.started',
          taskId: 'task-a',
          runId: 'run-a',
          payload: { threadId: 'thread-a' },
        }),
        event({
          id: 'usage-1',
          sequence: 2,
          type: 'provider.usage',
          taskId: 'task-a',
          runId: 'run-a',
          payload: {
            requestId: 'request-a',
            tokensIn: 100,
            tokensOut: 10,
            totalTokens: 110,
          },
        }),
        event({
          id: 'usage-2',
          sequence: 3,
          type: 'provider.usage',
          taskId: 'task-a',
          runId: 'run-a',
          payload: {
            requestId: 'request-a',
            tokensIn: 140,
            tokensOut: 20,
            totalTokens: 160,
          },
        }),
        event({
          id: 'usage-3',
          sequence: 4,
          type: 'provider.usage',
          taskId: 'task-a',
          runId: 'run-a',
          payload: {
            requestId: 'request-b',
            tokensIn: 80,
            tokensOut: 12,
          },
        }),
        event({
          id: 'done',
          sequence: 5,
          type: 'run.completed',
          taskId: 'task-a',
          runId: 'run-a',
          payload: { threadId: 'thread-a' },
        }),
      ],
      threadId: 'thread-a',
      taskId: 'task-a',
    });

    expect(metrics).toEqual({
      durationMs: 4_000,
      totalTokens: 252,
      tokensIn: 220,
      tokensOut: 32,
      requestCount: 2,
      // watermark = last request (request-b at seq 4) occupancy: 80 + 12.
      contextWatermarkTokens: 92,
    });
  });

  it('uses reported totals, treats legacy rows as independent, and never dedupes by packetId', () => {
    const metrics = projectConversationUsageMetrics({
      events: [
        event({
          id: 'usage-request',
          sequence: 1,
          type: 'provider.usage',
          taskId: 'task-a',
          payload: {
            requestId: 'request-a',
            packetId: 'packet-shared',
            tokensIn: 90,
            tokensOut: 10,
            totalTokens: 150,
          },
        }),
        event({
          id: 'usage-legacy-1',
          sequence: 2,
          type: 'provider.usage',
          taskId: 'task-a',
          payload: { packetId: 'packet-shared', tokensIn: 20, tokensOut: 3 },
        }),
        event({
          id: 'usage-legacy-2',
          sequence: 3,
          type: 'provider.usage',
          taskId: 'task-a',
          payload: { packetId: 'packet-shared', tokensIn: 30, tokensOut: 4 },
        }),
      ],
      taskId: 'task-a',
    });

    expect(metrics.totalTokens).toBe(207);
    expect(metrics.requestCount).toBe(3);
  });

  it('filters usage and duration from other threads and tasks', () => {
    const metrics = projectConversationUsageMetrics({
      events: [
        event({
          id: 'start-a',
          sequence: 1,
          type: 'run.started',
          taskId: 'task-a',
          payload: { threadId: 'thread-a' },
        }),
        event({
          id: 'usage-a',
          sequence: 2,
          type: 'provider.usage',
          taskId: 'task-a',
          payload: { requestId: 'request-a', tokensIn: 40, tokensOut: 2 },
        }),
        event({
          id: 'usage-b',
          sequence: 3,
          type: 'provider.usage',
          taskId: 'task-b',
          payload: { requestId: 'request-b', tokensIn: 9_000, tokensOut: 900 },
        }),
        event({
          id: 'done-b',
          sequence: 4,
          type: 'run.completed',
          taskId: 'task-b',
          payload: { threadId: 'thread-b' },
        }),
        event({
          id: 'done-a',
          sequence: 5,
          type: 'run.completed',
          taskId: 'task-a',
          payload: { threadId: 'thread-a' },
        }),
      ],
      threadId: 'thread-a',
      taskId: 'task-a',
    });

    expect(metrics.totalTokens).toBe(42);
    expect(metrics.requestCount).toBe(1);
    expect(metrics.durationMs).toBe(4_000);
  });

  it('uses run-to-thread scope for legacy usage rows without taskId or threadId', () => {
    const metrics = projectConversationUsageMetrics({
      events: [
        event({
          id: 'start-a',
          sequence: 1,
          type: 'run.started',
          taskId: 'task-a',
          runId: 'run-a',
          payload: { threadId: 'thread-a' },
        }),
        event({
          id: 'start-b',
          sequence: 2,
          type: 'run.started',
          taskId: 'task-b',
          runId: 'run-b',
          payload: { threadId: 'thread-b' },
        }),
        event({
          id: 'usage-a',
          sequence: 3,
          type: 'provider.usage',
          runId: 'run-a',
          payload: { tokensIn: 120, tokensOut: 12 },
        }),
        event({
          id: 'usage-b',
          sequence: 4,
          type: 'provider.usage',
          runId: 'run-b',
          payload: { tokensIn: 9_000, tokensOut: 900 },
        }),
        event({
          id: 'usage-ambiguous',
          sequence: 5,
          type: 'provider.usage',
          payload: { tokensIn: 50_000, tokensOut: 5_000 },
        }),
      ],
      threadId: 'thread-a',
      taskId: 'task-a',
    });

    expect(metrics.totalTokens).toBe(132);
    expect(metrics.tokensIn).toBe(120);
    expect(metrics.tokensOut).toBe(12);
    expect(metrics.requestCount).toBe(1);
  });
});
