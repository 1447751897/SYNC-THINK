import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { RunProcessView } from '@sync-think/protocol';
import type { RunId } from '@sync-think/shared';
import {
  RunProcessHistoryLoader,
  type RunProcessLoadFailure,
} from './run-process-history-loader.js';

import { conversationReadRequestPool } from './conversation-read-request-pool.js';

export function useRunProcessHistoryLoader(
  conversationId: string,
  onLoad: (process: RunProcessView) => void,
) {
  const current = useRef({ conversationId, onLoad });
  current.current = { conversationId, onLoad };
  const mounted = useRef(false);
  const [failureState, setFailureState] = useState<{
    conversationId: string;
    failures: ReadonlyMap<string, RunProcessLoadFailure>;
  }>({ conversationId, failures: new Map() });
  const [loader] = useState(
    () =>
      new RunProcessHistoryLoader(
        {
          load: async (runId) => {
            const api = window.syncThink?.runtime;
            if (!api?.getConversationRunProcess) throw new Error('History reader unavailable');
            const response = await api.getConversationRunProcess({ runId: runId as RunId });
            return response?.process;
          },
          onLoad: (context, process) => {
            if (mounted.current && current.current.conversationId === context)
              current.current.onLoad(process);
          },
          onFailure: (context, runId, failure) => {
            if (!mounted.current || current.current.conversationId !== context) return;
            setFailureState((previous) => {
              const failures =
                previous.conversationId === context
                  ? previous.failures
                  : new Map<string, RunProcessLoadFailure>();
              if (!failure && !failures.has(runId)) return previous;
              const next = new Map(failures);
              if (failure) next.set(runId, failure);
              else next.delete(runId);
              return { conversationId: context, failures: next };
            });
          },
        },
        conversationReadRequestPool,
      ),
  );
  useEffect(() => {
    mounted.current = true;
    setFailureState({ conversationId, failures: new Map() });
    return () => {
      mounted.current = false;
      loader.suspend();
    };
  }, [conversationId, loader]);
  const retry = useCallback((runId: string) => loader.retry(runId), [loader]);
  const failures = useMemo(
    () =>
      failureState.conversationId === conversationId
        ? failureState.failures
        : new Map<string, RunProcessLoadFailure>(),
    [conversationId, failureState],
  );
  return { loader, failures, retry };
}

export function useRunProcessHistoryRequests({
  loader,
  conversationId,
  enabled,
  scrollerRef,
  durableRunIds,
  activeRunIds,
  available,
}: {
  loader: RunProcessHistoryLoader;
  conversationId: string;
  enabled: boolean;
  scrollerRef: RefObject<HTMLDivElement>;
  durableRunIds: readonly string[];
  activeRunIds: readonly string[];
  available: ReadonlyMap<string, RunProcessView>;
}) {
  const runKey = JSON.stringify(durableRunIds);
  const activeKey = JSON.stringify(activeRunIds);
  const visibility = useRef<{
    conversationId: string;
    runKey: string;
    runIds: ReadonlySet<string>;
  }>();
  const current = useRef({
    conversationId,
    enabled,
    runKey,
    durableRunIds,
    activeRunIds,
    available,
  });
  current.current = { conversationId, enabled, runKey, durableRunIds, activeRunIds, available };
  const updateRequests = useCallback(() => {
    const state = current.current;
    if (!state.enabled) {
      loader.suspend();
      return;
    }
    const visible =
      visibility.current?.conversationId === state.conversationId &&
      visibility.current.runKey === state.runKey
        ? [...visibility.current.runIds]
        : [];
    const requests = [
      ...new Set([...state.activeRunIds, ...visible, ...state.durableRunIds.slice().reverse()]),
    ].map((runId, priority) => ({ runId, priority }));
    loader.setRequests(state.conversationId, requests, new Set(state.available.keys()));
  }, [loader]);
  useEffect(() => {
    const root = scrollerRef.current;
    if (!enabled || !root || typeof IntersectionObserver === 'undefined') return;
    const visibleNodes = new Set<Element>();
    let visibleRunIds = new Set<string>();
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active) return;
        for (const entry of entries) {
          if (entry.isIntersecting) visibleNodes.add(entry.target);
          else visibleNodes.delete(entry.target);
        }
        const nextRunIds = new Set(
          [...visibleNodes]
            .map((node) => (node as HTMLElement).dataset.processRunId)
            .filter((runId): runId is string => Boolean(runId)),
        );
        if (
          nextRunIds.size !== visibleRunIds.size ||
          [...nextRunIds].some((runId) => !visibleRunIds.has(runId))
        ) {
          visibleRunIds = nextRunIds;
          visibility.current = { conversationId, runKey, runIds: nextRunIds };
          updateRequests();
        }
      },
      { root, rootMargin: '240px 0px' },
    );
    for (const node of root.querySelectorAll<HTMLElement>('[data-process-run-id]'))
      observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [conversationId, enabled, runKey, scrollerRef, updateRequests]);
  useEffect(() => {
    updateRequests();
  }, [activeKey, available, conversationId, enabled, runKey, updateRequests]);
}
