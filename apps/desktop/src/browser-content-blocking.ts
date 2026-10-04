/**
 * Embedded browser preferences and content-blocking contract, shared by the
 * Renderer (localStorage settings) and the main process (request filtering).
 *
 * Mirrors NewMax `webview.*`: settings live in the Renderer, only the resolved
 * `{ enabled, allowedHosts }` config crosses IPC.
 */

export interface EmbeddedBrowserSettings {
  autoFit: boolean;
  autofill: boolean;
  contentBlocking: boolean;
  contentBlockingAllowedHosts: string[];
}

export const DEFAULT_EMBEDDED_BROWSER_SETTINGS: EmbeddedBrowserSettings = {
  autoFit: true,
  autofill: true,
  contentBlocking: true,
  contentBlockingAllowedHosts: [],
};

export const EMBEDDED_BROWSER_SETTINGS_KEY = 'sync-think:embedded-browser-settings:v1';
export const EMBEDDED_BROWSER_SETTINGS_EVENT = 'sync-think:embedded-browser-settings-changed';

/** NewMax caps the per-site allow list at 256 entries. */
export const MAX_CONTENT_BLOCKING_ALLOWED_HOSTS = 256;

export interface EmbeddedBrowserContentBlockingConfig {
  enabled: boolean;
  allowedHosts: string[];
}

export interface EmbeddedBrowserContentBlockingRequest extends EmbeddedBrowserContentBlockingConfig {
  webContentsId: number;
}

export interface EmbeddedBrowserContentBlockingResult {
  ok: boolean;
  config?: EmbeddedBrowserContentBlockingConfig;
  error?: string;
}

/** Bare registrable host of an http(s) URL, without a leading `www.`. */
export function normalizeSiteHost(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return hostname || null;
  } catch {
    return null;
  }
}

/** Keep only valid, de-duplicated host suffixes. */
export function normalizeAllowedHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hosts = value
    .filter((host): host is string => typeof host === 'string')
    .map((host) => {
      const text = host.trim();
      if (!text) return null;
      // An entry may be a bare host or a full URL. A value that already carries
      // a scheme is never re-prefixed, so `file:///x` stays invalid instead of
      // degrading into the host `file`.
      return /^[a-z][a-z0-9+.-]*:/i.test(text)
        ? normalizeSiteHost(text)
        : normalizeSiteHost(`https://${text}`);
    })
    .filter((host): host is string => Boolean(host));
  return [...new Set(hosts)].slice(0, MAX_CONTENT_BLOCKING_ALLOWED_HOSTS);
}

/** A host is allowed when it equals the entry or is one of its subdomains. */
export function hostMatches(hostname: string, allowedHost: string): boolean {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

export function isContentBlockingAllowed(settings: EmbeddedBrowserSettings, url: string): boolean {
  const hostname = normalizeSiteHost(url);
  if (!hostname) return false;
  return settings.contentBlockingAllowedHosts.some((allowedHost) => hostMatches(hostname, allowedHost));
}

/** Whether the per-site switch shows as on for this page. */
export function isContentBlockingEnabledForUrl(settings: EmbeddedBrowserSettings, url: string): boolean {
  if (!settings.contentBlocking) return false;
  const hostname = normalizeSiteHost(url);
  if (!hostname) return false;
  return !settings.contentBlockingAllowedHosts.some((allowedHost) => hostMatches(hostname, allowedHost));
}

/** Turning blocking off for one site only adds that host to the allow list. */
export function setContentBlockingForUrl(
  settings: EmbeddedBrowserSettings,
  url: string,
  enabled: boolean,
): EmbeddedBrowserSettings {
  const hostname = normalizeSiteHost(url);
  if (!hostname) return settings;
  const allowedHosts = settings.contentBlockingAllowedHosts.filter((host) => host !== hostname);
  if (!enabled) allowedHosts.push(hostname);
  return { ...settings, contentBlockingAllowedHosts: normalizeAllowedHosts(allowedHosts) };
}

export function contentBlockingConfig(
  settings: EmbeddedBrowserSettings,
): EmbeddedBrowserContentBlockingConfig {
  return { enabled: settings.contentBlocking, allowedHosts: settings.contentBlockingAllowedHosts };
}

/** Validate the IPC payload before it reaches `webRequest`. */
export function parseEmbeddedBrowserContentBlockingRequest(
  value: unknown,
): EmbeddedBrowserContentBlockingRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('浏览器内容拦截参数无效');
  }
  const payload = value as { webContentsId?: unknown; enabled?: unknown; allowedHosts?: unknown };
  if (typeof payload.webContentsId !== 'number' || !Number.isSafeInteger(payload.webContentsId) || payload.webContentsId <= 0) {
    throw new Error('浏览器页面尚未就绪');
  }
  if (typeof payload.enabled !== 'boolean') throw new Error('浏览器内容拦截参数无效');
  return {
    webContentsId: payload.webContentsId,
    enabled: payload.enabled,
    allowedHosts: normalizeAllowedHosts(payload.allowedHosts),
  };
}
