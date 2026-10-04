import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserHandoffSummary, ListWaitingBrowserHandoffsPayload } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import { useKeepAliveActive } from './KeepAliveLayer.js';

export interface BrowserHandoffScope {
  /** Renderer identity also isolates private chats that share a Task. */
  identity: string;
  enabled: boolean;
  workspaceId?: ListWaitingBrowserHandoffsPayload['workspaceId'];
  conversationId?: string;
  taskId?: string;
  runId?: ListWaitingBrowserHandoffsPayload['runId'];
  refreshRevision?: number;
  runtimeConnectionRevision?: number;
}

interface HandoffState {
  key: string;
  handoffs: BrowserHandoffSummary[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  queryError?: string;
  actionError?: string;
  busyId?: string;
}

function emptyState(key: string): HandoffState {
  return { key, handoffs: [], status: 'idle' };
}

export function browserHandoffFailureDetails(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    return typeof code === 'string' ? `${code}: ${cause.message}` : cause.message;
  }
  if (cause && typeof cause === 'object') {
    const error = cause as { code?: unknown; message?: unknown };
    if (typeof error.message === 'string')
      return typeof error.code === 'string' ? `${error.code}: ${error.message}` : error.message;
  }
  return String(cause);
}

function isConnectionFailure(cause: unknown): boolean {
  return /not connected|disconnected|connection (?:lost|closed)|runtime (?:unavailable|connection unavailable)|pipe.*closed|timed out|timeout|EPIPE|ECONN|ENOTCONN|Runtime.*(?:连接|就绪)|连接.*(?:断开|关闭|失败)/i.test(
    browserHandoffFailureDetails(cause),
  );
}

