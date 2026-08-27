import mistyForest from './assets/preferences/misty-forest-DEyvF5So.jpg';
import mistyForestThumb from './assets/preferences/misty-forest-thumb-Cnl_xHtQ.jpg';
import skylineBlue from './assets/preferences/skyline-blue-C6vjvOi0.jpg';
import skylineBlueThumb from './assets/preferences/skyline-blue-thumb-C-i9B8WI.jpg';
import terracottaStudy from './assets/preferences/terracotta-study-XmUFPwkJ.jpg';
import terracottaStudyThumb from './assets/preferences/terracotta-study-thumb-DlyDPFCN.jpg';
import petalHaze from './assets/preferences/petal-haze-C11Kj76f.jpg';
import petalHazeThumb from './assets/preferences/petal-haze-thumb-B3kcRaY-.jpg';
import silverFold from './assets/preferences/silver-fold-BH71H-aC.jpg';
import silverFoldThumb from './assets/preferences/silver-fold-thumb-Btt-O7Qd.jpg';
import aquaCurves from './assets/preferences/aqua-curves-BAf-za5T.jpg';
import aquaCurvesThumb from './assets/preferences/aqua-curves-thumb-aeFWoNuc.jpg';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ImageThemeEffect = 'blur' | 'overlay';
export type ImageThemeVariant = 'mono' | 'neutral' | 'soft' | 'rich';
export type ColorThemeId =
  'random' | 'default' | 'azure' | 'professional' | 'claude' | 'luxury' | 'custom';

export interface AppearancePreferences {
  version: 1;
  mode: ThemeMode;
  colorTheme: ColorThemeId;
  imageThemeId: string | null;
  imageEffect: ImageThemeEffect;
  customImageDataUrl: string | null;
  customImageName: string;
  customImageBackground: string;
  customImageAccent: string;
  customImageFocalPoint: { x: number; y: number };
  imageThemeVariants: Record<string, ImageThemeVariant>;
  dismissedImageThemeIds: string[];
  customPrimary: string;
  customPurity: number;
  customContrast: number;
  randomBackground: string;
  randomAccent: string;
  chatFontSize: number;
  useSerifFont: boolean;
}

export interface ImageThemeOption {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  thumbnailUrl: string;
  background: string;
  accent: string;
}

export interface ColorThemeOption {
  id: Exclude<ColorThemeId, 'custom'>;
  name: string;
  description: string;
  light: { background: string; accent: string };
  dark: { background: string; accent: string };
}

export const APPEARANCE_PREFERENCE_KEY = 'sync-think.preferences.appearance.v1';
export const SHORTCUT_PREFERENCE_KEY = 'sync-think.preferences.shortcuts.v1';
export const PERSONALIZATION_CACHE_KEY = 'sync-think.preferences.personalization.v1';
export const LEGACY_THEME_KEY = 'sync-think-shell-theme';
export const CUSTOM_IMAGE_THEME_ID = 'custom-upload';

export const IMAGE_THEME_OPTIONS: readonly ImageThemeOption[] = [
  {
    id: 'preset-lakewood',
    name: '雾林深境',
    description: '从薄雾针叶林提取云灰、松绿与深森',
    imageUrl: mistyForest,
    thumbnailUrl: mistyForestThumb,
    background: 'var(--preference-color-image-lakewood-background)',
    accent: 'var(--preference-color-image-lakewood-accent)',
  },
  {
    id: 'preset-palm-shore',
    name: '晴穹蓝构',
    description: '从晴空与蓝色立面提取天青、浅蓝与深灰',
    imageUrl: skylineBlue,
    thumbnailUrl: skylineBlueThumb,
    background: 'var(--preference-color-image-palm-shore-background)',
    accent: 'var(--preference-color-image-palm-shore-accent)',
  },
  {
    id: 'preset-ember-rock',
    name: '陶土叠影',
    description: '从陶土色抽象画提取暖橙、砂岩与深赤',
    imageUrl: terracottaStudy,
    thumbnailUrl: terracottaStudyThumb,
    background: 'var(--preference-color-image-ember-rock-background)',
    accent: 'var(--preference-color-image-ember-rock-accent)',
  },
  {
    id: 'preset-atoll-blue',
    name: '雾花柔光',
    description: '从柔焦花影提取雾蓝、粉白与暖橙',
    imageUrl: petalHaze,
    thumbnailUrl: petalHazeThumb,
    background: 'var(--preference-color-image-atoll-blue-background)',
    accent: 'var(--preference-color-image-atoll-blue-accent)',
  },
  {
    id: 'preset-leaf-shadow',
    name: '银白折面',
    description: '从极简建筑折面提取银白、浅灰与冷蓝',
    imageUrl: silverFold,
    thumbnailUrl: silverFoldThumb,
    background: 'var(--preference-color-image-leaf-shadow-background)',
    accent: 'var(--preference-color-image-leaf-shadow-accent)',
  },
  {
    id: 'preset-alpenglow',
    name: '碧波弧影',
    description: '从青碧抽象弧面提取浅青、翡翠与深碧',
    imageUrl: aquaCurves,
    thumbnailUrl: aquaCurvesThumb,
    background: 'var(--preference-color-image-alpenglow-background)',
    accent: 'var(--preference-color-image-alpenglow-accent)',
  },
] as const;

