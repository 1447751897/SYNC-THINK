export interface BrowserPopupDetails {
  url: string;
}

export interface BrowserPopupGuest {
  id: number;
  setWindowOpenHandler(handler: (details: BrowserPopupDetails) => { action: 'deny' }): void;
}

export interface BrowserPopupHost {
  on(
    event: 'did-attach-webview',
    listener: (event: unknown, guest: BrowserPopupGuest) => void,
  ): unknown;
}

export interface BrowserPopupRequest {
  openerWebContentsId: number;
  url: string;
}

/**
 * Electron 22 removed the renderer-side WebView `new-window` event. Attach the
 * supported handler to each guest and relay a denied popup to the owning tab.
 */
export function installBrowserWebviewPopupHandler(
  host: BrowserPopupHost,
  onRequest: (request: BrowserPopupRequest) => void,
): void {
  host.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler((details) => {
      const url = normalizeBrowserPopupUrl(details.url);
      if (url) {
        onRequest({ openerWebContentsId: guest.id, url });
      }
      return { action: 'deny' };
    });
  });
}

export function normalizeBrowserPopupUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  if (candidate === 'about:blank') return candidate;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (
      url.protocol === 'newmax-local-web:' &&
      /^[A-Za-z0-9_-]{16,160}$/.test(url.hostname) &&
      url.pathname.startsWith('/')
    ) {
      return url.href;
    }
  } catch {
    // Malformed and privileged targets stay denied without reaching Renderer.
  }
  return null;
}
