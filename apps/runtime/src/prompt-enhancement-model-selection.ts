import type { ModelId } from '@sync-think/shared';

export interface PromptEnhancementProviderCandidate {
  provider: { enabled: boolean };
  models: readonly { id: ModelId; providerModelId: string }[];
}

export function resolvePromptEnhancementModelId(input: {
  requested?: ModelId;
  providers: readonly PromptEnhancementProviderCandidate[];
  catalogConfigured: boolean;
  fallbackAvailable: boolean;
}): ModelId | undefined {
  const requested = String(input.requested ?? '').trim();
  const enabled = input.providers
    .filter((entry) => entry.provider.enabled !== false)
    .flatMap((entry) => entry.models);
  if (requested) {
    const configured = enabled.find(
      (candidate) => candidate.id === requested || candidate.providerModelId === requested,
    );
    if (configured) return configured.id;
    if (!input.catalogConfigured && input.fallbackAvailable) return requested as ModelId;
  }
  if (enabled[0]) return enabled[0].id;
  if (input.fallbackAvailable) return (requested || 'fake-mini') as ModelId;
  return undefined;
}
