// Generate CSS custom properties from docs/product/15-frontend-design-tokens.json.
// Light theme under [data-st-theme="light"] (the :root default); dark under
// either [data-st-theme="dark"] or system @media (prefers-color-scheme: dark).
// Tokens use a `--st-` prefix so they never collide with libraries.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(__dirname, '../../../docs/product/15-frontend-design-tokens.json');
const outPath = resolve(__dirname, '../src/styles/index.css');

const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

function dashize(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function emitColors(theme) {
  const colors = tokens.colors[theme];
  return Object.entries(colors).map(([k, v]) => `  --st-color-${dashize(k)}: ${v};`).join('\n');
}

function emitNonColorTokens(indent = '  ') {
  const spacing = Object.entries(tokens.spacing)
    .map(([k, v]) => (k === 'scale' ? `${indent}--st-spacing-scale: ${v.join(', ')};` : `${indent}--st-spacing-${dashize(k)}: ${v};`))
    .join('\n');
  const radius = Object.entries(tokens.radius).map(([k, v]) => `${indent}--st-radius-${dashize(k)}: ${v}px;`).join('\n');
  const typography = Object.entries(tokens.typography).map(([k, v]) => `${indent}--st-typo-${dashize(k)}: ${v};`).join('\n');
  const shadows = Object.entries(tokens.shadows).map(([k, v]) => `${indent}--st-shadow-${dashize(k)}: ${v};`).join('\n');
  const layout = Object.entries(tokens.layout).map(([k, v]) => `${indent}--st-layout-${dashize(k)}: ${v};`).join('\n');
  const transitions = Object.entries(tokens.transitions).map(([k, v]) => `${indent}--st-trans-${dashize(k)}: ${v};`).join('\n');
  const motion = Object.entries(tokens.motion)
    .map(([k, v]) => (Array.isArray(v) ? `${indent}--st-motion-${dashize(k)}: ${v.join(', ')};` : typeof v === 'boolean' ? `${indent}--st-motion-${dashize(k)}: ${v ? 1 : 0};` : `${indent}--st-motion-${dashize(k)}: ${v};`))
    .join('\n');
  const breakpoints = Object.entries(tokens.breakpoints).map(([k, v]) => `${indent}--st-bp-${dashize(k)}: ${v};`).join('\n');
  return [spacing, radius, typography, shadows, layout, transitions, motion, breakpoints].join('\n');
}

const nonColor = emitNonColorTokens('  ');

const css = `/* AUTO-GENERATED from docs/product/15-frontend-design-tokens.json by scripts/generate-css.mjs.
 * Do not edit by hand; run \`pnpm tokens:css\` to regenerate. */

:root {
  color-scheme: light;
  /* Non-color tokens shared across themes (spacing/radius/typography/shadows/layout/transitions/motion/breakpoints). */
${nonColor}
}

:root,
:root[data-st-theme='light'] {
  color-scheme: light;
${emitColors('light')}
}

:root[data-st-theme='dark'] {
  color-scheme: dark;
${emitColors('dark')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-st-theme]) {
    color-scheme: dark;
${emitColors('dark')
  .split('\n')
  .map((l) => '  ' + l)
  .join('\n')}
  }
}

/* Reduced-motion: collapse all transitions/animations to near-instant when
 * the user has expressed the preference (design §15.4 / §7.1). */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

writeFileSync(outPath, css, 'utf8');
console.log('generated', outPath, 'bytes', css.length);
