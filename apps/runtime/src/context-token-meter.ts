import { createHash } from 'node:crypto';
import type { ProviderMessage, ProviderToolSchema, ProviderUsage } from '@sync-think/adapters';
export interface MeterRequest {
  systemPrompt: string;
  messages: readonly ProviderMessage[];
  tools?: readonly ProviderToolSchema[];
}
export interface ContextUsageAnchor {
  bindingKey: string;
  fixedFingerprint: string;
  requestFingerprint: string;
  estimatedInputTokens: number;
  providerInputTokens: number;
}
export interface ContextMeasurement {
  source: 'estimate' | 'provider-calibrated';
  estimatedTokens: number;
  usedTokens: number;
  fixedInputTokens: number;
  messageTokens: number;
  providerInputTokens?: number;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixedFingerprint = (request: MeterRequest) =>
  hash([request.systemPrompt, request.tools ?? []]);
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

export function estimateJsonTokens(value: unknown): number {
  return estimateTextTokens(JSON.stringify(value));
}

export function estimateProviderMessageTokens(message: ProviderMessage): number {
  const metadataTokens = message.toolCallId ? estimateTextTokens(message.toolCallId) : 0;
  if (typeof message.content === 'string') {
    return estimateTextTokens(message.content) + 1 + metadataTokens;
  }
  let tokens = 1 + metadataTokens;
  for (const part of message.content) {
    if (part.type === 'image') {
      // Stable bounded estimate used by both the request snapshot and the ring.
      tokens += 1024;
    } else if (part.type === 'text' && part.text) {
      tokens += estimateTextTokens(part.text);
    } else {
      tokens += estimateJsonTokens(part);
    }
  }
  return tokens;
}

export function parseContextUsageAnchor(value: unknown): ContextUsageAnchor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const a = value as ContextUsageAnchor;
  if (
    typeof a.bindingKey !== 'string' ||
    !/^[a-f0-9]{64}$/.test(a.fixedFingerprint) ||
    !/^[a-f0-9]{64}$/.test(a.requestFingerprint) ||
    !Number.isSafeInteger(a.estimatedInputTokens) ||
    a.estimatedInputTokens <= 0 ||
    !Number.isSafeInteger(a.providerInputTokens) ||
    a.providerInputTokens <= 0
  )
    return undefined;
  return {
    bindingKey: a.bindingKey,
    fixedFingerprint: a.fixedFingerprint,
    requestFingerprint: a.requestFingerprint,
    estimatedInputTokens: a.estimatedInputTokens,
    providerInputTokens: a.providerInputTokens,
  };
}
/** tokensIn is normalized inclusive input by adapters. Cache hits are billing metadata, not extra context. */
export function createUsageAnchor(
  request: MeterRequest,
  bindingKey: string,
  usage: ProviderUsage,
): ContextUsageAnchor | undefined {
  if (!Number.isSafeInteger(usage.tokensIn) || usage.tokensIn <= 0) return undefined;
  const raw = measureContextRequest(request, bindingKey);
  if (raw.estimatedTokens <= 0) return undefined;
  return {
    bindingKey,
    fixedFingerprint: fixedFingerprint(request),
    requestFingerprint: hash(request),
    estimatedInputTokens: raw.estimatedTokens,
    providerInputTokens: usage.tokensIn,
  };
}
/** Same model/envelope only. History replacement/pruning uses a signed estimate delta, never cumulative billed tokens. */
export function measureContextRequest(
  request: MeterRequest,
  bindingKey: string,
  candidate?: ContextUsageAnchor,
): ContextMeasurement {
  const fixed =
    estimateTextTokens(request.systemPrompt) +
    (request.tools?.length ? estimateJsonTokens(request.tools) : 0);
  const history = request.messages.reduce((sum, m) => sum + estimateProviderMessageTokens(m), 0);
  const estimate = fixed + history;
  const anchor = parseContextUsageAnchor(candidate);
  const calibrated =
    !!anchor &&
    anchor.bindingKey === bindingKey &&
    anchor.fixedFingerprint === fixedFingerprint(request) &&
    anchor.providerInputTokens >= anchor.estimatedInputTokens;
  const used = calibrated
    ? Math.max(0, anchor!.providerInputTokens + estimate - anchor!.estimatedInputTokens)
    : estimate;
  // Category boundaries are estimates as well. Reconcile them to the calibrated total once, including fixed cost.
  const fixedInputTokens = estimate ? Math.min(used, Math.round((fixed * used) / estimate)) : 0;
  return {
    source: calibrated ? 'provider-calibrated' : 'estimate',
    estimatedTokens: estimate,
    usedTokens: used,
    fixedInputTokens,
    messageTokens: used - fixedInputTokens,
    ...(calibrated ? { providerInputTokens: anchor!.providerInputTokens } : {}),
  };
}
