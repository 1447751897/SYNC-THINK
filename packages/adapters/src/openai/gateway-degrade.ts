/**
 * Shared gateway-compat degrade helpers (audit #13): some relays reject
 * optional compatibility parameters with HTTP 400 "Unsupported parameter(s)".
 * Both openai-chat and openai-responses streams degrade once by dropping the
 * rejected optional fields and retrying, so older gateways still stream.
 */

/** Backtick-quoted parameter names from `Unsupported parameter(s): `a`, `b``. */
export function extractUnsupportedParameterNames(snippet: string): string[] | undefined {
  const match = /Unsupported parameter\(s\):\s*([^"]+)/i.exec(snippet);
  if (!match) return undefined;
  const names = match[1]!.match(/`([^`]+)`/g)?.map((name) => name.replace(/`/g, '')) ?? [];
  return names.length > 0 ? names : undefined;
}

/** chat-completions body fields safe to drop for older gateways. */
export const CHAT_DEGRADABLE_PARAMETERS: ReadonlySet<string> = new Set([
  'enable_thinking',
  'prompt_cache_key',
  'prompt_cache_options',
  'prompt_cache_retention',
  'stream_options',
]);

/** responses-api body fields safe to drop for older gateways. */
export const RESPONSES_DEGRADABLE_PARAMETERS: ReadonlySet<string> = new Set([
  'instructions',
  'reasoning',
  'max_output_tokens',
  'temperature',
  'prompt_cache_key',
  'prompt_cache_options',
  'prompt_cache_retention',
]);

/** Parameters named by the gateway that are present in the body and degradable. */
export function pickDegradableParameters(
  snippet: string,
  body: Record<string, unknown>,
  degradable: ReadonlySet<string>,
): string[] {
  const unsupported = extractUnsupportedParameterNames(snippet) ?? [];
  return unsupported.filter(
    (parameter) => degradable.has(parameter) && body[parameter] !== undefined,
  );
}

/** Clone the body without the rejected optional parameters. */
export function degradeRequestBody(
  body: Record<string, unknown>,
  parameters: readonly string[],
): Record<string, unknown> {
  const degraded = { ...body };
  for (const parameter of parameters) delete degraded[parameter];
  return degraded;
}
