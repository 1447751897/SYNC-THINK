/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserHandoffSummary, ListWaitingBrowserHandoffsResponse } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import { browserHandoffFailureDetails, useBrowserHandoffs, type BrowserHandoffScope } from './use-browser-handoffs.js';

const list = vi.fn();
const proceed = vi.fn();
const cancel = vi.fn();
const unsubscribe = vi.fn();
const unsubscribeBatch = vi.fn();
let eventListener: (event: Event) => void;
let batchListener: (events: Event[]) => void;
const group: BrowserHandoffScope = {
  identity: 'group-a', enabled: true, conversationId: 'group-a',
  workspaceId: 'workspace-a' as BrowserHandoffScope['workspaceId'],
};
const privateScope: BrowserHandoffScope = {
  identity: 'private-a', enabled: true, taskId: 'task-a',
  workspaceId: 'workspace-a' as BrowserHandoffScope['workspaceId'],
  runId: 'run-a' as BrowserHandoffScope['runId'],
};
function handoff(patch: Partial<BrowserHandoffSummary> = {}): BrowserHandoffSummary {
  return {
    handoffId: 'handoff-a', workspaceId: 'workspace-a', conversationId: 'group-a',
    taskId: 'task-a', runId: 'run-a', revision: 1, requestedOutcome: 'durable login',
    reason: 'login', onCancel: 'keep-open', profileId: 'profile-a', status: 'waiting_user',
    siteOrigin: 'https://fixture.test', createdAt: '', updatedAt: '', canContinue: true, canCancel: true,
    ...patch,
  } as BrowserHandoffSummary;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function event(type: string, payload: Record<string, unknown> = {}, workspaceId = 'workspace-a'): Event {
  return { type, workspaceId, payload } as unknown as Event;
}

beforeEach(() => {
  vi.useRealTimers();
  list.mockReset().mockResolvedValue({ handoffs: [handoff()] });
  proceed.mockReset().mockResolvedValue({ status: 'continued' });
  cancel.mockReset().mockResolvedValue({ status: 'cancelled' });
  unsubscribe.mockReset();
  unsubscribeBatch.mockReset();
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: {
    listWaitingBrowserHandoffs: list, continueBrowserHandoff: proceed, cancelBrowserHandoff: cancel,
    onEvent: vi.fn(listener => { eventListener = listener; return unsubscribe; }),
    onEvents: vi.fn(listener => { batchListener = listener; return unsubscribeBatch; }),
  } } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(window, 'syncThink'); });

async function flush() { await act(async () => {}); }

