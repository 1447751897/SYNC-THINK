import type {
  ParticipationMode,
  TaskId,
  TaskStatus,
  ThreadId,
  WorkspaceId,
} from '@sync-think/shared';
import {
  AcceptanceCriteriaValidationError,
  isUntitledTaskTitle,
  normalizeAcceptanceCriteria,
  ulid,
} from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';
import { assertAllowedWorkspacePath, canonicalizeWorkspacePath } from './path-allowlist.js';

export interface CreateWorkspaceInput {
  folderPath?: string;
  name: string;
  /** Optional path roots that constrain new workspace folders. Empty = first-folder onboarding. */
  allowedRoots?: readonly string[];
  id?: WorkspaceId;
  now?: string;
}

export interface WorkspaceRecord {
  id: WorkspaceId;
  folderPath?: string;
  name: string;
  policyId?: string;
  uiPrefsJson?: string;
  /** Custom sort position in the folder tab row (from ui prefs). */
  sortOrder?: number;
  /** Hidden from the folder tab row (from ui prefs). */
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BindWorkspaceFolderInput {
  workspaceId: WorkspaceId;
  folderPath: string;
  allowedRoots?: readonly string[];
  now?: string;
}

export interface UpdateWorkspaceInput {
  workspaceId: WorkspaceId;
  name?: string;
  folderPath?: string;
  /** Icon glyph. null clears; undefined keeps current. */
  icon?: string | null;
  /** Custom sort position in the folder tab row. undefined keeps current. */
  sortOrder?: number;
  /** Hide from the folder tab row. undefined keeps current. */
  hidden?: boolean;
  allowedRoots?: readonly string[];
  now?: string;
}

export interface WorkspaceUiPrefs {
  icon?: string;
  /** Custom sort position in the folder tab row. */
  sortOrder?: number;
  /** Hidden from the folder tab row (data untouched). */
  hidden?: boolean;
}

export interface CreateTaskInput {
  workspaceId: WorkspaceId;
  title: string;
  goal: string;
  parentTaskId?: TaskId;
  acceptanceCriteria?: string[];
  id?: TaskId;
  threadId?: ThreadId;
  now?: string;
}

export interface CreateTaskResult {
  taskId: TaskId;
  threadId: ThreadId;
  taskVersion: number;
  participationMode: ParticipationMode;
  parentTaskId?: TaskId;
  title: string;
  goal: string;
  createdAt: string;
}

export interface TaskRecord {
  id: TaskId;
  workspaceId: WorkspaceId;
  parentTaskId?: TaskId;
  title: string;
  goal: string;
  status: TaskStatus;
  participationMode: ParticipationMode;
  acceptanceCriteria: string[];
  version: number;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
  threadId: ThreadId;
}

export interface AdvanceTaskVersionOptions {
  /** Applied only to a version-0 product placeholder in the same CAS transition. */
  generatedTitle?: string;
  generatedGoal?: string;
}

interface WorkspaceRow {
  id: string;
  folder_path: string | null;
  name: string;
  policy_id: string | null;
  ui_prefs_json: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  id: string;
  workspace_id: string;
  parent_task_id: string | null;
  title: string;
  goal: string;
  status: string;
  participation_mode: string;
  acceptance_criteria_json: string;
  version: number;
  last_opened_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TaskVersionEventPayloadRow {
  type: 'message.appended' | 'task.participation-mode.changed';
  task_id: string | null;
  payload_json: string;
}

interface TaskMessageVersionFloorRow {
  task_id: string;
  version: number;
}

export class SqliteWorkspaceStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  createWorkspace(input: CreateWorkspaceInput): WorkspaceRecord {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new Error('Workspace name must not be empty');
    }
    const folderPath =
      input.folderPath === undefined
        ? undefined
        : assertAllowedWorkspacePath(input.folderPath, input.allowedRoots ?? []);
    if (folderPath) {
      const existing = this.raw
        .prepare('SELECT id FROM workspace WHERE lower(folder_path) = lower(?)')
        .get(folderPath) as { id: string } | undefined;
      if (existing) {
        throw new Error(`Workspace already exists for folder path: ${folderPath}`);
      }
    }

