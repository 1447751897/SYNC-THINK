/**
 * Claude Agent SDK ↔ KernelEvent mapping (pure functions).
 *
 * Replaces the hand-rolled stream-json wire parsing in claude-code-protocol.ts:
 * the SDK hands us typed `SDKMessage` objects, so there is no line buffering,
 * no JSON.parse of kernel stdout and no stdin frame construction left. What
 * remains here is the part the SDK cannot do for us — translating Anthropic's
 * vocabulary into the host's kernel-agnostic one.
 *
 * Verified against @anthropic-ai/claude-agent-sdk 0.3.238 (sdk.d.ts):
 *   SDKMessage = SDKAssistantMessage | SDKUserMessage | SDKUserMessageReplay
 *              | SDKResultMessage | SDKSystemMessage | SDKPartialAssistantMessage
 *              | SDKCompactBoundaryMessage | ... (38 members, grows over time)
 *
 * Mapping principle (design doc §4.1): unknown message types are ignored +
 * logged, never fatal.
 */
import type { KernelPermissionRequest } from '@sync-think/shared';

/**
 * Structural view of an Anthropic content block.
 *
 * The SDK types these as `BetaContentBlock` from @anthropic-ai/sdk, a peer
 * dependency this package deliberately does not take. Vendor types must not
 * spread into the host's unified layer, so the adapter narrows through this
 * local shape instead — the field names are wire-stable across the Messages
 * API and are what the mapping actually reads.
 */
export interface ClaudeSdkContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  /** tool_result blocks (carried on `user` messages). */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface ClaudeSdkUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Normalized tool result extracted from an SDK `user` message. */
export interface ClaudeSdkToolResult {
  toolId: string;
  output: string;
  isError: boolean;
}

/**
 * Flatten `tool_result` blocks from an SDK user message.
 *
 * `message.content` is `string | BetaContentBlockParam[]`; only the array form
 * can carry tool results.
 */
export function extractSdkToolResults(message: {
  content?: unknown;
}): ClaudeSdkToolResult[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const results: ClaudeSdkToolResult[] = [];
  for (const entry of content) {
    const block = entry as ClaudeSdkContentBlock | null;
    if (block?.type !== 'tool_result' || !block.tool_use_id) continue;
    results.push({
      toolId: block.tool_use_id,
      output: flattenSdkToolResultContent(block.content),
      isError: block.is_error === true,
    });
  }
  return results;
}

export function flattenSdkToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    const block = entry as { type?: string; text?: string };
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (entry != null) parts.push(JSON.stringify(entry));
  }
  return parts.join('\n');
}

const CLAUDE_ERROR_KEYS = [
  'error',
  'message',
  'result',
  'errors',
  'detail',
  'details',
  'cause',
] as const;

/**
 * Extract a readable error from Claude's nested or JSON-wrapped result payloads.
 *
 * `SDKResultError.errors` is `string[]`, but gateway failures routinely arrive
 * as a JSON string nested several levels deep inside `result`, so the walk is
 * kept from the CLI era (it is the only thing that surfaces a usable message
 * for provider-side errors).
 */
export function extractSdkErrorMessage(value: unknown): string | undefined {
  return extractSdkErrorMessageInner(value, 0, new Set<object>());
}

function extractSdkErrorMessageInner(
  value: unknown,
  depth: number,
  seen: Set<object>,
): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return extractSdkErrorMessageInner(JSON.parse(trimmed), depth + 1, seen) ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractSdkErrorMessageInner(entry, depth + 1, seen);
      if (nested) return nested;
    }
    return undefined;
  }
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of CLAUDE_ERROR_KEYS) {
    if (!(key in record)) continue;
    const nested = extractSdkErrorMessageInner(record[key], depth + 1, seen);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Resolve the base URL handed to Claude as `ANTHROPIC_BASE_URL`.
 *
 * Claude composes `{ANTHROPIC_BASE_URL}/v1/messages` itself, so a provider base
 * URL that already ends in `/v1` (OpenAI-style roots, e.g.
 * `https://api.deepseek.com/v1`) must be stripped first, or the request doubles
 * the path and the endpoint answers 404/410 — which surfaces to the user as a
 * broken model selection.
 *
 * DeepSeek additionally serves its Anthropic-compatible API under the
 * `/anthropic` prefix (verified with a real key: `…/anthropic/v1/messages`
 * answers, `…/v1/messages` does not), so its stripped root gets that suffix.
 *
 * This is transport-independent provider behavior, so it survives the CLI →
 * SDK migration unchanged.
 */
export function stripAnthropicV1Suffix(baseUrl: string): string {
  const stripped = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');
  if (/^https?:\/\/api\.deepseek\.com$/i.test(stripped)) return `${stripped}/anthropic`;
  return stripped;
}

/**
 * Build the host-side permission request from a `canUseTool` invocation.
 *
 * The SDK supplies richer prompt material than the CLI control_request ever
 * did (`title` / `description` are pre-rendered by the bridge); `reason` keeps
 * the host's existing vocabulary so downstream approval cards are unchanged.
 */
export function toSdkPermissionRequest(params: {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  decisionReason?: string;
}): KernelPermissionRequest {
  return {
    requestId: params.requestId,
    toolName: params.toolName,
    toolInput: params.input ?? {},
    reason: params.decisionReason ?? 'can_use_tool',
  };
}
