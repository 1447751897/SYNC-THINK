import type { WorkspaceId, TaskId, ThreadId } from './ids.js';

export type TaskStatus =
  | 'active'
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
