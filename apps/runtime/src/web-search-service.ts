import type { WebSearchProviderId } from '@sync-think/protocol';
import { createHash, createHmac } from 'node:crypto';

export type RuntimeWebSearchProviderId = WebSearchProviderId | 'bing-rss' | 'duckduckgo';

export interface ResolvedWebSearchProvider {
  id: RuntimeWebSearchProviderId;
  apiKey: string;
  secretKey?: string;
  engineId?: string;
  endpoint?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchSuccess {
  ok: true;
  query: string;
  providerId: RuntimeWebSearchProviderId;
  attemptedProviderIds: RuntimeWebSearchProviderId[];
  failedProviderIds: RuntimeWebSearchProviderId[];
  results: WebSearchResult[];
}

export interface WebSearchFailure {
  ok: false;
  query: string;
  code: 'SEARCH_PROVIDER_NOT_CONFIGURED' | 'SEARCH_PROVIDER_FAILED' | 'SEARCH_CANCELLED';
  error: string;
  attemptedProviderIds: RuntimeWebSearchProviderId[];
  failedProviderIds: RuntimeWebSearchProviderId[];
}

export type WebSearchResponse = WebSearchSuccess | WebSearchFailure;

export interface SearchWebWithProvidersInput {
  query: string;
  limit?: number;
  providerId?: RuntimeWebSearchProviderId;
  allowedDomains?: string[];
  blockedDomains?: string[];
  providers: readonly ResolvedWebSearchProvider[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Whole failover chain deadline; stays below the 90s platform broker timeout. */
  overallTimeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function searchWebWithProviders(
  input: SearchWebWithProvidersInput,
): Promise<WebSearchResponse> {
  const query = input.query.trim();
  if (!query) {
    return failure(query, 'SEARCH_PROVIDER_FAILED', 'query is required', [], []);
  }
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 5), 1), 10);
  const candidates = input.providerId
    ? input.providers.filter((provider) => provider.id === input.providerId)
    : [...input.providers];
  if (candidates.length === 0) {
    return failure(
      query,
      'SEARCH_PROVIDER_NOT_CONFIGURED',
      input.providerId
        ? `Search provider ${input.providerId} is not configured`
        : 'No web search provider is configured',
      [],
      [],
    );
  }

