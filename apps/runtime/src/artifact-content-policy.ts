const MERGEABLE_APPLICATION_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
]);

export function isMergeableTextArtifactMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || MERGEABLE_APPLICATION_MIME_TYPES.has(mimeType);
}
