/**
 * Claude Code stream-json wire protocol (empirically verified against
 * claude 2.1.178 and 2.1.222 on 2026-08-14, cross-checked with
 * @anthropic-ai/claude-agent-sdk 0.3.232).
 *
 * Spawn:
 *   claude --print --output-format stream-json --verbose --input-format stream-json
 *          --permission-prompt-tool stdio [--model <model>] [--permission-mode <mode>]
 *
 * Host → kernel (stdin, one JSON object per line):
 *   {type:"control_request", request_id, request:{subtype:"initialize", systemPrompt?, appendSystemPrompt?, ...}}
 *   {type:"user", session_id, message:{role:"user", content:[{type:"text", text}]}, parent_tool_use_id:null}
 *   {type:"control_response", response:{subtype:"success", request_id, response:{behavior:"allow"|"deny", updatedInput?, message?}}}
 *
 * Kernel → host (stdout, one JSON object per line):
 *   control_response   initialize ack / errors
 *   system             {type:"system", subtype:"init"|"session_state_changed"|...}
 *   assistant          {type:"assistant", message:{id, model, role, content:[text|tool_use|thinking], usage:{...}}}
 *   user               echoed user messages (tool results carry parent_tool_use_id)
 *   control_request    permission requests: {request:{subtype:"can_use_tool", tool_name, input, tool_use_id, ...}}
 *   result             {type:"result", subtype:"success"|"error"} — turn completion
 *   keep_alive         heartbeat
 *
 * Mapping principle (design doc §4.1): unknown event types are ignored + logged,
 * never fatal.
 */
import type { KernelPermissionRequest } from '@sync-think/shared';

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  /** tool_result blocks (echoed on top-level `user` events). */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface ClaudeAssistantEvent {
  type: 'assistant';
  message: {
    id?: string;
    model?: string;
    role: 'assistant';
    content: ClaudeContentBlock[];
    stop_reason?: string | null;
    usage?: ClaudeUsage;
  };
}

/**
 * Echoed user message. Tool results arrive here as
 * `message.content[] = {type:'tool_result', tool_use_id, content:[{type:'text',text}], is_error?}`
 * (verified in a real claude 2.1.222 MCP session on 2026-08-14).
 */
export interface ClaudeUserEvent {
  type: 'user';
  message?: { role?: string; content?: ClaudeContentBlock[] | string };
  parent_tool_use_id?: string | null;
}

/** Normalized tool result extracted from a top-level `user` event. */
export interface ClaudeToolResult {
  toolId: string;
  output: string;
  isError: boolean;
}

/** Flatten `tool_result` blocks from an echoed user message. */
export function extractClaudeToolResults(event: ClaudeUserEvent): ClaudeToolResult[] {
  const content = event.message?.content;
  if (!Array.isArray(content)) return [];
  const results: ClaudeToolResult[] = [];
  for (const block of content) {
    if (block?.type !== 'tool_result' || !block.tool_use_id) continue;
    results.push({
      toolId: block.tool_use_id,
      output: flattenClaudeToolResultContent(block.content),
      isError: block.is_error === true,
    });
  }
  return results;
}

function flattenClaudeToolResultContent(content: unknown): string {
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

/**
 * Partial assistant stream (only present with `--include-partial-messages`,
 * verified working in our stdin stream-json mode on claude 2.1.222):
 *   content_block_start  {content_block:{type:'text'|'thinking'|'tool_use',...}, index}
 *   content_block_delta  {delta:{type:'text_delta',text} | {type:'thinking_delta',thinking}
 *                          | {type:'input_json_delta',partial_json} | {type:'signature_delta',...}}
 *   content_block_stop / message_start / message_delta / message_stop
 */
export interface ClaudeStreamEventEnvelope {
  type: 'stream_event';
  event?: {
    type?: string;
    index?: number;
    content_block?: ClaudeContentBlock;
    delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
  };
}

export interface ClaudeControlRequestEvent {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: string;
    tool_name?: string;
    input?: unknown;
    tool_use_id?: string;
    message?: unknown;
  };
}

export interface ClaudeControlResponseEvent {
  type: 'control_response';
  response: {
    subtype: string;
    request_id: string;
    error?: string;
    response?: unknown;
  };
}

export interface ClaudeResultEvent {
  type: 'result';
  subtype: string;
  is_error?: boolean;
  error?: unknown;
  errors?: unknown;
  message?: unknown;
  result?: unknown;
}

