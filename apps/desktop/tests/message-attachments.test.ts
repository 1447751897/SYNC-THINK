import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadMessageAttachmentPreviewOrNull,
  stageMessageAttachmentBuffers,
  stageMessageAttachments,
} from '../src/main/message-attachments.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('message attachment snapshots', () => {
  it('copies files immutably and returns image previews without embedding bytes in managedRef', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-attachment-'));
    roots.push(root);
    const source = join(root, 'note.txt');
    const image = join(root, 'screen.png');
    await writeFile(source, 'attachment body');
    await writeFile(image, Buffer.from([1, 2, 3, 4]));

    const staged = await stageMessageAttachments([source, image], join(root, 'managed'));
    expect(staged).toHaveLength(2);
    expect(staged[0]).toMatchObject({ kind: 'file', name: 'note.txt', readOnly: true });
    expect(staged[0]!.managedRef).not.toBe(source);
    expect(await readFile(staged[0]!.managedRef, 'utf8')).toBe('attachment body');
    expect(staged[1]).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(staged[1]!.previewUrl).toBe('data:image/png;base64,AQIDBA==');
  });

  it('keeps a selected folder as an explicit one-turn read-only reference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-folder-'));
    roots.push(root);
    const folder = join(root, 'workspace');
    await mkdir(folder);
    const [staged] = await stageMessageAttachments([folder], join(root, 'managed'));
    expect(staged).toMatchObject({
      kind: 'folder',
      name: 'workspace',
      mimeType: 'inode/directory',
      readOnly: true,
    });
  });

  it('rejects unsupported file types', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-reject-'));
    roots.push(root);
    const source = join(root, 'payload.exe');
    await writeFile(source, 'no');
    await expect(stageMessageAttachments([source], join(root, 'managed'))).rejects.toThrow(
      '不支持的附件格式',
    );
  });

  it('stages clipboard images that do not expose a filesystem path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-clipboard-'));
    roots.push(root);
    const [staged] = await stageMessageAttachmentBuffers(
      [{ name: 'clipboard.png', mimeType: 'image/png', bytes: new Uint8Array([4, 5, 6]) }],
      join(root, 'managed'),
    );
    expect(staged).toMatchObject({
      kind: 'image',
      name: 'clipboard.png',
      previewUrl: 'data:image/png;base64,BAUG',
    });
  });

  it('treats a stale historical image path as unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-stale-attachment-'));
    roots.push(root);

    await expect(
      loadMessageAttachmentPreviewOrNull(
        {
          managedRef: join(root, '..', 'old-user-data', 'missing.png'),
          mimeType: 'image/png',
        },
        join(root, 'managed'),
      ),
    ).resolves.toBeNull();
  });
});
