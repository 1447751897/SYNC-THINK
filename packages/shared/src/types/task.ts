import type { WorkspaceId, TaskId, ThreadId } from './ids.js';
import type { ExecutionMode } from './enums.js';

export type TaskStatus =
  | 'active'
  | 'blocked'
  | 'paused'
  | 'completed'
  | 'archived';

export interface Task {
  id: TaskId;
  workspaceId: WorkspaceId;
  /** Optional parent task for explicit cross-task references (§5.1). */
  parentTaskId?: TaskId;
  title: string;
  goal: string;
  status: TaskStatus;
  /**
   * Codex three-mode execution authority for this task.
   * Legacy rows without the column resolve to workspace at Runtime.
   */
  executionMode?: ExecutionMode;
  /** User-defined, visible before autonomous execution (§5.5). */
  acceptanceCriteria: string[];
  createdAt: string;
  updatedAt: string;
  /** Threads hold ordered messages; a task may contain plain chat without a Run. */
  threadIds: ThreadId[];
  /** last-opened memory for resuming on app restart. */
  lastOpenedAt?: string;
}

export interface Thread {
  id: ThreadId;
  taskId: TaskId;
  /** Ordered list of message IDs — append-only. */
  messageIds: string[];
  createdAt: string;
}
