import type { ModelPricingEntry } from '@sync-think/protocol';
import { splitProviderUsageTokens } from '@sync-think/shared';

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
  return estimateUsageCostBreakdown(usage, pricing).total;
}

export interface UsageCostBreakdown {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
}

export function estimateUsageCostBreakdown(
  usage: {
    tokensIn: number;
    tokensOut: number;
    cachedTokensHit?: number;
    cachedTokensCreated?: number;
  },
  pricing: ModelPricingEntry,
): UsageCostBreakdown {
  const tokens = splitProviderUsageTokens(usage);
  const input = (tokens.inputTokens * pricing.inputPerMillion) / 1_000_000;
  const cacheRead = (tokens.cacheReadTokens * pricing.cacheReadPerMillion) / 1_000_000;
  const cacheWrite = (tokens.cacheWriteTokens * pricing.cacheWritePerMillion) / 1_000_000;
  const output = (tokens.outputTokens * pricing.outputPerMillion) / 1_000_000;
  return {
    input,
    cacheRead,
    cacheWrite,
    output,
    total: input + cacheRead + cacheWrite + output,
  };
}
