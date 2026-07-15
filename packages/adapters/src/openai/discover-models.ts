import type { FailureClass } from '../types.js';

/** Error from remote model discovery; message must already be secret-scrubbed. */
export class ProviderDiscoveryError extends Error {
  readonly failureClass: FailureClass;
  readonly status?: number;

  constructor(message: string, failureClass: FailureClass, status?: number) {
    super(message);
    this.name = 'ProviderDiscoveryError';
    this.failureClass = failureClass;
    this.status = status;
  }
}

export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length < 4) continue;
    out = out.split(trimmed).join('[REDACTED]');
  }
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~\-+/=]+/gi, 'Bearer [REDACTED]');
  return out;
}

/**
 * Normalize OpenAI-compatible gateway root.
 * Host-only imports (e.g. https://www.kamenking.top from CC Switch) need `/v1`
 * so `/models` hits the API, not an HTML marketing page.
 */
export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.length === 0) {
    throw new ProviderDiscoveryError('Base URL must not be empty', 'protocol');
  }
  // Already an API path — keep as-is.
  if (/\/(v\d+|models|chat|completions|responses|images)(\/|$)/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const u = new URL(trimmed);
    // Only origin → append /v1.
    if (u.pathname === '/' || u.pathname === '') {
      return `${trimmed}/v1`;
    }
  } catch {
    // leave non-URL strings unchanged below
  }
  return trimmed;
}

/** Join base URL to OpenAI-compatible `/models` without doubling the path. */
export function joinModelsUrl(baseUrl: string): string {
  const root = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (/\/models$/i.test(root)) return root;
  return `${root}/models`;
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];

  const root = payload as Record<string, unknown>;
  const candidates: unknown[] = [];

  if (Array.isArray(root.data)) {
    candidates.push(...root.data);
  } else if (Array.isArray(root.models)) {
    candidates.push(...root.models);
  } else if (Array.isArray(payload)) {
    candidates.push(...payload);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown; model?: unknown }).id ?? (item as { model?: unknown }).model;
    if (typeof id !== 'string') continue;
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

export interface DiscoverOpenAICompatibleModelsOptions {
  apiKey: string;
  baseUrl: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * OpenAI-compatible model list: GET {baseUrl}/models with Bearer auth.
 * Used by openai-chat, openai-responses, and openai-images gateways.
 */
export async function discoverOpenAICompatibleModels(
  options: DiscoverOpenAICompatibleModelsOptions,
): Promise<string[]> {
  const apiKey = options.apiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ProviderDiscoveryError('API key is required for model discovery', 'auth');
  }

  const url = joinModelsUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ProviderDiscoveryError('Fetch is not available in this runtime', 'protocol');
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
        throw new ProviderDiscoveryError('Provider discovery timed out', 'timeout');
      }
      const raw = error instanceof Error ? error.message : 'network error';
      const cause =
        error instanceof Error && error.cause && typeof error.cause === 'object' && 'code' in error.cause
          ? String((error.cause as { code?: unknown }).code ?? '')
          : error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : '';
      const detail = cause ? `${raw} (${cause})` : raw;
      throw new ProviderDiscoveryError(
        `Provider discovery network error: ${scrubSecrets(detail, [apiKey])}`,
        'transient',
      );
    }

    const bodyText = await response.text();
    if (!response.ok) {
      const snippet = scrubSecrets(bodyText.slice(0, 240), [apiKey]);
      const detail = snippet.length > 0 ? ` — ${snippet}` : '';
      if (response.status === 401 || response.status === 403) {
        throw new ProviderDiscoveryError(
          `Provider auth failed (${response.status})${detail}`,
          'auth',
          response.status,
        );
      }
      if (response.status === 429) {
        throw new ProviderDiscoveryError(
          `Provider rate limited (${response.status})${detail}`,
          'rate-limit',
          response.status,
        );
      }
      if (response.status >= 400 && response.status < 500) {
        throw new ProviderDiscoveryError(
          `Provider discovery rejected (${response.status})${detail}`,
          'protocol',
          response.status,
        );
      }
      throw new ProviderDiscoveryError(
        `Provider discovery failed (${response.status})${detail}`,
        'transient',
        response.status,
      );
    }

    let json: unknown;
    try {
      json = bodyText.length === 0 ? { data: [] } : JSON.parse(bodyText);
    } catch {
      throw new ProviderDiscoveryError('Provider discovery returned non-JSON body', 'protocol');
    }

    return extractModelIds(json);
  } finally {
    clearTimeout(timer);
  }
}