describe('durable browser handoff scope and recovery', () => {
  it('keeps group/workspace isolation and sends both fields to Runtime', async () => {
    list.mockResolvedValue({ handoffs: [
      handoff(), handoff({ conversationId: 'group-b' }),
      handoff({ workspaceId: 'workspace-b' as BrowserHandoffSummary['workspaceId'] }),
      handoff({ conversationId: undefined }),
    ] });
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.handoffs).toEqual([handoff()]);
    expect(list).toHaveBeenCalledWith({ conversationId: 'group-a', workspaceId: 'workspace-a' });
  });

  it('keeps private Task/run/workspace queries separate from group summaries', async () => {
    const own = handoff({ conversationId: undefined });
    list.mockResolvedValue({ handoffs: [own, handoff(),
      handoff({ conversationId: undefined, taskId: 'task-b' as BrowserHandoffSummary['taskId'] }),
      handoff({ conversationId: undefined, runId: 'run-b' as BrowserHandoffSummary['runId'] }),
      handoff({ conversationId: undefined, workspaceId: 'workspace-b' as BrowserHandoffSummary['workspaceId'] }),
    ] });
    const { result } = renderHook(() => useBrowserHandoffs(privateScope));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.handoffs).toEqual([own]);
    expect(list).toHaveBeenCalledWith({ workspaceId: 'workspace-a', runId: 'run-a' });
  });

  it('automatically retries disconnected reads, including success with an empty durable list', async () => {
    vi.useFakeTimers();
    list.mockRejectedValueOnce(new Error('Runtime disconnected: EPIPE')).mockResolvedValue({ handoffs: [] });
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    expect(result.current.queryError).toContain('EPIPE');
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
    expect(result.current.queryError).toBeUndefined();
    expect(result.current.handoffs).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off repeated disconnects and cancels automatic reads when inactive', async () => {
    vi.useFakeTimers();
    list.mockRejectedValue(new Error('connection lost'));
    const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: group });
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(list).toHaveBeenCalledTimes(3);
    rerender({ ...group, enabled: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(list).toHaveBeenCalledTimes(3);
    expect(result.current.queryError).toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not retry malformed IPC or semantic errors as a connection problem', async () => {
    vi.useFakeTimers();
    list.mockRejectedValue(new Error('Invalid list-waiting-browser-handoffs payload'));
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.queryError).toBe('Invalid list-waiting-browser-handoffs payload');
  });

  it.each(['focus', 'online'])('recovers on %s and cancels the scheduled retry', async (type) => {
    vi.useFakeTimers();
    list.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({ handoffs: [] });
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    await act(async () => { window.dispatchEvent(new window.Event(type)); });
    expect(result.current.status).toBe('ready');
    expect(result.current.queryError).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('suspends retry in a hidden document and reads immediately on visibility recovery', async () => {
    vi.useFakeTimers();
    list.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue({ handoffs: [] });
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
      expect(list).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
      expect(list).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe('ready');
    } finally { Reflect.deleteProperty(document, 'visibilityState'); }
  });

  it('refreshes private chat state after a Runtime reconnect revision', async () => {
    list.mockRejectedValueOnce(new Error('query failed')).mockResolvedValue({ handoffs: [] });
    const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), {
      initialProps: { ...privateScope, runtimeConnectionRevision: 0 },
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    rerender({ ...privateScope, runtimeConnectionRevision: 1 });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.queryError).toBeUndefined();
  });

  it('processes scoped and batched events without re-querying other groups/workspaces', async () => {
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      eventListener(event('collaboration.updated', { conversationId: 'group-b' }));
      eventListener(event('browser.handoff.continued', { conversationId: 'group-a' }, 'workspace-b'));
    });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => {
      batchListener([event('browser.handoff.continued', { conversationId: 'group-a' }),
        event('collaboration.updated', { conversationId: 'group-a' })]);
    });
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('browser handoff races and decisions', () => {
  it.each(['success', 'failure'])('ignores a stale %s after a newer successful refresh', async (outcome) => {
    const old = deferred<ListWaitingBrowserHandoffsResponse>();
    list.mockReturnValueOnce(old.promise).mockResolvedValue({ handoffs: [] });
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    let refreshed!: Promise<void>;
    act(() => { refreshed = result.current.refresh(); });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (outcome === 'success') old.resolve({ handoffs: [handoff()] });
      else old.reject(new Error('connection lost'));
      await refreshed;
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.handoffs).toEqual([]);
    expect(result.current.queryError).toBeUndefined();
  });

  it('ignores a stale success after the newer query has failed', async () => {
    const old = deferred<ListWaitingBrowserHandoffsResponse>();
    list.mockReturnValueOnce(old.promise).mockRejectedValue(new Error('newest failure'));
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    let refreshed!: Promise<void>;
    act(() => { refreshed = result.current.refresh(); });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { old.resolve({ handoffs: [handoff()] }); await refreshed; });
    expect(result.current.queryError).toBe('newest failure');
    expect(result.current.handoffs).toEqual([]);
  });

  it('ignores old query responses across group switches and hides old cards immediately', async () => {
    const old = deferred<ListWaitingBrowserHandoffsResponse>();
    list.mockReturnValueOnce(old.promise).mockResolvedValue({ handoffs: [] });
    const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: group });
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    rerender({ ...group, identity: 'group-b', conversationId: 'group-b' });
    expect(result.current.handoffs).toEqual([]);
    await flush();
    await act(async () => { old.resolve({ handoffs: [handoff()] }); });
    expect(result.current.handoffs).toEqual([]);
    expect(result.current.queryError).toBeUndefined();
  });

  it('isolates a private chat identity switch even when workspace/task/run are unchanged', async () => {
    const old = deferred<ListWaitingBrowserHandoffsResponse>();
    list.mockReturnValueOnce(old.promise).mockResolvedValue({ handoffs: [] });
    const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: privateScope });
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    rerender({ ...privateScope, identity: 'private-b' });
    await flush();
    await act(async () => { old.resolve({ handoffs: [handoff({ conversationId: undefined })] }); });
    expect(result.current.handoffs).toEqual([]);
  });

  it('takes a synchronous decision lock and never replays a failed command', async () => {
    vi.useFakeTimers();
    proceed.mockRejectedValue(new Error('Runtime disconnected after write: EPIPE'));
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    await act(async () => {
      await Promise.all([result.current.decide(handoff(), 'continue'), result.current.decide(handoff(), 'cancel')]);
    });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.actionError).toContain('EPIPE');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('an old decision rejection/finally cannot clear the new group busy lock or add its error', async () => {
    const old = deferred<unknown>();
    const next = deferred<unknown>();
    proceed.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: group });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { void result.current.decide(handoff(), 'continue'); });
    const nextHandoff = handoff({ handoffId: 'handoff-b', conversationId: 'group-b' });
    list.mockResolvedValue({ handoffs: [nextHandoff] });
    rerender({ ...group, identity: 'group-b', conversationId: 'group-b' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => { void result.current.decide(nextHandoff, 'continue'); });
    await act(async () => { old.reject(new Error('previous group failure')); });
    expect(result.current.busyId).toBe('handoff-b');
    expect(result.current.actionError).toBeUndefined();
    expect(list).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve({ status: 'continued' }); });
    expect(result.current.busyId).toBeUndefined();
  });

  it.each(['keep-open', 'close-page'] as const)('maps cancellation %s to its lease disposition', async onCancel => {
    const { result } = renderHook(() => useBrowserHandoffs(group));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => { await result.current.decide(handoff({ onCancel }), 'cancel'); });
    expect(cancel).toHaveBeenCalledWith({ handoffId: 'handoff-a', expectedRevision: 1,
      leaseDisposition: onCancel === 'close-page' ? 'release' : 'preserve' });
  });

  it('unmount cancels retries and removes both event subscriptions', async () => {
    vi.useFakeTimers();
    list.mockRejectedValue(new Error('connection lost'));
    const { unmount } = renderHook(() => useBrowserHandoffs(group));
    await flush();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribeBatch).toHaveBeenCalledTimes(1);
  });
});
it('coalesces event/retry bursts into one trailing read with no concurrent duplicate IPC', async () => {
  const first = deferred<ListWaitingBrowserHandoffsResponse>();
  const second = deferred<ListWaitingBrowserHandoffsResponse>();
  list.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useBrowserHandoffs(group));
  await flush();
  act(() => {
    for (let index = 0; index < 10; index++) {
      eventListener(event('browser.handoff.continued', { conversationId: 'group-a' }));
      void result.current.refresh();
    }
    batchListener([event('collaboration.updated', { conversationId: 'group-a' })]);
  });
  expect(list).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve({ handoffs: [handoff()] }); });
  expect(list).toHaveBeenCalledTimes(2);
  expect(result.current.handoffs).toEqual([]);
  await act(async () => { second.resolve({ handoffs: [] }); });
  expect(result.current.status).toBe('ready');
  expect(list).toHaveBeenCalledTimes(2);
});

