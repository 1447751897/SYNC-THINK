import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSummaryResponse } from '@sync-think/protocol';
import {
  fetchProviderUsageSummary,
  formatProviderUsageWindow,
  resetProviderUsageSummaryCacheForTests,
  summarizeProviderUsageWindows,
} from './provider-usage-summary.js';

const NOW = new Date(2026, 7, 26, 10, 30, 0).getTime();

function summary(): UsageSummaryResponse {
  return {
    rows: [],
    requests: [
      {
        requestId: 'today-target',
        occurredAt: new Date(2026, 7, 26, 9, 0, 0).toISOString(),
        modelId: 'model-a',
        providerId: 'provider-a',
        providerName: 'Relay A',
        tokensIn: 100_000,
        tokensOut: 20_000,
        totalTokens: 120_000,
        status: 'success',
        estimatedCost: 0.12,
        currency: 'USD',
      },
      {
        requestId: 'older-target',
        occurredAt: new Date(2026, 7, 10, 9, 0, 0).toISOString(),
        modelId: 'model-a',
        providerId: 'provider-a',
        providerName: 'Relay A',
        tokensIn: 80_000,
        tokensOut: 10_000,
        totalTokens: 90_000,
        status: 'success',
        estimatedCost: 0.3,
        currency: 'USD',
      },
      {
        requestId: 'other-provider',
        occurredAt: new Date(2026, 7, 26, 9, 30, 0).toISOString(),
        modelId: 'model-b',
        providerId: 'provider-b',
        providerName: 'Relay B',
        tokensIn: 500_000,
        tokensOut: 50_000,
        totalTokens: 550_000,
        status: 'success',
        estimatedCost: 9,
        currency: 'USD',
      },
    ],
    tools: [],
    toolModels: [],
    toolFailures: [],
    pricing: [],
    totalRequests: 3,
    totalTokensIn: 680_000,
    totalTokensOut: 80_000,
    totalCostByCurrency: { USD: 9.42 },
    totalReasoningTokens: 0,
    totalTokens: 760_000,
  };
}

beforeEach(() => resetProviderUsageSummaryCacheForTests());

describe('NewMax-style provider usage windows', () => {
  it('keeps today local-calendar scoped and last30d provider scoped', () => {
    const windows = summarizeProviderUsageWindows(
      summary(),
      { providerId: 'provider-a', providerName: 'Relay A', modelId: 'model-a' },
      NOW,
    );

    expect(windows.today).toEqual({
      totalTokens: 120_000,
      costs: { USD: 0.12 },
    });
    expect(windows.last30d).toEqual({
      totalTokens: 210_000,
      costs: { USD: 0.42 },
    });
    expect(formatProviderUsageWindow(windows.last30d)).toBe('$0.42 · 210.0k');
    expect(formatProviderUsageWindow({ totalTokens: 2_300_000, costs: {} })).toBe('— · 2.3M');
  });

  it('shares one 30-day Runtime query for five minutes', async () => {
    const fetcher = vi.fn().mockResolvedValue(summary());

    await fetchProviderUsageSummary(fetcher, NOW);
    await fetchProviderUsageSummary(fetcher, NOW + 4 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await fetchProviderUsageSummary(fetcher, NOW + 5 * 60_000 + 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
