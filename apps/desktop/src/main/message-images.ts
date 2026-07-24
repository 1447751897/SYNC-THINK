// Durable chat-image storage shared by Desktop and Runtime.
// Messages persist only opaque `storageRef` basenames; arbitrary paths are never exposed.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface StoredMessageImage {
  id: string;
  name: string;
  mimeType: string;
  storageRef: string;
  stagingPath: string;
}

function dataRoot(env: NodeJS.ProcessEnv = process.env, homeDirectory: string = homedir()): string {
  if (env.SYNC_THINK_DB_PATH) return resolve(join(env.SYNC_THINK_DB_PATH, '..'));
  const candidates = [
    resolve(join(process.cwd(), '.data', 'SYNC-THINK')),
    resolve(join(process.cwd(), '..', '.data', 'SYNC-THINK')),
    resolve(join(process.cwd(), '..', '..', '.data', 'SYNC-THINK')),
  ];
  return (
    candidates.find((candidate) => existsSync(join(candidate, '..'))) ??
    resolve(join(env.LOCALAPPDATA ?? homeDirectory, 'SYNC-THINK'))
  );
}

export function resolveChatMessageImageDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (env.SYNC_THINK_CHAT_MESSAGE_IMAGES) return resolve(env.SYNC_THINK_CHAT_MESSAGE_IMAGES);
  return resolve(join(dataRoot(env, homeDirectory), 'message-images'));
}

function safeStorageRef(storageRef: string): string | undefined {
  if (!storageRef || isAbsolute(storageRef)) return undefined;
  const normalized = normalize(storageRef);
  if (normalized !== basename(normalized) || normalized.includes('..')) return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) return undefined;
  return normalized;
}

function safeExtension(stagingPath: string): string {
  const extension = extname(stagingPath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension) ? extension : '.jpg';
}

export function persistMessageImages(
  messageId: string,
  images: readonly { name?: string; mimeType?: string; stagingPath?: string }[],
): StoredMessageImage[] {
  const directory = resolveChatMessageImageDir();
  mkdirSync(directory, { recursive: true });

  const stored: StoredMessageImage[] = [];
  images.forEach((image, index) => {
    if (!image.stagingPath || !existsSync(image.stagingPath)) return;
    const id = `${messageId}-${index + 1}`;
    const storageRef = `${id}${safeExtension(image.stagingPath)}`;
    const destination = join(directory, storageRef);
    copyFileSync(image.stagingPath, destination);
    stored.push({
      id,
      name: image.name || `image-${index + 1}`,
      mimeType: image.mimeType || 'image/jpeg',
      storageRef,
      stagingPath: destination,
    });
  });
  return stored;
}

export function resolveMessageImagePath(storageRef: string): string | undefined {
  const safeRef = safeStorageRef(storageRef);
  if (!safeRef) return undefined;
  const absolute = resolve(join(resolveChatMessageImageDir(), safeRef));
  return existsSync(absolute) ? absolute : undefined;
}

export function readMessageImage(
  storageRef: string,
): { data: Buffer; mimeType: string } | undefined {
  const absolute = resolveMessageImagePath(storageRef);
  if (!absolute) return undefined;
  const extension = extname(absolute).toLowerCase();
  const mimeType =
    extension === '.png'
      ? 'image/png'
      : extension === '.webp'
        ? 'image/webp'
        : extension === '.gif'
          ? 'image/gif'
          : 'image/jpeg';
  return { data: readFileSync(absolute), mimeType };
}

export function messageImageUrl(storageRef: string): string | undefined {
  const safeRef = safeStorageRef(storageRef);
  return safeRef ? `sync-think-image://media/${encodeURIComponent(safeRef)}` : undefined;
}

export function messageImageFileUrl(storageRef: string): string | undefined {
  const absolute = resolveMessageImagePath(storageRef);
  return absolute ? pathToFileURL(absolute).href : undefined;
}
