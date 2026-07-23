// Stage chat images on disk so appendMessage can stay under the 1 MiB pipe frame.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function resolveChatImageStagingDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (env.SYNC_THINK_CHAT_IMAGE_STAGING) return env.SYNC_THINK_CHAT_IMAGE_STAGING;
  // Prefer monorepo .data when available (dev machines often fill C:).
  const candidates = [
    join(process.cwd(), '.data', 'SYNC-THINK', 'chat-image-staging'),
    join(process.cwd(), '..', '.data', 'SYNC-THINK', 'chat-image-staging'),
    join(process.cwd(), '..', '..', '.data', 'SYNC-THINK', 'chat-image-staging'),
  ];
  for (const candidate of candidates) {
    const root = dirname(dirname(candidate)); // .../.data
    if (existsSync(root) || existsSync(join(dirname(root), 'apps'))) {
      return candidate;
    }
  }
  const dataRoot = env.LOCALAPPDATA ?? join(homeDirectory, '.sync-think');
  return join(dataRoot, 'SYNC-THINK', 'chat-image-staging');
}

function extForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}

function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  try {
    return {
      mimeType: match[1] || 'image/png',
      buffer: Buffer.from(match[2] || '', 'base64'),
    };
  } catch {
    return null;
  }
}

/**
 * Write a renderer data-URL image into the shared staging directory.
 * Returns absolute path + mime so Runtime can read it without oversized frames.
 */
export function stageChatImageDataUrl(input: {
  name: string;
  mimeType?: string;
  dataUrl: string;
}): { stagingPath: string; mimeType: string; name: string; bytes: number } {
  const parsed = parseDataUrl(input.dataUrl);
  if (!parsed || parsed.buffer.length === 0) {
    throw new Error('Invalid image data URL');
  }
  const mimeType =
    input.mimeType && input.mimeType.startsWith('image/')
      ? input.mimeType
      : parsed.mimeType.startsWith('image/')
        ? parsed.mimeType
        : 'image/png';
  const dir = resolveChatImageStagingDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const hash = createHash('sha1').update(parsed.buffer).digest('hex').slice(0, 12);
  const id = `${Date.now()}-${randomBytes(4).toString('hex')}-${hash}`;
  const stagingPath = join(dir, `${id}.${extForMime(mimeType)}`);
  writeFileSync(stagingPath, parsed.buffer);
  return {
    stagingPath,
    mimeType,
    name: input.name || `image.${extForMime(mimeType)}`,
    bytes: parsed.buffer.length,
  };
}
