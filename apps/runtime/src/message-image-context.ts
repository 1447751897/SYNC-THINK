import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const MAX_CONTEXT_IMAGE_BYTES = 12 * 1024 * 1024;

export function resolveHistoricalMessageImageDataUrl(
  storageRef: string,
  mimeType: string,
  imageDirectory = process.env.SYNC_THINK_CHAT_MESSAGE_IMAGES,
): string | undefined {
  if (!imageDirectory || !mimeType.startsWith('image/')) return undefined;
  if (!storageRef || basename(storageRef) !== storageRef || storageRef.includes('..')) return undefined;
  try {
    const root = resolve(imageDirectory);
    const file = resolve(root, storageRef);
    if (file === root || !file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) return undefined;
    const stat = statSync(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CONTEXT_IMAGE_BYTES) return undefined;
    return `data:${mimeType};base64,${readFileSync(file).toString('base64')}`;
  } catch {
    return undefined;
  }
}
