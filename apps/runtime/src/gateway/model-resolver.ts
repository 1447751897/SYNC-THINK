/**
 * Model-name resolution for **external** gateway clients only.
 *
 * A `claude` or `codex` CLI running in a terminal points at the gateway with no
 * run context, so the only routing signal it can offer is `body.model`. In-app
 * runs never take this path — they carry a ticket with the exact provider the
 * user selected (see tickets.ts).
 *
 * Ambiguity is resolved deterministically and reported, never silently guessed:
 * the lowest provider sortOrder wins, and the loser list is surfaced for the
 * settings UI. There is no configured default provider — inside the app the
 * conversation input already picked the provider, and external clients fall
 * back to catalog order.
 */
import type { GatewayRoute, GatewayUpstreamProtocol } from './tickets.js';
import { toGatewayUpstreamProtocol } from './tickets.js';

/** Flattened catalog row the resolver needs (kept free of storage types). */
export interface GatewayCatalogEntry {
  providerId: string;
  providerName: string;
  /** Provider sortOrder; lower wins a name collision. */
  sortOrder: number;
  baseUrl: string;
  /** Provider protocol family from the catalog. */
  protocol: string;
  /** Provider-facing model id (what the upstream expects). */
  providerModelId: string;
  /** Internal catalog model id. */
  modelId: string;
  enabled: boolean;
}

export interface GatewayModelMatch {
  route: Omit<GatewayRoute, 'apiKey'>;
  /** Other providers that expose the same model name (collision report). */
  shadowedBy: Array<{ providerId: string; providerName: string }>;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Pick the provider for a model name. Returns undefined when nothing matches.
 * Callers attach the secret afterwards (this module never touches credentials).
 */
export function resolveGatewayModelName(
  model: string,
  entries: readonly GatewayCatalogEntry[],
): GatewayModelMatch | undefined {
  const wanted = normalizeName(model);
  if (wanted === '') return undefined;
  const candidates = entries.filter(
    (entry) =>
      entry.enabled &&
      (normalizeName(entry.providerModelId) === wanted || normalizeName(entry.modelId) === wanted) &&
      toGatewayUpstreamProtocol(entry.protocol) !== undefined &&
      entry.baseUrl.trim() !== '',
  );
  if (candidates.length === 0) return undefined;

  const preferred = [...candidates].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.providerId.localeCompare(b.providerId),
  )[0];

  const protocol = toGatewayUpstreamProtocol(preferred.protocol) as GatewayUpstreamProtocol;
  return {
    route: {
      baseUrl: preferred.baseUrl,
      protocol,
      providerModelId: preferred.providerModelId,
      providerId: preferred.providerId,
    },
    shadowedBy: candidates
      .filter((entry) => entry.providerId !== preferred.providerId)
      .map((entry) => ({ providerId: entry.providerId, providerName: entry.providerName })),
  };
}
