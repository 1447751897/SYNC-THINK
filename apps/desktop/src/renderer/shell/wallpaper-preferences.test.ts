/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_PREFERENCE_KEY, applyAppearancePreferences, readAppearancePreferences, writeAppearancePreferences } from './preferences-store.js';

const wallpaper = (id: string, name = id) => ({
  id, name, dataUrl: 'data:image/webp;base64,dGVzdA==',
  background: '#82b658', accent: '#368ccc', focalPoint: { x: 25, y: 70 },
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
});
afterEach(() => vi.restoreAllMocks());

describe('wallpaper library preferences', () => {
  it('migrates the original upload with its name, palette, focal point and selection', () => {
    localStorage.setItem(APPEARANCE_PREFERENCE_KEY, JSON.stringify({
      imageThemeId: 'custom-upload', customImageDataUrl: wallpaper('custom-upload').dataUrl,
      customImageName: '旧图片', customImageBackground: '#82b658', customImageAccent: '#368ccc',
      customImageFocalPoint: { x: 25, y: 70 }, imageThemeVariants: { 'custom-upload': 'rich' },
    }));
    const restored = readAppearancePreferences();
    expect(restored.customImageThemes).toEqual([wallpaper('custom-upload', '旧图片')]);
    expect(restored.imageThemeId).toBe('custom-upload');
    expect(restored.imageThemeVariants['custom-upload']).toBe('rich');
    expect(restored.imageOverlayOpacity).toBe(50);
  });

  it('does not resurrect a deleted legacy upload when the library is explicitly empty', () => {
    localStorage.setItem(APPEARANCE_PREFERENCE_KEY, JSON.stringify({ imageThemeId: 'custom-upload', customImageThemes: [], customImageDataUrl: wallpaper('custom-upload').dataUrl }));
    expect(readAppearancePreferences().customImageThemes).toEqual([]);
    applyAppearancePreferences(readAppearancePreferences());
    expect(document.documentElement.hasAttribute('data-image-theme')).toBe(false);
  });

  it('normalizes and deduplicates image entries while ignoring invalid records', () => {
    localStorage.setItem(APPEARANCE_PREFERENCE_KEY, JSON.stringify({ customImageThemes: [
      { ...wallpaper('custom-upload-one'), focalPoint: { x: -10, y: 120 } },
      wallpaper('custom-upload-one'), { ...wallpaper('preset-lakewood'), dataUrl: 'https://example.test/image' }, null,
    ] }));
    const images = readAppearancePreferences().customImageThemes;
    expect(images).toHaveLength(1);
    expect(images[0]?.focalPoint).toEqual({ x: 0, y: 100 });
  });

  it('uses the selected library entry for the wallpaper, palette and focal point', () => {
    const first = wallpaper('custom-upload-one');
    const second = { ...wallpaper('custom-upload-two'), background: '#613f55', accent: '#ac728a', focalPoint: { x: 85, y: 10 } };
    const base = { ...readAppearancePreferences(), mode: 'light' as const, customImageThemes: [first, second] };
    applyAppearancePreferences({ ...base, imageThemeId: first.id });
    const firstSurface = document.documentElement.style.getPropertyValue('--color-page');
    applyAppearancePreferences({ ...base, imageThemeId: second.id });
    expect(document.documentElement.dataset.imageTheme).toBe('active');
    expect(document.documentElement.dataset.theme).toBe('image-wallpaper');
    expect(document.documentElement.style.getPropertyValue('--shell-wallpaper-image')).toContain(second.dataUrl);
    expect(document.documentElement.style.getPropertyValue('--shell-wallpaper-position')).toBe('85% 10%');
    expect(document.documentElement.style.getPropertyValue('--color-page')).not.toBe(firstSurface);
  });

  it('stores the library without duplicating legacy image bytes', () => {
    const preferences = { ...readAppearancePreferences(), customImageThemes: [wallpaper('custom-upload')], customImageDataUrl: wallpaper('custom-upload').dataUrl };
    expect(writeAppearancePreferences(preferences)).toBe(true);
    const saved = JSON.parse(localStorage.getItem(APPEARANCE_PREFERENCE_KEY)!);
    expect(saved.customImageDataUrl).toBeNull();
    expect(readAppearancePreferences().customImageThemes).toHaveLength(1);
  });

  it('reports quota failure while preserving the previously stored library', () => {
    const previous = JSON.stringify({ customImageThemes: [wallpaper('custom-upload-one')] });
    localStorage.setItem(APPEARANCE_PREFERENCE_KEY, previous);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    expect(writeAppearancePreferences({ ...readAppearancePreferences(), customImageThemes: [wallpaper('custom-upload-two')] })).toBe(false);
    expect(localStorage.getItem(APPEARANCE_PREFERENCE_KEY)).toBe(previous);
  });
});

describe('wallpaper mask strength', () => {
  it.each([-30, 130, 'invalid'] as const)('normalizes persisted strength %s', value => {
    localStorage.setItem(APPEARANCE_PREFERENCE_KEY, JSON.stringify({ imageOverlayOpacity: value }));
    expect(readAppearancePreferences().imageOverlayOpacity).toBe(typeof value === 'number' ? Math.max(0, Math.min(100, value)) : 50);
  });

  it.each(['light', 'dark'] as const)('removes all colored wallpaper washes at zero in %s mode', mode => {
    applyAppearancePreferences({ ...readAppearancePreferences(), mode, imageThemeId: 'preset-lakewood', imageEffect: 'overlay', imageOverlayOpacity: 0 });
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--shell-wallpaper-overlay')).toBe('linear-gradient(transparent, transparent)');
    expect(root.getPropertyValue('--shell-message-reading-scrim')).toBe('transparent');
    expect(root.getPropertyValue('--shell-wallpaper-transition-surface')).toContain('0%');
    expect(root.getPropertyValue('--shell-wallpaper-empty-scrim')).toContain('0%');
    expect(root.getPropertyValue('--shell-chat-composer-surface')).not.toBe('transparent');
  });

  it.each(['light', 'dark'] as const)('keeps reading blur while allowing a clear color mask in %s mode', mode => {
    applyAppearancePreferences({ ...readAppearancePreferences(), mode, imageThemeId: 'preset-lakewood', imageEffect: 'blur', imageOverlayOpacity: 0 });
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--shell-wallpaper-overlay')).toBe('linear-gradient(transparent, transparent)');
    expect(root.getPropertyValue('--shell-message-reading-scrim')).toBe('transparent');
    expect(root.getPropertyValue('--shell-message-reading-blur')).toBe('18px');
  });

  it('updates strength without changing the selected image and clears presentation on plain themes', () => {
    const base = { ...readAppearancePreferences(), mode: 'light' as const, imageThemeId: 'preset-lakewood', imageEffect: 'overlay' as const };
    applyAppearancePreferences({ ...base, imageOverlayOpacity: 100 });
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--shell-wallpaper-overlay')).toContain('100%');
    expect(root.getPropertyValue('--shell-message-reading-blur')).toBe('0px');
    applyAppearancePreferences({ ...base, imageThemeId: null });
    for (const property of ['--shell-wallpaper-overlay', '--shell-wallpaper-transition-surface', '--shell-wallpaper-empty-scrim']) {
      expect(root.getPropertyValue(property)).toBe('');
    }
  });
});
