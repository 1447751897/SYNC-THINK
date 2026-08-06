/**
 * Map Compose / product reasoningEffort into provider request fields.
 * Keep this best-effort: unknown gateways ignore unsupported keys.
 */

export type ReasoningEffortLevel =
  | 'auto'
  | 'off'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | string;

export function normalizeReasoningEffort(
  value: string | undefined | null,
): ReasoningEffortLevel | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  return trimmed;
}

/** True when adapters should omit thinking/reasoning request fields. */
export function shouldOmitReasoningEffort(value: string | undefined | null): boolean {
  const level = normalizeReasoningEffort(value);
  return !level || level === 'off' || level === 'none' || level === 'disabled';
}

/**
 * Map a product effort level to the value accepted on the wire.
 * OpenAI-compatible APIs only accept low|medium|high for reasoning_effort
 * (and Responses `reasoning.effort`); 'auto' / 'xhigh' / 'max' are product
 * concepts and must be collapsed before sending, otherwise strict gateways
 * (OpenAI, many relays) reject the request with 400.
 */
export function wireReasoningEffort(level: string): string {
  if (level === 'auto' || level === 'xhigh' || level === 'max') return 'high';
  return level;
}

/**
 * OpenAI-compatible chat/completions extras used by many gateways:
 * - reasoning_effort: low|medium|high|…
 * - enable_thinking / thinking: boolean for Claude-like proxies
 *
 * 'auto' means "product decides": send a sensible default effort so models
 * that support thinking actually produce a reasoning trace. Gateways that
 * don't support the keys ignore them.
 */
export function openAiReasoningBodyFields(
  value: string | undefined | null,
): Record<string, unknown> {
  const level = normalizeReasoningEffort(value);
  if (!level) return {};
  if (level === 'off') return { enable_thinking: false };
  if (shouldOmitReasoningEffort(level)) return {};
  return {
    reasoning_effort: wireReasoningEffort(level),
    enable_thinking: true,
  };
}

/**
 * Anthropic Messages extras (native + common proxies):
 * - thinking: { type: 'enabled', budget_tokens }
 * budget scales with effort; gateways may ignore unknown shape.
 */
export function anthropicReasoningBodyFields(
  value: string | undefined | null,
): Record<string, unknown> {
  const level = normalizeReasoningEffort(value);
  if (!level || shouldOmitReasoningEffort(level)) return {};
  const budget =
    level === 'low'
      ? 2_048
      : level === 'medium'
        ? 8_192
        : level === 'high'
          ? 16_384
          : level === 'xhigh' || level === 'max'
            ? 32_768
            : 8_192;
  return {
    thinking: {
      type: 'enabled',
      budget_tokens: budget,
    },
  };
}
