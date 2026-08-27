/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_PREFERENCE_KEY,
  applyAppearancePreferences,
  matchesShortcut,
  readAppearancePreferences,
  readShortcutPreferences,
  updateShortcutPreference,
} from './preferences-store.js';

const setTheme = vi.fn();

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-image-theme');
  document.documentElement.removeAttribute('data-color-theme');
  document.documentElement.removeAttribute('data-image-theme-effect');
  document.documentElement.removeAttribute('style');
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime: { setTheme } },
  });
  setTheme.mockReset();
});

describe('appearance preferences', () => {
  it('migrates the legacy shell theme into the versioned preference', () => {
    localStorage.setItem('sync-think-shell-theme', 'dark');
    expect(readAppearancePreferences().mode).toBe('dark');
  });

  it('applies color, image, and conversation typography to the document', () => {
    const preferences = {
      ...readAppearancePreferences(),
      mode: 'dark' as const,
      colorTheme: 'custom' as const,
      imageThemeId: 'custom-upload',
      customImageDataUrl: 'data:image/webp;base64,AAAA',
      customImageBackground: '#ffffff',
      customImageAccent: '#336699',
      customPrimary: '#336699',
      chatFontSize: 17,
      useSerifFont: true,
    };

    applyAppearancePreferences(preferences);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.colorTheme).toBe('custom');
    expect(document.documentElement.dataset.imageTheme).toBe('active');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toMatch(
      /^#[0-9a-f]{6}$/,
    );
    expect(document.documentElement.style.getPropertyValue('--shell-message-reading-blur')).toBe(
      '18px',
    );
    expect(document.documentElement.style.getPropertyValue('--shell-chat-font-size')).toBe('17px');
    expect(document.documentElement.style.getPropertyValue('--shell-chat-font-family')).toBe(
      'var(--font-serif)',
    );
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCE_KEY) ?? '{}').mode).toBe('dark');
  });

  it('keeps image-derived surfaces dark when a light image is used in dark mode', () => {
    applyAppearancePreferences({
      ...readAppearancePreferences(),
      mode: 'dark',
      imageThemeId: 'custom-upload',
      customImageDataUrl: 'data:image/webp;base64,AAAA',
      customImageBackground: '#f7f5ef',
      customImageAccent: '#4f7665',
    });

    const page = document.documentElement.style.getPropertyValue('--color-page');
    expect(Number.parseInt(page.slice(1, 3), 16)).toBeLessThan(64);
    expect(Number.parseInt(page.slice(3, 5), 16)).toBeLessThan(64);
    expect(Number.parseInt(page.slice(5, 7), 16)).toBeLessThan(64);
  });

  it('maps a light image theme onto NewMax four-level solid chrome surfaces', () => {
    applyAppearancePreferences({
      ...readAppearancePreferences(),
      mode: 'light',
      imageThemeId: 'custom-upload',
      imageEffect: 'overlay',
      customImageDataUrl: 'data:image/webp;base64,AAAA',
      customImageBackground: '#82b658',
      customImageAccent: '#368ccc',
    });

    const root = document.documentElement.style;
    expect(root.getPropertyValue('--color-surface')).toBe('#ffffff');
    expect(root.getPropertyValue('--color-chat')).not.toBe(
      root.getPropertyValue('--color-sidebar'),
    );
    expect(root.getPropertyValue('--color-sidebar')).not.toBe(
      root.getPropertyValue('--color-page'),
    );
    expect(root.getPropertyValue('--color-stage-tabs')).toBe(
      root.getPropertyValue('--color-sidebar'),
    );
    expect(root.getPropertyValue('--shell-message-reading-blur')).toBe('0px');
    expect(root.getPropertyValue('--shell-message-reading-scrim')).toContain('64%');
    expect(root.getPropertyValue('--shell-wallpaper-overlay')).toContain('40%');
    expect(root.getPropertyValue('--shell-chat-composer-surface')).toContain('86%');
  });

  it('uses the image color variant to change the extracted chrome ramp', () => {
    const base = {
      ...readAppearancePreferences(),
      mode: 'light' as const,
      imageThemeId: 'custom-upload',
      customImageDataUrl: 'data:image/webp;base64,AAAA',
      customImageBackground: '#82b658',
      customImageAccent: '#368ccc',
    };
    applyAppearancePreferences({
      ...base,
      imageThemeVariants: { 'custom-upload': 'mono' },
    });
    const mono = document.documentElement.style.getPropertyValue('--color-page');
    applyAppearancePreferences({
      ...base,
      imageThemeVariants: { 'custom-upload': 'rich' },
    });
    const rich = document.documentElement.style.getPropertyValue('--color-page');
    expect(rich).not.toBe(mono);
  });
});

describe('shortcut preferences', () => {
  it('persists a changed shortcut without losing the remaining defaults', () => {
    updateShortcutPreference('newChat', { enabled: false });
    const restored = readShortcutPreferences();
    expect(restored.newChat.enabled).toBe(false);
    expect(restored.conversationSearch.enabled).toBe(true);
  });

  it('matches CommandOrControl and arrow accelerators', () => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true });
    expect(matchesShortcut(event, 'CommandOrControl+Left')).toBe(true);
    expect(matchesShortcut(event, 'CommandOrControl+Right')).toBe(false);
  });
});
