import { decodeFrames, type Frame } from '@sync-think/protocol';
import { describe, expect, it } from 'vitest';
import { Runtime } from './runtime.js';
import type { UsageSummaryRawResult } from './usage-summary-cache.js';

function emptySummary(): UsageSummaryRawResult {
  return { rows: [], requests: [], tools: [], toolModels: [], toolFailures: [] };
}

function dispatch(
  runtime: Runtime,
  frame: Frame,
): Promise<ReturnType<typeof decodeFrames>['frames'][number]> {
  const writes: Buffer[] = [];
  const internal = runtime as unknown as {
    handlers: {
      onFrame(socket: { write(data: Buffer): boolean }, request: Frame): void;
    };
  };
  internal.handlers.onFrame(
    {
      write(data) {
        writes.push(Buffer.from(data));
        return true;
      },
    },
    frame,
  );
  return new Promise((resolve) => {
    const read = () => {
      if (writes.length > 0) {
        resolve(decodeFrames(Buffer.concat(writes)).frames[0]!);
        return;
      }
      setImmediate(read);
    };
    read();
  });
}

describe('Runtime usage summary dispatch', () => {
  it('keeps healthcheck responsive while the usage cache refresh is pending', async () => {
    let resolveUsage!: (summary: UsageSummaryRawResult) => void;
    const usagePending = new Promise<UsageSummaryRawResult>((resolve) => {
      resolveUsage = resolve;
    });
    const runtime = new Runtime({
      installId: 'usage-summary-healthcheck',
      allowNoToken: true,
      queryUsageSummary: () => usagePending,
    });
    const usageWrites: Buffer[] = [];
    const healthWrites: Buffer[] = [];
    const internal = runtime as unknown as {
      handlers: {
        onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void;
      };
    };

    internal.handlers.onFrame(
      {
        write(data) {
          usageWrites.push(Buffer.from(data));
          return true;
        },
      },
      {
        id: 'usage-1',
        kind: 'request',
        type: 'usage.summary',
        payload: {},
      },
    );
    internal.handlers.onFrame(
      {
        write(data) {
          healthWrites.push(Buffer.from(data));
          return true;
        },
      },
      {
        id: 'health-1',
        kind: 'request',
        type: 'runtime.healthcheck',
        payload: {},
      },
    );

    expect(usageWrites).toHaveLength(0);
    expect(decodeFrames(Buffer.concat(healthWrites)).frames[0]).toMatchObject({
      id: 'health-1',
      kind: 'response',
      type: 'runtime.healthcheck',
    });

    resolveUsage(emptySummary());
    await new Promise((resolve) => setImmediate(resolve));
    expect(decodeFrames(Buffer.concat(usageWrites)).frames[0]).toMatchObject({
      id: 'usage-1',
      kind: 'response',
      type: 'usage.summary',
    });
  });

  it('returns a task-scoped durable provider usage aggregate without leaking other tasks', async () => {
    const raw: UsageSummaryRawResult = {
      rows: [
        {
          modelId: 'model-a',
          providerId: 'provider-a',
          requests: 3,
          succeededRequests: 1,
          failedRequests: 1,
          tokensIn: 1_200,
          tokensOut: 120,
          cachedTokensHit: 300,
          cachedTokensCreated: 40,
          reasoningTokens: 12,
          totalTokens: 1_320,
          averageLatencyMs: 750,
          lastUsedAt: '2026-08-08T10:00:04.000Z',
        },
        {
          modelId: 'model-b',
          providerId: 'provider-b',
          requests: 1,
          succeededRequests: 1,
          failedRequests: 0,
          tokensIn: 9_000,
          tokensOut: 900,
          reasoningTokens: 0,
          totalTokens: 9_900,
          averageLatencyMs: 900,
          lastUsedAt: '2026-08-08T10:00:05.000Z',
        },
      ],
      requests: [
        {
          requestId: 'request-a-1',
          taskId: 'task-a',
          runId: 'run-a-1',
          occurredAt: '2026-08-08T10:00:01.000Z',
          modelId: 'model-a',
          providerId: 'provider-a',
          tokensIn: 100,
          tokensOut: 10,
          cachedTokensHit: 30,
          cachedTokensCreated: 4,
          reasoningTokens: 2,
          totalTokens: 110,
          status: 'success',
          latencyMs: 500,
        },
        {
          requestId: 'request-a-2',
          taskId: 'task-a',
          runId: 'run-a-2',
          occurredAt: '2026-08-08T10:00:02.000Z',
          modelId: 'model-a',
          providerId: 'provider-a',
          tokensIn: 200,
          tokensOut: 20,
          cachedTokensHit: 40,
          cachedTokensCreated: 6,
          reasoningTokens: 4,
          totalTokens: 220,
          status: 'failed',
          latencyMs: 1_000,
          errorMessage: 'provider failed',
        },
        {
          requestId: 'request-a-3',
          taskId: 'task-a',
          runId: 'run-a-3',
          occurredAt: '2026-08-08T10:00:03.000Z',
          modelId: 'model-c',
          providerId: 'provider-a',
          tokensIn: 50,
          tokensOut: 5,
          totalTokens: 55,
          status: 'unknown',
        },
        {
          requestId: 'request-b-1',
          taskId: 'task-b',
          runId: 'run-b-1',
          occurredAt: '2026-08-08T10:00:04.000Z',
          modelId: 'model-b',
          providerId: 'provider-b',
          tokensIn: 9_000,
          tokensOut: 900,
          totalTokens: 9_900,
          status: 'success',
          latencyMs: 900,
        },
      ],
      tools: [
        {
          toolName: 'shell',
          calls: 2,
          successes: 2,
          failures: 0,
          successRate: 100,
        },
      ],
      toolModels: [
        {
          modelId: 'model-b',
          calls: 1,
          successes: 1,
          failures: 0,
          successRate: 100,
        },
      ],
      toolFailures: [
        {
          occurredAt: '2026-08-08T10:00:04.000Z',
          toolName: 'browser',
          modelId: 'model-b',
          errorSummary: 'other task',
        },
      ],
    };
    const runtime = new Runtime({
      installId: 'usage-summary-task-scope',
      allowNoToken: true,
      queryUsageSummary: async () => raw,
    });

    const response = await dispatch(runtime, {
      id: 'usage-task-a',
      kind: 'request',
      type: 'usage.summary',
      payload: { taskId: 'task-a' },
    });

    expect(response).toMatchObject({
      id: 'usage-task-a',
      kind: 'response',
      type: 'usage.summary',
      payload: {
        totalRequests: 3,
        totalTokensIn: 350,
        totalTokensOut: 35,
        totalCachedTokensHit: 70,
        totalCachedTokensCreated: 10,
        totalReasoningTokens: 6,
        totalTokens: 385,
        tools: [],
        toolModels: [],
        toolFailures: [],
      },
    });
    expect((response.payload as { requests: Array<{ taskId?: string }> }).requests).toHaveLength(3);
    expect(
      (response.payload as { requests: Array<{ taskId?: string }> }).requests.every(
        (request) => request.taskId === 'task-a',
      ),
    ).toBe(true);
    expect(response.payload).toMatchObject({
      rows: [
        {
          modelId: 'model-a',
          providerId: 'provider-a',
          requests: 2,
          succeededRequests: 1,
          failedRequests: 1,
          tokensIn: 300,
          tokensOut: 30,
          cachedTokensHit: 70,
          cachedTokensCreated: 10,
          reasoningTokens: 6,
          totalTokens: 330,
          averageLatencyMs: 750,
          lastUsedAt: '2026-08-08T10:00:02.000Z',
        },
        {
          modelId: 'model-c',
          providerId: 'provider-a',
          requests: 1,
          succeededRequests: 0,
          failedRequests: 0,
          tokensIn: 50,
          tokensOut: 5,
          reasoningTokens: 0,
          totalTokens: 55,
          lastUsedAt: '2026-08-08T10:00:03.000Z',
        },
      ],
    });
  });

  it('keeps the existing global usage summary behavior when taskId is omitted', async () => {
    const raw = emptySummary();
    raw.requests.push({
      requestId: 'request-a',
      taskId: 'task-a',
      occurredAt: '2026-08-08T10:00:01.000Z',
      modelId: 'model-a',
      tokensIn: 100,
      tokensOut: 10,
      totalTokens: 110,
      status: 'success',
    });
    raw.requests.push({
      requestId: 'request-b',
      taskId: 'task-b',
      occurredAt: '2026-08-08T10:00:02.000Z',
      modelId: 'model-b',
      tokensIn: 200,
      tokensOut: 20,
      totalTokens: 220,
      status: 'success',
    });
    const runtime = new Runtime({
      installId: 'usage-summary-global',
      allowNoToken: true,
      queryUsageSummary: async () => raw,
    });

    const response = await dispatch(runtime, {
      id: 'usage-global',
      kind: 'request',
      type: 'usage.summary',
      payload: {},
    });

    expect(response.payload).toMatchObject({
      totalRequests: 2,
      totalTokensIn: 300,
      totalTokensOut: 30,
      totalTokens: 330,
    });
  });
});
