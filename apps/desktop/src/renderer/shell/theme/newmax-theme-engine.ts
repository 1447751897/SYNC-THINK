// @ts-nocheck
/* Vendored from NewMax globals-tZIWgBuA.js theme engine. Do not invent formulas. */
export type ThemeMood = keyof typeof MOOD_SPECS;
export type ImageThemeVariant = 'mono' | 'neutral' | 'soft' | 'rich';
export type ThemeVarMap = Record<string, string>;

export interface ImageThemePalette {
  background: string;
  foreground: string;
  accent: string;
  accents?: { neutral: string; soft: string; rich: string };
  luminance: number;
  mood: ThemeMood | string;
}

export interface CustomPalette {
  chroma: number;
  lightSurfaceChroma: number;
}

export interface CustomPrimaryAdaptation {
  enabled: boolean;
  referenceMode: 'light' | 'dark';
}

export interface ThemeGenerationOptions {
  surfaceHueSource?: 'background' | string;
  surfaceChromaSource?: 'background' | string;
  brightLightSurfaces?: boolean;
  enforceAccessibleInteractiveColors?: boolean;
  preserveInteractiveColorChroma?: boolean;
  interactiveChromaFloor?: number;
  surfaceChromaScale?: number;
  tertiaryTextAlphaGap?: { light?: number; dark?: number };
  tertiaryTextMaxAlpha?: { light?: number; dark?: number };
}

