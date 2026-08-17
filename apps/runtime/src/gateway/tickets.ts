/**
 * Per-run routing tickets for the open gateway.
 *
 * The gateway must never guess which provider a request belongs to. When a run
 * starts, the runtime already knows exactly what the user picked (provider,
 * model, credential), so it registers a ticket and hands the kernel only the
 * ticket id — as the kernel's API key. The gateway looks the ticket up and uses
 * its baseUrl / protocol / secret verbatim, overwriting whatever model name the
 * kernel put in the body. Two providers exposing the same model name are
 * therefore never ambiguous.
 *
 * Security: ticket ids are per-run CSPRNG values; secrets live only in this
 * in-memory map, never in events, logs or settings.
 */
import { randomBytes } from 'node:crypto';

/** Upstream wire dialect a ticket points at. */
export type GatewayUpstreamProtocol = 'anthropic-messages' | 'openai-chat' | 'openai-responses';

export interface GatewayRoute {
  /** Upstream provider root (e.g. https://relay.example.com/v1). */
  baseUrl: string;
  /** Dialect the upstream actually speaks. */
  protocol: GatewayUpstreamProtocol;
  /** Provider-facing model id the user selected. */
  providerModelId: string;
  /** Plaintext upstream secret (never logged). */
  apiKey: string;
  /** Provider id, kept for diagnostics only. */
  providerId?: string;
  /**
   * Stable Responses continuation scope owned by the external kernel session.
   * Ticket ids remain per-run credentials and must not be used as this scope
   * when a kernel resumes the same conversation in a later process.
   */
  responseContinuationScopeId?: string;
}

export interface GatewayTicket extends GatewayRoute {
  /** Opaque id handed to the kernel as its API key. */
  id: string;
}

/** Provider-authoritative usage captured from one upstream HTTP request. */
export interface GatewayRunUsage {
  /** Stable for progressive usage reports emitted by the same upstream request. */
  requestId: string;
  /** Provider-native response/message id, when the provider exposes one. */
  providerResponseId?: string;
  providerId?: string;
  providerModelId: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
  reasoningTokens?: number;
  totalTokens: number;
}

export interface GatewayResponseContinuationPersistence {
  load(scopeId: string): readonly (readonly [callId: string, itemId: string])[] | undefined;
  save(
    scopeId: string,
    items: readonly (readonly [callId: string, itemId: string])[],
  ): void;
  remove(scopeId: string): void;
  onError?(operation: 'load' | 'save' | 'remove', scopeId: string, error: unknown): void;
}

/**
 * In-memory ticket table. One instance per runtime; tickets are revoked when
 * their run ends so a leaked id stops working immediately.
 */
export class GatewayTicketRegistry {
  private static readonly MAX_CONTINUATION_SCOPES = 128;
  private static readonly MAX_FUNCTION_ITEMS_PER_SCOPE = 256;
  private readonly tickets = new Map<
    string,
    { runId: string; route: GatewayRoute; kernelId?: string }
  >();
  /** run id → ticket id, so a run's ticket can be revoked without bookkeeping. */
  private readonly byRun = new Map<string, string>();
  /** run id → request id → progressively merged provider usage. */
  private readonly runUsage = new Map<string, Map<string, GatewayRunUsage>>();
  /** Continuation scope → Responses call id → provider function_call item id. */
  private readonly responseByFunctionCall = new Map<string, Map<string, string>>();

  constructor(
    private readonly responseContinuationPersistence?: GatewayResponseContinuationPersistence,
  ) {}

  /**
   * Issue a ticket for a run. Re-issuing for the same run revokes the old one,
   * so a retried run never leaves a stale credential reachable.
   */
  issue(runId: string, route: GatewayRoute, kernelId?: string): GatewayTicket {
    this.revokeRun(runId);
    const id = `stgw_${randomBytes(24).toString('base64url')}`;
    this.tickets.set(id, { runId, route, kernelId });
    this.byRun.set(runId, id);
    return { id, ...route };
  }

  /** Resolve a ticket by the API key the kernel presented. */
  resolve(ticketId: string | undefined): GatewayRoute | undefined {
    if (!ticketId) return undefined;
    return this.tickets.get(ticketId)?.route;
  }