export const COLOR_THEME_OPTIONS: readonly ColorThemeOption[] = [
  {
    id: 'random',
    name: '随机',
    description: '每次点击随机生成配色',
    light: {
      background: 'var(--preference-color-random-light-background)',
      accent: 'var(--preference-color-random-light-accent)',
    },
    dark: {
      background: 'var(--preference-color-random-dark-background)',
      accent: 'var(--preference-color-random-dark-accent)',
    },
  },
  {
    id: 'default',
    name: '墨绿',
    description: '经典深绿，温暖米色背景',
    light: {
      background: 'var(--preference-color-default-light-background)',
      accent: 'var(--preference-color-default-light-accent)',
    },
    dark: {
      background: 'var(--preference-color-default-dark-background)',
      accent: 'var(--preference-color-default-dark-accent)',
    },
  },
  {
    id: 'azure',
    name: '霁青',
    description: 'macOS 风极简中性 × 实心海蓝强调',
    light: {
      background: 'var(--preference-color-azure-light-background)',
      accent: 'var(--preference-color-azure-light-accent)',
    },
    dark: {
      background: 'var(--preference-color-azure-dark-background)',
      accent: 'var(--preference-color-azure-dark-accent)',
    },
  },
  {
    id: 'professional',
    name: '极简',
    description: '清晰专业的深蓝商务风',
    light: {
      background: 'var(--preference-color-professional-light-background)',
      accent: 'var(--preference-color-professional-light-accent)',
    },
    dark: {
      background: 'var(--preference-color-professional-dark-background)',
      accent: 'var(--preference-color-professional-dark-accent)',
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    description: '暖纸张中性色，陶土橙强调',
    light: {
      background: 'var(--preference-color-claude-light-background)',
      accent: 'var(--preference-color-claude-light-accent)',
    },
    dark: {
      background: 'var(--preference-color-claude-dark-background)',
      accent: 'var(--preference-color-claude-dark-accent)',
    },
  },
  {
    id: 'luxury',
    name: '奢华',
    description: '尊贵权威的黑金商务风',
    light: {
      background: 'var(--preference-color-luxury-light-background)',
      accent: 'var(--preference-color-luxury-light-accent)',
    },
    dark: {
      background: 'var(--preference-color-luxury-dark-background)',
      accent: 'var(--preference-color-luxury-dark-accent)',
    },
  },
] as const;

const DEFAULT_APPEARANCE: AppearancePreferences = {
  version: 1,
  mode: 'system',
  colorTheme: 'default',
  imageThemeId: null,
  imageEffect: 'blur',
  customImageDataUrl: null,
  customImageName: '我的图片',
  customImageBackground: '',
  customImageAccent: '',
  customImageFocalPoint: { x: 50, y: 50 },
  imageThemeVariants: {},
  dismissedImageThemeIds: [],
  customPrimary: '',
  customPurity: 79,
  customContrast: 86,
  randomBackground: '',
  randomAccent: '',
  chatFontSize: 14,
  useSerifFont: false,
};

const COLOR_THEME_IDS = new Set<ColorThemeId>([
  'random',
  'default',
  'azure',
  'professional',
  'claude',
  'luxury',
  'custom',
]);
const THEME_MODES = new Set<ThemeMode>(['system', 'light', 'dark']);
const IMAGE_EFFECTS = new Set<ImageThemeEffect>(['blur', 'overlay']);

function storageOrDefault(storage?: Storage): Storage | undefined {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function resolvePreferenceColor(value: string, fallback = '#000000'): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
  if (!match || typeof document === 'undefined') return fallback;
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(match[1]!).trim();
  return /^#[0-9a-f]{6}$/i.test(resolved) ? resolved.toLowerCase() : fallback;
}

export function defaultCustomPrimary(): string {
  return resolvePreferenceColor('var(--preference-color-default-light-accent)');
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function validHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;
}

export function readAppearancePreferences(storage?: Storage): AppearancePreferences {
  const target = storageOrDefault(storage);
  let raw: unknown;
  try {
    raw = JSON.parse(target?.getItem(APPEARANCE_PREFERENCE_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const legacyMode = target?.getItem(LEGACY_THEME_KEY);
  const mode = THEME_MODES.has(record.mode as ThemeMode)
    ? (record.mode as ThemeMode)
    : THEME_MODES.has(legacyMode as ThemeMode)
      ? (legacyMode as ThemeMode)
      : DEFAULT_APPEARANCE.mode;
  const imageThemeId =
    typeof record.imageThemeId === 'string' && record.imageThemeId.trim()
      ? record.imageThemeId.trim()
      : null;
  const customPrimary = defaultCustomPrimary();
  const randomBackground = resolvePreferenceColor(
    'var(--preference-color-random-light-background)',
    '#ffffff',
  );
  const randomAccent = resolvePreferenceColor('var(--preference-color-random-light-accent)');
  const customImageBackground = resolvePreferenceColor(
    'var(--preference-color-default-light-background)',
    '#ffffff',
  );
  const imageThemeVariants: Record<string, ImageThemeVariant> = {};
  if (
    record.imageThemeVariants &&
    typeof record.imageThemeVariants === 'object' &&
    !Array.isArray(record.imageThemeVariants)
  ) {
    for (const [id, variant] of Object.entries(
      record.imageThemeVariants as Record<string, unknown>,
    )) {
      if (variant === 'mono' || variant === 'neutral' || variant === 'soft' || variant === 'rich') {
        imageThemeVariants[id] = variant;
      }
    }
  }
  const dismissedImageThemeIds = Array.isArray(record.dismissedImageThemeIds)
    ? [
        ...new Set(
          record.dismissedImageThemeIds.filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0,
          ),
        ),
      ]
    : [];
  return {
    version: 1,
    mode,
    colorTheme: COLOR_THEME_IDS.has(record.colorTheme as ColorThemeId)
      ? (record.colorTheme as ColorThemeId)
      : DEFAULT_APPEARANCE.colorTheme,
    imageThemeId,
    imageEffect: IMAGE_EFFECTS.has(record.imageEffect as ImageThemeEffect)
      ? (record.imageEffect as ImageThemeEffect)
      : DEFAULT_APPEARANCE.imageEffect,
    customImageDataUrl:
      typeof record.customImageDataUrl === 'string' &&
      record.customImageDataUrl.startsWith('data:image/')
        ? record.customImageDataUrl
        : null,
    customImageName:
      typeof record.customImageName === 'string' && record.customImageName.trim()
        ? record.customImageName.trim().slice(0, 48)
        : DEFAULT_APPEARANCE.customImageName,
    customImageBackground: validHex(record.customImageBackground, customImageBackground),
    customImageAccent: validHex(record.customImageAccent, customPrimary),
    customImageFocalPoint: {
      x: boundedNumber(
        (record.customImageFocalPoint as { x?: unknown } | undefined)?.x,
        0,
        100,
        50,
      ),
      y: boundedNumber(
        (record.customImageFocalPoint as { y?: unknown } | undefined)?.y,
        0,
        100,
        50,
      ),
    },
    imageThemeVariants,
    dismissedImageThemeIds,
    customPrimary: validHex(record.customPrimary, customPrimary),
    customPurity: boundedNumber(record.customPurity, 0, 100, DEFAULT_APPEARANCE.customPurity),
    customContrast: boundedNumber(record.customContrast, 0, 100, DEFAULT_APPEARANCE.customContrast),
    randomBackground: validHex(record.randomBackground, randomBackground),
    randomAccent: validHex(record.randomAccent, randomAccent),
    chatFontSize: boundedNumber(record.chatFontSize, 12, 18, DEFAULT_APPEARANCE.chatFontSize),
    useSerifFont: record.useSerifFont === true,
  };
}

export function writeAppearancePreferences(
  preferences: AppearancePreferences,
  storage?: Storage,
): void {
  const target = storageOrDefault(storage);
  try {
    target?.setItem(APPEARANCE_PREFERENCE_KEY, JSON.stringify(preferences));
    target?.setItem(LEGACY_THEME_KEY, preferences.mode);
  } catch {
    // Uploaded images are compressed before storage, but a full quota still
    // must not make changing the rest of the appearance fail.
  }
}

function hexChannels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function channelHex(value: number): string {
  return Math.min(255, Math.max(0, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

function mixHex(from: string, to: string, amount: number): string {
  const a = hexChannels(from);
  const b = hexChannels(to);
  return `#${a.map((channel, index) => channelHex(channel + (b[index]! - channel) * amount)).join('')}`;
}

function hexToHsl(hex: string): [number, number, number] {
  const [red, green, blue] = hexChannels(hex).map((channel) => channel / 255);
  const max = Math.max(red!, green!, blue!);
  const min = Math.min(red!, green!, blue!);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness * 100];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue =
    max === red
      ? ((green! - blue!) / delta) % 6
      : max === green
        ? (blue! - red!) / delta + 2
        : (red! - green!) / delta + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  return [hue, saturation * 100, lightness * 100];
}

export function imageThemeVariantAccent(
  backgroundValue: string,
  accentValue: string,
  variant: ImageThemeVariant,
): string {
  const background = resolvePreferenceColor(backgroundValue, '#ffffff');
  const accent = resolvePreferenceColor(accentValue);
  const [hue, saturation, lightness] = hexToHsl(accent);
  if (variant === 'mono') return hslToHex(hue, 0, Math.min(58, Math.max(28, lightness)));
  if (variant === 'neutral') return mixHex(accent, background, 0.52);
  if (variant === 'rich') {
    return hslToHex(hue, Math.min(100, Math.max(54, saturation * 1.35)), lightness);
  }
  return accent;
}

const DYNAMIC_COLOR_VARIABLES = [
  '--color-page',
  '--color-page-gutter',
  '--color-sidebar',
  '--color-panel',
  '--color-chat',
  '--color-surface',
  '--color-elevated',
  '--color-overlay',
  '--color-active',
  '--color-hover',
  '--color-recent',
  '--color-stage-tabs',
  '--color-control',
  '--color-control-hover',
  '--color-selection',
  '--color-border',
  '--color-border-strong',
  '--color-text',
  '--color-text-secondary',
  '--color-text-faint',
  '--color-icon',
  '--color-accent',
  '--color-accent-soft',
  '--color-accent-fg',
  '--color-settings-action',
  '--color-settings-action-fg',
  '--color-selection-border',
  '--color-focus-ring',
  '--color-info',
  '--color-success',
] as const;

const IMAGE_THEME_VARIABLES = [
  '--shell-wallpaper-overlay',
  '--shell-message-reading-blur',
  '--shell-message-reading-scrim',
  '--shell-chat-composer-surface',
] as const;

function clearDynamicColors(root: HTMLElement): void {
  for (const name of DYNAMIC_COLOR_VARIABLES) root.style.removeProperty(name);
}

function clearImageThemePresentation(root: HTMLElement): void {
  for (const name of IMAGE_THEME_VARIABLES) root.style.removeProperty(name);
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = hexChannels(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function desaturateHex(hex: string, amount: number): string {
  const [hue, saturation, lightness] = hexToHsl(hex);
  return hslToHex(hue, saturation * (1 - amount), lightness);
}

function imageSurfaceSource(background: string, variant: ImageThemeVariant): string {
  const [hue, saturation, lightness] = hexToHsl(background);
  const scale =
    variant === 'mono' ? 0 : variant === 'neutral' ? 0.28 : variant === 'rich' ? 1.35 : 1;
  return hslToHex(hue, Math.min(100, saturation * scale), lightness);
}

function ensureAccentContrast(accent: string, foreground: string, surfaces: string[]): string {
  if (surfaces.every((surface) => contrastRatio(accent, surface) >= 4.5)) return accent;
  for (let amount = 0.04; amount <= 1; amount += 0.04) {
    const candidate = mixHex(accent, foreground, amount);
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= 4.7)) return candidate;
  }
  return foreground;
}

function setImageDynamicColors(
  root: HTMLElement,
  background: string,
  accent: string,
  variant: ImageThemeVariant,
  dark: boolean,
): void {
  const [backgroundHue, backgroundSaturation] = hexToHsl(background);
  const source = imageSurfaceSource(background, variant);
  const foreground = dark
    ? hslToHex(backgroundHue, Math.min(7, backgroundSaturation * 0.12), 95)
    : hslToHex(backgroundHue, Math.min(22, backgroundSaturation * 0.38), 16);
  const surfaces = dark
    ? {
        surface100: mixHex(hslToHex(backgroundHue, 10, 10), '#ffffff', 0.06),
        surface200: mixHex(hslToHex(backgroundHue, 10, 10), '#ffffff', 0.1),
        surface300: mixHex(hslToHex(backgroundHue, 10, 10), '#ffffff', 0.15),
        surface400: hslToHex(backgroundHue, 10, 10),
      }
    : {
        surface100: '#ffffff',
        surface200: desaturateHex(mixHex(source, '#ffffff', 0.95), 0.15),
        surface300: desaturateHex(mixHex(source, '#ffffff', 0.86), 0.25),
        surface400: desaturateHex(mixHex(source, '#ffffff', 0.77), 0.22),
      };
  const accessibleAccent = ensureAccentContrast(accent, foreground, Object.values(surfaces));
  const accentForeground =
    relativeLuminance(accessibleAccent) > 0.48
      ? hslToHex(backgroundHue, Math.min(8, backgroundSaturation * 0.14), 10)
      : '#ffffff';
  const border = mixHex(surfaces.surface400, foreground, dark ? 0.16 : 0.08);
  const borderStrong = mixHex(surfaces.surface400, foreground, dark ? 0.28 : 0.15);
  const hover = `color-mix(in srgb, ${accessibleAccent} ${dark ? 8 : 5.1}%, transparent)`;

  const values: Partial<Record<(typeof DYNAMIC_COLOR_VARIABLES)[number], string>> = {
    '--color-page': surfaces.surface400,
    '--color-page-gutter': surfaces.surface400,
    '--color-sidebar': surfaces.surface300,
    '--color-panel': surfaces.surface300,
    '--color-chat': surfaces.surface200,
    '--color-surface': surfaces.surface100,
    '--color-elevated': surfaces.surface300,
    '--color-overlay': surfaces.surface100,
    '--color-active': surfaces.surface100,
    '--color-hover': hover,
    '--color-recent': surfaces.surface300,
    '--color-stage-tabs': surfaces.surface300,
    '--color-control': surfaces.surface100,
    '--color-control-hover': hover,
    '--color-selection': surfaces.surface100,
    '--color-border': border,
    '--color-border-strong': borderStrong,
    '--color-text': foreground,
    '--color-text-secondary': `color-mix(in srgb, ${foreground} 75%, transparent)`,
    '--color-text-faint': `color-mix(in srgb, ${foreground} 44%, transparent)`,
    '--color-icon': accessibleAccent,
    '--color-accent': accessibleAccent,
    '--color-accent-soft': `color-mix(in srgb, ${accessibleAccent} 12%, transparent)`,
    '--color-accent-fg': accentForeground,
    '--color-settings-action': accessibleAccent,
    '--color-settings-action-fg': accentForeground,
    '--color-selection-border': accessibleAccent,
    '--color-focus-ring': accessibleAccent,
    '--color-info': accessibleAccent,
    '--color-success': accessibleAccent,
  };
  for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
}

function setDynamicColors(
  root: HTMLElement,
  background: string,
  accent: string,
  dark: boolean,
): void {
  const [backgroundHue, backgroundSaturation] = hexToHsl(background);
  const [accentHue, accentSaturation, accentLightness] = hexToHsl(accent);
  const base = dark
    ? hslToHex(backgroundHue, Math.min(24, backgroundSaturation * 0.55), 11.5)
    : background;
  const themedAccent =
    dark && accentLightness < 35
      ? hslToHex(accentHue, Math.min(82, Math.max(28, accentSaturation)), 48)
      : accent;
  const page = dark ? base : mixHex(base, '#ffffff', 0.08);
  const panel = dark ? mixHex(base, '#ffffff', 0.035) : mixHex(base, '#ffffff', 0.5);
  const chat = dark ? mixHex(base, '#000000', 0.08) : mixHex(base, '#ffffff', 0.68);
  const surface = dark ? mixHex(base, '#ffffff', 0.02) : mixHex(base, '#ffffff', 0.82);
  const overlay = dark ? mixHex(base, '#ffffff', 0.06) : '#ffffff';
  const recent = dark ? mixHex(base, '#ffffff', 0.025) : mixHex(base, '#ffffff', 0.42);
  const values: Partial<Record<(typeof DYNAMIC_COLOR_VARIABLES)[number], string>> = {
    '--color-page': page,
    '--color-sidebar': panel,
    '--color-panel': panel,
    '--color-chat': chat,
    '--color-surface': surface,
    '--color-elevated': panel,
    '--color-overlay': overlay,
    '--color-active': overlay,
    '--color-hover': mixHex(panel, '#ffffff', dark ? 0.04 : 0.36),
    '--color-recent': recent,
    '--color-accent': themedAccent,
    '--color-settings-action': themedAccent,
    '--color-selection-border': themedAccent,
    '--color-focus-ring': themedAccent,
    '--color-info': themedAccent,
  };
  for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
}

function selectedPalette(
  preferences: AppearancePreferences,
  dark: boolean,
): { background: string; accent: string } {
  if (preferences.colorTheme === 'custom') {
    const [hue, saturation, lightness] = hexToHsl(preferences.customPrimary);
    const accent = hslToHex(
      hue,
      Math.min(100, saturation * (preferences.customPurity / 79)),
      lightness,
    );
    const contrast = preferences.customContrast / 100;
    return {
      background: dark
        ? mixHex(accent, '#000000', 0.66 + contrast * 0.18)
        : mixHex(accent, '#ffffff', 0.82 + contrast * 0.12),
      accent,
    };
  }
  if (preferences.colorTheme === 'random') {
    return {
      background: dark
        ? mixHex(preferences.randomBackground, '#000000', 0.78)
        : preferences.randomBackground,
      accent: preferences.randomAccent,
    };
  }
  const option =
    COLOR_THEME_OPTIONS.find((item) => item.id === preferences.colorTheme) ??
    COLOR_THEME_OPTIONS[1]!;
  const palette = dark ? option.dark : option.light;
  return {
    background: resolvePreferenceColor(palette.background, dark ? '#000000' : '#ffffff'),
    accent: resolvePreferenceColor(palette.accent),
  };
}

export function isDarkTheme(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyAppearancePreferences(preferences: AppearancePreferences): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = isDarkTheme(preferences.mode);
  root.classList.toggle('dark', dark);
  root.dataset.colorTheme = preferences.colorTheme;
  root.dataset.imageThemeEffect = preferences.imageEffect;
  root.style.setProperty('--shell-chat-font-size', `${preferences.chatFontSize}px`);
  root.style.setProperty(
    '--shell-chat-font-family',
    preferences.useSerifFont ? 'var(--font-serif)' : 'var(--font-sans)',
  );
  clearImageThemePresentation(root);

  clearDynamicColors(root);
  if (preferences.colorTheme !== 'default') {
    const palette = selectedPalette(preferences, dark);
    setDynamicColors(root, palette.background, palette.accent, dark);
  }

  const preset = IMAGE_THEME_OPTIONS.find((item) => item.id === preferences.imageThemeId);
  const imageUrl =
    preferences.imageThemeId === CUSTOM_IMAGE_THEME_ID
      ? preferences.customImageDataUrl
      : preset?.imageUrl;
  if (imageUrl) {
    root.dataset.imageTheme = 'active';
    root.style.setProperty('--shell-wallpaper-image', `url("${imageUrl.replaceAll('"', '\\"')}")`);
    root.style.setProperty(
      '--shell-wallpaper-position',
      preferences.imageThemeId === CUSTOM_IMAGE_THEME_ID
        ? `${preferences.customImageFocalPoint.x}% ${preferences.customImageFocalPoint.y}%`
        : 'center',
    );
    const imageBackground = preset
      ? resolvePreferenceColor(preset.background, dark ? '#000000' : '#ffffff')
      : preferences.customImageBackground;
    const imageVariant = preferences.imageThemeVariants[preferences.imageThemeId ?? ''] ?? 'soft';
    const imageAccent = preset
      ? imageThemeVariantAccent(preset.background, preset.accent, imageVariant)
      : imageThemeVariantAccent(
          preferences.customImageBackground,
          preferences.customImageAccent,
          imageVariant,
        );
    setImageDynamicColors(root, imageBackground, imageAccent, imageVariant, dark);
    root.style.setProperty(
      '--shell-wallpaper-overlay',
      preferences.imageEffect === 'overlay'
        ? dark
          ? 'linear-gradient(rgba(0,0,0,0.50), rgba(0,0,0,0.50))'
          : 'linear-gradient(color-mix(in srgb, var(--color-overlay) 40%, transparent), color-mix(in srgb, var(--color-overlay) 40%, transparent))'
        : dark
          ? 'linear-gradient(rgba(0,0,0,0.58), rgba(0,0,0,0.58))'
          : 'linear-gradient(transparent, transparent)',
    );
    root.style.setProperty(
      '--shell-message-reading-blur',
      preferences.imageEffect === 'overlay' ? '0px' : '18px',
    );
    root.style.setProperty(
      '--shell-message-reading-scrim',
      dark
        ? 'transparent'
        : preferences.imageEffect === 'overlay'
          ? 'color-mix(in srgb, var(--color-overlay) 64%, transparent)'
          : 'linear-gradient(to bottom, color-mix(in srgb, var(--color-overlay) 72%, transparent), color-mix(in srgb, var(--color-overlay) 50%, transparent))',
    );
    root.style.setProperty(
      '--shell-chat-composer-surface',
      dark ? 'rgba(18,18,18,0.72)' : 'color-mix(in srgb, var(--color-overlay) 86%, transparent)',
    );
  } else {
    delete root.dataset.imageTheme;
    root.style.removeProperty('--shell-wallpaper-image');
    root.style.removeProperty('--shell-wallpaper-position');
  }

  writeAppearancePreferences(preferences);
  void window.syncThink?.runtime?.setTheme?.(preferences.mode);
  window.dispatchEvent(
    new CustomEvent('shell-preferences-applied', { detail: { preferences, dark } }),
  );
}

export function updateAppearancePreferences(
  update: Partial<AppearancePreferences>,
): AppearancePreferences {
  const next = { ...readAppearancePreferences(), ...update, version: 1 as const };
  writeAppearancePreferences(next);
  applyAppearancePreferences(next);
  return next;
}

export function applyShellTheme(mode: ThemeMode): void {
  updateAppearancePreferences({ mode });
}

export function randomColorPair(): { background: string; accent: string } {
  const hue = Math.floor(Math.random() * 360);
  const accent = hslToHex(hue, 42 + Math.random() * 24, 38 + Math.random() * 14);
  const background = hslToHex(hue, 10 + Math.random() * 10, 95 + Math.random() * 3);
  return { background, accent };
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - chroma / 2;
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  return `#${channelHex((r + m) * 255)}${channelHex((g + m) * 255)}${channelHex((b + m) * 255)}`;
}

export function contrastRatioFromSlider(value: number): number {
  return 3 + (Math.min(100, Math.max(0, value)) / 100) * 7.1;
}

export type ShortcutId =
  | 'quickWindow'
  | 'voiceInput'
  | 'newChat'
  | 'conversationSearch'
  | 'planMode'
  | 'goalMode'
  | 'promptEnhancement'
  | 'workspaceSwitch'
  | 'closeTab'
  | 'saveFile'
  | 'sidebarLeft'
  | 'sidebarRight';

export interface ShortcutPreference {
  accelerator: string;
  enabled: boolean;
}

export type ShortcutPreferences = Record<ShortcutId, ShortcutPreference>;

export const DEFAULT_SHORTCUT_PREFERENCES: ShortcutPreferences = {
  quickWindow: { accelerator: 'Alt+Space', enabled: true },
  voiceInput: { accelerator: 'Alt+Shift+V', enabled: false },
  newChat: { accelerator: 'CommandOrControl+N', enabled: true },
  conversationSearch: { accelerator: 'CommandOrControl+K', enabled: true },
  planMode: { accelerator: 'CommandOrControl+Shift+P', enabled: true },
  goalMode: { accelerator: 'CommandOrControl+Shift+G', enabled: true },
  promptEnhancement: { accelerator: 'Tab', enabled: false },
  workspaceSwitch: { accelerator: 'CommandOrControl+1', enabled: true },
  closeTab: { accelerator: 'CommandOrControl+W', enabled: true },
  saveFile: { accelerator: 'CommandOrControl+S', enabled: true },
  sidebarLeft: { accelerator: 'CommandOrControl+Left', enabled: true },
  sidebarRight: { accelerator: 'CommandOrControl+Right', enabled: true },
};

export function readShortcutPreferences(storage?: Storage): ShortcutPreferences {
  const target = storageOrDefault(storage);
  let raw: unknown;
  try {
    raw = JSON.parse(target?.getItem(SHORTCUT_PREFERENCE_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const record =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    (Object.keys(DEFAULT_SHORTCUT_PREFERENCES) as ShortcutId[]).map((id) => {
      const current = record[id];
      const fallback = DEFAULT_SHORTCUT_PREFERENCES[id];
      if (!current || typeof current !== 'object' || Array.isArray(current))
        return [id, { ...fallback }];
      const value = current as Record<string, unknown>;
      return [
        id,
        {
          accelerator:
            typeof value.accelerator === 'string' && value.accelerator.trim()
              ? value.accelerator.trim().slice(0, 80)
              : fallback.accelerator,
          enabled: typeof value.enabled === 'boolean' ? value.enabled : fallback.enabled,
        },
      ];
    }),
  ) as ShortcutPreferences;
}

export function writeShortcutPreferences(
  preferences: ShortcutPreferences,
  storage?: Storage,
): void {
  try {
    storageOrDefault(storage)?.setItem(SHORTCUT_PREFERENCE_KEY, JSON.stringify(preferences));
  } catch {
    // UI preferences remain best-effort when browser storage is unavailable.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('shell-shortcuts-changed', { detail: preferences }));
  }
}

export function updateShortcutPreference(
  id: ShortcutId,
  update: Partial<ShortcutPreference>,
): ShortcutPreferences {
  const current = readShortcutPreferences();
  const next = { ...current, [id]: { ...current[id], ...update } };
  writeShortcutPreferences(next);
  return next;
}

function normalizedKey(value: string): string {
  const key = value.toLowerCase();
  if (key === 'arrowleft') return 'left';
  if (key === 'arrowright') return 'right';
  if (key === ' ') return 'space';
  return key;
}

export function matchesShortcut(event: KeyboardEvent, accelerator: string): boolean {
  const parts = accelerator.toLowerCase().split('+').filter(Boolean);
  const key = parts.at(-1);
  const primary = parts.includes('commandorcontrol');
  const wantsControl = primary || parts.includes('control') || parts.includes('ctrl');
  const wantsMeta = parts.includes('command') || parts.includes('super');
  if (
    primary
      ? !(event.ctrlKey || event.metaKey)
      : event.ctrlKey !== wantsControl || event.metaKey !== wantsMeta
  )
    return false;
  if (event.altKey !== parts.includes('alt')) return false;
  if (event.shiftKey !== parts.includes('shift')) return false;
  return normalizedKey(event.key) === normalizedKey(key ?? '');
}

export function acceleratorFromKeyboardEvent(
  event: KeyboardEvent,
  allowSingleKey = false,
): string | null {
  const modifierOnly = ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key);
  if (modifierOnly) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (parts.length === 0 && !allowSingleKey) return null;
  const mapped =
    event.key === ' '
      ? 'Space'
      : event.key.startsWith('Arrow')
        ? event.key.slice(5)
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key;
  if (!mapped || mapped === 'Dead' || mapped === 'Unidentified') return null;
  return [...parts, mapped].join('+');
}

export function formatShortcut(accelerator: string): string {
  return accelerator
    .replace('CommandOrControl', navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl')
    .replace('Command', '⌘')
    .replace('Control', 'Ctrl')
    .replace('Left', '←')
    .replace('Right', '→')
    .replaceAll('+', '+');
}