    const now = input.now ?? new Date().toISOString();
    const id = (input.id ?? ulid()) as WorkspaceId;
    this.raw
      .prepare(
        `INSERT INTO workspace (id, folder_path, name, policy_id, ui_prefs_json, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(id, folderPath, name, now, now);

    return {
      id,
      folderPath,
      name,
      createdAt: now,
      updatedAt: now,
    };
  }

  bindWorkspaceFolder(input: BindWorkspaceFolderInput): WorkspaceRecord {
    const folderPath = assertAllowedWorkspacePath(input.folderPath, input.allowedRoots ?? []);
    const bind = this.raw.transaction(() => {
      const workspace = this.getWorkspace(input.workspaceId);
      if (!workspace) {
        throw new Error(`Workspace not found: ${input.workspaceId}`);
      }
      if (workspace.folderPath) {
        const currentFolderPath = canonicalizeWorkspacePath(workspace.folderPath);
        if (currentFolderPath.toLowerCase() === folderPath.toLowerCase()) {
          return workspace;
        }
        throw new Error(`Workspace already has a folder: ${workspace.folderPath}`);
      }

      const existing = this.raw
        .prepare('SELECT id FROM workspace WHERE lower(folder_path) = lower(?) AND id <> ?')
        .get(folderPath, input.workspaceId) as { id: string } | undefined;
      if (existing) {
        throw new Error(`Workspace already exists for folder path: ${folderPath}`);
      }

      const updatedAt = input.now ?? new Date().toISOString();
      const result = this.raw
        .prepare(
          `UPDATE workspace
           SET folder_path = ?, updated_at = ?
           WHERE id = ? AND folder_path IS NULL`,
        )
        .run(folderPath, updatedAt, input.workspaceId);
      if (result.changes !== 1) {
        throw new Error(`Workspace folder binding changed concurrently: ${input.workspaceId}`);
      }
      const updated = this.getWorkspace(input.workspaceId);
      if (!updated) {
        throw new Error(`Workspace not found after folder binding: ${input.workspaceId}`);
      }
      return updated;
    });
    return bind.immediate();
  }

  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, folder_path, name, policy_id, ui_prefs_json, created_at, updated_at
         FROM workspace
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as WorkspaceRow[];
    // Custom sort positions (uiPrefsJson.sortOrder) win; workspaces without a
    // position fall back to creation order and trail the positioned ones.
    return rows.map(mapWorkspace).sort((a, b) => {
      const ao = a.sortOrder;
      const bo = b.sortOrder;
      if (ao !== undefined && bo !== undefined) return ao - bo;
      if (ao !== undefined) return -1;
      if (bo !== undefined) return 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
  }

  getWorkspace(workspaceId: WorkspaceId): WorkspaceRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, folder_path, name, policy_id, ui_prefs_json, created_at, updated_at
         FROM workspace
         WHERE id = ?`,
      )
      .get(workspaceId) as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : undefined;
  }

