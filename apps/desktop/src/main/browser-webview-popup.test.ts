import { describe, expect, it, vi } from 'vitest';
import {
  installBrowserWebviewPopupHandler,
  normalizeBrowserPopupUrl,
  type BrowserPopupDetails,
  type BrowserPopupGuest,
} from './browser-webview-popup.js';

describe('browser WebView popup bridge', () => {
  it('installs an Electron 33 window-open handler and relays the owning guest id', () => {
    let attach: ((event: unknown, guest: BrowserPopupGuest) => void) | undefined;
    let open: ((details: BrowserPopupDetails) => { action: 'deny' }) | undefined;
    const onRequest = vi.fn();
    installBrowserWebviewPopupHandler(
      {
        on(_event, listener) {
          attach = listener;
        },
      },
      onRequest,
    );
    attach?.(
      {},
      {
        id: 42,
        setWindowOpenHandler(handler) {
          open = handler;
        },
      },
    );

    expect(open?.({ url: 'https://example.test/path' })).toEqual({ action: 'deny' });
    expect(onRequest).toHaveBeenCalledWith({
      openerWebContentsId: 42,
      url: 'https://example.test/path',
    });
  });

  it('keeps privileged and malformed popup targets denied and private to main', () => {
    let attach: ((event: unknown, guest: BrowserPopupGuest) => void) | undefined;
    let open: ((details: BrowserPopupDetails) => { action: 'deny' }) | undefined;
    const onRequest = vi.fn();
    installBrowserWebviewPopupHandler({ on: (_event, listener) => (attach = listener) }, onRequest);
    attach?.({}, { id: 7, setWindowOpenHandler: (handler) => (open = handler) });

    expect(open?.({ url: 'file:///C:/private.txt' })).toEqual({ action: 'deny' });
    expect(open?.({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('accepts browser-safe targets only', () => {
    expect(normalizeBrowserPopupUrl('about:blank')).toBe('about:blank');
    expect(normalizeBrowserPopupUrl('https://example.test/a')).toBe('https://example.test/a');
    expect(
      normalizeBrowserPopupUrl(
        'newmax-local-web://12345678-1234-1234-1234-123456789012/index.html',
      ),
    ).toBe('newmax-local-web://12345678-1234-1234-1234-123456789012/index.html');
    expect(normalizeBrowserPopupUrl('data:text/html,test')).toBeNull();
  });
});
