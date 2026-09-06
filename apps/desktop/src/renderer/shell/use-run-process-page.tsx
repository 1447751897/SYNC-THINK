import { useEffect, useRef, useState } from 'react';
import type {
  ConversationGetRunProcessPayload,
  ConversationGetRunProcessResponse,
  RunProcessSection,
  RunProcessView,
} from '@sync-think/protocol';
import type { ConversationId } from '@sync-think/shared';
import { DeferredRequestReader } from './deferred-request-reader.js';

export const runProcessPageReader = new DeferredRequestReader<
  ConversationGetRunProcessPayload,
  ConversationGetRunProcessResponse
>(
  async (payload) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getConversationRunProcess) throw new Error('history.unavailable');
    return runtime.getConversationRunProcess(payload);
  },
  (payload, response) => {
    const process = response?.process;
    const request = payload.page;
    if (
      !process ||
      process.runId !== payload.runId ||
      !request ||
      !process.pages ||
      !/^[a-f0-9]{64}$/.test(process.pages.version)
    )
      throw new Error('history.invalid-response');
    const page = process.pages[request.section];
    const items =
      request.section === 'taskPlan' ? (process.taskPlan?.items ?? []) : process[request.section];
    if (
      !page ||
      !Array.isArray(items) ||
      items.length > (request.limit ?? 40) ||
      page.offset !== request.offset ||
      !Number.isSafeInteger(page.total) ||
      page.total < page.offset + items.length ||
      (page.offset + items.length < page.total
        ? page.nextOffset !== page.offset + items.length || !items.length
        : page.nextOffset !== undefined)
    )
      throw new Error('history.invalid-response');
    if (request.version && process.pages.version !== request.version)
      throw new Error('history.version-changed');
  },
);

interface PageState {
  identity: string;
  process?: RunProcessView;
  busy?: boolean;
  error?: 'changed' | 'failed';
  previous: number[];
}

export function accumulateRunProcessSection(
  current: RunProcessView,
  incoming: RunProcessView,
  section: RunProcessSection,
): RunProcessView {
  const incomingPage = incoming.pages?.[section];
  if (!incomingPage || incomingPage.offset === 0) return incoming;
  if (section === 'taskPlan') {
    return {
      ...incoming,
      ...(incoming.taskPlan && current.taskPlan
        ? {
            taskPlan: {
              ...incoming.taskPlan,
              items: [...current.taskPlan.items, ...(incoming.taskPlan.items ?? [])],
            },
          }
        : {}),
    };
  }
  return {
    ...incoming,
    [section]: [...current[section], ...incoming[section]],
  };
}

export function useRunProcessPage(
  source: RunProcessView | undefined,
  section: RunProcessSection,
  conversationId?: string,
  options?: { accumulate?: boolean },
) {
  const identity = JSON.stringify([conversationId, source?.runId, source?.pages?.version, section]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const active = useRef<{ identity: string; controller: AbortController }>();
  const [state, setState] = useState<PageState>();
  const current = state?.identity === identity ? state : undefined;
  const process = current?.process ?? source;
  const page = process?.pages?.[section];
  const label = section === 'steps' ? '步骤' : section === 'fileChanges' ? '文件' : '任务';
  useEffect(
    () => () => {
      if (active.current?.identity === identity) {
        active.current.controller.abort();
        active.current = undefined;
      }
    },
    [identity],
  );
  const load = (offset: number, previous: number[], fresh = false) => {
    if (!source || !conversationId || active.current?.identity === identity) return;
    const controller = new AbortController();
    active.current = { identity, controller };
    setState({ identity, process, previous: current?.previous ?? [], busy: true });
    void runProcessPageReader
      .read(
        {
          runId: source.runId,
          conversationId: conversationId as ConversationId,
          page: { section, offset, ...(fresh ? {} : { version: process?.pages?.version }) },
        },
        controller.signal,
      )
      .then((response) => {
        if (controller.signal.aborted || currentIdentity.current !== identity) return;
        setState((currentState) => {
          const base =
            currentState?.identity === identity ? (currentState.process ?? process) : process;
          return {
            identity,
            process:
              options?.accumulate && base
                ? accumulateRunProcessSection(base, response.process, section)
                : response.process,
            previous,
          };
        });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && currentIdentity.current === identity)
          setState({
            identity,
            process,
            previous: current?.previous ?? [],
            error:
              error instanceof Error && error.message.includes('version-changed')
                ? 'changed'
                : 'failed',
          });
      })
      .finally(() => {
        if (active.current?.controller === controller) active.current = undefined;
      });
  };
  useEffect(() => {
    if (!options?.accumulate || !source || !conversationId || current?.busy || current?.error)
      return;
    const nextOffset = process?.pages?.[section]?.nextOffset;
    const currentOffset = process?.pages?.[section]?.offset ?? 0;
    if (nextOffset === undefined || nextOffset <= currentOffset) return;
    load(nextOffset, [...(current?.previous ?? []), process?.pages?.[section]?.offset ?? 0]);
    // Intentionally continue from the latest nextOffset after each page lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conversationId,
    current?.busy,
    current?.error,
    identity,
    options?.accumulate,
    process?.pages?.[section]?.nextOffset,
  ]);
  const count =
    section === 'taskPlan'
      ? (process?.taskPlan?.items.length ?? 0)
      : (process?.[section].length ?? 0);
  const controls = options?.accumulate ? (
    current?.busy || current?.error ? (
      <div className="shell-process-pages" aria-label={`${label}加载`}>
        {current.busy ? <span role="status">正在读取全部{label}…</span> : null}
        {current.error ? (
          <span role="alert">
            {current.error === 'changed'
              ? '过程已更新，已显示当前已加载内容；请重新读取。'
              : '后续步骤读取失败，已显示已加载内容。'}
          </span>
        ) : null}
        {current.error ? (
          <button type="button" disabled={!conversationId || current.busy} onClick={() => load(0, [], true)}>
            重新读取{label}
          </button>
        ) : null}
      </div>
    ) : null
  ) : page && (page.total > count || page.offset > 0 || current?.error) ? (
      <div className="shell-process-pages" aria-label={`${label}分页`}>
        <span>
          {label} {page.total ? page.offset + 1 : 0}–{page.offset + count} / {page.total}
        </span>
        <button
          type="button"
          disabled={
            !conversationId || current?.busy || current?.error === 'changed' || page.offset === 0
          }
          onClick={() =>
            load(
              current?.previous.at(-1) ?? Math.max(0, page.offset - 40),
              current?.previous.slice(0, -1) ?? [],
            )
          }
        >
          上一页{label}
        </button>
        <button
          type="button"
          disabled={
            !conversationId ||
            current?.busy ||
            current?.error === 'changed' ||
            page.nextOffset === undefined
          }
          onClick={() => load(page.nextOffset!, [...(current?.previous ?? []), page.offset])}
        >
          下一页{label}
        </button>
        <button
          type="button"
          disabled={!conversationId || current?.busy}
          onClick={() => load(0, [], true)}
        >
          重新读取{label}
        </button>
        {current?.busy ? <span role="status">正在读取{label}…</span> : null}
        {!conversationId ? <span>请从原会话重新打开。</span> : null}
        {current?.error ? (
          <span role="alert">
            {current.error === 'changed'
              ? '过程已更新，当前旧页保留；请重新读取。'
              : '过程页读取失败，当前内容保留；可再次点击翻页重试。'}
          </span>
        ) : null}
      </div>
    ) : null;
  return { process, controls };
}
