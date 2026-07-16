import { isAbsolute, relative, resolve, win32 } from 'node:path';
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
  /** Maximum combined stdout/stderr or returned text retained in memory. */
  maxOutputBytes?: number;
  /** Exact executable names or paths that a terminal capability may spawn. */
  allowedCommands?: readonly string[];
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
  [key: string]: unknown;
}

export type WorkerEvent =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'progress'; fraction: number; message?: string }
  | { type: 'artifact'; artifactRef: string; status: 'candidate' | 'incomplete' | 'rejected' }
  | { type: 'must-approve'; summary: string; permissions: string[] }
  | { type: 'completed'; output: WorkerJobOutput }
  | {
      type: 'failed';
      failureClass: 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';
      error: AppErrorLite;
    };

export interface AppErrorLite {
  code: ErrorCode | string;
  message: string;
}

// Canonicalize a path and confirm it equals or lies under allowedRoot (§19 / §13).
export function isPathInside(candidate: string, allowedRoot: string): boolean {
  if (typeof candidate !== 'string' || typeof allowedRoot !== 'string') return false;
  const useWindowsPath = /^[A-Za-z]:[\\/]/.test(candidate) || /^[A-Za-z]:[\\/]/.test(allowedRoot);
  const pathApi = useWindowsPath ? win32 : { isAbsolute, relative, resolve };
  if (!pathApi.isAbsolute(candidate) || !pathApi.isAbsolute(allowedRoot)) return false;
  const scoped = pathApi.relative(pathApi.resolve(allowedRoot), pathApi.resolve(candidate));
  return (
    scoped === '' ||
    (!scoped.startsWith(`..${useWindowsPath ? '\\' : '/'}`) &&
      scoped !== '..' &&
      !pathApi.isAbsolute(scoped))
  );
}
