import type { ErrorCode } from '@sync-think/shared';

// Workers are short-lived isolated processes per design §14. They receive a
// minimal capability token + scoped working directory, never unrelated
// credentials. They stream events to the Runtime. A crash fails only its
// own Step; partial artifacts are marked incomplete (§20 rule 8).

export type WorkerKind = 'file' | 'terminal' | 'git' | 'browser' | 'desktop' | 'media' | 'mcp';

export interface WorkerToken {
  /** Service-issued, scoped, single-use-friendly capability token. */
  token: string;
  /** Allowed working directory root. Paths outside are rejected. */
  allowedRoot: string;
  /** Hard timeout in milliseconds. */
  timeoutMs: number;
  /** Cancels work before spawn or terminates an already-running child process. */
  signal?: AbortSignal;
  /** Server-owned durable fence check invoked immediately before external start. */
  beforeStart?: () => boolean;
}

export interface WorkerStatus {
  state: 'idle' | 'running' | 'completed' | 'failed' | 'terminated';
  startedAt?: string;
  endedAt?: string;
  message?: string;
}

// Lifecycle on a stable interface. Concrete processes implement exec().
// Each concrete worker narrows its own WorkerJobInput and emits its output via
// the `completed` WorkerEvent carrying a WorkerJobOutput payload.
export interface Worker<JobInput extends WorkerJobInput> {
  readonly kind: WorkerKind;
  exec(input: JobInput, token: WorkerToken): AsyncIterable<WorkerEvent>;
  ping?(): Promise<WorkerStatus>;
}

export interface WorkerJobInput {
  /** Canonicalized and verified-against-allowedRoot before any FS access. */
  workingDir: string;
}

export interface WorkerJobOutput {
  ok: boolean;
  message: string;
}

export type WorkerEvent =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'progress'; fraction: number; message?: string }
  | { type: 'artifact'; artifactRef: string; status: 'candidate' | 'incomplete' | 'rejected' }
  | { type: 'must-approve'; summary: string; permissions: string[] }
  | { type: 'completed'; output: WorkerJobOutput }
  | { type: 'failed'; failureClass: 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown'; error: AppErrorLite };

export interface AppErrorLite {
  code: ErrorCode | string;
  message: string;
}

// Canonicalize a path and confirm it lies strictly under allowedRoot (§19 / §13).
export function isPathInside(candidate: string, allowedRoot: string): boolean {
  const norm = (p: string) => p.split(/[\\/]+/).filter(Boolean).join('/');
  const a = norm(allowedRoot);
  const b = norm(candidate);
  if (!b.startsWith(a + '/')) return false;
  // Block traversal: ensure no '..' segment escapes the root normal-form.
  const segs = b.slice(a.length + 1).split('/');
  for (const s of segs) {
    if (s === '..') return false;
  }
  return true;
}
