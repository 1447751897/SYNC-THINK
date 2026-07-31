import { createHash } from 'node:crypto';
import {
  MAX_INLINE_ARTIFACT_CONTENT_BYTES,
  ulid,
  type Artifact,
  type ArtifactComparison,
  type ArtifactId,
  type ArtifactMergeConflict,
  type ArtifactMergeConflictResolution,
  type ArtifactMergeConflictResolutionStrategy,
  type ArtifactMergeConflictSummary,
  type ArtifactSelection,
  type ArtifactVersion,
  type ArtifactVersionId,
  type ArtifactVersionSummary,
  type ArtifactVersionStatus,
  type JsonValue,
  type RunId,
  type RunState,
  type StepId,
  type TaskId,
  type WorkspaceId,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 512;
const MAX_CONTENT_REF_LENGTH = 4096;
const MAX_METADATA_BYTES = 32 * 1024;
const MAX_PARENT_VERSIONS = 32;
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const MIME_REGEX = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/i;
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[a-z]:[\\/]/i;
const UNC_ABSOLUTE_PATH_REGEX = /^\\\\[^\\/]+[\\/][^\\/]+/;
const INTERNAL_ARTIFACT_REF_REGEX = /^artifact:\/\/[a-z0-9][a-z0-9._:/-]{0,1023}$/i;
const MERGEABLE_RUN_STATES = new Set<RunState>([
  'running',
  'reviewing',
  'revising',
  'paused',
]);
const DEFAULT_ARTIFACT_LIST_LIMIT = 8;
export const MAX_ARTIFACT_LIST_LIMIT = 8;
const MAX_LISTED_VERSIONS_PER_ARTIFACT = 8;
const MAX_ANCESTRY_NODES = 4096;
const VERSION_STATUSES = new Set<ArtifactVersionStatus>([
  'candidate',
  'selected',
  'rejected',
  'incomplete',
  'merged',
]);

export type ArtifactDataErrorCode =
  | 'artifact.invalid_input'
  | 'artifact.invalid_record'
  | 'artifact.invalid_version'
  | 'artifact.invalid_selection'
  | 'artifact.invalid_conflict'
  | 'artifact.legacy_conflict_step_unknown';

export class ArtifactDataError extends Error {
  override readonly name = 'ArtifactDataError';

  constructor(
    readonly code: ArtifactDataErrorCode,
    readonly path: string,
    detail?: string,
  ) {
    super(`${code}: ${path}${detail ? ` (${detail})` : ''}`);
  }
}

export interface CreateArtifactInput {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  runId: RunId;
  name: string;
  now?: string;
}

export interface CreateArtifactVersionInput {
  artifactId: ArtifactId;
  sourceStepId: StepId;
  content?: string;
  contentRef?: string;
  contentHash?: string;
  mimeType: string;
  status: ArtifactVersionStatus;
  parentVersionIds?: readonly ArtifactVersionId[];
  metadata?: Record<string, JsonValue>;
  now?: string;
}

export interface CreateMergedArtifactVersionInput {
  operationId: string;
  artifactId: ArtifactId;
  baseVersionId: ArtifactVersionId;
  leftVersionId: ArtifactVersionId;
  rightVersionId: ArtifactVersionId;
  sourceStepId: StepId;
  content: string;
  mimeType: string;
  expectedTaskVersion: number;
  resultingTaskVersion: number;
  metadata?: Record<string, JsonValue>;
  now?: string;
}

export interface SelectArtifactVersionInput {
  operationId: string;
  artifactId: ArtifactId;
  versionId: ArtifactVersionId;
  expectedTaskVersion: number;
  resultingTaskVersion: number;
  now?: string;
}

export interface CreateArtifactMergeConflictInput {
  operationId: string;
  artifactId: ArtifactId;
  baseVersionId: ArtifactVersionId;
  leftVersionId: ArtifactVersionId;
  rightVersionId: ArtifactVersionId;
  sourceStepId: StepId;
  expectedTaskVersion: number;
  resultingTaskVersion: number;
  summary: ArtifactMergeConflictSummary;
  now?: string;
}

export interface ResolveArtifactMergeConflictInput {
  operationId: string;
  conflictId: string;
  strategy: ArtifactMergeConflictResolutionStrategy;
  content?: string;
  expectedTaskVersion: number;
  resultingTaskVersion: number;
  now?: string;
}

export interface ArtifactScope {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  runId: RunId;
}

export interface StoredArtifactListItem {
  artifact: Artifact;
  versions: ArtifactVersionSummary[];
  selectedVersionId?: ArtifactVersionId;
}

export interface StoredArtifactMergeConflictItem {
  conflict: ArtifactMergeConflict;
  resolution?: ArtifactMergeConflictResolution;
}

export interface ListArtifactsOptions {
  limit?: number;
  cursor?: ArtifactId;
}

export interface StoredArtifactListPage {
  items: StoredArtifactListItem[];
  nextCursor?: ArtifactId;
}

export type StoredMergeOutcome =
  | {
      status: 'clean';
      version: ArtifactVersion;
      baseVersionId: ArtifactVersionId;
      expectedTaskVersion: number;
      resultingTaskVersion: number;
    }
  | {
      status: 'conflict';
      conflict: ArtifactMergeConflict;
    };

interface ArtifactDbRow {
  id: string;
  workspace_id: string;
  task_id: string;
  run_id: string;
  name: string;
  created_at: string;
}

interface OwnedArtifactDbRow extends ArtifactDbRow {
  owner_workspace_id: string | null;
  owner_task_id: string | null;
}

interface ArtifactVersionDbRow {
  id: string;
  artifact_id: string;
  source_run_id: string;
  source_step_id: string;
  status: string;
  version: number;
  content: string | null;
  content_ref: string | null;
  content_hash: string;
  mime_type: string;
  parent_version_ids_json: string;
  metadata_json: string;
  operation_id: string | null;
  merge_base_version_id: string | null;
  expected_task_version: number | null;
  resulting_task_version: number | null;
  created_at: string;
}

interface ArtifactVersionSummaryDbRow {
  id: string;
  artifact_id: string;
  source_run_id: string;
  source_step_id: string;
  status: string;
  version: number;
  content_hash: string;
  mime_type: string;
  parent_version_ids_json: string;
  created_at: string;
  has_inline_content: number;
  has_content_ref: number;
  artifact_run_id: string | null;
  source_step_run_id: string | null;
  invalid_parent_count: number;
}

interface ArtifactSelectionDbRow {
  id: string;
  operation_id: string;
  artifact_id: string;
  selected_version_id: string;
  expected_task_version: number;
  resulting_task_version: number;
  created_at: string;
}

interface ArtifactMergeConflictDbRow {
  id: string;
  operation_id: string;
  artifact_id: string;
  run_id: string;
  source_step_id: string | null;
  base_version_id: string;
  left_version_id: string;
  right_version_id: string;
  status: string;
  summary_json: string;
  expected_task_version: number;
  resulting_task_version: number;
  created_at: string;
}

interface ArtifactMergeConflictResolutionDbRow {
  id: string;
  operation_id: string;
  conflict_id: string;
  resolution_version_id: string;
  strategy: string;
  expected_task_version: number;
  resulting_task_version: number;
  created_at: string;
}

const OWNED_ARTIFACT_COLUMNS = `
  artifact.id, artifact.workspace_id, artifact.task_id, artifact.run_id,
  artifact.name, artifact.created_at, task.workspace_id AS owner_workspace_id,
  run.task_id AS owner_task_id
`;
const VERSION_COLUMNS = `
  id, artifact_id, source_run_id, source_step_id, status, version, content,
  content_ref, content_hash, mime_type, parent_version_ids_json, metadata_json,
  operation_id, merge_base_version_id, expected_task_version,
  resulting_task_version, created_at
`;
const SELECTION_COLUMNS = `
  id, operation_id, artifact_id, selected_version_id, expected_task_version,
  resulting_task_version, created_at
`;
const CONFLICT_COLUMNS = `
  id, operation_id, artifact_id, run_id, source_step_id, base_version_id, left_version_id,
  right_version_id, status, summary_json, expected_task_version,
  resulting_task_version, created_at
`;
const CONFLICT_RESOLUTION_COLUMNS = `
  id, operation_id, conflict_id, resolution_version_id, strategy,
  expected_task_version, resulting_task_version, created_at
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value: unknown, path: string, maxLength = MAX_ID_LENGTH): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ArtifactDataError('artifact.invalid_input', path, 'expected bounded text');
  }
  return value;
}

function requireStoredText(value: unknown, path: string, maxLength = MAX_ID_LENGTH): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ArtifactDataError('artifact.invalid_record', path, 'expected bounded text');
  }
  return value;
}

function requireTaskVersion(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArtifactDataError('artifact.invalid_input', path, 'expected non-negative integer');
  }
  return value;
}

function requireStoredTaskVersion(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ArtifactDataError('artifact.invalid_record', path, 'expected non-negative integer');
  }
  return value as number;
}

function requireVersionStatus(value: unknown): ArtifactVersionStatus {
  if (typeof value !== 'string' || !VERSION_STATUSES.has(value as ArtifactVersionStatus)) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.status',
      'unknown status',
    );
  }
  return value as ArtifactVersionStatus;
}

function requireMimeType(value: unknown, path: string, code: ArtifactDataErrorCode): string {
  if (typeof value !== 'string' || !MIME_REGEX.test(value)) {
    throw new ArtifactDataError(code, path, 'invalid MIME type');
  }
  return value.toLowerCase();
}

function requireHash(value: unknown, path: string, code: ArtifactDataErrorCode): string {
  if (typeof value !== 'string' || !SHA256_REGEX.test(value)) {
    throw new ArtifactDataError(code, path, 'invalid SHA-256 hash');
  }
  return value;
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isLocalContentRef(value: string): boolean {
  if (
    !value ||
    value.trim() !== value ||
    value.length > MAX_CONTENT_REF_LENGTH ||
    hasAsciiControlCharacter(value)
  ) {
    return false;
  }
  if (
    WINDOWS_ABSOLUTE_PATH_REGEX.test(value) ||
    UNC_ABSOLUTE_PATH_REGEX.test(value) ||
    (value.startsWith('/') && !value.startsWith('//')) ||
    INTERNAL_ARTIFACT_REF_REGEX.test(value)
  ) {
    return true;
  }
  if (!value.toLowerCase().startsWith('file://')) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'file:' &&
      (parsed.hostname === '' || parsed.hostname === 'localhost') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname.startsWith('/') &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function encodeMetadata(metadata: Record<string, JsonValue> | undefined): string {
  const value = metadata ?? {};
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new ArtifactDataError('artifact.invalid_input', 'artifactVersion.metadata');
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_METADATA_BYTES) {
    throw new ArtifactDataError(
      'artifact.invalid_input',
      'artifactVersion.metadata',
      'metadata is too large',
    );
  }
  return json;
}

function parseJson(raw: string, path: string, code: ArtifactDataErrorCode): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ArtifactDataError(code, path, 'invalid JSON');
  }
}

function decodeMetadata(raw: string): Record<string, JsonValue> {
  const parsed = parseJson(raw, 'artifactVersion.metadata', 'artifact.invalid_version');
  if (
    !isRecord(parsed) ||
    !isJsonValue(parsed) ||
    Buffer.byteLength(raw, 'utf8') > MAX_METADATA_BYTES
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.metadata',
      'expected bounded JSON object',
    );
  }
  return parsed as Record<string, JsonValue>;
}

function decodeParentIds(raw: string): ArtifactVersionId[] {
  const parsed = parseJson(
    raw,
    'artifactVersion.parentVersionIds',
    'artifact.invalid_version',
  );
  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_PARENT_VERSIONS ||
    !parsed.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.parentVersionIds',
      'expected unique bounded ID array',
    );
  }
  return parsed as ArtifactVersionId[];
}

function mapArtifact(row: ArtifactDbRow): Artifact {
  return {
    id: requireStoredText(row.id, 'artifact.id') as ArtifactId,
    workspaceId: requireStoredText(row.workspace_id, 'artifact.workspaceId') as WorkspaceId,
    taskId: requireStoredText(row.task_id, 'artifact.taskId') as TaskId,
    runId: requireStoredText(row.run_id, 'artifact.runId') as RunId,
    name: requireStoredText(row.name, 'artifact.name', MAX_NAME_LENGTH),
    createdAt: requireStoredText(row.created_at, 'artifact.createdAt', 128),
  };
}

function mapOwnedArtifact(row: OwnedArtifactDbRow): Artifact {
  const artifact = mapArtifact(row);
  if (
    row.owner_workspace_id !== artifact.workspaceId ||
    row.owner_task_id !== artifact.taskId
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_record',
      'artifact.scope',
      'workspace/task/Run ownership mismatch',
    );
  }
  return artifact;
}

function mapVersionSummary(row: ArtifactVersionSummaryDbRow): ArtifactVersionSummary {
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.version',
      'expected positive integer',
    );
  }
  if (
    ![0, 1].includes(row.has_inline_content) ||
    ![0, 1].includes(row.has_content_ref) ||
    row.has_inline_content === row.has_content_ref
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.content',
      'expected exactly one content representation',
    );
  }
  const artifactId = requireStoredText(
    row.artifact_id,
    'artifactVersion.artifactId',
  ) as ArtifactId;
  if (
    row.artifact_run_id === null ||
    row.source_step_run_id === null ||
    row.source_run_id !== row.artifact_run_id ||
    row.source_step_run_id !== row.source_run_id ||
    row.invalid_parent_count !== 0
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.ownership',
      'source or parent ownership mismatch',
    );
  }
  return {
    id: requireStoredText(row.id, 'artifactVersion.id') as ArtifactVersionId,
    artifactId,
    contentHash: requireHash(
      row.content_hash,
      'artifactVersion.contentHash',
      'artifact.invalid_version',
    ),
    mimeType: requireMimeType(
      row.mime_type,
      'artifactVersion.mimeType',
      'artifact.invalid_version',
    ),
    sourceStepId: requireStoredText(
      row.source_step_id,
      'artifactVersion.sourceStepId',
    ) as StepId,
    status: requireVersionStatus(row.status),
    version: row.version,
    parentVersionIds: decodeParentIds(row.parent_version_ids_json),
    createdAt: requireStoredText(row.created_at, 'artifactVersion.createdAt', 128),
    hasInlineContent: row.has_inline_content === 1,
    hasContentRef: row.has_content_ref === 1,
  };
}

function mapVersion(row: ArtifactVersionDbRow): ArtifactVersion {
  if (!Number.isSafeInteger(row.version) || row.version < 1) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.version',
      'expected positive integer',
    );
  }
  const hasContent = row.content !== null;
  const hasContentRef = row.content_ref !== null;
  if (hasContent === hasContentRef) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.content',
      'expected exactly one content representation',
    );
  }
  if (
    row.content !== null &&
    Buffer.byteLength(row.content, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.content',
      'content is too large',
    );
  }
  if (
    row.content_ref !== null &&
    (row.content_ref.length > MAX_CONTENT_REF_LENGTH || !isLocalContentRef(row.content_ref))
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.contentRef',
      'contentRef must be a bounded local reference',
    );
  }
  const operationFields = [
    row.merge_base_version_id,
    row.expected_task_version,
    row.resulting_task_version,
  ];
  if (
    (row.operation_id === null && operationFields.some((value) => value !== null)) ||
    (row.operation_id !== null && operationFields.some((value) => value === null))
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.operation',
      'incomplete merge operation fields',
    );
  }
  const contentHash = requireHash(
    row.content_hash,
    'artifactVersion.contentHash',
    'artifact.invalid_version',
  );
  if (
    row.content !== null &&
    createHash('sha256').update(row.content, 'utf8').digest('hex') !== contentHash
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_version',
      'artifactVersion.contentHash',
      'hash does not match inline content',
    );
  }
  return {
    id: requireStoredText(row.id, 'artifactVersion.id') as ArtifactVersionId,
    artifactId: requireStoredText(row.artifact_id, 'artifactVersion.artifactId') as ArtifactId,
    ...(row.content === null ? {} : { content: row.content }),
    ...(row.content_ref === null ? {} : { contentRef: row.content_ref }),
    contentHash,
    mimeType: requireMimeType(
      row.mime_type,
      'artifactVersion.mimeType',
      'artifact.invalid_version',
    ),
    sourceStepId: requireStoredText(
      row.source_step_id,
      'artifactVersion.sourceStepId',
    ) as StepId,
    status: requireVersionStatus(row.status),
    version: row.version,
    parentVersionIds: decodeParentIds(row.parent_version_ids_json),
    metadata: decodeMetadata(row.metadata_json),
    createdAt: requireStoredText(row.created_at, 'artifactVersion.createdAt', 128),
  };
}

function mapSelection(row: ArtifactSelectionDbRow): ArtifactSelection {
  return {
    id: requireStoredText(row.id, 'artifactSelection.id'),
    operationId: requireStoredText(row.operation_id, 'artifactSelection.operationId'),
    artifactId: requireStoredText(row.artifact_id, 'artifactSelection.artifactId') as ArtifactId,
    selectedVersionId: requireStoredText(
      row.selected_version_id,
      'artifactSelection.selectedVersionId',
    ) as ArtifactVersionId,
    expectedTaskVersion: requireStoredTaskVersion(
      row.expected_task_version,
      'artifactSelection.expectedTaskVersion',
    ),
    resultingTaskVersion: requireStoredTaskVersion(
      row.resulting_task_version,
      'artifactSelection.resultingTaskVersion',
    ),
    createdAt: requireStoredText(row.created_at, 'artifactSelection.createdAt', 128),
  };
}

function decodeConflictSummary(raw: string): ArtifactMergeConflictSummary {
  const parsed = parseJson(raw, 'artifactMergeConflict.summary', 'artifact.invalid_conflict');
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).sort().join(',') !== 'baseHash,leftHash,rightHash'
  ) {
    throw new ArtifactDataError(
      'artifact.invalid_conflict',
      'artifactMergeConflict.summary',
      'unexpected fields',
    );
  }
  return {
    baseHash: requireHash(
      parsed.baseHash,
      'artifactMergeConflict.summary.baseHash',
      'artifact.invalid_conflict',
    ),
    leftHash: requireHash(
      parsed.leftHash,
      'artifactMergeConflict.summary.leftHash',
      'artifact.invalid_conflict',
    ),
    rightHash: requireHash(
      parsed.rightHash,
      'artifactMergeConflict.summary.rightHash',
      'artifact.invalid_conflict',
    ),
  };
}

function mapConflict(row: ArtifactMergeConflictDbRow): ArtifactMergeConflict {
  if (row.status !== 'open') {
    throw new ArtifactDataError(
      'artifact.invalid_conflict',
      'artifactMergeConflict.status',
      'unknown status',
    );
  }
  const common = {
    id: requireStoredText(row.id, 'artifactMergeConflict.id'),
    operationId: requireStoredText(row.operation_id, 'artifactMergeConflict.operationId'),
    artifactId: requireStoredText(row.artifact_id, 'artifactMergeConflict.artifactId') as ArtifactId,
    runId: requireStoredText(row.run_id, 'artifactMergeConflict.runId') as RunId,
    baseVersionId: requireStoredText(
      row.base_version_id,
      'artifactMergeConflict.baseVersionId',
    ) as ArtifactVersionId,
    leftVersionId: requireStoredText(
      row.left_version_id,
      'artifactMergeConflict.leftVersionId',
    ) as ArtifactVersionId,
    rightVersionId: requireStoredText(
      row.right_version_id,
      'artifactMergeConflict.rightVersionId',
    ) as ArtifactVersionId,
    status: 'open' as const,
    summary: decodeConflictSummary(row.summary_json),
    expectedTaskVersion: requireStoredTaskVersion(
      row.expected_task_version,
      'artifactMergeConflict.expectedTaskVersion',
    ),
    resultingTaskVersion: requireStoredTaskVersion(
      row.resulting_task_version,
      'artifactMergeConflict.resultingTaskVersion',
    ),
    createdAt: requireStoredText(row.created_at, 'artifactMergeConflict.createdAt', 128),
  };
  if (row.source_step_id === null) {
    return { ...common, legacySourceStepUnknown: true };
  }
  return {
    ...common,
    sourceStepId: requireStoredText(
      row.source_step_id,
      'artifactMergeConflict.sourceStepId',
    ) as StepId,
    legacySourceStepUnknown: false,
  };
}

function mapConflictResolution(
  row: ArtifactMergeConflictResolutionDbRow,
): ArtifactMergeConflictResolution {
  if (row.strategy !== 'left' && row.strategy !== 'right' && row.strategy !== 'manual') {
    throw new ArtifactDataError(
      'artifact.invalid_conflict',
      'artifactMergeConflictResolution.strategy',
      'unknown strategy',
    );
  }
  return {
    id: requireStoredText(row.id, 'artifactMergeConflictResolution.id'),
    operationId: requireStoredText(
      row.operation_id,
      'artifactMergeConflictResolution.operationId',
    ),
    conflictId: requireStoredText(row.conflict_id, 'artifactMergeConflictResolution.conflictId'),
    resolutionVersionId: requireStoredText(
      row.resolution_version_id,
      'artifactMergeConflictResolution.resolutionVersionId',
    ) as ArtifactVersionId,
    strategy: row.strategy,
    expectedTaskVersion: requireStoredTaskVersion(
      row.expected_task_version,
      'artifactMergeConflictResolution.expectedTaskVersion',
    ),
    resultingTaskVersion: requireStoredTaskVersion(
      row.resulting_task_version,
      'artifactMergeConflictResolution.resultingTaskVersion',
    ),
    createdAt: requireStoredText(
      row.created_at,
      'artifactMergeConflictResolution.createdAt',
      128,
    ),
  };
}

function assertNextTaskVersion(expected: number, resulting: number): void {
  requireTaskVersion(expected, 'expectedTaskVersion');
  requireTaskVersion(resulting, 'resultingTaskVersion');
  if (resulting !== expected + 1) {
    throw new ArtifactDataError(
      'artifact.invalid_input',
      'resultingTaskVersion',
      'must increment expectedTaskVersion by one',
    );
  }
}

function isSameSelection(left: ArtifactSelection, input: SelectArtifactVersionInput): boolean {
  return (
    left.artifactId === input.artifactId &&
    left.selectedVersionId === input.versionId &&
    left.expectedTaskVersion === input.expectedTaskVersion &&
    left.resultingTaskVersion === input.resultingTaskVersion
  );
}

function isSameConflict(
  left: ArtifactMergeConflict,
  input: CreateArtifactMergeConflictInput,
): boolean {
  return (
    left.artifactId === input.artifactId &&
    left.baseVersionId === input.baseVersionId &&
    left.leftVersionId === input.leftVersionId &&
    left.rightVersionId === input.rightVersionId &&
    left.sourceStepId === input.sourceStepId &&
    left.expectedTaskVersion === input.expectedTaskVersion &&
    left.resultingTaskVersion === input.resultingTaskVersion
  );
}

export class SqliteArtifactStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  createArtifact(input: CreateArtifactInput): Artifact {
    const workspaceId = requireText(input.workspaceId, 'artifact.workspaceId') as WorkspaceId;
    const taskId = requireText(input.taskId, 'artifact.taskId') as TaskId;
    const runId = requireText(input.runId, 'artifact.runId') as RunId;
    const name = requireText(input.name, 'artifact.name', MAX_NAME_LENGTH).trim();
    const now = input.now ?? new Date().toISOString();
    return this.raw.transaction(() => {
      const ownership = this.raw
        .prepare(
          `SELECT run.task_id AS taskId, task.workspace_id AS workspaceId
           FROM run JOIN task ON task.id = run.task_id WHERE run.id = ?`,
        )
        .get(runId) as { taskId: string; workspaceId: string } | undefined;
      if (!ownership || ownership.taskId !== taskId || ownership.workspaceId !== workspaceId) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'artifact.scope',
          'Run does not belong to workspace/task',
        );
      }
      const artifact: Artifact = {
        id: ulid() as ArtifactId,
        workspaceId,
        taskId,
        runId,
        name,
        createdAt: now,
      };
      this.raw
        .prepare(
          `INSERT INTO artifact (id, workspace_id, task_id, run_id, name, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(artifact.id, workspaceId, taskId, runId, name, now);
      return artifact;
    }).immediate();
  }

  getArtifact(id: ArtifactId): Artifact | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${OWNED_ARTIFACT_COLUMNS}
         FROM artifact
         LEFT JOIN task ON task.id = artifact.task_id
         LEFT JOIN run ON run.id = artifact.run_id
         WHERE artifact.id = ?`,
      )
      .get(id) as OwnedArtifactDbRow | undefined;
    return row ? mapOwnedArtifact(row) : undefined;
  }

  getArtifactForScope(id: ArtifactId, scope: ArtifactScope): Artifact | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${OWNED_ARTIFACT_COLUMNS}
         FROM artifact
         LEFT JOIN task ON task.id = artifact.task_id
         LEFT JOIN run ON run.id = artifact.run_id
         WHERE artifact.id = ? AND artifact.workspace_id = ?
           AND artifact.task_id = ? AND artifact.run_id = ?`,
      )
      .get(id, scope.workspaceId, scope.taskId, scope.runId) as ArtifactDbRow | undefined;
    return row ? mapOwnedArtifact(row as OwnedArtifactDbRow) : undefined;
  }

  listArtifacts(
    scope: ArtifactScope,
    options: ListArtifactsOptions = {},
  ): StoredArtifactListPage {
    const limit = options.limit ?? DEFAULT_ARTIFACT_LIST_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ARTIFACT_LIST_LIMIT) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifact.list.limit',
        `expected an integer from 1 to ${MAX_ARTIFACT_LIST_LIMIT}`,
      );
    }
    const cursor =
      options.cursor === undefined
        ? undefined
        : (requireText(options.cursor, 'artifact.list.cursor') as ArtifactId);
    const anchor = cursor === undefined ? undefined : this.getArtifactForScope(cursor, scope);
    if (cursor !== undefined && !anchor) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifact.list.cursor',
        'cursor is not available in this scope',
      );
    }

    const allRows = this.raw
      .prepare(
        `SELECT ${OWNED_ARTIFACT_COLUMNS}
         FROM artifact
         LEFT JOIN task ON task.id = artifact.task_id
         LEFT JOIN run ON run.id = artifact.run_id
         WHERE artifact.workspace_id = ? AND artifact.task_id = ? AND artifact.run_id = ?
           AND (? IS NULL OR artifact.created_at > ?
             OR (artifact.created_at = ? AND artifact.id > ?))
         ORDER BY artifact.created_at ASC, artifact.id ASC
         LIMIT ?`,
      )
      .all(
        scope.workspaceId,
        scope.taskId,
        scope.runId,
        anchor?.createdAt ?? null,
        anchor?.createdAt ?? null,
        anchor?.createdAt ?? null,
        anchor?.id ?? null,
        limit + 1,
      ) as OwnedArtifactDbRow[];
    const artifacts = allRows.map(mapOwnedArtifact).slice(0, limit);
    if (artifacts.length === 0) return { items: [] };

    const placeholders = artifacts.map(() => '?').join(', ');
    const versionRows = this.raw
      .prepare(
        `WITH ranked_versions AS (
           SELECT
             artifact_version.id, artifact_version.artifact_id,
             artifact_version.source_run_id, artifact_version.source_step_id,
             artifact_version.status, artifact_version.version,
             artifact_version.content_hash, artifact_version.mime_type,
             artifact_version.parent_version_ids_json, artifact_version.created_at,
             CASE WHEN artifact_version.content IS NULL THEN 0 ELSE 1 END AS has_inline_content,
             CASE WHEN artifact_version.content_ref IS NULL THEN 0 ELSE 1 END AS has_content_ref,
             artifact.run_id AS artifact_run_id,
             (
               SELECT source_step.run_id FROM step AS source_step
               WHERE source_step.run_id = artifact_version.source_run_id
                 AND source_step.id = artifact_version.source_step_id
             ) AS source_step_run_id,
             CASE
               WHEN json_valid(artifact_version.parent_version_ids_json) = 0
                 OR json_type(artifact_version.parent_version_ids_json) <> 'array'
               THEN 1
               ELSE (
                 SELECT COUNT(*)
                 FROM json_each(artifact_version.parent_version_ids_json) AS parent
                 LEFT JOIN artifact_version AS parent_version ON parent_version.id = parent.value
                 WHERE parent.type <> 'text'
                   OR parent_version.id IS NULL
                   OR parent_version.artifact_id <> artifact_version.artifact_id
                   OR parent_version.version >= artifact_version.version
               )
             END AS invalid_parent_count,
             ROW_NUMBER() OVER (
               PARTITION BY artifact_version.artifact_id
               ORDER BY artifact_version.version DESC, artifact_version.id DESC
             ) AS version_rank
           FROM artifact_version
           LEFT JOIN artifact ON artifact.id = artifact_version.artifact_id
           WHERE artifact_version.artifact_id IN (${placeholders})
         )
         SELECT id, artifact_id, source_run_id, source_step_id, status, version,
           content_hash, mime_type, parent_version_ids_json, created_at,
           has_inline_content, has_content_ref, artifact_run_id,
           source_step_run_id, invalid_parent_count
         FROM ranked_versions
         WHERE version_rank <= ?
         ORDER BY artifact_id ASC, version ASC, id ASC`,
      )
      .all(
        ...artifacts.map((artifact) => artifact.id),
        MAX_LISTED_VERSIONS_PER_ARTIFACT,
      ) as ArtifactVersionSummaryDbRow[];
    const versionsByArtifact = new Map<ArtifactId, ArtifactVersionSummary[]>();
    for (const row of versionRows) {
      const version = mapVersionSummary(row);
      const versions = versionsByArtifact.get(version.artifactId) ?? [];
      versions.push(version);
      versionsByArtifact.set(version.artifactId, versions);
    }

    const selectionRows = this.raw
      .prepare(
        `SELECT artifact_selection.id, artifact_selection.operation_id,
           artifact_selection.artifact_id, artifact_selection.selected_version_id,
           artifact_selection.expected_task_version,
           artifact_selection.resulting_task_version,
           artifact_selection.created_at,
           selected_version.artifact_id AS selected_artifact_id
         FROM artifact_selection
         LEFT JOIN artifact_version AS selected_version
           ON selected_version.id = artifact_selection.selected_version_id
         WHERE artifact_selection.artifact_id IN (${placeholders})
           AND artifact_selection.id = (
             SELECT latest.id FROM artifact_selection AS latest
             WHERE latest.artifact_id = artifact_selection.artifact_id
             ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
           )`,
      )
      .all(...artifacts.map((artifact) => artifact.id)) as Array<
        ArtifactSelectionDbRow & { selected_artifact_id: string | null }
      >;
    const selectedByArtifact = new Map<ArtifactId, ArtifactVersionId>();
    for (const row of selectionRows) {
      const selection = mapSelection(row);
      if (row.selected_artifact_id !== selection.artifactId) {
        throw new ArtifactDataError(
          'artifact.invalid_selection',
          'artifactSelection.selectedVersionId',
          'selected version belongs to another Artifact',
        );
      }
      selectedByArtifact.set(selection.artifactId, selection.selectedVersionId);
    }

    return {
      items: artifacts.map((artifact) => {
        const selectedVersionId = selectedByArtifact.get(artifact.id);
        return {
          artifact,
          versions: versionsByArtifact.get(artifact.id) ?? [],
          ...(selectedVersionId ? { selectedVersionId } : {}),
        };
      }),
      ...(allRows.length > limit ? { nextCursor: artifacts.at(-1)!.id } : {}),
    };
  }

  createVersion(input: CreateArtifactVersionInput): ArtifactVersion {
    return this.raw.transaction(() => this.createVersionInternal(input)).immediate();
  }

  createMergedVersion(
    input: CreateMergedArtifactVersionInput,
  ): { created: boolean; version: ArtifactVersion } {
    return this.raw.transaction(() => {
      if (
        this.getSelectionByOperationId(input.operationId) ||
        this.getConflictResolutionByOperationId(input.operationId)
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'operationId',
          'operation ID belongs to a different artifact mutation',
        );
      }
      this.assertMergePreconditionsInternal(input);
      const existing = this.getMergeOutcomeByOperationId(input.operationId);
      if (existing) {
        if (
          existing.status !== 'clean' ||
          existing.version.artifactId !== input.artifactId ||
          existing.baseVersionId !== input.baseVersionId ||
          existing.version.sourceStepId !== input.sourceStepId ||
          existing.version.parentVersionIds[0] !== input.leftVersionId ||
          existing.version.parentVersionIds[1] !== input.rightVersionId ||
          existing.expectedTaskVersion !== input.expectedTaskVersion ||
          existing.resultingTaskVersion !== input.resultingTaskVersion
        ) {
          throw new ArtifactDataError(
            'artifact.invalid_input',
            'operationId',
            'operation ID was reused with different merge input',
          );
        }
        return { created: false, version: existing.version };
      }
      assertNextTaskVersion(input.expectedTaskVersion, input.resultingTaskVersion);
      this.assertDistinctMergeVersions(input);
      const version = this.createVersionInternal(
        {
          artifactId: input.artifactId,
          sourceStepId: input.sourceStepId,
          content: input.content,
          mimeType: input.mimeType,
          status: 'merged',
          parentVersionIds: [input.leftVersionId, input.rightVersionId],
          metadata: input.metadata,
          now: input.now,
        },
        {
          operationId: requireText(input.operationId, 'operationId'),
          mergeBaseVersionId: input.baseVersionId,
          expectedTaskVersion: input.expectedTaskVersion,
          resultingTaskVersion: input.resultingTaskVersion,
        },
      );
      return { created: true, version };
    }).immediate();
  }

  getVersion(id: ArtifactVersionId): ArtifactVersion | undefined {
    const row = this.getVersionRow(id);
    if (!row) return undefined;
    const version = mapVersion(row);
    this.assertVersionOwnership(row, version);
    this.assertPersistedParents(version);
    return version;
  }

  getVersionForScope(id: ArtifactVersionId, scope: ArtifactScope): ArtifactVersion | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${VERSION_COLUMNS} FROM artifact_version
         WHERE id = ? AND artifact_id IN (
           SELECT id FROM artifact
           WHERE workspace_id = ? AND task_id = ? AND run_id = ?
         )`,
      )
      .get(id, scope.workspaceId, scope.taskId, scope.runId) as ArtifactVersionDbRow | undefined;
    if (!row) return undefined;
    const version = mapVersion(row);
    this.assertVersionOwnership(row, version);
    this.assertPersistedParents(version);
    return version;
  }

  listVersions(artifactId: ArtifactId): ArtifactVersion[] {
    const rows = this.raw
      .prepare(
        `SELECT ${VERSION_COLUMNS} FROM artifact_version
         WHERE artifact_id = ? ORDER BY version ASC, id ASC`,
      )
      .all(artifactId) as ArtifactVersionDbRow[];
    const versions = rows.map((row) => {
      const version = mapVersion(row);
      this.assertVersionOwnership(row, version);
      return version;
    });
    const byId = new Map(versions.map((version) => [version.id, version]));
    for (const version of versions) {
      for (const parentId of version.parentVersionIds) {
        const parent = byId.get(parentId);
        if (!parent || parent.version >= version.version) {
          throw new ArtifactDataError(
            'artifact.invalid_version',
            'artifactVersion.parentVersionIds',
            'parent is missing, cross-artifact, or not older',
          );
        }
      }
    }
    return versions;
  }

  selectVersion(
    input: SelectArtifactVersionInput,
  ): { created: boolean; selection: ArtifactSelection } {
    return this.raw.transaction(() => {
      const operationId = requireText(input.operationId, 'operationId');
      const existing = this.getSelectionByOperationId(operationId);
      if (existing) {
        if (!isSameSelection(existing, input)) {
          throw new ArtifactDataError(
            'artifact.invalid_input',
            'operationId',
            'operation ID was reused with different selection input',
          );
        }
        return { created: false, selection: existing };
      }
      if (
        this.getMergeOutcomeByOperationId(operationId) ||
        this.getConflictResolutionByOperationId(operationId)
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'operationId',
          'operation ID belongs to a different artifact mutation',
        );
      }
      assertNextTaskVersion(input.expectedTaskVersion, input.resultingTaskVersion);
      this.getRequiredVersionForArtifact(input.versionId, input.artifactId);
      const selection: ArtifactSelection = {
        id: ulid(),
        operationId,
        artifactId: input.artifactId,
        selectedVersionId: input.versionId,
        expectedTaskVersion: input.expectedTaskVersion,
        resultingTaskVersion: input.resultingTaskVersion,
        createdAt: input.now ?? new Date().toISOString(),
      };
      this.raw
        .prepare(
          `INSERT INTO artifact_selection (
             id, operation_id, artifact_id, selected_version_id,
             expected_task_version, resulting_task_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          selection.id,
          selection.operationId,
          selection.artifactId,
          selection.selectedVersionId,
          selection.expectedTaskVersion,
          selection.resultingTaskVersion,
          selection.createdAt,
        );
      return { created: true, selection };
    }).immediate();
  }

  getSelectionByOperationId(operationId: string): ArtifactSelection | undefined {
    const row = this.raw
      .prepare(`SELECT ${SELECTION_COLUMNS} FROM artifact_selection WHERE operation_id = ?`)
      .get(operationId) as ArtifactSelectionDbRow | undefined;
    if (!row) return undefined;
    const selection = mapSelection(row);
    this.assertSelectionOwnership(selection);
    return selection;
  }

  listSelections(artifactId: ArtifactId): ArtifactSelection[] {
    const rows = this.raw
      .prepare(
        `SELECT ${SELECTION_COLUMNS} FROM artifact_selection
         WHERE artifact_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(artifactId) as ArtifactSelectionDbRow[];
    return rows.map((row) => {
      const selection = mapSelection(row);
      this.assertSelectionOwnership(selection);
      return selection;
    });
  }

  createMergeConflict(
    input: CreateArtifactMergeConflictInput,
  ): { created: boolean; conflict: ArtifactMergeConflict } {
    return this.raw.transaction(() => {
      const operationId = requireText(input.operationId, 'operationId');
      if (
        this.getSelectionByOperationId(operationId) ||
        this.getConflictResolutionByOperationId(operationId)
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'operationId',
          'operation ID belongs to a different artifact mutation',
        );
      }
      this.assertMergePreconditionsInternal(input);
      const existing = this.getMergeOutcomeByOperationId(operationId);
      if (existing) {
        if (existing.status !== 'conflict' || !isSameConflict(existing.conflict, input)) {
          throw new ArtifactDataError(
            'artifact.invalid_input',
            'operationId',
            'operation ID was reused with different conflict input',
          );
        }
        return { created: false, conflict: existing.conflict };
      }
      assertNextTaskVersion(input.expectedTaskVersion, input.resultingTaskVersion);
      const artifact = this.getRequiredArtifact(input.artifactId);
      const base = this.getRequiredVersionForArtifact(input.baseVersionId, input.artifactId);
      const left = this.getRequiredVersionForArtifact(input.leftVersionId, input.artifactId);
      const right = this.getRequiredVersionForArtifact(input.rightVersionId, input.artifactId);
      if (
        input.summary.baseHash !== base.contentHash ||
        input.summary.leftHash !== left.contentHash ||
        input.summary.rightHash !== right.contentHash
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'summary',
          'summary hashes do not match versions',
        );
      }
      const runRow = this.raw
        .prepare('SELECT state FROM run WHERE id = ?')
        .get(artifact.runId) as { state: RunState };
      const conflict: ArtifactMergeConflict = {
        id: ulid(),
        operationId,
        artifactId: input.artifactId,
        runId: artifact.runId,
        sourceStepId: input.sourceStepId,
        legacySourceStepUnknown: false,
        baseVersionId: input.baseVersionId,
        leftVersionId: input.leftVersionId,
        rightVersionId: input.rightVersionId,
        status: 'open',
        summary: { ...input.summary },
        expectedTaskVersion: input.expectedTaskVersion,
        resultingTaskVersion: input.resultingTaskVersion,
        createdAt: input.now ?? new Date().toISOString(),
      };
      this.raw
        .prepare(
          `INSERT INTO artifact_merge_conflict (
             id, operation_id, artifact_id, run_id, source_step_id, base_version_id,
             left_version_id, right_version_id, status, summary_json,
             expected_task_version, resulting_task_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
        )
        .run(
          conflict.id,
          conflict.operationId,
          conflict.artifactId,
          conflict.runId,
          conflict.sourceStepId,
          conflict.baseVersionId,
          conflict.leftVersionId,
          conflict.rightVersionId,
          JSON.stringify(conflict.summary),
          conflict.expectedTaskVersion,
          conflict.resultingTaskVersion,
          conflict.createdAt,
        );
      if (runRow.state !== 'paused') {
        const update = this.raw
          .prepare('UPDATE run SET state = ?, updated_at = ? WHERE id = ? AND state = ?')
          .run('paused', conflict.createdAt, artifact.runId, runRow.state);
        if (update.changes !== 1) {
          throw new ArtifactDataError(
            'artifact.invalid_input',
            'artifact.runId',
            'Run changed while recording merge conflict',
          );
        }
      }
      return { created: true, conflict };
    }).immediate();
  }

  getMergeOutcomeByOperationId(operationId: string): StoredMergeOutcome | undefined {
    const versionRow = this.raw
      .prepare(`SELECT ${VERSION_COLUMNS} FROM artifact_version WHERE operation_id = ?`)
      .get(operationId) as ArtifactVersionDbRow | undefined;
    const conflictRow = this.raw
      .prepare(`SELECT ${CONFLICT_COLUMNS} FROM artifact_merge_conflict WHERE operation_id = ?`)
      .get(operationId) as ArtifactMergeConflictDbRow | undefined;
    if (versionRow && conflictRow) {
      throw new ArtifactDataError(
        'artifact.invalid_record',
        'operationId',
        'operation has multiple outcomes',
      );
    }
    if (versionRow) {
      const version = mapVersion(versionRow);
      this.assertVersionOwnership(versionRow, version);
      this.assertPersistedParents(version);
      if (
        versionRow.merge_base_version_id === null ||
        versionRow.expected_task_version === null ||
        versionRow.resulting_task_version === null
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_version',
          'artifactVersion.operation',
          'missing merge operation fields',
        );
      }
      return {
        status: 'clean',
        version,
        baseVersionId: versionRow.merge_base_version_id as ArtifactVersionId,
        expectedTaskVersion: requireStoredTaskVersion(
          versionRow.expected_task_version,
          'artifactVersion.expectedTaskVersion',
        ),
        resultingTaskVersion: requireStoredTaskVersion(
          versionRow.resulting_task_version,
          'artifactVersion.resultingTaskVersion',
        ),
      };
    }
    if (!conflictRow) return undefined;
    const conflict = mapConflict(conflictRow);
    this.assertConflictOwnership(conflict);
    if (conflict.legacySourceStepUnknown) {
      throw new ArtifactDataError(
        'artifact.legacy_conflict_step_unknown',
        'operationId',
        'legacy conflict has no auditable source Step and cannot be replayed',
      );
    }
    return { status: 'conflict', conflict };
  }

  listMergeConflicts(artifactId: ArtifactId): ArtifactMergeConflict[] {
    const rows = this.raw
      .prepare(
        `SELECT ${CONFLICT_COLUMNS} FROM artifact_merge_conflict
         WHERE artifact_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(artifactId) as ArtifactMergeConflictDbRow[];
    return rows.map((row) => {
      const conflict = mapConflict(row);
      this.assertConflictOwnership(conflict);
      return conflict;
    });
  }

  getMergeConflict(id: string): ArtifactMergeConflict | undefined {
    const row = this.raw
      .prepare(`SELECT ${CONFLICT_COLUMNS} FROM artifact_merge_conflict WHERE id = ?`)
      .get(id) as ArtifactMergeConflictDbRow | undefined;
    if (!row) return undefined;
    const conflict = mapConflict(row);
    this.assertConflictOwnership(conflict);
    return conflict;
  }

  getMergeConflictForScope(
    id: string,
    scope: ArtifactScope,
  ): ArtifactMergeConflict | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${CONFLICT_COLUMNS} FROM artifact_merge_conflict
         WHERE id = ? AND artifact_id IN (
           SELECT id FROM artifact
           WHERE workspace_id = ? AND task_id = ? AND run_id = ?
         )`,
      )
      .get(id, scope.workspaceId, scope.taskId, scope.runId) as
      | ArtifactMergeConflictDbRow
      | undefined;
    if (!row) return undefined;
    const conflict = mapConflict(row);
    this.assertConflictOwnership(conflict);
    return conflict;
  }

  getConflictResolution(conflictId: string): ArtifactMergeConflictResolution | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${CONFLICT_RESOLUTION_COLUMNS}
         FROM artifact_merge_conflict_resolution WHERE conflict_id = ?`,
      )
      .get(conflictId) as ArtifactMergeConflictResolutionDbRow | undefined;
    return row ? mapConflictResolution(row) : undefined;
  }

  getConflictResolutionByOperationId(
    operationId: string,
  ): ArtifactMergeConflictResolution | undefined {
    const row = this.raw
      .prepare(
        `SELECT ${CONFLICT_RESOLUTION_COLUMNS}
         FROM artifact_merge_conflict_resolution WHERE operation_id = ?`,
      )
      .get(operationId) as ArtifactMergeConflictResolutionDbRow | undefined;
    return row ? mapConflictResolution(row) : undefined;
  }

  listMergeConflictsForScope(scope: ArtifactScope): StoredArtifactMergeConflictItem[] {
    const rows = this.raw
      .prepare(
        `SELECT ${CONFLICT_COLUMNS} FROM artifact_merge_conflict
         WHERE artifact_id IN (
           SELECT id FROM artifact
           WHERE workspace_id = ? AND task_id = ? AND run_id = ?
         )
         ORDER BY created_at ASC, id ASC`,
      )
      .all(scope.workspaceId, scope.taskId, scope.runId) as ArtifactMergeConflictDbRow[];
    return rows.map((row) => {
      const conflict = mapConflict(row);
      this.assertConflictOwnership(conflict);
      const resolution = this.getConflictResolution(conflict.id);
      return { conflict, ...(resolution ? { resolution } : {}) };
    });
  }

  hasUnresolvedMergeConflicts(runId: RunId): boolean {
    return Boolean(
      this.raw
        .prepare(
          `SELECT 1
           FROM artifact_merge_conflict AS conflict
           LEFT JOIN artifact_merge_conflict_resolution AS resolution
             ON resolution.conflict_id = conflict.id
           WHERE conflict.run_id = ? AND resolution.id IS NULL
           LIMIT 1`,
        )
        .get(runId),
    );
  }

  resolveMergeConflict(
    input: ResolveArtifactMergeConflictInput,
  ): {
    created: boolean;
    resolution: ArtifactMergeConflictResolution;
    version: ArtifactVersion;
  } {
    return this.raw.transaction(() => {
      const operationId = requireText(input.operationId, 'operationId');
      const existing = this.getConflictResolutionByOperationId(operationId);
      if (existing) {
        const version = this.getVersion(existing.resolutionVersionId);
        if (
          !version ||
          existing.conflictId !== input.conflictId ||
          existing.strategy !== input.strategy ||
          existing.expectedTaskVersion !== input.expectedTaskVersion ||
          existing.resultingTaskVersion !== input.resultingTaskVersion ||
          (input.strategy === 'manual' && version.content !== input.content)
        ) {
          throw new ArtifactDataError(
            'artifact.invalid_input',
            'operationId',
            'operation ID was reused with different conflict resolution input',
          );
        }
        return { created: false, resolution: existing, version };
      }
      if (
        this.getSelectionByOperationId(operationId) ||
        this.raw.prepare('SELECT 1 FROM artifact_version WHERE operation_id = ?').get(operationId) ||
        this.raw.prepare('SELECT 1 FROM artifact_merge_conflict WHERE operation_id = ?').get(operationId)
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'operationId',
          'operation ID belongs to a different artifact mutation',
        );
      }
      assertNextTaskVersion(input.expectedTaskVersion, input.resultingTaskVersion);
      const conflict = this.getMergeConflict(input.conflictId);
      if (!conflict) {
        throw new ArtifactDataError('artifact.invalid_input', 'conflictId', 'conflict not found');
      }
      if (conflict.legacySourceStepUnknown) {
        throw new ArtifactDataError(
          'artifact.legacy_conflict_step_unknown',
          'conflictId',
          'legacy conflict cannot be resolved without an auditable merge Step',
        );
      }
      if (this.getConflictResolution(conflict.id)) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'conflictId',
          'conflict already has an append-only resolution',
        );
      }
      const run = this.raw.prepare('SELECT state FROM run WHERE id = ?').get(conflict.runId) as
        | { state: RunState }
        | undefined;
      if (run?.state !== 'paused') {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'conflict.runId',
          'conflict resolution requires a paused Run',
        );
      }
      const base = this.getRequiredVersionForArtifact(conflict.baseVersionId, conflict.artifactId);
      const left = this.getRequiredVersionForArtifact(conflict.leftVersionId, conflict.artifactId);
      const right = this.getRequiredVersionForArtifact(conflict.rightVersionId, conflict.artifactId);
      if (
        base.mimeType !== left.mimeType ||
        base.mimeType !== right.mimeType ||
        base.content === undefined ||
        left.content === undefined ||
        right.content === undefined
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'conflict.versions',
          'conflict resolution requires inline versions with one MIME type',
        );
      }
      const content =
        input.strategy === 'left'
          ? left.content
          : input.strategy === 'right'
            ? right.content
            : input.content;
      if (content === undefined) {
        throw new ArtifactDataError(
          'artifact.invalid_input',
          'content',
          'manual conflict resolution requires content',
        );
      }
      const createdAt = input.now ?? new Date().toISOString();
      const version = this.createVersionInternal(
        {
          artifactId: conflict.artifactId,
          sourceStepId: conflict.sourceStepId,
          content,
          mimeType: base.mimeType,
          status: 'merged',
          parentVersionIds: [left.id, right.id],
          metadata: {
            mergeSource: `conflict-resolution:${input.strategy}`,
            conflictId: conflict.id,
          },
          now: createdAt,
        },
        {
          operationId,
          mergeBaseVersionId: base.id,
          expectedTaskVersion: input.expectedTaskVersion,
          resultingTaskVersion: input.resultingTaskVersion,
        },
      );
      const resolution: ArtifactMergeConflictResolution = {
        id: ulid(),
        operationId,
        conflictId: conflict.id,
        resolutionVersionId: version.id,
        strategy: input.strategy,
        expectedTaskVersion: input.expectedTaskVersion,
        resultingTaskVersion: input.resultingTaskVersion,
        createdAt,
      };
      this.raw
        .prepare(
          `INSERT INTO artifact_merge_conflict_resolution (
             id, operation_id, conflict_id, resolution_version_id, strategy,
             expected_task_version, resulting_task_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          resolution.id,
          resolution.operationId,
          resolution.conflictId,
          resolution.resolutionVersionId,
          resolution.strategy,
          resolution.expectedTaskVersion,
          resolution.resultingTaskVersion,
          resolution.createdAt,
        );
      return { created: true, resolution, version };
    }).immediate();
  }

  compareReferences(left: ArtifactVersion, right: ArtifactVersion): ArtifactComparison {
    return {
      kind: 'reference',
      equal: left.contentHash === right.contentHash,
      leftHash: left.contentHash,
      rightHash: right.contentHash,
    };
  }

  assertMergePreconditions(input: {
    artifactId: ArtifactId;
    baseVersionId: ArtifactVersionId;
    leftVersionId: ArtifactVersionId;
    rightVersionId: ArtifactVersionId;
    sourceStepId: StepId;
  }): void {
    this.raw.transaction(() => this.assertMergePreconditionsInternal(input)).immediate();
  }

  assertCommonAncestor(
    artifactId: ArtifactId,
    baseVersionId: ArtifactVersionId,
    leftVersionId: ArtifactVersionId,
    rightVersionId: ArtifactVersionId,
  ): void {
    this.raw
      .transaction(() =>
        this.assertCommonAncestorInternal(
          artifactId,
          baseVersionId,
          leftVersionId,
          rightVersionId,
        ),
      )
      .immediate();
  }

  private createVersionInternal(
    input: CreateArtifactVersionInput,
    operation?: {
      operationId: string;
      mergeBaseVersionId: ArtifactVersionId;
      expectedTaskVersion: number;
      resultingTaskVersion: number;
    },
  ): ArtifactVersion {
    const artifact = this.getRequiredArtifact(input.artifactId);
    const sourceStepId = requireText(input.sourceStepId, 'artifactVersion.sourceStepId') as StepId;
    const source = this.raw
      .prepare('SELECT id FROM step WHERE run_id = ? AND id = ?')
      .get(artifact.runId, sourceStepId);
    if (!source) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifactVersion.sourceStepId',
        'Step does not belong to artifact Run',
      );
    }
    if (!VERSION_STATUSES.has(input.status)) {
      throw new ArtifactDataError('artifact.invalid_input', 'artifactVersion.status');
    }
    const mimeType = requireMimeType(
      input.mimeType,
      'artifactVersion.mimeType',
      'artifact.invalid_input',
    );
    const hasContent = typeof input.content === 'string';
    const hasContentRef = typeof input.contentRef === 'string';
    if (hasContent === hasContentRef) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifactVersion.content',
        'provide exactly one of content or contentRef',
      );
    }
    if (
      input.content !== undefined &&
      Buffer.byteLength(input.content, 'utf8') > MAX_INLINE_ARTIFACT_CONTENT_BYTES
    ) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifactVersion.content',
        'content is too large',
      );
    }
    if (
      input.contentRef !== undefined &&
      (!input.contentRef.trim() ||
        !isLocalContentRef(input.contentRef))
    ) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifactVersion.contentRef',
        'contentRef must be a bounded local reference',
      );
    }
    const computedHash =
      input.content === undefined
        ? requireHash(
            input.contentHash,
            'artifactVersion.contentHash',
            'artifact.invalid_input',
          )
        : createHash('sha256').update(input.content, 'utf8').digest('hex');
    if (input.content !== undefined && input.contentHash !== undefined && input.contentHash !== computedHash) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifactVersion.contentHash',
        'hash does not match content',
      );
    }
    const parentVersionIds = [...(input.parentVersionIds ?? [])];
    if (
      parentVersionIds.length > MAX_PARENT_VERSIONS ||
      new Set(parentVersionIds).size !== parentVersionIds.length
    ) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifactVersion.parentVersionIds',
        'parents must be unique and bounded',
      );
    }
    for (const parentId of parentVersionIds) {
      this.getRequiredVersionForArtifact(parentId, artifact.id);
    }
    if (operation) this.getRequiredVersionForArtifact(operation.mergeBaseVersionId, artifact.id);
    const latest = this.raw
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM artifact_version WHERE artifact_id = ?')
      .get(artifact.id) as { version: number };
    const versionNumber = latest.version + 1;
    const version: ArtifactVersion = {
      id: ulid() as ArtifactVersionId,
      artifactId: artifact.id,
      ...(input.content === undefined ? {} : { content: input.content }),
      ...(input.contentRef === undefined ? {} : { contentRef: input.contentRef }),
      contentHash: computedHash,
      mimeType,
      sourceStepId,
      status: input.status,
      version: versionNumber,
      parentVersionIds,
      metadata: JSON.parse(encodeMetadata(input.metadata)) as Record<string, JsonValue>,
      createdAt: input.now ?? new Date().toISOString(),
    };
    this.raw
      .prepare(
        `INSERT INTO artifact_version (
           id, artifact_id, source_run_id, source_step_id, status, version,
           content, content_ref, content_hash, mime_type,
           parent_version_ids_json, metadata_json, operation_id,
           merge_base_version_id, expected_task_version, resulting_task_version,
           created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.artifactId,
        artifact.runId,
        version.sourceStepId,
        version.status,
        version.version,
        version.content ?? null,
        version.contentRef ?? null,
        version.contentHash,
        version.mimeType,
        JSON.stringify(version.parentVersionIds),
        JSON.stringify(version.metadata),
        operation?.operationId ?? null,
        operation?.mergeBaseVersionId ?? null,
        operation?.expectedTaskVersion ?? null,
        operation?.resultingTaskVersion ?? null,
        version.createdAt,
      );
    return version;
  }

  private assertMergePreconditionsInternal(input: {
    artifactId: ArtifactId;
    baseVersionId: ArtifactVersionId;
    leftVersionId: ArtifactVersionId;
    rightVersionId: ArtifactVersionId;
    sourceStepId: StepId;
  }): void {
    this.assertDistinctMergeVersions(input);
    const artifact = this.getRequiredArtifact(input.artifactId);
    const sourceStepId = requireText(input.sourceStepId, 'merge.sourceStepId') as StepId;
    const sourceStep = this.raw
      .prepare('SELECT 1 FROM step WHERE run_id = ? AND id = ?')
      .get(artifact.runId, sourceStepId);
    if (!sourceStep) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'merge.sourceStepId',
        'source Step does not belong to the Artifact Run',
      );
    }
    const run = this.raw
      .prepare('SELECT state FROM run WHERE id = ?')
      .get(artifact.runId) as { state: RunState } | undefined;
    if (!run || !MERGEABLE_RUN_STATES.has(run.state)) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifact.runId',
        'Run state does not allow Artifact merge',
      );
    }
    this.assertCommonAncestorInternal(
      artifact.id,
      input.baseVersionId,
      input.leftVersionId,
      input.rightVersionId,
    );
  }

  private assertCommonAncestorInternal(
    artifactId: ArtifactId,
    baseVersionId: ArtifactVersionId,
    leftVersionId: ArtifactVersionId,
    rightVersionId: ArtifactVersionId,
  ): void {
    this.assertDistinctMergeVersions({ baseVersionId, leftVersionId, rightVersionId });
    this.getRequiredVersionForArtifact(baseVersionId, artifactId);

    const collectAncestors = (rootId: ArtifactVersionId): Set<ArtifactVersionId> => {
      const visited = new Set<ArtifactVersionId>();
      const visiting = new Set<ArtifactVersionId>();
      const stack: Array<{ id: ArtifactVersionId; exit: boolean }> = [
        { id: rootId, exit: false },
      ];
      let nodeCount = 0;
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.exit) {
          visiting.delete(current.id);
          visited.add(current.id);
          continue;
        }
        if (visited.has(current.id)) continue;
        if (visiting.has(current.id)) {
          throw new ArtifactDataError(
            'artifact.invalid_version',
            'artifactVersion.parentVersionIds',
            'ancestry cycle detected',
          );
        }
        nodeCount += 1;
        if (nodeCount > MAX_ANCESTRY_NODES) {
          throw new ArtifactDataError(
            'artifact.invalid_version',
            'artifactVersion.parentVersionIds',
            'ancestry traversal limit exceeded',
          );
        }
        const row = this.getVersionRow(current.id);
        if (!row || row.artifact_id !== artifactId) {
          throw new ArtifactDataError(
            'artifact.invalid_version',
            'artifactVersion.parentVersionIds',
            'missing or cross-artifact ancestry node',
          );
        }
        const version = mapVersion(row);
        this.assertVersionOwnership(row, version);
        this.assertPersistedParents(version);
        visiting.add(current.id);
        stack.push({ id: current.id, exit: true });
        for (let index = version.parentVersionIds.length - 1; index >= 0; index -= 1) {
          stack.push({ id: version.parentVersionIds[index]!, exit: false });
        }
      }
      return visited;
    };

    const leftAncestors = collectAncestors(leftVersionId);
    const rightAncestors = collectAncestors(rightVersionId);
    if (!leftAncestors.has(baseVersionId) || !rightAncestors.has(baseVersionId)) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'merge.baseVersionId',
        'base version must be a common ancestor of both branches',
      );
    }
  }

  private assertVersionOwnership(
    row: ArtifactVersionDbRow,
    version: ArtifactVersion,
  ): void {
    const ownership = this.raw
      .prepare(
        `SELECT artifact.run_id AS artifact_run_id,
           artifact.task_id AS artifact_task_id,
           artifact.workspace_id AS artifact_workspace_id,
           task.workspace_id AS task_workspace_id,
           run.task_id AS run_task_id,
           EXISTS (
             SELECT 1 FROM step
             WHERE step.run_id = artifact_version.source_run_id
               AND step.id = artifact_version.source_step_id
           ) AS source_step_exists,
           merge_base.artifact_id AS merge_base_artifact_id
         FROM artifact_version
         LEFT JOIN artifact ON artifact.id = artifact_version.artifact_id
         LEFT JOIN task ON task.id = artifact.task_id
         LEFT JOIN run ON run.id = artifact.run_id
         LEFT JOIN artifact_version AS merge_base
           ON merge_base.id = artifact_version.merge_base_version_id
         WHERE artifact_version.id = ?`,
      )
      .get(version.id) as
      | {
          artifact_run_id: string | null;
          artifact_task_id: string | null;
          artifact_workspace_id: string | null;
          task_workspace_id: string | null;
          run_task_id: string | null;
          source_step_exists: number;
          merge_base_artifact_id: string | null;
        }
      | undefined;
    if (
      !ownership ||
      ownership.artifact_run_id !== row.source_run_id ||
      ownership.artifact_task_id !== ownership.run_task_id ||
      ownership.artifact_workspace_id !== ownership.task_workspace_id ||
      ownership.source_step_exists !== 1 ||
      (row.merge_base_version_id !== null &&
        ownership.merge_base_artifact_id !== version.artifactId)
    ) {
      throw new ArtifactDataError(
        'artifact.invalid_version',
        'artifactVersion.ownership',
        'Artifact, source, or merge-base ownership mismatch',
      );
    }
  }

  private assertSelectionOwnership(selection: ArtifactSelection): void {
    const row = this.raw
      .prepare('SELECT artifact_id FROM artifact_version WHERE id = ?')
      .get(selection.selectedVersionId) as { artifact_id: string } | undefined;
    if (!row || row.artifact_id !== selection.artifactId) {
      throw new ArtifactDataError(
        'artifact.invalid_selection',
        'artifactSelection.selectedVersionId',
        'selected version belongs to another Artifact',
      );
    }
  }

  private assertConflictOwnership(conflict: ArtifactMergeConflict): void {
    const ownership = this.raw
      .prepare(
        `SELECT artifact.run_id AS artifact_run_id,
           artifact.task_id AS artifact_task_id,
           artifact.workspace_id AS artifact_workspace_id,
           task.workspace_id AS task_workspace_id,
           run.task_id AS run_task_id,
           EXISTS (
             SELECT 1 FROM step WHERE step.run_id = artifact.run_id AND step.id = ?
           ) AS source_step_exists,
           base.artifact_id AS base_artifact_id,
           left_version.artifact_id AS left_artifact_id,
           right_version.artifact_id AS right_artifact_id
         FROM artifact_merge_conflict
         LEFT JOIN artifact ON artifact.id = artifact_merge_conflict.artifact_id
         LEFT JOIN task ON task.id = artifact.task_id
         LEFT JOIN run ON run.id = artifact.run_id
         LEFT JOIN artifact_version AS base ON base.id = artifact_merge_conflict.base_version_id
         LEFT JOIN artifact_version AS left_version
           ON left_version.id = artifact_merge_conflict.left_version_id
         LEFT JOIN artifact_version AS right_version
           ON right_version.id = artifact_merge_conflict.right_version_id
         WHERE artifact_merge_conflict.id = ?`,
      )
      .get(conflict.sourceStepId ?? null, conflict.id) as
      | {
          artifact_run_id: string | null;
          artifact_task_id: string | null;
          artifact_workspace_id: string | null;
          task_workspace_id: string | null;
          run_task_id: string | null;
          source_step_exists: number;
          base_artifact_id: string | null;
          left_artifact_id: string | null;
          right_artifact_id: string | null;
        }
      | undefined;
    if (
      !ownership ||
      ownership.artifact_run_id !== conflict.runId ||
      ownership.artifact_task_id !== ownership.run_task_id ||
      ownership.artifact_workspace_id !== ownership.task_workspace_id ||
      (!conflict.legacySourceStepUnknown && ownership.source_step_exists !== 1) ||
      ownership.base_artifact_id !== conflict.artifactId ||
      ownership.left_artifact_id !== conflict.artifactId ||
      ownership.right_artifact_id !== conflict.artifactId
    ) {
      throw new ArtifactDataError(
        'artifact.invalid_conflict',
        'artifactMergeConflict.ownership',
        'Artifact, Run, Step, or version ownership mismatch',
      );
    }
    this.getRequiredVersionForArtifact(conflict.baseVersionId, conflict.artifactId);
    this.getRequiredVersionForArtifact(conflict.leftVersionId, conflict.artifactId);
    this.getRequiredVersionForArtifact(conflict.rightVersionId, conflict.artifactId);
  }

  private getRequiredArtifact(id: ArtifactId): Artifact {
    const artifact = this.getArtifact(id);
    if (!artifact) {
      throw new ArtifactDataError('artifact.invalid_input', 'artifactId', 'Artifact not found');
    }
    return artifact;
  }

  private getRequiredVersionForArtifact(
    id: ArtifactVersionId,
    artifactId: ArtifactId,
  ): ArtifactVersion {
    const row = this.raw
      .prepare(`SELECT ${VERSION_COLUMNS} FROM artifact_version WHERE id = ? AND artifact_id = ?`)
      .get(id, artifactId) as ArtifactVersionDbRow | undefined;
    if (!row) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'artifactVersionId',
        'Version does not belong to Artifact',
      );
    }
    const version = mapVersion(row);
    this.assertVersionOwnership(row, version);
    this.assertPersistedParents(version);
    return version;
  }

  private getVersionRow(id: ArtifactVersionId): ArtifactVersionDbRow | undefined {
    return this.raw
      .prepare(`SELECT ${VERSION_COLUMNS} FROM artifact_version WHERE id = ?`)
      .get(id) as ArtifactVersionDbRow | undefined;
  }

  private assertPersistedParents(version: ArtifactVersion): void {
    for (const parentId of version.parentVersionIds) {
      const parentRow = this.raw
        .prepare('SELECT artifact_id, version FROM artifact_version WHERE id = ?')
        .get(parentId) as { artifact_id: string; version: number } | undefined;
      if (
        !parentRow ||
        parentRow.artifact_id !== version.artifactId ||
        !Number.isSafeInteger(parentRow.version) ||
        parentRow.version >= version.version
      ) {
        throw new ArtifactDataError(
          'artifact.invalid_version',
          'artifactVersion.parentVersionIds',
          'parent is missing, cross-artifact, or not older',
        );
      }
    }
  }

  private assertDistinctMergeVersions(input: {
    baseVersionId: ArtifactVersionId;
    leftVersionId: ArtifactVersionId;
    rightVersionId: ArtifactVersionId;
  }): void {
    if (new Set([input.baseVersionId, input.leftVersionId, input.rightVersionId]).size !== 3) {
      throw new ArtifactDataError(
        'artifact.invalid_input',
        'merge.versionIds',
        'base, left, and right versions must be distinct',
      );
    }
  }
}
