// Generate apps/desktop/src/renderer/shell/tokens.css from
// docs/product/16-shell-design-tokens.json.
//
// The shell's palette lives in exactly two places at runtime:
//   @theme { … }  → light defaults (Tailwind v4 also mints utility classes here)
//   .dark  { … }  → dark overrides, keyed off the class on <html>
// plus, once skins land, one pair of blocks per skin. Emitting all of that from
// one JSON is what makes "a skin is a set of token overrides" true rather than
// aspirational: there is no second file to keep in sync and no component-level
// `.dark .foo` patch to forget.
//
// Run via `pnpm tokens:css`. Never hand-edit tokens.css.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const tokensPath = resolve(ROOT, 'docs/product/16-shell-design-tokens.json');

const spec = JSON.parse(readFileSync(tokensPath, 'utf8'));
const outPath = resolve(ROOT, spec.output);

const LIGHT = 0;
const DARK = 1;

const errors = [];

/** Wrap a note as a CSS block comment at the given indent, preserving newlines. */
function comment(note, indent) {
  if (!note) return null;
  const lines = String(note).split('\n');
  if (lines.length === 1) return `${indent}/* ${lines[0]} */`;
  return [`${indent}/*`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`].join('\n');
}

/**
 * A token value is either a bare string (theme-agnostic — emitted only in the
 * light block) or a [light, dark] tuple. The tuple form is deliberate: it makes
 * it impossible to add a light color and silently leave dark inheriting a value
 * that no longer fits, which is how the palette drifted apart in the first place.
 */
function valueFor(groupId, name, raw, theme) {
  if (typeof raw === 'string') return theme === LIGHT ? raw : null;
  if (Array.isArray(raw)) {
    if (raw.length !== 2) {
      errors.push(`${groupId}.${name}: expected [light, dark], got ${raw.length} entries`);
      return null;
    }
    if (typeof raw[theme] !== 'string' || raw[theme] === '') {
      errors.push(`${groupId}.${name}: ${theme === LIGHT ? 'light' : 'dark'} value is empty`);
      return null;
    }
    return raw[theme];
  }
  errors.push(`${groupId}.${name}: value must be a string or [light, dark] tuple`);
  return null;
}

/** Keep long font stacks in the same stable shape Prettier expects. */
function declaration(group, name, value, indent) {
  const property = `${group.prefix}${name}`;
  if (group.id === 'fonts') {
    return `${indent}${property}:\n${indent}  ${value};`;
  }
  return `${indent}${property}: ${value};`;
}

/** Emit one group's declarations for one theme; returns null if nothing applies. */
function emitGroup(group, theme, indent) {
  const decls = [];
  for (const [name, raw] of Object.entries(group.tokens)) {
    const value = valueFor(group.id, name, raw, theme);
    if (value === null) continue;
    const perToken = group._notes?.[name];
    if (perToken) decls.push(comment(perToken, indent));
    decls.push(declaration(group, name, value, indent));
  }
  if (decls.length === 0) return null;
  const head = theme === LIGHT ? comment(group._note, indent) : null;
  return [head, ...decls].filter(Boolean).join('\n');
}

function emitBlock(groups, theme, indent) {
  return groups
    .map((g) => emitGroup(g, theme, indent))
    .filter(Boolean)
    .join('\n\n');
}

const groups = spec.groups ?? [];
const themeGroups = groups.filter((g) => g.utilities !== false);
const plainGroups = groups.filter((g) => g.utilities === false);

const parts = [];

parts.push(`/*
 * AUTO-GENERATED from docs/product/16-shell-design-tokens.json
 * by scripts/generate-shell-tokens.mjs. Do not edit by hand —
 * change the JSON and run \`pnpm tokens:css\`.
 *
 * Light is the reference; dark overrides via the \`.dark\` class on <html>.
 * Components consume ONLY these tokens — never raw hex — so a skin is just
 * another set of overrides on this same contract.
 */`);

// Light defaults live in @theme so Tailwind v4 can mint utilities from them
// (bg-*, text-*, rounded-*) on top of exposing them as custom properties.
parts.push(`@theme {\n${emitBlock(themeGroups, LIGHT, '  ')}\n}`);

if (plainGroups.length > 0) {
  // Tokens no component needs a utility class for: same cascade, no dead CSS.
  parts.push(`:root {\n${emitBlock(plainGroups, LIGHT, '  ')}\n}`);
}

parts.push(`.dark {\n${emitBlock(groups, DARK, '  ')}\n}`);

/*
 * Skins are orthogonal to light/dark: `data-skin` on <html> selects the palette,
 * `.dark` still selects the mode. The `:not(.dark)` guard on the light selector
 * is load-bearing — `[data-skin='x']` scores (0,2,0) and would otherwise beat
 * plain `.dark` at (0,1,0), so a light skin would leak into dark mode.
 */
const skins = Object.entries(spec.skins ?? {});
for (const [name, skin] of skins) {
  const overrides = Object.entries(skin.overrides ?? {});
  if (overrides.length === 0) continue;
  const label = skin.label ? ` (${skin.label})` : '';
  const forTheme = (theme) =>
    overrides
      .map(([prop, raw]) => {
        const value = valueFor(`skins.${name}`, prop, raw, theme);
        return value === null ? null : `  ${prop}: ${value};`;
      })
      .filter(Boolean)
      .join('\n');
  const light = forTheme(LIGHT);
  const dark = forTheme(DARK);
  parts.push(`/* skin: ${name}${label} */`);
  if (light) parts.push(`:root[data-skin='${name}']:not(.dark) {\n${light}\n}`);
  if (dark) parts.push(`:root[data-skin='${name}'].dark {\n${dark}\n}`);
}

if (errors.length > 0) {
  console.error('token spec is invalid:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

const css = parts.join('\n\n') + '\n';
writeFileSync(outPath, css, 'utf8');

const tokenCount = groups.reduce((n, g) => n + Object.keys(g.tokens).length, 0);
console.log(
  `generated ${outPath}\n  ${tokenCount} tokens in ${groups.length} groups` +
    `${skins.length ? `, ${skins.length} skin(s)` : ''}, ${css.length} bytes`,
);