function oklchToRgb(L2, C2, H2) {
  const hRad = H2 * Math.PI / 180;
  const a = C2 * Math.cos(hRad);
  const b = C2 * Math.sin(hRad);
  const l_ = L2 + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L2 - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L2 - 0.0894841775 * a - 1.291485548 * b;
  const l2 = l_ * l_ * l_, m2 = m_ * m_ * m_, s = s_ * s_ * s_;
  const gamma = (v2) => v2 <= 31308e-7 ? 12.92 * v2 : 1.055 * Math.pow(Math.max(0, v2), 1 / 2.4) - 0.055;
  const cl2 = (v2) => Math.round(Math.max(0, Math.min(1, v2)) * 255);
  return [
    cl2(gamma(4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s)),
    cl2(gamma(-1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s)),
    cl2(gamma(-0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s))
  ];
}
function hexToOklch(c) {
  const r2 = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;
  const lin = (v2) => v2 <= 0.04045 ? v2 / 12.92 : Math.pow((v2 + 0.055) / 1.055, 2.4);
  const rl2 = lin(r2), gl2 = lin(g), bl2 = lin(b);
  const l2 = 0.4122214708 * rl2 + 0.5363325363 * gl2 + 0.0514459929 * bl2;
  const m2 = 0.2119034982 * rl2 + 0.6806995451 * gl2 + 0.1073969566 * bl2;
  const s = 0.0883024619 * rl2 + 0.2817188376 * gl2 + 0.6299787005 * bl2;
  const l_ = Math.cbrt(l2), m_ = Math.cbrt(m2), s_ = Math.cbrt(s);
  const L2 = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bk2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return [L2, Math.sqrt(a * a + bk2 * bk2), (Math.atan2(bk2, a) * 180 / Math.PI + 360) % 360];
}
function toHex(r2, g, b) {
  return "#" + [r2, g, b].map((v2) => v2.toString(16).padStart(2, "0")).join("");
}
function hex(L2, C2, H2) {
  return toHex(...oklchToRgb(L2, C2, H2));
}
const oklchToHex = hex;
function rgbStr(L2, C2, H2) {
  return oklchToRgb(L2, C2, H2).join(",");
}
function hexRgbStr(value) {
  return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16)).join(",");
}
function mixHexChannels(a, b, amount) {
  const t2 = Math.max(0, Math.min(1, amount));
  const channels = [1, 3, 5].map((start) => {
    const from = parseInt(a.slice(start, start + 2), 16);
    const to = parseInt(b.slice(start, start + 2), 16);
    return Math.round(from + (to - from) * t2);
  });
  return toHex(channels[0], channels[1], channels[2]);
}
function lightenForContrast(color, background, target) {
  if (contrastRatioFromHex(color, background) >= target) return color;
  for (let step = 1; step <= 100; step++) {
    const candidate = mixHexChannels(color, "#ffffff", step / 100);
    if (contrastRatioFromHex(candidate, background) >= target) return candidate;
  }
  return "#ffffff";
}
function ensureMinimumOklchChroma(color, minimumChroma) {
  const [lightness, chroma, hue] = hexToOklch(color);
  return chroma >= minimumChroma ? color : hex(lightness, minimumChroma, hue);
}
function ensureOklchContrast(preferred, fallback, surfaces, targetContrast, direction, minimumChroma = 0) {
  const meetsTarget = (color) => surfaces.every((surface) => contrastRatioFromHex(color, surface) >= targetContrast);
  if (meetsTarget(preferred)) return preferred;
  const [sourceLightness, sourceChroma, hue] = hexToOklch(preferred);
  const chroma = Math.max(sourceChroma, minimumChroma);
  for (let step = 1; step <= 100; step += 1) {
    const progress = step / 100;
    const lightness = direction === "lighter" ? sourceLightness + (1 - sourceLightness) * progress : sourceLightness * (1 - progress);
    const candidate = hex(lightness, chroma, hue);
    if (meetsTarget(candidate)) return candidate;
  }
  return fallback;
}
function tw(h) {
  const r2 = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  const mx = Math.max(r2, g, b), mn = Math.min(r2, g, b);
  let hue = 0, sat = 0;
  const lit = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    sat = lit > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r2) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) hue = ((b - r2) / d + 2) / 6;
    else hue = ((r2 - g) / d + 4) / 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(lit * 100)}%`;
}
function relativeLuminanceFromHex(c) {
  const r2 = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;
  const lin = (v2) => v2 <= 0.04045 ? v2 / 12.92 : Math.pow((v2 + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r2) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatioFromHex(a, b) {
  const la2 = relativeLuminanceFromHex(a), lb2 = relativeLuminanceFromHex(b);
  return (Math.max(la2, lb2) + 0.05) / (Math.min(la2, lb2) + 0.05);
}
function compositeHex(foreground, background, alpha) {
  const channels = [1, 3, 5].map((start) => {
    const foregroundChannel = parseInt(foreground.slice(start, start + 2), 16);
    const backgroundChannel = parseInt(background.slice(start, start + 2), 16);
    return Math.round(foregroundChannel * alpha + backgroundChannel * (1 - alpha));
  });
  return toHex(channels[0], channels[1], channels[2]);
}
function ensureTextAlphaContrast(foreground, surfaces, preferredAlpha, targetContrast) {
  const minimumAlpha = Math.max(0, Math.min(1, preferredAlpha));
  const meetsTarget = (alpha) => surfaces.every((surface) => contrastRatioFromHex(compositeHex(foreground, surface, alpha), surface) >= targetContrast);
  if (meetsTarget(minimumAlpha)) return minimumAlpha;
  if (!meetsTarget(1)) return 1;
  let lower = minimumAlpha;
  let upper = 1;
  for (let step = 0; step < 12; step += 1) {
    const candidate = (lower + upper) / 2;
    if (meetsTarget(candidate)) upper = candidate;
    else lower = candidate;
  }
  let resolved = Math.min(1, Math.ceil(upper * 1e3) / 1e3);
  while (resolved < 1 && !meetsTarget(resolved)) resolved = Math.min(1, resolved + 1e-3);
  return Number(resolved.toFixed(3));
}
function limitTertiaryTextAlpha(contrastAdjustedAlpha, secondaryAlpha, minimumGap = 0, maximumAlpha = 1) {
  const hierarchyCap = Math.max(0, secondaryAlpha - minimumGap);
  const visualCap = Math.max(0, Math.min(1, maximumAlpha));
  return Number(Math.min(contrastAdjustedAlpha, hierarchyCap, visualCap).toFixed(3));
}
function ensureSolidTextContrast(preferred, fallback, surfaces, targetContrast) {
  const meetsTarget = (color) => surfaces.every((surface) => contrastRatioFromHex(color, surface) >= targetContrast);
  if (meetsTarget(preferred)) return preferred;
  if (!meetsTarget(fallback)) return fallback;
  let lower = 0;
  let upper = 1;
  for (let step = 0; step < 12; step += 1) {
    const amount = (lower + upper) / 2;
    if (meetsTarget(mixHexChannels(preferred, fallback, amount))) upper = amount;
    else lower = amount;
  }
  return mixHexChannels(preferred, fallback, upper);
}
function accessibleOnColorText(background) {
  const black = "#000000";
  const white = "#ffffff";
  const foreground = contrastRatioFromHex(background, black) >= contrastRatioFromHex(background, white) ? black : white;
  const alpha = ensureTextAlphaContrast(foreground, [background], 0.9, 4.5);
  return `rgba(${hexRgbStr(foreground)},${alpha})`;
}
const CUSTOM_LIGHT_BACKGROUND_BASE_L = 0.92;
const CUSTOM_DARK_LOW_CONTRAST_L = 0.33;
const CUSTOM_DARK_MAX_CONTRAST_L = 0.18;
const CUSTOM_DARK_CONTRAST_LINEAR_WEIGHT = 0.4;
const CUSTOM_DARK_CONTRAST_EXPONENT = 25;
const CUSTOM_LIGHT_SURFACE_CHROMA_SCALE = 0.8;
const CUSTOM_DARK_SURFACE_CHROMA_SCALE = 0.4;
function customPurityCurve(purityLevel) {
  const purity = Math.max(0, Math.min(100, purityLevel)) / 100;
  return purity === 0 ? 0 : 1 - Math.pow(1 - purity, 2.2);
}
function customContrastCurve(contrastLevel) {
  const contrast2 = Math.max(0, Math.min(100, contrastLevel)) / 100;
  return contrast2 * contrast2;
}
const MOOD_SPECS = {
  crisp: {
    weight: 25,
    bgL: [0.96, 0.99],
    bgC: [5e-3, 0.025],
    fgL: [0.22, 0.4],
    fgC: [0.1, 0.26],
    dark: { bgL: 0.27, chromaScale: 0.6, brandChromaScale: 0.75 }
  },
  pastel: {
    weight: 20,
    bgL: [0.95, 0.98],
    bgC: [0.015, 0.04],
    fgL: [0.32, 0.5],
    fgC: [0.06, 0.14],
    dark: { bgL: 0.29, chromaScale: 0.7, brandChromaScale: 0.8 }
  },
  bold: {
    weight: 20,
    bgL: [0.95, 0.985],
    bgC: [5e-3, 0.02],
    fgL: [0.18, 0.32],
    fgC: [0.16, 0.3],
    dark: { bgL: 0.28, chromaScale: 1, brandChromaScale: 0.85 }
  },
  minimal: {
    weight: 20,
    bgL: [0.96, 0.99],
    bgC: [2e-3, 0.012],
    fgL: [0.25, 0.45],
    fgC: [0.04, 0.1],
    dark: { bgL: 0.25, chromaScale: 0.3, brandChromaScale: 0.6 }
  },
  cream: {
    weight: 15,
    bgL: [0.93, 0.97],
    bgC: [0.018, 0.045],
    fgL: [0.2, 0.42],
    fgC: [0.08, 0.22],
    bgHue: () => 20 + Math.random() * 50,
    dark: { bgL: 0.27, chromaScale: 1.1, brandChromaScale: 0.8 }
  },
  // Bright neutral — macOS-like light panels: nearly pure gray surfaces with
  // a saturated accent. This keeps random themes from always feeling tinted.
  bright: {
    weight: 16,
    bgL: [0.985, 0.997],
    bgC: [0, 2e-3],
    fgL: [0.24, 0.4],
    fgC: [0.12, 0.28],
    dark: { bgL: 0.27, chromaScale: 0.15, brandChromaScale: 0.8 },
    light: {
      neutralSurfaces: true,
      surfaceOffsets: {
        surface300: 0.015,
        surface400: 0.03,
        secondary: 0.01,
        muted: 0.01,
        border: 0.07,
        bubble: 0.01
      }
    }
  },
  // Achromatic — both anchors near zero chroma. Hue is still picked but
  // collapses visually to neutral gray; result is a true black-and-white
  // theme. Useful when the user wants a noise-free, monochrome workspace.
  noir: {
    weight: 12,
    bgL: [0.96, 0.99],
    bgC: [0, 3e-3],
    fgL: [0.15, 0.35],
    fgC: [0, 5e-3],
    dark: { bgL: 0.27, chromaScale: 0.15, brandChromaScale: 0.3 }
  },
  // High chroma jewel-tone palette. fgC pushes past bold's 0.30 ceiling so
  // some hues will hit sRGB gamut and clip slightly — that's the intended
  // saturated look. Contrast filter still rejects unreadable picks.
  vivid: {
    weight: 12,
    bgL: [0.95, 0.985],
    bgC: [8e-3, 0.025],
    fgL: [0.18, 0.34],
    fgC: [0.2, 0.34],
    dark: { bgL: 0.27, chromaScale: 1.2, brandChromaScale: 1 }
  }
};
const MOOD_NAMES = Object.keys(MOOD_SPECS);
function generateRandomTheme(bg2, fg2, mood = "crisp", accent, customPalette, customPrimaryAdaptation, generationOptions) {
  const [bgL, surfC, surfH] = hexToOklch(bg2);
  const [fgL, fgC, fgH] = hexToOklch(fg2);
  const [, accentC, accentH] = hexToOklch(accent ?? fg2);
  const isCustomTheme = accent !== void 0;
  const moodSpec = isCustomTheme ? MOOD_SPECS.crisp : MOOD_SPECS[mood] ?? MOOD_SPECS.crisp;
  const customChroma = isCustomTheme ? generationOptions?.surfaceChromaSource === "background" ? surfC : customPalette?.chroma ?? fgC : fgC;
  const lightSurfaceC = isCustomTheme ? customPalette?.lightSurfaceChroma ?? surfC : surfC;
  const neutralCustomPalette = isCustomTheme && customChroma < 1e-3;
  const surfaceChromaScale = generationOptions?.surfaceChromaScale ?? 1;
  const textChromaScale = Math.min(1, surfaceChromaScale);
  const achromaticSurfaces = surfaceChromaScale < 1e-3;
  const paletteSurfaceH = isCustomTheme && generationOptions?.surfaceHueSource !== "background" ? accentH : surfH;
  const neutralLightSurfaces = (moodSpec.light?.neutralSurfaces ?? false) || neutralCustomPalette || lightSurfaceC < 1e-3 || achromaticSurfaces;
  const shadowContrastStrength = accent ? Math.round(Math.max(0, Math.min(0.46, (contrastRatioFromHex(bg2, fg2) - 4.5) / 16.5)) * 100) / 100 : 0;
  const shadowAlpha = (base, gain) => Number((base + gain * shadowContrastStrength).toFixed(3));
  const surfaceOverlayAlpha = accent ? shadowAlpha(0.05, 0.01) : shadowAlpha(0.06, 0.02);
  const activeSurfaceOverlayAlpha = accent ? shadowAlpha(0.075, 0.02) : shadowAlpha(0.08, 0.04);
  const darkSurfaceOverlayAlpha = accent ? shadowAlpha(0.08, 0.015) : shadowAlpha(0.1, 0.02);
  const darkActiveSurfaceOverlayAlpha = accent ? 0.16 : 0.18;
  const preferredLightSecondaryTextAlpha = accent ? shadowAlpha(0.56, 0.35) : 0.56;
  const preferredLightTertiaryTextAlpha = accent ? shadowAlpha(0.3, 0.26) : 0.3;
  const preferredDarkSecondaryTextAlpha = accent ? shadowAlpha(0.48, 0.3) : 0.48;
  const preferredDarkTertiaryTextAlpha = accent ? shadowAlpha(0.32, 0.22) : 0.32;
  const lightSurfaceOffsets = moodSpec.light?.surfaceOffsets ?? {
    surface300: 0.025,
    surface400: 0.05,
    secondary: 0.01,
    muted: 0.015,
    border: 0.09,
    bubble: 0.07
  };
  const interactiveChromaFloor = generationOptions?.interactiveChromaFloor ?? 0;
  let lBrand = accent && interactiveChromaFloor > 0 ? ensureMinimumOklchChroma(accent, interactiveChromaFloor) : accent ?? fg2;
  let lIcon = accent && interactiveChromaFloor > 0 ? ensureMinimumOklchChroma(accent, interactiveChromaFloor) : accent ?? (neutralLightSurfaces ? hex(0.52, 0, 0) : hex(0.48, Math.min(fgC, 0.08), fgH));
  const lightTextC = neutralLightSurfaces ? 0 : fgC * 0.25;
  const lightTextH = neutralLightSurfaces ? 0 : isCustomTheme ? accentH : fgH;
  const lText = accent ? fg2 : hex(Math.min(fgL, 0.28), lightTextC, lightTextH);
  const lTextRgb = accent ? [fg2.slice(1, 3), fg2.slice(3, 5), fg2.slice(5, 7)].map((channel) => parseInt(channel, 16)).join(",") : oklchToRgb(Math.min(fgL, 0.28), lightTextC, lightTextH).join(",");
  const brightLightSurfaces = generationOptions?.brightLightSurfaces ?? false;
  const surfBaseL = brightLightSurfaces ? 0.985 : Math.max(0.83, Math.min(0.995, bgL));
  const sc2 = (neutralLightSurfaces ? 0 : isCustomTheme ? lightSurfaceC : Math.max(lightSurfaceC, 5e-3)) * surfaceChromaScale;
  const lightSurfaceH = neutralLightSurfaces ? 0 : paletteSurfaceH;
  const lSurf100 = brightLightSurfaces ? "#ffffff" : accent ? surfBaseL >= 0.995 ? "#ffffff" : hex(Math.min(0.995, surfBaseL + 0.025), sc2 * 0.6, lightSurfaceH) : "#ffffff";
  const lSurf200 = brightLightSurfaces ? hex(surfBaseL, sc2 * 0.08, lightSurfaceH) : neutralLightSurfaces ? bg2 : hex(surfBaseL, sc2, lightSurfaceH);
  const lSurf300 = hex(
    surfBaseL - lightSurfaceOffsets.surface300 - shadowContrastStrength * 0.02,
    sc2 * (brightLightSurfaces ? 0.32 : 1.3),
    lightSurfaceH
  );
  const lSurf400 = hex(
    surfBaseL - lightSurfaceOffsets.surface400 - shadowContrastStrength * 0.03,
    sc2 * (brightLightSurfaces ? 0.58 : 1.55),
    lightSurfaceH
  );
  const lSecondary = hex(
    surfBaseL - lightSurfaceOffsets.secondary - shadowContrastStrength * 0.01,
    sc2 * (brightLightSurfaces ? 0.16 : 0.8),
    lightSurfaceH
  );
  const lMuted = hex(
    surfBaseL - lightSurfaceOffsets.muted - shadowContrastStrength * 0.015,
    sc2 * (brightLightSurfaces ? 0.12 : 0.6),
    lightSurfaceH
  );
  const preferredLightMutedFg = hex(0.5, neutralLightSurfaces ? 0 : 0.03 * textChromaScale, lightTextH);
  const lBorder = hex(
    surfBaseL - lightSurfaceOffsets.border - shadowContrastStrength * 0.03,
    sc2 * (brightLightSurfaces ? 0.75 : 1.6),
    lightSurfaceH
  );
  const lBubble = hex(
    surfBaseL - lightSurfaceOffsets.bubble - shadowContrastStrength * 0.02,
    sc2 * (brightLightSurfaces ? 0.65 : 1.3),
    lightSurfaceH
  );
  const lightTextSurfaces = [lSurf100, lSurf200, lSurf300, lSurf400, lSecondary, lMuted, lBubble];
  const lightSecondaryTextAlpha = ensureTextAlphaContrast(
    lText,
    lightTextSurfaces,
    preferredLightSecondaryTextAlpha,
    5.5
  );
  const contrastAdjustedLightTertiaryTextAlpha = ensureTextAlphaContrast(
    lText,
    lightTextSurfaces,
    preferredLightTertiaryTextAlpha,
    4.5
  );
  const lightTertiaryTextAlpha = limitTertiaryTextAlpha(
    contrastAdjustedLightTertiaryTextAlpha,
    lightSecondaryTextAlpha,
    generationOptions?.tertiaryTextAlphaGap?.light,
    generationOptions?.tertiaryTextMaxAlpha?.light
  );
  const lMutedFg = ensureSolidTextContrast(
    preferredLightMutedFg,
    lText,
    lightTextSurfaces,
    4.7
  );
  if (generationOptions?.enforceAccessibleInteractiveColors) {
    if (generationOptions.preserveInteractiveColorChroma) {
      lBrand = ensureOklchContrast(
        lBrand,
        lText,
        lightTextSurfaces,
        3,
        "darker",
        interactiveChromaFloor
      );
      lIcon = ensureOklchContrast(
        lIcon,
        lText,
        lightTextSurfaces,
        3,
        "darker",
        interactiveChromaFloor
      );
    } else {
      lBrand = ensureSolidTextContrast(lBrand, lText, lightTextSurfaces, 3);
      lIcon = ensureSolidTextContrast(lIcon, lText, lightTextSurfaces, 3);
    }
  }
  const lAccent = lBrand;
  const lBrandText = accessibleOnColorText(lBrand);
  const lAccentText = lBrandText;
  const lBrandRgb = hexRgbStr(lBrand);
  const light = {
    "--ds-text-primary": lText,
    "--ds-text-secondary": `rgba(${lTextRgb},${lightSecondaryTextAlpha})`,
    "--ds-text-tertiary": `rgba(${lTextRgb},${lightTertiaryTextAlpha})`,
    "--ds-brand-primary": lBrand,
    "--ds-brand-primary-text": lBrandText,
    "--ds-selection-bg": lBrand + "d9",
    "--ds-glow-rgb": lBrandRgb,
    "--ds-accent": lAccent,
    "--ds-accent-text": lAccentText,
    "--ds-icon": lIcon,
    "--ds-surface-100": lSurf100,
    "--ds-surface-200": lSurf200,
    "--ds-surface-300": lSurf300,
    "--ds-surface-400": lSurf400,
    "--ds-on-surface": neutralLightSurfaces ? `rgba(0,0,0,${surfaceOverlayAlpha})` : `rgba(${lBrandRgb},${surfaceOverlayAlpha})`,
    "--ds-on-surface-active": neutralLightSurfaces ? `rgba(0,0,0,${activeSurfaceOverlayAlpha})` : `rgba(${lBrandRgb},${activeSurfaceOverlayAlpha})`,
    "--ds-overlay": "rgba(0,0,0,0.3)",
    "--ds-pill-bg": `color-mix(in srgb, ${lBrand} 12%, transparent)`,
    "--ds-divider": `color-mix(in srgb, ${lText} 6%, transparent)`,
    "--ds-elevation-100": `inset 0.5px 0.5px 0.5px #FFFFFF, 0px 0px 0.5px 0.5px rgba(0,0,0,${shadowAlpha(0.04, 0.06)}), 0.5px 0.5px 1px rgba(0,0,0,${shadowAlpha(0.08, 0.1)})`,
    "--ds-elevation-100-filter": `drop-shadow(0.5px 0.5px 0.5px rgba(0,0,0,${shadowAlpha(0.08, 0.1)}))`,
    "--ds-workspace-tab-outline": `rgba(0,0,0,${shadowAlpha(0.04, 0.06)})`,
    "--ds-workspace-tab-highlight": "rgba(255,255,255,0.85)",
    "--ds-elevation-200": `0px 0px 0px 0.5px rgba(0,0,0,${shadowAlpha(0.08, 0.1)}), 0px 9px 4px rgba(0,0,0,${shadowAlpha(0.01, 0.02)}), 0px 5px 3px rgba(0,0,0,${shadowAlpha(0.02, 0.03)}), 0px 2px 2px rgba(0,0,0,${shadowAlpha(0.03, 0.04)}), 0px 1px 1px rgba(0,0,0,${shadowAlpha(0.04, 0.06)}), inset 0.5px 0.5px 0.5px rgba(255,255,255,0.85)`,
    "--ds-elevation-300": "inset 0 0 0.5px 0.5px rgba(255,255,255,0.8), 0 0 0 0.5px rgba(0,0,0,0.04), 0px 3px 6px 0px rgba(0,0,0,0.04), 0px 11px 11px 0px rgba(0,0,0,0.03), 0px 24px 15px 0px rgba(0,0,0,0.02), 0px 43px 17px 0px rgba(0,0,0,0.01), 0px 68px 19px 0px rgba(0,0,0,0)",
    "--ds-input-shadow": `0px 0px 0.5px 0.5px rgba(0,0,0,${shadowAlpha(0.04, 0.06)}), 0.5px 0.5px 1px 0px rgba(0,0,0,${shadowAlpha(0.08, 0.1)})`,
    "--ds-input-shadow-inset": "inset 0.5px 0.5px 0.5px 0px white",
    "--ds-input-shadow-hover": `0px 0px 0.5px 0.5px rgba(0,0,0,${shadowAlpha(0.04, 0.06)}), 0 0 0 0.5px color-mix(in srgb, ${lBrand} 24%, transparent), 0.5px 0.5px 1px 0px rgba(0,0,0,${shadowAlpha(0.08, 0.1)})`,
    "--ds-input-shadow-focus": `0px 0px 0.5px 0.5px rgba(0,0,0,${shadowAlpha(0.04, 0.06)}), 0 0 0 3px color-mix(in srgb, ${lBrand} 10%, transparent), 0.5px 0.5px 1px 0px rgba(0,0,0,${shadowAlpha(0.08, 0.1)})`,
    "--ds-menu-bg": "color-mix(in oklch, var(--ds-popover) 96%, white)",
    "--ds-menu-shadow": "0 0 0 0.5px rgba(0,0,0,0.12), 2px 1px 5px 0 rgba(50,48,48,0.06), 8px 6px 10px 0 rgba(50,48,48,0.05), 18px 13px 13px 0 rgba(50,48,48,0.03), 31px 24px 16px 0 rgba(50,48,48,0.01), 49px 37px 17px 0 rgba(50,48,48,0)",
    "--ds-menu-shadow-plate": "none",
    "--ds-menu-shadow-inset": "inset 0.5px 0.5px 0px 0px white",
    "--color-icon": lIcon,
    "--background": tw(lSurf200),
    "--foreground": tw(lText),
    "--card": tw(lSurf100),
    "--card-foreground": tw(lText),
    "--popover": tw(lSurf100),
    "--popover-foreground": tw(lText),
    "--primary": tw(lBrand),
    "--primary-foreground": lBrandText.startsWith("rgba(255") ? "0 0% 100%" : "0 0% 0%",
    "--secondary": tw(lSecondary),
    "--secondary-foreground": tw(lText),
    "--muted": tw(lMuted),
    "--muted-foreground": tw(lMutedFg),
    "--accent": tw(lSurf300),
    "--accent-foreground": tw(lBrand),
    "--destructive": "0 72% 51%",
    "--destructive-foreground": "0 0% 100%",
    "--border": tw(lBorder),
    "--input": tw(lBorder),
    "--ring": tw(lBrand),
    "--user-bubble": tw(lBubble),
    "--user-bubble-foreground": tw(lText),
    "--sidebar-bg": tw(lSecondary)
  };
  const { bgL: moodDarkBgL, chromaScale, brandChromaScale } = moodSpec.dark;
  const customLightContrastCurve = Math.max(
    0,
    Math.min(1, (bgL - CUSTOM_LIGHT_BACKGROUND_BASE_L) / (1 - CUSTOM_LIGHT_BACKGROUND_BASE_L))
  );
  const customContrastStrength = Math.sqrt(customLightContrastCurve);
  const customDarkEndpointCurve = Math.pow(customContrastStrength, CUSTOM_DARK_CONTRAST_EXPONENT);
  const customDarkContrastCurve = CUSTOM_DARK_CONTRAST_LINEAR_WEIGHT * customContrastStrength + (1 - CUSTOM_DARK_CONTRAST_LINEAR_WEIGHT) * customDarkEndpointCurve;
  const dBgL = accent ? CUSTOM_DARK_MAX_CONTRAST_L + (CUSTOM_DARK_LOW_CONTRAST_L - CUSTOM_DARK_MAX_CONTRAST_L) * (1 - customDarkContrastCurve) : moodDarkBgL;
  const customBrandReference = accent ? hex(
    CUSTOM_DARK_LOW_CONTRAST_L,
    accentC * CUSTOM_DARK_SURFACE_CHROMA_SCALE * chromaScale,
    accentH
  ) : "";
  const randomBrandL = Math.min(0.85, Math.max(0.65, 1 - fgL + 0.15));
  const randomBrandC = neutralCustomPalette ? 0 : fgC * brandChromaScale;
  let dBrand = accent ? generationOptions?.preserveInteractiveColorChroma ? ensureMinimumOklchChroma(accent, interactiveChromaFloor) : lightenForContrast(accent, customBrandReference, 3) : hex(randomBrandL, randomBrandC, fgH);
  const darkSurfaceH = neutralCustomPalette ? 0 : paletteSurfaceH;
  const darkTextH = neutralCustomPalette ? 0 : isCustomTheme ? accentH : fgH;
  const dsc = (neutralCustomPalette ? 0 : isCustomTheme ? generationOptions?.surfaceChromaSource === "background" ? surfC * chromaScale : customChroma * CUSTOM_DARK_SURFACE_CHROMA_SCALE * chromaScale : Math.max(surfC * chromaScale, 4e-3)) * surfaceChromaScale;
  const dSurf100 = hex(dBgL - (accent ? 0.02 : 0.03), dsc, darkSurfaceH);
  const dSurf200 = hex(dBgL, dsc, darkSurfaceH);
  const dSurf300 = hex(
    dBgL + (accent ? 0.04 : 0.03 + shadowContrastStrength * 0.19),
    dsc * 1.2,
    darkSurfaceH
  );
  const dSurf400 = hex(
    dBgL + 0.07 + (accent ? 0 : shadowContrastStrength * 0.23),
    dsc * 1.45,
    darkSurfaceH
  );
  const dTextL = accent ? 0.94 + shadowContrastStrength * 0.06 : 0.94;
  const dText = hex(dTextL, neutralCustomPalette ? 0 : 6e-3 * textChromaScale, darkTextH);
  const dTextRgb = rgbStr(dTextL, neutralCustomPalette ? 0 : 6e-3 * textChromaScale, darkTextH);
  let dIcon = accent ? dBrand : hex(0.72, neutralCustomPalette ? 0 : Math.min(randomBrandC, 0.1), neutralCustomPalette ? 0 : fgH);
  const preferredDarkMutedFg = hex(0.62, neutralCustomPalette ? 0 : 0.05 * textChromaScale, darkTextH);
  const dBorderHex = hex(dBgL + 0.12 + (accent ? 0 : shadowContrastStrength * 0.23), dsc * 2, darkSurfaceH);
  const dPopover = accent ? dSurf300 : hex(dBgL + 0.1 + shadowContrastStrength * 0.18, dsc * 1.5, darkSurfaceH);
  const dAccentHex = hex(
    dBgL + (accent ? 0.08 : 0.09 + shadowContrastStrength * 0.17),
    dsc * 1.5,
    darkSurfaceH
  );
  const dBubble = hex(
    dBgL + (accent ? 0.07 : 0.08 + shadowContrastStrength * 0.18),
    dsc * 1.5,
    darkSurfaceH
  );
  const dSidebar = hex(dBgL - 0.01, dsc * 0.8, darkSurfaceH);
  const dOverlaySurface = hex(Math.max(0.08, dBgL - 0.1), dsc, darkSurfaceH);
  const dOverlayChannel = Math.round(144 * shadowContrastStrength);
  const dOverlayAlpha = Number((0.6 - shadowContrastStrength * 0.3).toFixed(3));
  const dOverlay = accent ? `rgba(${hexRgbStr(dOverlaySurface)},0.68)` : `rgba(${dOverlayChannel},${dOverlayChannel},${dOverlayChannel},${dOverlayAlpha})`;
  const darkTextSurfaces = [dSurf100, dSurf200, dSurf300, dSurf400, dPopover, dAccentHex, dBubble, dSidebar];
  const darkSecondaryTextAlpha = ensureTextAlphaContrast(
    dText,
    darkTextSurfaces,
    preferredDarkSecondaryTextAlpha,
    5.5
  );
  const contrastAdjustedDarkTertiaryTextAlpha = ensureTextAlphaContrast(
    dText,
    darkTextSurfaces,
    preferredDarkTertiaryTextAlpha,
    4.5
  );
  const darkTertiaryTextAlpha = limitTertiaryTextAlpha(
    contrastAdjustedDarkTertiaryTextAlpha,
    darkSecondaryTextAlpha,
    generationOptions?.tertiaryTextAlphaGap?.dark,
    generationOptions?.tertiaryTextMaxAlpha?.dark
  );
  const dMutedFg = ensureSolidTextContrast(
    preferredDarkMutedFg,
    dText,
    darkTextSurfaces,
    4.7
  );
  if (generationOptions?.enforceAccessibleInteractiveColors) {
    if (generationOptions.preserveInteractiveColorChroma) {
      dBrand = ensureOklchContrast(
        dBrand,
        dText,
        darkTextSurfaces,
        3,
        "lighter",
        interactiveChromaFloor
      );
      dIcon = ensureOklchContrast(
        dIcon,
        dText,
        darkTextSurfaces,
        3,
        "lighter",
        interactiveChromaFloor
      );
    } else {
      dBrand = ensureSolidTextContrast(dBrand, dText, darkTextSurfaces, 3);
      dIcon = ensureSolidTextContrast(dIcon, dText, darkTextSurfaces, 3);
    }
  }
  const dAccent = dBrand;
  const dBrandText = accessibleOnColorText(dBrand);
  const dAccentText = dBrandText;
  const dBrandChannels = [1, 3, 5].map((start) => parseInt(dBrand.slice(start, start + 2), 16));
  const dBrandRgb = dBrandChannels.join(",");
  const dOnSurfaceRgb = achromaticSurfaces ? "255,255,255" : dBrandChannels.map((channel) => Math.round(channel + (255 - channel) * shadowContrastStrength)).join(",");
  const dark = {
    "--ds-text-primary": accent ? dText : `rgba(${dTextRgb},0.9)`,
    "--ds-text-secondary": `rgba(${dTextRgb},${darkSecondaryTextAlpha})`,
    "--ds-text-tertiary": `rgba(${dTextRgb},${darkTertiaryTextAlpha})`,
    "--ds-brand-primary": dBrand,
    "--ds-brand-primary-text": dBrandText,
    "--ds-selection-bg": dBrand + "d9",
    "--ds-glow-rgb": dBrandRgb,
    "--ds-accent": dAccent,
    "--ds-accent-text": dAccentText,
    "--ds-icon": dIcon,
    "--ds-surface-100": dSurf100,
    "--ds-surface-200": dSurf200,
    "--ds-surface-300": dSurf300,
    "--ds-surface-400": dSurf400,
    "--ds-surface-input": dSurf300,
    "--ds-on-surface": `rgba(${dOnSurfaceRgb},${darkSurfaceOverlayAlpha})`,
    "--ds-on-surface-active": `rgba(${dOnSurfaceRgb},${darkActiveSurfaceOverlayAlpha})`,
    "--ds-overlay": dOverlay,
    "--ds-pill-bg": `color-mix(in srgb, ${dBrand} 8%, transparent)`,
    "--ds-divider": `color-mix(in srgb, rgba(${dTextRgb},0.9) 12%, transparent)`,
    "--ds-popover": dSurf300,
    "--ds-elevation-100": `0 0 0 0.5px rgba(255,255,255,${shadowAlpha(0.08, 0.08)})`,
    "--ds-elevation-100-filter": "none",
    "--ds-workspace-tab-outline": `rgba(255,255,255,${shadowAlpha(0.08, 0.08)})`,
    "--ds-workspace-tab-highlight": "transparent",
    "--ds-elevation-200": "inset 0 0 0 0.5px rgba(255,255,255,0.12), 0 0 9px -4px rgba(0,0,0,0.40), 0 0 32px -8px rgba(0,0,0,0.16)",
    "--ds-elevation-300": "inset 0 0 0 0.5px rgba(255,255,255,0.12), 0 2px 12px -6px rgba(0,0,0,0.44), 0 5px 36px -12px rgba(0,0,0,0.20)",
    "--ds-input-shadow": `0 0 0 0.5px rgba(255,255,255,${shadowAlpha(0.08, 0.08)})`,
    "--ds-input-shadow-inset": "none",
    "--ds-input-shadow-hover": "0 0 0 0.5px rgba(255,255,255,0.16)",
    "--ds-input-shadow-focus": `0 0 1px 0.5px color-mix(in srgb, ${dBrand} 56%, transparent), 0 0 0 4px color-mix(in srgb, ${dBrand} 10%, transparent)`,
    "--ds-menu-bg": dSurf400,
    "--ds-menu-shadow": "inset 0 0 0 0.5px rgba(255,255,255,0.12), 0 0 9px -4px rgba(0,0,0,0.50), 0 0 32px -8px rgba(0,0,0,0.20)",
    "--ds-menu-shadow-plate": "none",
    "--ds-menu-shadow-inset": "none",
    "--color-icon": dIcon,
    "--background": tw(dSurf200),
    "--foreground": tw(dText),
    "--card": tw(dSurf400),
    "--card-foreground": tw(dText),
    "--popover": tw(dPopover),
    "--popover-foreground": tw(dText),
    "--primary": tw(dBrand),
    "--primary-foreground": dBrandText.startsWith("rgba(255") ? "0 0% 100%" : "0 0% 0%",
    "--secondary": tw(dSurf400),
    "--secondary-foreground": tw(dText),
    "--muted": tw(dSurf400),
    "--muted-foreground": tw(dMutedFg),
    "--accent": tw(dAccentHex),
    "--accent-foreground": tw(dBrand),
    "--destructive": "0 86% 71%",
    "--destructive-foreground": tw(dSurf100),
    "--border": tw(dBorderHex),
    "--input": tw(dBorderHex),
    "--ring": tw(dBrand),
    "--user-bubble": tw(dBubble),
    "--user-bubble-foreground": tw(dText),
    "--sidebar-bg": tw(dSidebar)
  };
  if (accent && customPrimaryAdaptation) {
    const source = customPrimaryAdaptation.referenceMode === "dark" ? dark : light;
    const target = customPrimaryAdaptation.referenceMode === "dark" ? light : dark;
    const sourceContrast = contrastRatioFromHex(accent, source["--ds-surface-200"]);
    const adapted = customPrimaryAdaptation.enabled ? matchContrastForSurface(accent, target["--ds-surface-200"], sourceContrast) : accent;
    const lightBrand = customPrimaryAdaptation.referenceMode === "light" ? accent : adapted;
    const darkBrand = customPrimaryAdaptation.referenceMode === "dark" ? accent : adapted;
    applyCustomBrandVars(light, lightBrand, false);
    applyCustomBrandVars(dark, darkBrand, true);
  }
  return { light, dark };
}
function matchContrastForSurface(color, background, targetContrast) {
  const [, chroma, hue] = hexToOklch(color);
  const backgroundLuminance = relativeLuminanceFromHex(background);
  const [backgroundLightness] = hexToOklch(background);
  const seekLighterColor = backgroundLuminance < 0.5;
  let lowerLightness = seekLighterColor ? backgroundLightness : 0;
  let upperLightness = seekLighterColor ? 1 : backgroundLightness;
  let closest = hex(seekLighterColor ? upperLightness : lowerLightness, chroma, hue);
  let closestDelta = Number.POSITIVE_INFINITY;
  for (let step = 0; step < 24; step++) {
    const candidateLightness = (lowerLightness + upperLightness) / 2;
    const candidate = hex(candidateLightness, chroma, hue);
    const candidateContrast = contrastRatioFromHex(candidate, background);
    const delta = Math.abs(candidateContrast - targetContrast);
    if (delta < closestDelta) {
      closest = candidate;
      closestDelta = delta;
    }
    if (seekLighterColor) {
      if (candidateContrast < targetContrast) lowerLightness = candidateLightness;
      else upperLightness = candidateLightness;
    } else if (candidateContrast < targetContrast) {
      upperLightness = candidateLightness;
    } else {
      lowerLightness = candidateLightness;
    }
  }
  return closest;
}
function applyCustomBrandVars(vars, brand2, isDark) {
  const previousBrand = vars["--ds-brand-primary"];
  const brandText = contrastRatioFromHex(brand2, "#000000") >= contrastRatioFromHex(brand2, "#ffffff") ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.9)";
  const brandRgb = hexRgbStr(brand2);
  if (previousBrand && previousBrand !== brand2) {
    for (const [key, value] of Object.entries(vars)) {
      vars[key] = value.replaceAll(previousBrand, brand2);
    }
  }
  vars["--ds-brand-primary"] = brand2;
  vars["--ds-brand-primary-text"] = brandText;
  vars["--ds-selection-bg"] = brand2 + "d9";
  vars["--ds-glow-rgb"] = brandRgb;
  vars["--ds-accent"] = brand2;
  vars["--ds-accent-text"] = brandText;
  vars["--ds-icon"] = brand2;
  vars["--ds-pill-bg"] = `color-mix(in srgb, ${brand2} ${isDark ? 8 : 12}%, transparent)`;
  vars["--color-icon"] = brand2;
  vars["--primary"] = tw(brand2);
  vars["--primary-foreground"] = brandText.startsWith("rgba(255") ? "0 0% 100%" : "0 0% 0%";
  vars["--ring"] = tw(brand2);
  vars["--accent-foreground"] = tw(brand2);
}
const HUE_SCHEMES = [
  { name: "mono", weight: 10, delta: () => (Math.random() - 0.5) * 16 },
  { name: "analogous", weight: 30, delta: () => (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 30) },
  { name: "complementary", weight: 15, delta: () => 180 + (Math.random() - 0.5) * 30 },
  { name: "split-comp", weight: 15, delta: () => 180 + (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 20) },
  { name: "triadic", weight: 10, delta: () => (Math.random() < 0.5 ? -1 : 1) * (120 + (Math.random() - 0.5) * 30) },
  { name: "tetradic", weight: 5, delta: () => (Math.random() < 0.5 ? -1 : 1) * (90 + (Math.random() - 0.5) * 30) },
  { name: "free", weight: 15, delta: () => Math.random() * 360 }
];
function weightedPick(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r2 = Math.random() * total;
  for (const item of items) {
    r2 -= item.weight;
    if (r2 <= 0) return item;
  }
  return items[items.length - 1];
}
function pickMood() {
  const entries = MOOD_NAMES.map((name) => ({ name, weight: MOOD_SPECS[name].weight }));
  return weightedPick(entries).name;
}
function randIn(range) {
  return range[0] + Math.random() * (range[1] - range[0]);
}
function randomColorPair() {
  for (let i = 0; i < 300; i++) {
    const moodName = pickMood();
    const moodSpec = MOOD_SPECS[moodName];
    const scheme = weightedPick(HUE_SCHEMES);
    const bgH = moodSpec.bgHue ? moodSpec.bgHue() : Math.random() * 360;
    const bgL = randIn(moodSpec.bgL);
    const bgC = randIn(moodSpec.bgC);
    const bg2 = hex(bgL, bgC, bgH);
    const fgH = ((bgH + scheme.delta()) % 360 + 360) % 360;
    const fgL = randIn(moodSpec.fgL);
    const fgC = randIn(moodSpec.fgC);
    const fg2 = hex(fgL, fgC, fgH);
    if (contrastRatioFromHex(bg2, fg2) >= 4.5) return { bg: bg2, fg: fg2, mood: moodName };
  }
  return { bg: "#f5f5f0", fg: "#2d4739", mood: "crisp" };
}
function getCustomContrastRatio(contrastLevel) {
  const level = Math.max(0, Math.min(100, contrastLevel));
  const strength = level / 100;
  return 4.5 + strength * 7.5;
}
function customColorPair(primary, purityLevel, contrastLevel) {
  const level = Math.max(0, Math.min(100, contrastLevel));
  const contrastCurve = customContrastCurve(level);
  const [, primaryC, primaryH] = hexToOklch(primary);
  const chroma = primaryC * customPurityCurve(purityLevel);
  const mood = "crisp";
  const baseBackgroundL = CUSTOM_LIGHT_BACKGROUND_BASE_L;
  const backgroundL = baseBackgroundL + (1 - baseBackgroundL) * contrastCurve;
  const lightSurfaceChroma = chroma * CUSTOM_LIGHT_SURFACE_CHROMA_SCALE * (1 - contrastCurve * contrastCurve);
  const backgroundC = lightSurfaceChroma;
  const bg2 = hex(backgroundL, backgroundC, primaryH);
  const readabilityBg = hex(
    Math.max(0, backgroundL - 0.08),
    Math.max(backgroundC, 5e-3) * 1.55,
    primaryH
  );
  const targetContrast = getCustomContrastRatio(level);
  const generationTargetContrast = targetContrast + contrastCurve * contrastCurve * 2;
  let primaryL = 0.526;
  let fg2 = hex(primaryL, chroma, primaryH);
  while (contrastRatioFromHex(readabilityBg, fg2) < generationTargetContrast && primaryL > 0) {
    primaryL = Math.max(0, primaryL - 2e-3);
    fg2 = hex(primaryL, chroma, primaryH);
  }
  return {
    bg: bg2,
    fg: fg2,
    accent: primary,
    mood,
    palette: { chroma, lightSurfaceChroma }
  };
}
function getRandomPreviewColors(bg2, fg2, mood = "crisp") {
  const [, surfC, surfH] = hexToOklch(bg2);
  const [fgL, fgC, fgH] = hexToOklch(fg2);
  const dark = MOOD_SPECS[mood]?.dark ?? MOOD_SPECS.crisp.dark;
  const dBrandL = Math.min(0.85, Math.max(0.65, 1 - fgL + 0.15));
  const dsc = Math.max(surfC * dark.chromaScale, 4e-3);
  return {
    light: { bg: bg2, accent: fg2 },
    dark: {
      bg: hex(dark.bgL, dsc, surfH),
      accent: hex(dBrandL, fgC * dark.brandChromaScale, fgH)
    }
  };
}
function applyRandomThemeVars(bg2, fg2, mood, isDark, accent, customPalette, customPrimaryAdaptation, generationOptions) {
  const vars = generateRandomTheme(
    bg2,
    fg2,
    mood,
    accent,
    customPalette,
    customPrimaryAdaptation,
    generationOptions
  );
  const root = document.documentElement;
  const allKeys = /* @__PURE__ */ new Set([...Object.keys(vars.light), ...Object.keys(vars.dark)]);
  for (const key of allKeys) root.style.removeProperty(key);
  root.style.removeProperty("--ds-chat-composer-shadow");
  root.style.removeProperty("--ds-chat-composer-shadow-focus");
  const active = isDark ? vars.dark : vars.light;
  for (const [key, value] of Object.entries(active)) root.style.setProperty(key, value);
}
function clearRandomThemeVars(bg2, fg2, mood = "crisp") {
  const vars = generateRandomTheme(bg2, fg2, mood);
  const allKeys = /* @__PURE__ */ new Set([...Object.keys(vars.light), ...Object.keys(vars.dark)]);
  const root = document.documentElement;
  for (const key of allKeys) root.style.removeProperty(key);
  root.style.removeProperty("--ds-chat-composer-shadow");
  root.style.removeProperty("--ds-chat-composer-shadow-focus");
}
const IMAGE_MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};
const rgbToHex = (red, green, blue) => `#${[red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const parseHex = (color) => {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return null;
  return [0, 2, 4].map((start) => parseInt(match[1].slice(start, start + 2), 16));
};
const mixHex = (from, to, amount) => {
  const fromChannels = parseHex(from);
  const toChannels = parseHex(to);
  if (!fromChannels || !toChannels) return to;
  const ratio = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    fromChannels[0] + (toChannels[0] - fromChannels[0]) * ratio,
    fromChannels[1] + (toChannels[1] - fromChannels[1]) * ratio,
    fromChannels[2] + (toChannels[2] - fromChannels[2]) * ratio
  );
};
const channelLuminance = (value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
};
const luminance = (red, green, blue) => channelLuminance(red) * 0.2126 + channelLuminance(green) * 0.7152 + channelLuminance(blue) * 0.0722;
const hexLuminance = (color) => {
  const channels = parseHex(color);
  return channels ? luminance(...channels) : 0;
};
const contrast = (left, right) => {
  const leftLuminance = hexLuminance(left);
  const rightLuminance = hexLuminance(right);
  return (Math.max(leftLuminance, rightLuminance) + 0.05) / (Math.min(leftLuminance, rightLuminance) + 0.05);
};
function deriveImageThemeForeground(background) {
  return mixHex("#181a1a", parseHex(background) ? background : "#e8e8e4", 0.12);
}
function ensureImageThemeAccentContrast(accent, lightSurfaces, fallback, targetContrast = 4.5) {
  const source = parseHex(accent) ? accent.toLowerCase() : fallback;
  const [sourceLightness, sourceChroma, sourceHue] = hexToOklch(source);
  for (let step = 0; step <= 100; step += 1) {
    const candidate = oklchToHex(
      sourceLightness * (1 - step / 100),
      sourceChroma,
      sourceHue
    );
    if (lightSurfaces.every((surface) => contrast(candidate, surface) >= targetContrast)) {
      return candidate;
    }
  }
  return fallback;
}
const saturation = (red, green, blue) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
};
const IMAGE_THEME_VARIANTS = ["mono", "neutral", "soft", "rich"];
const DEFAULT_IMAGE_THEME_VARIANT = "soft";
const DEFAULT_IMAGE_THEME_FOCAL_POINT = { x: 50, y: 50 };
const clampImageThemeFocalCoordinate = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
};
function resolveImageThemeFocalPoint(value) {
  if (!value || typeof value !== "object") return { ...DEFAULT_IMAGE_THEME_FOCAL_POINT };
  const candidate = value;
  return {
    x: clampImageThemeFocalCoordinate(candidate.x),
    y: clampImageThemeFocalCoordinate(candidate.y)
  };
}
const IMAGE_THEME_VARIANT_TUNING = {
  // Gray shell, muted controls: surfaces lose all chroma and the brand color
  // keeps its hue at about half strength, which also keeps this gear's swatch
  // distinguishable from the default one.
  mono: { surfaceChromaScale: 0, interactiveChromaFloor: 0.07 },
  neutral: { surfaceChromaScale: 0.28, interactiveChromaFloor: 0.03 },
  soft: { surfaceChromaScale: 1, interactiveChromaFloor: 0.14 },
  rich: { surfaceChromaScale: 1.7, interactiveChromaFloor: 0.2 }
};
const NEUTRAL_ACCENT_MAX_CHROMA = 0.035;
const RICH_ACCENT_MIN_CHROMA = 0.13;
function resolveImageThemeVariant(value) {
  return IMAGE_THEME_VARIANTS.includes(value) ? value : DEFAULT_IMAGE_THEME_VARIANT;
}
const stripChroma = (color) => oklchToHex(hexToOklch(color)[0], 0, 0);
const muteChroma = (color, factor) => {
  const [lightness, chroma, hue] = hexToOklch(color);
  return oklchToHex(lightness, chroma * factor, hue);
};
const MONO_ACCENT_CHROMA_SCALE = 0.55;
function imageThemeVariantAccent(palette, variant) {
  const soft = palette.accents?.soft ?? palette.accent;
  if (variant === "mono") return muteChroma(soft, MONO_ACCENT_CHROMA_SCALE);
  return palette.accents?.[variant] ?? palette.accent;
}
function resolveImageThemeColors(palette, variant) {
  const foreground = variant === "mono" ? stripChroma(deriveImageThemeForeground(palette.background)) : deriveImageThemeForeground(palette.background);
  const tuning = IMAGE_THEME_VARIANT_TUNING[variant];
  const generationOptions = {
    surfaceHueSource: "background",
    surfaceChromaSource: "background",
    brightLightSurfaces: true,
    enforceAccessibleInteractiveColors: true,
    preserveInteractiveColorChroma: true,
    interactiveChromaFloor: tuning.interactiveChromaFloor,
    surfaceChromaScale: tuning.surfaceChromaScale,
    tertiaryTextAlphaGap: { light: 0.16, dark: 0.12 },
    tertiaryTextMaxAlpha: { light: 0.44, dark: 0.42 }
  };
  let accent = imageThemeVariantAccent(palette, variant);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const generated = generateRandomTheme(
      palette.background,
      foreground,
      palette.mood,
      accent,
      void 0,
      void 0,
      generationOptions
    );
    const renderedAccent = generated.light["--ds-accent"] ?? accent;
    const lightSurfaces = [100, 200, 300, 400].map((level) => generated.light[`--ds-surface-${level}`]);
    if (lightSurfaces.every((surface) => contrast(renderedAccent, surface) >= 4.5)) break;
    accent = ensureImageThemeAccentContrast(renderedAccent, lightSurfaces, foreground, 4.7);
  }
  return { foreground, accent, generationOptions };
}
function imageThemeVariantBrandColor(palette, variant, isDark) {
  const { foreground, accent, generationOptions } = resolveImageThemeColors(palette, variant);
  const vars = generateRandomTheme(
    palette.background,
    foreground,
    palette.mood,
    accent,
    void 0,
    void 0,
    generationOptions
  );
  return vars[isDark ? "dark" : "light"]["--ds-brand-primary"];
}
const clusterHex = (cluster) => rgbToHex(cluster.red, cluster.green, cluster.blue);
const clusterChroma = (cluster) => hexToOklch(clusterHex(cluster))[1];
const capChroma = (color, maxChroma) => {
  const [lightness, chroma, hue] = hexToOklch(color);
  return chroma <= maxChroma ? color : oklchToHex(lightness, maxChroma, hue);
};
const raiseChroma = (color, minChroma) => {
  const [lightness, chroma, hue] = hexToOklch(color);
  return chroma >= minChroma ? color : oklchToHex(lightness, minChroma, hue);
};
const pickCluster = (clusters, score) => clusters.reduce(
  (best, cluster) => score(cluster) > score(best) ? cluster : best,
  clusters[0]
);
function extractAccentVariants(clusters, opaquePixels, softAccent) {
  const frequency = (cluster) => cluster.count / opaquePixels;
  const neutral = pickCluster(
    clusters,
    (cluster) => Math.sqrt(frequency(cluster)) / (clusterChroma(cluster) + 0.02)
  );
  const rich = pickCluster(
    clusters,
    (cluster) => clusterChroma(cluster) * frequency(cluster) ** 0.15
  );
  return boundAccentVariants(
    { neutral: clusterHex(neutral), rich: clusterHex(rich) },
    softAccent
  );
}
function boundAccentVariants(accents, softAccent) {
  const softChroma = hexToOklch(softAccent)[1];
  return {
    neutral: capChroma(accents.neutral, Math.min(NEUTRAL_ACCENT_MAX_CHROMA, softChroma * 0.6)),
    soft: softAccent,
    rich: raiseChroma(accents.rich, Math.max(RICH_ACCENT_MIN_CHROMA, softChroma * 1.4))
  };
}
function analyzeImageThemePixels(pixels) {
  const colors = /* @__PURE__ */ new Map();
  let weightedLuminance = 0;
  let opaquePixels = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${red >> 5},${green >> 5},${blue >> 5}`;
    const color = colors.get(key);
    if (color) {
      color.redTotal += red;
      color.greenTotal += green;
      color.blueTotal += blue;
      color.count += 1;
    } else {
      colors.set(key, { redTotal: red, greenTotal: green, blueTotal: blue, count: 1 });
    }
    weightedLuminance += luminance(red, green, blue);
    opaquePixels += 1;
  }
  if (opaquePixels === 0) {
    return {
      // lint-allow-raw-color — fallback palette payload when an image has no opaque pixels
      background: "#e8e8e4",
      // lint-allow-raw-color — fallback palette payload
      foreground: "#52606a",
      // lint-allow-raw-color — fallback palette payload
      accent: "#52606a",
      accents: {
        // lint-allow-raw-color — fallback palette payload
        neutral: "#6b6f72",
        // lint-allow-raw-color — fallback palette payload
        soft: "#52606a",
        // lint-allow-raw-color — fallback palette payload
        rich: "#3f6d86"
      },
      luminance: 0.8,
      mood: "minimal"
    };
  }
  const ranked = [...colors.values()].map((color) => ({
    red: color.redTotal / color.count,
    green: color.greenTotal / color.count,
    blue: color.blueTotal / color.count,
    count: color.count
  })).sort((left, right) => right.count - left.count);
  const backgroundColor = ranked[0];
  const secondaryColors = ranked.slice(1);
  const meaningfulSecondaryColors = secondaryColors.filter((color) => color.count / opaquePixels >= 0.01);
  const accentCandidates = meaningfulSecondaryColors.length > 0 ? meaningfulSecondaryColors : secondaryColors.length > 0 ? secondaryColors : ranked;
  const accentColor = accentCandidates.reduce((best, color) => {
    const frequency = color.count / opaquePixels;
    const score = saturation(color.red, color.green, color.blue) * Math.sqrt(frequency);
    const bestFrequency = best.count / opaquePixels;
    const bestScore = saturation(best.red, best.green, best.blue) * Math.sqrt(bestFrequency);
    return score > bestScore ? color : best;
  }, accentCandidates[0]);
  const sourceLuminance = weightedLuminance / opaquePixels;
  const background = rgbToHex(backgroundColor.red, backgroundColor.green, backgroundColor.blue);
  const accent = rgbToHex(accentColor.red, accentColor.green, accentColor.blue);
  return {
    background,
    foreground: deriveImageThemeForeground(background),
    accent,
    accents: extractAccentVariants(accentCandidates, opaquePixels, accent),
    luminance: sourceLuminance,
    mood: sourceLuminance < 0.32 ? "noir" : sourceLuminance > 0.72 ? "cream" : "crisp"
  };
}


export {
  generateRandomTheme,
  applyRandomThemeVars,
  clearRandomThemeVars,
  customColorPair,
  randomColorPair,
  getCustomContrastRatio,
  resolveImageThemeColors,
  resolveImageThemeVariant,
  imageThemeVariantAccent,
  imageThemeVariantBrandColor,
  deriveImageThemeForeground,
  analyzeImageThemePixels,
  IMAGE_THEME_VARIANTS,
  DEFAULT_IMAGE_THEME_VARIANT,
};
