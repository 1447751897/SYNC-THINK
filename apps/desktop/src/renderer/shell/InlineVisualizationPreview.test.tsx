/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InlineVisualizationPreview } from './InlineVisualizationPreview.js';

const readProjectFile = vi.fn();
const executeJavaScript = vi.fn();

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
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'syncThink');
  delete (HTMLElement.prototype as HTMLElement & { executeJavaScript?: unknown }).executeJavaScript;
});

describe('InlineVisualizationPreview', () => {
  it('shows a skeleton, reads the project HTML, and measures the guest preview', async () => {
    render(
      <InlineVisualizationPreview
        file="visualizations/demo.html"
        projectFolder="D:/work/demo"
        conversationId="conv-1"
      />,
    );
    expect(screen.getByTestId('inline-visualization-skeleton')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('inline-visualization-webview')).toBeTruthy());
    expect(readProjectFile).toHaveBeenCalledWith({ root: 'D:/work/demo', path: 'visualizations/demo.html' });
    expect(screen.getByTestId('inline-visualization-webview').getAttribute('data-visualization-conversation-id')).toBe('conv-1');
    await waitFor(() => expect(executeJavaScript).toHaveBeenCalled());
  });

  it('offers source view, browser-open, retry, and a clear missing-file state', async () => {
    const onOpenInBrowser = vi.fn();
    render(
      <InlineVisualizationPreview
        file="visualizations/demo.html"
        projectFolder="D:/work/demo"
        onOpenInBrowser={onOpenInBrowser}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('inline-visualization-webview')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '源码' }));
    expect(screen.getAllByText('Demo', { exact: false }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    fireEvent.click(screen.getByRole('button', { name: '在浏览器中打开' }));
    await waitFor(() =>
      expect(onOpenInBrowser).toHaveBeenCalledWith(expect.stringContaining('Demo'), {
        relativePath: 'visualizations/demo.html',
        persist: false,
      }),
    );

    readProjectFile.mockResolvedValueOnce({
      path: 'visualizations/demo.html',
      content: null,
      error: '文件不存在',
      errorCode: 'file_not_found',
      mtimeMs: null,
      size: null,
    });
    fireEvent.click(screen.getByRole('button', { name: '重新加载可视化' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('文件不存在'));
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