export interface ClaudeSystemEvent {
  type: 'system';
  subtype: string;
  session_id?: string;
  error_status?: number;
  error?: string;
}

export interface ClaudeKeepAliveEvent {
  type: 'keep_alive';
}

export type ClaudeStreamEvent =
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeStreamEventEnvelope
  | ClaudeControlRequestEvent
  | ClaudeControlResponseEvent
  | ClaudeResultEvent
  | ClaudeSystemEvent
  | ClaudeKeepAliveEvent
  | { type: string };

/** Parse one stream-json line. Returns null for blank lines / unparseable JSON. */
export function parseClaudeStreamEvent(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as ClaudeStreamEvent;
    if (!value || typeof value !== 'object' || typeof value.type !== 'string') return null;
    return value;
  } catch {
    return null;
  }
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

/** Extract a readable error from Claude's nested or JSON-wrapped result payloads. */
export function extractClaudeErrorMessage(value: unknown): string | undefined {
  return extractClaudeErrorMessageInner(value, 0, new Set<object>());
}

function extractClaudeErrorMessageInner(
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
        return extractClaudeErrorMessageInner(JSON.parse(trimmed), depth + 1, seen) ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractClaudeErrorMessageInner(entry, depth + 1, seen);
      if (nested) return nested;
    }
    return undefined;
  }
  if (typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of CLAUDE_ERROR_KEYS) {
    if (!(key in record)) continue;
    const nested = extractClaudeErrorMessageInner(record[key], depth + 1, seen);
    if (nested) return nested;
  }
  return undefined;
}

/** Buffer JSON-lines from a readable stream into complete lines. */
export function createClaudeLineBuffer(onLine: (line: string) => void): {
  push(chunk: string): void;
  end(): void;
} {
  let pending = '';
  return {
    push(chunk: string): void {
      pending += chunk;
      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        onLine(line);
        newlineIndex = pending.indexOf('\n');
      }
    },
    end(): void {
      if (pending.trim()) onLine(pending);
      pending = '';
    },
  };
}

/** Extract a host-side permission request from a claude control_request event. */
export function toKernelPermissionRequest(
  event: ClaudeControlRequestEvent,
): KernelPermissionRequest | null {
  if (event.request.subtype !== 'can_use_tool' && event.request.subtype !== 'request_user_dialog') {
    return null;
  }
  const toolName =
    event.request.tool_name ??
    (event.request.subtype === 'request_user_dialog' ? 'user_dialog' : 'unknown');
  return {
    requestId: event.request_id,
    toolName,
    toolInput: event.request.input ?? {},
    reason: event.request.subtype,
  };
}

/** Build the stdin user-message line (SDK shape, verified working). */
export function buildClaudeUserMessage(text: string, sessionId?: string): string {
  return JSON.stringify({
    type: 'user',
    session_id: sessionId ?? '',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
    parent_tool_use_id: null,
  });
}

/** Build the initialize control_request line. */
export function buildClaudeInitializeRequest(
  requestId: string,
  options?: {
    systemPrompt?: string;
    appendSystemPrompt?: string;
    permissionMode?: string;
  },
): string {
  return JSON.stringify({
    type: 'control_request',
    request_id: requestId,
    request: {
      subtype: 'initialize',
      ...(options?.systemPrompt ? { systemPrompt: [options.systemPrompt] } : {}),
      ...(options?.appendSystemPrompt ? { appendSystemPrompt: options.appendSystemPrompt } : {}),
      ...(options?.permissionMode ? { permissionMode: options.permissionMode } : {}),
    },
  });
}

/** Build a permission decision control_response line. */
export function buildClaudePermissionResponse(
  requestId: string,
  decision: { allow: boolean; updatedInput?: unknown; message?: string },
): string {
  return JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: decision.allow
        ? {
            behavior: 'allow',
            ...(decision.updatedInput !== undefined ? { updatedInput: decision.updatedInput } : {}),
          }
        : {
            behavior: 'deny',
            ...(decision.message !== undefined ? { message: decision.message } : {}),
          },
    },
  });
}

/** Build an interrupt control_request line (pause semantics = stop current turn). */
export function buildClaudeInterruptRequest(requestId: string): string {
  return JSON.stringify({
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'interrupt' },
  });
}
