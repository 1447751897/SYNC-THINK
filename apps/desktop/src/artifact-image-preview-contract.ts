import type { GetArtifactVersionPayload } from '@sync-think/protocol';

export type ArtifactImagePreviewPayload = GetArtifactVersionPayload;

export interface ArtifactImagePreviewResponse {
  artifactVersionId: string;
  previewUrl: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  contentHash: string;
}
