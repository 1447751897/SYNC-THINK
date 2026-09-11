/**
 * Procedural agent avatars — a deterministic (shape, color) pair rendered as an
 * inline SVG, plus a 9-state expression layer.
 *
 * Design model adapted from Grok Bot's character picker: an avatar is a
 * (shape, color) pair derived from the agent id, so every agent gets a stable
 * face out of the box, and users can override it by hand. The geometry below is
 * original — Grok Bot's client is proprietary minified code and Plane's Agent
 * Avatar Lab is AGPL-3.0, so neither could be ported; only the model was
 * reproduced.
 *
 * Colors are literal hex, NOT CSS custom properties: the SVG is emitted as a
 * `data:image/svg+xml` URL rendered through `<img>`, and a data-URL document
 * does not inherit the shell's cascade, so `var(--color-avatar-N)` would resolve
 * to nothing there. The shell CSP already allows this scheme
 * (`img-src 'self' data: https: http: sync-think-image:`).
 */

export const AVATAR_SHAPES = [
  'blob',
  'pebble',
  'squircle',
  'tablet',
  'wedge',
  'hex',
  'cloud',
  'teardrop',
] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

export const AVATAR_COLORS = [
  'black',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'violet',
  'magenta',
  'gray',
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Colors used by automatic derivation — black reads as "no avatar" on the page. */
export const AVATAR_DERIVE_COLORS: readonly AvatarColor[] = AVATAR_COLORS.filter(
  (color) => color !== 'black',
);

export const AVATAR_STATES = [
  'idle',
  'thinking',
  'working',
  'waiting',
  'happy',
  'error',
  'looking',
  'sleeping',
  'inactive',
] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

/** Seed format stored in `GlobalAgent.avatar` / `Team.avatar`. */
export const AVATAR_SEED_PREFIX = 'gen:v1:';

const COLOR_HEX: Record<AvatarColor, string> = {
  black: '#000000',
  brown: '#936439',
  red: '#FF263C',
  orange: '#FF6700',
  yellow: '#FF9800',
  green: '#00C972',
  cyan: '#00BCA6',
  blue: '#1084FE',
  violet: '#9159FE',
  magenta: '#FF309B',
  gray: '#777777',
};

/** Shape outlines, drawn in a 0 0 100 100 viewBox. */
const SHAPE_PATH: Record<AvatarShape, string> = {
  blob: 'M44 10 C68 6 90 22 90 45 C90 61 82 75 67 84 C52 93 29 92 17 79 C5 66 5 44 14 30 C22 17 30 13 44 10 Z',
  pebble: 'M50 23 C77 23 95 35 95 50 C95 65 77 77 50 77 C23 77 5 65 5 50 C5 35 23 23 50 23 Z',
  squircle: 'M50 9 C81 9 91 19 91 50 C91 81 81 91 50 91 C19 91 9 81 9 50 C9 19 19 9 50 9 Z',
  tablet: 'M50 8 H75 C83 8 89 14 89 22 V78 C89 86 83 92 75 92 H25 C17 92 11 86 11 78 V22 C11 14 17 8 25 8 Z',
  wedge: 'M50 7 C62 7 73 15 81 27 L92 46 C95 52 95 58 92 64 C84 82 68 92 50 92 C32 92 16 82 8 64 C5 58 5 52 8 46 L19 27 C27 15 38 7 50 7 Z',
  hex: 'M50 9 L86 29 V71 L50 91 L14 71 V29 Z',
  cloud: 'M28 71 C15 71 6 61 6 49 C6 38 15 28 27 28 C30 16 40 8 52 8 C66 8 77 18 79 31 C90 33 96 42 96 52 C96 62 89 71 79 71 Z',
  teardrop: 'M50 8 C50 8 88 44 88 62 C88 80 71 94 50 94 C29 94 12 80 12 62 C12 44 50 8 50 8 Z',
};

export interface AvatarFace {
  shape: AvatarShape;
  color: AvatarColor;
}

export function isAvatarShape(value: string): value is AvatarShape {
  return (AVATAR_SHAPES as readonly string[]).includes(value);
}

export function isAvatarColor(value: string): value is AvatarColor {
  return (AVATAR_COLORS as readonly string[]).includes(value);
}

export function colorHex(color: AvatarColor): string {
  return COLOR_HEX[color];
}

/** Build the seed string persisted in the `avatar` field. */
export function avatarSeed(shape: AvatarShape, color: AvatarColor): string {
  return `${AVATAR_SEED_PREFIX}${shape}:${color}`;
}

/**
 * Parse a `gen:v1:<shape>:<color>` seed. Returns null for anything else —
 * imported images (`data:image/…`) and legacy two-character text avatars are
 * handled by their own branches and must not be parsed as seeds.
 */
export function parseAvatarSeed(avatar: string | undefined): AvatarFace | null {
  if (!avatar || !avatar.startsWith(AVATAR_SEED_PREFIX)) return null;
  const rest = avatar.slice(AVATAR_SEED_PREFIX.length);
  const [shape, color, ...extra] = rest.split(':');
  if (extra.length > 0 || !shape || !color) return null;
  if (!isAvatarShape(shape) || !isAvatarColor(color)) return null;
  return { shape, color };
}

// ── Deterministic derivation ────────────────────────────────────────────────
// Same id → same face, forever, so an agent never changes appearance on reload.

const GOLDEN = 2654435769;

function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 1831565813) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shapeHash(input: string): number {
  let e = fnv1a(input) | 0;
  e = Math.imul(e ^ (e >>> 16), 73244475);
  e = Math.imul(e ^ (e >>> 13), 3266489909);
  return (e ^ (e >>> 16)) >>> 0;
}

