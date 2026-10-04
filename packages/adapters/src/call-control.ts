import type { AdapterEvent } from './types.js';

/** No default total deadline: only an outstanding provider read can go idle. */
export const DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS = 300_000;

export interface ProviderCallControl {
  signal: AbortSignal;
  externalSignal: AbortSignal;
  timedOut(): boolean;
  waitFor<T>(operation: () => Promise<T>): Promise<T>;
  cleanup(): void;
}

export function createProviderCallControl(
  externalSignal: AbortSignal,
  timeoutMs?: number | null,
  streamIdleTimeoutMs: number | null = DEFAULT_PROVIDER_STREAM_IDLE_TIMEOUT_MS,
): ProviderCallControl {
  const controller = new AbortController();
  let didTimeout = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal.aborted) onExternalAbort();
  else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  const startTimer = (ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      didTimeout = true;
      controller.abort(new Error('provider.timeout'));
    }, ms);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    timers.add(timer);
    return timer;
  };
  // An explicit total deadline remains supported for callers that need one.
  if (timeoutMs != null && !controller.signal.aborted) startTimer(timeoutMs);
  const abortError = () => new DOMException(
    didTimeout ? 'Provider stream idle timeout' : 'Provider call aborted', 'AbortError',
  );
  return {
    signal: controller.signal,
    externalSignal,
    timedOut: () => didTimeout,
    async waitFor<T>(operation: () => Promise<T>): Promise<T> {
      if (controller.signal.aborted) throw abortError();
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError());
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      // Each completed read (including SSE comments/heartbeats) gets a fresh
      // idle budget. No idle clock runs while the consumer handles its output.
      const idleTimer = streamIdleTimeoutMs == null ? undefined : startTimer(streamIdleTimeoutMs);
      try {
        return await Promise.race([operation(), aborted]);
      } catch (error) {
        if (controller.signal.aborted) throw abortError();
        throw error;
      } finally {
        if (idleTimer !== undefined) { clearTimeout(idleTimer); timers.delete(idleTimer); }
        if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      }
    },
    cleanup() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      externalSignal.removeEventListener('abort', onExternalAbort);
    },
  };
}

export function providerAbortEvent(
  control: ProviderCallControl,
  label: string,
): Extract<AdapterEvent, { type: 'error' }> {
  return control.externalSignal.aborted && !control.timedOut()
    ? { type: 'error', failureClass: 'acceptance', message: `${label} aborted` }
    : { type: 'error', failureClass: 'timeout', message: `${label} timed out` };
}

export async function closeResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  timeoutMs = 1_000,
): Promise<void> {
  if (!reader) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      reader.cancel().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        if (typeof timer === 'object' && 'unref' in timer) timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      // The stream may already have released its lock.
    }
  }
}
