import {
  scrubSecrets,
  normalizeOpenAICompatibleBaseUrl,
  type DiscoverOpenAICompatibleModelsOptions,
} from '../openai/discover-models.js';
import { ProviderDiscoveryError } from '../openai/discover-models.js';

export function joinAnthropicModelsUrl(baseUrl: string): string {
  // Custom Anthropic-compatible gateways (and Anthropic itself) serve /v1/models.
  // Host-only imports from CC Switch need the same /v1 normalization as OpenAI.
  const root = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (/\/models$/i.test(root)) return root;
  return `${root}/models`;
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(root.data)) candidates.push(...root.data);
  if (Array.isArray(root.models)) candidates.push(...root.models);
  if (Array.isArray(payload)) candidates.push(...(payload as unknown[]));

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const id =
      (item as { id?: unknown; model?: unknown }).id ??
      (item as { model?: unknown }).model;
    if (typeof id !== 'string') continue;
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

export interface DiscoverAnthropicModelsOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  anthropicVersion?: string;
}

/**
 * Anthropic model list: GET {baseUrl}/models with x-api-key + anthropic-version.
 * Also accepts OpenAI-shaped list responses from compatible gateways.
 */
export async function discoverAnthropicModels(
  options: DiscoverAnthropicModelsOptions,
): Promise<string[]> {
  const apiKey = options.apiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new ProviderDiscoveryError('API key is required for model discovery', 'auth');
  }

  const url = joinAnthropicModelsUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ProviderDiscoveryError('Fetch is not available in this runtime', 'protocol');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const version = options.anthropicVersion ?? '2023-06-01';

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': version,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderDiscoveryError('Model discovery timed out', 'timeout');
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
        `Model discovery network error: ${scrubSecrets(detail, [apiKey])}`,
        'transient',
      );
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      const snippet = scrubSecrets(text.slice(0, 240), [apiKey]);
      if (response.status === 401 || response.status === 403) {
        throw new ProviderDiscoveryError(
          `Model discovery auth failed (${response.status})${snippet ? ` — ${snippet}` : ''}`,
          'auth',
          response.status,
        );
      }
      if (response.status === 429) {
        throw new ProviderDiscoveryError(
          `Model discovery rate limited (${response.status})`,
          'rate-limit',
          response.status,
        );
      }
      throw new ProviderDiscoveryError(
        `Model discovery failed (${response.status})${snippet ? ` — ${snippet}` : ''}`,
        response.status >= 500 ? 'transient' : 'protocol',
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ProviderDiscoveryError('Model discovery returned non-JSON body', 'protocol');
    }
    return extractModelIds(payload);
  } finally {
    clearTimeout(timer);
  }
}

// Re-export for option typing reuse
export type { DiscoverOpenAICompatibleModelsOptions };