it('caps disconnected-read retry frequency at one request per 30 seconds', async () => {
  vi.useFakeTimers();
  list.mockRejectedValue(new Error('Runtime connection unavailable'));
  renderHook(() => useBrowserHandoffs(group));
  await flush();
  let expectedCalls = 1;
  for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1); });
    expect(list).toHaveBeenCalledTimes(expectedCalls);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(list).toHaveBeenCalledTimes(++expectedCalls);
    expect(vi.getTimerCount()).toBe(1);
  }
});

it('preserves the decision lock while the same scope is hidden/inactive and then restored', async () => {
  const pending = deferred<unknown>();
  proceed.mockReturnValueOnce(pending.promise);
  const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: group });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => { void result.current.decide(handoff(), 'continue'); });
  rerender({ ...group, enabled: false });
  rerender(group);
  await flush();
  expect(result.current.busyId).toBe('handoff-a');
  await act(async () => { await result.current.decide(handoff(), 'continue'); });
  expect(proceed).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ status: 'continued' }); });
  expect(result.current.busyId).toBeUndefined();
});

it('isolates stale run responses and errors when the private run changes', async () => {
  const old = deferred<ListWaitingBrowserHandoffsResponse>();
  list.mockReturnValueOnce(old.promise).mockResolvedValue({ handoffs: [] });
  const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: privateScope });
  await flush();
  rerender({ ...privateScope, runId: 'run-b' as BrowserHandoffScope['runId'] });
  await flush();
  await act(async () => { old.reject(new Error('previous run disconnected')); });
  expect(result.current.status).toBe('ready');
  expect(result.current.queryError).toBeUndefined();
});

it('retains both the read failure and decision failure if reconciliation also fails', async () => {
  proceed.mockRejectedValueOnce(new Error('decision timed out'));
  list.mockResolvedValueOnce({ handoffs: [handoff()] }).mockRejectedValue(new Error('durable read rejected'));
  const { result } = renderHook(() => useBrowserHandoffs(group));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => { await result.current.decide(handoff(), 'continue'); });
  expect(result.current.queryError).toBe('durable read rejected');
  expect(result.current.actionError).toContain('decision timed out');
  expect(proceed).toHaveBeenCalledTimes(1);
});

it('preserves a structured error code and message without inventing a transport diagnosis', () => {
  const failure = Object.assign(new Error('Group ownership changed'), { code: 'browser.handoff-binding-invalid' });
  expect(browserHandoffFailureDetails(failure)).toBe('browser.handoff-binding-invalid: Group ownership changed');
});

it('cancels a scheduled read before its microtask starts when the group becomes inactive', async () => {
  const { rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: group });
  rerender({ ...group, enabled: false });
  await flush();
  expect(list).not.toHaveBeenCalled();
});

it('does not lose the reactivation read in the aborted-drain promise settlement gap', async () => {
  const { result, rerender } = renderHook(scope => useBrowserHandoffs(scope), { initialProps: group });
  rerender({ ...group, enabled: false });
  await act(async () => {
    await Promise.resolve();
    rerender(group);
  });
  await flush();
  expect(list).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe('ready');
  expect(result.current.handoffs).toEqual([handoff()]);
});
