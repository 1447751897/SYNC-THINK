/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ConversationCompactResponse } from '@sync-think/protocol';
import { useConversationCompaction } from './use-conversation-compaction.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = {
  conversationId: 'a',
  threadId: 'thread-a',
  compacted: true,
  mode: 'manual',
  beforeTokens: 100,
  afterTokens: 20,
  foldedCount: 4,
  durationMs: 100,
} as ConversationCompactResponse;
const threshold = { usageRatio: 0.7, compactThreshold: 0.7 };
type Props = Parameters<typeof useConversationCompaction>[0];
function setup(overrides: Partial<Props> = {}) {
  const compact = vi.fn(async () => result);
  const refresh = vi.fn(async (): Promise<void> => undefined);
  const error = vi.fn();
  const props: Props = {
    conversationId: 'a',
    getCompact: () => compact,
    refreshContextStatus: refresh,
    onManualError: error,
    ...overrides,
  };
  const hook = renderHook((input: Props) => useConversationCompaction(input), {
    initialProps: props,
  });
  return { ...hook, props, compact, refresh, error };
}
function host(type: string, operationId = 'op-a', extra: Record<string, unknown> = {}) {
  return {
    id: `${operationId}:${type}`,
    type,
    occurredAt: new Date().toISOString(),
    payload: { conversationId: 'a', operationId, startedAt: new Date().toISOString(), ...extra },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each([
  ['codex', threshold],
  ['native', undefined],
  ['native', { usageRatio: 0.69, compactThreshold: 0.7 }],
  ['native', { usageRatio: Number.NaN, compactThreshold: 0.7 }],
] as const)(
  'skips auto compaction for kernel %s and ineligible occupancy %j',
  async (kernel, status) => {
    const view = setup();
    await act(async () => view.result.current.runAutoCompact(kernel, status));
    expect(view.compact).not.toHaveBeenCalled();
    expect(view.refresh).not.toHaveBeenCalled();
    expect(view.result.current.compactProgress).toBeNull();
  },
);

it('uses the exact threshold and auto protocol, then releases its lock even if refresh fails', async () => {
  const view = setup();
  view.compact.mockRejectedValueOnce(new Error('compact failed'));
  view.refresh.mockRejectedValueOnce(new Error('refresh failed'));
  await act(async () => view.result.current.runAutoCompact('native', threshold));
  expect(view.compact).toHaveBeenCalledWith({
    conversationId: 'a',
    mode: 'auto',
    onlyIfNeeded: true,
  });
  expect(view.error).not.toHaveBeenCalled();
  expect(view.result.current.compactProgress?.status).toBe('failure');
  expect(view.result.current.isCompacting()).toBe(false);
  await act(async () => view.result.current.runAutoCompact('native', threshold));
  expect(view.compact).toHaveBeenCalledTimes(2);
  expect(view.result.current.compactProgress?.afterTokens).toBe(20);
});

it('does nothing when the host has no compaction port', async () => {
  const view = setup({ getCompact: () => undefined });
  await act(async () => {
    await view.result.current.runManualCompact();
    await view.result.current.runAutoCompact('native', threshold);
  });
  expect(view.result.current.compactProgress).toBeNull();
  expect(view.result.current.isCompacting()).toBe(false);
});

it('holds a single request through refresh and blocks a concurrent manual or auto request', async () => {
  const pending = deferred<ConversationCompactResponse>();
  const refresh = deferred<void>();
  const view = setup();
  view.compact.mockReturnValueOnce(pending.promise);
  view.refresh.mockReturnValueOnce(refresh.promise);
  let request!: Promise<void>;
  act(() => {
    request = view.result.current.runManualCompact();
  });
  await act(async () => {
    await view.result.current.runManualCompact();
    await view.result.current.runAutoCompact('native', threshold);
  });
  expect(view.compact).toHaveBeenCalledTimes(1);
  expect(view.compact).toHaveBeenCalledWith({
    conversationId: 'a',
    mode: 'manual',
    onlyIfNeeded: false,
  });
  await act(async () => pending.resolve(result));
  expect(view.result.current.isCompacting()).toBe(true);
  await act(async () => {
    refresh.resolve();
    await request;
  });
  expect(view.result.current.isCompacting()).toBe(false);
});

it.each([
  [true, 2400, 'success'],
  [false, 1600, 'noop'],
] as const)('dismisses compacted=%s after %s ms', async (compacted, delay, status) => {
  const view = setup();
  view.compact.mockResolvedValueOnce({ ...result, compacted });
  await act(async () => view.result.current.runManualCompact());
  expect(view.result.current.compactProgress?.status).toBe(status);
  act(() => vi.advanceTimersByTime(delay - 1));
  expect(view.result.current.compactProgress).not.toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(view.result.current.compactProgress).toBeNull();
});

it.each(['timeout', 'disk error'])(
  'reports a manual %s and keeps the failure short-lived',
  async (message) => {
    const view = setup();
    view.compact.mockRejectedValueOnce(new Error(message));
    await act(async () => view.result.current.runManualCompact());
    expect(view.error).toHaveBeenCalledWith(
      message === 'timeout'
        ? '上下文压缩超时：模型摘要耗时过长，请稍后重试，或先缩短对话后再压缩'
        : '上下文压缩失败: disk error',
    );
    expect(view.result.current.isCompacting()).toBe(false);
    act(() => vi.advanceTimersByTime(1600));
    expect(view.result.current.compactProgress).toBeNull();
  },
);

it('isolates pending requests across navigation and restores the original conversation lock', async () => {
  const a = deferred<ConversationCompactResponse>();
  const b = deferred<ConversationCompactResponse>();
  const view = setup();
  view.compact.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  let requestA!: Promise<void>;
  let requestB!: Promise<void>;
  act(() => {
    requestA = view.result.current.runManualCompact();
  });
  view.rerender({ ...view.props, conversationId: 'b' });
  expect(view.result.current.compactProgress).toBeNull();
  expect(view.result.current.isCompacting()).toBe(false);
  act(() => {
    requestB = view.result.current.runManualCompact();
  });
  view.rerender(view.props);
  expect(view.result.current.isCompacting()).toBe(true);
  await act(async () => view.result.current.runManualCompact());
  expect(view.compact).toHaveBeenCalledTimes(2);
  view.rerender({ ...view.props, conversationId: 'b' });
  await act(async () => {
    a.reject(new Error('old conversation failure'));
    await requestA;
  });
  expect(view.error).not.toHaveBeenCalled();
  expect(view.result.current.compactProgress?.status).toBe('running');
  expect(view.result.current.isCompacting()).toBe(true);
  await act(async () => {
    b.resolve({ ...result, conversationId: 'b' as typeof result.conversationId });
    await requestB;
  });
  expect(view.result.current.isCompacting()).toBe(false);
});

it('does not let an older dismissal hide a newer running request', async () => {
  const view = setup();
  await act(async () => view.result.current.runManualCompact());
  act(() => vi.advanceTimersByTime(1000));
  const pending = deferred<ConversationCompactResponse>();
  view.compact.mockReturnValueOnce(pending.promise);
  let request!: Promise<void>;
  act(() => {
    request = view.result.current.runManualCompact();
  });
  act(() => vi.advanceTimersByTime(2000));
  expect(view.result.current.compactProgress?.status).toBe('running');
  await act(async () => {
    pending.resolve(result);
    await request;
  });
});

it('keeps host progress authoritative over late RPC echoes and mismatched terminal events', async () => {
  const view = setup();
  const pending = deferred<ConversationCompactResponse>();
  view.compact.mockReturnValueOnce(pending.promise);
  let request!: Promise<void>;
  act(() => {
    request = view.result.current.runManualCompact();
  });
  view.rerender({ ...view.props, hostEvent: host('context.compaction_started', 'new-operation') });
  view.rerender({ ...view.props, hostEvent: host('context.compacted', 'old-operation') });
  expect(view.result.current.compactProgress?.status).toBe('running');
  await act(async () => {
    pending.resolve(result);
    await request;
  });
  expect(view.result.current.compactProgress?.status).toBe('running');
  expect(view.result.current.isCompacting()).toBe(true);
  view.rerender({
    ...view.props,
    hostEvent: host('context.compacted', 'new-operation', { afterTokens: 10 }),
  });
  expect(view.result.current.compactProgress?.afterTokens).toBe(10);
  expect(view.result.current.isCompacting()).toBe(false);
});

it('ignores foreign or historical terminal events and deduplicates host events under StrictMode', async () => {
  const refresh = vi.fn(async () => undefined);
  const props: Props = {
    conversationId: 'a',
    getCompact: () => undefined,
    refreshContextStatus: refresh,
    onManualError: vi.fn(),
    hostEvent: host('context.compacted', 'foreign', { conversationId: 'b' }),
  };
  const view = renderHook((input: Props) => useConversationCompaction(input), {
    initialProps: props,
    wrapper: StrictMode,
  });
  expect(view.result.current.compactProgress).toBeNull();
  view.rerender({
    ...props,
    hostEvent: host('context.compacted', 'old', {
      startedAt: new Date(Date.now() - 16000).toISOString(),
    }),
  });
  expect(view.result.current.compactProgress).toBeNull();
  const event = host('context.compacted', 'current');
  view.rerender({ ...props, hostEvent: event });
  view.rerender({ ...props, hostEvent: { ...event } });
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(2400));
  expect(view.result.current.compactProgress).toBeNull();
});

it('accepts the terminal event for an observed operation that takes more than 15 seconds', () => {
  const view = setup();
  const started = host('context.compaction_started', 'long-operation');
  view.rerender({ ...view.props, hostEvent: started });
  act(() => vi.advanceTimersByTime(20_000));
  view.rerender({
    ...view.props,
    hostEvent: host('context.compacted', 'long-operation', {
      startedAt: started.payload.startedAt,
      afterTokens: 12,
    }),
  });
  expect(view.result.current.compactProgress?.status).toBe('success');
  expect(view.result.current.isCompacting()).toBe(false);
});

it('preserves the dismissal deadline when StrictMode replays initial host effects', () => {
  const refresh = vi.fn(async () => undefined);
  const view = renderHook(
    () =>
      useConversationCompaction({
        conversationId: 'a',
        getCompact: () => undefined,
        refreshContextStatus: refresh,
        onManualError: vi.fn(),
        hostEvent: host('context.compacted'),
      }),
    { wrapper: StrictMode },
  );
  expect(view.result.current.compactProgress?.status).toBe('success');
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(2400));
  expect(view.result.current.compactProgress).toBeNull();
});

it('clears owned timers and avoids new UI timers after unmount while an RPC finishes', async () => {
  const view = setup();
  await act(async () => view.result.current.runManualCompact());
  const pending = deferred<ConversationCompactResponse>();
  view.compact.mockReturnValueOnce(pending.promise);
  let request!: Promise<void>;
  act(() => {
    request = view.result.current.runManualCompact();
  });
  view.unmount();
  await act(async () => {
    pending.resolve(result);
    await request;
  });
  expect(vi.getTimerCount()).toBe(0);
});
