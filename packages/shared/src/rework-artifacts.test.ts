import { describe, expect, it } from 'vitest';
import { assertValidReworkOutputs, reviewerArtifactsAfterRework } from './rework-artifacts.js';
import type { ArtifactId, ArtifactVersionId } from './types/ids.js';
import type { StepArtifactVersionOutput } from './types/orchestration-contracts.js';

const artifactId = 'artifact' as ArtifactId;
const v1 = 'v1' as ArtifactVersionId;
const other = 'other' as ArtifactVersionId;
const reviewed = [{ id: v1, artifactId }];
const output: StepArtifactVersionOutput = {
  artifactId,
  content: 'revised',
  mimeType: 'text/plain',
  status: 'candidate',
  parentVersionIds: [v1],
};

describe('rework artifact policy', () => {
  it.each(['candidate', 'selected', 'merged'] as const)('allows %s lineage', (status) => {
    expect(() => assertValidReworkOutputs(reviewed, [{ ...output, status }])).not.toThrow();
  });

  it.each([
    [[], 'review.rework_output_required'],
    [[{ ...output, artifactId: 'foreign' as ArtifactId }], 'review.rework_output_scope_mismatch'],
    [[output, output], 'review.rework_output_scope_mismatch'],
    [[{ ...output, status: 'rejected' }], 'review.rework_output_status_invalid'],
    [[{ ...output, parentVersionIds: [] }], 'review.rework_parent_required'],
    [[{ ...output, parentVersionIds: [other] }], 'review.rework_parent_required'],
  ] satisfies [StepArtifactVersionOutput[], string][])(
    'rejects invalid outputs %j',
    (outputs, error) => {
      expect(() => assertValidReworkOutputs(reviewed, outputs)).toThrow(error);
    },
  );

  it('retains the multiple image candidate exception without relaxing parent scope', () => {
    const image: StepArtifactVersionOutput = {
      artifactId,
      contentRef: 'image.png',
      contentHash: 'hash',
      mimeType: 'image/png',
      status: 'candidate',
      parentVersionIds: [v1],
      metadata: { executionKind: 'image-generation', generationKind: 'image' },
    };
    expect(() => assertValidReworkOutputs(reviewed, [image, image])).not.toThrow();
    expect(() =>
      assertValidReworkOutputs(reviewed, [image, { ...image, parentVersionIds: [other] }]),
    ).toThrow('review.rework_parent_required');
  });

  it('keeps untouched versions before new outputs in their original order', () => {
    const v2 = 'v2' as ArtifactVersionId;
    const v3 = 'v3' as ArtifactVersionId;
    expect(
      reviewerArtifactsAfterRework(
        [v1, other],
        [
          { id: v2, parentVersionIds: [v1] },
          { id: v3, parentVersionIds: [v1] },
        ],
      ),
    ).toEqual([other, v2, v3]);
  });
});
