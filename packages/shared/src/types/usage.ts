import type {
  AgentContextThreadId,
  ContextEpochId,
  RunId,
  StepId,
  TaskId,
} from './ids.js';

export type ProviderUsagePurpose =
  | 'normal'
  | 'compaction'
  | 'delegation'
  | 'review'
  | 'revision'
  | 'summary';

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
