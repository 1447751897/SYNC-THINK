import { describe, expect, it } from 'vitest';
import { botAvatarPalette, botAvatarTypes } from 'bot-avatars';
import { AVATAR_SHAPES, AVATAR_STATES, avatarSeed, colorHex } from './avatar-gen.js';
import {
  BOT_AVATAR_COLORS,
  BOT_AVATAR_LABELS,
  BOT_AVATAR_PALETTE,
  BOT_AVATAR_SHAPES,
  botAvatarColor,
  botAvatarSeed,
  botAvatarState,
  deriveBotAvatarFace,
  parseBotAvatar,
  parseBotAvatarSeed,
  resolveBotAvatarFace,
} from './bot-avatar.js';

describe('bot avatar storage and compatibility', () => {
  it('keeps the deferred engine manifest in sync with the pinned package', () => {
    expect(BOT_AVATAR_SHAPES).toEqual(botAvatarTypes);
    expect(BOT_AVATAR_PALETTE).toEqual(botAvatarPalette);
    expect(BOT_AVATAR_SHAPES).toHaveLength(18);
    expect(Object.keys(BOT_AVATAR_LABELS).sort()).toEqual([...BOT_AVATAR_SHAPES].sort());
  });

  it('round-trips all shapes and colours through the existing avatar string field', () => {
    for (const shape of BOT_AVATAR_SHAPES) {
      for (const color of BOT_AVATAR_COLORS) {
        const seed = botAvatarSeed(shape, color);
        expect(parseBotAvatarSeed(seed)).toEqual({ shape, color });
        expect(parseBotAvatar(`  ${seed}  `)).toEqual({ shape, color });
      }
    }
  });

  it.each([
    undefined,
    '',
    '🤖',
    'A',
    'data:image/png;base64,fake',
    'bot:v2:clover:preset',
    'bot:v1:unknown:blue',
    'bot:v1:clover:unknown',
    'bot:v1:clover',
    'bot:v1:clover:blue:extra',
    'bot:v1:clover:',
    'gen:v1:bad:blue',
  ])('leaves non-seed or invalid data alone: %s', (value) => {
    expect(parseBotAvatar(value)).toBeNull();
  });

  it('projects every legacy shape without changing its stored colour', () => {
    const expected = ['blob', 'pebble', 'square', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'];
    AVATAR_SHAPES.forEach((shape, index) => {
      const seed = avatarSeed(shape, 'cyan');
      expect(parseBotAvatar(seed)).toEqual({ shape: expected[index], color: 'cyan' });
      expect(parseBotAvatarSeed(seed)).toBeNull();
    });
  });

  it('derives a stable face from identity and preserves explicit selections', () => {
    const choices = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const id = `agent-${index}`;
      const face = deriveBotAvatarFace(id);
      expect(deriveBotAvatarFace(id)).toEqual(face);
      expect(face.color).toBe('preset');
      choices.add(face.shape);
    }
    expect(choices.size).toBeGreaterThan(14);
    expect(resolveBotAvatarFace('A', 'agent-1')).toEqual(deriveBotAvatarFace('agent-1'));
    expect(resolveBotAvatarFace('bot:v1:cat:violet', 'agent-1')).toEqual({
      shape: 'cat',
      color: 'violet',
    });
  });

  it('uses library default colours unless the user picked a colour', () => {
    expect(botAvatarColor({ shape: 'clover', color: 'preset' })).toBe(botAvatarPalette.clover);
    expect(botAvatarColor({ shape: 'clover', color: 'blue' })).toBe(colorHex('blue'));
  });

  it('adapts all nine business states to a supported canvas pose', () => {
    expect(AVATAR_STATES.map(botAvatarState)).toEqual([
      'default',
      'working',
      'working',
      'default',
      'default',
      'default',
      'default',
      'sleeping',
      'sleeping',
    ]);
  });
});
