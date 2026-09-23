import type {
  CompareArtifactVersionsPayload,
  GetArtifactVersionPayload,
  ListArtifactMergeConflictsPayload,
  ListArtifactsPayload,
  MergeArtifactVersionsPayload,
  ResolveArtifactMergeConflictPayload,
  SelectArtifactVersionPayload,
} from '@sync-think/protocol';
import { MAX_ARTIFACT_LIST_LIMIT } from '@sync-think/protocol';
import { MAX_INLINE_ARTIFACT_CONTENT_BYTES } from '@sync-think/shared';
import {
  assertRendererSafeOrchestrationPayload,
  boundedText,
  hasOnlyKeys,
  invalid,
  isRecord,
  taskVersion,
} from './orchestration-payload-validation.js';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function artifactId(value: unknown): value is string {
  return typeof value === 'string' && ULID.test(value);
}

function artifactScope(value: Record<string, unknown>): boolean {
  return artifactId(value.workspaceId) && artifactId(value.taskId) && artifactId(value.runId);
}

export function parseArtifactListPayload(value: unknown): ListArtifactsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'limit', 'cursor']) ||
    !artifactScope(value) ||
    (value.limit !== undefined &&
      (!Number.isSafeInteger(value.limit) ||
        Number(value.limit) < 1 ||
        Number(value.limit) > MAX_ARTIFACT_LIST_LIMIT)) ||
    (value.cursor !== undefined && !artifactId(value.cursor))
  ) {
    return invalid('artifact-list');
  }
  return value as unknown as ListArtifactsPayload;
}

export function parseArtifactImagePreviewPayload(value: unknown): GetArtifactVersionPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'artifactVersionId']) ||
    !artifactScope(value) ||
    !artifactId(value.artifactVersionId)
  ) {
    return invalid('artifact-image-preview');
  }
  return value as unknown as GetArtifactVersionPayload;
}

export function parseArtifactComparePayload(value: unknown): CompareArtifactVersionsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId', 'leftVersionId', 'rightVersionId']) ||
    !artifactScope(value) ||
    !artifactId(value.leftVersionId) ||
    !artifactId(value.rightVersionId) ||
    value.leftVersionId === value.rightVersionId
  ) {
    return invalid('artifact-compare');
  }
  return value as unknown as CompareArtifactVersionsPayload;
}

export function parseArtifactSelectPayload(value: unknown): SelectArtifactVersionPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'artifactId',
      'artifactVersionId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !artifactScope(value) ||
    !artifactId(value.artifactId) ||
    !artifactId(value.artifactVersionId) ||
    !artifactId(value.operationId) ||
    !taskVersion(value.expectedTaskVersion)
  ) {
    return invalid('artifact-select');
  }
  return value as unknown as SelectArtifactVersionPayload;
}

export function parseArtifactMergePayload(value: unknown): MergeArtifactVersionsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'artifactId',
      'baseVersionId',
      'leftVersionId',
      'rightVersionId',
      'sourceStepId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !artifactScope(value) ||
    !artifactId(value.artifactId) ||
    !artifactId(value.baseVersionId) ||
    !artifactId(value.leftVersionId) ||
    !artifactId(value.rightVersionId) ||
    !boundedText(value.sourceStepId) ||
    !artifactId(value.operationId) ||
    !taskVersion(value.expectedTaskVersion) ||
    new Set([value.baseVersionId, value.leftVersionId, value.rightVersionId]).size !== 3
  ) {
    return invalid('artifact-merge');
  }
  return value as unknown as MergeArtifactVersionsPayload;
}

export function parseArtifactConflictListPayload(
  value: unknown,
): ListArtifactMergeConflictsPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'taskId', 'runId']) ||
    !artifactScope(value)
  ) {
    return invalid('artifact-conflict-list');
  }
  return value as unknown as ListArtifactMergeConflictsPayload;
}

export function parseArtifactConflictResolutionPayload(
  value: unknown,
): ResolveArtifactMergeConflictPayload {
  assertRendererSafeOrchestrationPayload(value);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'taskId',
      'runId',
      'conflictId',
      'strategy',
      'content',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !artifactScope(value) ||
    !artifactId(value.conflictId) ||
    (value.strategy !== 'left' && value.strategy !== 'right' && value.strategy !== 'manual') ||
    !artifactId(value.operationId) ||
    !taskVersion(value.expectedTaskVersion) ||
    (value.strategy === 'manual' &&
      (typeof value.content !== 'string' ||
        Buffer.byteLength(value.content, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES)) ||
    (value.strategy !== 'manual' && value.content !== undefined)
  ) {
    return invalid('artifact-conflict-resolution');
  }
  return value as unknown as ResolveArtifactMergeConflictPayload;
}
