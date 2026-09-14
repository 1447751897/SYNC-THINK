import type {
  RuntimeConnectFailure,
  RuntimeConnectOutcome,
  RuntimeConnectResult,
} from '../runtime-bridge-contract.js';

const DEFAULT_RETRY_DELAYS_MS = [250, 500, 1_000] as const;

export interface RuntimeRetryScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface RuntimeConnectionOptions {
  connect: () => Promise<RuntimeConnectOutcome>;
  onConnected: (result: RuntimeConnectResult) => void;
  onFailed: (error: RuntimeConnectFailure) => void;
  onRetrying?: (status: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    error: RuntimeConnectFailure;
  }) => void;
  retryDelaysMs?: readonly number[];
  scheduler?: RuntimeRetryScheduler;
}

const defaultScheduler: RuntimeRetryScheduler = {
  schedule: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  cancel: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Cold-start IPC often times out once; retry immediately, then once more. */
export const TRANSIENT_RUNTIME_RETRY_DELAYS_MS = [0, 800] as const;

export function isTransientRuntimeError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /timed out|not connected|ECONNRESET|EPIPE|EADDRINUSE/i.test(text);
}

export async function retryTransientRuntime<T>(
  run: () => Promise<T>,
  options?: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const delaysMs = options?.delaysMs ?? TRANSIENT_RUNTIME_RETRY_DELAYS_MS;
  const sleep =
    options?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!isTransientRuntimeError(error) || attempt === delaysMs.length) throw error;
      const delayMs = delaysMs[attempt];
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastError;
}

export function startRuntimeConnection(options: RuntimeConnectionOptions): () => void {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const scheduler = options.scheduler ?? defaultScheduler;
  let active = true;
  let retryIndex = 0;
  let retryTimer: unknown = null;

  const connect = async (): Promise<void> => {
    let outcome: RuntimeConnectOutcome;
    try {
      outcome = await options.connect();
    } catch {
      outcome = {
        ok: false,
        error: { code: 'desktop.bridge-error', retryable: false },
      };
    }
    if (!active) return;
    if (outcome.ok) {
      options.onConnected(outcome.result);
      return;
    }
    if (!outcome.error.retryable || retryIndex >= retryDelaysMs.length) {
      options.onFailed(outcome.error);
      return;
    }
    const delayMs = retryDelaysMs[retryIndex];
    options.onRetrying?.({
      attempt: retryIndex + 1,
      maxAttempts: retryDelaysMs.length + 1,
      delayMs,
      error: outcome.error,
    });
    retryIndex += 1;
    retryTimer = scheduler.schedule(() => {
      retryTimer = null;
      if (!active) return;
      void connect();
    }, delayMs);
  };

  void connect();
  return () => {
    if (!active) return;
    active = false;
    if (retryTimer !== null) scheduler.cancel(retryTimer);
    retryTimer = null;
  };
}