/** Durable reads only are retried. Continue/cancel are never automatically replayed. */
export function useBrowserHandoffs(scope: BrowserHandoffScope) {
  const layerActive = useKeepAliveActive();
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const enabled = scope.enabled && layerActive && visible;
  const { identity, workspaceId, conversationId, taskId, runId } = scope;
  const key = JSON.stringify([identity, workspaceId, conversationId, taskId, runId]);
  const liveKey = useRef(key);
  const liveEnabled = useRef(enabled);
  liveKey.current = key;
  liveEnabled.current = enabled;
  const [state, setState] = useState<HandoffState>(() => emptyState(key));
  const pauseRef = useRef<() => void>(() => {});
  const subscribeRef = useRef<() => () => void>(() => () => {});
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const decideRef = useRef<(handoff: BrowserHandoffSummary, decision: 'continue' | 'cancel') => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    setState(emptyState(key));
    const api = window.syncThink?.runtime;
    let disposed = false;
    let generation = 0;
    let failedAttempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let actionBusy = false;
    let activeRead: Promise<void> | undefined;
    let rerunRequested = false;
    const current = () => !disposed && liveKey.current === key;
    const matches = (handoff: BrowserHandoffSummary) =>
      (!workspaceId || handoff.workspaceId === workspaceId) &&
      (conversationId
        ? handoff.conversationId === conversationId
        : !handoff.conversationId && handoff.taskId === taskId) &&
      (!runId || handoff.runId === runId);
    const clearRetry = () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    const payload: ListWaitingBrowserHandoffsPayload = {
      ...(workspaceId ? { workspaceId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(runId ? { runId } : {}),
    };
    const load = (): Promise<void> => {
      if (!current() || !liveEnabled.current) return Promise.resolve();
      clearRetry();
      if (activeRead) {
        // Coalesce bursts into one trailing read. Never let this scope issue concurrent IPC.
        rerunRequested = true;
        ++generation;
        return activeRead;
      }
      const drain = async () => {
        do {
          if (!current() || !liveEnabled.current) return;
          rerunRequested = false;
          const requestGeneration = ++generation;
          setState(value => ({ ...value, status: 'loading' }));
          try {
            if (!api?.listWaitingBrowserHandoffs)
              throw new Error('当前桌面桥接缺少 listWaitingBrowserHandoffs。');
            const response = await api.listWaitingBrowserHandoffs(payload);
            if (current() && liveEnabled.current && requestGeneration === generation) {
              failedAttempts = 0;
              setState(value => ({
                ...value, handoffs: response.handoffs.filter(matches), status: 'ready', queryError: undefined,
              }));
            }
          } catch (cause) {
            if (current() && liveEnabled.current && requestGeneration === generation) {
              setState(value => ({ ...value, status: 'error', queryError: browserHandoffFailureDetails(cause) }));
              // A connected transport does not fix malformed IPC payloads or semantic failures.
              if (isConnectionFailure(cause)) {
                const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failedAttempts++, 5));
                retryTimer = setTimeout(() => void load(), delay);
              }
            }
          }
        } while (current() && liveEnabled.current && rerunRequested);
      };
      // Defer the drain so activeRead is set even if a missing bridge throws synchronously.
      activeRead = Promise.resolve().then(drain).finally(() => {
        activeRead = undefined;
        // Activation can queue a read after an aborted drain has returned but before
        // this promise settles. Preserve that request rather than leaving the UI idle.
        if (current() && liveEnabled.current && rerunRequested) return load();
      });
      return activeRead;
    };
    const decide = async (handoff: BrowserHandoffSummary, decision: 'continue' | 'cancel') => {
      if (!current() || !liveEnabled.current || actionBusy || !matches(handoff)) return;
      actionBusy = true;
      setState(value => ({ ...value, busyId: handoff.handoffId, actionError: undefined }));
      let failure: string | undefined;
      try {
        const payload = { handoffId: handoff.handoffId, expectedRevision: handoff.revision };
        if (decision === 'continue') {
          if (!api?.continueBrowserHandoff) throw new Error('当前桌面桥接缺少 continueBrowserHandoff。');
          await api.continueBrowserHandoff(payload);
        } else {
          if (!api?.cancelBrowserHandoff) throw new Error('当前桌面桥接缺少 cancelBrowserHandoff。');
          await api.cancelBrowserHandoff({
            ...payload, leaseDisposition: handoff.onCancel === 'close-page' ? 'release' : 'preserve',
          });
        }
      } catch (cause) {
        const notice = isConnectionFailure(cause)
          ? '操作结果尚未确认，请核对最新接管状态后再决定是否重试。'
          : '操作未生效，请核对最新接管状态后重试。';
        failure = `${notice}失败详情：${browserHandoffFailureDetails(cause)}`;
      }
      if (!current()) return;
      // Reconcile an ambiguous/stale decision by reading, not by resending the command.
      await load();
      if (!current()) return;
      actionBusy = false;
      setState(value => ({ ...value, busyId: undefined, actionError: failure }));
    };
    loadRef.current = load;
    decideRef.current = decide;
    const relevant = (event: Event) => {
      if (workspaceId && event.workspaceId && event.workspaceId !== workspaceId) return false;
      const eventConversationId = event.payload?.conversationId;
      if (conversationId && eventConversationId && eventConversationId !== conversationId) return false;
      if (!conversationId && eventConversationId) return false;
      if (!conversationId && event.taskId && event.taskId !== taskId) return false;
      if (runId && event.runId && event.runId !== runId) return false;
      return event.type.startsWith('browser.handoff.') ||
        (Boolean(conversationId) && event.type === 'collaboration.updated');
    };
    const pause = () => { ++generation; rerunRequested = false; clearRetry(); };
    pauseRef.current = pause;
    subscribeRef.current = () => {
      const unsubscribe = api?.onEvent?.(event => { if (relevant(event)) void load(); });
      const unsubscribeBatch = api?.onEvents?.(events => { if (events.some(relevant)) void load(); });
      const recover = () => { if (current()) void load(); };
      window.addEventListener('focus', recover);
      window.addEventListener('online', recover);
      return () => {
        unsubscribe?.();
        unsubscribeBatch?.();
        window.removeEventListener('focus', recover);
        window.removeEventListener('online', recover);
      };
    };
    return () => { disposed = true; pause(); };
  }, [key, identity, workspaceId, conversationId, taskId, runId]);

  // Visibility/activity suspends reads, not an in-flight durable decision lock.
  useEffect(() => {
    const pause = pauseRef.current;
    if (!enabled) { pause(); return; }
    const unsubscribe = subscribeRef.current();
    void loadRef.current();
    return () => { pause(); unsubscribe(); };
  }, [key, enabled]);

  const revision = JSON.stringify([scope.refreshRevision, scope.runtimeConnectionRevision]);
  const previousRevision = useRef({ key, revision });
  useEffect(() => {
    const previous = previousRevision.current;
    previousRevision.current = { key, revision };
    if (previous.key === key && previous.revision !== revision && enabled) void loadRef.current();
  }, [key, revision, enabled]);

  const refresh = useCallback(() => loadRef.current(), []);
  const decide = useCallback(
    (handoff: BrowserHandoffSummary, decision: 'continue' | 'cancel') => decideRef.current(handoff, decision),
    [],
  );
  // Hide the previous scope in the switching render, before passive cleanup runs.
  return { ...(enabled && state.key === key ? state : emptyState(key)), refresh, decide };
}