/** Derive a stable face from an agent id (or any stable string). */
export function deriveAvatarFace(id: string): AvatarFace {
  const colorRandom = mulberry32((fnv1a(id) ^ Math.imul(1, GOLDEN)) >>> 0);
  const color =
    AVATAR_DERIVE_COLORS[Math.floor(colorRandom() * AVATAR_DERIVE_COLORS.length)] ?? 'blue';
  const shape = AVATAR_SHAPES[shapeHash(id) % AVATAR_SHAPES.length] ?? 'blob';
  return { shape, color };
}

// ── Expression layer ────────────────────────────────────────────────────────

/** Relative luminance test — picks an eye color that stays legible per shape color. */
function isLightColor(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/**
 * Symbols that sit near the shape's edge (thinking dots, the waiting "!",
 * the sleeping "z", the working arc) must survive landing OUTSIDE the outline —
 * `pebble` is flat enough that they do. They are drawn light-on-dark with a dark
 * stroke so they read both on the colored shape and on the page background.
 * Dropping the stroke makes them invisible on dark themes.
 */
const SYMBOL_FILL = '#f2f4f5';
const SYMBOL_EDGE = '#0d0f11';

/** States rendered at reduced opacity (archived agents read as "switched off"). */
const DIM_STATES: Partial<Record<AvatarState, number>> = { inactive: 0.42 };

function faceMarkup(state: AvatarState, eye: string): string {
  const S = SYMBOL_FILL;
  const O = SYMBOL_EDGE;
  switch (state) {
    case 'thinking':
      return `<rect x="35.5" y="38" width="8.6" height="10" rx="3.4" fill="${eye}"/>
             <rect x="55.9" y="38" width="8.6" height="10" rx="3.4" fill="${eye}"/>
             <circle cx="37" cy="21" r="2.9" fill="${S}" stroke="${O}" stroke-width="1.3" opacity=".55"/>
             <circle cx="50" cy="15.5" r="3.5" fill="${S}" stroke="${O}" stroke-width="1.3" opacity=".9"/>
             <circle cx="63" cy="21" r="2.9" fill="${S}" stroke="${O}" stroke-width="1.3" opacity=".55"/>`;
    case 'working':
      return `<path d="M30 32.5 L42.5 36.5" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>
            <path d="M70 32.5 L57.5 36.5" stroke="${eye}" stroke-width="2.6" stroke-linecap="round"/>
            <rect x="35" y="43" width="9" height="10.5" rx="3.6" fill="${eye}"/>
            <rect x="56" y="43" width="9" height="10.5" rx="3.6" fill="${eye}"/>
            <path d="M84 14 A13 13 0 0 1 90 22" stroke="${O}" stroke-width="5.2" fill="none" stroke-linecap="round"/>
            <path d="M84 14 A13 13 0 0 1 90 22" stroke="${S}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
    case 'waiting':
      return `<rect x="33.5" y="40.5" width="10.6" height="15" rx="4.8" fill="${eye}"/>
            <rect x="55.9" y="40.5" width="10.6" height="15" rx="4.8" fill="${eye}"/>
            <rect x="47.9" y="9.5" width="4.4" height="11.5" rx="2.2" fill="${S}" stroke="${O}" stroke-width="1.3"/>
            <circle cx="50.1" cy="25.8" r="2.6" fill="${S}" stroke="${O}" stroke-width="1.3"/>`;
    case 'happy':
      return `<path d="M31 46.5 Q36.5 38.5 42 46.5" stroke="${eye}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
          <path d="M58 46.5 Q63.5 38.5 69 46.5" stroke="${eye}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
          <path d="M41 60 Q50 70 59 60" stroke="${eye}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'error':
      return `<path d="M33 41 L43.5 51.5 M43.5 41 L33 51.5" stroke="${eye}" stroke-width="3.1" stroke-linecap="round"/>
          <path d="M56.5 41 L67 51.5 M67 41 L56.5 51.5" stroke="${eye}" stroke-width="3.1" stroke-linecap="round"/>
          <path d="M41.5 67.5 Q50 60 58.5 67.5" stroke="${eye}" stroke-width="2.8" fill="none" stroke-linecap="round"/>`;
    case 'looking':
      return `<rect x="39.5" y="43" width="9" height="12.5" rx="3.6" fill="${eye}"/>
            <rect x="60.5" y="43" width="9" height="12.5" rx="3.6" fill="${eye}"/>`;
    case 'sleeping':
      return `<path d="M31.5 48 H43" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>
             <path d="M57 48 H68.5" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>
             <path d="M63 14 H74 L63 26 H74" stroke="${O}" stroke-width="4.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
             <path d="M63 14 H74 L63 26 H74" stroke="${S}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'inactive':
    case 'idle':
    default:
      return `<rect x="35" y="43" width="9" height="12.5" rx="3.6" fill="${eye}"/>
         <rect x="56" y="43" width="9" height="12.5" rx="3.6" fill="${eye}"/>`;
  }
}

/** Render the avatar as a standalone SVG string (transparent background). */
export function avatarSvg(
  shape: AvatarShape,
  color: AvatarColor,
  state: AvatarState = 'idle',
  size = 40,
): string {
  const fill = COLOR_HEX[color];
  const eye = isLightColor(fill) ? '#0d0f11' : '#f2f4f5';
  const dim = DIM_STATES[state];
  const opacity = dim ? ` opacity="${dim}"` : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"${opacity}>
<path d="${SHAPE_PATH[shape]}" fill="${fill}" stroke="${fill}" stroke-width="2.5" stroke-linejoin="round"/>
${faceMarkup(state, eye)}
</svg>`;
}

/**
 * Same avatar as a `data:` URL. The alpha channel is preserved, so callers must
 * NOT clip it to a circle the way the imported-image branch does — clipping
 * would cut the shape itself away.
 */
export function avatarDataUrl(
  shape: AvatarShape,
  color: AvatarColor,
  state: AvatarState = 'idle',
  size = 40,
): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(avatarSvg(shape, color, state, size))}`;
}

/**
 * Resolve whatever is stored in `avatar` into a face, falling back to
 * deterministic derivation from `id` when there is no seed.
 */
export function resolveAvatarFace(avatar: string | undefined, id: string): AvatarFace {
  return parseAvatarSeed(avatar) ?? deriveAvatarFace(id);
}
