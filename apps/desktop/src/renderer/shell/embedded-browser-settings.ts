/**
 * Renderer-side embedded browser preferences.
 *
 * Mirrors NewMax `newmax:embedded-browser-settings:v1`: the Renderer owns the
 * settings, persists them in `localStorage`, and broadcasts every change on a
 * `CustomEvent` so all embedded tabs stay in sync without main-process state.
 */
import {
  DEFAULT_EMBEDDED_BROWSER_SETTINGS,
  EMBEDDED_BROWSER_SETTINGS_EVENT,
  EMBEDDED_BROWSER_SETTINGS_KEY,
  normalizeAllowedHosts,
  type EmbeddedBrowserSettings,
} from '../../browser-content-blocking.js';

export {
  contentBlockingConfig,
  isContentBlockingAllowed,
  isContentBlockingEnabledForUrl,
  normalizeAllowedHosts,
  normalizeSiteHost,
  setContentBlockingForUrl,
  type EmbeddedBrowserSettings,
} from '../../browser-content-blocking.js';

export function loadEmbeddedBrowserSettings(): EmbeddedBrowserSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_EMBEDDED_BROWSER_SETTINGS };
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(EMBEDDED_BROWSER_SETTINGS_KEY) ?? '{}',
    ) as Partial<Record<keyof EmbeddedBrowserSettings, unknown>>;
    return {
      autoFit:
        typeof stored.autoFit === 'boolean'
          ? stored.autoFit
          : DEFAULT_EMBEDDED_BROWSER_SETTINGS.autoFit,
      autofill:
        typeof stored.autofill === 'boolean'
          ? stored.autofill
          : DEFAULT_EMBEDDED_BROWSER_SETTINGS.autofill,
      contentBlocking:
        typeof stored.contentBlocking === 'boolean'
          ? stored.contentBlocking
          : DEFAULT_EMBEDDED_BROWSER_SETTINGS.contentBlocking,
      contentBlockingAllowedHosts: normalizeAllowedHosts(stored.contentBlockingAllowedHosts),
    };
  } catch {
    return { ...DEFAULT_EMBEDDED_BROWSER_SETTINGS };
  }
}

/** Persist the merged settings and notify every mounted embedded browser. */
export function saveEmbeddedBrowserSettings(
  changes: Partial<EmbeddedBrowserSettings>,
): EmbeddedBrowserSettings {
  const next: EmbeddedBrowserSettings = { ...loadEmbeddedBrowserSettings(), ...changes };
  next.contentBlockingAllowedHosts = normalizeAllowedHosts(next.contentBlockingAllowedHosts);
  try {
    window.localStorage.setItem(EMBEDDED_BROWSER_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // A restricted renderer (or private browsing context) may reject storage.
  }
  try {
    window.dispatchEvent(
      new CustomEvent<EmbeddedBrowserSettings>(EMBEDDED_BROWSER_SETTINGS_EVENT, { detail: next }),
    );
  } catch {
    // `CustomEvent` is unavailable outside a DOM renderer; the return value still applies.
  }
  return next;
}

/** Subscribe to settings changes; returns the unsubscribe function. */
export function onEmbeddedBrowserSettingsChange(
  listener: (settings: EmbeddedBrowserSettings) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<EmbeddedBrowserSettings>).detail;
    listener(detail ?? loadEmbeddedBrowserSettings());
  };
  window.addEventListener(EMBEDDED_BROWSER_SETTINGS_EVENT, handler);
  return () => window.removeEventListener(EMBEDDED_BROWSER_SETTINGS_EVENT, handler);
}
