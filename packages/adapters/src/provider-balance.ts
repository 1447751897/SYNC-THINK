import type { FailureClass } from './types.js';
import { scrubSecrets } from './openai/discover-models.js';

/** Error from a remote account-balance query; message must already be secret-scrubbed. */
export class ProviderBalanceError extends Error {
  readonly failureClass: FailureClass;
  readonly status?: number;

  constructor(message: string, failureClass: FailureClass, status?: number) {
    super(message);
    this.name = 'ProviderBalanceError';
    this.failureClass = failureClass;
    this.status = status;
  }
}

export interface ProviderBalanceBucket {
  currency: string;
  totalBalance: number;
  grantedBalance?: number;
  toppedUpBalance?: number;
}

export interface ProviderBalanceResult {
  /** Provider-reported availability flag, when the endpoint exposes one. */
  available?: boolean;
  buckets: ProviderBalanceBucket[];
}

export interface FetchProviderBalanceOptions {
  apiKey: string;
  baseUrl: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * A provider account-balance endpoint. Each entry owns both the URL shape and
 * the response parser so adding a provider is a self-contained declaration.
 */
interface BalanceEndpoint {
  id: string;
  matches(baseUrl: string): boolean;
  buildUrl(baseUrl: string): string;
  parse(payload: unknown): ProviderBalanceResult;
}

function toAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalKey<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

/**
 * DeepSeek: GET {origin}/user/balance with Bearer auth.
 * Returns `{ is_available, balance_infos: [{ currency, total_balance,
 * granted_balance, topped_up_balance }] }`, where amounts are decimal strings.
 */
const deepSeekBalanceEndpoint: BalanceEndpoint = {
  id: 'deepseek',
  matches(baseUrl) {
    try {
      const host = new URL(baseUrl.trim()).hostname.toLowerCase();
      return host === 'deepseek.com' || host.endsWith('.deepseek.com');
    } catch {
      return false;
    }
  },
  buildUrl(baseUrl) {
    // Balance lives outside the OpenAI-compatible `/v1` prefix, so keep the origin only.
    return `${new URL(baseUrl.trim()).origin}/user/balance`;
  },
  parse(payload) {
    const root =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const rawBuckets = Array.isArray(root.balance_infos) ? root.balance_infos : [];
    const buckets: ProviderBalanceBucket[] = [];
    for (const item of rawBuckets) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const currency = typeof record.currency === 'string' ? record.currency.trim() : '';
      const totalBalance = toAmount(record.total_balance);
      if (currency.length === 0 || totalBalance === undefined) continue;
      buckets.push({
        currency,
        totalBalance,
        ...optionalKey('grantedBalance', toAmount(record.granted_balance)),
        ...optionalKey('toppedUpBalance', toAmount(record.topped_up_balance)),
      });
    }
    return {
      ...(typeof root.is_available === 'boolean' ? { available: root.is_available } : {}),
      buckets,
    };
  },
};

const BALANCE_ENDPOINTS: readonly BalanceEndpoint[] = [deepSeekBalanceEndpoint];

/** True when this provider exposes a balance endpoint the runtime knows how to call. */
export function supportsProviderBalance(baseUrl: string): boolean {
  return BALANCE_ENDPOINTS.some((endpoint) => endpoint.matches(baseUrl));
}

/**
 * Query a provider's account balance. Throws `ProviderBalanceError` when the
 * provider is unsupported, unauthenticated, or the upstream call fails.
 */
export async function fetchProviderBalance(
  options: FetchProviderBalanceOptions,
): Promise<ProviderBalanceResult> {
  const apiKey = options.apiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ProviderBalanceError('API key is required to query the account balance', 'auth');
  }

  const endpoint = BALANCE_ENDPOINTS.find((candidate) => candidate.matches(options.baseUrl));
  if (!endpoint) {
    throw new ProviderBalanceError(
      'This provider does not expose a public balance endpoint',
      'protocol',
    );
  }

  const url = endpoint.buildUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ProviderBalanceError('Fetch is not available in this runtime', 'protocol');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderBalanceError('Balance query timed out', 'timeout');
      }
      const raw = error instanceof Error ? error.message : 'network error';
      throw new ProviderBalanceError(
        `Balance query network error: ${scrubSecrets(raw, [apiKey])}`,
        'transient',
      );
    }

    const bodyText = await response.text();
    if (!response.ok) {
      const snippet = scrubSecrets(bodyText.slice(0, 240), [apiKey]);
      const detail = snippet.length > 0 ? ` — ${snippet}` : '';
      if (response.status === 401 || response.status === 403) {
        throw new ProviderBalanceError(
          `Balance query auth failed (${response.status})${detail}`,
          'auth',
          response.status,
        );
      }
      if (response.status === 429) {
        throw new ProviderBalanceError(
          `Balance query rate limited (${response.status})${detail}`,
          'rate-limit',
          response.status,
        );
      }
      if (response.status >= 400 && response.status < 500) {
        throw new ProviderBalanceError(
          `Balance query rejected (${response.status})${detail}`,
          'protocol',
          response.status,
        );
      }
      throw new ProviderBalanceError(
        `Balance query failed (${response.status})${detail}`,
        'transient',
        response.status,
      );
    }

    let json: unknown;
    try {
      json = bodyText.length === 0 ? {} : JSON.parse(bodyText);
    } catch {
      throw new ProviderBalanceError('Balance query returned non-JSON body', 'protocol');
    }
    return endpoint.parse(json);
  } finally {
    clearTimeout(timer);
  }
}
