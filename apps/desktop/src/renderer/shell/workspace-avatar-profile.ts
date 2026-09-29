import { AVATAR_STATES, type AvatarState } from './avatar-gen.js';
import { BOT_AVATAR_SHAPES, botAvatarColor, resolveBotAvatarFace, type BotAvatarFace } from './bot-avatar.js';

export const WORKSPACE_EXPRESSIONS = [['idle', '自然'], ['happy', '开心'], ['error', '生气'], ['thinking', '思考'], ['shook', '惊讶'], ['looking', '好奇'], ['wink', '眨眼'], ['sleeping', '困倦'], ['sad', '难过'], ['worried', '担心'], ['skeptical', '怀疑'], ['working', '专注'], ['excited', '兴奋'], ['calm', '平静'], ['shy', '害羞'], ['confused', '困惑']] as const;
export type WorkspaceAvatarState = AvatarState | (typeof WORKSPACE_EXPRESSIONS)[number][0];
export type WorkspaceAvatarShape = BotAvatarFace['shape'] | 'heart' | 'diamond';
export const WORKSPACE_SHAPES = [['star', '星星'], ['heart', '爱心'], ['cloud', '云朵'], ['diamond', '菱形'], ['hexagon', '盾形'], ['pill', '修长'], ['square', '方糖'], ['drop', '水滴'], ['clover', '花瓣'], ['flower', '花朵'], ['triangle', '三角'], ['circle', '圆球'], ['ghost', '幽灵'], ['cat', '小猫'], ['blob', '软团'], ['pebble', '卵石'], ['puddle', '布丁'], ['droid', '机器人'], ['mech', '机甲'], ['alien', '外星人']] as const;
export interface WorkspaceAvatarProfile { shape: WorkspaceAvatarShape; color: string; expression: WorkspaceAvatarState }
const PREFIX = 'aw:v1:';
const validExpression = (value: string): value is WorkspaceAvatarState => [...AVATAR_STATES, ...WORKSPACE_EXPRESSIONS.map(([id]) => id)].includes(value as WorkspaceAvatarState);
export function parseWorkspaceAvatar(avatar?: string): WorkspaceAvatarProfile | null {
  if (!avatar?.startsWith(PREFIX)) return null;
  const [shape, color, expression, ...rest] = avatar.slice(PREFIX.length).split(':');
  if (rest.length || ![...BOT_AVATAR_SHAPES, 'heart', 'diamond'].includes(shape) || !/^#[0-9a-f]{6}$/i.test(color) || !validExpression(expression)) return null;
  return { shape: shape as WorkspaceAvatarShape, color, expression };
}
export function resolveWorkspaceAvatar(avatar: string | undefined, identity: string): WorkspaceAvatarProfile {
  const saved = parseWorkspaceAvatar(avatar);
  if (saved) return saved;
  const face = resolveBotAvatarFace(avatar, identity);
  return { shape: face.shape, color: botAvatarColor(face), expression: 'idle' };
}
/** One versioned string persists appearance through the existing agent API/storage. */
export function workspaceAvatarSeed(profile: WorkspaceAvatarProfile): string {
  return PREFIX + profile.shape + ':' + profile.color.toLowerCase() + ':' + profile.expression;
}
