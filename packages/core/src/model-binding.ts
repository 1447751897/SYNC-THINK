import type {
  AgentVersionId,
  CredentialGroupId,
  CredentialRefId,
  FailureClass,
  ModelId,
  ModelResolutionSource,
} from '@sync-think/shared';
import { isRetryable } from '@sync-think/shared';

/**
 * Model binding resolution ? product design ?5.3.
 *
 * Precedence:
 * 1. Run explicit model
 * 2. Workflow-node override
 * 3. Agent persistent default
 * 4. Agent user-configured fallback chain
 *
 * Never silent substitution. Without fallback, failure ? pause (when pauseOnFailure).
 */

export interface AgentModelBinding {
  agentVersionId: AgentVersionId;
  defaultModelId: ModelId;
  fallbackModelIds: readonly ModelId[];
  /** When true and no next fallback exists, pause instead of failing hard. */
  pauseOnFailure: boolean;
  defaultCredentialGroupId?: CredentialGroupId;
  pinnedCredentialRefId?: CredentialRefId;
}

export interface ResolveModelBindingInput {
  agent: AgentModelBinding;
  /** Run-level explicit model (highest priority). */
  runModelId?: ModelId;
  /** Workflow-node override. */
  workflowNodeModelId?: ModelId;
  /**
   * When recovering from a failed model call, pass the model that just failed
   * so resolution walks the fallback chain after the agent default.
   */
  failedModelId?: ModelId;
  failureClass?: FailureClass;
  /** Durable per-Run fence: models already attempted by any fallback layer. */
  attemptedModelIds?: readonly ModelId[];
}

export type ModelBindingResolution =
  | {
      status: 'resolved';
      modelId: ModelId;
      source: ModelResolutionSource;
      /** Index into fallbackModelIds when source is agentFallback. */
      fallbackIndex?: number;
      agentVersionId: AgentVersionId;
      credentialGroupId?: CredentialGroupId;
      pinnedCredentialRefId?: CredentialRefId;
    }
  | {
      status: 'paused';
      reason: 'no_fallback_configured' | 'fallback_exhausted';
      failedModelId: ModelId;
      failureClass?: FailureClass;
      agentVersionId: AgentVersionId;
    }
  | {
      status: 'unresolved';
      reason: 'missing_default';
      agentVersionId: AgentVersionId;
    };

