/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserPanel,
  browserGuestBox,
  browserZoomStepFromWheel,
  guestBrowserZoomBridgeScript,
  normalizeBrowserInput,
  parseGuestZoomDelta,
} from './BrowserPanel.js';

const shellCss = readFileSync(resolve(process.cwd(), 'src/renderer/shell/shell.css'), 'utf8');

const webviewMethods = {
  canGoBack: vi.fn(() => false),
  canGoForward: vi.fn(() => false),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  getURL: vi.fn(() => 'https://example.test'),
  getWebContentsId: vi.fn(() => 42),
  executeJavaScript: vi.fn().mockResolvedValue(800),
  setZoomFactor: vi.fn(),
  findInPage: vi.fn(),
  stopFindInPage: vi.fn(),
  print: vi.fn(),
};

function attachWebviewMethods() {
  const webview = screen.getByTestId('browser-panel').querySelector('webview') as HTMLElement;
  Object.assign(webview, webviewMethods);
  webview.dispatchEvent(new Event('dom-ready'));
  webview.dispatchEvent(new Event('did-stop-loading'));
  return webview;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'syncThink', { configurable: true, value: undefined });
});

describe('BrowserPanel layout contract', () => {
  it('uses NewMax blank-tab semantics for empty address input', () => {
    expect(normalizeBrowserInput('')).toBe('about:blank');
    expect(normalizeBrowserInput('   ')).toBe('about:blank');
  });

  it('preserves tokenized local-page URLs when re-entered in the address bar', () => {
    const url = 'newmax-local-web://token/index.html';
    expect(normalizeBrowserInput(url)).toBe(url);
  });

  it('fills a flex pane host instead of shrinking to the toolbar width', () => {
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByTestId('browser-panel');
    expect(panel.classList.contains('flex-1')).toBe(true);
    expect(panel.classList.contains('min-w-0')).toBe(true);
    expect(panel.classList.contains('min-h-0')).toBe(true);
    expect(panel.classList.contains('h-full')).toBe(true);
  });

  it('keeps the guest on a remaining-height flex chain instead of the 150px intrinsic box', () => {
    expect(browserGuestBox({ width: 960, height: 720 })).toEqual({ width: 960, height: 720 });
    expect(browserGuestBox({ width: 0, height: 720 })).toBeNull();
    expect(shellCss).toMatch(/\.shell-pane-canvas\s*\{[\s\S]*?flex-direction:\s*column;/);
    expect(shellCss).toMatch(
      /\.shell-pane-surface\[data-active='true'\]\s*\{[\s\S]*?height:\s*100%;/,
    );
    expect(shellCss).toMatch(/\.shell-browser__canvas\s*\{[\s\S]*?flex:\s*1 1 0;/);
    expect(shellCss).toMatch(/\.shell-browser__viewport\s*\{[\s\S]*?height:\s*100%;/);
    expect(shellCss).toMatch(/\.shell-browser__webview\s*\{[\s\S]*?min-height:\s*100%;/);
  });

  it('copies the viewport pixel box onto the webview so Electron can attach the guest', async () => {
    const callbacks: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );

    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onClose={vi.fn()}
      />,
    );

    const viewport = screen.getByTestId('browser-viewport');
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 960 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 720 });
    callbacks.forEach((callback) => callback([], {} as ResizeObserver));

    await waitFor(() => {
      const webview = screen.getByTestId('browser-panel').querySelector('webview') as HTMLElement;
      expect(webview.style.width).toBe('960px');
      expect(webview.style.height).toBe('720px');
    });
  });

  it('does not reset Electron zoom to 1 while measuring a page that already fits', async () => {
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onClose={vi.fn()}
      />,
    );
    const canvas = screen.getByTestId('browser-canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 960 });
    webviewMethods.executeJavaScript.mockResolvedValueOnce(800);
    attachWebviewMethods();

    await waitFor(() => expect(webviewMethods.executeJavaScript).toHaveBeenCalled());
    expect(webviewMethods.setZoomFactor).not.toHaveBeenCalled();
  });

  it('renders NewMax empty state for a blank tab without showing a loading skeleton', () => {
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="about:blank"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('browser-empty-state')).toBeTruthy();
    expect(screen.getByTestId('browser-address-label').textContent).toBe('输入网址或搜索');
    expect(screen.queryByTestId('browser-loading-skeleton')).toBeNull();
    expect((screen.getByTestId('browser-panel').querySelector('webview') as HTMLElement).getAttribute('src')).toBe(
      'about:blank',
    );
  });

  it('shows a valid external-open action when the address shell is hovered', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue({ opened: true, error: null });
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { openExternalUrl } },
    });
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test/docs"
        onClose={vi.fn()}
      />,
    );

    const addressLabel = screen.getByTestId('browser-address-label');
    fireEvent.mouseEnter(addressLabel.parentElement as HTMLElement);
    const externalButton = await screen.findByRole('button', { name: '在默认浏览器中打开' });
    fireEvent.click(externalButton);
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/docs');
  });

  it('keeps the NewMax three-layer progress chrome while a page is loading', () => {
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('browser-panel').querySelector('.shell-browser__progress-glow')).toBeTruthy();
    expect(screen.getByTestId('browser-panel').querySelector('.shell-browser__progress-halo')).toBeTruthy();
    expect(screen.getByTestId('browser-panel').querySelector('.shell-browser__progress-line')).toBeTruthy();
  });

  it('keeps the NewMax browser controls available after the guest is ready', async () => {
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onClose={vi.fn()}
      />,
    );
    const webview = attachWebviewMethods();

    fireEvent.click(screen.getByRole('button', { name: '更多浏览器选项' }));
    expect(screen.getByTestId('browser-more-menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '在页面中查找' }));
    const findInput = screen.getByRole('textbox', { name: '查找页面内容' });
    fireEvent.change(findInput, { target: { value: 'needle' } });
    expect(webviewMethods.findInPage).toHaveBeenCalledWith('needle');

    const found = new Event('found-in-page') as Event & {
      result?: { activeMatchOrdinal?: number; matches?: number };
    };
    found.result = { activeMatchOrdinal: 1, matches: 2 };
    webview.dispatchEvent(found);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下一个匹配' }).hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '下一个匹配' }));
    expect(webviewMethods.findInPage).toHaveBeenLastCalledWith('needle', {
      forward: true,
      findNext: true,
    });
    fireEvent.click(screen.getByRole('button', { name: '关闭查找' }));
    expect(webviewMethods.stopFindInPage).toHaveBeenCalledWith('clearSelection');

    fireEvent.click(screen.getByRole('button', { name: '更多浏览器选项' }));
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(webviewMethods.setZoomFactor).toHaveBeenCalledWith(1.1);
  });

  it('switches to a fixed device viewport and accepts Electron 33 popup relays from its own guest', async () => {
    const onNewTab = vi.fn();
    const unsubscribe = vi.fn();
    let popupListener:
      | ((payload: { openerWebContentsId: number; url: string }) => void)
      | undefined;
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          onBrowserNewTab: vi.fn((listener) => {
            popupListener = listener;
            return unsubscribe;
          }),
        },
      },
    });
    const view = render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onNewTab={onNewTab}
        onClose={vi.fn()}
      />,
    );
    attachWebviewMethods();
    fireEvent.click(screen.getByRole('button', { name: '更多浏览器选项' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /设备预览/ }));
    expect(screen.getByTestId('browser-device-toolbar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /手机/ }));
    expect(screen.getByTestId('browser-device-toolbar').textContent).toContain('390 × 844');
    fireEvent.click(screen.getByRole('button', { name: '关闭设备预览' }));
    expect(screen.queryByTestId('browser-device-toolbar')).toBeNull();

    popupListener?.({ openerWebContentsId: 41, url: 'https://other.example.test' });
    expect(onNewTab).not.toHaveBeenCalled();
    popupListener?.({ openerWebContentsId: 42, url: 'https://new.example.test' });
    await waitFor(() => expect(onNewTab).toHaveBeenCalledWith('https://new.example.test'));
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not render a page-title strip and reports live chrome to the host', async () => {
    const onPageMeta = vi.fn();
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://beui.dev/components/agents/message-scroller"
        onPageMeta={onPageMeta}
        onClose={vi.fn()}
      />,
    );
    const webview = attachWebviewMethods();

    expect(screen.getByTestId('browser-panel').querySelector('.shell-browser__title')).toBeNull();

    const titleEvent = new Event('page-title-updated') as Event & { title?: string };
    titleEvent.title = 'Message Scroller for Streaming AI Chat';
    webview.dispatchEvent(titleEvent);

    const faviconEvent = new Event('page-favicon-updated') as Event & { favicons?: string[] };
    faviconEvent.favicons = ['https://beui.dev/favicon.ico'];
    webview.dispatchEvent(faviconEvent);

    await waitFor(() =>
      expect(onPageMeta).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Message Scroller for Streaming AI Chat',
          favicon: 'https://beui.dev/favicon.ico',
          url: 'https://example.test',
        }),
      ),
    );
    expect(screen.getByTestId('browser-panel').querySelector('.shell-browser__title')).toBeNull();
    expect(
      screen.getByTestId('browser-panel').querySelector('.shell-browser__favicon')?.getAttribute('src'),
    ).toBe('https://beui.dev/favicon.ico');
  });

  it('maps Ctrl/Cmd wheel deltas onto the same zoom steps as the toolbar', () => {
    expect(browserZoomStepFromWheel(-120)).toBe(1);
    expect(browserZoomStepFromWheel(120)).toBe(-1);
    expect(parseGuestZoomDelta('__SYNC_THINK_BROWSER_ZOOM__:-80')).toBe(-80);
    expect(parseGuestZoomDelta('unrelated console text')).toBeNull();
    expect(guestBrowserZoomBridgeScript()).toContain('__SYNC_THINK_BROWSER_ZOOM__:');
  });

  it('zooms the guest from Ctrl+wheel on the host viewport and from guest console zoom marks', async () => {
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onClose={vi.fn()}
      />,
    );
    const webview = attachWebviewMethods();
    await waitFor(() =>
      expect(webviewMethods.executeJavaScript).toHaveBeenCalledWith(
        expect.stringContaining('__SYNC_THINK_BROWSER_ZOOM__:'),
      ),
    );

    fireEvent.wheel(screen.getByTestId('browser-viewport'), { ctrlKey: true, deltaY: -120 });
    expect(webviewMethods.setZoomFactor).toHaveBeenCalledWith(1.1);

    fireEvent.wheel(screen.getByTestId('browser-viewport'), { deltaY: 120 });
    expect(webviewMethods.setZoomFactor).toHaveBeenLastCalledWith(1.1);

    const guestZoom = new Event('console-message') as Event & { message?: string };
    guestZoom.message = '__SYNC_THINK_BROWSER_ZOOM__:80';
    webview.dispatchEvent(guestZoom);
    expect(webviewMethods.setZoomFactor).toHaveBeenLastCalledWith(1);
  });
});
