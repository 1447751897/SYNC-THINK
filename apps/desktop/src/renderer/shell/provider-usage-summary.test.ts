import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageSummaryResponse } from '@sync-think/protocol';
import {
  fetchUsageSummary,
  fetchProviderUsageWindows,
  formatProviderUsageWindow,
  readUsageSummaryCache,
  resetProviderUsageSummaryCacheForTests,
  usageSummaryRangeKey,
} from './provider-usage-summary.js';

const NOW = new Date(2026, 7, 26, 10, 30, 0).getTime();

function summary(range: 'today' | '30d' = '30d'): UsageSummaryResponse {
  return {
    rows: [
      {
        modelId: 'model-a',
        providerId: 'provider-a',
        providerName: 'Relay A',
        requests: range === 'today' ? 1 : 2,
        succeededRequests: range === 'today' ? 1 : 2,
        failedRequests: 0,
        tokensIn: range === 'today' ? 100_000 : 180_000,
        tokensOut: range === 'today' ? 20_000 : 30_000,
        reasoningTokens: 0,
        totalTokens: range === 'today' ? 120_000 : 210_000,
        totalCost: range === 'today' ? 0.12 : 0.42,
        currency: 'USD',
      },
      {
        modelId: 'model-b',
        providerId: 'provider-b',
        providerName: 'Relay B',
        requests: 1,
        succeededRequests: 1,
        failedRequests: 0,
        tokensIn: 500_000,
        tokensOut: 50_000,
        reasoningTokens: 0,
        totalTokens: 550_000,
        totalCost: 9,
        currency: 'USD',
      },
    ],
    requests: [],
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
    const fetcher = vi.fn(async (sinceDays: number) =>
      summary(sinceDays === 30 ? '30d' : 'today'),
    );
    return fetchProviderUsageWindows(
      fetcher,
      { providerId: 'provider-a', providerName: 'Relay A', modelId: 'model-a' },
      NOW,
    ).then((windows) => {
      expect(windows.today).toEqual({
        totalTokens: 120_000,
        costs: { USD: 0.12 },
      });
      expect(windows.last30d).toEqual({
        totalTokens: 210_000,
        costs: { USD: 0.42 },
      });
      expect(formatProviderUsageWindow(windows.last30d)).toBe('$0.42 · 210.0k');
      expect(formatProviderUsageWindow({ totalTokens: 2_300_000, costs: {} })).toBe(
        '— · 2.3M',
      );
      expect(fetcher).toHaveBeenCalledWith(30);
      expect(fetcher.mock.calls.some(([sinceDays]) => sinceDays > 0 && sinceDays < 1)).toBe(true);
    });
  });

  it('shares today and 30-day aggregate Runtime queries for five minutes', async () => {
    const fetcher = vi.fn(async (sinceDays: number) =>
      summary(sinceDays === 30 ? '30d' : 'today'),
    );
    const identity = { providerId: 'provider-a' };

    await fetchProviderUsageWindows(fetcher, identity, NOW);
    await fetchProviderUsageWindows(fetcher, identity, NOW + 4 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    await fetchProviderUsageWindows(fetcher, identity, NOW + 5 * 60_000 + 1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('isolates cached summaries by range and exposes a synchronous fresh snapshot', async () => {
    const sevenDays = vi.fn().mockResolvedValue(summary());
    const allTimeValue = { ...summary(), totalRequests: 99 };
    const allTime = vi.fn().mockResolvedValue(allTimeValue);
    const sevenDayKey = usageSummaryRangeKey(7);
    const allTimeKey = usageSummaryRangeKey();

    await fetchUsageSummary(sevenDayKey, sevenDays, { now: NOW });
    await fetchUsageSummary(allTimeKey, allTime, { now: NOW });

    expect(readUsageSummaryCache(sevenDayKey, NOW + 1)).toEqual(summary());
    expect(readUsageSummaryCache(allTimeKey, NOW + 1)).toEqual(allTimeValue);
    expect(readUsageSummaryCache(sevenDayKey, NOW + 5 * 60_000 + 1)).toBeUndefined();
  });

  it('refreshes one range without discarding another cached range', async () => {
    const sevenDayKey = usageSummaryRangeKey(7);
    const thirtyDayKey = usageSummaryRangeKey(30);
    const sevenDays = vi
      .fn()
      .mockResolvedValueOnce(summary())
      .mockResolvedValueOnce({ ...summary(), totalRequests: 7 });
    const thirtyDays = vi.fn().mockResolvedValue({ ...summary(), totalRequests: 30 });

    await fetchUsageSummary(sevenDayKey, sevenDays, { now: NOW });
    await fetchUsageSummary(thirtyDayKey, thirtyDays, { now: NOW });
    await fetchUsageSummary(sevenDayKey, sevenDays, { now: NOW + 1, refresh: true });

    expect(sevenDays).toHaveBeenCalledTimes(2);
    expect(thirtyDays).toHaveBeenCalledTimes(1);
    expect(readUsageSummaryCache(sevenDayKey, NOW + 2)?.totalRequests).toBe(7);
    expect(readUsageSummaryCache(thirtyDayKey, NOW + 2)?.totalRequests).toBe(30);
  });
});
