import { describe, expect, it } from 'vitest';
import {
  parseArtifactComparePayload,
  parseArtifactConflictListPayload,
  parseArtifactConflictResolutionPayload,
  parseArtifactImagePreviewPayload,
  parseArtifactListPayload,
  parseArtifactMergePayload,
  parseArtifactSelectPayload,
} from './artifact-payloads.js';

const ids = {
  workspaceId: '01J00000000000000000000001',
  taskId: '01J00000000000000000000002',
  runId: '01J00000000000000000000003',
  artifactId: '01J00000000000000000000004',
  versionId: '01J00000000000000000000005',
  baseVersionId: '01J00000000000000000000006',
  leftVersionId: '01J00000000000000000000007',
  rightVersionId: '01J00000000000000000000008',
  operationId: '01J00000000000000000000009',
  conflictId: '01J0000000000000000000000A',
};
const scope = { workspaceId: ids.workspaceId, taskId: ids.taskId, runId: ids.runId };

describe('Artifact payload validation', () => {
  it('accepts exact read payloads', () => {
    expect(parseArtifactListPayload({ ...scope, limit: 8 })).toMatchObject({ limit: 8 });
    expect(
      parseArtifactImagePreviewPayload({ ...scope, artifactVersionId: ids.versionId }),
    ).toEqual({ ...scope, artifactVersionId: ids.versionId });
    expect(
      parseArtifactComparePayload({
        ...scope,
        leftVersionId: ids.leftVersionId,
        rightVersionId: ids.rightVersionId,
      }),
    ).toMatchObject({ leftVersionId: ids.leftVersionId, rightVersionId: ids.rightVersionId });
    expect(parseArtifactConflictListPayload(scope)).toEqual(scope);
  });

  it('accepts exact selection and merge payloads', () => {
    expect(
      parseArtifactSelectPayload({
        ...scope,
        artifactId: ids.artifactId,
        artifactVersionId: ids.versionId,
        operationId: ids.operationId,
        expectedTaskVersion: 2,
      }),
    ).toMatchObject({ artifactId: ids.artifactId, expectedTaskVersion: 2 });
    expect(
      parseArtifactMergePayload({
        ...scope,
        artifactId: ids.artifactId,
        baseVersionId: ids.baseVersionId,
        leftVersionId: ids.leftVersionId,
        rightVersionId: ids.rightVersionId,
        sourceStepId: 'merge-step',
        operationId: ids.operationId,
        expectedTaskVersion: 2,
      }),
    ).toMatchObject({ artifactId: ids.artifactId, sourceStepId: 'merge-step' });
  });

  it('accepts manual and side conflict resolution', () => {
    expect(
      parseArtifactConflictResolutionPayload({
        ...scope,
        conflictId: ids.conflictId,
        strategy: 'manual',
        content: 'resolved',
        operationId: ids.operationId,
        expectedTaskVersion: 3,
      }),
    ).toMatchObject({ strategy: 'manual', content: 'resolved' });
    expect(
      parseArtifactConflictResolutionPayload({
        ...scope,
        conflictId: ids.conflictId,
        strategy: 'left',
        operationId: ids.operationId,
        expectedTaskVersion: 3,
      }),
    ).toMatchObject({ strategy: 'left' });
  });

  it('rejects cross-shape IDs, same-version comparison and duplicate merge parents', () => {
    expect(() => parseArtifactListPayload({ ...scope, cursor: 'not-a-ulid' })).toThrow(
      /Invalid artifact-list/,
    );
    expect(() =>
      parseArtifactComparePayload({
        ...scope,
        leftVersionId: ids.leftVersionId,
        rightVersionId: ids.leftVersionId,
      }),
    ).toThrow(/Invalid artifact-compare/);
    expect(() =>
      parseArtifactMergePayload({
        ...scope,
        artifactId: ids.artifactId,
        baseVersionId: ids.baseVersionId,
        leftVersionId: ids.leftVersionId,
        rightVersionId: ids.leftVersionId,
        sourceStepId: 'merge-step',
        operationId: ids.operationId,
        expectedTaskVersion: 2,
      }),
    ).toThrow(/Invalid artifact-merge/);
  });

  it('rejects invalid conflict content and secret-like fields', () => {
    expect(() =>
      parseArtifactConflictResolutionPayload({
        ...scope,
        conflictId: ids.conflictId,
        strategy: 'left',
        content: 'unexpected',
        operationId: ids.operationId,
        expectedTaskVersion: 3,
      }),
    ).toThrow(/Invalid artifact-conflict-resolution/);
    expect(() => parseArtifactListPayload({ ...scope, accessToken: 'plaintext' })).toThrow(
      /secret-like|Invalid artifact-list/,
    );
  });
});
