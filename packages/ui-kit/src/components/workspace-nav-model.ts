/** Presentation-level workspace/task shapes for left-nav IA (protocol-agnostic). */

export interface WorkspaceNavWorkspace {
  readonly workspaceId: string;
  readonly folderPath?: string;
  readonly name: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface WorkspaceNavTask {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly parentTaskId?: string;
  readonly title: string;
  readonly goal: string;
  readonly status: string;
  readonly participationMode?: 'conversation' | 'collaboration' | 'automatic';
  readonly taskVersion: number;
  readonly threadId: string;
  readonly lastOpenedAt?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface WorkspaceNavTaskNode {
  readonly task: WorkspaceNavTask;
  readonly children: readonly WorkspaceNavTaskNode[];
  readonly depth: number;
}

export interface WorkspaceNavFolder {
  readonly workspace: WorkspaceNavWorkspace;
  readonly tasks: readonly WorkspaceNavTaskNode[];
  readonly flatTasks: readonly WorkspaceNavTask[];
}

export interface WorkspaceNavModel {
  readonly folders: readonly WorkspaceNavFolder[];
  readonly lastOpenedTaskId: string | null;
  readonly totalTaskCount: number;
}

export function filterTasksByQuery(
  tasks: readonly WorkspaceNavTask[],
  query: string,
): WorkspaceNavTask[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...tasks];
  return tasks.filter(
    (task) => task.title.toLowerCase().includes(q) || task.goal.toLowerCase().includes(q),
  );
}

/**
 * Nest tasks under parents. Missing parents promote children to roots so the
 * tree never drops data (orphan-safe).
 */
export function buildTaskTree(tasks: readonly WorkspaceNavTask[]): WorkspaceNavTaskNode[] {
  const knownIds = new Set(tasks.map((task) => task.taskId));
  const byParent = new Map<string | null, WorkspaceNavTask[]>();

  for (const task of tasks) {
    const parentKey =
      task.parentTaskId && knownIds.has(task.parentTaskId) ? task.parentTaskId : null;
    const bucket = byParent.get(parentKey);
    if (bucket) bucket.push(task);
    else byParent.set(parentKey, [task]);
  }

  const walk = (parentId: string | null, depth: number): WorkspaceNavTaskNode[] => {
    const siblings = byParent.get(parentId) ?? [];
    return siblings.map((task) => ({
      task,
      depth,
      children: walk(task.taskId, depth + 1),
    }));
  };

  return walk(null, 0);
}

export function pickLastOpenedTaskId(tasks: readonly WorkspaceNavTask[]): string | null {
  let best: WorkspaceNavTask | null = null;
  for (const task of tasks) {
    if (!task.lastOpenedAt) continue;
    if (!best || !best.lastOpenedAt || task.lastOpenedAt > best.lastOpenedAt) {
      best = task;
    }
  }
  return best?.taskId ?? null;
}

export function buildWorkspaceNavModel(
  workspaces: readonly WorkspaceNavWorkspace[],
  tasksByWorkspace: ReadonlyMap<string, readonly WorkspaceNavTask[]>,
  query = '',
): WorkspaceNavModel {
  const folders: WorkspaceNavFolder[] = workspaces.map((workspace) => {
    const all = tasksByWorkspace.get(workspace.workspaceId) ?? [];
    const filtered = filterTasksByQuery(all, query);
    return {
      workspace,
      tasks: buildTaskTree(filtered),
      flatTasks: filtered,
    };
  });

  const unfilteredAll = workspaces.flatMap(
    (workspace) => tasksByWorkspace.get(workspace.workspaceId) ?? [],
  );

  return {
    folders,
    lastOpenedTaskId: pickLastOpenedTaskId(unfilteredAll),
    totalTaskCount: folders.reduce((sum, folder) => sum + folder.flatTasks.length, 0),
  };
}
