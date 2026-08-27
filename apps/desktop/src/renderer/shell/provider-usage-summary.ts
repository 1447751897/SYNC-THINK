import type { UsageRequestRow, UsageSummaryResponse } from '@sync-think/protocol';

export interface ProviderUsageIdentity {
  providerId?: string;
  providerName?: string;
  modelId?: string;
  providerModelId?: string;
}

export interface ProviderUsageWindow {
  totalTokens: number;
  costs: Partial<Record<'USD' | 'CNY', number>>;
}

export interface ProviderUsageWindows {
  today?: ProviderUsageWindow;
  last30d?: ProviderUsageWindow;
}

const USAGE_TTL_MS = 5 * 60_000;
let usageCache: { at: number; value: UsageSummaryResponse } | undefined;
let usageInflight: Promise<UsageSummaryResponse> | undefined;

function same(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function requestMatchesProvider(
  request: UsageRequestRow,
  identity: ProviderUsageIdentity,
): boolean {
  if (identity.providerId && request.providerId) return same(identity.providerId, request.providerId);
  if (identity.providerName && request.providerName) {
    return same(identity.providerName, request.providerName);
  }
  return (
    same(identity.modelId, request.modelId) ||
    same(identity.modelId, request.providerModelId) ||
    same(identity.providerModelId, request.modelId) ||
    same(identity.providerModelId, request.providerModelId)
  );
}

function aggregate(requests: readonly UsageRequestRow[]): ProviderUsageWindow | undefined {
  if (requests.length === 0) return undefined;
  const costs: ProviderUsageWindow['costs'] = {};
  let totalTokens = 0;
  for (const request of requests) {
    totalTokens += Math.max(0, request.totalTokens);
    if (
      request.currency &&
      typeof request.estimatedCost === 'number' &&
      Number.isFinite(request.estimatedCost)
    ) {
      costs[request.currency] = (costs[request.currency] ?? 0) + request.estimatedCost;
    }
  }
  return { totalTokens, costs };
}

export function summarizeProviderUsageWindows(
  summary: UsageSummaryResponse,
  identity: ProviderUsageIdentity,
  now: number = Date.now(),
): ProviderUsageWindows {
  const today = new Date(now);
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const last30dStart = now - 30 * 24 * 60 * 60_000;
  const matching = summary.requests.filter((request) => {
    const occurredAt = Date.parse(request.occurredAt);
    return (
      Number.isFinite(occurredAt) &&
      occurredAt >= last30dStart &&
      occurredAt <= now &&
      requestMatchesProvider(request, identity)
    );
  });
  return {
    today: aggregate(
      matching.filter((request) => {
        const occurredAt = Date.parse(request.occurredAt);
        return occurredAt >= todayStart;
      }),
    ),
    last30d: aggregate(matching),
  };
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatProviderUsageWindow(window: ProviderUsageWindow | undefined): string {
  if (!window) return '';
  const costs = (['CNY', 'USD'] as const).flatMap((currency) => {
    const value = window.costs[currency];
    if (typeof value !== 'number') return [];
    return [`${currency === 'CNY' ? '¥' : '$'}${value.toFixed(2)}`];
  });
  return [costs.length > 0 ? costs.join(' / ') : '—', formatTokens(window.totalTokens)].join(' · ');
}

export async function fetchProviderUsageSummary(
  fetcher: () => Promise<UsageSummaryResponse>,
  now: number = Date.now(),
): Promise<UsageSummaryResponse> {
  if (usageCache && now - usageCache.at < USAGE_TTL_MS) return usageCache.value;
  if (usageInflight) return usageInflight;
  usageInflight = fetcher()
    .then((value) => {
      usageCache = { at: now, value };
      usageInflight = undefined;
      return value;
    })
    .catch((error: unknown) => {
      usageInflight = undefined;
      throw error;
    });
  return usageInflight;
}

export function resetProviderUsageSummaryCacheForTests(): void {
  usageCache = undefined;
  usageInflight = undefined;
}
