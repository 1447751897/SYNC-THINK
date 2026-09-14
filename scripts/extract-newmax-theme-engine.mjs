import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const globals = readFileSync(
  'd:/projects/MYSELF/SYNC-THINK/.tmp-newmax-panels/globals-tZIWgBuA.js',
  'utf8',
);
const css = readFileSync(
  'd:/projects/MYSELF/SYNC-THINK/.tmp-newmax-panels/globals-SVOa807H.css',
  'utf8',
);

const start = globals.indexOf('function oklchToRgb(');
const end = globals.indexOf('const IMAGE_THEME_MAX_BYTES = 1024 * 1024');
if (start < 0 || end < 0) throw new Error('theme engine bounds not found');

let body = globals.slice(start, end);
body = body
  .replaceAll('function mixHex$1', 'function mixHexChannels')
  .replaceAll('mixHex$1(', 'mixHexChannels(')
  .replaceAll('function luminance$1', 'function relativeLuminanceFromHex')
  .replaceAll('luminance$1(', 'relativeLuminanceFromHex(')
  .replaceAll('function contrast$1', 'function contrastRatioFromHex')
  .replaceAll('contrast$1(', 'contrastRatioFromHex(');

const engine = `/* Vendored from NewMax globals-tZIWgBuA.js theme engine. Do not invent formulas. */
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

${body}

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
`;

mkdirSync('d:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/theme', {
  recursive: true,
});
writeFileSync(
  'd:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/theme/newmax-theme-engine.ts',
  engine,
);

const themeIds = ['azure', 'claude', 'professional', 'luxury'];
/** @type {Record<string, { light: Record<string, string>, dark: Record<string, string> }>} */
const named = {};

function parseBlock(source, selector) {
  const idx = source.indexOf(selector);
  if (idx < 0) return {};
  const open = source.indexOf('{', idx);
  let depth = 0;
  let endIdx = open;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  const block = source.slice(open + 1, endIdx);
  /** @type {Record<string, string>} */
  const vars = {};
  for (const line of block.split('\n')) {
    const match = /^\s*(--[a-z0-9-]+):\s*(.+?);/i.exec(line);
    if (match) vars[match[1]] = match[2].replace(/\s*!important\s*$/, '').trim();
  }
  return vars;
}

for (const id of themeIds) {
  named[id] = {
    light: parseBlock(css, `[data-theme="${id}"] {`),
    dark: parseBlock(css, `[data-theme="${id}"].dark {`),
  };
}

writeFileSync(
  'd:/projects/MYSELF/SYNC-THINK/apps/desktop/src/renderer/shell/theme/newmax-named-themes.ts',
  `/* Token tables copied from NewMax globals-SVOa807H.css [data-theme] blocks. */
export const NEWMAX_NAMED_THEME_VARS = ${JSON.stringify(named, null, 2)} as const;
`,
);

console.log('engine bytes', engine.length, 'named', Object.fromEntries(
  themeIds.map((id) => [id, Object.keys(named[id].light).length + '/' + Object.keys(named[id].dark).length]),
));
