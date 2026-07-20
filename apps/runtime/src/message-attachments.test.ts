import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  loadImageAttachmentParts,
  prepareMessageAttachmentContext,
} from './message-attachments.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('runtime message attachment context', () => {
  it('adds bounded text excerpts and read-only folder listings', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-runtime-attachment-'));
    roots.push(root);
    const textPath = join(root, 'brief.md');
    const folder = join(root, 'folder');
    mkdirSync(folder);
    writeFileSync(textPath, '# Brief\nBuild the feature.');
    writeFileSync(join(folder, 'index.ts'), 'export const ready = true;');
    const bytes = Buffer.from('# Brief\nBuild the feature.');
    const context = prepareMessageAttachmentContext([
      {
        id: 'text-1',
        kind: 'file',
        name: 'brief.md',
        mimeType: 'text/markdown',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        managedRef: textPath,
        readOnly: true,
      },
      {
        id: 'folder-1',
        kind: 'folder',
        name: 'folder',
        mimeType: 'inode/directory',
        size: 0,
        managedRef: folder,
        readOnly: true,
      },
    ]);
    expect(context).toContain('Build the feature.');
    expect(context).toContain('index.ts');
    expect(context).toContain('Read-only path for this turn');
  });

  it('loads image bytes only at provider-call time', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-runtime-image-'));
    roots.push(root);
    const imagePath = join(root, 'screen.png');
    writeFileSync(imagePath, Buffer.from([1, 2, 3]));
    const parts = await loadImageAttachmentParts([
      {
        id: 'image-1',
        kind: 'image',
        name: 'screen.png',
        mimeType: 'image/png',
        size: 3,
        managedRef: imagePath,
        readOnly: true,
      },
    ]);
    expect(parts).toEqual([
      { type: 'image', imageRef: 'image-1', imageUrl: 'data:image/png;base64,AQID' },
    ]);
  });

  it('rejects a historical image whose immutable snapshot hash changed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-runtime-image-hash-'));
    roots.push(root);
    const imagePath = join(root, 'screen.png');
    writeFileSync(imagePath, Buffer.from([1, 2, 3]));

    await expect(
      loadImageAttachmentParts([
        {
          id: 'image-hash',
          kind: 'image',
          name: 'screen.png',
          mimeType: 'image/png',
          size: 3,
          sha256: createHash('sha256').update(Buffer.from([9, 9, 9])).digest('hex'),
          managedRef: imagePath,
          readOnly: true,
        },
      ]),
    ).rejects.toThrow('hash mismatch');
  });
});
