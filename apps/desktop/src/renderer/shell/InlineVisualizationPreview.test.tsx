/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { boardDataHtml } from '@sync-think/shared';
import { InlineVisualizationPreview } from './InlineVisualizationPreview.js';

const readProjectFile = vi.fn();
const executeJavaScript = vi.fn();

function dispatchGuestMessage(webview: HTMLElement, channel: string, payload?: unknown): void {
  const event = new Event('ipc-message') as Event & { channel?: string; args?: unknown[] };
  event.channel = channel;
  event.args = payload === undefined ? [] : [payload];
  webview.dispatchEvent(event);
}

beforeEach(() => {
  readProjectFile.mockResolvedValue({
    path: 'visualizations/demo.html',
    content: '<!doctype html><html><body><main class="viz-root"><h1>Demo</h1></main></body></html>',
    error: null,
    errorCode: null,
    mtimeMs: 1,
    size: 92,
  });
  executeJavaScript.mockResolvedValue(320);
  Object.defineProperty(HTMLElement.prototype, 'executeJavaScript', {
    configurable: true,
    value: executeJavaScript,
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime: { readProjectFile } },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'syncThink');
  delete (HTMLElement.prototype as HTMLElement & { executeJavaScript?: unknown }).executeJavaScript;
});

describe('InlineVisualizationPreview', () => {
  it('keeps video tall enough for its width and resizes without restarting the guest', async () => {
    readProjectFile.mockResolvedValue({ content: '<video controls src="http://127.0.0.1:4318/out/film.mp4"></video>', error: null });
    let resized!: () => void;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized = callback; }
      observe() {}
      disconnect() {}
    });
    try {
      render(<InlineVisualizationPreview file="video/player.html" projectFolder="D:/work/demo" />);
      const webview = await screen.findByTestId('inline-visualization-webview');
      const stage = screen.getByTestId('inline-visualization');
      let width = 1000;
      Object.defineProperty(stage, 'clientWidth', { configurable: true, get: () => width + 16 });
      act(() => {
        resized();
        dispatchGuestMessage(webview, 'sync-think-visualization:height', { height: 120 });
        dispatchGuestMessage(webview, 'sync-think-visualization:ready');
      });
      await waitFor(() => expect(webview.style.height).toBe('563px'));
      const src = webview.getAttribute('src');
      act(() => { width = 640; resized(); });
      await waitFor(() => expect(webview.style.height).toBe('360px'));
      expect(stage.getAttribute('aria-busy')).toBe('false');
      expect(screen.getByTestId('inline-visualization-webview')).toBe(webview);
      expect(webview.getAttribute('src')).toBe(src);
      expect(readProjectFile).toHaveBeenCalledTimes(1);
      // The floor does not discard a taller authored page's heading/footer.
      act(() => dispatchGuestMessage(webview, 'sync-think-visualization:height', { height: 750 }));
      expect(webview.style.height).toBe('750px');
      act(() => {
        width = 320; resized();
        dispatchGuestMessage(webview, 'sync-think-visualization:height', { height: 120 });
      });
      expect(webview.style.height).toBe('180px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not apply the video floor to an ordinary visualization', async () => {
    render(<InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />);
    const webview = await screen.findByTestId('inline-visualization-webview');
    const stage = screen.getByTestId('inline-visualization');
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 1016 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
      dispatchGuestMessage(webview, 'sync-think-visualization:height', { height: 120 });
      dispatchGuestMessage(webview, 'sync-think-visualization:ready');
    });
    expect(webview.style.height).toBe('120px');
  });

  it('shows a skeleton, reads the project HTML, and sizes from the guest report', async () => {
    render(
      <InlineVisualizationPreview
        file="visualizations/demo.html"
        projectFolder="D:/work/demo"
        conversationId="conv-1"
      />,
    );
    expect(screen.getByTestId('inline-visualization-skeleton')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('inline-visualization-webview')).toBeTruthy());
    expect(readProjectFile).toHaveBeenCalledWith({
      root: 'D:/work/demo',
      path: 'visualizations/demo.html',
    });
    const webview = screen.getByTestId('inline-visualization-webview') as HTMLElement;
    expect(webview.getAttribute('data-visualization-conversation-id')).toBe('conv-1');
    expect(webview.getAttribute('partition')).toMatch(/^sync-think-visualization-[a-z0-9]+$/i);
    expect(webview.getAttribute('webpreferences')).toBe(
      'sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes',
    );
    expect(executeJavaScript).not.toHaveBeenCalled();
    expect(screen.getByTestId('inline-visualization-skeleton')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();

    // The hook sets src only after registering guest listeners. DOM insertion alone
    // can beat that effect when the suite runs alongside the heavier ChatView tests.
    await waitFor(() => expect(webview.getAttribute('src')).toMatch(/^data:text\/html/));
    act(() => {
      dispatchGuestMessage(webview, 'sync-think-visualization:ready');
      dispatchGuestMessage(webview, 'sync-think-visualization:height', { height: 320 });
    });
    await waitFor(() => expect(webview.style.height).toBe('320px'));
    await waitFor(() => expect(webview.style.opacity).toBe('1'));
    expect(screen.queryByTestId('inline-visualization-skeleton')).toBeNull();
  });

  it('times out a guest without its ready handshake and retains an accessible source preview', async () => {
    vi.useFakeTimers();
    await act(async () => { render(<InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />); });
    const webview = screen.getByTestId('inline-visualization-webview');
    // dom-ready alone does not prove that the measurement preload initialized.
    fireEvent(webview, new Event('dom-ready'));
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert').textContent).toContain('预览初始化超时');
    expect(screen.queryByTestId('inline-visualization-skeleton')).toBeNull();
    expect(screen.getByText('查看静态预览与源码')).toBeTruthy();
    expect(screen.getByTitle('HTML 预览').getAttribute('srcdoc')).toContain('Demo');
    act(() => dispatchGuestMessage(webview, 'sync-think-visualization:ready'));
    expect(screen.getByRole('alert').textContent).toContain('预览初始化超时');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await act(async () => {});
    const retry = screen.getByTestId('inline-visualization-webview');
    act(() => dispatchGuestMessage(retry, 'sync-think-visualization:ready'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(retry.style.opacity).toBe('1');
  });

  it('clears the startup deadline after ready and when the source is replaced', async () => {
    vi.useFakeTimers();
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(<InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />); });
    act(() => vi.advanceTimersByTime(10_000));
    await act(async () => { view.rerender(<InlineVisualizationPreview file="visualizations/next.html" projectFolder="D:/work/demo" />); });
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => dispatchGuestMessage(screen.getByTestId('inline-visualization-webview'), 'sync-think-visualization:ready'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('offers a retry for missing files and keeps loading until the retried guest is ready', async () => {
    readProjectFile.mockResolvedValueOnce({
      path: 'visualizations/demo.html',
      content: null,
      error: '文件不存在',
      errorCode: 'file_not_found',
      mtimeMs: null,
      size: null,
    });
    render(
      <InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />,
    );
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('文件不存在'));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    const webview = await screen.findByTestId('inline-visualization-webview');
    expect(readProjectFile).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('inline-visualization-skeleton')).toBeTruthy();
    act(() => dispatchGuestMessage(webview, 'sync-think-visualization:ready'));
    expect(screen.queryByTestId('inline-visualization-skeleton')).toBeNull();
  });

  it('surfaces a guest failure with a retry action', async () => {
    render(
      <InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />,
    );
    const webview = (await waitFor(() =>
      screen.getByTestId('inline-visualization-webview'),
    )) as HTMLElement;

    dispatchGuestMessage(webview, 'sync-think-visualization:error', { message: '脚本异常' });

    expect(await screen.findByText('脚本异常')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.queryByTestId('inline-visualization-webview')).toBeNull();
  });

  it('opens the original source file from the static fallback after a guest failure', async () => {
    const open = vi.fn();
    render(<InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" onOpenInBrowser={open} />);
    const guest = await screen.findByTestId('inline-visualization-webview');
    act(() => dispatchGuestMessage(guest, 'sync-think-visualization:error', { message: '脚本异常' }));
    fireEvent.click(screen.getByText('查看静态预览与源码'));
    fireEvent.click(screen.getByRole('button', { name: '浏览器打开' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining('<h1>Demo</h1>'), { relativePath: 'visualizations/demo.html', persist: false }));
  });

  it('recovers a native load failure without an error payload by rereading and remounting', async () => {
    render(
      <InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />,
    );
    const original = await screen.findByTestId('inline-visualization-webview');
    fireEvent(original, new Event('did-fail-load'));
    expect(screen.getByRole('alert').textContent).toContain('可视化加载失败');
    expect(screen.queryByTestId('inline-visualization-webview')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    const retried = await screen.findByTestId('inline-visualization-webview');
    expect(retried).not.toBe(original);
    expect(readProjectFile).toHaveBeenCalledTimes(2);
    act(() => dispatchGuestMessage(retried, 'sync-think-visualization:ready'));
    expect(retried.style.opacity).toBe('1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('handles immediate navigation events and does not navigate again on guest state changes', async () => {
    const setAttribute = HTMLElement.prototype.setAttribute;
    const navigations: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'setAttribute').mockImplementation(function (
      this: HTMLElement,
      name,
      value,
    ) {
      setAttribute.call(this, name, value);
      if (this.tagName !== 'WEBVIEW' || name !== 'src') return;
      navigations.push(value);
      this.dispatchEvent(new Event('dom-ready'));
      dispatchGuestMessage(this, 'sync-think-visualization:height', { height: 345 });
      dispatchGuestMessage(this, 'sync-think-visualization:ready');
    });
    const { rerender } = render(
      <InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />,
    );
    const webview = await screen.findByTestId('inline-visualization-webview');
    await waitFor(() => expect(webview.style.opacity).toBe('1'));
    expect(webview.style.height).toBe('345px');
    expect(navigations).toHaveLength(1);
    rerender(
      <InlineVisualizationPreview file="visualizations/demo.html" projectFolder="D:/work/demo" />,
    );
    expect(navigations).toHaveLength(1);
  });

  it('loads an empty document and ignores stale file responses after a conversation change', async () => {
    let resolvePrevious!: (value: unknown) => void;
    readProjectFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrevious = resolve;
        }),
    );
    readProjectFile.mockResolvedValueOnce({ content: '', error: null });
    const { rerender } = render(
      <InlineVisualizationPreview
        file="visualizations/demo.html"
        projectFolder="D:/work/demo"
        conversationId="old"
      />,
    );
    rerender(
      <InlineVisualizationPreview
        file="visualizations/demo.html"
        projectFolder="D:/work/demo"
        conversationId="new"
      />,
    );
    const webview = await screen.findByTestId('inline-visualization-webview');
    const currentSource = webview.getAttribute('src');
    await act(async () => resolvePrevious({ content: '<h1>stale</h1>', error: null }));
    expect(webview.getAttribute('src')).toBe(currentSource);
    expect(decodeURIComponent(currentSource ?? '')).not.toContain('stale');
  });
});

