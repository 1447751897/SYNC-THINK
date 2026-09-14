import { describe, expect, it } from 'vitest';
import {
  AVATAR_COLORS,
  AVATAR_DERIVE_COLORS,
  AVATAR_SHAPES,
  AVATAR_STATES,
  avatarDataUrl,
  avatarSeed,
  avatarSvg,
  colorHex,
  deriveAvatarFace,
  parseAvatarSeed,
  resolveAvatarFace,
} from './avatar-gen.js';

describe('deriveAvatarFace', () => {
  it('is deterministic — the same id always yields the same face', () => {
    const id = 'd4c37f88-6b22-4e7a-8f33-1a9d0c4b7e02';
    const first = deriveAvatarFace(id);
    expect(deriveAvatarFace(id)).toEqual(first);
    expect(deriveAvatarFace(id)).toEqual(first);
  });

  it('spreads ids across every shape and stays inside the palette', () => {
    const shapes = new Set<string>();
    const colors = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      const face = deriveAvatarFace(`agent-${i}-${i * 7919}`);
      shapes.add(face.shape);
      colors.add(face.color);
    }
    expect(shapes.size).toBe(AVATAR_SHAPES.length);
    // 10 derived colors; allow slack so an unlucky sample can't make this flaky.
    expect(colors.size).toBeGreaterThanOrEqual(8);
  });

  it('never derives black — it reads as a missing avatar', () => {
    for (let i = 0; i < 300; i += 1) {
      expect(deriveAvatarFace(`id-${i}`).color).not.toBe('black');
    }
  });

  it('changes the face when the id changes', () => {
    const a = deriveAvatarFace('agent-aaa');
    const b = deriveAvatarFace('agent-aab');
    expect(`${a.shape}:${a.color}`).not.toBe(`${b.shape}:${b.color}`);
  });
});

describe('avatar seeds', () => {
  it('round-trips through parse', () => {
    for (const shape of AVATAR_SHAPES) {
      for (const color of AVATAR_COLORS) {
        expect(parseAvatarSeed(avatarSeed(shape, color))).toEqual({ shape, color });
      }
    }
  });

  it('rejects anything that is not a seed', () => {
    expect(parseAvatarSeed(undefined)).toBeNull();
    expect(parseAvatarSeed('')).toBeNull();
    expect(parseAvatarSeed('data:image/svg+xml;utf8,%3Csvg')).toBeNull();
    expect(parseAvatarSeed('绿毛')).toBeNull();
    expect(parseAvatarSeed('gen:v2:blob:red')).toBeNull();
    expect(parseAvatarSeed('gen:v1:nope:red')).toBeNull();
    expect(parseAvatarSeed('gen:v1:blob:nope')).toBeNull();
    expect(parseAvatarSeed('gen:v1:blob')).toBeNull();
    expect(parseAvatarSeed('gen:v1:blob:red:extra')).toBeNull();
  });

  it('derives from the id when no seed is stored', () => {
    const id = '7f3c1a55-9e24-4d68-b0c7-5a2e8f1b3d05';
    expect(resolveAvatarFace(undefined, id)).toEqual(deriveAvatarFace(id));
    expect(resolveAvatarFace('绿毛', id)).toEqual(deriveAvatarFace(id));
    expect(resolveAvatarFace(avatarSeed('hex', 'green'), id)).toEqual({
      shape: 'hex',
      color: 'green',
    });
  });
});

describe('avatarSvg', () => {
  it('renders every shape in every state without throwing', () => {
    for (const shape of AVATAR_SHAPES) {
      for (const state of AVATAR_STATES) {
        const svg = avatarSvg(shape, 'orange', state, 40);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain('viewBox="0 0 100 100"');
        expect(svg).toContain(colorHex('orange'));
        expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      }
    }
  });

  it('uses a dark eye on light fills and a light eye on dark fills', () => {
    // yellow is bright → dark eye; gray is mid-dark → light eye.
    expect(avatarSvg('blob', 'yellow', 'idle')).toContain('fill="#0d0f11"');
    expect(avatarSvg('blob', 'gray', 'idle')).toContain('fill="#f2f4f5"');
  });

  it('keeps a dark stroke on the edge symbols so they survive outside the shape', () => {
    // `pebble` is flat enough that the waiting "!" lands off the outline; without
    // the stroke it would vanish into the page background.
    const svg = avatarSvg('pebble', 'yellow', 'waiting');
    expect(svg).toContain('stroke="#0d0f11"');
  });

  it('dims archived agents', () => {
    expect(avatarSvg('blob', 'red', 'inactive')).toContain('opacity="0.42"');
    expect(avatarSvg('blob', 'red', 'idle')).not.toContain('opacity="0.42"');
  });

  it('emits a data URL the shell CSP already allows', () => {
    const url = avatarDataUrl('hex', 'green', 'idle', 40);
    expect(url.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(decodeURIComponent(url.slice('data:image/svg+xml;utf8,'.length))).toContain('<svg');
  });
});

describe('AVATAR_DERIVE_COLORS', () => {
  it('is the full palette minus black', () => {
    expect(AVATAR_DERIVE_COLORS).toHaveLength(AVATAR_COLORS.length - 1);
    expect(AVATAR_DERIVE_COLORS).not.toContain('black');
  });
});
