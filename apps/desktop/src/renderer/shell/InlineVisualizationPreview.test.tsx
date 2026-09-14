/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'syncThink');
  delete (HTMLElement.prototype as HTMLElement & { executeJavaScript?: unknown }).executeJavaScript;
});

describe('InlineVisualizationPreview', () => {
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

    dispatchGuestMessage(webview, 'sync-think-visualization:ready');
    dispatchGuestMessage(webview, 'sync-think-visualization:height', { height: 320 });
    await waitFor(() => expect(webview.style.height).toBe('320px'));
    await waitFor(() => expect(webview.style.opacity).toBe('1'));
    expect(screen.queryByTestId('inline-visualization-skeleton')).toBeNull();
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
