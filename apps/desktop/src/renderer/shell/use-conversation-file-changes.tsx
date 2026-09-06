import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationId } from '@sync-think/shared';
import type {
  ConversationFileChangesPage,
  ConversationListFileChangesPayload,
} from '@sync-think/protocol';
import { DeferredRequestReader } from './deferred-request-reader.js';

export const conversationFilesReader = new DeferredRequestReader<
  ConversationListFileChangesPayload,
  ConversationFileChangesPage
>(
  async (payload) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listConversationFileChanges) throw new Error('history.unavailable');
    return runtime.listConversationFileChanges(payload);
  },
  (request, page) => {
    if (
      !page ||
      !Array.isArray(page.items) ||
      page.items.length > (request.limit ?? 40) ||
      page.offset !== request.offset ||
      !Number.isSafeInteger(page.total) ||
      page.total < page.offset + page.items.length ||
      typeof page.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(page.version) ||
      page.items.some(
        (item) =>
          !item ||
          typeof item.path !== 'string' ||
          typeof item.runId !== 'string' ||
          !Number.isSafeInteger(item.sequence),
      ) ||
      (page.offset + page.items.length < page.total
        ? !page.items.length || page.nextOffset !== page.offset + page.items.length
        : page.nextOffset !== undefined)
    )
      throw new Error('history.invalid-response');
    if (request.version && page.version !== request.version)
      throw new Error('history.version-changed');
  },
);

interface DirectoryState {
  identity: string;
  page?: ConversationFileChangesPage;
  previous: number[];
  busy?: boolean;
  error?: 'changed' | 'failed';
}

export function accumulateConversationFilePage(
  current: ConversationFileChangesPage | undefined,
  incoming: ConversationFileChangesPage,
): ConversationFileChangesPage {
  if (!current || incoming.offset === 0) return incoming;
  return {
    ...incoming,
    items: [...current.items, ...incoming.items],
  };
}

export function useConversationFileChanges(conversationId?: string, enabled = true) {
  const identity = conversationId ?? '';
  const [state, setState] = useState<DirectoryState>();
  const current = state?.identity === identity ? state : undefined;
  const stateRef = useRef(current);
  stateRef.current = current;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const active = useRef<{ identity: string; controller: AbortController }>();
  const load = useCallback(
    (offset: number, previous: number[], fresh = false) => {
      if (!identity || active.current?.identity === identity) return;
      const snapshot = stateRef.current;
      const controller = new AbortController();
      active.current = { identity, controller };
      setState({ identity, page: snapshot?.page, previous: snapshot?.previous ?? [], busy: true });
      void conversationFilesReader
        .read(
          {
            conversationId: identity as ConversationId,
            offset,
            ...(fresh || !snapshot?.page ? {} : { version: snapshot.page.version }),
          },
          controller.signal,
        )
        .then((page) => {
          if (controller.signal.aborted || identityRef.current !== identity) return;
          const merged = accumulateConversationFilePage(fresh ? undefined : snapshot?.page, page);
          setState({ identity, page: merged, previous });
          const nextOffset = page.nextOffset;
          if (nextOffset !== undefined && nextOffset > page.offset) {
            queueMicrotask(() => {
              if (identityRef.current === identity && !active.current) {
                load(nextOffset, [...previous, page.offset]);
              }
            });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && identityRef.current === identity)
            setState({
              identity,
              page: snapshot?.page,
              previous: snapshot?.previous ?? [],
              error:
                error instanceof Error && error.message.includes('version-changed')
                  ? 'changed'
                  : 'failed',
            });
        })
        .finally(() => {
          if (active.current?.controller === controller) active.current = undefined;
        });
    },
    [identity],
  );
  useEffect(() => {
    if (enabled && identity) {
      if (!stateRef.current?.page) load(0, [], true);
      else if (stateRef.current.busy)
        setState((previous) =>
          previous?.identity === identity ? { ...previous, busy: false } : previous,
        );
    }
    return () => {
      if (active.current?.identity === identity) {
        active.current.controller.abort();
        active.current = undefined;
      }
    };
  }, [enabled, identity, load]);
  useEffect(() => {
    if (!enabled || !identity || current?.busy || current?.error) return;
    const nextOffset = current?.page?.nextOffset;
    const currentOffset = current?.page?.offset ?? 0;
    if (nextOffset === undefined || nextOffset <= currentOffset) return;
    load(nextOffset, [...(current?.previous ?? []), currentOffset]);
  }, [current?.busy, current?.error, current?.page?.nextOffset, current?.page?.offset, enabled, identity, load]);
  const page = current?.page;
  const reload = () => load(0, [], true);
  const controls =
    identity && enabled && (current?.busy || current?.error) ? (
      <div className="shell-process-pages" aria-label="会话文件加载">
        {current.busy ? <span role="status">正在读取全部文件…</span> : null}
        {current.error ? (
          <span role="alert">
            {current.error === 'changed'
              ? '会话文件已更新，已显示当前已加载内容；请重新读取。'
              : '后续文件读取失败，已显示已加载内容。'}
          </span>
        ) : null}
        {current.error ? (
          <button type="button" disabled={current.busy} onClick={reload}>
            重新读取文件
          </button>
        ) : null}
      </div>
    ) : null;
  return { page, controls, reload };
}