  const attemptedProviderIds: RuntimeWebSearchProviderId[] = [];
  const failedProviderIds: RuntimeWebSearchProviderId[] = [];
  const deadline = Date.now() + Math.max(100, input.overallTimeoutMs ?? 75_000);
  let lastError = 'All configured search providers failed';
  for (const provider of candidates) {
    if (input.signal?.aborted) {
      return failure(
        query,
        'SEARCH_CANCELLED',
        'Web search was cancelled',
        attemptedProviderIds,
        failedProviderIds,
      );
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError = 'Overall web search deadline exceeded';
      break;
    }
    attemptedProviderIds.push(provider.id);
    try {
      const results = await searchProvider({
        provider,
        query,
        limit,
        allowedDomains: normalizedDomains(input.allowedDomains),
        blockedDomains: normalizedDomains(input.blockedDomains),
        fetchImpl: input.fetchImpl ?? fetch,
        timeoutMs: Math.min(
          Math.max(100, input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          Math.max(1, remainingMs),
        ),
        signal: input.signal,
      });
      const filtered = filterDomains(results, input.allowedDomains, input.blockedDomains).slice(
        0,
        limit,
      );
      if (filtered.length === 0) {
        throw new Error('provider returned no usable results');
      }
      return {
        ok: true,
        query,
        providerId: provider.id,
        attemptedProviderIds,
        failedProviderIds,
        results: filtered,
      };
    } catch (error) {
      failedProviderIds.push(provider.id);
      lastError = publicProviderError(provider, error);
      if (input.signal?.aborted) {
        return failure(
          query,
          'SEARCH_CANCELLED',
          'Web search was cancelled',
          attemptedProviderIds,
          failedProviderIds,
        );
      }
    }
  }
  return failure(
    query,
    'SEARCH_PROVIDER_FAILED',
    lastError,
    attemptedProviderIds,
    failedProviderIds,
  );
}

interface ProviderSearchInput {
  provider: ResolvedWebSearchProvider;
  query: string;
  limit: number;
  allowedDomains: string[];
  blockedDomains: string[];
  fetchImpl: typeof fetch;
  timeoutMs: number;
  signal?: AbortSignal;
}

async function searchProvider(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const { provider } = input;
  switch (provider.id) {
    case 'tavily':
      return searchTavily(input);
    case 'exa':
      return searchExa(input);
    case 'brave':
      return searchBrave(input);
    case 'serpapi':
      return searchSerpApi(input);
    case 'serper':
      return searchSerper(input);
    case 'bing':
      return searchBing(input);
    case 'google':
      return searchGoogle(input);
    case 'firecrawl':
      return searchFirecrawl(input);
    case 'metaso':
      return searchMetaso(input);
    case 'doubao':
      return searchDoubao(input);
    case 'bing-rss':
      return searchBingRss(input);
    case 'duckduckgo':
      return searchDuckDuckGo(input);
  }
}

async function searchTavily(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const data = await jsonRequest(
    input,
    input.provider.endpoint ?? 'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        query: input.query,
        api_key: input.provider.apiKey,
        max_results: input.limit,
        ...(input.allowedDomains.length ? { include_domains: input.allowedDomains } : {}),
        ...(input.blockedDomains.length ? { exclude_domains: input.blockedDomains } : {}),
      }),
    },
  );
  return rows(data, 'results').map((row) => result(row, 'title', 'url', ['content', 'snippet']));
}

async function searchExa(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const data = await jsonRequest(input, input.provider.endpoint ?? 'https://api.exa.ai/search', {
    method: 'POST',
    headers: jsonHeaders({ 'x-api-key': input.provider.apiKey }),
    body: JSON.stringify({
      query: input.query,
      numResults: input.limit,
      type: 'keyword',
      ...(input.allowedDomains.length ? { includeDomains: input.allowedDomains } : {}),
      ...(input.blockedDomains.length ? { excludeDomains: input.blockedDomains } : {}),
    }),
  });
  return rows(data, 'results').map((row) => result(row, 'title', 'url', ['text', 'summary']));
}

async function searchBrave(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const endpoint = new URL(
    input.provider.endpoint ?? 'https://api.search.brave.com/res/v1/web/search',
  );
  endpoint.searchParams.set('q', searchQuery(input));
  endpoint.searchParams.set('count', String(input.limit));
  const data = await jsonRequest(input, endpoint.toString(), {
    headers: { Accept: 'application/json', 'X-Subscription-Token': input.provider.apiKey },
  });
  const web = objectValue(data.web);
  return rows(web, 'results').map((row) => result(row, 'title', 'url', ['description']));
}

async function searchSerpApi(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const endpoint = new URL(input.provider.endpoint ?? 'https://serpapi.com/search.json');
  endpoint.searchParams.set('q', searchQuery(input));
  endpoint.searchParams.set('api_key', input.provider.apiKey);
  endpoint.searchParams.set('engine', 'google');
  endpoint.searchParams.set('num', String(input.limit));
  const data = await jsonRequest(input, endpoint.toString(), {
    headers: { Accept: 'application/json' },
  });
  return rows(data, 'organic_results').map((row) => result(row, 'title', 'link', ['snippet']));
}

async function searchSerper(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const data = await jsonRequest(
    input,
    input.provider.endpoint ?? 'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: jsonHeaders({ 'X-API-KEY': input.provider.apiKey }),
      body: JSON.stringify({ q: searchQuery(input), num: input.limit }),
    },
  );
  return rows(data, 'organic').map((row) => result(row, 'title', 'link', ['snippet']));
}

