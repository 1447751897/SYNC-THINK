import type { ModelPricingEntry } from '@sync-think/protocol';

export const MODEL_PRICING_SETTING_KEY = 'model-pricing';

export function parseModelPricingEntries(value: unknown): ModelPricingEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const numbers = [
      row.inputPerMillion,
      row.outputPerMillion,
      row.cacheReadPerMillion,
      row.cacheWritePerMillion,
    ];
    if (
      typeof row.modelId !== 'string' ||
      !row.modelId.trim() ||
      typeof row.displayName !== 'string' ||
      !row.displayName.trim() ||
      (row.currency !== 'USD' && row.currency !== 'CNY') ||
      numbers.some((number) => typeof number !== 'number' || !Number.isFinite(number) || number < 0)
    ) {
      return [];
    }
    return [
      {
        modelId: row.modelId.trim(),
        displayName: row.displayName.trim(),
        currency: row.currency,
        inputPerMillion: row.inputPerMillion as number,
        outputPerMillion: row.outputPerMillion as number,
        cacheReadPerMillion: row.cacheReadPerMillion as number,
        cacheWritePerMillion: row.cacheWritePerMillion as number,
      },
    ];
  });
}

export function estimateUsageCost(
  usage: {
    tokensIn: number;
    tokensOut: number;
    cachedTokensHit?: number;
    cachedTokensCreated?: number;
  },
  pricing: ModelPricingEntry,
): number {
  const cacheRead = Math.max(0, usage.cachedTokensHit ?? 0);
  const cacheWrite = Math.max(0, usage.cachedTokensCreated ?? 0);
  const uncachedInput = Math.max(0, usage.tokensIn - cacheRead - cacheWrite);
  return (
    (uncachedInput * pricing.inputPerMillion +
      usage.tokensOut * pricing.outputPerMillion +
      cacheRead * pricing.cacheReadPerMillion +
      cacheWrite * pricing.cacheWritePerMillion) /
    1_000_000
  );
}
