import { describe, expect, it } from 'vitest';
import {
  inspectAgentAvatar,
  parseStoredAgentAvatarPath,
} from '../src/main/agent-avatar.js';

describe('agent avatar boundary', () => {
  it('accepts a bounded PNG from its signature and dimensions', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(512, 16);
    png.writeUInt32BE(512, 20);
    expect(inspectAgentAvatar(png)).toEqual({
      extension: 'png',
      mimeType: 'image/png',
      width: 512,
      height: 512,
    });
  });

  it('rejects extension spoofing, oversized dimensions, and arbitrary stored paths', () => {
    expect(() => inspectAgentAvatar(Buffer.from('not an image'))).toThrow(
      'avatar.format_unsupported',
    );
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(10_000, 16);
    png.writeUInt32BE(10_000, 20);
    expect(() => inspectAgentAvatar(png)).toThrow('avatar.dimensions_invalid');
    expect(() => parseStoredAgentAvatarPath('../../secret.png')).toThrow('avatar.path_invalid');
    expect(
      parseStoredAgentAvatarPath(`avatars/${'a'.repeat(64)}.webp`),
    ).toBe(`avatars/${'a'.repeat(64)}.webp`);
  });
});
