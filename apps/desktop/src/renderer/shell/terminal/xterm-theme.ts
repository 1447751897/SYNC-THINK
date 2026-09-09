import type { CSSProperties } from 'react';

const LIGHT_ANSI_PALETTE = {
  red: '#b3261e',
  green: '#256d1b',
  yellow: '#765800',
  blue: '#075ea8',
  magenta: '#7b3f98',
  cyan: '#006b73',
  brightRed: '#c42b23',
  brightGreen: '#2f7824',
  brightYellow: '#806000',
  brightBlue: '#146bb8',
  brightMagenta: '#8847a5',
  brightCyan: '#087984',
};

const DARK_ANSI_PALETTE = {
  red: '#ff7b7b',
  green: '#68c968',
  yellow: '#d6a94d',
  blue: '#6aa6ef',
  magenta: '#dc82ec',
  cyan: '#45bcbc',
  brightRed: '#ff9a9a',
  brightGreen: '#86ef86',
  brightYellow: '#ffe070',
  brightBlue: '#82bcff',
  brightMagenta: '#f19af1',
  brightCyan: '#70e0e0',
};

function cssVar(names: string | readonly string[], fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const list = typeof names === 'string' ? [names] : names;
  for (const name of list) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) return value;
  }
  return fallback;
}

function getAnsiPalette(isDark: boolean): Record<string, string> {
  return isDark ? DARK_ANSI_PALETTE : LIGHT_ANSI_PALETTE;
}

/** NewMax `getXtermTheme` — host skin tokens first, then NewMax `--ds-*` fallbacks. */
export function getXtermTheme(): Record<string, string> {
  const background = cssVar(
    ['--color-workbench-content', '--color-chat', '--ds-surface-200'],
    '#FAF8F3',
  );
  const foreground = cssVar(['--color-text', '--ds-text-primary'], '#2D2A26');
  const secondary = cssVar(['--color-text-secondary', '--ds-text-secondary'], '#625E57');
  const brand = cssVar(['--color-settings-action', '--ds-brand-primary'], '#2d4739');
  const ansi = getAnsiPalette(document.documentElement.classList.contains('dark'));
  return {
    background,
    foreground,
    cursor: brand,
    cursorAccent: background,
    selectionBackground: `${brand}30`,
    selectionForeground: foreground,
    black: foreground,
    ...ansi,
    white: foreground,
    brightBlack: secondary,
    brightWhite: foreground,
  };
}

/** NewMax `getTerminalViewportStyle`. */
export function getTerminalViewportStyle(termBg: string): CSSProperties {
  return {
    padding: '8px 12px',
    backgroundColor: termBg,
    ['--vscode-scrollbar-shadow' as string]: 'transparent',
  };
}
