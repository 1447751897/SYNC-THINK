/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ ready: vi.fn(() => false), load: vi.fn() }));
vi.mock('./board-data-font-loader.js', () => ({
  boardDataFontReady: mocks.ready,
  loadBoardDataFont: mocks.load,
}));
import { useBoardDataFont } from './use-board-data-font.js';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.ready.mockReturnValue(false);
});
describe('on-demand data font', () => {
  it('does not load fonts for ordinary prose or incomplete streamed data', () => {
    const h = renderHook(() => useBoardDataFont(false));
    expect(h.result.current.ready).toBe(true);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('waits for the shared font before mounting a data preview', async () => {
    let finish: () => void = () => {};
    mocks.load.mockImplementation(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    const h = renderHook(() => useBoardDataFont(true));
    expect(h.result.current.ready).toBe(false);
    await act(async () => finish());
    await waitFor(() => expect(h.result.current.ready).toBe(true));
  });
  it('reports a load error and retries without leaving the chat blank', async () => {
    mocks.load
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce(undefined);
    const h = renderHook(() => useBoardDataFont(true));
    await waitFor(() => expect(h.result.current.error).toContain('字体加载失败'));
    act(() => h.result.current.retry());
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    expect(h.result.current.error).toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
});
