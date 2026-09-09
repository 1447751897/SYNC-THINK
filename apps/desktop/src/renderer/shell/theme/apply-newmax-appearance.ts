import { NEWMAX_IMAGE_THEME_PALETTES } from './newmax-image-palettes.js';
import { NEWMAX_NAMED_THEME_VARS } from './newmax-named-themes.js';
import {
  applyRandomThemeVars,
  clearRandomThemeVars,
  customColorPair,
  deriveImageThemeForeground,
  generateRandomTheme,
  resolveImageThemeColors,
  resolveImageThemeVariant,
  type ImageThemePalette,
} from './newmax-theme-engine.js';

export interface NewmaxSkinPreferences {
  colorTheme: string;
  imageThemeId: string | null;
  imageThemeVariants: Record<string, string>;
  customImageBackground: string;
  customImageAccent: string;
  customPrimary: string;
  customPurity: number;
  customContrast: number;
  randomBackground: string;
  randomAccent: string;
  randomMood?: string;
}

const CUSTOM_IMAGE_THEME_ID = 'custom-upload';

const COLOR_FROM_DS: Array<[string, string]> = [
  ['--color-text', '--ds-text-primary'],
  ['--color-text-secondary', '--ds-text-secondary'],
  ['--color-text-faint', '--ds-text-tertiary'],
  ['--color-icon', '--ds-icon'],
  ['--color-accent', '--ds-brand-primary'],
  ['--color-accent-soft', '--ds-pill-bg'],
  ['--color-accent-fg', '--ds-brand-primary-text'],
  ['--color-settings-action', '--ds-brand-primary'],
  ['--color-settings-action-fg', '--ds-brand-primary-text'],
  ['--color-selection-border', '--ds-brand-primary'],
  ['--color-focus-ring', '--ds-brand-primary'],
  ['--color-info', '--ds-brand-primary'],
  ['--color-success', '--ds-brand-primary'],
  ['--color-hover', '--ds-on-surface'],
  ['--color-control-hover', '--ds-on-surface'],
  ['--color-border', '--ds-divider'],
];

const SURFACE_COLOR_FROM_DS: Array<[string, string]> = [
  ['--color-surface', '--ds-surface-100'],
  ['--color-overlay', '--ds-surface-100'],
  ['--color-active', '--ds-surface-100'],
  ['--color-control', '--ds-surface-100'],
  ['--color-selection', '--ds-surface-100'],
  ['--color-chat', '--ds-surface-200'],
  ['--color-panel', '--ds-surface-200'],
  ['--color-sidebar', '--ds-surface-300'],
  ['--color-elevated', '--ds-surface-300'],
  ['--color-recent', '--ds-surface-300'],
  ['--color-stage-tabs', '--ds-surface-300'],
];

function readInline(root: HTMLElement, name: string): string {
  return root.style.getPropertyValue(name).trim();
}

function writeMappedColors(root: HTMLElement, imageTheme: boolean): void {
  for (const [colorName, dsName] of COLOR_FROM_DS) {
    const value = readInline(root, dsName);
    if (value) root.style.setProperty(colorName, value);
  }
  for (const [colorName, dsName] of SURFACE_COLOR_FROM_DS) {
    const value = readInline(root, dsName);
    if (value) root.style.setProperty(colorName, value);
  }

  const surface200 = readInline(root, '--ds-surface-200');
  const surface300 = readInline(root, '--ds-surface-300');
  const surface400 = readInline(root, '--ds-surface-400');
  const page = imageTheme ? surface400 || surface300 : surface200;
  if (page) {
    root.style.setProperty('--color-page', page);
    root.style.setProperty('--color-page-gutter', page);
  }

  // NewMax workbench fallback is --ds-surface-200. Image/snow-cinnabar right
  // pane then assigns --ds-workbench-surface: var(--ds-tab-strip-surface).
  const workbench = imageTheme ? surface300 || surface200 : surface200;
  const tabStrip = imageTheme ? surface300 || surface200 : surface200;
  if (workbench) {
    root.style.setProperty('--color-workbench', workbench);
    root.style.setProperty('--color-workbench-content', workbench);
  }
  if (tabStrip) root.style.setProperty('--color-tab-strip', tabStrip);
}

