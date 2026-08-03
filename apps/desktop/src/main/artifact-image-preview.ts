import { createHash, randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

export const MAX_ARTIFACT_IMAGE_PREVIEW_BYTES = 25 * 1024 * 1024;
export const DEFAULT_ARTIFACT_IMAGE_PREVIEW_CAPACITY = 256;
export const DEFAULT_ARTIFACT_IMAGE_PREVIEW_TTL_MS = 5 * 60 * 1000;

export type ArtifactImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ArtifactImagePreviewSource {
  artifactVersionId: string;
  contentRef?: string;
  contentHash: string;
  mimeType: string;
}

export interface ArtifactImagePreviewGrant {
  artifactVersionId: string;
  previewUrl: string;
  mimeType: ArtifactImageMimeType;
  byteLength: number;
  contentHash: string;
}

export interface ArtifactImagePreviewReadResult {
  data: Buffer;
  mimeType: ArtifactImageMimeType;
  byteLength: number;
  contentHash: string;
}

interface StoredGrant {
  path: string;
  mimeType: ArtifactImageMimeType;
  byteLength: number;
  contentHash: string;
  expiresAt: number;
}

interface ArtifactImagePreviewRegistryOptions {
  capacity?: number;
  ttlMs?: number;
  now?: () => number;
  tokenFactory?: () => string;
}

/** Main-process-only grants for Runtime-owned generated image artifacts. */
export class ArtifactImagePreviewRegistry {
  private readonly root: string;
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly tokenFactory: () => string;
  private readonly grants = new Map<string, StoredGrant>();

  constructor(root: string, options: ArtifactImagePreviewRegistryOptions = {}) {
    if (!isAbsolute(root)) throw new Error('artifact_image_preview.root_invalid');
    this.root = resolve(root);
    this.capacity = positiveInteger(
      options.capacity ?? DEFAULT_ARTIFACT_IMAGE_PREVIEW_CAPACITY,
      'artifact_image_preview.capacity_invalid',
    );
    this.ttlMs = positiveInteger(
      options.ttlMs ?? DEFAULT_ARTIFACT_IMAGE_PREVIEW_TTL_MS,
      'artifact_image_preview.ttl_invalid',
    );
    this.now = options.now ?? Date.now;
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(24).toString('base64url'));
  }

  async register(source: ArtifactImagePreviewSource): Promise<ArtifactImagePreviewGrant> {
    const verified = await this.verifySource(source);
    this.pruneExpired();

    let token = this.tokenFactory();
    for (let attempt = 0; attempt < 4 && this.grants.has(token); attempt += 1) {
      token = this.tokenFactory();
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || this.grants.has(token)) {
      throw new Error('artifact_image_preview.token_invalid');
    }

    while (this.grants.size >= this.capacity) {
      const oldest = this.grants.keys().next().value as string | undefined;
      if (!oldest) break;
      this.grants.delete(oldest);
    }

    this.grants.set(token, {
      path: verified.path,
      mimeType: verified.mimeType,
      byteLength: verified.byteLength,
      contentHash: verified.contentHash,
      expiresAt: this.now() + this.ttlMs,
    });

    return {
      artifactVersionId: source.artifactVersionId,
      previewUrl: `sync-think-image://artifact/${token}`,
      mimeType: verified.mimeType,
      byteLength: verified.byteLength,
      contentHash: verified.contentHash,
    };
  }

  async read(token: string): Promise<ArtifactImagePreviewReadResult | undefined> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return undefined;
    const grant = this.grants.get(token);
    if (!grant) return undefined;
    if (grant.expiresAt <= this.now()) {
      this.grants.delete(token);
      return undefined;
    }

    try {
      const verified = await this.verifySource({
        artifactVersionId: 'registered-preview',
        contentRef: grant.path,
        contentHash: grant.contentHash,
        mimeType: grant.mimeType,
      });
      if (verified.byteLength !== grant.byteLength) {
        this.grants.delete(token);
        return undefined;
      }
      return {
        data: verified.data,
        mimeType: verified.mimeType,
        byteLength: verified.byteLength,
        contentHash: verified.contentHash,
      };
    } catch {
      this.grants.delete(token);
      return undefined;
    }
  }

  private async verifySource(source: ArtifactImagePreviewSource): Promise<{
    path: string;
    data: Buffer;
    mimeType: ArtifactImageMimeType;
    byteLength: number;
    contentHash: string;
  }> {
    if (!source.artifactVersionId || source.artifactVersionId.length > 256) {
      throw new Error('artifact_image_preview.version_invalid');
    }
    if (!source.contentRef || !isAbsolute(source.contentRef)) {
      throw new Error('artifact_image_preview.path_invalid');
    }
    const mimeType = allowedMimeType(source.mimeType);
    if (!/^[a-f0-9]{64}$/i.test(source.contentHash)) {
      throw new Error('artifact_image_preview.hash_invalid');
    }

    const [rootPath, candidatePath] = await Promise.all([
      realpath(this.root),
      realpath(source.contentRef),
    ]);
    const rel = relative(rootPath, candidatePath);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('artifact_image_preview.path_escape');
    }
    if (!extensionMatchesMime(candidatePath, mimeType)) {
      throw new Error('artifact_image_preview.extension_mismatch');
    }

    const info = await stat(candidatePath);
    if (!info.isFile()) throw new Error('artifact_image_preview.not_file');
    if (info.size < 1 || info.size > MAX_ARTIFACT_IMAGE_PREVIEW_BYTES) {
      throw new Error('artifact_image_preview.size_invalid');
    }

    const data = await readFile(candidatePath);
    if (data.byteLength !== info.size || data.byteLength > MAX_ARTIFACT_IMAGE_PREVIEW_BYTES) {
      throw new Error('artifact_image_preview.size_changed');
    }
    if (!magicMatchesMime(data, mimeType)) {
      throw new Error('artifact_image_preview.magic_mismatch');
    }
    const contentHash = createHash('sha256').update(data).digest('hex');
    if (contentHash !== source.contentHash.toLowerCase()) {
      throw new Error('artifact_image_preview.hash_mismatch');
    }

    return { path: candidatePath, data, mimeType, byteLength: data.byteLength, contentHash };
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token);
    }
  }
}

function allowedMimeType(value: string): ArtifactImageMimeType {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value;
  throw new Error('artifact_image_preview.mime_invalid');
}

function extensionMatchesMime(path: string, mimeType: ArtifactImageMimeType): boolean {
  const extension = extname(path).toLowerCase();
  if (mimeType === 'image/png') return extension === '.png';
  if (mimeType === 'image/jpeg') return extension === '.jpg' || extension === '.jpeg';
  return extension === '.webp';
}

function magicMatchesMime(data: Buffer, mimeType: ArtifactImageMimeType): boolean {
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

function positiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(code);
  return value;
}
