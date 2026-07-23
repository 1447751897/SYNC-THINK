// Read Desktop-staged chat images for multimodal provider calls.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, resolve } from 'node:path';

export function resolveChatImageStagingDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (env.SYNC_THINK_CHAT_IMAGE_STAGING) return resolve(env.SYNC_THINK_CHAT_IMAGE_STAGING);
  // Prefer monorepo .data when available so C: disk-full does not break vision turns.
  const monorepo = resolve(join(process.cwd(), '.data', 'SYNC-THINK', 'chat-image-staging'));
  const monorepoFromRuntime = resolve(
    join(process.cwd(), '..', '..', '.data', 'SYNC-THINK', 'chat-image-staging'),
  );
  if (existsSync(resolve(join(process.cwd(), '.data')))) return monorepo;
  if (existsSync(resolve(join(process.cwd(), '..', '..', '.data')))) return monorepoFromRuntime;
  const dataRoot = env.LOCALAPPDATA ?? join(homeDirectory, '.sync-think');
  return resolve(join(dataRoot, 'SYNC-THINK', 'chat-image-staging'));
}

function isPathInside(parent: string, child: string): boolean {
  const root = normalize(resolve(parent)).replace(/[\\/]+$/, '').toLowerCase();
  const target = normalize(resolve(child)).toLowerCase();
  if (target === root) return true;
  const prefix = root + (root.includes('\\') ? '\\' : '/');
  // Also accept the opposite separator after normalize on Windows.
  const altPrefix = root + (root.includes('\\') ? '/' : '\\');
  return target.startsWith(prefix) || target.startsWith(altPrefix);
}

/**
 * Convert a staged absolute path into a data URL for Provider adapters.
 * Rejects paths outside the staging directory.
 */
export function readStagedImageAsDataUrl(stagingPath: string): string | undefined {
  if (!stagingPath || typeof stagingPath !== 'string') return undefined;
  const stagingRoot = resolveChatImageStagingDir();
  const absolute = resolve(stagingPath);
  if (!isPathInside(stagingRoot, absolute)) {
    console.warn('[runtime] rejected image path outside staging dir', absolute);
    return undefined;
  }
  if (!existsSync(absolute)) {
    console.warn('[runtime] staged image missing', absolute);
    return undefined;
  }
  try {
    const buf = readFileSync(absolute);
    if (buf.length === 0 || buf.length > 12_000_000) return undefined;
    const lower = absolute.toLowerCase();
    const mime = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (error) {
    console.warn('[runtime] failed to read staged image', error);
    return undefined;
  }
}

export function resolveAppendMessageImageDataUrl(image: {
  dataUrl?: string;
  stagingPath?: string;
  mimeType?: string;
}): string | undefined {
  if (typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:image/')) {
    return image.dataUrl;
  }
  if (typeof image.stagingPath === 'string' && image.stagingPath.length > 0) {
    return readStagedImageAsDataUrl(image.stagingPath);
  }
  return undefined;
}
