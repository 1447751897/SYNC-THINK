/**
 * MCP process policy helpers (§9.3 / §14).
 *
 * Design rules:
 * - MCP process output is size-limited, timed out, audited, and treated as untrusted content.
 * - Register remains metadata-only; these helpers enforce policy on (simulated or real) output.
 * - Real process spawn is not required here — FakeMcpWorker uses the same pure functions.
 */

export interface McpProcessPolicy {
  /** Hard cap on process/tool stdout+stderr retained bytes. */
  maxOutputBytes: number;
  /** Hard timeout for a single tool invocation. */
  timeoutMs: number;
  /** Explicit trust flag; default false → contentTrust untrusted. */
  trusted: boolean;
}

export interface McpAuditRecord {
  at: string;
  mcpServerId?: string;
  toolName?: string;
  transport?: string;
  trusted: boolean;
  contentTrust: "trusted" | "untrusted";
  maxOutputBytes: number;
  timeoutMs: number;
  rawBytes: number;
  keptBytes: number;
  truncated: boolean;
  timedOut: boolean;
  note: string;
}

export interface McpOutputEnforcementResult {
  rawBytes: number;
  keptBytes: number;
  truncated: boolean;
  text: string;
  contentTrust: "trusted" | "untrusted";
  audit: McpAuditRecord;
}

export interface McpTimeoutCheck {
  timedOut: boolean;
  elapsedMs: number;
  timeoutMs: number;
}

export const DEFAULT_MCP_MAX_OUTPUT_BYTES = 65_536;
export const DEFAULT_MCP_TIMEOUT_MS = 15_000;
/** Absolute clamps so misconfigured UI cannot set absurd limits. */
export const MCP_MAX_OUTPUT_BYTES_FLOOR = 256;
export const MCP_MAX_OUTPUT_BYTES_CEILING = 1_048_576;
export const MCP_TIMEOUT_MS_FLOOR = 100;
export const MCP_TIMEOUT_MS_CEILING = 120_000;

export function normalizeMcpProcessPolicy(
  input?: Partial<McpProcessPolicy> | null,
): McpProcessPolicy {
  const maxOutputBytes = clampInt(
    input?.maxOutputBytes ?? DEFAULT_MCP_MAX_OUTPUT_BYTES,
    MCP_MAX_OUTPUT_BYTES_FLOOR,
    MCP_MAX_OUTPUT_BYTES_CEILING,
  );
  const timeoutMs = clampInt(
    input?.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
    MCP_TIMEOUT_MS_FLOOR,
    MCP_TIMEOUT_MS_CEILING,
  );
  return {
    maxOutputBytes,
    timeoutMs,
    trusted: Boolean(input?.trusted),
  };
}

export function mcpContentTrust(trusted: boolean): "trusted" | "untrusted" {
  return trusted ? "trusted" : "untrusted";
}

export function checkMcpTimeout(
  elapsedMs: number,
  timeoutMs: number,
): McpTimeoutCheck {
  const limit = clampInt(timeoutMs, MCP_TIMEOUT_MS_FLOOR, MCP_TIMEOUT_MS_CEILING);
  const elapsed = Math.max(0, Math.floor(Number(elapsedMs) || 0));
  return {
    timedOut: elapsed > limit,
    elapsedMs: elapsed,
    timeoutMs: limit,
  };
}

/**
 * Size-limit MCP process output. Prefers UTF-8 safe byte truncation.
 * Always tags contentTrust from the server trust flag (default untrusted).
 */
export function enforceMcpOutputLimit(
  raw: string,
  policy: McpProcessPolicy,
  meta?: {
    mcpServerId?: string;
    toolName?: string;
    transport?: string;
    timedOut?: boolean;
    now?: string;
  },
): McpOutputEnforcementResult {
  const normalized = normalizeMcpProcessPolicy(policy);
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const rawBytes = byteLengthUtf8(text);
  const { kept, truncated } = truncateUtf8ToBytes(text, normalized.maxOutputBytes);
  const contentTrust = mcpContentTrust(normalized.trusted);
  const timedOut = Boolean(meta?.timedOut);
  const at = meta?.now ?? new Date().toISOString();
  const noteParts = [
    contentTrust === "untrusted" ? "content marked untrusted" : "content marked trusted",
    truncated
      ? "truncated " + rawBytes + "→" + byteLengthUtf8(kept) + "B"
      : "within " + normalized.maxOutputBytes + "B",
    timedOut ? "timed out @ " + normalized.timeoutMs + "ms" : null,
  ].filter(Boolean);
  const audit: McpAuditRecord = {
    at,
    mcpServerId: meta?.mcpServerId,
    toolName: meta?.toolName,
    transport: meta?.transport,
    trusted: normalized.trusted,
    contentTrust,
    maxOutputBytes: normalized.maxOutputBytes,
    timeoutMs: normalized.timeoutMs,
    rawBytes,
    keptBytes: byteLengthUtf8(kept),
    truncated,
    timedOut,
    note: noteParts.join(" · "),
  };
  return {
    rawBytes,
    keptBytes: audit.keptBytes,
    truncated,
    text: kept,
    contentTrust,
    audit,
  };
}

/** Short, secret-scrubbed preview for UI / diagnostics (never full payload). */
export function previewMcpOutput(text: string, maxChars = 160): string {
  const scrubbed = String(text ?? "")
    .replace(/sk-[a-zA-Z0-9]{10,}/g, "[redacted]")
    .replace(/(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (scrubbed.length <= maxChars) return scrubbed;
  return scrubbed.slice(0, Math.max(0, maxChars - 1)) + "…";
}

export function formatMcpPolicyLabel(policy: McpProcessPolicy): string {
  const p = normalizeMcpProcessPolicy(policy);
  const kb =
    p.maxOutputBytes >= 1024
      ? Math.round(p.maxOutputBytes / 1024) + "KB"
      : p.maxOutputBytes + "B";
  const sec =
    p.timeoutMs >= 1000
      ? (p.timeoutMs / 1000).toFixed(p.timeoutMs % 1000 === 0 ? 0 : 1) + "s"
      : p.timeoutMs + "ms";
  return sec + " · " + kb + " · " + (p.trusted ? "trusted" : "untrusted");
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateUtf8ToBytes(text: string, maxBytes: number): { kept: string; truncated: boolean } {
  if (maxBytes <= 0) return { kept: "", truncated: text.length > 0 };
  const rawBytes = byteLengthUtf8(text);
  if (rawBytes <= maxBytes) return { kept: text, truncated: false };
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const slice = text.slice(0, mid);
    if (byteLengthUtf8(slice) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  let kept = text.slice(0, low);
  while (kept.length > 0 && byteLengthUtf8(kept) > maxBytes) {
    kept = kept.slice(0, -1);
  }
  return { kept, truncated: true };
}
