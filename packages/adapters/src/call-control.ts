import type { AdapterEvent } from './types.js';

export interface ProviderCallControl {
  signal: AbortSignal;
  externalSignal: AbortSignal;
  timedOut(): boolean;
  cleanup(): void;
}

export function createProviderCallControl(
  externalSignal: AbortSignal,
  timeoutMs: number,
): ProviderCallControl {
  const controller = new AbortController();
  let didTimeout = false;
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal.aborted) onExternalAbort();
  else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error('provider.timeout'));
  }, timeoutMs);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  return {
    signal: controller.signal,
    externalSignal,
    timedOut: () => didTimeout,
    cleanup() {
      clearTimeout(timer);
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
