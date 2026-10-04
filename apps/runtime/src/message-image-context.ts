import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolveChatMessageImageDirectories } from '@sync-think/shared/node-chat-message-images';
import { isPathWithinRoot } from '@sync-think/shared/node-paths';
import { basename, resolve } from 'node:path';

const MAX_CONTEXT_IMAGE_BYTES = 12 * 1024 * 1024;

export function resolveHistoricalMessageImageDataUrl(
  storageRef: string,
  mimeType: string,
  imageDirectory?: string,
): string | undefined {
  if (!mimeType.startsWith('image/')) return undefined;
  if (!storageRef || basename(storageRef) !== storageRef || storageRef.includes('..') || !/^[A-Za-z0-9._-]+$/.test(storageRef)) return undefined;
  const directories = imageDirectory === undefined
    ? resolveChatMessageImageDirectories()
    : imageDirectory ? [resolve(imageDirectory)] : [];
  for (const directory of directories) {
    try {
      const root = realpathSync(directory);
      const file = realpathSync(resolve(root, storageRef));
      if (file === root || !isPathWithinRoot(root, file)) continue;
      const stat = statSync(file);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CONTEXT_IMAGE_BYTES) continue;
      return `data:${mimeType};base64,${readFileSync(file).toString('base64')}`;
    } catch { /* Try the known legacy root, never an arbitrary attachment path. */ }
  }
  return undefined;
}