function applyGeneratedVars(
  background: string,
  foreground: string,
  dark: boolean,
  mood: string,
  accent?: string,
  customPalette?: { chroma: number; lightSurfaceChroma: number },
  generationOptions?: Parameters<typeof applyRandomThemeVars>[7],
): void {
  applyRandomThemeVars(
    background,
    foreground,
    mood,
    dark,
    accent,
    customPalette,
    undefined,
    generationOptions,
  );
}

function customImagePalette(
  background: string,
  accent: string,
): ImageThemePalette {
  return {
    background,
    foreground: deriveImageThemeForeground(background),
    accent,
    luminance: 0.5,
    mood: 'crisp',
  };
}

export function applyNewmaxSkin(
  root: HTMLElement,
  preferences: NewmaxSkinPreferences,
  dark: boolean,
): void {
  clearRandomThemeVars(
    preferences.randomBackground || '#f5f5f0',
    preferences.randomAccent || '#2d4739',
    preferences.randomMood || 'crisp',
  );
  for (const theme of Object.values(NEWMAX_NAMED_THEME_VARS)) {
    for (const key of new Set([...Object.keys(theme.light), ...Object.keys(theme.dark)])) {
      root.style.removeProperty(key);
    }
  }
  delete root.dataset.theme;

  const named = NEWMAX_NAMED_THEME_VARS[preferences.colorTheme as keyof typeof NEWMAX_NAMED_THEME_VARS];
  const preset = preferences.imageThemeId
    ? NEWMAX_IMAGE_THEME_PALETTES[preferences.imageThemeId]
    : undefined;
  const imagePalette =
    preferences.imageThemeId === CUSTOM_IMAGE_THEME_ID
      ? customImagePalette(preferences.customImageBackground, preferences.customImageAccent)
      : preset;

  if (imagePalette) {
    root.dataset.theme = 'image-wallpaper';
    const variant = resolveImageThemeVariant(
      preferences.imageThemeVariants[preferences.imageThemeId ?? ''] ?? 'soft',
    );
    const resolved = resolveImageThemeColors(imagePalette, variant);
    applyGeneratedVars(
      imagePalette.background,
      resolved.foreground,
      dark,
      String(imagePalette.mood),
      resolved.accent,
      undefined,
      resolved.generationOptions,
    );
    writeMappedColors(root, true);
    return;
  }

  if (preferences.colorTheme === 'random') {
    applyGeneratedVars(
      preferences.randomBackground,
      preferences.randomAccent,
      dark,
      preferences.randomMood || 'crisp',
    );
    writeMappedColors(root, false);
    return;
  }

  if (preferences.colorTheme === 'custom') {
    const pair = customColorPair(
      preferences.customPrimary,
      preferences.customPurity,
      preferences.customContrast,
    );
    applyGeneratedVars(pair.bg, pair.fg, dark, pair.mood, pair.accent, pair.palette);
    writeMappedColors(root, false);
    return;
  }

  if (named) {
    root.dataset.theme = preferences.colorTheme;
    const vars = dark ? named.dark : named.light;
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    writeMappedColors(root, false);
  }
}

export function previewImageThemeBrand(
  palette: ImageThemePalette,
  variant: 'mono' | 'neutral' | 'soft' | 'rich',
  dark: boolean,
): string {
  const resolved = resolveImageThemeColors(palette, variant);
  const vars = generateRandomTheme(
    palette.background,
    resolved.foreground,
    String(palette.mood),
    resolved.accent,
    undefined,
    undefined,
    resolved.generationOptions,
  );
  return vars[dark ? 'dark' : 'light']['--ds-brand-primary'] ?? resolved.accent;
}
