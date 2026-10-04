/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HtmlSandbox } from './HtmlSandbox.js';
import { HTML_PREVIEW_SIZE_MESSAGE, HTML_PREVIEW_VIEWPORT_MESSAGE } from './html-preview-sizing.js';

const executeJavaScript = vi.fn();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('HtmlSandbox', () => {
  it('uses an adaptive isolated iframe without Electron guest execution', () => {
    render(<HtmlSandbox code={'<main style="height:412px">content</main>'} />);

    const content = screen.getByTestId('html-sandbox-content');
    const iframe = content.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('title')).toBe('HTML 预览');
    expect(executeJavaScript).not.toHaveBeenCalled();
    expect(screen.queryByTestId('html-sandbox')).toBeNull();
    expect(screen.queryByText('UI 设计资源格式无效，请让模型重新生成')).toBeNull();
  });

  it('defaults to a full-width auto-height document like an agent visualization and keeps fit as an explicit option', () => {
    vi.stubGlobal('innerHeight', 800);
    render(<HtmlSandbox code={'<main style="height:1800px">whole document</main>'} />);
    const content = screen.getByTestId('html-sandbox-content');
    const iframe = content.querySelector('iframe')!;
    const documentId = new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
      .querySelector('script[data-html-preview-sizing]')!.getAttribute('data-html-preview-sizing');
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: { type: HTML_PREVIEW_SIZE_MESSAGE, documentId, width: 1024, height: 1800 },
    })));
    expect(content.dataset.previewSizing).toBe('content');
    expect(screen.getByRole('button', { name: '完整显示' }).getAttribute('aria-pressed')).toBe('true');
    expect(content.style.height).toBe('1804px');
    expect(iframe.style.height).toBe('1800px');
    expect(iframe.style.transform).toBe('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(content.style.height).toBe('604px');
    expect(iframe.style.transform).toBe('scale(' + 1 / 3 + ')');
    fireEvent.click(screen.getByRole('button', { name: '完整显示' }));
    expect(content.style.height).toBe('1804px');
  });

  it('fits a complete short page and reacts to window resizing', () => {
    vi.stubGlobal('innerHeight', 800);
    render(<HtmlSandbox code={'<main style="height:850px">scene</main>'} />);
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    const content = screen.getByTestId('html-sandbox-content');
    const iframe = content.querySelector('iframe')!;
    const doc = new DOMParser().parseFromString(iframe.srcdoc, 'text/html');
    const documentId = doc.querySelector('script[data-html-preview-sizing]')!.getAttribute('data-html-preview-sizing');
    const report = (height: number, overrides = {}, source = iframe.contentWindow) =>
      act(() => window.dispatchEvent(new MessageEvent('message', {
        source,
        data: { type: HTML_PREVIEW_SIZE_MESSAGE, documentId, width: 1024, height, ...overrides },
      })));

    report(850);
    expect(content.style.height).toBe('604px');
    expect(iframe.style.height).toBe('850px');
    expect(iframe.style.transform).toBe('scale(' + 600 / 850 + ')');

    vi.stubGlobal('innerHeight', 650);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(content.style.height).toBe('454px');
    expect(iframe.style.transform).toBe('scale(' + 450 / 850 + ')');

    fireEvent.click(screen.getByRole('button', { name: '原始大小' }));
    expect(content.dataset.previewSizing).toBe('actual');
    expect(content.style.height).toBe('854px');
    expect(iframe.style.transform).toBe('scale(1)');
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(content.dataset.previewSizing).toBe('fit');
    expect(content.style.height).toBe('454px');

    report(200, {}, window);
    report(200, { documentId: 'stale-document' });
    report(Number.NaN);
    report(Number.POSITIVE_INFINITY);
    report(0);
    report(1_000_000);
    report(200, { width: Number.NaN });
    report(200, { width: Number.POSITIVE_INFINITY });
    report(200, { width: 0 });
    report(200, { width: 1_000_000 });
    expect(content.style.height).toBe('454px');

    report(240);
    expect(content.style.height).toBe('244px');
    expect(iframe.style.transform).toBe('scale(1)');
    report(8000);
    expect(content.style.height).toBe('454px');
    expect(iframe.style.height).toBe('8000px');
    expect(iframe.style.transform).toBe('scale(' + 450 / 8000 + ')');
  });

  it('fits wide content, tracks panel resizing, and cleans up its resize observer', () => {
    vi.stubGlobal('innerHeight', 800);
    let panelWidth = 608;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => panelWidth);
    const observe = vi.fn();
    const disconnect = vi.fn();
    let resizePanel: (() => void) | undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resizePanel = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const { unmount } = render(<HtmlSandbox code={'<main style="width:1800px;height:400px">wide scene</main>'} />);
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    const content = screen.getByTestId('html-sandbox-content');
    const iframe = content.querySelector('iframe')!;
    const documentId = new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
      .querySelector('script[data-html-preview-sizing]')!.getAttribute('data-html-preview-sizing');
    const report = () => act(() => window.dispatchEvent(new MessageEvent('message', {
      source: iframe.contentWindow,
      data: { type: HTML_PREVIEW_SIZE_MESSAGE, documentId, width: 1800, height: 400 },
    })));
    expect(observe).toHaveBeenCalledWith(content);
    report();
    expect(iframe.style.width).toBe('1800px');
    expect(iframe.style.height).toBe('400px');
    expect(iframe.style.transform).toBe('scale(' + 1 / 3 + ')');
    expect(content.style.height).toBe('138px');

    panelWidth = 908;
    act(() => resizePanel!());
    expect(iframe.style.width).toBe('900px');
    report();
    expect(iframe.style.transform).toBe('scale(0.5)');
    expect(content.style.height).toBe('204px');
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('sends a stable viewport height after load and simultaneous width/height resizing without reloading HTML', () => {
    vi.stubGlobal('innerHeight', 800);
    let panelWidth = 608;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => panelWidth);
    render(<HtmlSandbox code={'<main style="min-height:100vh">scene</main>'} />);
    const iframe = screen.getByTestId('html-sandbox-content').querySelector('iframe')!;
    const source = iframe.srcdoc;
    const documentId = new DOMParser().parseFromString(source, 'text/html')
      .querySelector('script[data-html-preview-sizing]')!.getAttribute('data-html-preview-sizing');
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    fireEvent.load(iframe);
    expect(post).toHaveBeenLastCalledWith({ type: HTML_PREVIEW_VIEWPORT_MESSAGE, documentId, height: 600 }, '*');
    panelWidth = 408;
    vi.stubGlobal('innerHeight', 500);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(post).toHaveBeenLastCalledWith({ type: HTML_PREVIEW_VIEWPORT_MESSAGE, documentId, height: 300 }, '*');
    expect(iframe.srcdoc).toBe(source);
    expect(iframe.style.width).toBe('400px');
  });

  it('resets sizing on source changes and keeps preview controls through source/collapse switches', () => {
    vi.stubGlobal('innerHeight', 800);
    const { rerender } = render(<HtmlSandbox code={'<main>first</main>'} />);
    const first = screen.getByTestId('html-sandbox-content').querySelector('iframe')!;
    const id = new DOMParser().parseFromString(first.srcdoc, 'text/html')
      .querySelector('script[data-html-preview-sizing]')!.getAttribute('data-html-preview-sizing');
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: first.contentWindow,
      data: { type: HTML_PREVIEW_SIZE_MESSAGE, documentId: id, width: 1024, height: 900 },
    })));
    expect(first.style.height).toBe('900px');
    rerender(<HtmlSandbox code={'<main>second</main>'} />);
    const updated = screen.getByTestId('html-sandbox-content').querySelector('iframe')!;
    expect(updated.srcdoc).toContain('second');
    expect(updated.style.height).toBe('420px');
    act(() => window.dispatchEvent(new MessageEvent('message', {
      source: updated.contentWindow,
      data: { type: HTML_PREVIEW_SIZE_MESSAGE, documentId: id, width: 1024, height: 900 },
    })));
    expect(updated.style.height).toBe('420px');
    fireEvent.click(screen.getByRole('button', { name: '源码' }));
    expect(screen.queryByTestId('html-sandbox-content')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    expect(screen.getByTestId('html-sandbox-content')).toBeTruthy();
    fireEvent.click(screen.getByTitle('收起 HTML 预览'));
    expect(screen.queryByTestId('html-sandbox-content')).toBeNull();
    fireEvent.click(screen.getByTitle('展开 HTML 预览'));
    expect(screen.getByTestId('html-sandbox-content')).toBeTruthy();
  });

  it('previews unfinished HTML instead of showing a format-invalid card', () => {
    render(<HtmlSandbox code={'<main><section>unfinished'} />);

    const iframe = screen.getByTestId('html-sandbox-content').querySelector('iframe');
    expect(iframe?.getAttribute('srcdoc')).toContain('unfinished');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the source and preview shell available for fenced HTML', () => {
    render(<HtmlSandbox code={'<main>content</main>'} />);

    expect(screen.getByTestId('html-sandbox-content')).toBeTruthy();
    expect(screen.getByRole('button', { name: '源码' })).toBeTruthy();
    expect(screen.getByText('HTML')).toBeTruthy();
  });
});
