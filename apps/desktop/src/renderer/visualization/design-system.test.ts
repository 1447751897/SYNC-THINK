/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  VISUALIZATION_UI_KIT_VERSION,
  buildVisualizationDesignSystem,
  readVisualizationDesignTokens,
  visualizationTheme,
} from './design-system.js';
import { buildVisualizationDocumentHtml } from './ui-kit.js';

const root = document.documentElement;

afterEach(() => {
  root.removeAttribute('style');
  root.classList.remove('dark');
});

describe('visualization design system bridge', () => {
  it('maps the shell token contract onto the guest --ds-* vocabulary', () => {
    root.style.setProperty('--color-text', '#123456');
    root.style.setProperty('--color-chat', '#faf9f5');
    root.style.setProperty('--color-accent', '#2f9b5b');

    const tokens = readVisualizationDesignTokens();

    expect(tokens['--ds-text-primary']).toBe('#123456');
    expect(tokens['--ds-surface-200']).toBe('#faf9f5');
    expect(tokens['--ds-brand-primary']).toBe('#2f9b5b');
    // Unset sources are omitted so the guest UI kit's own default survives.
    expect(tokens['--ds-warning']).toBeUndefined();
  });

  it('follows the shell dark class and carries the UI kit version', () => {
    expect(visualizationTheme()).toBe('light');
    root.classList.add('dark');
    expect(visualizationTheme()).toBe('dark');

    const payload = buildVisualizationDesignSystem();
    expect(payload.theme).toBe('dark');
    expect(payload.uiKitVersion).toBe(VISUALIZATION_UI_KIT_VERSION);
    expect(typeof payload.reduceMotion).toBe('boolean');
  });

  it('bakes known tokens into the document for the first paint', () => {
    const html = buildVisualizationDocumentHtml('<section>Chart</section>', {
      theme: 'dark',
      tokens: { '--ds-text-primary': '#ffffff', '--not-a-token': 'x' },
    });
    expect(html).toContain('sync-think-visualization-theme-bootstrap');
    expect(html).toContain('--ds-text-primary');
    expect(html).not.toContain('--not-a-token');
    expect(html).toContain('data-theme="dark"');
  });
});
