import { describe, expect, it } from 'vitest';
import { isMergeableTextArtifactMime } from './artifact-content-policy.js';

describe('artifact content policy', () => {
  it.each([
    'text/plain',
    'text/markdown',
    'text/html; charset=utf-8',
    'application/json',
    'application/xml',
    'application/javascript',
  ])('accepts mergeable text MIME %s', (mimeType) => {
    expect(isMergeableTextArtifactMime(mimeType)).toBe(true);
  });

  it.each([
    'application/octet-stream',
    'application/pdf',
    'application/ld+json',
    'image/svg+xml',
    '',
  ])('rejects non-mergeable MIME %s', (mimeType) => {
    expect(isMergeableTextArtifactMime(mimeType)).toBe(false);
  });
});
