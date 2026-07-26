// artifact command payload parsers (extracted from command-validation.ts).
import { MAX_ARTIFACT_LIST_LIMIT } from '@sync-think/protocol';
import type { ListArtifactsPayload, GetArtifactVersionPayload, CompareArtifactVersionsPayload, SelectArtifactVersionPayload, MergeArtifactVersionsPayload, ListArtifactMergeConflictsPayload, ResolveArtifactMergeConflictPayload } from '@sync-think/protocol';
import { MAX_INLINE_ARTIFACT_CONTENT_BYTES } from '@sync-think/shared';
import { PLAN_ID_MAX_LENGTH, hasOnlyKeys, isBoundedText, ARTIFACT_SCOPE_KEYS, isArtifactCommandId, hasArtifactScope, hasExpectedTaskVersion, isRecord } from './shared.js';

export function parseListArtifactsPayload(value: unknown): ListArtifactsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...ARTIFACT_SCOPE_KEYS, 'limit', 'cursor']) ||
    !hasArtifactScope(value) ||
    (value.limit !== undefined &&
      (!Number.isSafeInteger(value.limit) ||
        (value.limit as number) < 1 ||
        (value.limit as number) > MAX_ARTIFACT_LIST_LIMIT)) ||
    (value.cursor !== undefined && !isArtifactCommandId(value.cursor))
  ) {
    return undefined;
  }
  return value as unknown as ListArtifactsPayload;
}

export function parseGetArtifactVersionPayload(
  value: unknown,
): GetArtifactVersionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...ARTIFACT_SCOPE_KEYS, 'artifactVersionId']) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.artifactVersionId)
  ) {
    return undefined;
  }
  return value as unknown as GetArtifactVersionPayload;
}

export function parseCompareArtifactVersionsPayload(
  value: unknown,
): CompareArtifactVersionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [...ARTIFACT_SCOPE_KEYS, 'leftVersionId', 'rightVersionId']) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.leftVersionId) ||
    !isArtifactCommandId(value.rightVersionId) ||
    value.leftVersionId === value.rightVersionId
  ) {
    return undefined;
  }
  return value as unknown as CompareArtifactVersionsPayload;
}

export function parseSelectArtifactVersionPayload(
  value: unknown,
): SelectArtifactVersionPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      ...ARTIFACT_SCOPE_KEYS,
      'artifactId',
      'artifactVersionId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.artifactId) ||
    !isArtifactCommandId(value.artifactVersionId) ||
    !isArtifactCommandId(value.operationId) ||
    !hasExpectedTaskVersion(value.expectedTaskVersion)
  ) {
    return undefined;
  }
  return value as unknown as SelectArtifactVersionPayload;
}

export function parseMergeArtifactVersionsPayload(
  value: unknown,
): MergeArtifactVersionsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      ...ARTIFACT_SCOPE_KEYS,
      'artifactId',
      'baseVersionId',
      'leftVersionId',
      'rightVersionId',
      'sourceStepId',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.artifactId) ||
    !isArtifactCommandId(value.baseVersionId) ||
    !isArtifactCommandId(value.leftVersionId) ||
    !isArtifactCommandId(value.rightVersionId) ||
    !isBoundedText(value.sourceStepId, PLAN_ID_MAX_LENGTH) ||
    !isArtifactCommandId(value.operationId) ||
    !hasExpectedTaskVersion(value.expectedTaskVersion) ||
    new Set([value.baseVersionId, value.leftVersionId, value.rightVersionId]).size !== 3
  ) {
    return undefined;
  }
  return value as unknown as MergeArtifactVersionsPayload;
}

export function parseListArtifactMergeConflictsPayload(
  value: unknown,
): ListArtifactMergeConflictsPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ARTIFACT_SCOPE_KEYS) ||
    !hasArtifactScope(value)
  ) {
    return undefined;
  }
  return value as unknown as ListArtifactMergeConflictsPayload;
}

export function parseResolveArtifactMergeConflictPayload(
  value: unknown,
): ResolveArtifactMergeConflictPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      ...ARTIFACT_SCOPE_KEYS,
      'conflictId',
      'strategy',
      'content',
      'operationId',
      'expectedTaskVersion',
    ]) ||
    !hasArtifactScope(value) ||
    !isArtifactCommandId(value.conflictId) ||
    (value.strategy !== 'left' && value.strategy !== 'right' && value.strategy !== 'manual') ||
    !isArtifactCommandId(value.operationId) ||
    !hasExpectedTaskVersion(value.expectedTaskVersion) ||
    (value.strategy === 'manual' &&
      (typeof value.content !== 'string' ||
        Buffer.byteLength(value.content, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES)) ||
    (value.strategy !== 'manual' && value.content !== undefined)
  ) {
    return undefined;
  }
  return value as unknown as ResolveArtifactMergeConflictPayload;
}
