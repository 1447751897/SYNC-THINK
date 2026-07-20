import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { MessageAttachment, MessageAttachmentKind } from '@sync-think/shared';

export interface StagedMessageAttachment extends MessageAttachment {
  previewUrl?: string;
}

export interface MessageAttachmentBufferInput {
  name: string;
  mimeType?: string;
  bytes: Uint8Array;
}

export interface MessageAttachmentPreviewInput {
  managedRef: string;
  mimeType: string;
  sha256?: string;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_MESSAGE_ATTACHMENTS = 10;

/** Read one persisted image without allowing the renderer to choose an arbitrary path. */
export async function loadMessageAttachmentPreview(
  input: MessageAttachmentPreviewInput,
  attachmentRoot: string,
): Promise<string> {
  if (!input.mimeType.startsWith('image/')) throw new Error('仅支持预览图片附件');
  const root = resolve(attachmentRoot);
  const candidate = resolve(input.managedRef);
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('附件路径无效');
  }
  const bytes = await readFile(candidate);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('图片超过预览限制');
  if (input.sha256 && createHash('sha256').update(bytes).digest('hex') !== input.sha256) {
    throw new Error('图片附件已发生变化，请重新上传');
  }
  return `data:${input.mimeType};base64,${bytes.toString('base64')}`;
}

/** Treat stale historical snapshots as unavailable without surfacing an IPC handler error. */
export async function loadMessageAttachmentPreviewOrNull(
  input: MessageAttachmentPreviewInput,
  attachmentRoot: string,
): Promise<string | null> {
  try {
    return await loadMessageAttachmentPreview(input, attachmentRoot);
  } catch {
    return null;
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.py': 'text/x-python',
  '.java': 'text/x-java-source',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.sh': 'text/x-shellscript',
  '.ps1': 'text/x-powershell',
  '.sql': 'text/x-sql',
  '.toml': 'text/x-toml',
};

function attachmentKind(mimeType: string): MessageAttachmentKind {
  return mimeType.startsWith('image/') ? 'image' : 'file';
}

async function copyImmutable(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

export async function stageMessageAttachments(
  sourcePaths: readonly string[],
  attachmentRoot: string,
): Promise<StagedMessageAttachment[]> {
  if (sourcePaths.length > MAX_MESSAGE_ATTACHMENTS) {
    throw new Error(`一次最多添加 ${MAX_MESSAGE_ATTACHMENTS} 个附件`);
  }
  await mkdir(attachmentRoot, { recursive: true });
  const staged: StagedMessageAttachment[] = [];
  for (const sourcePath of sourcePaths) {
    const resolved = await realpath(sourcePath);
    const metadata = await stat(resolved);
    if (metadata.isDirectory()) {
      staged.push({
        id: randomUUID(),
        kind: 'folder',
        name: basename(resolved),
        mimeType: 'inode/directory',
        size: 0,
        managedRef: resolved,
        readOnly: true,
      });
      continue;
    }
    if (!metadata.isFile()) throw new Error(`不支持的附件类型：${basename(resolved)}`);
    const extension = extname(resolved).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!mimeType) throw new Error(`不支持的附件格式：${extension || basename(resolved)}`);
    const kind = attachmentKind(mimeType);
    const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (metadata.size > limit) {
      throw new Error(`${basename(resolved)} 超过 ${kind === 'image' ? '20 MB' : '50 MB'} 限制`);
    }
    const bytes = await readFile(resolved);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const targetPath = join(attachmentRoot, `${sha256}${extension}`);
    await copyImmutable(resolved, targetPath);
    staged.push({
      id: randomUUID(),
      kind,
      name: basename(resolved),
      mimeType,
      size: metadata.size,
      sha256,
      managedRef: targetPath,
      readOnly: true,
      ...(kind === 'image'
        ? { previewUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
        : {}),
    });
  }
  return staged;
}

export async function stageMessageAttachmentBuffers(
  inputs: readonly MessageAttachmentBufferInput[],
  attachmentRoot: string,
): Promise<StagedMessageAttachment[]> {
  if (inputs.length > MAX_MESSAGE_ATTACHMENTS) {
    throw new Error(`一次最多添加 ${MAX_MESSAGE_ATTACHMENTS} 个附件`);
  }
  await mkdir(attachmentRoot, { recursive: true });
  const staged: StagedMessageAttachment[] = [];
  for (const input of inputs) {
    const name = basename(input.name);
    const extension = extname(name).toLowerCase();
    const mimeType = MIME_BY_EXTENSION[extension];
    if (!name || !mimeType) throw new Error(`不支持的附件格式：${extension || name}`);
    const bytes = Buffer.from(input.bytes);
    const kind = attachmentKind(mimeType);
    const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (bytes.byteLength > limit) {
      throw new Error(`${name} 超过 ${kind === 'image' ? '20 MB' : '50 MB'} 限制`);
    }
    if (input.mimeType && input.mimeType !== mimeType && !mimeType.startsWith('text/')) {
      throw new Error(`附件类型与扩展名不匹配：${name}`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const targetPath = join(attachmentRoot, `${sha256}${extension}`);
    try {
      await writeFile(targetPath, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    staged.push({
      id: randomUUID(),
      kind,
      name,
      mimeType,
      size: bytes.byteLength,
      sha256,
      managedRef: targetPath,
      readOnly: true,
      ...(kind === 'image'
        ? { previewUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
        : {}),
    });
  }
  return staged;
}
