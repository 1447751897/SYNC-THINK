/**
 * Guest-side UI kit + document template for interactive HTML / design previews.
 *
 * Ported from NewMax's `VISUALIZATION_UI_KIT_STYLES`, `VISUALIZATION_CSP`,
 * `buildThemeBootstrap` and `buildVisualizationDocument` (see
 * `.data/tmp/newmax/walletStore.js`). The guest document is a plain data: URL
 * whose CSS is authored against `--ds-*`; the host injects the live values over
 * IPC (see design-system.ts and preload/visualization.ts).
 *
 * This file lives outside `renderer/shell/` on purpose: `--ds-*` is a foreign
 * vocabulary to the shell, and the design-token guard rejects it in shell
 * sources. Keeping the guest contract in its own module makes that boundary
 * explicit.
 */

import { VISUALIZATION_UI_KIT_VERSION, type VisualizationTheme } from './design-system.js';

/** Matches NewMax's `VISUALIZATION_VIEWPORT_GUTTER_PX`. */
const VIEWPORT_GUTTER_PX = 8;

/**
 * NewMax's CSP: inline scripts/styles only, no network. Adopted verbatim so a
 * generated page cannot phone home. `blob:` is kept for worker/image inputs.
 */
export const VISUALIZATION_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'worker-src blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const VISUALIZATION_UI_KIT_STYLES = `
:root {
  color-scheme: light;
  --ds-text-primary: #181b19;
  --ds-text-secondary: rgba(24, 27, 25, 0.64);
  --ds-text-tertiary: rgba(24, 27, 25, 0.48);
  --ds-brand-primary: #2d4739;
  --ds-brand-primary-text: rgba(255, 255, 255, 0.9);
  --ds-accent: #8c7851;
  --ds-accent-text: rgba(255, 255, 255, 0.9);
  --ds-icon: #7e7f7e;
  --ds-danger: #b64a34;
  --ds-success: #287d46;
  --ds-warning: #916300;
  --ds-danger-bg: color-mix(in srgb, var(--ds-danger) 8%, var(--ds-surface-100));
  --ds-success-bg: color-mix(in srgb, var(--ds-success) 8%, var(--ds-surface-100));
  --ds-warning-bg: color-mix(in srgb, var(--ds-warning) 8%, var(--ds-surface-100));
  --ds-surface-100: #ffffff;
  --ds-surface-200: #faf9f5;
  --ds-surface-300: #f6f4ef;
  --ds-surface-400: #f2eee6;
  --ds-surface-input: var(--ds-surface-100);
  --ds-on-surface: rgba(55, 61, 58, 0.06);
  --ds-on-surface-active: rgba(55, 61, 58, 0.08);
  --ds-divider: color-mix(in srgb, var(--ds-text-primary) 6%, transparent);
  --ds-space-1: 4px;
  --ds-space-2: 8px;
  --ds-space-3: 12px;
  --ds-space-4: 16px;
  --ds-space-5: 20px;
  --ds-space-6: 24px;
  --ds-radius-sm: 8px;
  --ds-radius-md: 12px;
  --ds-radius-lg: 18px;
  --ds-radius-pill: 64px;
  --ds-elevation-100: inset 0.5px 0.5px 0.5px #fff, 0 0 0.5px 0.5px rgba(0, 0, 0, 0.04), 0.5px 0.5px 1px rgba(0, 0, 0, 0.08);
  --ds-elevation-200: 0 0 0 0.5px rgba(45, 71, 57, 0.12), 0 5px 12px rgba(0, 0, 0, 0.08);
  --ds-input-shadow: 0 0 0.5px 0.5px rgba(0, 0, 0, 0.08), 0.5px 0.5px 1px rgba(0, 0, 0, 0.12);
  --ds-input-shadow-inset: inset 0.5px 0.5px 0.5px white;
  --ds-input-shadow-hover: 0 0 0 0.5px color-mix(in srgb, var(--ds-brand-primary) 24%, transparent);
  --ds-input-shadow-focus: 0 0 0 3px color-mix(in srgb, var(--ds-brand-primary) 10%, transparent);
  --ds-ease-swift: cubic-bezier(0.33, 1, 0.68, 1);
  --ds-ease-soft: cubic-bezier(0.22, 1, 0.36, 1);
  --ds-ease-spring: cubic-bezier(0.34, 1.3, 0.64, 1);
  --ds-duration-fast: 180ms;
  --ds-duration-base: 240ms;
  --ds-motion-swift: var(--ds-duration-fast) var(--ds-ease-swift);
  --ds-motion-soft: var(--ds-duration-base) var(--ds-ease-soft);
  --ds-motion-spring: var(--ds-duration-base) var(--ds-ease-spring);
  /* NewMax paints this transparent because its chat surface already is
     surface-200. The webview element cannot composite a transparent guest
     reliably, so the kit paints the chat surface itself. */
  --viz-bg: var(--ds-surface-200);
  --viz-surface: var(--ds-surface-200);
  --viz-surface-raised: var(--ds-surface-100);
  --viz-card-bg: var(--ds-surface-200);
  --viz-metric-bg: var(--ds-surface-100);
  --viz-border: var(--ds-divider);
  --viz-text: var(--ds-text-primary);
  --viz-text-muted: var(--ds-text-secondary);
  --viz-muted: var(--ds-text-secondary);
  --viz-accent: var(--ds-brand-primary);
  --viz-accent-soft: var(--ds-pill-bg, color-mix(in srgb, var(--ds-brand-primary) 12%, transparent));
  --viz-danger: var(--ds-danger);
  --viz-success: var(--ds-success);
  --viz-warning: var(--ds-warning);
  --viz-chart-text: var(--ds-text-primary);
  --viz-chart-text-muted: var(--ds-text-secondary);
  --viz-chart-grid: var(--ds-divider);
  --viz-chart-track: var(--ds-on-surface-active);
  --viz-chart-surface: var(--ds-surface-100);
  /* Compatibility aliases for fragments generated against pre-v4 token guesses. */
  --ds-color-text-primary: var(--viz-chart-text);
  --ds-color-text-secondary: var(--viz-chart-text-muted);
  --ds-color-bg-primary: var(--viz-chart-surface);
  --ds-color-bg-muted: var(--viz-chart-track);
  --ds-color-accent: var(--ds-accent);
  --ds-color-danger: var(--ds-danger);
  --ds-color-success: var(--ds-success);
  --ds-color-warning: var(--ds-warning);
  --viz-radius: var(--ds-radius-md);
  --viz-font: Inter, "Noto Sans SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --ds-text-primary: rgba(255, 255, 255, 0.9);
  --ds-text-secondary: rgba(255, 255, 255, 0.5);
  --ds-text-tertiary: rgba(255, 255, 255, 0.38);
  --ds-brand-primary: #36d385;
  --ds-brand-primary-text: rgba(0, 0, 0, 0.9);
  --ds-accent: #36d385;
  --ds-accent-text: rgba(0, 0, 0, 0.9);
  --ds-danger: #e56555;
  --ds-success: #4ade80;
  --ds-warning: #e0a830;
  --ds-surface-100: #191a1a;
  --ds-surface-200: #1e1f1f;
  --ds-surface-300: #252726;
  --ds-surface-400: #2a2d2b;
  --ds-surface-input: var(--ds-surface-300);
  --ds-on-surface: rgba(168, 184, 176, 0.08);
  --ds-on-surface-active: rgba(168, 184, 176, 0.16);
  --ds-divider: color-mix(in srgb, var(--ds-text-primary) 12%, transparent);
  --ds-elevation-100: 0 0 0 0.5px rgba(255, 255, 255, 0.08);
  --ds-input-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.08);
  --ds-input-shadow-inset: none;
  --ds-input-shadow-hover: 0 0 0 0.5px rgba(255, 255, 255, 0.16);
  --ds-input-shadow-focus: 0 0 1px 0.5px color-mix(in srgb, var(--ds-brand-primary) 56%, transparent), 0 0 0 4px color-mix(in srgb, var(--ds-brand-primary) 10%, transparent);
}
* { box-sizing: border-box; }
html, body { margin: 0; min-width: 0; background: var(--viz-bg); color: var(--ds-text-primary); }
body { padding: ${VIEWPORT_GUTTER_PX}px; overflow: hidden; font-family: var(--viz-font); font-size: 13px; line-height: 1.5; letter-spacing: 0; }
button, input, select, textarea { font: inherit; color: inherit; letter-spacing: 0; }
button, input, select, textarea, a { outline-color: var(--ds-brand-primary); }
button { border: 0; }
a { color: var(--ds-brand-primary); }
svg, canvas, img { display: block; max-width: 100%; }
.viz-root { width: 100%; min-width: 0; }
.viz-title { margin: 0; color: var(--ds-text-primary); font-size: 18px; font-weight: 600; line-height: 1.35; }
.viz-subtitle { margin: 3px 0 0; color: var(--ds-text-secondary); font-size: 13px; }
.viz-section-title { margin: 0; color: var(--ds-text-primary); font-size: 14px; font-weight: 600; }
.viz-muted { color: var(--ds-text-secondary); }
.viz-tertiary { color: var(--ds-text-tertiary); }
.viz-accent { color: var(--ds-brand-primary); }
.viz-positive { color: var(--ds-success); }
.viz-negative { color: var(--ds-danger); }
.viz-number { font-family: var(--ds-font-display-number, ui-monospace, monospace); font-variant-numeric: tabular-nums; }
.viz-section { display: flex; flex-direction: column; gap: var(--ds-space-2); min-width: 0; }
.viz-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); }
.viz-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.viz-row[data-align="between"] { justify-content: space-between; }
.viz-stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.viz-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.viz-card { min-width: 0; padding: 16px; border-radius: var(--ds-radius-lg); background: var(--viz-card-bg); box-shadow: var(--ds-elevation-100); }
.viz-card[data-variant="flat"] { background: var(--ds-on-surface); box-shadow: none; }
.viz-card[data-variant="filled"] { background: var(--ds-surface-100); }
.viz-card[data-padding="compact"] { padding: 12px; }
.viz-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.viz-metric { min-width: 0; padding: 16px; border-radius: var(--ds-radius-lg); background: var(--viz-metric-bg); box-shadow: var(--ds-elevation-100); }
.viz-card:has(> .viz-metric:only-child) { padding: 0; background: transparent; box-shadow: none; }
.viz-card:has(> .viz-metric:only-child) > .viz-metric { width: 100%; height: 100%; }
.viz-metric-label { color: var(--ds-text-secondary); font-size: 12px; }
.viz-metric-value { margin-top: 3px; color: var(--ds-text-primary); font-size: 20px; font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.viz-metric-detail { margin-top: 3px; color: var(--ds-text-tertiary); font-size: 11px; }
.viz-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 32px; padding: 0 12px; border: 0; border-radius: var(--ds-radius-pill); background: var(--ds-brand-primary); color: var(--ds-brand-primary-text); font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer; transition: opacity var(--ds-motion-swift), background-color var(--ds-motion-swift), color var(--ds-motion-swift); }
.viz-button:hover:not(:disabled) { opacity: 0.8; }
.viz-button:active:not(:disabled) { opacity: 0.7; }
.viz-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--ds-brand-primary) 42%, transparent); outline-offset: 2px; }
.viz-button:disabled { opacity: 0.4; cursor: default; }
.viz-button[data-variant="secondary"] { border: 1px solid var(--ds-brand-primary); background: transparent; color: var(--ds-brand-primary); }
.viz-button[data-variant="tertiary"] { background: var(--ds-on-surface); color: var(--ds-brand-primary); }
.viz-button[data-variant="ghost"] { background: transparent; color: var(--ds-brand-primary); }
.viz-button[data-variant="ghost"]:hover:not(:disabled) { background: var(--ds-on-surface); opacity: 1; }
.viz-button[data-variant="danger"] { background: color-mix(in srgb, var(--ds-danger) 6%, transparent); color: var(--ds-danger); }
.viz-button[data-size="mini"] { height: 24px; padding: 0 8px; font-size: 12px; }
.viz-button[data-size="small"] { height: 28px; padding: 0 10px; font-size: 12px; }
.viz-button[data-size="large"] { height: 36px; padding: 0 20px; font-size: 14px; }
.viz-button[data-icon-only] { width: 32px; padding: 0; }
.viz-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.viz-label { color: var(--ds-text-secondary); font-size: 12px; font-weight: 500; }
.viz-field-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.viz-field-value { color: var(--ds-brand-primary); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.viz-help { color: var(--ds-text-tertiary); font-size: 11px; }
.viz-error { color: var(--ds-danger); font-size: 11px; }
.viz-input, .viz-select, .viz-textarea { width: 100%; min-width: 0; min-height: 32px; border: 0; border-radius: var(--ds-radius-md); background: var(--ds-surface-input); color: var(--ds-text-primary); box-shadow: var(--ds-input-shadow), var(--ds-input-shadow-inset); padding: 6px 10px; font-size: 13px; transition: box-shadow var(--ds-motion-swift), background-color var(--ds-motion-swift); }
.viz-input::placeholder, .viz-textarea::placeholder { color: var(--ds-text-tertiary); }
.viz-input:hover:not(:disabled), .viz-select:hover:not(:disabled), .viz-textarea:hover:not(:disabled) { box-shadow: var(--ds-input-shadow-hover), var(--ds-input-shadow-inset); }
.viz-input:focus, .viz-select:focus, .viz-textarea:focus { outline: none; box-shadow: var(--ds-input-shadow-focus), var(--ds-input-shadow-inset); }
.viz-input:disabled, .viz-select:disabled, .viz-textarea:disabled { opacity: 0.4; }
.viz-textarea { display: block; min-height: 72px; resize: vertical; }
.viz-range { width: 100%; height: 24px; margin: 0; appearance: none; background: transparent; cursor: pointer; }
.viz-range::-webkit-slider-runnable-track { height: 16px; border-radius: var(--ds-radius-pill); background: linear-gradient(to right, var(--ds-brand-primary) 0 var(--viz-range-progress, 50%), var(--ds-on-surface) var(--viz-range-progress, 50%) 100%); }
.viz-range::-webkit-slider-thumb { width: 22px; height: 12px; margin-top: 2px; appearance: none; border: 0; border-radius: var(--ds-radius-pill); background: var(--ds-surface-100); box-shadow: var(--ds-elevation-100); transition: transform var(--ds-motion-spring), box-shadow var(--ds-motion-spring); }
.viz-range:active::-webkit-slider-thumb { transform: scale(1.35); box-shadow: var(--ds-elevation-200); }
.viz-range:focus-visible { outline: 2px solid color-mix(in srgb, var(--ds-brand-primary) 38%, transparent); outline-offset: 2px; border-radius: var(--ds-radius-pill); }
.viz-range:disabled { opacity: 0.4; cursor: default; }
.viz-check { display: inline-flex; align-items: center; gap: 7px; color: var(--ds-text-primary); font-size: 12px; cursor: pointer; }
.viz-check input:not(.viz-switch) { width: 16px; height: 16px; margin: 0; accent-color: var(--ds-brand-primary); }
.viz-switch { width: 44px; height: 24px; margin: 0; appearance: none; border-radius: var(--ds-radius-pill); cursor: pointer; }
.viz-tabs { display: inline-flex; align-self: flex-start; align-items: center; width: max-content; max-width: 100%; min-height: 32px; padding: 3px; overflow-x: auto; border-radius: var(--ds-radius-pill); background: var(--ds-on-surface); }
.viz-tabs[data-stretch] { display: flex; align-self: stretch; width: 100%; overflow-x: hidden; }
.viz-tab { position: relative; z-index: 1; display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; min-height: 26px; padding: 0 12px; border: 0; border-radius: var(--ds-radius-pill); background: transparent; color: var(--ds-icon); font-size: 12px; font-weight: 500; cursor: pointer; transition: color var(--ds-motion-swift), background-color var(--ds-motion-soft), box-shadow var(--ds-motion-soft); }
.viz-tabs[data-stretch] > .viz-tab { flex: 1 1 0; min-width: 0; }
.viz-tab[aria-selected="true"] { background: var(--ds-surface-100); color: var(--ds-text-primary); box-shadow: var(--ds-elevation-100); }
.viz-tab:disabled { opacity: 0.4; cursor: default; }
[data-tab-panel][hidden] { display: none !important; }
.viz-tag { display: inline-flex; align-items: center; min-height: 24px; padding: 2px 8px; border-radius: var(--ds-radius-sm); background: var(--ds-on-surface); color: var(--ds-text-secondary); font-size: 12px; font-weight: 500; }
.viz-divider { width: 100%; height: 1px; border: 0; background: var(--ds-divider); }
.viz-table-wrap { width: 100%; overflow-x: auto; border-radius: var(--ds-radius-md); }
.viz-table { width: 100%; border-collapse: collapse; color: var(--ds-text-primary); font-size: 12px; }
.viz-table th, .viz-table td { padding: 8px 10px; border-bottom: 1px solid var(--ds-divider); text-align: left; vertical-align: middle; }
.viz-table th { color: var(--ds-text-secondary); font-weight: 500; background: var(--ds-on-surface); }
.viz-table td[data-align="number"], .viz-table th[data-align="number"] { text-align: right; font-variant-numeric: tabular-nums; }
.viz-chart { min-width: 0; padding: 12px; border-radius: var(--ds-radius-lg); background: var(--ds-on-surface); }
.viz-chart svg { color: var(--viz-chart-text); }
.viz-chart svg text:not([fill]) { fill: var(--viz-chart-text); }
.viz-chart svg :where(.viz-chart-text) { fill: var(--viz-chart-text); }
.viz-chart svg :where(.viz-chart-text-muted) { fill: var(--viz-chart-text-muted); }
.viz-chart svg :where(.viz-chart-grid) { stroke: var(--viz-chart-grid); }
@media (max-width: 420px) {
  .viz-card { padding: 12px; }
  .viz-metric-value { font-size: 17px; }
  .viz-toolbar { align-items: stretch; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
:root[data-reduce-motion="true"] *,
:root[data-reduce-motion="true"] *::before,
:root[data-reduce-motion="true"] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}
`;

/**
 * NewMax upgrades bare `button` elements inside `main.viz-root` into real kit
 * buttons, which is why its prompt tells the model NOT to style them itself.
 * Only the button shape is enforced here; the tooltip runtime is host chrome
 * and is not needed for correct layout/height reporting.
 */
export const VISUALIZATION_UI_KIT_ENFORCEMENT_STYLES = `
main.viz-root button:where(:not(.viz-tab):not(.viz-select-trigger):not(.viz-select-option)) {
  appearance: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 4px !important;
  min-width: 0 !important;
  max-width: 100% !important;
  min-height: 32px !important;
  padding: 0 12px !important;
  border: 0 !important;
  border-radius: var(--ds-radius-pill) !important;
  background: var(--ds-on-surface) !important;
  color: var(--ds-brand-primary) !important;
  box-shadow: none !important;
  font-size: 13px !important;
  font-weight: 500 !important;
  line-height: 1 !important;
  overflow: hidden !important;
  white-space: nowrap !important;
  text-align: center !important;
  cursor: pointer !important;
}
main.viz-root button.viz-button:not([data-variant]),
main.viz-root button[data-variant="primary"],
main.viz-root button.primary,
main.viz-root button.is-primary { background: var(--ds-brand-primary) !important; color: var(--ds-brand-primary-text) !important; }
main.viz-root button[data-variant="secondary"],
main.viz-root button.secondary,
main.viz-root button.is-secondary { border: 1px solid var(--ds-brand-primary) !important; background: transparent !important; color: var(--ds-brand-primary) !important; }
main.viz-root button[data-variant="ghost"],
main.viz-root button.ghost,
main.viz-root button.is-ghost { background: transparent !important; }
main.viz-root button[data-variant="danger"],
main.viz-root button.danger,
main.viz-root button.is-danger { background: color-mix(in srgb, var(--ds-danger) 6%, transparent) !important; color: var(--ds-danger) !important; }
main.viz-root button:where(:not(.viz-tab):not(.viz-select-trigger):not(.viz-select-option)):hover:not(:disabled) { opacity: 0.8 !important; }
main.viz-root button:where(:not(.viz-tab):not(.viz-select-trigger):not(.viz-select-option)):active:not(:disabled) { opacity: 0.7 !important; }
main.viz-root button:disabled { cursor: default !important; opacity: 0.4 !important; }
`;

const HEAD_MARKER = 'sync-think-visualization';
const MAX_TOKEN_VALUE_LENGTH = 2_000;

/**
 * Bake already-known tokens into the document so the first paint is already
 * themed (the IPC design-system message arrives after dom-ready). Mirrors
 * NewMax's `buildThemeBootstrap`.
 */
export function buildThemeBootstrap(tokens?: Record<string, string>): string {
  const safeTokens = Object.fromEntries(
    Object.entries(tokens ?? {}).filter(
      ([name, value]) =>
        /^--ds-[a-z0-9-]+$/.test(name) &&
        typeof value === 'string' &&
        value.length <= MAX_TOKEN_VALUE_LENGTH,
    ),
  );
  if (Object.keys(safeTokens).length === 0) return '';
  const payload = JSON.stringify(safeTokens).replace(/</g, '\\u003c');
  // The shell bundle is loaded as an external module (index.html uses
  // <script src>), so the closing tag does not need to be escaped here.
  return `<script id="${HEAD_MARKER}-theme-bootstrap">(function () {
    var tokens = ${payload};
    Object.entries(tokens).forEach(function (entry) {
      document.documentElement.style.setProperty(entry[0], entry[1]);
    });
  }());</script>`;
}

export interface VisualizationDocumentOptions {
  theme?: VisualizationTheme;
  reduceMotion?: boolean;
  tokens?: Record<string, string>;
  /** Fill the viewport instead of sizing to content (design drafts). */
  fillViewport?: boolean;
}

function injectHead(source: string, extras: string): string {
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${extras}</head>`);
  if (/<body(?:\s|>)/i.test(source)) {
    return source.replace(/<body(?:\s|>)/i, (match) => `${extras}${match}`);
  }
  return `${extras}${source}`;
}

