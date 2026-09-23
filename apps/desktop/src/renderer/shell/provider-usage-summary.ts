import type {
  ProviderBalanceResponse,
  UsageSummaryRow,
  UsageSummaryResponse,
} from '@sync-think/protocol';
import { formatUsageTokenCount } from './compact-number.js';

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
const usageCache = new Map<string, { at: number; value: UsageSummaryResponse }>();
const usageInflight = new Map<string, Promise<UsageSummaryResponse>>();

export function usageSummaryRangeKey(sinceDays?: number): string {
  return sinceDays === undefined ? 'usage-range:all' : `usage-range:${sinceDays}`;
}

export function readUsageSummaryCache(
  cacheKey: string,
  now: number = Date.now(),
): UsageSummaryResponse | undefined {
  const cached = usageCache.get(cacheKey);
  if (!cached || now - cached.at >= USAGE_TTL_MS) return undefined;
  return cached.value;
}

export function fetchUsageSummary(
  cacheKey: string,
  fetcher: () => Promise<UsageSummaryResponse>,
  options: { now?: number; refresh?: boolean } = {},
): Promise<UsageSummaryResponse> {
  const now = options.now ?? Date.now();
  if (!options.refresh) {
    const cached = readUsageSummaryCache(cacheKey, now);
    if (cached) return Promise.resolve(cached);
  }
  const active = usageInflight.get(cacheKey);
  if (active) return active;
  const request = fetcher().then(
    (value) => {
      usageCache.set(cacheKey, { at: now, value });
      usageInflight.delete(cacheKey);
      return value;
    },
    (cause: unknown) => {
      usageInflight.delete(cacheKey);
      throw cause;
    },
  );
  usageInflight.set(cacheKey, request);
  return request;
}

export function invalidateUsageSummaryCache(cacheKey?: string): void {
  if (cacheKey) {
    usageCache.delete(cacheKey);
    return;
  }
  usageCache.clear();
}

function same(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function rowMatchesProvider(
  row: UsageSummaryRow,
  identity: ProviderUsageIdentity,
): boolean {
  if (identity.providerId && row.providerId) return same(identity.providerId, row.providerId);
  if (identity.providerName && row.providerName) {
    return same(identity.providerName, row.providerName);
  }
  return (
    same(identity.modelId, row.modelId) ||
    same(identity.modelId, row.providerModelId) ||
    same(identity.providerModelId, row.modelId) ||
    same(identity.providerModelId, row.providerModelId)
  );
}

function aggregateRows(
  rows: readonly UsageSummaryRow[],
  identity: ProviderUsageIdentity,
): ProviderUsageWindow | undefined {
  const costs: ProviderUsageWindow['costs'] = {};
  let totalTokens = 0;
  let matched = false;
  for (const row of rows) {
    if (!rowMatchesProvider(row, identity)) continue;
    matched = true;
    totalTokens += Math.max(0, row.totalTokens);
    if (
      row.currency &&
      typeof row.totalCost === 'number' &&
      Number.isFinite(row.totalCost)
    ) {
      costs[row.currency] = (costs[row.currency] ?? 0) + row.totalCost;
    }
  }
  return matched ? { totalTokens, costs } : undefined;
}

export async function fetchProviderUsageWindows(
  fetcher: (sinceDays: number) => Promise<UsageSummaryResponse>,
  identity: ProviderUsageIdentity,
  now: number = Date.now(),
): Promise<ProviderUsageWindows> {
  const today = new Date(now);
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const dayMs = 24 * 60 * 60_000;
  const todaySinceDays = Math.max(1 / dayMs, (now - todayStart) / dayMs);
  const localDateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const [todaySummary, last30dSummary] = await Promise.all([
    fetchUsageSummary(`usage-provider-today:${localDateKey}`, () => fetcher(todaySinceDays), {
      now,
    }),
    fetchUsageSummary('usage-provider-range:30', () => fetcher(30), { now }),
  ]);
  return {
    today: aggregateRows(todaySummary.rows, identity),
    last30d: aggregateRows(last30dSummary.rows, identity),
  };
}

export function formatProviderUsageWindow(window: ProviderUsageWindow | undefined): string {
  if (!window) return '';
  const costs = (['CNY', 'USD'] as const).flatMap((currency) => {
    const value = window.costs[currency];
    if (typeof value !== 'number') return [];
    return [`${currency === 'CNY' ? '¥' : '$'}${value.toFixed(2)}`];
  });
  return [
    costs.length > 0 ? costs.join(' / ') : '—',
    formatUsageTokenCount(window.totalTokens),
  ].join(' · ');
}

export interface ProviderBalanceView {
  /** Formatted primary balance, e.g. `¥33.48`. */
  total: string;
  /** Credit the user paid for, when the endpoint reports it separately. */
  toppedUp?: string;
  /** Promotional / gifted credit, when the endpoint reports it separately. */
  granted?: string;
}

const BALANCE_TTL_MS = 60_000;
let balanceCache: { at: number; key: string; value: ProviderBalanceView | undefined } | undefined;
let balanceInflight:
  | { key: string; promise: Promise<ProviderBalanceView | undefined> }
  | undefined;

function formatBalanceAmount(currency: string, amount: number): string {
  const code = currency.trim().toUpperCase();
  const symbol = code === 'CNY' ? '¥' : code === 'USD' ? '$' : `${code} `;
  return `${symbol}${amount.toFixed(2)}`;
}

/**
 * Render-ready view of a provider balance response. `undefined` means "omit the
 * row": the provider exposes no balance endpoint, the query failed, or the
 * endpoint reported no buckets.
 */
export function toProviderBalanceView(
  response: ProviderBalanceResponse | undefined,
): ProviderBalanceView | undefined {
  if (!response || !response.supported) return undefined;
  const bucket = response.buckets[0];
  if (!bucket) return undefined;
  return {
    total: formatBalanceAmount(bucket.currency, bucket.totalBalance),
    ...(bucket.toppedUpBalance !== undefined
      ? { toppedUp: formatBalanceAmount(bucket.currency, bucket.toppedUpBalance) }
      : {}),
    ...(bucket.grantedBalance !== undefined
      ? { granted: formatBalanceAmount(bucket.currency, bucket.grantedBalance) }
      : {}),
  };
}

/**
 * Query the provider's account balance with a short TTL + in-flight dedupe, so
 * hovering the usage tooltip does not re-hit the provider on every mount.
 */
export async function fetchProviderBalanceView(
  cacheKey: string,
  fetcher: () => Promise<ProviderBalanceResponse>,
  now: number = Date.now(),
): Promise<ProviderBalanceView | undefined> {
  if (balanceCache && balanceCache.key === cacheKey && now - balanceCache.at < BALANCE_TTL_MS) {
    return balanceCache.value;
  }
  if (balanceInflight && balanceInflight.key === cacheKey) return balanceInflight.promise;
  const promise = fetcher()
    .then((response) => {
      const value = toProviderBalanceView(response);
      balanceCache = { at: now, key: cacheKey, value };
      balanceInflight = undefined;
      return value;
    })
    .catch((error: unknown) => {
      balanceInflight = undefined;
      throw error;
    });
  balanceInflight = { key: cacheKey, promise };
  return promise;
}

export function resetProviderUsageSummaryCacheForTests(): void {
  usageCache.clear();
  usageInflight.clear();
  balanceCache = undefined;
  balanceInflight = undefined;
}