  updateWorkspace(input: UpdateWorkspaceInput): WorkspaceRecord {
    const workspaceId = String(input.workspaceId ?? '').trim() as WorkspaceId;
    if (!workspaceId) throw new Error('Workspace id must not be empty');

    const update = this.raw.transaction(() => {
      const current = this.getWorkspace(workspaceId);
      if (!current) throw new Error(`Workspace not found: ${workspaceId}`);

      const name =
        input.name === undefined ? current.name : input.name.trim();
      if (name.length === 0) throw new Error('Workspace name must not be empty');

      let folderPath = current.folderPath;
      if (input.folderPath !== undefined) {
        folderPath = assertAllowedWorkspacePath(
          input.folderPath,
          input.allowedRoots ?? [],
        );
        const existing = this.raw
          .prepare(
            'SELECT id FROM workspace WHERE lower(folder_path) = lower(?) AND id <> ?',
          )
          .get(folderPath, workspaceId) as { id: string } | undefined;
        if (existing) {
          throw new Error(`Workspace already exists for folder path: ${folderPath}`);
        }
      }

      const prefs = parseWorkspaceUiPrefs(current.uiPrefsJson);
      if (input.icon !== undefined) {
        const icon = input.icon === null ? undefined : String(input.icon).trim() || undefined;
        if (icon) prefs.icon = icon;
        else delete prefs.icon;
      }
      if (input.sortOrder !== undefined) {
        prefs.sortOrder =
          Number.isFinite(input.sortOrder) ? Math.trunc(input.sortOrder) : undefined;
      }
      if (input.hidden !== undefined) {
        prefs.hidden = input.hidden;
      }
      const uiPrefsJson = serializeWorkspaceUiPrefs(prefs);

      const updatedAt = input.now ?? new Date().toISOString();
      this.raw
        .prepare(
          `UPDATE workspace
           SET name = ?, folder_path = ?, ui_prefs_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(name, folderPath ?? null, uiPrefsJson, updatedAt, workspaceId);

      const updated = this.getWorkspace(workspaceId);
      if (!updated) {
        throw new Error(`Workspace not found after update: ${workspaceId}`);
      }
      return updated;
    });
    return update.immediate();
  }

  deleteWorkspace(workspaceId: WorkspaceId): boolean {
    const id = String(workspaceId ?? '').trim();
    if (!id) return false;
    // Conversations / tasks that reference this workspace keep their FK rows
    // only if the schema allows it; for now we hard-delete the workspace row.
    // Callers should confirm with the user first.
    const result = this.raw.prepare(`DELETE FROM workspace WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  createTask(input: CreateTaskInput): CreateTaskResult {
    const title = input.title.trim();
    const goal = input.goal.trim();
    if (title.length === 0) throw new Error('Task title must not be empty');
    if (goal.length === 0) throw new Error('Task goal must not be empty');

    const workspace = this.getWorkspace(input.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }

    if (input.parentTaskId) {
      const parent = this.getTask(input.parentTaskId);
      if (!parent) {
        throw new Error(`Parent task not found: ${input.parentTaskId}`);
      }
      if (parent.workspaceId !== input.workspaceId) {
        throw new Error('Parent task must belong to the same workspace');
      }
    }

    const now = input.now ?? new Date().toISOString();
    const taskId = (input.id ?? ulid()) as TaskId;
    const threadId = (input.threadId ?? ulid()) as ThreadId;
    const acceptance = JSON.stringify(normalizeAcceptanceCriteria(input.acceptanceCriteria ?? []));

    const insert = this.raw.transaction(() => {
      this.raw
        .prepare(
          `INSERT INTO task (
            id, workspace_id, parent_task_id, title, goal, status,
            participation_mode, acceptance_criteria_json, version, last_opened_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', 'conversation', ?, 0, NULL, ?, ?)`,
        )
        .run(
          taskId,
          input.workspaceId,
          input.parentTaskId ?? null,
          title,
          goal,
          acceptance,
          now,
          now,
        );
      this.raw
        .prepare(`INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)`)
        .run(threadId, taskId, now);
    });
    insert.immediate();

    return {
      taskId,
      threadId,
      taskVersion: 0,
      participationMode: 'conversation',
      parentTaskId: input.parentTaskId,
      title,
      goal,
      createdAt: now,
    };
  }

  listTasks(
    workspaceId: WorkspaceId,
    options?: { includeArchived?: boolean },
  ): TaskRecord[] {
    const includeArchived = Boolean(options?.includeArchived);
    const rows = this.raw
      .prepare(
        `SELECT
          t.id, t.workspace_id, t.parent_task_id, t.title, t.goal, t.status,
          t.participation_mode, t.acceptance_criteria_json, t.version, t.last_opened_at,
          t.created_at, t.updated_at,
          th.id AS thread_id
         FROM task t
         INNER JOIN thread th ON th.task_id = t.id
         WHERE t.workspace_id = ?
           AND (? = 1 OR t.status != 'archived')
         ORDER BY t.created_at ASC, t.rowid ASC`,
      )
      .all(workspaceId, includeArchived ? 1 : 0) as Array<TaskRow & { thread_id: string }>;
    return rows.map((row) => mapTask(row, row.thread_id as ThreadId));
  }

  /**
   * Soft-archive a task (and optionally its descendants). Prefer archive over hard delete
   * so history / artifacts remain recoverable.
   */
  setTaskStatus(
    taskId: TaskId,
    status: 'active' | 'paused' | 'completed' | 'archived',
    expectedTaskVersion: number,
    options?: { cascade?: boolean; now?: string },
  ): { task: TaskRecord; affectedTaskIds: TaskId[] } {
    if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 0) {
      throw new Error('expectedTaskVersion must be a non-negative integer');
    }
    const cascade = options?.cascade !== false;
    const changedAt = options?.now ?? new Date().toISOString();

    const run = this.raw.transaction(() => {
      const root = this.getTask(taskId);
      if (!root) {
        throw new Error(`Task not found: ${taskId}`);
      }
      if (root.version !== expectedTaskVersion) {
        throw new Error(
          `Task version conflict: expected ${expectedTaskVersion}, actual ${root.version}`,
        );
      }

      const allInWorkspace = this.listTasks(root.workspaceId, { includeArchived: true });
      const targets = cascade
        ? collectTaskSubtreeIds(allInWorkspace, taskId)
        : [taskId];

      const affected: TaskId[] = [];
      for (const id of targets) {
        const current = this.getTask(id);
        if (!current) continue;
        if (current.status === status) {
          affected.push(id);
          continue;
        }
        const result = this.raw
          .prepare(
            `UPDATE task
             SET status = ?, version = version + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(status, changedAt, id);
        if (result.changes === 1) affected.push(id);
      }

      const updated = this.getTask(taskId);
      if (!updated) {
        throw new Error(`Task not found after status update: ${taskId}`);
      }
      return { task: updated, affectedTaskIds: affected };
    });

    return run.immediate();
  }

  getTask(taskId: TaskId): TaskRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT
          t.id, t.workspace_id, t.parent_task_id, t.title, t.goal, t.status,
          t.participation_mode, t.acceptance_criteria_json, t.version, t.last_opened_at,
          t.created_at, t.updated_at,
          th.id AS thread_id
         FROM task t
         INNER JOIN thread th ON th.task_id = t.id
         WHERE t.id = ?`,
      )
      .get(taskId) as (TaskRow & { thread_id: string }) | undefined;
    return row ? mapTask(row, row.thread_id as ThreadId) : undefined;
  }

  setParticipationMode(
    taskId: TaskId,
    mode: ParticipationMode,
    expectedTaskVersion: number,
    now?: string,
  ): TaskRecord {
    if (mode !== 'conversation' && mode !== 'collaboration' && mode !== 'automatic') {
      throw new Error(`Unsupported participation mode: ${String(mode)}`);
    }
    if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 0) {
      throw new Error('expectedTaskVersion must be a non-negative integer');
    }

    const changedAt = now ?? new Date().toISOString();
    const update = this.raw.transaction(() => {
      const result = this.raw
        .prepare(
          `UPDATE task
           SET participation_mode = ?, version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(mode, changedAt, taskId, expectedTaskVersion);

      if (result.changes !== 1) {
        const current = this.raw
          .prepare('SELECT version FROM task WHERE id = ?')
          .get(taskId) as { version: number } | undefined;
        if (!current) {
          throw new Error(`Task not found: ${taskId}`);
        }
        throw new Error(
          `Task version conflict: expected ${expectedTaskVersion}, actual ${current.version}`,
        );
      }

      const updated = this.getTask(taskId);
      if (!updated) {
        throw new Error(`Task not found after participation mode update: ${taskId}`);
      }
      return updated;
    });

    return update.immediate();
  }

  openTask(taskId: TaskId, now?: string): TaskRecord {
    const existing = this.getTask(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const openedAt = now ?? new Date().toISOString();
    this.raw
      .prepare(
        `UPDATE task SET last_opened_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(openedAt, openedAt, taskId);
    const updated = this.getTask(taskId);
    if (!updated) {
      throw new Error(`Task not found after open: ${taskId}`);
    }
    return updated;
  }


  getTaskByThreadId(threadId: ThreadId): TaskRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT
          t.id, t.workspace_id, t.parent_task_id, t.title, t.goal, t.status,
          t.participation_mode, t.acceptance_criteria_json, t.version, t.last_opened_at,
          t.created_at, t.updated_at,
          th.id AS thread_id
         FROM task t
         INNER JOIN thread th ON th.task_id = t.id
         WHERE th.id = ?`,
      )
      .get(threadId) as (TaskRow & { thread_id: string }) | undefined;
    return row ? mapTask(row, row.thread_id as ThreadId) : undefined;
  }

  advanceTaskVersionByThreadId(
    threadId: ThreadId,
    expectedTaskVersion: number,
    now?: string,
    options?: AdvanceTaskVersionOptions,
  ): TaskRecord {
    if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 0) {
      throw new Error('expectedTaskVersion must be a non-negative integer');
    }
    const changedAt = now ?? new Date().toISOString();
    const advance = this.raw.transaction(() => {
      const current = this.getTaskByThreadId(threadId);
      if (!current) throw new Error(`Task not found for thread: ${threadId}`);
      if (current.version !== expectedTaskVersion) {
        throw new Error(
          `Task version conflict: expected ${expectedTaskVersion}, actual ${current.version}`,
        );
      }
      const generatedTitle = options?.generatedTitle?.trim();
      const generatedGoal = options?.generatedGoal?.trim();
      const shouldGenerateIdentity =
        current.version === 0 &&
        isUntitledTaskTitle(current.title) &&
        Boolean(generatedTitle && generatedGoal);
      const result = shouldGenerateIdentity
        ? this.raw
            .prepare(
              `UPDATE task
               SET title = ?, goal = ?, version = version + 1, updated_at = ?
               WHERE id = ? AND version = ?`,
            )
            .run(generatedTitle, generatedGoal, changedAt, current.id, expectedTaskVersion)
        : this.raw
            .prepare(
              `UPDATE task
               SET version = version + 1, updated_at = ?
               WHERE id = ? AND version = ?`,
            )
            .run(changedAt, current.id, expectedTaskVersion);

      if (result.changes !== 1) {
        const latest = this.getTaskByThreadId(threadId);
        if (!latest) throw new Error(`Task not found for thread: ${threadId}`);
        throw new Error(
          `Task version conflict: expected ${expectedTaskVersion}, actual ${latest.version}`,
        );
      }

      const updated = this.getTaskByThreadId(threadId);
      if (!updated) throw new Error(`Task not found after version advance: ${threadId}`);
      return updated;
    });
    return advance.immediate();
  }

  /**
   * Fast startup repair for task concurrency tokens. Durable message sequences are
   * monotonic per thread, so they establish a safe lower bound without replaying
   * the potentially large legacy event table.
   */
  reconcileTaskVersionFloorsFromMessages(now?: string): number {
    const rows = this.raw
      .prepare(
        `SELECT th.task_id, MAX(m.sequence) AS version
         FROM thread AS th
         INNER JOIN message AS m INDEXED BY message_thread_sequence_uidx
           ON m.thread_id = th.id
         GROUP BY th.task_id`,
      )
      .all() as TaskMessageVersionFloorRow[];
    const changedAt = now ?? new Date().toISOString();
    const reconcile = this.raw.transaction(() => {
      let updatedTasks = 0;
      const update = this.raw.prepare(
        `UPDATE task
         SET version = ?, updated_at = ?
         WHERE id = ? AND version < ?`,
      );
      for (const row of rows) {
        if (!Number.isSafeInteger(row.version) || row.version < 0) continue;
        updatedTasks += update.run(row.version, changedAt, row.task_id, row.version).changes;
      }
      return updatedTasks;
    });
    return reconcile.immediate();
  }

  /**
   * Startup-compatible legacy repair. Looking up each durable task through
   * event_task_idx avoids scanning unrelated task-less telemetry events.
   */
  reconcileTaskVersionFloorsFromTaskEvents(now?: string): number {
    const tasks = this.raw.prepare('SELECT id FROM task').all() as Array<{ id: string }>;
    const eventsByTask = this.raw.prepare(
      `SELECT type, task_id, payload_json
       FROM event INDEXED BY event_task_idx
       WHERE task_id = ?
         AND type IN ('message.appended', 'task.participation-mode.changed')`,
    );
    const maxVersionByTask = new Map<string, number>();
    for (const task of tasks) {
      const rows = eventsByTask.all(task.id) as TaskVersionEventPayloadRow[];
      for (const row of rows) {
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload_json);
        } catch {
          continue;
        }
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
        const taskVersion = (payload as Record<string, unknown>).taskVersion;
        if (!Number.isSafeInteger(taskVersion) || (taskVersion as number) < 0) continue;
        maxVersionByTask.set(
          task.id,
          Math.max(maxVersionByTask.get(task.id) ?? 0, taskVersion as number),
        );
      }
    }

    const changedAt = now ?? new Date().toISOString();
    const reconcile = this.raw.transaction(() => {
      let updatedTasks = 0;
      const update = this.raw.prepare(
        `UPDATE task
         SET version = ?, updated_at = ?
         WHERE id = ? AND version < ?`,
      );
      for (const [taskId, version] of maxVersionByTask) {
        updatedTasks += update.run(version, changedAt, taskId, version).changes;
      }
      return updatedTasks;
    });
    return reconcile.immediate();
  }

  /** Legacy maintenance repair that replays historical version-bearing events. */
  reconcileTaskVersionsFromMessageEvents(now?: string): number {
    const rows = this.raw
      .prepare(
        `SELECT type, task_id, payload_json
         FROM event
         WHERE type IN ('message.appended', 'task.participation-mode.changed')`,
      )
      .all() as TaskVersionEventPayloadRow[];
    const taskByThread = this.raw.prepare('SELECT task_id FROM thread WHERE id = ?');
    const maxVersionByTask = new Map<string, number>();
    for (const row of rows) {
      let payload: unknown;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        continue;
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
      const value = payload as Record<string, unknown>;
      if (
        !Number.isInteger(value.taskVersion) ||
        (value.taskVersion as number) < 0
      ) {
        continue;
      }

      let taskId = row.task_id ?? undefined;
      if (!taskId && row.type === 'message.appended' && typeof value.threadId === 'string') {
        const thread = taskByThread.get(value.threadId) as { task_id: string } | undefined;
        taskId = thread?.task_id;
      }
      if (
        !taskId &&
        row.type === 'task.participation-mode.changed' &&
        typeof value.taskId === 'string' &&
        value.taskId.length > 0
      ) {
        taskId = value.taskId;
      }
      if (!taskId) continue;

      const version = value.taskVersion as number;
      maxVersionByTask.set(
        taskId,
        Math.max(maxVersionByTask.get(taskId) ?? 0, version),
      );
    }

    const changedAt = now ?? new Date().toISOString();
    const reconcile = this.raw.transaction(() => {
      let updatedTasks = 0;
      const update = this.raw.prepare(
        `UPDATE task
         SET version = ?, updated_at = ?
         WHERE id = ? AND version < ?`,
      );
      for (const [taskId, version] of maxVersionByTask) {
        updatedTasks += update.run(version, changedAt, taskId, version).changes;
      }
      return updatedTasks;
    });
    return reconcile.immediate();
  }

  getLastOpenedTask(workspaceId: WorkspaceId): TaskRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT
          t.id, t.workspace_id, t.parent_task_id, t.title, t.goal, t.status,
          t.participation_mode, t.acceptance_criteria_json, t.version, t.last_opened_at,
          t.created_at, t.updated_at,
          th.id AS thread_id
         FROM task t
         INNER JOIN thread th ON th.task_id = t.id
         WHERE t.workspace_id = ? AND t.last_opened_at IS NOT NULL
         ORDER BY t.last_opened_at DESC, t.id DESC
         LIMIT 1`,
      )
      .get(workspaceId) as (TaskRow & { thread_id: string }) | undefined;
    return row ? mapTask(row, row.thread_id as ThreadId) : undefined;
  }

  searchTasks(
    workspaceId: WorkspaceId,
    query: string,
    options?: { includeArchived?: boolean },
  ): TaskRecord[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];
    const includeArchived = Boolean(options?.includeArchived);
    const rows = this.raw
      .prepare(
        `SELECT
          t.id, t.workspace_id, t.parent_task_id, t.title, t.goal, t.status,
          t.participation_mode, t.acceptance_criteria_json, t.version, t.last_opened_at,
          t.created_at, t.updated_at,
          th.id AS thread_id
         FROM task t
         INNER JOIN thread th ON th.task_id = t.id
         WHERE t.workspace_id = ?
           AND (? = 1 OR t.status != 'archived')
           AND (
             lower(t.title) LIKE ? ESCAPE '\\'
             OR lower(t.goal) LIKE ? ESCAPE '\\'
           )
         ORDER BY t.updated_at DESC, t.id ASC`,
      )
      .all(
        workspaceId,
        includeArchived ? 1 : 0,
        `%${escapeLike(needle)}%`,
        `%${escapeLike(needle)}%`,
      ) as Array<TaskRow & { thread_id: string }>;
    return rows.map((row) => mapTask(row, row.thread_id as ThreadId));
  }

  /** Exposed for tests / callers that already hold a raw path string. */
  canonicalizeFolderPath(folderPath: string): string {
    return canonicalizeWorkspacePath(folderPath);
  }
}

/** Root first, then depth-first descendants (parent before children not required for status). */
function collectTaskSubtreeIds(
  tasks: readonly Pick<TaskRecord, 'id' | 'parentTaskId'>[],
  rootId: TaskId,
): TaskId[] {
  const byParent = new Map<string, TaskId[]>();
  for (const task of tasks) {
    const key = task.parentTaskId ? String(task.parentTaskId) : '';
    const bucket = byParent.get(key);
    if (bucket) bucket.push(task.id);
    else byParent.set(key, [task.id]);
  }
  const ordered: TaskId[] = [];
  const walk = (id: TaskId) => {
    ordered.push(id);
    for (const childId of byParent.get(String(id)) ?? []) walk(childId);
  };
  walk(rootId);
  return ordered;
}

function mapWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id as WorkspaceId,
    folderPath: row.folder_path ?? undefined,
    name: row.name,
    policyId: row.policy_id ?? undefined,
    uiPrefsJson: row.ui_prefs_json ?? undefined,
    sortOrder: workspaceSortOrderFromPrefs(row.ui_prefs_json ?? undefined),
    hidden: workspaceHiddenFromPrefs(row.ui_prefs_json ?? undefined),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseWorkspaceUiPrefs(raw: string | undefined): WorkspaceUiPrefs {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const icon =
      typeof (parsed as { icon?: unknown }).icon === 'string'
        ? String((parsed as { icon: string }).icon).trim()
        : '';
    const sortOrder =
      typeof (parsed as { sortOrder?: unknown }).sortOrder === 'number' &&
      Number.isFinite((parsed as { sortOrder: number }).sortOrder)
        ? Math.trunc((parsed as { sortOrder: number }).sortOrder)
        : undefined;
    const hidden =
      typeof (parsed as { hidden?: unknown }).hidden === 'boolean'
        ? (parsed as { hidden: boolean }).hidden
        : undefined;
    return {
      ...(icon ? { icon } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      ...(hidden !== undefined ? { hidden } : {}),
    };
  } catch {
    return {};
  }
}

export function serializeWorkspaceUiPrefs(prefs: WorkspaceUiPrefs): string | null {
  const icon = prefs.icon?.trim();
  const sortOrder =
    typeof prefs.sortOrder === 'number' && Number.isFinite(prefs.sortOrder)
      ? Math.trunc(prefs.sortOrder)
      : undefined;
  const out: Record<string, unknown> = {};
  if (icon) out.icon = icon;
  if (sortOrder !== undefined) out.sortOrder = sortOrder;
  if (prefs.hidden !== undefined) out.hidden = prefs.hidden;
  if (Object.keys(out).length === 0) return null;
  return JSON.stringify(out);
}

export function workspaceIconFromPrefs(uiPrefsJson: string | undefined): string | undefined {
  return parseWorkspaceUiPrefs(uiPrefsJson).icon;
}

export function workspaceSortOrderFromPrefs(uiPrefsJson: string | undefined): number | undefined {
  return parseWorkspaceUiPrefs(uiPrefsJson).sortOrder;
}

export function workspaceHiddenFromPrefs(uiPrefsJson: string | undefined): boolean {
  return parseWorkspaceUiPrefs(uiPrefsJson).hidden === true;
}

function mapTask(row: TaskRow, threadId: ThreadId): TaskRecord {
  let parsedAcceptanceCriteria: unknown;
  try {
    parsedAcceptanceCriteria = JSON.parse(row.acceptance_criteria_json);
  } catch {
    throw new AcceptanceCriteriaValidationError('acceptance_criteria.invalid');
  }
  const acceptanceCriteria = normalizeAcceptanceCriteria(parsedAcceptanceCriteria);
  return {
    id: row.id as TaskId,
    workspaceId: row.workspace_id as WorkspaceId,
    parentTaskId: row.parent_task_id ? (row.parent_task_id as TaskId) : undefined,
    title: row.title,
    goal: row.goal,
    status: row.status as TaskStatus,
    participationMode: parseParticipationMode(row.participation_mode),
    acceptanceCriteria,
    version: row.version,
    lastOpenedAt: row.last_opened_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    threadId,
  };
}

function parseParticipationMode(value: string): ParticipationMode {
  if (value === 'conversation' || value === 'collaboration' || value === 'automatic') {
    return value;
  }
  throw new Error(`Invalid participation mode in task row: ${String(value)}`);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