describe('saved local data documents', () => {
  const html = boardDataHtml({
    title: '本地数据',
    components: [
      { type: 'gauge', title: '进度', value: 4, max: 8 },
      { type: 'stats', title: '汇总', items: [{ label: '数量', value: 4 }] },
    ],
  });
  it('uses independent inline cards for local data HTML rather than one scrolling page', async () => {
    readProjectFile.mockResolvedValueOnce({ content: html, error: null });
    render(
      <InlineVisualizationPreview file="visualizations/data.html" projectFolder="D:/work/demo" />,
    );
    expect(await screen.findAllByTestId('board-data-block')).toHaveLength(2);
    expect(screen.queryByTestId('inline-visualization-webview')).toBeNull();
    expect(executeJavaScript).not.toHaveBeenCalled();
  });
  it('keeps the portable renderer when opening an inert saved data document', async () => {
    readProjectFile.mockResolvedValueOnce({ content: html, error: null });
    const open = vi.fn();
    render(<InlineVisualizationPreview file="visualizations/data.html" projectFolder="D:/work/demo" onOpenInBrowser={open} />);
    const button = await screen.findByRole('button', { name: '浏览器打开' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringContaining('sync-think-board-data-runtime')));
  });

  it('retains the original isolated design-file path for explicit custom layouts', async () => {
    readProjectFile.mockResolvedValueOnce({
      content:
        '<main data-boardui-layout="custom">' +
        html +
        '</main><script>window.designInteraction=true</script>',
      error: null,
    });
    render(
      <InlineVisualizationPreview file="visualizations/design.html" projectFolder="D:/work/demo" />,
    );
    const guest = await screen.findByTestId('inline-visualization-webview');
    await waitFor(() => expect(guest.getAttribute('src')).toMatch(/^data:text/));
    expect(decodeURIComponent(guest.getAttribute('src')!)).toContain('designInteraction');
    expect(screen.queryByTestId('board-data-block')).toBeNull();
  });
});
