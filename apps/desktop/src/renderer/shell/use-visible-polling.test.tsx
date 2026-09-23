/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeepAliveLayer } from './KeepAliveLayer.js';
import { useVisiblePolling } from './use-visible-polling.js';

function setDocumentVisibility(value: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function flushPromises(): Promise<void> {
  await act(async () => Promise.resolve());
}

beforeEach(() => {
  vi.useFakeTimers();
  setDocumentVisibility('visible');
});

afterEach(() => {
  cleanup();
  setDocumentVisibility('visible');
  vi.useRealTimers();
});

describe('useVisiblePolling', () => {
  it('runs immediately and never overlaps an in-flight request', async () => {
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const poll = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);

    renderHook(() => useVisiblePolling(poll, { intervalMs: 1_000 }));
    await flushPromises();
    expect(poll).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(10_000));
    expect(poll).toHaveBeenCalledTimes(1);

    finishFirst();
    await flushPromises();
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('pauses while the document is hidden and refreshes when it becomes visible', async () => {
    setDocumentVisibility('hidden');
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useVisiblePolling(poll, { intervalMs: 1_000 }));
    await flushPromises();
    expect(poll).not.toHaveBeenCalled();

    act(() => setDocumentVisibility('visible'));
    await flushPromises();
    expect(poll).toHaveBeenCalledTimes(1);

    act(() => setDocumentVisibility('hidden'));
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('backs off after failures and resets to the normal interval after recovery', async () => {
    const onError = vi.fn();
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    renderHook(() =>
      useVisiblePolling(poll, { intervalMs: 1_000, maxIntervalMs: 8_000, onError }),
    );
    await flushPromises();
    expect(onError).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTime(1_999));
    expect(poll).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(poll).toHaveBeenCalledTimes(2);
    await flushPromises();

    await act(async () => vi.advanceTimersByTime(1_000));
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('refreshes immediately when the polled resource identity changes', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(
      ({ resourceId }) =>
        useVisiblePolling(poll, { intervalMs: 30_000, refreshKey: resourceId }),
      { initialProps: { resourceId: 'conversation-a' } },
    );
    await flushPromises();
    expect(poll).toHaveBeenCalledTimes(1);

    view.rerender({ resourceId: 'conversation-b' });
    await flushPromises();
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('pauses inside an inactive KeepAlive surface and refreshes on reactivation', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    function Probe() {
      useVisiblePolling(poll, { intervalMs: 1_000 });
      return null;
    }
    const view = render(
      <KeepAliveLayer active>
        <Probe />
      </KeepAliveLayer>,
    );
    await flushPromises();
    expect(poll).toHaveBeenCalledTimes(1);

    view.rerender(
      <KeepAliveLayer active={false}>
        <Probe />
      </KeepAliveLayer>,
    );
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(poll).toHaveBeenCalledTimes(1);

    view.rerender(
      <KeepAliveLayer active>
        <Probe />
      </KeepAliveLayer>,
    );
    await flushPromises();
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
