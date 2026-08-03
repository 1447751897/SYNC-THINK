import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GeneratedImageStore } from './generated-image-store.js';

const roots: string[] = [];
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.from([1, 2, 3, 4]),
]);

async function createStore() {
  const root = await mkdtemp(`${tmpdir()}\\sync-think-images-`);
  roots.push(root);
  return { root, store: new GeneratedImageStore(root) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('GeneratedImageStore', () => {
  it('writes image bytes under the controlled root with a stable hash path', async () => {
    const { root, store } = await createStore();

    const [stored] = await store.store({
      runId: 'run-1',
      stepId: 'step-1',
      idempotencyKey: 'run-1:step-1:1',
      images: [{ bytes: PNG, mimeType: 'image/png', revisedPrompt: 'lake' }],
    });

    expect(stored).toMatchObject({
      contentHash: createHash('sha256').update(PNG).digest('hex'),
      mimeType: 'image/png',
      byteLength: PNG.length,
      revisedPrompt: 'lake',
    });
    expect(isAbsolute(stored!.contentRef)).toBe(true);
    expect(relative(root, stored!.contentRef)).not.toMatch(/^\.\./);
    expect(await readFile(stored!.contentRef)).toEqual(PNG);
  });

  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/webp', WEBP],
  ] as const)(
    'verifies and materializes %s as an in-memory vision data URL',
    async (mimeType, bytes) => {
      const { store } = await createStore();
      const [stored] = await store.store({
        runId: 'run-vision',
        stepId: 'step-vision',
        idempotencyKey: `vision-${mimeType}`,
        images: [{ bytes, mimeType }],
      });

      const image = await store.readForVision({
        artifactVersionId: 'artifact-version-vision',
        contentRef: stored!.contentRef,
        contentHash: stored!.contentHash,
        mimeType,
      });

      expect(image.bytes).toEqual(bytes);
      expect(image.dataUrl).toBe(`data:${mimeType};base64,${bytes.toString('base64')}`);
      expect(image.byteLength).toBe(bytes.length);
    },
  );

  it('rejects path escape, hash mismatch, extension mismatch, and magic mismatch', async () => {
    const { root, store } = await createStore();
    const outside = await mkdtemp(join(tmpdir(), 'sync-think-images-outside-'));
    roots.push(outside);
    const outsidePath = join(outside, 'outside.png');
    await writeFile(outsidePath, PNG);
    const hash = createHash('sha256').update(PNG).digest('hex');

    await expect(
      store.readForVision({
        artifactVersionId: 'outside-version',
        contentRef: outsidePath,
        contentHash: hash,
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/path_escape/);

    const [stored] = await store.store({
      runId: 'run-vision-invalid',
      stepId: 'step-vision-invalid',
      idempotencyKey: 'vision-invalid',
      images: [{ bytes: PNG, mimeType: 'image/png' }],
    });
    await expect(
      store.readForVision({
        artifactVersionId: 'hash-mismatch',
        contentRef: stored!.contentRef,
        contentHash: '0'.repeat(64),
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/hash_mismatch/);
    await expect(
      store.readForVision({
        artifactVersionId: 'extension-mismatch',
        contentRef: stored!.contentRef,
        contentHash: stored!.contentHash,
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow(/extension_mismatch/);

    await writeFile(stored!.contentRef, Buffer.from('not a png'));
    await expect(
      store.readForVision({
        artifactVersionId: 'magic-mismatch',
        contentRef: stored!.contentRef,
        contentHash: createHash('sha256').update('not a png').digest('hex'),
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/magic_mismatch/);

    const outsideDirectory = join(outside, 'linked');
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, 'linked.png'), PNG);
    const junction = join(root, 'junction');
    await symlink(outsideDirectory, junction, 'junction');
    await expect(
      store.readForVision({
        artifactVersionId: 'junction-escape',
        contentRef: join(junction, 'linked.png'),
        contentHash: hash,
        mimeType: 'image/png',
      }),
    ).rejects.toThrow(/path_escape/);
  });

  it('rejects a generated image that is replaced after persistence', async () => {
    const { store } = await createStore();
    const [stored] = await store.store({
      runId: 'run-replaced',
      stepId: 'step-replaced',
      idempotencyKey: 'replaced',
      images: [{ bytes: PNG, mimeType: 'image/png' }],
    });
    await writeFile(stored!.contentRef, Buffer.from([...PNG, 99]));

    await expect(
      store.readForVision({
        artifactVersionId: 'replaced-version',
        contentRef: stored!.contentRef,
        contentHash: stored!.contentHash,
        mimeType: stored!.mimeType,
      }),
    ).rejects.toThrow(/hash_mismatch/);
  });

  it('reuses the same file for idempotent writes', async () => {
    const { store } = await createStore();
    const input = {
      runId: 'run-1',
      stepId: 'step-1',
      idempotencyKey: 'stable-key',
      images: [{ bytes: PNG, mimeType: 'image/png' as const }],
    };

    const first = await store.store(input);
    const second = await store.store(input);

    expect(second).toEqual(first);
  });

  it('uses hashed scope directories instead of user-controlled identifiers', async () => {
    const { root, store } = await createStore();
    const [stored] = await store.store({
      runId: '../../run',
      stepId: '..\\step',
      idempotencyKey: 'key/with/slashes',
      images: [{ bytes: PNG, mimeType: 'image/png' }],
    });

    expect(relative(root, stored!.contentRef)).not.toContain('..');
    expect(stored!.contentRef).not.toContain('run');
  });

  it('rejects empty, excessive, and invalid image inputs before writing', async () => {
    const { store } = await createStore();
    const base = { runId: 'run', stepId: 'step', idempotencyKey: 'key' };

    await expect(store.store({ ...base, images: [] })).rejects.toThrow(/count_invalid/);
    await expect(
      store.store({
        ...base,
        images: Array.from({ length: 5 }, () => ({ bytes: PNG, mimeType: 'image/png' as const })),
      }),
    ).rejects.toThrow(/count_invalid/);
    await expect(
      store.store({ ...base, images: [{ bytes: new Uint8Array(), mimeType: 'image/png' }] }),
    ).rejects.toThrow(/bytes_invalid/);
  });

  it('detects an existing file whose bytes no longer match its hash name', async () => {
    const { store } = await createStore();
    const input = {
      runId: 'run',
      stepId: 'step',
      idempotencyKey: 'key',
      images: [{ bytes: PNG, mimeType: 'image/png' as const }],
    };
    const [stored] = await store.store(input);
    await writeFile(stored!.contentRef, Buffer.from('tampered'));

    await expect(store.store(input)).rejects.toThrow(/hash_conflict/);
  });
});
