import type {
  BrowserIdentityId,
  ExecutionProfileId,
  ProjectResourceId,
  RunId,
  TaskId,
  WorkspaceId,
} from './ids.js';

export type ProjectResourceType = 'local_directory' | 'git_repository';
export type TaskExecutionMode = 'none' | 'local_serial' | 'managed_worktree';
export type TaskExecutionState =
  | 'pending'
  | 'ready'
  | 'blocked'
  | 'cleanup_pending'
  | 'retained'
  | 'cleaned';

export interface ProjectResource {
  id: ProjectResourceId;
  workspaceId: WorkspaceId;
  type: ProjectResourceType;
  localPath?: string;
  repositoryUrl?: string;
  defaultRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserIdentity {
  id: BrowserIdentityId;
  name: string;
  profilePath: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionProfile {
  id: ExecutionProfileId;
  workspaceId?: WorkspaceId;
  name: string;
  mode: 'auto' | 'local' | 'managed_worktree';
  defaultRef?: string;
  setupCommands: string[];
  includePatterns: string[];
  retentionDays: number;
  browserIdentityId?: BrowserIdentityId;
  createdAt: string;
  updatedAt: string;
}

export interface TaskExecutionContext {
  taskId: TaskId;
  resourceId?: ProjectResourceId;
  executionProfileId?: ExecutionProfileId;
  browserIdentityId?: BrowserIdentityId;
  mode: TaskExecutionMode;
  state: TaskExecutionState;
  sourcePath?: string;
  executionPath?: string;
  baseRef?: string;
  headRef?: string;
  leaseOwnerRunId?: RunId;
  blockedReason?: string;
  cleanupAfter?: string;
  createdAt: string;
  updatedAt: string;
}
