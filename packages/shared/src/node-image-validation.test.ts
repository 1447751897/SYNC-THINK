import { describe, expect, it } from 'vitest';
import {
  detectSupportedImageMimeType,
  imageBytesMatchMime,
  imageFileExtensionMatchesMime,
  parseSupportedImageMimeType,
} from './node-image-validation.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('node image validation', () => {
  it('parses only the supported image MIME types', () => {
    expect(parseSupportedImageMimeType('image/png')).toBe('image/png');
    expect(parseSupportedImageMimeType('image/jpeg')).toBe('image/jpeg');
    expect(parseSupportedImageMimeType('image/webp')).toBe('image/webp');
    expect(parseSupportedImageMimeType('image/gif')).toBeUndefined();
    expect(parseSupportedImageMimeType('IMAGE/PNG')).toBeUndefined();
  });

  it('matches the supported filename extensions case-insensitively', () => {
    expect(imageFileExtensionMatchesMime('C:\\images\\preview.PNG', 'image/png')).toBe(true);
    expect(imageFileExtensionMatchesMime('/images/preview.jpg', 'image/jpeg')).toBe(true);
    expect(imageFileExtensionMatchesMime('/images/preview.jpeg', 'image/jpeg')).toBe(true);
    expect(imageFileExtensionMatchesMime('/images/preview.webp', 'image/webp')).toBe(true);
    expect(imageFileExtensionMatchesMime('/images/preview.png', 'image/jpeg')).toBe(false);
  });

  it('detects PNG, JPEG, and WebP signatures without requiring Buffer', () => {
    expect(detectSupportedImageMimeType(PNG)).toBe('image/png');
    expect(detectSupportedImageMimeType(JPEG)).toBe('image/jpeg');
    expect(detectSupportedImageMimeType(WEBP)).toBe('image/webp');
    expect(detectSupportedImageMimeType(new Uint8Array([0x52, 0x49, 0x46]))).toBeUndefined();
  });

  it('checks that the detected signature agrees with the declared MIME type', () => {
    expect(imageBytesMatchMime(PNG, 'image/png')).toBe(true);
    expect(imageBytesMatchMime(PNG, 'image/jpeg')).toBe(false);
  });
});
