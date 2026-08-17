// Enums and string unions live here so both Runtime and UI import the single
// definition. Stable values are part of the persisted event log, so never
// rename an enum member once Released 鈥?add new ones instead.

export type ParticipationMode = 'conversation' | 'collaboration' | 'automatic';

export type RunState =
  | 'conversation'
  | 'planDraft'
  | 'awaitingPlanApproval'
  | 'queued'
  | 'running'
  | 'awaitingToolApproval'
  | 'reviewing'
  | 'revising'
  | 'completed'
  | 'paused'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export type StepState =
  | 'pending'
  | 'ready'
  | 'running'
  | 'awaitingApproval'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type ApprovalMode = 'request' | 'delegate' | 'full' | 'custom';

// Model resolution precedence 鈥?Locked in product design 搂5.3
export type ModelResolutionSource =
  | 'runOverride'
  | 'workflowNode'
  | 'agentDefault'
  | 'agentFallback'
  /** Same-provider priority chain: walk forward only from the failed model. */
  | 'providerFallback'
  /** plan/exec 双模型路由（plan-act 设置）按对话模式强制指定。 */
  | 'planAct';

export type ProtocolFamily =
  | 'openai-responses'
  | 'openai-chat'
  | 'openai-images'
  | 'anthropic-messages';

/** CC Switch–style app surface for hierarchical model picking. */
export type ProviderSurface = 'claude' | 'codex' | 'gemini' | 'kiro' | 'generic';

export type CapabilityTag =
  | 'text'
  | 'vision'
  | 'tool-calling'
  | 'image-generation'
  | 'embeddings';

// Per design 搂20: only classified transient failures retry.
export type FailureClass =
  | 'transient' // retry within limits
  | 'auth' // do not retry as network
  | 'protocol' // do not retry
  | 'permission' // do not retry
  | 'acceptance' // do not retry
  | 'rate-limit' // retry with backoff only
  | 'timeout' // retry within limits
  | 'unknown';

export function isRetryable(failure: FailureClass): boolean {
  return failure === 'transient' || failure === 'timeout' || failure === 'rate-limit';
}

// Audit/Event categories
export type EventCategory =
  | 'message'
  | 'run'
  | 'step'
  | 'tool'
  | 'approval'
  | 'context'
  | 'memory'
  | 'artifact'
  | 'review'
  | 'credential'
  | 'provider'
  | 'system';

// Human-only actions 鈥?搂13.2; cannot be bypassed by delegated approval.
export const HUMAN_ONLY_ACTIONS = [
  'access-or-create-secret',
  'payment-or-purchase',
  'public-publishing',
  'send-external-message-as-user',
  'change-identity-or-permission-policy',
  'irreversible-deletion',
  'export-sensitive-data-outside-boundary',
] as const;
export type HumanOnlyAction = (typeof HUMAN_ONLY_ACTIONS)[number];

// Trace event channel 鈥?corresponds to the right rail in the main workspace.
export type TraceCategory =
  | 'model-call'
  | 'credential-choice'
  | 'tool-action'
  | 'approval'
  | 'artifact'
  | 'review'
  | 'context-transfer'
  | 'recovery';

