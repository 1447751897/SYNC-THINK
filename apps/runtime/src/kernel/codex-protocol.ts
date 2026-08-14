/**
 * Codex exec JSONL wire protocol (verified against codex-cli 0.145.0 on
 * 2026-08-14). Codex exec emits items atomically (no partial/delta events).
 *
 * Spawn:
 *   codex --ask-for-approval <policy> exec --json -s <sandbox> -C <cwd>
 *         [--model <model>] [--skip-git-repo-check] "<prompt>"
 *
 * Events (stdout, one JSON object per line):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.started","item":{"id","type","command","status","..."}}
 *   {"type":"item.completed","item":{"id","type","text"|"command"|"aggregated_output","exit_code",...}}
 *   {"type":"turn.completed","usage":{"input_tokens","cached_input_tokens","cache_write_input_tokens","output_tokens","reasoning_output_tokens"}}
 *
 * Item types observed: agent_message, reasoning, command_execution, file_change,
 * mcp_tool_call, web_search, todo_list, approval_request. Unknown item types are
 * ignored + logged (mapping principle §4.1).
 *
 * Permission: exec JSON mode auto-executes commands (no event-level approval
 * bridge in 0.145.0), so the host maps the three tiers to the static
 * --ask-for-approval policy and keeps platform-tool approval on the host side.
 */

export interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
  output?: string;
  [key: string]: unknown;
}

export interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

export type CodexJsonEvent =
  | { type: 'thread.started'; thread_id?: string }
  | { type: 'turn.started' }
  | { type: 'item.started'; item?: CodexItem }
  | { type: 'item.completed'; item?: CodexItem }
  | { type: 'turn.completed'; usage?: CodexUsage }
  | { type: 'turn.failed'; error?: unknown }
  | { type: 'error'; message?: string; error?: unknown }
  | { type: string };

/** Parse one JSONL line; returns null for blank lines / unparseable JSON. */
export function parseCodexEvent(line: string): CodexJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // codex can print a plain-text warning line ("Reading additional input from
  // stdin...") before the JSON stream — treat non-JSON lines as ignorable.
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed) as CodexJsonEvent;
      if (value && typeof value === 'object' && typeof value.type === 'string') return value;
    } catch {
      return null;
    }
  }
  return null;
}

/** Buffer JSONL lines from a readable stream. */
export function createCodexLineBuffer(onLine: (line: string) => void): {
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

/**
 * Tool name for a codex `mcp_tool_call` / `web_search` item. Codex 0.145.0
 * reports `server` + `tool`; keeping them preserves the real MCP identity in
 * the host timeline instead of a generic "mcp_tool_call" row.
 */
export function codexToolCallName(item: CodexItem): string {
  if (item.type !== 'mcp_tool_call') return item.type ?? 'tool';
  const server = typeof item.server === 'string' ? item.server.trim() : '';
  const tool = typeof item.tool === 'string' ? item.tool.trim() : '';
  if (server && tool) return `mcp__${server}__${tool}`;
  if (tool) return tool;
  return 'mcp_tool_call';
}

/** Arguments JSON for a codex tool item (real `arguments` when reported). */
export function codexToolCallArgsJson(item: CodexItem): string {
  const raw = item.arguments ?? item.args ?? (item.type === 'web_search' ? item.query : undefined);
  if (raw === undefined || raw === null) return '{}';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '{}';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;
    return JSON.stringify(item.type === 'web_search' ? { query: trimmed } : { arguments: trimmed });
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return '{}';
  }
}

/** Host permission tier → codex --ask-for-approval policy (design doc §6.1). */
export function mapCodexApprovalPolicy(mode: 'full-access' | 'ask' | 'workspace'): string {
  switch (mode) {
    case 'full-access':
      return 'never';
    case 'ask':
      return 'on-request';
    case 'workspace':
      return 'untrusted';
  }
}

/** Host permission tier → codex sandbox mode. */
export function mapCodexSandbox(mode: 'full-access' | 'ask' | 'workspace'): string {
  switch (mode) {
    case 'full-access':
      return 'danger-full-access';
    case 'ask':
    case 'workspace':
      return 'workspace-write';
  }
}

/**
 * Extract a human-readable error message from a codex failure payload.
 *
 * Codex wraps API errors as JSON strings and nests them:
 *   {"type":"turn.failed","error":{"message":"{\"error\":{\"message\":\"...\"}}"}}
 * This unwraps both layers and falls back to the raw value.
 */
export function extractCodexErrorMessage(message: unknown): string | undefined {
  if (typeof message !== 'string') {
    if (message && typeof message === 'object') {
      const record = message as { message?: unknown; error?: unknown };
      if (record.message !== undefined) return extractCodexErrorMessage(record.message);
      if (record.error !== undefined) return extractCodexErrorMessage(record.error);
    }
    return undefined;
  }
  const trimmed = message.trim();
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed) as {
        error?: { message?: unknown } | unknown;
        message?: unknown;
      };
      if (value && typeof value === 'object') {
        const nested = (value as { error?: { message?: unknown } }).error as
          { message?: unknown } | undefined;
        if (nested && typeof nested.message === 'string') return nested.message;
        const direct = (value as { message?: unknown }).message;
        if (typeof direct === 'string') return direct;
      }
    } catch {
      // Not JSON — fall through to the raw string.
    }
  }
  return trimmed;
}
