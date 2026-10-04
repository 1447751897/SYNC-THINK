import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBEDDED_BROWSER_SETTINGS,
  contentBlockingConfig,
  hostMatches,
  isContentBlockingAllowed,
  isContentBlockingEnabledForUrl,
  normalizeAllowedHosts,
  normalizeSiteHost,
  parseEmbeddedBrowserContentBlockingRequest,
  setContentBlockingForUrl,
  type EmbeddedBrowserSettings,
} from './browser-content-blocking.js';

const settings: EmbeddedBrowserSettings = { ...DEFAULT_EMBEDDED_BROWSER_SETTINGS };

describe('embedded browser content blocking contract', () => {
  it('normalizes a site host to a bare registrable host', () => {
    expect(normalizeSiteHost('https://www.example.test/article')).toBe('example.test');
    expect(normalizeSiteHost('http://sub.example.test:8443/a?b=1')).toBe('sub.example.test');
    expect(normalizeSiteHost('https://EXAMPLE.test/')).toBe('example.test');
    expect(normalizeSiteHost('file:///fixture.html')).toBeNull();
    expect(normalizeSiteHost('about:blank')).toBeNull();
    expect(normalizeSiteHost('')).toBeNull();
  });

  it('keeps only valid unique hosts and caps the allow list at 256 entries', () => {
    expect(normalizeAllowedHosts(['example.test', 'https://www.example.test/', 'file:///x', 42, '', '  other.test '])).toEqual(['example.test', 'other.test']);
    expect(normalizeAllowedHosts('not-an-array')).toEqual([]);
    expect(normalizeAllowedHosts(Array.from({ length: 300 }, (_, index) => `host${index}.test`))).toHaveLength(256);
  });

  it('matches a host exactly or as a subdomain suffix', () => {
    expect(hostMatches('example.test', 'example.test')).toBe(true);
    expect(hostMatches('ads.example.test', 'example.test')).toBe(true);
    expect(hostMatches('notexample.test', 'example.test')).toBe(false);
    expect(hostMatches('example.test', 'ads.example.test')).toBe(false);
  });

  it('turns blocking off for one site by adding only that host, and back on by removing it', () => {
    const off = setContentBlockingForUrl(settings, 'https://www.example.test/a', false);
    expect(off.contentBlockingAllowedHosts).toEqual(['example.test']);
    expect(isContentBlockingAllowed(off, 'https://ads.example.test/b')).toBe(true);
    expect(isContentBlockingEnabledForUrl(off, 'https://example.test/')).toBe(false);
    expect(isContentBlockingEnabledForUrl(off, 'https://other.test/')).toBe(true);
    const on = setContentBlockingForUrl(off, 'https://example.test/', true);
    expect(on.contentBlockingAllowedHosts).toEqual([]);
  });

  it('reports the per-site switch as off for an unusable URL and for the global switch', () => {
    expect(isContentBlockingEnabledForUrl(settings, 'about:blank')).toBe(false);
    expect(isContentBlockingEnabledForUrl({ ...settings, contentBlocking: false }, 'https://example.test/')).toBe(false);
    expect(isContentBlockingEnabledForUrl(settings, 'https://example.test/')).toBe(true);
  });

  it('sends only the resolved config across IPC', () => {
    expect(contentBlockingConfig(setContentBlockingForUrl(settings, 'https://example.test/', false))).toEqual({ enabled: true, allowedHosts: ['example.test'] });
  });

  it('validates the IPC payload before it can reach webRequest', () => {
    expect(parseEmbeddedBrowserContentBlockingRequest({ webContentsId: 42, enabled: true, allowedHosts: ['example.test'] })).toEqual({ webContentsId: 42, enabled: true, allowedHosts: ['example.test'] });
    expect(parseEmbeddedBrowserContentBlockingRequest({ webContentsId: 42, enabled: false, allowedHosts: 'nope' })).toEqual({ webContentsId: 42, enabled: false, allowedHosts: [] });
    expect(() => parseEmbeddedBrowserContentBlockingRequest(null)).toThrow('浏览器内容拦截参数无效');
    expect(() => parseEmbeddedBrowserContentBlockingRequest({ enabled: true })).toThrow('浏览器页面尚未就绪');
    expect(() => parseEmbeddedBrowserContentBlockingRequest({ webContentsId: 42 })).toThrow('浏览器内容拦截参数无效');
    expect(() => parseEmbeddedBrowserContentBlockingRequest({ webContentsId: 0, enabled: true })).toThrow('浏览器页面尚未就绪');
    expect(() => parseEmbeddedBrowserContentBlockingRequest({ webContentsId: 42, enabled: 'yes' })).toThrow('浏览器内容拦截参数无效');
  });
});