async function searchBing(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const endpoint = new URL(input.provider.endpoint ?? 'https://api.bing.microsoft.com/v7.0/search');
  endpoint.searchParams.set('q', searchQuery(input));
  endpoint.searchParams.set('count', String(input.limit));
  const data = await jsonRequest(input, endpoint.toString(), {
    headers: { Accept: 'application/json', 'Ocp-Apim-Subscription-Key': input.provider.apiKey },
  });
  const webPages = objectValue(data.webPages);
  return rows(webPages, 'value').map((row) => result(row, 'name', 'url', ['snippet']));
}

async function searchGoogle(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  if (!input.provider.engineId?.trim())
    throw new Error('Google Programmable Search engine ID is required');
  const endpoint = new URL(input.provider.endpoint ?? 'https://www.googleapis.com/customsearch/v1');
  endpoint.searchParams.set('q', searchQuery(input));
  endpoint.searchParams.set('key', input.provider.apiKey);
  endpoint.searchParams.set('cx', input.provider.engineId);
  endpoint.searchParams.set('num', String(input.limit));
  const data = await jsonRequest(input, endpoint.toString(), {
    headers: { Accept: 'application/json' },
  });
  return rows(data, 'items').map((row) => result(row, 'title', 'link', ['snippet']));
}

async function searchFirecrawl(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const data = await jsonRequest(
    input,
    input.provider.endpoint ?? 'https://api.firecrawl.dev/v1/search',
    {
      method: 'POST',
      headers: jsonHeaders({ Authorization: `Bearer ${input.provider.apiKey}` }),
      body: JSON.stringify({ query: searchQuery(input), limit: input.limit }),
    },
  );
  const payload = data.data;
  const candidates = Array.isArray(payload)
    ? payload.map(objectValue)
    : rows(payload, 'web').length
      ? rows(payload, 'web')
      : rows(payload, 'results');
  return candidates.map((row) => result(row, 'title', 'url', ['description', 'markdown']));
}

async function searchMetaso(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const data = await jsonRequest(
    input,
    input.provider.endpoint ?? 'https://metaso.cn/api/open/search/v2',
    {
      method: 'POST',
      headers: jsonHeaders({ Authorization: `Bearer ${input.provider.apiKey}` }),
      body: JSON.stringify({ question: searchQuery(input), stream: false }),
    },
  );
  if (typeof data.errCode === 'number' && data.errCode !== 0) {
    throw new Error(
      `Metaso API error ${data.errCode}: ${firstString(data, ['errMsg']) || 'unknown error'}`,
    );
  }
  const payload = objectValue(data.data);
  const candidateGroups = [
    rows(payload, 'references'),
    rows(payload, 'items'),
    rows(payload, 'webpages'),
    rows(payload, 'results'),
    rows(data, 'references'),
    rows(data, 'items'),
  ];
  const candidates = candidateGroups.find((group) => group.length > 0) ?? [];
  return candidates.map((row) =>
    result(objectValue(row), 'title', ['url', 'link'], ['summary', 'snippet', 'text', 'content']),
  );
}

async function searchDoubao(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const query = searchQuery(input);
  const usingAkSk = Boolean(input.provider.secretKey);
  const body = JSON.stringify({
    Query: query,
    SearchType: 'web',
    Count: input.limit,
    NeedSummary: true,
  });
  const endpoint = new URL(
    input.provider.endpoint ??
      (usingAkSk
        ? 'https://mercury.volcengineapi.com/?Action=WebSearch&Version=2025-01-01'
        : 'https://open.feedcoopapi.com/search_api/web_search'),
  );
  const headers = usingAkSk
    ? volcengineAuthorizationHeaders({
        endpoint,
        accessKey: input.provider.apiKey,
        secretKey: input.provider.secretKey!,
        body,
      })
    : jsonHeaders({
        Authorization: `Bearer ${input.provider.apiKey}`,
        'X-Traffic-Tag': 'skill_web_search_common',
      });
  const data = await jsonRequest(input, endpoint.toString(), {
    method: 'POST',
    headers,
    body,
  });
  const apiError = objectValue(objectValue(data.ResponseMetadata).Error);
  if (Object.keys(apiError).length > 0) {
    throw new Error(
      `Doubao API error ${firstString(apiError, ['Code']) || 'unknown'}: ${firstString(apiError, ['Message']) || 'unknown error'}`,
    );
  }
  const resultPayload = objectValue(data.Result ?? data.result ?? data.data);
  const candidates = rows(resultPayload, 'WebResults').length
    ? rows(resultPayload, 'WebResults')
    : rows(resultPayload, 'results');
  return candidates.map((row) =>
    result(
      row,
      ['Title', 'title', 'SiteName'],
      ['Url', 'URL', 'url'],
      ['Summary', 'Snippet', 'snippet', 'content'],
    ),
  );
}

