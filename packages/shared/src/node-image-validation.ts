import { extname } from 'node:path';

export type SupportedImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export function parseSupportedImageMimeType(value: string): SupportedImageMimeType | undefined {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value;
  return undefined;
}

export function imageFileExtensionMatchesMime(
  filePath: string,
  mimeType: SupportedImageMimeType,
): boolean {
  const extension = extname(filePath).toLowerCase();
  if (mimeType === 'image/png') return extension === '.png';
  if (mimeType === 'image/jpeg') return extension === '.jpg' || extension === '.jpeg';
  return extension === '.webp';
}

export function detectSupportedImageMimeType(
  bytes: Uint8Array,
): SupportedImageMimeType | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
}

export function imageBytesMatchMime(
  bytes: Uint8Array,
  mimeType: SupportedImageMimeType,
): boolean {
  return detectSupportedImageMimeType(bytes) === mimeType;
}