function hasModelId(value: ModelId | undefined): value is ModelId {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Resolve which model should serve the next call.
 * Pure function ? no I/O, no silent swaps.
 */
export function resolveModelBinding(input: ResolveModelBindingInput): ModelBindingResolution {
  const {
    agent,
    runModelId,
    workflowNodeModelId,
    failedModelId,
    failureClass,
    attemptedModelIds = [],
  } = input;

  // Fresh resolution (no prior failure): strict precedence.
  if (!hasModelId(failedModelId)) {
    if (hasModelId(runModelId)) {
      return {
        status: 'resolved',
        modelId: runModelId,
        source: 'runOverride',
        agentVersionId: agent.agentVersionId,
        credentialGroupId: agent.defaultCredentialGroupId,
        pinnedCredentialRefId: agent.pinnedCredentialRefId,
      };
    }
    if (hasModelId(workflowNodeModelId)) {
      return {
        status: 'resolved',
        modelId: workflowNodeModelId,
        source: 'workflowNode',
        agentVersionId: agent.agentVersionId,
        credentialGroupId: agent.defaultCredentialGroupId,
        pinnedCredentialRefId: agent.pinnedCredentialRefId,
      };
    }
    if (hasModelId(agent.defaultModelId)) {
      return {
        status: 'resolved',
        modelId: agent.defaultModelId,
        source: 'agentDefault',
        agentVersionId: agent.agentVersionId,
        credentialGroupId: agent.defaultCredentialGroupId,
        pinnedCredentialRefId: agent.pinnedCredentialRefId,
      };
    }
    return {
      status: 'unresolved',
      reason: 'missing_default',
      agentVersionId: agent.agentVersionId,
    };
  }

  // After a failure: only walk fallback when the failed model was the default
  // or an earlier fallback entry. Run/workflow overrides never auto-fallback
  // unless the user also listed them in the fallback chain (explicit).
  const chain = agent.fallbackModelIds.filter(hasModelId);
  if (chain.length === 0) {
    if (agent.pauseOnFailure) {
      return {
        status: 'paused',
        reason: 'no_fallback_configured',
        failedModelId,
        failureClass,
        agentVersionId: agent.agentVersionId,
      };
    }
    // No pause policy and no fallback: still surface as paused so runtime
    // never silently picks another model (?5.3).
    return {
      status: 'paused',
      reason: 'no_fallback_configured',
      failedModelId,
      failureClass,
      agentVersionId: agent.agentVersionId,
    };
  }

  const attempted = new Set(attemptedModelIds.filter(hasModelId));
  attempted.add(failedModelId);
  const failedAtDefault = failedModelId === agent.defaultModelId;
  const failedIndex = chain.indexOf(failedModelId);
  const startIndex = failedAtDefault ? -1 : failedIndex;
  const nextIndex =
    failedAtDefault || failedIndex >= 0
      ? chain.findIndex((modelId, index) => index > startIndex && !attempted.has(modelId))
      : -1;
  if (nextIndex >= 0) {
    return {
      status: 'resolved',
      modelId: chain[nextIndex]!,
      source: 'agentFallback',
      fallbackIndex: nextIndex,
      agentVersionId: agent.agentVersionId,
      credentialGroupId: agent.defaultCredentialGroupId,
      pinnedCredentialRefId: agent.pinnedCredentialRefId,
    };
  }

  return {
    status: 'paused',
    reason: 'fallback_exhausted',
    failedModelId,
    failureClass,
    agentVersionId: agent.agentVersionId,
  };
}

/**
 * Whether a failure class may attempt fallback (auth/rate-limit/timeout/availability).
 * Non-retryable protocol errors still may try next model only if user configured fallback;
 * the resolver itself does not filter ? callers decide whether to invoke fallback walk.
 */
export function shouldAttemptFallback(failureClass: FailureClass | undefined): boolean {
  if (!failureClass) return true;
  // Acceptance / permission are not model-availability issues.
  if (failureClass === 'acceptance' || failureClass === 'permission') return false;
  return isRetryable(failureClass) || failureClass === 'auth' || failureClass === 'unknown';
}

/** Failures that normally affect a Provider endpoint or credential, not one model. */
export function shouldSkipSameProviderFallback(
  failureClass: FailureClass,
  consecutiveProviderFailures = 1,
): boolean {
  if (consecutiveProviderFailures < 2) return false;
  return (
    failureClass === 'timeout' ||
    failureClass === 'transient' ||
    failureClass === 'rate-limit' ||
    failureClass === 'auth'
  );
}

/**
 * Same-provider priority chain walk.
 *
 * Given an ordered priority list (index 0 = primary / 主模型) and the model
 * that just failed, return the next model *after* the failed one.
 *
 * Examples (chain = [5.6, 5.5, 5.4]):
 * - failed 5.6 → 5.5
 * - failed 5.5 → 5.4   (does NOT go back to 5.6)
 * - failed 5.4 → null  (exhausted)
 * - failed unknown → null
 */
export function resolveProviderPriorityFallback(input: {
  /** Ordered model ids for one provider; index 0 is primary. */
  orderedModelIds: readonly ModelId[];
  failedModelId: ModelId;
  /** Durable per-Run fence shared with Agent fallback selection. */
  attemptedModelIds?: readonly ModelId[];
}): { modelId: ModelId; fallbackIndex: number } | null {
  const chain = input.orderedModelIds.filter(
    (id): id is ModelId => typeof id === 'string' && id.trim().length > 0,
  );
  if (chain.length === 0) return null;
  const failedIndex = chain.indexOf(input.failedModelId);
  if (failedIndex < 0) return null;
  const attempted = new Set((input.attemptedModelIds ?? []).filter(hasModelId));
  attempted.add(input.failedModelId);
  const nextIndex = chain.findIndex(
    (modelId, index) => index > failedIndex && !attempted.has(modelId),
  );
  if (nextIndex < 0) return null;
  return { modelId: chain[nextIndex]!, fallbackIndex: nextIndex };
}
