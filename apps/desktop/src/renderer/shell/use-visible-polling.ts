import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useKeepAliveActive } from './KeepAliveLayer.js';

type PollResult = boolean | void;

export interface VisiblePollingOptions {
  intervalMs: number;
  maxIntervalMs?: number;
  enabled?: boolean;
  /** Restarts immediately when the polled resource identity changes. */
  refreshKey?: unknown;
  onError?: (error: unknown) => void;
}

const visibilitySubscribers = new Set<() => void>();
let visibilityDocument: Document | undefined;

function notifyVisibilitySubscribers(): void {
  for (const subscriber of visibilitySubscribers) subscriber();
}

function subscribeDocumentVisibility(subscriber: () => void): () => void {
  visibilitySubscribers.add(subscriber);
  if (visibilitySubscribers.size === 1 && typeof document !== 'undefined') {
    visibilityDocument = document;
    visibilityDocument.addEventListener('visibilitychange', notifyVisibilitySubscribers);
  }
  return () => {
    visibilitySubscribers.delete(subscriber);
    if (visibilitySubscribers.size === 0 && visibilityDocument) {
      visibilityDocument.removeEventListener('visibilitychange', notifyVisibilitySubscribers);
      visibilityDocument = undefined;
    }
  };
}

function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeDocumentVisibility, isDocumentVisible, () => true);
}

/**
 * Polls only while both the document and its retained shell surface are active.
 * Each request finishes before the next timer starts, and failures back off.
 */
export function useVisiblePolling(
  poll: () => PollResult | Promise<PollResult>,
  options: VisiblePollingOptions,
): void {
  const keepAliveActive = useKeepAliveActive();
  const documentVisible = useDocumentVisible();
  const pollRef = useRef(poll);
  const onErrorRef = useRef(options.onError);
  pollRef.current = poll;
  onErrorRef.current = options.onError;

  const enabled = options.enabled ?? true;
  const intervalMs = Math.max(1, options.intervalMs);
  const maxIntervalMs = Math.max(intervalMs, options.maxIntervalMs ?? intervalMs * 8);

  useEffect(() => {
    if (!enabled || !keepAliveActive || !documentVisible) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failedAttempts = 0;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(() => void run(), delayMs);
    };
    const run = async () => {
      let failed = false;
      try {
        failed = (await pollRef.current()) === false;
      } catch (error) {
        failed = true;
        onErrorRef.current?.(error);
      }
      if (cancelled) return;
      failedAttempts = failed ? failedAttempts + 1 : 0;
      const nextDelay = failed
        ? Math.min(maxIntervalMs, intervalMs * 2 ** failedAttempts)
        : intervalMs;
      schedule(nextDelay);
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    documentVisible,
    enabled,
    intervalMs,
    keepAliveActive,
    maxIntervalMs,
    options.refreshKey,
  ]);
}
