import { open, realpath } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { isPathWithinRoot } from '@sync-think/shared/node-paths';
import { detectSupportedImageMimeType, imageFileExtensionMatchesMime } from '@sync-think/shared/node-image-validation';

export const MAX_PROJECT_IMAGE_BYTES = 12 * 1024 * 1024;
export interface ProjectImagePreviewRequest { root: string; path: string }
export interface ProjectImagePreviewResult { dataUrl?: string; error?: string }

/** Local read-image tools get raster bytes, never a general-purpose file:// grant. */
export async function readProjectImage(value: unknown): Promise<ProjectImagePreviewResult> {
  if (!value || typeof value !== 'object') return { error: 'invalid_request' };
  const input = value as Partial<ProjectImagePreviewRequest>;
  if (typeof input.root !== 'string' || !input.root.trim() || typeof input.path !== 'string' || !input.path.trim()) return { error: 'invalid_request' };
  try {
    const root = await realpath(resolve(input.root));
    const target = await realpath(resolve(root, input.path));
    if (!isPathWithinRoot(root, target)) return { error: 'outside_workspace' };
    if (!/\.(png|jpe?g|webp|gif)$/i.test(target)) return { error: 'unsupported_image' };
    const file = await open(target, 'r');
    try {
      const info = await file.stat();
      if (!info.isFile()) return { error: 'unsupported_image' };
      if (info.size > MAX_PROJECT_IMAGE_BYTES) return { error: 'image_too_large' };
      // Read one extra byte so a growing file never exceeds the transport budget.
      const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_PROJECT_IMAGE_BYTES + 1));
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_PROJECT_IMAGE_BYTES || length > info.size) return { error: 'image_changed' };
      const bytes = buffer.subarray(0, length);
      const supported = detectSupportedImageMimeType(bytes);
      const gif = bytes.subarray(0, 6).toString('ascii');
      const mime = supported ?? (extname(target).toLowerCase() === '.gif' && (gif === 'GIF87a' || gif === 'GIF89a') ? 'image/gif' : undefined);
      if (!mime || (supported && !imageFileExtensionMatchesMime(target, supported))) return { error: 'unsupported_image' };
      return { dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64') };
    } finally { await file.close(); }
  } catch { return { error: 'image_not_found' }; }
}
