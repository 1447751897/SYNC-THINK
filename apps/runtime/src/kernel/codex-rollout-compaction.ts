/**
 * Codex rollout compaction watcher.
 *
 * `codex exec --json` stdout does NOT emit compaction events: the exec JSON
 * serializer drops `ThreadItem::ContextCompaction` (only the human output mode
 * prints "context compacted"). The authoritative signal lives in codex's own
 * session persistence — the rollout JSONL file
 *   `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<session_id>.jsonl`
 * where auto-compaction writes a top-level `{"type":"compacted", ...}` line
 * (some builds also emit `event_msg.context_compacted`).
 *
 * The adapter knows the codex thread/session id from `thread.started` and
 * tails that rollout file for `compacted` lines, mapping each to a
 * `{ type: 'compacted' }` KernelEvent so the host can surface a "kernel
 * compacted its context" notice (§2.3 ②).
 *
 * The watcher is intentionally tolerant: missing homes/files/JSON parse
 * failures are ignored — compaction notices are advisory, never fatal.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface RolloutCompactionWatcherOptions {
  /** `$CODEX_HOME` directory (defaults to `~/.codex`). */
  codexHome?: string;
  /** Codex thread id (= session id), from `thread.started.thread_id`. */
  sessionId: string;
  /** Invoked once per observed compaction. */
  onCompacted: () => void;
  /** Poll interval (default 400ms). */
  pollIntervalMs?: number;
  /** Stop polling after this many ms with no match (default 60s per turn). */
  maxLifetimeMs?: number;
}

export interface RolloutCompactionWatcher {
  stop(): void;
}

/** True when the rollout line is a compaction signal. */
export function isRolloutCompactionLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const value = JSON.parse(trimmed) as {
      type?: string;
      payload?: { type?: string };
    };
    if (value?.type === 'compacted') return true;
    if (value?.type === 'event_msg' && value.payload?.type === 'context_compacted') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Recursively find the newest rollout file whose name ends with
 * `-<session_id>.jsonl` under `$CODEX_HOME/sessions/`.
 */
export function findCodexRolloutFile(codexHome: string, sessionId: string): string | null {
  const sessionsRoot = join(codexHome, 'sessions');
  if (!existsSync(sessionsRoot)) return null;

  let newest: { path: string; mtimeMs: number } | null = null;
  const stack = [sessionsRoot];
  const suffix = `-${sessionId}.jsonl`;

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.name.endsWith(suffix)) {
          const mtimeMs = statSync(full).mtimeMs;
          if (!newest || mtimeMs > newest.mtimeMs) {
            newest = { path: full, mtimeMs };
          }
        }
      } catch {
        // stat raced a codex write — skip.
      }
    }
  }
  return newest?.path ?? null;
}

export function createCodexRolloutCompactionWatcher(
  options: RolloutCompactionWatcherOptions,
): RolloutCompactionWatcher {
  const codexHome = options.codexHome ?? join(homedir(), '.codex');
  const pollIntervalMs = options.pollIntervalMs ?? 400;
  const maxLifetimeMs = options.maxLifetimeMs ?? 90_000;

  let offset = 0;
  let file: string | null = null;
  let stopped = false;
  let fired = false;

  const scanOnce = (): void => {
    if (stopped || fired) return;
    if (!file) {
      file = findCodexRolloutFile(codexHome, options.sessionId);
      if (!file) return;
      offset = 0;
    }
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size < offset) offset = 0; // file rotated / rewritten
    if (size === offset) return;
    let chunk: Buffer;
    try {
      chunk = readFileSync(file);
    } catch {
      return;
    }
    const content = chunk.toString('utf8', offset, Math.min(size, chunk.length));
    offset = Math.min(size, chunk.length);
    for (const line of content.split('\n')) {
      if (isRolloutCompactionLine(line)) {
        fired = true;
        options.onCompacted();
        return;
      }
    }
  };

  scanOnce();
  const timer = setInterval(scanOnce, pollIntervalMs);
  const lifetime = setTimeout(() => stop(), maxLifetimeMs);
  lifetime.unref?.();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(lifetime);
  }

  return { stop };
}
