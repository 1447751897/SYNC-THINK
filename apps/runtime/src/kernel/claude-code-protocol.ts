/**
 * Claude Code stream-json wire protocol (empirically verified against
 * claude 2.1.222 on 2026-08-14, cross-checked with @anthropic-ai/claude-agent-sdk 0.3.232).
 *
 * Spawn (no `-p` — the SDK does not pass it):
 *   claude --output-format stream-json --verbose --input-format stream-json
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

export interface ClaudeUserEvent {
  type: 'user';
  message: unknown;
  parent_tool_use_id?: string | null;
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
  error?: string;
}

export interface ClaudeSystemEvent {
  type: 'system';
  subtype: string;
}

export interface ClaudeKeepAliveEvent {
  type: 'keep_alive';
}

export type ClaudeStreamEvent =
  | ClaudeAssistantEvent
  | ClaudeUserEvent
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
