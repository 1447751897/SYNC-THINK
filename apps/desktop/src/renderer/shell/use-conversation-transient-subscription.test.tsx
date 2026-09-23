/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationTransientFrame } from '@sync-think/protocol';
import type { RunId, ThreadId } from '@sync-think/shared';
import {
  useConversationTransientSubscription,
  type ConversationTransientSubscriptionEvent,
} from './use-conversation-transient-subscription.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function frame(runId = 'run-a', streamSequence = 1): ConversationTransientSubscriptionEvent {
  return {
    type: 'frame',
    frame: {
      threadId: 'thread-a' as ThreadId,
      runId: runId as RunId,
      streamSequence,
      occurredAt: '2026-09-19T00:00:00.000Z',
      kind: 'text',
      text: 'hello',
    } as ConversationTransientFrame,
  };
}

function fixture(enabled = true) {
  const ready = deferred<{ subscriptionId: string }>();
  const listeners: Array<(event: ConversationTransientSubscriptionEvent) => void> = [];
  const unsubscribe = vi.fn(async () => undefined);
  const subscribe = vi.fn((_payload, listener) => {
    listeners.push(listener);
    return { ready: ready.promise, unsubscribe };
  });
  const callbacks = {
    getAfterStreamSequence: vi.fn(() => 7),
    onStarted: vi.fn(),
    onEvent: vi.fn(),
    onFailure: vi.fn(),
    onDispose: vi.fn(),
  };
  const options = {
    scopeKey: 'conversation-a',
    threadId: 'thread-a',
    enabled,
    subscribe,
    ...callbacks,
  };
  const view = renderHook(
    (props: typeof options) => useConversationTransientSubscription(props),
    { initialProps: options },
  );
  return { ...view, ready, listeners, unsubscribe, subscribe, callbacks, options };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('conversation transient subscription lifecycle', () => {
  it('does not subscribe until the resolved thread belongs to the active scope', () => {
    const view = fixture(false);
    expect(view.subscribe).not.toHaveBeenCalled();
    expect(view.callbacks.onStarted).not.toHaveBeenCalled();
    view.rerender({ ...view.options, enabled: true });
    expect(view.subscribe).toHaveBeenCalledWith(
      { threadId: 'thread-a', afterStreamSequence: 7 },
      expect.any(Function),
    );
    expect(view.callbacks.onStarted).toHaveBeenCalledTimes(1);
  });

  it('forwards live events and uses updated callbacks without resubscribing', () => {
    const view = fixture();
    const replacement = vi.fn();
    view.rerender({ ...view.options, onEvent: replacement });
    act(() => view.listeners[0]!(frame()));
    expect(replacement).toHaveBeenCalledWith(frame());
    expect(view.callbacks.onEvent).not.toHaveBeenCalled();
    expect(view.subscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes a previous scope and ignores its late events', () => {
    const view = fixture();
    const oldListener = view.listeners[0]!;
    view.rerender({
      ...view.options,
      scopeKey: 'conversation-b',
      threadId: 'thread-b',
    });
    expect(view.unsubscribe).toHaveBeenCalledTimes(1);
    expect(view.callbacks.onDispose).toHaveBeenCalledTimes(1);
    expect(view.subscribe).toHaveBeenCalledTimes(2);
    act(() => oldListener(frame('old-run', 8)));
    expect(view.callbacks.onEvent).not.toHaveBeenCalled();
    act(() => view.listeners[1]!(frame('new-run', 9)));
    expect(view.callbacks.onEvent).toHaveBeenCalledWith(frame('new-run', 9));
  });

  it('falls back only when the current subscription readiness fails', async () => {
    const view = fixture();
    await act(async () => {
      view.ready.reject(new Error('subscribe failed'));
      await Promise.resolve();
    });
    expect(view.callbacks.onFailure).toHaveBeenCalledTimes(1);

    const stale = fixture();
    stale.unmount();
    await act(async () => {
      stale.ready.reject(new Error('late failure'));
      await Promise.resolve();
    });
    expect(stale.callbacks.onFailure).not.toHaveBeenCalled();
  });

  it('cleans display resources and transport exactly once on unmount', () => {
    const view = fixture();
    view.unmount();
    expect(view.callbacks.onDispose).toHaveBeenCalledTimes(1);
    expect(view.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
