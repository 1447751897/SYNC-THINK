import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { MessageAttachment } from '@sync-think/shared';
import type { ProviderContentPart } from '@sync-think/adapters';

const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_TEXT_FILE_BYTES = 24 * 1024;
const MAX_FOLDER_ENTRIES = 100;

function isTextAttachment(attachment: MessageAttachment): boolean {
  return (
    attachment.mimeType.startsWith('text/') ||
    attachment.mimeType === 'application/json' ||
    attachment.mimeType === 'application/xml'
  );
}

function boundedUtf8(path: string, maxBytes: number): string {
  const bytes = readFileSync(path).subarray(0, maxBytes);
  return bytes.toString('utf8').replace(/\0/g, '').trim();
}

function folderContext(root: string, remainingBytes: number): string {
  const lines: string[] = [];
  let used = 0;
  let entries = 0;
  const visit = (directory: string, depth: number) => {
    if (depth > 4 || entries >= MAX_FOLDER_ENTRIES || used >= remainingBytes) return;
    const children = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) {
      if (entries >= MAX_FOLDER_ENTRIES || used >= remainingBytes) break;
      if (child.isSymbolicLink()) continue;
      const absolute = join(directory, child.name);
      const display = relative(root, absolute).replace(/\\/g, '/');
      const line = child.isDirectory() ? `- ${display}/` : `- ${display}`;
      lines.push(line);
      used += Buffer.byteLength(line, 'utf8') + 1;
      entries += 1;
      if (child.isDirectory()) visit(absolute, depth + 1);
      else if (
        /\.(txt|md|json|ya?ml|xml|csv|tsv|js|jsx|mjs|cjs|ts|tsx|css|html?|py|java|c|h|cpp|hpp|cs|go|rs|sh|ps1|sql|toml)$/i.test(
          child.name,
        )
      ) {
        const excerpt = boundedUtf8(absolute, Math.min(4_096, remainingBytes - used));
        if (excerpt) {
          const block = `\n  Excerpt (${display}):\n${excerpt}\n`;
          lines.push(block);
          used += Buffer.byteLength(block, 'utf8');
        }
      }
    }
  };
  visit(root, 0);
  if (entries >= MAX_FOLDER_ENTRIES) lines.push('- [directory listing truncated]');
  return lines.join('\n');
}

export function prepareMessageAttachmentContext(attachments: readonly MessageAttachment[]): string {
  if (attachments.length === 0) return '';
  const sections = ['[User attachments for this turn]'];
  let used = Buffer.byteLength(sections[0]!, 'utf8');
  for (const attachment of attachments) {
    const resolved = realpathSync(attachment.managedRef);
    const metadata = statSync(resolved);
    if (attachment.kind === 'folder') {
      if (!metadata.isDirectory() || attachment.readOnly !== true) {
        throw new Error(`Invalid read-only folder attachment: ${attachment.name}`);
      }
      const heading = `\nFolder: ${attachment.name}\nRead-only path for this turn: ${resolved}`;
      sections.push(heading);
      used += Buffer.byteLength(heading, 'utf8');
      const listing = folderContext(resolved, Math.max(0, MAX_CONTEXT_BYTES - used));
      if (listing) sections.push(listing);
      used += Buffer.byteLength(listing, 'utf8');
      continue;
    }
    if (!metadata.isFile() || metadata.size !== attachment.size) {
      throw new Error(`Attachment snapshot changed or is unavailable: ${attachment.name}`);
    }
    if (attachment.kind === 'image' && metadata.size > 20 * 1024 * 1024) {
      throw new Error(`Image attachment exceeds 20 MB: ${attachment.name}`);
    }
    if (attachment.kind === 'file' && metadata.size > 50 * 1024 * 1024) {
      throw new Error(`File attachment exceeds 50 MB: ${attachment.name}`);
    }
    if (attachment.sha256) {
      const actual = createHash('sha256').update(readFileSync(resolved)).digest('hex');
      if (actual !== attachment.sha256)
        throw new Error(`Attachment hash mismatch: ${attachment.name}`);
    }
    const heading = `\n${attachment.kind === 'image' ? 'Image' : 'File'}: ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes)`;
    sections.push(heading);
    used += Buffer.byteLength(heading, 'utf8');
    if (isTextAttachment(attachment) && used < MAX_CONTEXT_BYTES) {
      const excerpt = boundedUtf8(
        resolved,
        Math.min(MAX_TEXT_FILE_BYTES, MAX_CONTEXT_BYTES - used),
      );
      if (excerpt) {
        const block = `\nExcerpt:\n${excerpt}`;
        sections.push(block);
        used += Buffer.byteLength(block, 'utf8');
      }
    }
  }
  if (used >= MAX_CONTEXT_BYTES) sections.push('\n[attachment context truncated]');
  return sections.join('\n').slice(0, MAX_CONTEXT_BYTES);
}

export async function loadImageAttachmentParts(
  attachments: readonly MessageAttachment[],
): Promise<ProviderContentPart[]> {
  const parts: ProviderContentPart[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') continue;
    const resolved = await realpath(attachment.managedRef);
    const metadata = await stat(resolved);
    if (
      !metadata.isFile() ||
      metadata.size !== attachment.size ||
      metadata.size > 20 * 1024 * 1024
    ) {
      throw new Error(`Image attachment is unavailable: ${attachment.name}`);
    }
    const bytes = await readFile(resolved);
    if (attachment.sha256) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== attachment.sha256) {
        throw new Error(`Attachment hash mismatch: ${attachment.name}`);
      }
    }
    parts.push({
      type: 'image',
      imageUrl: `data:${attachment.mimeType};base64,${bytes.toString('base64')}`,
      imageRef: attachment.id,
    });
  }
  return parts;
}