  /** Resolve both the run owner and route for provider usage attribution. */
  resolveWithRun(
    ticketId: string | undefined,
  ): { runId: string; route: GatewayRoute; kernelId?: string } | undefined {
    if (!ticketId) return undefined;
    return this.tickets.get(ticketId);
  }

  /** Merge one progressive provider usage report into the owning run. */
  recordRunUsage(runId: string, usage: GatewayRunUsage): void {
    const requestId = usage.requestId.trim();
    if (!runId || !requestId) return;
    let requests = this.runUsage.get(runId);
    if (!requests) {
      requests = new Map();
      this.runUsage.set(runId, requests);
    }
    const previous = requests.get(requestId);
    requests.set(requestId, mergeRunUsage(previous, { ...usage, requestId }));
  }

  /** Return and clear all provider usage accumulated for a run. */
  consumeRunUsage(runId: string): GatewayRunUsage[] {
    const requests = this.runUsage.get(runId);
    this.runUsage.delete(runId);
    return requests ? [...requests.values()] : [];
  }

  /**
   * Remember the provider `function_call` item id required to continue a
   * Responses function call via HTTP `item_reference`.
   */
  recordContinuationItem(scopeId: string, callId: string, itemId: string): void {
    if (!scopeId || !callId || !itemId) return;
    const responses = this.responsesForScope(scopeId, true);
    if (!responses) return;
    if (
      responses.size >= GatewayTicketRegistry.MAX_FUNCTION_ITEMS_PER_SCOPE &&
      !responses.has(callId)
    ) {
      const oldestCall = responses.keys().next().value;
      if (typeof oldestCall === 'string') responses.delete(oldestCall);
    }
    responses.delete(callId);
    responses.set(callId, itemId);
    this.persistResponses(scopeId, responses);
  }

  /** Resolve the provider item id that produced a call within one session scope. */
  resolveContinuationItem(scopeId: string, callId: string): string | undefined {
    return this.responsesForScope(scopeId, false)?.get(callId);
  }

  /** Clear one session's continuation state after that kernel session becomes invalid. */
  clearResponseFunctionItems(scopeId: string): void {
    if (!scopeId) return;
    this.responseByFunctionCall.delete(scopeId);
    try {
      this.responseContinuationPersistence?.remove(scopeId);
    } catch (error) {
      this.responseContinuationPersistence?.onError?.('remove', scopeId, error);
    }
  }

  /** Revoke the ticket bound to a run (no-op when the run had none). */
  revokeRun(runId: string): void {
    this.runUsage.delete(runId);
    const existing = this.byRun.get(runId);
    if (!existing) return;
    this.tickets.delete(existing);
    // Routes without a stable session scope fall back to the ticket id.
    this.responseByFunctionCall.delete(existing);
    this.byRun.delete(runId);
  }

  /** Drop process-local tickets and continuation cache (durable scopes remain persisted). */
  clear(): void {
    this.tickets.clear();
    this.byRun.clear();
    this.runUsage.clear();
    this.responseByFunctionCall.clear();
  }

  get size(): number {
    return this.tickets.size;
  }

  private responsesForScope(
    scopeId: string,
    create: boolean,
  ): Map<string, string> | undefined {
    const cached = this.responseByFunctionCall.get(scopeId);
    if (cached) {
      this.responseByFunctionCall.delete(scopeId);
      this.responseByFunctionCall.set(scopeId, cached);
      return cached;
    }

    let loaded:
      | readonly (readonly [callId: string, itemId: string])[]
      | undefined;
    try {
      loaded = this.responseContinuationPersistence?.load(scopeId);
    } catch (error) {
      this.responseContinuationPersistence?.onError?.('load', scopeId, error);
    }
    if (!loaded && !create) return undefined;

    const items = new Map<string, string>();
    for (const entry of loaded ?? []) {
      const callId = typeof entry?.[0] === 'string' ? entry[0].trim() : '';
      const itemId = typeof entry?.[1] === 'string' ? entry[1].trim() : '';
      if (!callId || !itemId) continue;
      items.delete(callId);
      items.set(callId, itemId);
      if (items.size > GatewayTicketRegistry.MAX_FUNCTION_ITEMS_PER_SCOPE) {
        const oldestCall = items.keys().next().value;
        if (typeof oldestCall === 'string') items.delete(oldestCall);
      }
    }
    this.cacheResponses(scopeId, items);
    return items;
  }

