/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationNavigationController } from './use-conversation-navigation-controller.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function fixture(scopeKey = 'conversation-a') {
  const scroller = document.createElement('div');
  scroller.scrollTop = 100;
  const loaded = new Set<string>();
  const loadAround = vi.fn(async () => true);
  const onRenderTarget = vi.fn();
  const onNavigationStart = vi.fn();
  const writeProgrammaticScroll = vi.fn((target: HTMLDivElement, scrollTop: number) => {
    target.scrollTop = scrollTop;
  });
  const options = {
    scopeKey,
    scrollerRef: { current: scroller },
    isMessageLoaded: (messageId: string) => loaded.has(messageId),
    loadAround,
    onRenderTarget,
    onNavigationStart,
    writeProgrammaticScroll,
  };
  const view = renderHook(
    (props: typeof options) => useConversationNavigationController(props),
    { initialProps: options },
  );
  return {
    ...view,
    scroller,
    loaded,
    loadAround,
    onRenderTarget,
    onNavigationStart,
    writeProgrammaticScroll,
    options,
  };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('conversation navigation controller', () => {
  it('reveals an already loaded target without starting a page request', async () => {
    const view = fixture();
    view.loaded.add('message-1');
    await act(async () => {
      await view.result.current.loadTarget('message-1', () => true);
    });
    expect(view.onRenderTarget).toHaveBeenCalledWith('message-1');
    expect(view.loadAround).not.toHaveBeenCalled();
    expect(view.onNavigationStart).not.toHaveBeenCalled();
    expect(view.result.current.loadingTarget).toBeUndefined();
  });

  it('owns target loading and lets only the newest request clear its status', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const view = fixture();
    view.loadAround.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let firstPending!: Promise<boolean>;
    let secondPending!: Promise<boolean>;
    act(() => {
      firstPending = view.result.current.loadTarget('message-1', () => true);
      secondPending = view.result.current.loadTarget('message-2', () => true);
    });
    expect(view.result.current.loadingTarget).toBe('message-2');
    await act(async () => {
      first.resolve(true);
      await firstPending;
    });
    expect(view.result.current.loadingTarget).toBe('message-2');
    await act(async () => {
      second.resolve(false);
      await secondPending;
    });
    expect(view.result.current.loadingTarget).toBeUndefined();
    expect(view.onRenderTarget).toHaveBeenLastCalledWith(undefined);
    expect(view.onNavigationStart).toHaveBeenCalledTimes(2);
  });

  it('hides an old scope loading state immediately and invalidates its intent', async () => {
    const pending = deferred<boolean>();
    const view = fixture();
    view.loadAround.mockReturnValueOnce(pending.promise);
    let request!: Promise<boolean>;
    act(() => {
      request = view.result.current.loadTarget('message-1', () => true);
    });
    const oldIntent = view.result.current.captureIntent();
    expect(view.result.current.loadingTarget).toBe('message-1');
    view.rerender({ ...view.options, scopeKey: 'conversation-b' });
    expect(view.result.current.loadingTarget).toBeUndefined();
    expect(view.result.current.isIntentCurrent(oldIntent)).toBe(false);
    await act(async () => {
      pending.resolve(false);
      await request;
    });
  });

  it('writes an immediate frame for reduced motion and advances the navigation intent', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const view = fixture();
    const previousIntent = view.result.current.captureIntent();
    act(() => view.result.current.navigate('message-1', 420));
    expect(view.writeProgrammaticScroll).toHaveBeenCalledWith(view.scroller, 420);
    expect(view.scroller.scrollTop).toBe(420);
    expect(view.onNavigationStart).toHaveBeenCalledTimes(1);
    expect(view.result.current.isIntentCurrent(previousIntent)).toBe(false);
  });

  it('re-aims one running slide and cancels it on stop', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
      frames.delete(frame);
    });
    const view = fixture();
    act(() => {
      view.result.current.navigate('message-1', 500);
      view.result.current.navigate('message-1', 700);
    });
    expect(frames.size).toBe(1);
    const firstFrame = [...frames.entries()][0]!;
    frames.delete(firstFrame[0]);
    act(() => firstFrame[1](0));
    const secondFrame = [...frames.entries()][0]!;
    frames.delete(secondFrame[0]);
    act(() => secondFrame[1](500));
    expect(view.writeProgrammaticScroll).toHaveBeenLastCalledWith(view.scroller, 700);

    act(() => view.result.current.navigate('message-2', 200));
    act(() => view.result.current.stop());
    expect(cancel).toHaveBeenCalled();
  });
});
