export const MAX_AGENT_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_AGENT_AVATAR_DIMENSION = 4_096;

export interface AgentAvatarMetadata {
  extension: 'png' | 'jpg' | 'webp';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

const STORED_AVATAR_PATH = /^avatars\/[a-f0-9]{64}\.(png|jpg|webp)$/;

function dimensions(width: number, height: number): { width: number; height: number } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_AGENT_AVATAR_DIMENSION ||
    height > MAX_AGENT_AVATAR_DIMENSION
  ) {
    throw new Error('avatar.dimensions_invalid');
  }
  return { width, height };
}

function png(buffer: Buffer): AgentAvatarMetadata | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return undefined;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('avatar.png_ihdr_missing');
  return {
    extension: 'png',
    mimeType: 'image/png',
    ...dimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20)),
  };
}

const JPEG_SOF = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

function jpeg(buffer: Buffer): AgentAvatarMetadata | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error('avatar.jpeg_segment_invalid');
    if (JPEG_SOF.has(marker)) {
      if (length < 7) throw new Error('avatar.jpeg_sof_invalid');
      return {
        extension: 'jpg',
        mimeType: 'image/jpeg',
        ...dimensions(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)),
      };
    }
    offset += length;
  }
  throw new Error('avatar.jpeg_dimensions_missing');
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
}

function webp(buffer: Buffer): AgentAvatarMetadata | undefined {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return undefined;
  }
  const format = buffer.toString('ascii', 12, 16);
  let width: number;
  let height: number;
  if (format === 'VP8X') {
    width = readUInt24LE(buffer, 24) + 1;
    height = readUInt24LE(buffer, 27) + 1;
  } else if (format === 'VP8L') {
    if (buffer[20] !== 0x2f) throw new Error('avatar.webp_lossless_invalid');
    width = 1 + (buffer[21]! | ((buffer[22]! & 0x3f) << 8));
    height =
      1 + (((buffer[22]! & 0xc0) >> 6) | (buffer[23]! << 2) | ((buffer[24]! & 0x0f) << 10));
  } else if (format === 'VP8 ') {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) {
      throw new Error('avatar.webp_lossy_invalid');
    }
    width = buffer.readUInt16LE(26) & 0x3fff;
    height = buffer.readUInt16LE(28) & 0x3fff;
  } else {
    throw new Error('avatar.webp_format_invalid');
  }
  return { extension: 'webp', mimeType: 'image/webp', ...dimensions(width, height) };
}

export function inspectAgentAvatar(buffer: Buffer): AgentAvatarMetadata {
  if (buffer.length === 0 || buffer.length > MAX_AGENT_AVATAR_BYTES) {
    throw new Error('avatar.file_size_invalid');
  }
  const metadata = png(buffer) ?? jpeg(buffer) ?? webp(buffer);
  if (!metadata) throw new Error('avatar.format_unsupported');
  return metadata;
}

export function parseStoredAgentAvatarPath(value: unknown): string {
  if (typeof value !== 'string' || !STORED_AVATAR_PATH.test(value)) {
    throw new Error('avatar.path_invalid');
  }
  return value;
}

export function avatarDataUrl(buffer: Buffer, mimeType: AgentAvatarMetadata['mimeType']): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