  private cacheResponses(scopeId: string, items: Map<string, string>): void {
    if (
      this.responseByFunctionCall.size >= GatewayTicketRegistry.MAX_CONTINUATION_SCOPES &&
      !this.responseByFunctionCall.has(scopeId)
    ) {
      const oldestScope = this.responseByFunctionCall.keys().next().value;
      if (typeof oldestScope === 'string') this.responseByFunctionCall.delete(oldestScope);
    }
    this.responseByFunctionCall.set(scopeId, items);
  }

  private persistResponses(scopeId: string, items: Map<string, string>): void {
    try {
      this.responseContinuationPersistence?.save(scopeId, [...items.entries()]);
    } catch (error) {
      this.responseContinuationPersistence?.onError?.('save', scopeId, error);
    }
  }
}

function mergeRunUsage(
  previous: GatewayRunUsage | undefined,
  next: GatewayRunUsage,
): GatewayRunUsage {
  if (!previous) return next;
  const merged: GatewayRunUsage = {
    requestId: next.requestId,
    providerModelId: latestString(next.providerModelId, previous.providerModelId) ?? '',
    tokensIn: maxNumber(previous.tokensIn, next.tokensIn),
    tokensOut: maxNumber(previous.tokensOut, next.tokensOut),
    totalTokens: maxNumber(previous.totalTokens, next.totalTokens),
  };
  const providerResponseId = latestString(
    next.providerResponseId,
    previous.providerResponseId,
  );
  const providerId = latestString(next.providerId, previous.providerId);
  const cachedTokensHit = maxOptionalNumber(
    previous.cachedTokensHit,
    next.cachedTokensHit,
  );
  const cachedTokensCreated = maxOptionalNumber(
    previous.cachedTokensCreated,
    next.cachedTokensCreated,
  );
  const reasoningTokens = maxOptionalNumber(
    previous.reasoningTokens,
    next.reasoningTokens,
  );
  if (providerResponseId) merged.providerResponseId = providerResponseId;
  if (providerId) merged.providerId = providerId;
  if (cachedTokensHit !== undefined) merged.cachedTokensHit = cachedTokensHit;
  if (cachedTokensCreated !== undefined) {
    merged.cachedTokensCreated = cachedTokensCreated;
  }
  if (reasoningTokens !== undefined) merged.reasoningTokens = reasoningTokens;
  return merged;
}

function latestString(next: string | undefined, previous: string | undefined): string | undefined {
  const value = next?.trim();
  return value ? value : previous;
}

function maxNumber(previous: number, next: number): number {
  return Math.max(nonNegativeNumber(previous), nonNegativeNumber(next));
}

function maxOptionalNumber(
  previous: number | undefined,
  next: number | undefined,
): number | undefined {
  if (previous === undefined && next === undefined) return undefined;
  return Math.max(nonNegativeNumber(previous), nonNegativeNumber(next));
}

function nonNegativeNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Map a catalog protocol family onto the dialect the gateway can translate. */
export function toGatewayUpstreamProtocol(
  protocol: string | undefined,
): GatewayUpstreamProtocol | undefined {
  if (protocol === 'anthropic-messages') return 'anthropic-messages';
  if (protocol === 'openai-chat') return 'openai-chat';
  // Responses API is a distinct dialect: it has its own endpoint (/v1/responses)
  // and its own SSE event vocabulary, served by relays that may not expose
  // chat/completions at all.
  if (protocol === 'openai-responses') return 'openai-responses';
  return undefined;
}

/**
 * Whether a kernel needs the gateway: it only speaks dialects that the chosen
 * upstream does not. Same-dialect runs keep talking to the provider directly.
 *
 * `openai-chat` is intentionally strict: a kernel that only speaks the OpenAI
 * Responses dialect (Codex) cannot talk to a Chat-Completions upstream directly —
 * the Chat wire API was removed from Codex in 2026-02, so those runs must go
 * through the gateway for a responses→chat translation.
 */
export function kernelNeedsGateway(
  kernelProtocols: readonly string[],
  upstream: GatewayUpstreamProtocol,
): boolean {
  if (kernelProtocols.length === 0) return false;
  if (upstream === 'anthropic-messages') return !kernelProtocols.includes('anthropic-messages');
  if (upstream === 'openai-responses') return !kernelProtocols.includes('openai-responses');
  return !kernelProtocols.includes('openai-chat');
}
