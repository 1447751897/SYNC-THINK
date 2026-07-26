#!/usr/bin/env node
/**
 * Guards the shell's design-token contract.
 *
 * Two failures this catches, both of which shipped before:
 *   1. Variables from a foreign design system (--ds-color-accent) that are
 *      defined nowhere, so their fallback silently wins and the component
 *      stops following the theme.
 *   2. Raw hex / Tailwind palette classes, which do not respond to the
 *      light-dark switch at all.
 *
 * Run: node scripts/check-design-tokens.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHELL_DIR = join(ROOT, 'apps/desktop/src/renderer/shell');
const CSS_FILE = join(SHELL_DIR, 'shell.css');

/** Neutral black/white are theme-invariant by nature — allowed as shadow and
 *  scrim inputs, where a token would just be an alias for the same value. */
const NEUTRAL_HEX = /^#(000|fff|000000|ffffff)$/i;

const violations = [];
const record = (file, line, rule, text) =>
  violations.push({ file: relative(ROOT, file), line, rule, text: text.trim() });

// ── CSS ──────────────────────────────────────────────────────────────────────
const css = readFileSync(CSS_FILE, 'utf8').split(/\r?\n/);

/** Token declaration blocks (@theme, .dark) are where hex is *supposed* to live. */
const declBlocks = [];
{
  let depth = 0;
  let start = -1;
  css.forEach((line, i) => {
    if (start < 0 && /^\s*(@theme|\.dark)\b[^{]*\{/.test(line)) {
      start = i;
      depth = 0;
    }
    if (start >= 0) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth <= 0) {
        declBlocks.push([start, i]);
        start = -1;
      }
    }
  });
}
const inDeclBlock = (i) => declBlocks.some(([a, b]) => i >= a && i <= b);

css.forEach((line, i) => {
  const lineNo = i + 1;
  const code = line.replace(/\/\*.*?\*\//g, '');

  for (const m of code.matchAll(/--ds-[a-z0-9-]+/gi)) {
    record(CSS_FILE, lineNo, 'foreign --ds- variable', m[0]);
  }

  if (inDeclBlock(i)) return;

  for (const m of code.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    if (NEUTRAL_HEX.test(m[0])) continue;
    record(CSS_FILE, lineNo, 'raw hex outside token block', m[0]);
  }
});

// ── TSX / TS ────────────────────────────────────────────────────────────────
const PALETTE = [
  'red', 'amber', 'sky', 'blue', 'green', 'emerald', 'slate', 'gray', 'zinc',
  'neutral', 'stone', 'orange', 'yellow', 'lime', 'teal', 'cyan', 'indigo',
  'violet', 'purple', 'fuchsia', 'pink', 'rose',
].join('|');
const UTIL = 'text|bg|border|from|to|via|ring|fill|stroke|decoration|outline|shadow|accent|caret|divide';

/** `bg-black/50` etc. — scrims over arbitrary content, intentionally fixed. */
const SCRIM = new RegExp(`^(bg|from|to|via)-(black|white)\\/[0-9]{1,3}$`);
const paletteRe = new RegExp(`\\b(${UTIL})-(white|black|(?:${PALETTE})-[0-9]{2,3})(\\/[0-9]{1,3})?\\b`, 'g');

for (const name of readdirSync(SHELL_DIR)) {
  if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
  const file = join(SHELL_DIR, name);
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;

    for (const m of line.matchAll(/--ds-[a-z0-9-]+/gi)) {
      record(file, lineNo, 'foreign --ds- variable', m[0]);
    }
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      if (NEUTRAL_HEX.test(m[0])) continue;
      record(file, lineNo, 'raw hex color', m[0]);
    }
    for (const m of line.matchAll(paletteRe)) {
      if (SCRIM.test(m[0])) continue;
      record(file, lineNo, 'tailwind palette class', m[0]);
    }
  });
}

// ── Report ───────────────────────────────────────────────────────────────────
if (violations.length === 0) {
  console.log('design tokens ok — no raw colors or foreign variables in the shell');
  process.exit(0);
}

console.error(`\n${violations.length} design-token violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}`);
}
console.error(
  '\nComponents must consume theme tokens (var(--color-*) / Tailwind theme utilities)\n' +
  'so presets can remap the palette. See the header comment in shell.css.\n',
);
process.exit(1);
