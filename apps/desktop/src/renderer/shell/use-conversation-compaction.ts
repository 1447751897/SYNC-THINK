import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationCompactPayload, ConversationCompactResponse } from '@sync-think/protocol';
import { formatCompactElapsed } from './compose-slash.js';

interface CompactProgress {
  status: 'running' | 'success' | 'noop' | 'failure';
  mode: 'manual' | 'auto';
  startedAt: number;
  message: string;
  afterTokens?: number;
}

interface HostCompactionEvent {
  id: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

interface CompactionState {
  request?: symbol;
  hostOperationId?: string;
  hostRevision: number;
  lastEventSignature?: string;
  progress: CompactProgress | null;
  timer?: ReturnType<typeof setTimeout>;
  dismissAt?: number;
}

type Compact = (payload: ConversationCompactPayload) => Promise<ConversationCompactResponse>;

/** Conversation-local UI lifecycle. Runtime remains the owner of actual compaction. */
export function useConversationCompaction({
  conversationId,
  getCompact,
  refreshContextStatus,
  onManualError,
  hostEvent,
}: {
  conversationId: string;
  getCompact: () => Compact | undefined;
  refreshContextStatus: () => Promise<void>;
  onManualError: (message: string) => void;
  hostEvent?: HostCompactionEvent;
}) {
  const states = useRef(new Map<string, CompactionState>());
  const activeConversation = useRef(conversationId);
  activeConversation.current = conversationId;
  const mounted = useRef(true);
  const [, invalidate] = useState(0);
  const stateFor = useCallback((id: string) => {
    let state = states.current.get(id);
    if (!state) {
      state = { hostRevision: 0, progress: null };
      states.current.set(id, state);
    }
    return state;
  }, []);
  const notify = useCallback((id: string) => {
    if (mounted.current && activeConversation.current === id) invalidate((value) => value + 1);
  }, []);
  const scheduleDismiss = useCallback(
    (id: string, state: CompactionState) => {
      const progress = state.progress;
      if (!mounted.current || !progress || state.dismissAt === undefined) return;
      state.timer = setTimeout(
        () => {
          if (state.progress !== progress) return;
          state.progress = null;
          state.timer = undefined;
          state.dismissAt = undefined;
          notify(id);
        },
        Math.max(0, state.dismissAt - Date.now()),
      );
    },
    [notify],
  );
  const publish = useCallback(
    (id: string, progress: CompactProgress, dismissAfter?: number) => {
      const state = stateFor(id);
      clearTimeout(state.timer);
      state.timer = undefined;
      state.progress = progress;
      state.dismissAt = dismissAfter === undefined ? undefined : Date.now() + dismissAfter;
      scheduleDismiss(id, state);
      notify(id);
    },
    [notify, scheduleDismiss, stateFor],
  );
  useEffect(() => {
    mounted.current = true;
    const ownedStates = states.current;
    // StrictMode can replay setup after cleanup without discarding the retained state.
    for (const [id, state] of ownedStates) scheduleDismiss(id, state);
    return () => {
      mounted.current = false;
      for (const state of ownedStates.values()) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
    };
  }, [scheduleDismiss]);

  const isCompacting = useCallback(() => {
    const state = states.current.get(conversationId);
    return Boolean(state?.request || state?.hostOperationId);
  }, [conversationId]);

  const run = useCallback(
    async (mode: 'manual' | 'auto') => {
      const compact = getCompact();
      if (!compact || isCompacting()) return;
      const state = stateFor(conversationId);
      const token = Symbol('compact');
      const hostRevision = state.hostRevision;
      state.request = token;
      const startedAt = Date.now();
      const active = () => mounted.current && activeConversation.current === conversationId;
      // Host events have operation IDs and take precedence over the RPC's late echo.
      const ownsProgress = () => state.request === token && state.hostRevision === hostRevision;
      publish(conversationId, {
        status: 'running',
        mode,
        startedAt,
        message: mode === 'auto' ? '正在自动压缩上下文…' : '正在手动压缩上下文…',
      });
      try {
        const result = await compact({
          conversationId: conversationId as ConversationCompactPayload['conversationId'],
          mode,
          onlyIfNeeded: mode === 'auto',
        });
        if (ownsProgress() && mounted.current) {
          const elapsed = formatCompactElapsed(startedAt);
          const saved =
            result.compacted && result.beforeTokens > result.afterTokens
              ? `（${result.beforeTokens} → ${result.afterTokens}）`
              : '';
          publish(
            conversationId,
            result.compacted
              ? {
                  status: 'success',
                  mode,
                  startedAt,
                  message: `上下文已${mode === 'auto' ? '自动' : ''}压缩${saved} · 折叠 ${result.foldedCount} 条 · ${elapsed}`,
                  afterTokens: result.afterTokens,
                }
              : {
                  status: 'noop',
                  mode,
                  startedAt,
                  message:
                    mode === 'auto'
                      ? `当前上下文无需压缩 · ${elapsed}`
                      : `当前上下文仍充足，无需压缩 · ${elapsed}`,
                },
            result.compacted ? 2400 : 1600,
          );
        }
      } catch (error) {
        if (ownsProgress() && mounted.current) {
          publish(
            conversationId,
            {
              status: 'failure',
              mode,
              startedAt,
              message:
                mode === 'auto'
                  ? `上下文自动压缩失败 · ${formatCompactElapsed(startedAt)}`
                  : '上下文压缩失败',
            },
            mode === 'auto' ? 2400 : 1600,
          );
        }
        if (mode === 'manual' && active() && ownsProgress()) {
          const raw = error instanceof Error ? error.message : String(error);
          onManualError(
            /timed out|timeout/i.test(raw)
              ? '上下文压缩超时：模型摘要耗时过长，请稍后重试，或先缩短对话后再压缩'
              : `上下文压缩失败: ${raw}`,
          );
        }
      } finally {
        try {
          await refreshContextStatus();
        } catch {
          // A status refresh is advisory; it must neither block sending nor strand the lock.
        } finally {
          if (state.request === token) state.request = undefined;
          notify(conversationId);
        }
      }
    },
    [
      conversationId,
      getCompact,
      isCompacting,
      notify,
      onManualError,
      publish,
      refreshContextStatus,
      stateFor,
    ],
  );

  const runAutoCompact = useCallback(
    async (
      kernelId: string,
      status: { usageRatio: number; compactThreshold: number } | null | undefined,
    ) => {
      if (kernelId !== 'native' || !status || !(status.usageRatio >= status.compactThreshold))
        return;
      await run('auto');
    },
    [run],
  );
  const runManualCompact = useCallback(() => run('manual'), [run]);

  useEffect(() => {
    const event = hostEvent;
    if (!event || event.payload.conversationId !== conversationId) return;
    const operationId = event.payload.operationId;
    if (typeof operationId !== 'string' || !operationId.trim()) return;
    if (
      ![
        'context.compaction_started',
        'context.compacted',
        'context.compaction_failed',
        'context.compaction_skipped',
      ].includes(event.type)
    )
      return;
    const state = stateFor(conversationId);
    const signature = `${event.id}:${event.type}`;
    if (state.lastEventSignature === signature) return;
    state.lastEventSignature = signature;
    const parsed = Date.parse(
      typeof event.payload.startedAt === 'string' ? event.payload.startedAt : event.occurredAt,
    );
    const startedAt = Number.isFinite(parsed) ? parsed : Date.now();
    if (
      event.type !== 'context.compaction_started' &&
      Date.now() - startedAt > 15_000 &&
      state.hostOperationId !== operationId
    )
      return;
    if (
      event.type !== 'context.compaction_started' &&
      state.hostOperationId &&
      state.hostOperationId !== operationId
    )
      return;
    state.hostRevision += 1;
    const mode = event.payload.mode === 'auto' ? 'auto' : 'manual';
    if (event.type === 'context.compaction_started') {
      state.hostOperationId = operationId;
      publish(conversationId, {
        status: 'running',
        mode,
        startedAt,
        message: mode === 'auto' ? '正在自动压缩上下文…' : '正在手动压缩上下文…',
      });
      return;
    }
    state.hostOperationId = undefined;
    const number = (key: string) => {
      const value = event.payload[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };
    const beforeTokens = number('beforeTokens');
    const afterTokens = number('afterTokens');
    const durationMs = number('durationMs');
    const elapsed =
      durationMs !== undefined
        ? formatCompactElapsed(Date.now() - durationMs, Date.now())
        : formatCompactElapsed(startedAt);
    if (event.type === 'context.compacted') {
      const saved =
        beforeTokens !== undefined && afterTokens !== undefined
          ? `（${beforeTokens} → ${afterTokens}）`
          : '';
      publish(
        conversationId,
        {
          status: 'success',
          mode,
          startedAt,
          afterTokens,
          message: `上下文已${mode === 'auto' ? '自动' : ''}压缩${saved} · 折叠 ${number('foldedCount') ?? 0} 条 · ${elapsed}`,
        },
        2400,
      );
      void refreshContextStatus().catch(() => undefined);
    } else if (event.type === 'context.compaction_failed') {
      publish(
        conversationId,
        {
          status: 'failure',
          mode,
          startedAt,
          message: `上下文${mode === 'auto' ? '自动' : ''}压缩失败 · ${elapsed}`,
        },
        2400,
      );
    } else {
      publish(
        conversationId,
        { status: 'noop', mode, startedAt, message: `当前上下文无需压缩 · ${elapsed}` },
        1600,
      );
    }
  }, [conversationId, hostEvent, publish, refreshContextStatus, stateFor]);

  return {
    compactProgress: states.current.get(conversationId)?.progress ?? null,
    isCompacting,
    runAutoCompact,
    runManualCompact,
  };
}
