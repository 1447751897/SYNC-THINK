import { describe, expect, it, vi } from 'vitest';
import { createContentBlockingService, shouldBlockRequest, type ContentBlockingSession } from './browser-content-blocking-service.js';

const enabled = { enabled: true, allowedHosts: [] as string[] };

describe('embedded browser content blocking', () => {
  it('cancels a known ad or tracker subresource and leaves the document alone', () => {
    expect(shouldBlockRequest({ config: enabled, details: { url: 'https://static.doubleclick.net/instream/ad.js', resourceType: 'script' } })).toBe(true);
    expect(shouldBlockRequest({ config: enabled, details: { url: 'https://www.google-analytics.com/collect?v=1', resourceType: 'xhr' } })).toBe(true);
    expect(shouldBlockRequest({ config: enabled, details: { url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', resourceType: 'script' } })).toBe(true);
    // Blocking the top-level document would blank the page instead of cleaning it.
    expect(shouldBlockRequest({ config: enabled, details: { url: 'https://doubleclick.net/', resourceType: 'mainFrame' } })).toBe(false);
    expect(shouldBlockRequest({ config: enabled, details: { url: 'https://example.test/article', resourceType: 'mainFrame' } })).toBe(false);
    expect(shouldBlockRequest({ config: enabled, details: { url: 'https://cdn.example.test/app.js', resourceType: 'script' } })).toBe(false);
  });

  it('never cancels non-http traffic, extension traffic, or a malformed URL', () => {
    expect(shouldBlockRequest({ config: enabled, details: { url: 'data:text/html,<p>hi', resourceType: 'subFrame' } })).toBe(false);
    expect(shouldBlockRequest({ config: enabled, details: { url: 'about:blank' } })).toBe(false);
    expect(shouldBlockRequest({ config: enabled, details: { url: 'chrome-extension://abc/blocked.js' } })).toBe(false);
    expect(shouldBlockRequest({ config: enabled, details: { url: 'not a url' } })).toBe(false);
    expect(shouldBlockRequest({ config: enabled, details: { url: '' } })).toBe(false);
  });

  it('honours the global switch and the per-site allow list, subdomains included', () => {
    expect(shouldBlockRequest({ config: { enabled: false, allowedHosts: [] }, details: { url: 'https://doubleclick.net/ad.js', resourceType: 'script' } })).toBe(false);
    expect(shouldBlockRequest({ config: { enabled: true, allowedHosts: ['example.test'] }, details: { url: 'https://example.test/ad.js', resourceType: 'script' } })).toBe(false);
    expect(shouldBlockRequest({ config: { enabled: true, allowedHosts: ['example.test'] }, details: { url: 'https://ads.example.test/track', resourceType: 'script' } })).toBe(false);
    // A suffix match must be anchored on a dot boundary: an allow entry for
    // `notdoubleclick.net` never unblocks `doubleclick.net`.
    expect(shouldBlockRequest({ config: { enabled: true, allowedHosts: ['notdoubleclick.net'] }, details: { url: 'https://doubleclick.net/ad.js', resourceType: 'script' } })).toBe(true);
  });

  it('registers one listener per session and updates the shared config in place', () => {
    const listeners: Array<(details: { url: string; resourceType?: string }, callback: (response: { cancel?: boolean }) => void) => void> = [];
    const session: ContentBlockingSession = {
      webRequest: {
        onBeforeRequest: vi.fn((_filter, listener) => {
          listeners.push(listener);
        }),
      },
    };
    const service = createContentBlockingService();
    service.configure(session, enabled);
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledWith({ urls: ['*://*/*'] }, expect.any(Function));

    const decide = (url: string) => {
      let cancel: boolean | undefined;
      listeners[0]({ url, resourceType: 'script' }, (response) => {
        cancel = response.cancel;
      });
      return cancel;
    };
    expect(decide('https://doubleclick.net/ad.js')).toBe(true);

    service.configure(session, { enabled: true, allowedHosts: ['doubleclick.net'] });
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(decide('https://doubleclick.net/ad.js')).toBe(false);

    service.configure(session, { enabled: false, allowedHosts: [] });
    expect(decide('https://doubleclick.net/ad.js')).toBe(false);
  });
});
