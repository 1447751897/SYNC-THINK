/**
 * Design-system bridge between the shell's `--color-*` token contract and the
 * guest preview's `--ds-*` contract.
 *
 * Why `--ds-*` (and not `--color-*`):
 * NewMax's guest UI kit is authored entirely against `--ds-*` (plus `--viz-*`
 * aliases) and its AI prompt tells generated pages to read theme values from
 * `getComputedStyle(document.documentElement)`. Injecting `--ds-*` keeps
 * AI-authored HTML that was written for NewMax working verbatim, and it gives
 * the guest the full design system (elevation, radii, motion, input shadows)
 * that the shell's `--color-*` names do not cover. The shell keeps owning
 * `--color-*`; this module is the single place where the two vocabularies meet.
 *
 * These files intentionally live outside `renderer/shell/`: the shell token
 * guard (`scripts/check-design-tokens.mjs`) forbids foreign `--ds-*` names in
 * shell sources so a component cannot silently depend on a variable that no
 * theme defines.
 */

/** Bumped whenever the guest UI kit stylesheet changes shape. */
export const VISUALIZATION_UI_KIT_VERSION = 'sync-think-v1';

/** Guest <-> host channels. Must match apps/desktop/src/preload/visualization.ts. */
export const VISUALIZATION_CHANNELS = {
  ready: 'sync-think-visualization:ready',
  height: 'sync-think-visualization:height',
  error: 'sync-think-visualization:error',
  setDesignSystem: 'sync-think-visualization:set-design-system',
  setTheme: 'sync-think-visualization:set-theme',
} as const;

/** Guest window event fired after the design system is applied. */
export const VISUALIZATION_THEME_EVENT = 'sync-think-visualization-themechange';

export type VisualizationTheme = 'light' | 'dark';

/**
 * `--ds-*` name -> shell token that supplies its value. Only tokens whose
 * source resolves to a non-empty value are sent; everything else keeps the
 * UI kit's own NewMax default.
 */
const VISUALIZATION_TOKEN_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ['--ds-text-primary', '--color-text'],
  ['--ds-text-secondary', '--color-text-secondary'],
  ['--ds-text-tertiary', '--color-text-faint'],
  ['--ds-brand-primary', '--color-accent'],
  ['--ds-brand-primary-text', '--color-accent-fg'],
  ['--ds-accent', '--color-accent'],
  ['--ds-accent-text', '--color-accent-fg'],
  ['--ds-icon', '--color-text-secondary'],
  ['--ds-danger', '--color-error'],
  ['--ds-success', '--color-success'],
  ['--ds-warning', '--color-warning'],
  ['--ds-surface-100', '--color-overlay'],
  ['--ds-surface-200', '--color-chat'],
  ['--ds-surface-300', '--color-elevated'],
  ['--ds-surface-400', '--color-selection'],
  ['--ds-surface-input', '--color-control'],
  ['--ds-on-surface', '--color-hover'],
  ['--ds-on-surface-active', '--color-active'],
  ['--ds-selection-bg', '--color-selection'],
  ['--ds-pill-bg', '--color-selection'],
  ['--ds-popover', '--color-overlay'],
  ['--ds-divider', '--color-border'],
  ['--ds-radius-sm', '--radius-row'],
  ['--ds-radius-md', '--radius-card'],
  ['--ds-radius-lg', '--radius-shell'],
  ['--ds-font-display-number', '--font-mono'],
];

function hostDocument(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

export function visualizationTheme(root?: HTMLElement): VisualizationTheme {
  const element = root ?? hostDocument()?.documentElement;
  if (!element) return 'light';
  return element.classList.contains('dark') ? 'dark' : 'light';
}

export function visualizationReduceMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Read the shell's live tokens and expose them under NewMax's `--ds-*` names.
 * Values are computed styles, so the guest follows theme switches without the
 * host having to know which token moved.
 */
export function readVisualizationDesignTokens(
  root?: HTMLElement,
): Record<string, string> {
  const element = root ?? hostDocument()?.documentElement;
  const tokens: Record<string, string> = {};
  if (!element) return tokens;
  const styles = getComputedStyle(element);
  for (const [dsName, sourceName] of VISUALIZATION_TOKEN_SOURCES) {
    const value = styles.getPropertyValue(sourceName).trim();
    if (value) tokens[dsName] = value;
  }
  return tokens;
}

export interface VisualizationDesignSystemPayload {
  theme: VisualizationTheme;
  uiKitVersion: string;
  reduceMotion: boolean;
  tokens: Record<string, string>;
}

/** Build the payload sent over `webview.send(VISUALIZATION_CHANNELS.setDesignSystem)`. */
export function buildVisualizationDesignSystem(
  root?: HTMLElement,
): VisualizationDesignSystemPayload {
  return {
    theme: visualizationTheme(root),
    uiKitVersion: VISUALIZATION_UI_KIT_VERSION,
    reduceMotion: visualizationReduceMotion(),
    tokens: readVisualizationDesignTokens(root),
  };
}
