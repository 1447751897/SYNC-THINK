/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { applyWorkbenchAppearance, clearWorkbenchAppearance } from './apply-workbench-appearance.js';
import { applyAppearancePreferences, readAppearancePreferences } from '../preferences-store.js';
const root = document.documentElement;
afterEach(() => { root.removeAttribute('style'); root.removeAttribute('data-shell-design'); root.classList.remove('dark'); localStorage.clear(); });
describe('agent-family workbench appearance', () => {
  it('opts the whole document into the visual family, including portal menus', () => {
    applyWorkbenchAppearance(root, { colorTheme: 'default' });
    expect(root.dataset.shellDesign).toBe('agent');
    expect(root.style.getPropertyValue('--color-chat')).toBe('var(--wb-default-panel)');
    expect(root.style.getPropertyValue('--color-sidebar')).toBe('var(--wb-default-panel)');
    expect(root.style.getPropertyValue('--color-overlay')).toBe('var(--wb-default-page)');
    expect(root.style.getPropertyValue('--color-accent')).toBe('var(--wb-default-primary)');
  });
  it.each(['azure', 'custom', 'random'])('preserves the %s palette instead of forcing blue', colorTheme => {
    root.style.setProperty('--color-accent', 'rgb(40, 80, 60)');
    applyWorkbenchAppearance(root, { colorTheme });
    expect(root.style.getPropertyValue('--color-accent')).toBe('rgb(40, 80, 60)');
    expect(root.style.getPropertyValue('--color-chat')).toBe('');
  });
  it('retains wallpaper palette ownership', () => {
    root.style.setProperty('--color-chat', 'rgb(240, 240, 230)');
    applyWorkbenchAppearance(root, { colorTheme: 'default', imageThemeId: 'preset-lakewood' });
    expect(root.style.getPropertyValue('--color-chat')).toBe('rgb(240, 240, 230)');
  });
  it('clears only workbench-owned mappings before theme switches', () => {
    applyWorkbenchAppearance(root, { colorTheme: 'default' });
    root.style.setProperty('--color-accent', 'rgb(40, 80, 60)');
    clearWorkbenchAppearance(root);
    expect(root.style.getPropertyValue('--color-chat')).toBe('');
    expect(root.style.getPropertyValue('--color-selection')).toBe('');
    expect(root.style.getPropertyValue('--color-accent')).toBe('rgb(40, 80, 60)');
  });
  it('integrates with real appearance settings across default, dark and named themes', () => {
    const preferences = readAppearancePreferences();
    applyAppearancePreferences({ ...preferences, mode: 'light', colorTheme: 'default' });
    expect(root.style.getPropertyValue('--color-page')).toBe('var(--wb-default-page)');
    applyAppearancePreferences({ ...preferences, mode: 'dark', colorTheme: 'default' });
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.style.getPropertyValue('--color-text')).toBe('var(--wb-default-text)');
    applyAppearancePreferences({ ...preferences, mode: 'light', colorTheme: 'azure' });
    expect(root.style.getPropertyValue('--color-page')).not.toContain('--wb-default-');
    applyAppearancePreferences({ ...preferences, mode: 'light', colorTheme: 'default' });
    expect(root.style.getPropertyValue('--color-page')).toBe('var(--wb-default-page)');
  });
});