function volcengineAuthorizationHeaders(input: {
  endpoint: URL;
  accessKey: string;
  secretKey: string;
  body: string;
}): Record<string, string> {
  const now = new Date();
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const region = 'cn-beijing';
  const service = 'volc_torchlight_api';
  const trafficTag = 'skill_web_search_common';
  const algorithm = 'HMAC-SHA256';
  const payloadHash = sha256Hex(input.body);
  const canonicalQuery = [...input.endpoint.searchParams.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  const canonicalHeaders = [
    'content-type:application/json',
    `host:${input.endpoint.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
    `x-traffic-tag:${trafficTag}`,
    '',
  ].join('\n');
  const signedHeaders = 'content-type;host;x-content-sha256;x-date;x-traffic-tag';
  const canonicalRequest = [
    'POST',
    input.endpoint.pathname || '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = [algorithm, xDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(Buffer.from(input.secretKey, 'utf8'), shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Content-Sha256': payloadHash,
    'X-Date': xDate,
    'X-Traffic-Tag': trafficTag,
    Authorization: `${algorithm} Credential=${input.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

async function searchDuckDuckGo(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const endpoint = new URL(input.provider.endpoint ?? 'https://html.duckduckgo.com/html/');
  endpoint.searchParams.set('q', searchQuery(input));
  const html = await textRequest(input, endpoint.toString(), {
    headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 SyncThink/1.0' },
  });
  const results: WebSearchResult[] = [];
  const linkPattern =
    /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links = [...html.matchAll(linkPattern)];
  for (const [index, link] of links.entries()) {
    const blockStart = (link.index ?? 0) + link[0].length;
    const blockEnd = links[index + 1]?.index ?? html.length;
    const block = html.slice(blockStart, blockEnd);
    const snippet =
      block.match(/class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? '';
    const url = decodeDuckDuckGoUrl(decodeHtml(link[1] ?? ''));
    if (!isHttpUrl(url)) continue;
    results.push({
      title: stripHtml(link[2] ?? ''),
      url,
      snippet: stripHtml(snippet),
    });
    if (results.length >= input.limit) break;
  }
  if (results.length === 0) throw new Error('DuckDuckGo returned no parsable results');
  return results;
}

async function searchBingRss(input: ProviderSearchInput): Promise<WebSearchResult[]> {
  const endpoint = new URL(input.provider.endpoint ?? 'https://www.bing.com/search');
  endpoint.searchParams.set('q', searchQuery(input));
  endpoint.searchParams.set('format', 'rss');
  endpoint.searchParams.set('count', String(input.limit));
  const xml = await textRequest(input, endpoint.toString(), {
    headers: {
      Accept: 'application/rss+xml,application/xml,text/xml',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SyncThink/1.0',
    },
  });
  const results: WebSearchResult[] = [];
  for (const item of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = item[1] ?? '';
    const url = stripHtml(xmlElement(block, 'link'));
    if (!isHttpUrl(url)) continue;
    results.push({
      title: stripHtml(xmlElement(block, 'title')) || 'Untitled result',
      url,
      snippet: stripHtml(xmlElement(block, 'description')),
    });
    if (results.length >= input.limit) break;
  }
  if (results.length === 0) throw new Error('Bing RSS returned no parsable results');
  return results;
}

function xmlElement(block: string, name: string): string {
  return block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] ?? '';
}

async function jsonRequest(
  input: ProviderSearchInput,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const body = await requestBody(input, url, init);
  try {
    // Parsing the body ourselves keeps the provider deadline active until the
    // complete response has arrived (Response#json would otherwise happen
    // after request() had already cleared its timer).
    return objectValue(JSON.parse(body.replace(/^\uFEFF/, '')));
  } catch {
    throw new Error('provider returned invalid JSON');
  }
}

async function textRequest(
  input: ProviderSearchInput,
  url: string,
  init: RequestInit,
): Promise<string> {
  return requestBody(input, url, init);
}

async function requestBody(
  input: ProviderSearchInput,
  url: string,
  init: RequestInit,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('search provider timed out')),
    input.timeoutMs,
  );
  const onAbort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await input.fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Keep the abort timer alive while the body is consumed. A provider can
    // send headers promptly and still stall forever while streaming JSON.
    return await response.text();
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

function result(
  row: Record<string, unknown>,
  titleKeys: string | string[],
  urlKeys: string | string[],
  snippetKeys: string[],
): WebSearchResult {
  return {
    title: firstString(row, titleKeys) || 'Untitled result',
    url: firstString(row, urlKeys),
    snippet: firstString(row, snippetKeys),
  };
}

function rows(value: unknown, key: string): Record<string, unknown>[] {
  const candidate = objectValue(value)[key];
  return Array.isArray(candidate) ? candidate.map(objectValue) : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(record: Record<string, unknown>, keys: string | string[]): string {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value.filter((item): item is string => typeof item === 'string').join(' ');
      if (joined.trim()) return joined.trim();
    }
  }
  return '';
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...extra };
}

function normalizedDomains(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function searchQuery(input: ProviderSearchInput): string {
  const include = input.allowedDomains.map((domain) => `site:${domain}`).join(' OR ');
  const exclude = input.blockedDomains.map((domain) => `-site:${domain}`).join(' ');
  return [input.query, include ? `(${include})` : '', exclude].filter(Boolean).join(' ');
}

function filterDomains(
  results: WebSearchResult[],
  allowed: readonly string[] | undefined,
  blocked: readonly string[] | undefined,
): WebSearchResult[] {
  const allowedSet = normalizedDomains(allowed);
  const blockedSet = normalizedDomains(blocked);
  return results.filter((entry) => {
    if (!entry.url || !isHttpUrl(entry.url)) return false;
    const host = new URL(entry.url).hostname.toLowerCase();
    const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (allowedSet.length > 0 && !allowedSet.some(matches)) return false;
    return !blockedSet.some(matches);
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function publicProviderError(provider: ResolvedWebSearchProvider, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const secrets = [provider.apiKey, provider.secretKey].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const scrubbed = secrets.reduce(
    (message, secret) => message.replaceAll(secret, '[redacted]'),
    raw,
  );
  const message = scrubbed.replace(/[\r\n]+/g, ' ').slice(0, 300);
  return `${provider.id} search failed: ${message || 'unknown provider error'}`;
}

function failure(
  query: string,
  code: WebSearchFailure['code'],
  error: string,
  attemptedProviderIds: RuntimeWebSearchProviderId[],
  failedProviderIds: RuntimeWebSearchProviderId[],
): WebSearchFailure {
  return { ok: false, query, code, error, attemptedProviderIds, failedProviderIds };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeDuckDuckGoUrl(value: string): string {
  try {
    const url = new URL(value, 'https://duckduckgo.com');
    const redirect = url.searchParams.get('uddg');
    return redirect ? decodeURIComponent(redirect) : url.toString();
  } catch {
    return value;
  }
}