/**
 * Build the guest document. A complete authored document (with `<html>`)
 * keeps its own head/body and gets the kit injected; a bare fragment is wrapped
 * in NewMax's document shell with a `main.viz-root` mount point.
 *
 * Returns HTML, not a data: URL — callers use {@link toVisualizationDataUrl}.
 */
export function buildVisualizationDocumentHtml(
  source: string,
  options: VisualizationDocumentOptions = {},
): string {
  const theme: VisualizationTheme = options.theme === 'dark' ? 'dark' : 'light';
  const reduceMotion = options.reduceMotion === true ? 'true' : 'false';
  const trimmed = source.trim();
  const headExtras = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="${HEAD_MARKER}" content="1">`,
    `<meta name="${HEAD_MARKER}-ui-kit" content="${VISUALIZATION_UI_KIT_VERSION}">`,
    `<meta http-equiv="Content-Security-Policy" content="${VISUALIZATION_CSP}">`,
    `<style>${VISUALIZATION_UI_KIT_STYLES}</style>`,
    buildThemeBootstrap(options.tokens),
    // Design drafts fill the host pane so 100vh layouts track the window, but
    // the box must still grow past the viewport when the content is taller —
    // that growth is what the guest reports back as a larger stage height.
    options.fillViewport
      ? '<style>html{height:100%}body{min-height:100%}main.viz-root{min-height:100%}</style>'
      : '',
  ]
    .filter(Boolean)
    .join('\n  ');

  if (/<html[\s>]/i.test(trimmed)) {
    // Authored complete document: keep its structure, inject the kit, and make
    // sure a `main.viz-root` exists so the guest preload measures one root.
    let documentSource = injectHead(trimmed, `\n  ${headExtras}\n`);
    documentSource = documentSource.replace(/<html\b([^>]*)>/i, (match, attributes: string) => {
      const extras: string[] = [];
      if (!/\bdata-theme\s*=/i.test(attributes)) extras.push(`data-theme="${theme}"`);
      if (!/\bdata-reduce-motion\s*=/i.test(attributes)) {
        extras.push(`data-reduce-motion="${reduceMotion}"`);
      }
      if (!/\bdata-ui-kit\s*=/i.test(attributes)) {
        extras.push(`data-ui-kit="${VISUALIZATION_UI_KIT_VERSION}"`);
      }
      return extras.length === 0 ? match : `<html${attributes} ${extras.join(' ')}>`;
    });
    const rootWrapped = /<main\b[^>]*\bclass\s*=\s*["'][^"']*\bviz-root\b/i.test(documentSource);
    if (!rootWrapped && /<body(?:\s[^>]*)?>/i.test(documentSource)) {
      documentSource = documentSource
        .replace(/(<body(?:\s[^>]*)?>)/i, `$1<main class="viz-root">`)
        .replace(/<\/body>/i, '</main></body>');
    }
    const enforcement = `<style>${VISUALIZATION_UI_KIT_ENFORCEMENT_STYLES}</style>`;
    return /<\/body>/i.test(documentSource)
      ? documentSource.replace(/<\/body>/i, `${enforcement}</body>`)
      : `${documentSource}\n${enforcement}`;
  }

  const rootWrapped = /<main\b[^>]*\bclass\s*=\s*["'][^"']*\bviz-root\b/i.test(trimmed);
  const bodyContent = rootWrapped
    ? trimmed
    : `<main class="viz-root" data-ui-kit="${VISUALIZATION_UI_KIT_VERSION}">${trimmed}</main>`;
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}" data-reduce-motion="${reduceMotion}">
<head>
  ${headExtras}
</head>
<body>
  ${bodyContent}
  <style>${VISUALIZATION_UI_KIT_ENFORCEMENT_STYLES}</style>
</body>
</html>`;
}

export function toVisualizationDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
