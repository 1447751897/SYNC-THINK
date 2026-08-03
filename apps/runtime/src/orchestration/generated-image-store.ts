import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ProviderGeneratedImage } from '@sync-think/adapters';

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export interface StoredGeneratedImage {
  contentRef: string;
  contentHash: string;
  mimeType: ProviderGeneratedImage['mimeType'];
  byteLength: number;
  revisedPrompt?: string;
}

export interface StoreGeneratedImagesInput {
  runId: string;
  stepId: string;
  idempotencyKey: string;
  images: readonly ProviderGeneratedImage[];
}

export interface ReadGeneratedImageForVisionInput {
  artifactVersionId: string;
  contentRef?: string;
  contentHash?: string;
  mimeType: string;
}

export interface GeneratedImageVisionInput {
  bytes: Buffer;
  dataUrl: string;
  contentHash: string;
  mimeType: ProviderGeneratedImage['mimeType'];
  byteLength: number;
}

/** Materializes provider image bytes under one Runtime-owned artifact root. */
export class GeneratedImageStore {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error('generated_image.root_invalid');
    const normalized = resolve(root);
    if (!isAbsolute(normalized)) throw new Error('generated_image.root_invalid');
    this.root = normalized;
  }

  async store(input: StoreGeneratedImagesInput): Promise<StoredGeneratedImage[]> {
    validateScope(input);
    if (input.images.length < 1 || input.images.length > MAX_IMAGES) {
      throw new Error('generated_image.count_invalid');
    }
    let totalBytes = 0;
    for (const image of input.images) {
      if (!(image.bytes instanceof Uint8Array) || image.bytes.byteLength < 1) {
        throw new Error('generated_image.bytes_invalid');
      }
      if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new Error('generated_image.image_too_large');
      }
      totalBytes += image.bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('generated_image.total_too_large');
    }

    const scope = createHash('sha256')
      .update(`${input.runId}\0${input.stepId}\0${input.idempotencyKey}`, 'utf8')
      .digest('hex');
    const directory = this.assertContained(join(this.root, scope.slice(0, 2), scope));
    await mkdir(directory, { recursive: true });

    const stored: StoredGeneratedImage[] = [];
    for (const image of input.images) {
      const bytes = Buffer.from(image.bytes);
      const contentHash = createHash('sha256').update(bytes).digest('hex');
      const finalPath = this.assertContained(
        join(directory, `${contentHash}.${extensionFor(image.mimeType)}`),
      );
      await this.writeAtomically(finalPath, bytes, contentHash);
      stored.push({
        contentRef: finalPath,
        contentHash,
        mimeType: image.mimeType,
        byteLength: bytes.byteLength,
        ...(image.revisedPrompt ? { revisedPrompt: image.revisedPrompt } : {}),
      });
    }
    return stored;
  }

  /** Reads one generated image for an in-memory Provider vision request. */
  async readForVision(input: ReadGeneratedImageForVisionInput): Promise<GeneratedImageVisionInput> {
    if (!input.artifactVersionId || input.artifactVersionId.length > 256) {
      throw new Error('generated_image.version_invalid');
    }
    if (!input.contentRef || !isAbsolute(input.contentRef)) {
      throw new Error('generated_image.path_invalid');
    }
    const mimeType = allowedMimeType(input.mimeType);
    if (!input.contentHash || !/^[a-f0-9]{64}$/i.test(input.contentHash)) {
      throw new Error('generated_image.hash_invalid');
    }

    const [rootPath, candidatePath] = await Promise.all([
      realpath(this.root),
      realpath(input.contentRef),
    ]);
    assertRealPathContained(rootPath, candidatePath);
    if (!extensionMatchesMime(candidatePath, mimeType)) {
      throw new Error('generated_image.extension_mismatch');
    }

    const info = await stat(candidatePath);
    if (!info.isFile()) throw new Error('generated_image.not_file');
    if (info.size < 1 || info.size > MAX_IMAGE_BYTES) {
      throw new Error('generated_image.size_invalid');
    }

    const bytes = await readFile(candidatePath);
    const finalCandidatePath = await realpath(input.contentRef);
    assertRealPathContained(rootPath, finalCandidatePath);
    if (finalCandidatePath !== candidatePath || bytes.byteLength !== info.size) {
      throw new Error('generated_image.source_changed');
    }
    if (!magicMatchesMime(bytes, mimeType)) {
      throw new Error('generated_image.magic_mismatch');
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    if (contentHash !== input.contentHash.toLowerCase()) {
      throw new Error('generated_image.hash_mismatch');
    }
    return {
      bytes,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      contentHash,
      mimeType,
      byteLength: bytes.byteLength,
    };
  }

  private async writeAtomically(
    finalPath: string,
    bytes: Buffer,
    expectedHash: string,
  ): Promise<void> {
    try {
      const existing = await readFile(finalPath);
      const existingHash = createHash('sha256').update(existing).digest('hex');
      if (existingHash !== expectedHash) throw new Error('generated_image.hash_conflict');
      return;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    const tempPath = this.assertContained(`${finalPath}.${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, bytes, { flag: 'wx' });
      await rename(tempPath, finalPath);
      const written = await stat(finalPath);
      if (written.size !== bytes.byteLength) throw new Error('generated_image.write_incomplete');
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private assertContained(candidate: string): string {
    const normalized = resolve(candidate);
    const rel = relative(this.root, normalized);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('generated_image.path_escape');
    return normalized;
  }
}

function validateScope(input: StoreGeneratedImagesInput): void {
  for (const value of [input.runId, input.stepId, input.idempotencyKey]) {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > 512 ||
      /[\r\n\0]/.test(value)
    ) {
      throw new Error('generated_image.scope_invalid');
    }
  }
}

function extensionFor(mimeType: ProviderGeneratedImage['mimeType']): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  throw new Error('generated_image.mime_invalid');
}

function allowedMimeType(value: string): ProviderGeneratedImage['mimeType'] {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value;
  throw new Error('generated_image.mime_invalid');
}

function extensionMatchesMime(path: string, mimeType: ProviderGeneratedImage['mimeType']): boolean {
  const extension = extname(path).toLowerCase();
  if (mimeType === 'image/png') return extension === '.png';
  if (mimeType === 'image/jpeg') return extension === '.jpg' || extension === '.jpeg';
  return extension === '.webp';
}

function magicMatchesMime(data: Buffer, mimeType: ProviderGeneratedImage['mimeType']): boolean {
  if (mimeType === 'image/png') {
    return (
      data.byteLength >= 8 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  }
  if (mimeType === 'image/jpeg') {
    return data.byteLength >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  return (
    data.byteLength >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function assertRealPathContained(rootPath: string, candidatePath: string): void {
  const rel = relative(rootPath, candidatePath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('generated_image.path_escape');
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT',
  );
}
