/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyNewmaxSkin } from './apply-newmax-appearance.js';
import { NEWMAX_IMAGE_THEME_PALETTES } from './newmax-image-palettes.js';

function skin(overrides: Partial<Parameters<typeof applyNewmaxSkin>[1]> = {}) {
  return {
    colorTheme: 'default',
    imageThemeId: null,
    imageThemeVariants: {},
    customImageBackground: '#82b658',
    customImageAccent: '#368ccc',
    customPrimary: '#336699',
    customPurity: 80,
    customContrast: 86,
    randomBackground: '#f5f5f0',
    randomAccent: '#2d4739',
    randomMood: 'crisp',
    ...overrides,
  };
}

beforeEach(() => {
  document.documentElement.removeAttribute('class');
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('applyNewmaxSkin', () => {
  it('writes NewMax generateRandomTheme surfaces for an image theme', () => {
    applyNewmaxSkin(document.documentElement, skin({ imageThemeId: 'custom-upload' }), false);
    const root = document.documentElement.style;
    expect(document.documentElement.dataset.theme).toBe('image-wallpaper');
    expect(root.getPropertyValue('--color-surface')).toBe('#ffffff');
    expect(root.getPropertyValue('--color-chat')).toMatch(/^#[0-9a-f]{6}$/);
    expect(root.getPropertyValue('--color-chat')).not.toBe(root.getPropertyValue('--color-sidebar'));
    expect(root.getPropertyValue('--color-workbench')).toBe(root.getPropertyValue('--color-tab-strip'));
    expect(root.getPropertyValue('--ds-surface-200')).toBe(root.getPropertyValue('--color-chat'));
  });

  it('uses the NewMax azure token table for a named color theme', () => {
    applyNewmaxSkin(document.documentElement, skin({ colorTheme: 'azure' }), false);
    expect(document.documentElement.dataset.theme).toBe('azure');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#0a64d6');
    expect(document.documentElement.style.getPropertyValue('--color-chat')).toBe('#fbfbfb');
  });

  it('keeps preset image palettes identical to NewMax', () => {
    expect(NEWMAX_IMAGE_THEME_PALETTES['preset-lakewood']?.accent).toBe('#042a18');
    expect(NEWMAX_IMAGE_THEME_PALETTES['preset-ember-rock']?.background).toBe('#cc704d');
  });
});
