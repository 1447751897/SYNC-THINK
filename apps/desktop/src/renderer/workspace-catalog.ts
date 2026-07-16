import type { TaskSummary, WorkspaceSummary } from '@sync-think/protocol';

export interface ActiveTaskSelection {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly title: string;
  readonly goal: string;
  readonly folderPath?: string;
  readonly workspaceName: string;
  readonly taskVersion: number;
  readonly status: string;
  readonly participationMode: TaskSummary['participationMode'];
}

export interface WorkspaceCatalogState {
  readonly workspaces: readonly WorkspaceSummary[];
  readonly tasksByWorkspace: ReadonlyMap<string, readonly TaskSummary[]>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly active: ActiveTaskSelection | null;
}

export function resolveExpectedTaskVersion(
  catalogVersion: number | null | undefined,
  hydratedVersion: number | null | undefined,
): number {
  return Math.max(0, catalogVersion ?? 0, hydratedVersion ?? 0);
}

export function createEmptyWorkspaceCatalog(): WorkspaceCatalogState {
  return {
    workspaces: [],
    tasksByWorkspace: new Map(),
    loading: false,
    error: null,
    active: null,
  };
}

export function pickLastOpenedTaskId(
  tasks: readonly { readonly taskId: string; readonly lastOpenedAt?: string }[],
): string | null {
  let best: { taskId: string; lastOpenedAt: string } | null = null;
  for (const task of tasks) {
    if (!task.lastOpenedAt) continue;
    if (!best || task.lastOpenedAt > best.lastOpenedAt) {
      best = { taskId: task.taskId, lastOpenedAt: task.lastOpenedAt };
    }
  }
  return best?.taskId ?? null;
}

export function resolvePreferredTask(
  workspaces: readonly WorkspaceSummary[],
  tasksByWorkspace: ReadonlyMap<string, readonly TaskSummary[]>,
  preferredTaskId?: string | null,
): ActiveTaskSelection | null {
  const allTasks = workspaces.flatMap(
    (workspace) => tasksByWorkspace.get(workspace.workspaceId) ?? [],
  );
  if (allTasks.length === 0) return null;

  const lastOpenedId = pickLastOpenedTaskId(allTasks);
  const preferred =
    (preferredTaskId ? allTasks.find((task) => task.taskId === preferredTaskId) : undefined) ??
    (lastOpenedId ? allTasks.find((task) => task.taskId === lastOpenedId) : undefined) ??
    allTasks[0];

  if (!preferred) return null;
  const workspace = workspaces.find((item) => item.workspaceId === preferred.workspaceId);
  if (!workspace) return null;

  return {
    taskId: preferred.taskId,
    workspaceId: preferred.workspaceId,
    threadId: preferred.threadId,
    title: preferred.title,
    goal: preferred.goal,
    folderPath: workspace.folderPath,
    workspaceName: workspace.name,
    taskVersion: preferred.taskVersion,
    status: preferred.status,
    participationMode: preferred.participationMode,
  };
}

export function upsertTaskInMap(
  tasksByWorkspace: ReadonlyMap<string, readonly TaskSummary[]>,
  task: TaskSummary,
): Map<string, readonly TaskSummary[]> {
  const next = new Map(tasksByWorkspace);
  const existing = next.get(task.workspaceId) ?? [];
  const without = existing.filter((item) => item.taskId !== task.taskId);
  next.set(task.workspaceId, [...without, task]);
  return next;
}
