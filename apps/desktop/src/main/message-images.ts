// Durable chat-image storage shared by Desktop and Runtime.
// Messages persist only opaque `storageRef` basenames; arbitrary paths are never exposed.
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { resolveChatMessageImageDirectories } from '@sync-think/shared/node-chat-message-images';
import { isPathWithinRoot } from '@sync-think/shared/node-paths';
import { basename, extname, isAbsolute, join, normalize } from 'node:path';

export interface StoredMessageImage {
  id: string;
  name: string;
  mimeType: string;
  storageRef: string;
  stagingPath: string;
}

export function resolveChatMessageImageDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  return resolveChatMessageImageDirectories(env, process.cwd(), homeDirectory)[0]!;
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
  for (const directory of resolveChatMessageImageDirectories()) {
    try {
      const root = realpathSync(directory);
      const absolute = realpathSync(join(root, safeRef));
      if (isPathWithinRoot(root, absolute)) return absolute;
    } catch { /* Try the known legacy directory for pre-fix attachments. */ }
  }
  return undefined;
}

export function readMessageImage(
  storageRef: string,
  maxBytes?: number,
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
  if (maxBytes !== undefined) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 700_000)
      throw new Error('Invalid image read budget');
    const descriptor = openSync(absolute, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      let total = 0;
      while (total < buffer.length) {
        const count = readSync(descriptor, buffer, total, buffer.length - total, total);
        if (count === 0) break;
        total += count;
      }
      if (total > maxBytes) throw new Error('Original image exceeds the read budget');
      return { data: buffer.subarray(0, total), mimeType };
    } finally {
      closeSync(descriptor);
    }
  }
  return { data: readFileSync(absolute), mimeType };
}

export function messageImageUrl(storageRef: string): string | undefined {
  const safeRef = safeStorageRef(storageRef);
  return safeRef ? `sync-think-image://media/${encodeURIComponent(safeRef)}` : undefined;
}
