import type { ArtifactId, ArtifactVersionId } from './types/ids.js';
import type { ArtifactVersion } from './types/artifact.js';
import type { StepArtifactVersionOutput } from './types/orchestration-contracts.js';

/** Rework may only derive eligible versions of the artifacts actually reviewed. */
export function assertValidReworkOutputs(
  reviewedVersions: readonly Pick<ArtifactVersion, 'id' | 'artifactId'>[],
  outputs: readonly StepArtifactVersionOutput[],
): void {
  if (outputs.length === 0) throw new Error('review.rework_output_required');
  const reviewedByArtifact = new Map<ArtifactId, Set<ArtifactVersionId>>();
  for (const version of reviewedVersions) {
    const versions = reviewedByArtifact.get(version.artifactId) ?? new Set<ArtifactVersionId>();
    versions.add(version.id);
    reviewedByArtifact.set(version.artifactId, versions);
  }
  const outputArtifacts = new Set<ArtifactId>();
  for (const output of outputs) {
    if (!('artifactId' in output) || !output.artifactId) {
      throw new Error('review.rework_output_scope_mismatch');
    }
    const parents = reviewedByArtifact.get(output.artifactId);
    const generatedImageCandidate =
      'contentRef' in output &&
      output.mimeType.startsWith('image/') &&
      output.metadata?.executionKind === 'image-generation' &&
      output.metadata?.generationKind === 'image';
    if (!parents || (outputArtifacts.has(output.artifactId) && !generatedImageCandidate)) {
      throw new Error('review.rework_output_scope_mismatch');
    }
    if (
      output.status !== 'candidate' &&
      output.status !== 'selected' &&
      output.status !== 'merged'
    ) {
      throw new Error('review.rework_output_status_invalid');
    }
    if (
      !output.parentVersionIds?.length ||
      output.parentVersionIds.some((parentId) => !parents.has(parentId))
    ) {
      throw new Error('review.rework_parent_required');
    }
    outputArtifacts.add(output.artifactId);
  }
}

export function reviewerArtifactsAfterRework(
  reviewedIds: readonly ArtifactVersionId[],
  outputVersions: readonly Pick<ArtifactVersion, 'id' | 'parentVersionIds'>[],
): ArtifactVersionId[] {
  const replacedParentIds = new Set(outputVersions.flatMap((version) => version.parentVersionIds));
  return [
    ...reviewedIds.filter((versionId) => !replacedParentIds.has(versionId)),
    ...outputVersions.map((version) => version.id),
  ];
}
