/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserPanel, normalizeBrowserInput } from './BrowserPanel.js';

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
});
