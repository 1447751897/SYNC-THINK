import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { CollaborationCommand } from '@sync-think/shared';
import { resolveAppendMessageImageDataUrl } from './chat-image-staging.js';

type Send = Extract<CollaborationCommand, { action: 'send' }>;
function directory(root: string, conversationId: string, kind: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(conversationId) || conversationId === '.' || conversationId === '..') throw new Error('collaboration.attachment_conversation_invalid');
  let current = realpathSync.native(root);
  for (const part of ['.sync-think', 'conversations', conversationId, kind]) {
    current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('collaboration.attachment_directory_alias');
    mkdirSync(current, { recursive: true });
  }
  return current;
}
function persist(root: string, conversationId: string, kind: string, bytes: Buffer, suffix: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const target = resolve(directory(root, conversationId, kind), hash + suffix);
  try { writeFileSync(target, bytes, { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (lstatSync(target).isSymbolicLink() || createHash('sha256').update(readFileSync(target)).digest('hex') !== hash) throw new Error('collaboration.attachment_modified'); }
  return target;
}
/** User-scoped ingestion: imports selected local files into the actual bound project before dispatch. */
export function prepareCollaborationAttachments(command: Send, workspaceRoot: string | undefined): Send {
  if (!command.files?.length && !command.images?.length) return command;
  if (!workspaceRoot) throw new Error('collaboration.attachment_workspace_required');
  const root = realpathSync.native(workspaceRoot);
  let total = 0;
  const files = command.files?.map(file => {
    const source = realpathSync.native(resolve(root, file.path));
    const info = statSync(source);
    const rel = relative(root, source);
    const inside = rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
    if (file.kind === 'dir') {
      if (!inside || !info.isDirectory()) throw new Error('collaboration.attachment_directory_outside_workspace');
      return { ...file, path: rel.replace(/\\/g, '/'), kind: 'dir' as const };
    }
    if (!info.isFile() || info.size > 50 * 1024 * 1024) throw new Error('collaboration.attachment_file_size');
    total += info.size;
    if (total > 100 * 1024 * 1024) throw new Error('collaboration.attachment_total_size');
    const extension = extname(basename(source));
    const suffix = /^\.[a-z0-9]{1,12}$/i.test(extension) ? extension : '.bin';
    const target = inside ? source : persist(root, command.conversationId, 'files', readFileSync(source), suffix);
    return { ...file, sourcePath: file.path, kind: 'file' as const, path: relative(root, target).replace(/\\/g, '/'), sizeBytes: info.size };
  });
  const images = command.images?.map(image => {
    const dataUrl = resolveAppendMessageImageDataUrl(image, { workspaceRoot: root, conversationId: command.conversationId });
    if (!dataUrl) throw new Error('collaboration.attachment_image_unreadable');
    const comma = dataUrl.indexOf(',');
    const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    if (!bytes.length || bytes.length > 12_000_000) throw new Error('collaboration.attachment_image_size');
    const extension = image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.split('/')[1];
    const stagingPath = persist(root, command.conversationId, 'images', bytes, '.' + extension);
    return { id: image.id, name: image.name, mimeType: image.mimeType, stagingPath };
  });
  return { ...command, files, images, attachmentContext: undefined };
}
