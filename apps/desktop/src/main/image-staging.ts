// Stage chat images on disk so appendMessage can stay under the 1 MiB pipe frame.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM entry (desktop "type": "module") — provide the CommonJS-style location.
const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveChatImageStagingDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (env.SYNC_THINK_CHAT_IMAGE_STAGING) return resolve(env.SYNC_THINK_CHAT_IMAGE_STAGING);
  // MUST stay in sync with runtime-supervisor.defaultDataRoot(): the Runtime
  // reads SYNC_THINK_CHAT_IMAGE_STAGING (join(dataRoot, 'chat-image-staging'))
  // and rejects staged paths outside that root — writing to a different
  // cwd-derived folder silently loses every attachment (imagesMode=failed).
  // __dirname = apps/desktop/dist/main → repo root is ../../../..
  const repoRoot = resolve(join(__dirname, '..', '..', '..', '..'));
  const repoData = join(repoRoot, '.data', 'SYNC-THINK');
  if (existsSync(dirname(repoData)) || existsSync(join(repoRoot, 'apps'))) {
    return join(repoData, 'chat-image-staging');
  }
  // cwd-derived fallback (standalone/dev launches without the repo layout).
  const cwdData = join(process.cwd(), '.data', 'SYNC-THINK');
  if (existsSync(dirname(cwdData))) return join(cwdData, 'chat-image-staging');
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

function safeMaterializedSegment(value: string, fallbackPrefix: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length > 0 &&
    trimmed.length <= 128 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    /^[A-Za-z0-9._-]+$/.test(trimmed)
  ) {
    return trimmed;
  }
  return `${fallbackPrefix}-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`;
}

/**
 * NewMax-compatible send-time materialization. Pasted image bytes live beside
 * the workspace conversation, and the resulting absolute path is what a
 * native multimodal kernel receives.
 */
export function materializeChatImageDataUrl(
  input: { name: string; mimeType?: string; dataUrl: string },
  context: { workspacePath: string; conversationId: string; attachmentId: string },
): { stagingPath: string; mimeType: string; name: string; bytes: number } {
  if (!isAbsolute(context.workspacePath)) throw new Error('Workspace path must be absolute');
  const parsed = parseDataUrl(input.dataUrl);
  if (!parsed || parsed.buffer.length === 0) throw new Error('Invalid image data URL');
  if (parsed.buffer.length > 12_000_000) throw new Error('Image exceeds 12 MB');

  const mimeType =
    input.mimeType && input.mimeType.startsWith('image/')
      ? input.mimeType
      : parsed.mimeType.startsWith('image/')
        ? parsed.mimeType
        : 'image/png';
  const conversationId = safeMaterializedSegment(context.conversationId, 'conversation');
  const attachmentId = safeMaterializedSegment(context.attachmentId, 'attachment');
  const directory = resolve(
    join(context.workspacePath, '.sync-think', 'conversations', conversationId, 'images'),
  );
  mkdirSync(directory, { recursive: true });
  const stagingPath = join(directory, `${attachmentId}.${extForMime(mimeType)}`);
  writeFileSync(stagingPath, parsed.buffer);
  return {
    stagingPath,
    mimeType,
    name: input.name || `image.${extForMime(mimeType)}`,
    bytes: parsed.buffer.length,
  };
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
