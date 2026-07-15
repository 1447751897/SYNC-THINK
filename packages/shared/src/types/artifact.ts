import type {
  ArtifactId,
  ArtifactVersionId,
  RunId,
  StepId,
  TaskId,
  WorkspaceId,
} from './ids.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const MAX_INLINE_ARTIFACT_CONTENT_BYTES = 48 * 1024;

export type ArtifactVersionStatus =
  | 'candidate'
  | 'selected'
  | 'rejected'
  | 'incomplete'
  | 'merged';

export interface Artifact {
  id: ArtifactId;
  workspaceId: WorkspaceId;
  taskId: TaskId;
  runId: RunId;
  name: string;
  createdAt: string;
}

export interface ArtifactVersion {
  id: ArtifactVersionId;
  artifactId: ArtifactId;
  content?: string;
  contentRef?: string;
  contentHash: string;
  mimeType: string;
  sourceStepId: StepId;
  status: ArtifactVersionStatus;
  version: number;
  parentVersionIds: ArtifactVersionId[];
  metadata: Record<string, JsonValue>;
  createdAt: string;
}

export interface ArtifactVersionSummary
  extends Omit<ArtifactVersion, 'content' | 'contentRef' | 'metadata'> {
  hasInlineContent: boolean;
  hasContentRef: boolean;
}

export interface ArtifactSelection {
  id: string;
  operationId: string;
  artifactId: ArtifactId;
  selectedVersionId: ArtifactVersionId;
  expectedTaskVersion: number;
  resultingTaskVersion: number;
  createdAt: string;
}

export interface ArtifactMergeConflictSummary {
  baseHash: string;
  leftHash: string;
  rightHash: string;
}

interface ArtifactMergeConflictBase {
  id: string;
  operationId: string;
  artifactId: ArtifactId;
  runId: RunId;
  baseVersionId: ArtifactVersionId;
  leftVersionId: ArtifactVersionId;
  rightVersionId: ArtifactVersionId;
  status: 'open';
  summary: ArtifactMergeConflictSummary;
  expectedTaskVersion: number;
  resultingTaskVersion: number;
  createdAt: string;
}

export type ArtifactMergeConflict = ArtifactMergeConflictBase &
  (
    | {
        sourceStepId: StepId;
        legacySourceStepUnknown: false;
      }
    | {
        sourceStepId?: never;
        legacySourceStepUnknown: true;
      }
  );

export type ArtifactMergeConflictResolutionStrategy = 'left' | 'right' | 'manual';

export interface ArtifactMergeConflictResolution {
  id: string;
  operationId: string;
  conflictId: string;
  resolutionVersionId: ArtifactVersionId;
  strategy: ArtifactMergeConflictResolutionStrategy;
  expectedTaskVersion: number;
  resultingTaskVersion: number;
  createdAt: string;
}

export interface ArtifactTextDiffHunk {
  leftStartLine: number;
  rightStartLine: number;
  removedLines: string[];
  addedLines: string[];
}

export interface ArtifactTextComparison {
  kind: 'text';
  equal: boolean;
  hunks: ArtifactTextDiffHunk[];
}

export interface ArtifactReferenceComparison {
  kind: 'reference';
  equal: boolean;
  leftHash: string;
  rightHash: string;
}

export type ArtifactComparison = ArtifactTextComparison | ArtifactReferenceComparison;
