/**
 * Guest preload for interactive HTML / design-draft previews.
 *
 * Ported from NewMax's `resources/app.asar` guest preload
 * (`/out/preload/visualization.cjs`, 3304 bytes). NewMax measures the guest
 * document from *inside* the guest and reports the height over
 * `ipcRenderer.sendToHost`, instead of the host calling `executeJavaScript`.
 * That is what fixes the white-screen / collapsed-height problems the host
 * measurement approach had:
 *
 * - the guest knows when its own layout settles (ResizeObserver + rAF), so the
 *   host never has to guess with bounded timers;
 * - the host never touches the guest's JS context, so a guest that throws
 *   while measuring can no longer break the shell;
 * - the design system arrives as a message (`set-design-system`) and is applied
 *   as `--ds-*` custom properties on `document.documentElement`, which the
 *   guest document reads with `getComputedStyle` (NewMax's documented contract
 *   for AI-authored pages).
 *
 * This preload runs with sandbox=true, contextIsolation=true,
 * nodeIntegration=false. A sandboxed preload may still `require('electron')`
 * for the `ipcRenderer` subset used here; it has no Node.js access.
 */

import { ipcRenderer } from 'electron';

const CHANNEL_READY = 'sync-think-visualization:ready';
const CHANNEL_HEIGHT = 'sync-think-visualization:height';
const CHANNEL_ERROR = 'sync-think-visualization:error';
const CHANNEL_SET_DESIGN_SYSTEM = 'sync-think-visualization:set-design-system';
const CHANNEL_SET_THEME = 'sync-think-visualization:set-theme';
const EVENT_THEME_CHANGE = 'sync-think-visualization-themechange';
const EVENT_LAYOUT = 'sync-think-visualization-layout';

/** Guest-side bounds. The host applies its own clamp on top of these. */
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 10_000;
/** Headroom for select menus / popovers that escape the content box. */
const POPOVER_SHADOW_MARGIN = 12;
const MAX_ERROR_LENGTH = 500;
const MAX_TOKEN_VALUE_LENGTH = 2_000;

interface DesignSystemPayload {
  theme?: unknown;
  reduceMotion?: unknown;
  uiKitVersion?: unknown;
  tokens?: unknown;
}

let lastHeight = 0;

function reportHeight(): void {
  const root = document.querySelector('main.viz-root');
  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  const bodyPadding = bodyStyle
    ? (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0)
    : 0;
  let contentHeight = root
    ? Math.max(root.scrollHeight, root.getBoundingClientRect().height) + bodyPadding
    : (document.body?.scrollHeight ?? 0);
  document.querySelectorAll('.viz-select-menu:not([hidden])').forEach((menu) => {
    const menuBottom = menu.getBoundingClientRect().bottom;
    const paddingBottom = bodyStyle ? parseFloat(bodyStyle.paddingBottom) || 0 : 0;
    contentHeight = Math.max(contentHeight, menuBottom + paddingBottom + POPOVER_SHADOW_MARGIN);
  });
  const height = Math.max(contentHeight, MIN_HEIGHT);
  const clamped = Math.min(Math.ceil(height), MAX_HEIGHT);
  if (clamped === lastHeight) return;
  lastHeight = clamped;
  ipcRenderer.sendToHost(CHANNEL_HEIGHT, { height: clamped });
}

function reportError(message: unknown): void {
  ipcRenderer.sendToHost(CHANNEL_ERROR, {
    message: String(message).slice(0, MAX_ERROR_LENGTH),
  });
}

function applyDesignSystem(payload: DesignSystemPayload | null | undefined): void {
  const root = document.documentElement;
  const nextTheme = payload?.theme === 'dark' ? 'dark' : 'light';
  root.dataset.theme = nextTheme;
  root.dataset.reduceMotion = payload?.reduceMotion === true ? 'true' : 'false';
  if (typeof payload?.uiKitVersion === 'string') {
    root.dataset.uiKit = payload.uiKitVersion.slice(0, 40);
  }
  const tokens = payload?.tokens;
  if (tokens && typeof tokens === 'object') {
    for (const [name, value] of Object.entries(tokens as Record<string, unknown>)) {
      // Only design-system custom properties, and only bounded string values:
      // the payload crosses an IPC boundary from the host renderer.
      if (!/^--ds-[a-z0-9-]+$/.test(name)) continue;
      if (typeof value !== 'string' || value.length > MAX_TOKEN_VALUE_LENGTH) continue;
      root.style.setProperty(name, value);
    }
  }
  window.dispatchEvent(
    new CustomEvent(EVENT_THEME_CHANGE, {
      detail: { theme: nextTheme, reduceMotion: root.dataset.reduceMotion === 'true' },
    }),
  );
  requestAnimationFrame(reportHeight);
}

ipcRenderer.on(CHANNEL_SET_DESIGN_SYSTEM, (_event, payload: DesignSystemPayload) => {
  applyDesignSystem(payload);
});
ipcRenderer.on(CHANNEL_SET_THEME, (_event, theme: unknown) => {
  applyDesignSystem({ theme });
});

window.addEventListener('error', (event) => {
  reportError(event.message || 'Visualization script error');
});
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  reportError(message || 'Visualization promise rejected');
});

window.addEventListener('DOMContentLoaded', () => {
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    const root = document.querySelector('main.viz-root');
    if (root) observer.observe(root);
  }
  reportHeight();
  ipcRenderer.sendToHost(CHANNEL_READY);
});

document.addEventListener(EVENT_LAYOUT, () => {
  requestAnimationFrame(reportHeight);
});
