import type { ProviderPanelItem } from '@sync-think/ui-kit';
import type { ComposeModelOption } from '@sync-think/ui-kit';

/**
 * Flatten registered providers into Compose model options.
 * Sorted by provider name then providerModelId for stable UX.
 */
export function buildComposeModelOptions(
  providers: readonly ProviderPanelItem[],
): ComposeModelOption[] {
  const options: ComposeModelOption[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      options.push({
        modelId: model.modelId,
        label: `${provider.name} · ${model.displayName || model.providerModelId}`,
        providerName: provider.name,
        providerModelId: model.providerModelId,
        providerId: provider.providerId,
        surface: provider.surface,
        protocol: model.protocol || provider.protocol,
      });
    }
  }
  options.sort((a, b) => {
    const byProvider = (a.providerName ?? '').localeCompare(b.providerName ?? '', 'zh-CN');
    if (byProvider !== 0) return byProvider;
    return (a.providerModelId ?? a.label).localeCompare(b.providerModelId ?? b.label, 'zh-CN');
  });
  return options;
}

/** Drop selection if the model disappeared from the catalog. */
export function sanitizeSelectedModelId(
  selectedModelId: string | null,
  options: readonly ComposeModelOption[],
): string | null {
  if (!selectedModelId) return null;
  return options.some((o) => o.modelId === selectedModelId) ? selectedModelId : null;
}

/** Resolve a human-readable Agent default label without exposing an internal model UUID. */
export function resolveAgentDefaultModelLabel(
  defaultModelId: string | null | undefined,
  options: readonly ComposeModelOption[],
): string {
  if (!defaultModelId) return 'Agent 默认';
  const model = options.find((option) => option.modelId === defaultModelId);
  const modelName = model?.providerModelId?.trim();
  return modelName ? `Agent 默认 · ${modelName}` : 'Agent 默认';
}
