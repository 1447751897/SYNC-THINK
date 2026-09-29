import type { BotAvatarState, BotAvatarType } from 'bot-avatars';
import palette from './assets/bot-avatar-palette.json' with { type: 'json' };
import {
  AVATAR_COLORS,
  colorHex,
  isAvatarColor,
  parseAvatarSeed,
  type AvatarColor,
  type AvatarShape,
  type AvatarState,
} from './avatar-gen.js';

export const BOT_AVATAR_PREFIX = 'bot:v1:';
// Small manifest from the pinned 0.1.1 package. Keep the canvas engine out of
// the initial shell chunk; parity is checked against the package in tests.
export const BOT_AVATAR_SHAPES = [
  'clover',
  'flower',
  'triangle',
  'square',
  'blob',
  'ghost',
  'circle',
  'drop',
  'star',
  'droid',
  'mech',
  'alien',
  'hexagon',
  'cat',
  'cloud',
  'pill',
  'pebble',
  'puddle',
] as const satisfies readonly BotAvatarType[];
// Authored material colours are asset data, not theme-dependent UI colours.
export const BOT_AVATAR_PALETTE: Record<BotAvatarType, string> = palette;
export const BOT_AVATAR_COLORS = ['preset', ...AVATAR_COLORS] as const;
export type BotAvatarColor = AvatarColor | 'preset';
export interface BotAvatarFace {
  shape: BotAvatarType;
  color: BotAvatarColor;
}

export const BOT_AVATAR_LABELS: Record<BotAvatarType, string> = {
  clover: '四叶草',
  flower: '花朵',
  triangle: '三角',
  square: '方糖',
  blob: '软团',
  ghost: '幽灵',
  circle: '圆球',
  drop: '水滴',
  star: '星星',
  droid: '小机器人',
  mech: '机甲',
  alien: '外星人',
  hexagon: '六角',
  cat: '小猫',
  cloud: '云朵',
  pill: '胶囊',
  pebble: '卵石',
  puddle: '布丁',
};

// Read old persisted faces without rewriting any agent records. Keep the chosen
// colour and use the closest library silhouette; all new writes use bot:v1.
const LEGACY_SHAPES: Record<AvatarShape, BotAvatarType> = {
  blob: 'blob',
  pebble: 'pebble',
  squircle: 'square',
  tablet: 'pill',
  wedge: 'triangle',
  hex: 'hexagon',
  cloud: 'cloud',
  teardrop: 'drop',
};

export function botAvatarSeed(shape: BotAvatarType, color: BotAvatarColor = 'preset'): string {
  return `${BOT_AVATAR_PREFIX}${shape}:${color}`;
}

export function parseBotAvatarSeed(avatar: string | undefined): BotAvatarFace | null {
  const value = avatar?.trim();
  if (!value?.startsWith(BOT_AVATAR_PREFIX)) return null;
  const [shape, color, ...extra] = value.slice(BOT_AVATAR_PREFIX.length).split(':');
  if (extra.length || !BOT_AVATAR_SHAPES.includes(shape as BotAvatarType)) return null;
  if (color !== 'preset' && !isAvatarColor(color)) return null;
  return { shape: shape as BotAvatarType, color };
}

/** Accept both versions, but never interpret uploaded images or text as seeds. */
export function parseBotAvatar(avatar: string | undefined): BotAvatarFace | null {
  const current = parseBotAvatarSeed(avatar);
  if (current) return current;
  const legacy = parseAvatarSeed(avatar?.trim());
  return legacy ? { shape: LEGACY_SHAPES[legacy.shape], color: legacy.color } : null;
}

export function deriveBotAvatarFace(identity: string): BotAvatarFace {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 73244475);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return {
    shape: BOT_AVATAR_SHAPES[((hash ^ (hash >>> 16)) >>> 0) % BOT_AVATAR_SHAPES.length],
    color: 'preset',
  };
}

export function resolveBotAvatarFace(avatar: string | undefined, identity: string): BotAvatarFace {
  return parseBotAvatar(avatar) ?? deriveBotAvatarFace(identity);
}

export function botAvatarColor(face: BotAvatarFace): string {
  return face.color === 'preset' ? BOT_AVATAR_PALETTE[face.shape] : colorHex(face.color);
}

/** Keep the app's richer state model; only adapt the visual library's pose. */
export function botAvatarState(state: AvatarState): BotAvatarState {
  if (state === 'thinking' || state === 'working') return 'working';
  if (state === 'sleeping' || state === 'inactive') return 'sleeping';
  return 'default';
}
