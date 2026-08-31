import { describe, expect, it } from 'vitest';
import type { KernelUsage, RunId } from '@sync-think/shared';
import { buildKernelUsagePayload } from './runtime.js';
import type { DemoRunState } from './demo-run.js';

function runFixture(): DemoRunState {
  return {
    runId: 'run-kernel-usage' as RunId,
    threadId: 'thread-kernel-usage',
    userText: 'hello',
    kernelId: 'codex',
    modelId: 'model-internal-luna',
    providerModelId: 'gpt-5.6-luna',
    protocol: 'openai-responses',
    baseUrl: 'https://provider.example/v1',
    providerId: 'provider-kimi',
    agentVersionId: 'agent-version-1',
    resolutionSource: 'agentDefault',
    attemptedModelIds: ['model-internal-luna'],
    nextAdapterEventIndex: 0,
    assistantText: '',
    commentaryText: '',
    commentarySegments: [],
    legacyPendingText: '',
    reasoningText: '',
    reasoningSegments: [],
    assistantTimeline: [],
    toolCalls: [],
    toolResults: [],
    kernelToolEvents: [],
    useFakeProvider: false,
    status: 'running',
    startedAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  } as DemoRunState;
}

describe('external kernel usage persistence', () => {
  it('keeps the internal model id used by usage summaries beside the provider model id', () => {
    const usage: KernelUsage = {
      real: 1_200,
      window: 32_000,
      input: 1_000,
      output: 200,
      modelId: 'gpt-5.6-luna',
      requestId: 'request-kernel-1',
    };

    expect(buildKernelUsagePayload(runFixture(), usage, 1)).toMatchObject({
      requestId: 'request-kernel-1',
      modelId: 'model-internal-luna',
      providerModelId: 'gpt-5.6-luna',
      providerId: 'provider-kimi',
      tokensIn: 1_000,
      tokensOut: 200,
      totalTokens: 1_200,
    });
  });
});
