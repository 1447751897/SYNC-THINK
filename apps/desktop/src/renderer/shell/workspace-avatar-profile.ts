import { AVATAR_STATES, type AvatarState } from './avatar-gen.js';
import { botAvatarColor, resolveBotAvatarFace, type BotAvatarFace } from './bot-avatar.js';

export const WORKSPACE_EXPRESSIONS = [['idle', '自然'], ['happy', '开心'], ['error', '生气'], ['thinking', '思考'], ['shook', '惊讶'], ['looking', '好奇'], ['wink', '眨眼'], ['sleeping', '困倦'], ['sad', '难过'], ['worried', '担心'], ['skeptical', '怀疑'], ['working', '专注'], ['excited', '兴奋'], ['calm', '平静'], ['shy', '害羞'], ['confused', '困惑']] as const;
export type WorkspaceAvatarState = AvatarState | (typeof WORKSPACE_EXPRESSIONS)[number][0];
export type WorkspaceAvatarShape = BotAvatarFace['shape'] | 'heart' | 'diamond' | 'dumpling' | 'bunny' | 'bean' | 'mushroom';
export const WORKSPACE_SHAPES = [['star', '星星'], ['heart', '爱心'], ['cloud', '云朵'], ['diamond', '菱形'], ['hexagon', '盾形'], ['pill', '修长'], ['square', '方糖'], ['drop', '水滴'], ['clover', '花瓣'], ['flower', '花朵'], ['triangle', '三角'], ['circle', '圆球'], ['ghost', '幽灵'], ['cat', '小猫'], ['blob', '软团'], ['pebble', '卵石'], ['puddle', '布丁'], ['droid', '机器人'], ['mech', '机甲'], ['alien', '外星人'], ['dumpling', '团子'], ['bunny', '长耳'], ['bean', '豆荚'], ['mushroom', '蘑菇']] as const;
export const AVATAR_HEADWEAR = [['none', '无头饰'], ['beret', '贝雷帽'], ['detective', '侦探帽'], ['cap', '棒球帽'], ['sprout', '嫩芽'], ['headphones', '耳机']] as const;
export const AVATAR_EYEWEAR = [['none', '无眼饰'], ['glasses', '圆框眼镜'], ['monocle', '单片眼镜']] as const;
export const AVATAR_NECKWEAR = [['none', '无颈饰'], ['bow', '领结'], ['scarf', '围巾']] as const;
export interface AvatarAccessories {
  head: (typeof AVATAR_HEADWEAR)[number][0];
  eyes: (typeof AVATAR_EYEWEAR)[number][0];
  neck: (typeof AVATAR_NECKWEAR)[number][0];
}
export const NO_AVATAR_ACCESSORIES: Readonly<AvatarAccessories> = Object.freeze({ head: 'none', eyes: 'none', neck: 'none' });
export interface WorkspaceAvatarProfile { shape: WorkspaceAvatarShape; color: string; expression: WorkspaceAvatarState; material?: 'plush' | 'classic'; accessories?: AvatarAccessories }
const includesOption = (options: readonly (readonly [string, string])[], id: string) => options.some(([value]) => value === id);
const PREFIX = 'aw:v1:';
const validExpression = (value: string): value is WorkspaceAvatarState => [...AVATAR_STATES, ...WORKSPACE_EXPRESSIONS.map(([id]) => id)].includes(value as WorkspaceAvatarState);
export function parseWorkspaceAvatar(avatar?: string): WorkspaceAvatarProfile | null {
  const v2 = avatar?.startsWith('aw:v2:');
  if (!v2 && !avatar?.startsWith(PREFIX)) return null;
  const [shape, color, expression, ...rest] = avatar!.slice(PREFIX.length).split(':');
  if (!WORKSPACE_SHAPES.some(([id]) => id === shape) || !/^#[0-9a-f]{6}$/i.test(color) || !validExpression(expression)) return null;
  const base = { shape: shape as WorkspaceAvatarShape, color, expression };
  if (!v2) return rest.length ? null : base;
  const [material, head, eyes, neck, ...extra] = rest;
  if (extra.length || !['plush', 'classic'].includes(material) || !includesOption(AVATAR_HEADWEAR, head) || !includesOption(AVATAR_EYEWEAR, eyes) || !includesOption(AVATAR_NECKWEAR, neck)) return null;
  return { ...base, material: material as 'plush' | 'classic', accessories: { head, eyes, neck } as AvatarAccessories };
}
export function resolveWorkspaceAvatar(avatar: string | undefined, identity: string): WorkspaceAvatarProfile {
  const saved = parseWorkspaceAvatar(avatar);
  if (saved) return { ...saved, material: 'classic' };
  const face = resolveBotAvatarFace(avatar, identity);
  return { shape: face.shape, color: botAvatarColor(face), expression: 'idle', material: 'classic' };
}
/** One versioned string persists appearance through the existing agent API/storage. */
export function workspaceAvatarSeed(profile: WorkspaceAvatarProfile): string {
  const base = profile.shape + ':' + profile.color.toLowerCase() + ':' + profile.expression;
  if ((!profile.material || profile.material === 'classic') && !profile.accessories) return PREFIX + base;
  const accessories = profile.accessories ?? NO_AVATAR_ACCESSORIES;
  return 'aw:v2:' + base + ':classic:' + accessories.head + ':' + accessories.eyes + ':' + accessories.neck;
}
