/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { getTerminalViewportStyle, getXtermTheme } from './xterm-theme.js';

describe('NewMax xterm theme', () => {
  it('uses NewMax fallbacks when host --ds tokens are absent', () => {
    expect(getXtermTheme()).toMatchObject({
      background: '#FAF8F3',
      foreground: '#2D2A26',
      cursor: '#2d4739',
      black: '#2D2A26',
      red: '#b3261e',
      brightCyan: '#087984',
    });
  });

  it('follows the active skin workbench tokens before NewMax fallbacks', () => {
    document.documentElement.style.setProperty('--color-workbench-content', '#d8d2cc');
    document.documentElement.style.setProperty('--color-text', '#292628');
    document.documentElement.style.setProperty('--color-text-secondary', '#80756f');
    document.documentElement.style.setProperty('--color-settings-action', '#984933');
    expect(getXtermTheme()).toMatchObject({
      background: '#d8d2cc',
      foreground: '#292628',
      cursor: '#984933',
      brightBlack: '#80756f',
    });
    document.documentElement.style.removeProperty('--color-workbench-content');
    document.documentElement.style.removeProperty('--color-text');
    document.documentElement.style.removeProperty('--color-text-secondary');
    document.documentElement.style.removeProperty('--color-settings-action');
  });

  it('applies NewMax viewport padding and clears the xterm scrollbar shadow', () => {
    expect(getTerminalViewportStyle('#FAF8F3')).toMatchObject({
      padding: '8px 12px',
      backgroundColor: '#FAF8F3',
      '--vscode-scrollbar-shadow': 'transparent',
    });
  });
});
