export const WEB_SEARCH_PROVIDER_IDS = [
  'tavily',
  'exa',
  'brave',
  'serpapi',
  'serper',
  'bing',
  'google',
  'firecrawl',
  'metaso',
  'doubao',
] as const;

export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDER_IDS)[number];

export interface WebSearchProviderSummary {
  id: WebSearchProviderId;
  name: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  priority: number;
  requiresEngineId?: boolean;
  engineId?: string;
  endpoint?: string;
  updatedAt?: string;
}

export interface ListWebSearchProvidersPayload {
  includeDisabled?: boolean;
}

export interface ListWebSearchProvidersResponse {
  providers: WebSearchProviderSummary[];
  nativeSearchPreferred: true;
}

export interface SaveWebSearchProviderPayload {
  providerId: WebSearchProviderId;
  enabled: boolean;
  apiKey?: string;
  secretKey?: string;
  clearApiKey?: boolean;
  clearSecretKey?: boolean;
  engineId?: string;
  endpoint?: string;
}

export interface SaveWebSearchProviderResponse {
  provider: WebSearchProviderSummary;
}

export interface ReorderWebSearchProvidersPayload {
  providerIds: WebSearchProviderId[];
}

export interface ReorderWebSearchProvidersResponse {
  providers: WebSearchProviderSummary[];
}

export interface TestWebSearchProviderPayload {
  providerId: WebSearchProviderId;
  query?: string;
  apiKey?: string;
  secretKey?: string;
  engineId?: string;
  endpoint?: string;
}

export interface TestWebSearchProviderResponse {
  ok: boolean;
  providerId: WebSearchProviderId;
  resultCount: number;
  elapsedMs: number;
  error?: string;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function providerIdValue(value: unknown): WebSearchProviderId | undefined {
  return typeof value === 'string' && WEB_SEARCH_PROVIDER_IDS.includes(value as WebSearchProviderId)
    ? (value as WebSearchProviderId)
    : undefined;
}

function optionalString(value: unknown, maxLength = 8192): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) return undefined;
  return value.trim();
}

export function parseListWebSearchProvidersPayload(
  value: unknown,
): ListWebSearchProvidersPayload | undefined {
  const record = recordValue(value ?? {});
  if (!record) return undefined;
  if (record.includeDisabled !== undefined && typeof record.includeDisabled !== 'boolean') {
    return undefined;
  }
  return record.includeDisabled === undefined ? {} : { includeDisabled: record.includeDisabled };
}

export function parseSaveWebSearchProviderPayload(
  value: unknown,
): SaveWebSearchProviderPayload | undefined {
  const record = recordValue(value);
  const providerId = providerIdValue(record?.providerId);
  if (!record || !providerId || typeof record.enabled !== 'boolean') return undefined;
  const apiKey = optionalString(record.apiKey);
  const secretKey = optionalString(record.secretKey);
  const engineId = optionalString(record.engineId, 512);
  const endpoint = optionalString(record.endpoint, 2048);
  if (
    (record.apiKey !== undefined && apiKey === undefined) ||
    (record.secretKey !== undefined && secretKey === undefined) ||
    (record.engineId !== undefined && engineId === undefined) ||
    (record.endpoint !== undefined && endpoint === undefined) ||
    (record.clearApiKey !== undefined && typeof record.clearApiKey !== 'boolean') ||
    (record.clearSecretKey !== undefined && typeof record.clearSecretKey !== 'boolean')
  ) {
    return undefined;
  }
  return {
    providerId,
    enabled: record.enabled,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(secretKey !== undefined ? { secretKey } : {}),
    ...(record.clearApiKey === true ? { clearApiKey: true } : {}),
    ...(record.clearSecretKey === true ? { clearSecretKey: true } : {}),
    ...(engineId !== undefined ? { engineId } : {}),
    ...(endpoint !== undefined ? { endpoint } : {}),
  };
}

export function parseReorderWebSearchProvidersPayload(
  value: unknown,
): ReorderWebSearchProvidersPayload | undefined {
  const record = recordValue(value);
  if (!record || !Array.isArray(record.providerIds)) return undefined;
  const providerIds = record.providerIds.map(providerIdValue);
  if (
    providerIds.some((id) => !id) ||
    new Set(providerIds).size !== providerIds.length ||
    providerIds.length !== WEB_SEARCH_PROVIDER_IDS.length
  ) {
    return undefined;
  }
  return { providerIds: providerIds as WebSearchProviderId[] };
}

export function parseTestWebSearchProviderPayload(
  value: unknown,
): TestWebSearchProviderPayload | undefined {
  const record = recordValue(value);
  const providerId = providerIdValue(record?.providerId);
  if (!record || !providerId) return undefined;
  const query = optionalString(record.query, 1000);
  const apiKey = optionalString(record.apiKey);
  const secretKey = optionalString(record.secretKey);
  const engineId = optionalString(record.engineId, 512);
  const endpoint = optionalString(record.endpoint, 2048);
  if (
    (record.query !== undefined && query === undefined) ||
    (record.apiKey !== undefined && apiKey === undefined) ||
    (record.secretKey !== undefined && secretKey === undefined) ||
    (record.engineId !== undefined && engineId === undefined) ||
    (record.endpoint !== undefined && endpoint === undefined)
  ) {
    return undefined;
  }
  return {
    providerId,
    ...(query ? { query } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(secretKey !== undefined ? { secretKey } : {}),
    ...(engineId !== undefined ? { engineId } : {}),
    ...(endpoint !== undefined ? { endpoint } : {}),
  };
}
