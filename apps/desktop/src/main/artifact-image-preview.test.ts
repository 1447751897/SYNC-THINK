import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ArtifactImagePreviewRegistry,
  MAX_ARTIFACT_IMAGE_PREVIEW_BYTES,
} from './artifact-image-preview.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
const WEBP = Buffer.from('RIFF0000WEBPVP8 ', 'ascii');

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'artifact-image-preview-'));
  const root = join(dir, 'artifacts', 'generated-images');
  await mkdir(root, { recursive: true });
  let tokenIndex = 0;
  const registry = new ArtifactImagePreviewRegistry(root, {
    tokenFactory: () => `preview_token_${String(++tokenIndex).padStart(4, '0')}`,
  });
  return { dir, root, registry };
}

async function source(root: string, name: string, mimeType: string, data: Buffer) {
  const path = join(root, 'ab', 'scope', name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return {
    artifactVersionId: '01K1ARTIFACTVERSION00000001',
    contentRef: path,
    contentHash: createHash('sha256').update(data).digest('hex'),
    mimeType,
  };
}

describe('ArtifactImagePreviewRegistry', () => {
  it.each([
    ['preview.png', 'image/png', PNG],
    ['preview.jpg', 'image/jpeg', JPEG],
    ['preview.webp', 'image/webp', WEBP],
  ])(
    'registers and reads a verified %s without exposing its path',
    async (name, mimeType, data) => {
      const f = await fixture();
      const input = await source(f.root, name, mimeType, data);

      const grant = await f.registry.register(input);
      expect(grant.previewUrl).toMatch(/^sync-think-image:\/\/artifact\/preview_token_/);
      expect(grant.previewUrl).not.toContain(f.dir);
      expect(grant).not.toHaveProperty('contentRef');

      const token = new URL(grant.previewUrl).pathname.slice(1);
      const image = await f.registry.read(token);
      expect(image?.mimeType).toBe(mimeType);
      expect(image?.data).toEqual(data);
    },
  );

  it('rejects hash, MIME magic and extension mismatches', async () => {
    const f = await fixture();
    const valid = await source(f.root, 'preview.png', 'image/png', PNG);
    await expect(f.registry.register({ ...valid, contentHash: '0'.repeat(64) })).rejects.toThrow(
      'artifact_image_preview.hash_mismatch',
    );
    await expect(f.registry.register({ ...valid, mimeType: 'image/jpeg' })).rejects.toThrow(
      'artifact_image_preview.extension_mismatch',
    );
    const fake = await source(f.root, 'fake.png', 'image/png', JPEG);
    await expect(f.registry.register(fake)).rejects.toThrow(
      'artifact_image_preview.magic_mismatch',
    );
  });

  it('rejects paths outside the generated image root, including symlink escapes', async () => {
    const f = await fixture();
    const outside = await source(f.dir, 'outside.png', 'image/png', PNG);
    await expect(f.registry.register(outside)).rejects.toThrow(
      'artifact_image_preview.path_escape',
    );

    const linkedDirectory = join(f.root, 'linked');
    await symlink(dirname(outside.contentRef), linkedDirectory, 'junction');
    const link = join(linkedDirectory, 'outside.png');
    await expect(f.registry.register({ ...outside, contentRef: link })).rejects.toThrow(
      'artifact_image_preview.path_escape',
    );
  });

  it('rejects oversized files before reading them', async () => {
    const f = await fixture();
    const path = join(f.root, 'oversized.png');
    await writeFile(path, Buffer.alloc(MAX_ARTIFACT_IMAGE_PREVIEW_BYTES + 1));
    await expect(
      f.registry.register({
        artifactVersionId: '01K1ARTIFACTVERSION00000001',
        contentRef: path,
        contentHash: '0'.repeat(64),
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('artifact_image_preview.size_invalid');
  });

  it('expires unknown grants, evicts the oldest grant and detects replacement', async () => {
    const f = await fixture();
    let now = 100;
    let tokenIndex = 0;
    const registry = new ArtifactImagePreviewRegistry(f.root, {
      capacity: 1,
      ttlMs: 10,
      now: () => now,
      tokenFactory: () => `bounded_preview_${++tokenIndex}`,
    });
    const first = await source(f.root, 'first.png', 'image/png', PNG);
    const firstGrant = await registry.register(first);
    const firstToken = new URL(firstGrant.previewUrl).pathname.slice(1);
    expect(await registry.read('missing_preview_token')).toBeUndefined();

    const second = await source(
      f.root,
      'second.png',
      'image/png',
      Buffer.concat([PNG, Buffer.from([1])]),
    );
    const secondGrant = await registry.register(second);
    const secondToken = new URL(secondGrant.previewUrl).pathname.slice(1);
    expect(await registry.read(firstToken)).toBeUndefined();

    await writeFile(second.contentRef, Buffer.concat([PNG, Buffer.from([2])]));
    expect(await registry.read(secondToken)).toBeUndefined();

    const third = await source(f.root, 'third.png', 'image/png', PNG);
    const thirdGrant = await registry.register(third);
    now = 111;
    expect(await registry.read(new URL(thirdGrant.previewUrl).pathname.slice(1))).toBeUndefined();
  });
});
