import {
  resolveModelBinding,
  resolveProviderPriorityFallback,
  shouldAttemptFallback,
  shouldSkipSameProviderFallback,
  type AgentModelBinding,
} from '@sync-think/core';
import type { FailureClass, ModelId } from '@sync-think/shared';

export interface FallbackCatalogModel {
  id: ModelId;
  providerId: string;
  priority: number;
  compatible: boolean;
}
export interface FallbackSelectionPorts {
  catalog?: {
    getModel(id: ModelId): FallbackCatalogModel | undefined;
    listModels(providerId: string): readonly FallbackCatalogModel[];
  };
  getAgentBinding(): AgentModelBinding;
  allowsUncataloguedModel(id: ModelId): boolean;
}
export type FallbackSelection =
  | { status: 'failed' }
  | {
      status: 'paused';
      reason: 'no_fallback_configured' | 'fallback_exhausted';
      failedModelId: ModelId;
    }
  | {
      status: 'selected';
      modelId: ModelId;
      source: 'providerFallback' | 'agentFallback';
      fallbackIndex?: number;
      providerFailureCounts: Record<string, number>;
    };

/** Choose a candidate only. Runtime retains rebinding, events and atomic persistence. */
export function selectModelFallback(
  input: {
    modelId: ModelId;
    failureClass: FailureClass;
    errorMessage?: string;
    providerFailureCounts?: Readonly<Record<string, number>>;
    attemptedModelIds?: readonly string[];
    fallbackModelIds?: readonly string[];
  },
  ports: FallbackSelectionPorts,
): FallbackSelection {
  if (!shouldAttemptFallback(input.failureClass)) return { status: 'failed' };
  const failed = ports.catalog?.getModel(input.modelId);
  const providerFailureCounts = { ...input.providerFailureCounts };
  const failures = failed ? (providerFailureCounts[failed.providerId] ?? 0) + 1 : 1;
  if (failed) providerFailureCounts[failed.providerId] = failures;
  const attemptedModelIds = [
    ...new Set([...(input.attemptedModelIds ?? []), input.modelId]),
  ] as ModelId[];
  const skipSameProvider = shouldSkipSameProviderFallback(
    input.failureClass,
    failures,
    input.errorMessage,
  );
  if (ports.catalog && failed && !skipSameProvider) {
    const ordered = ports.catalog
      .listModels(failed.providerId)
      .filter((model) => model.compatible)
      .slice()
      .sort((a, b) => a.priority - b.priority);
    const next = resolveProviderPriorityFallback({
      orderedModelIds: ordered.map((model) => model.id),
      failedModelId: input.modelId,
      attemptedModelIds,
    });
    if (next)
      return { status: 'selected', ...next, source: 'providerFallback', providerFailureCounts };
  }
  const legacyAgent = ports.getAgentBinding();
  const agent = input.fallbackModelIds?.length
    ? {
        ...legacyAgent,
        defaultModelId: input.modelId,
        fallbackModelIds: input.fallbackModelIds as readonly ModelId[],
      }
    : legacyAgent;
  const resolution = resolveModelBinding({
    agent: {
      ...agent,
      fallbackModelIds: agent.fallbackModelIds.filter((id) => {
        if (!ports.catalog) return ports.allowsUncataloguedModel(id);
        const model = ports.catalog.getModel(id);
        return Boolean(
          model &&
          model.compatible &&
          (!skipSameProvider || model.providerId !== failed?.providerId),
        );
      }),
    },
    failedModelId: input.modelId,
    failureClass: input.failureClass,
    attemptedModelIds,
  });
  if (resolution.status === 'paused') return resolution;
  if (resolution.status !== 'resolved' || resolution.source !== 'agentFallback')
    return { status: 'failed' };
  return {
    status: 'selected',
    modelId: resolution.modelId,
    source: resolution.source,
    fallbackIndex: resolution.fallbackIndex,
    providerFailureCounts,
  };
}
