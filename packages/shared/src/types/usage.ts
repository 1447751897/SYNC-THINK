import type { AgentContextThreadId, ContextEpochId, RunId, StepId, TaskId } from './ids.js';

export type ProviderUsagePurpose =
  'normal' | 'compaction' | 'delegation' | 'review' | 'revision' | 'summary';

/** Canonical accounting record for one provider HTTP request. */
export interface ProviderRequestUsage {
  requestId: string;
  taskId: TaskId;
  runId?: RunId;
  stepId?: StepId;
  agentContextThreadId?: AgentContextThreadId;
  contextEpochId?: ContextEpochId;
  providerId: string;
  modelId: string;
  providerModelId?: string;
  reasoningEffort?: string;
  purpose: ProviderUsagePurpose;
  tokensIn: number;
  tokensOut: number;
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
  reasoningTokens?: number;
  totalTokens: number;
}

export interface ProviderUsageTokenBreakdown {
  /** Ordinary input tokens billed at the normal input rate. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** Provider input total, including cache reads and cache writes. */
  totalInputTokens: number;
  totalTokens: number;
}

/** Split canonical provider input into mutually exclusive billing buckets. */
export function splitProviderUsageTokens(usage: {
  tokensIn: number;
  tokensOut: number;
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
}): ProviderUsageTokenBreakdown {
  const normalize = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  const totalInputTokens = normalize(usage.tokensIn);
  const outputTokens = normalize(usage.tokensOut);
  const cacheReadTokens = Math.min(totalInputTokens, normalize(usage.cachedTokensHit));
  const cacheWriteTokens = Math.min(
    totalInputTokens - cacheReadTokens,
    normalize(usage.cachedTokensCreated),
  );
  const inputTokens = totalInputTokens - cacheReadTokens - cacheWriteTokens;

  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalInputTokens,
    totalTokens: totalInputTokens + outputTokens,
  };
}
