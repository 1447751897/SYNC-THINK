/** Parent-task surface: direct children for Multica-style progress chips. */

export interface ChildTaskSource {
  taskId: string;
  parentTaskId?: string | null;
  title: string;
  goal?: string;
  status: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface ChildTaskView {
  taskId: string;
  title: string;
  goal: string;
  status: string;
  statusLabel: string;
  /** active | done | paused | blocked-like */
  tone: 'active' | 'done' | 'paused' | 'idle' | 'archived';
}

export interface ParentTaskLink {
  taskId: string;
  title: string;
}

export function taskStatusLabelZh(status: string): string {
  if (status === 'active') return '进行中';
  if (status === 'paused') return '已暂停';
  if (status === 'completed') return '已完成';
  if (status === 'archived') return '已归档';
  return '等待开始';
}

function toneForStatus(status: string): ChildTaskView['tone'] {
  if (status === 'completed') return 'done';
  if (status === 'paused') return 'paused';
  if (status === 'archived') return 'archived';
  if (status === 'active') return 'active';
  return 'idle';
}

/** Direct children of parentTaskId, newest activity first. */
export function projectChildTasks(
  tasks: readonly ChildTaskSource[],
  parentTaskId: string | null | undefined,
): ChildTaskView[] {
  if (!parentTaskId) return [];
  return tasks
    .filter((task) => String(task.parentTaskId ?? '') === parentTaskId)
    .slice()
    .sort((a, b) => {
      const aTime = a.updatedAt || a.createdAt || '';
      const bTime = b.updatedAt || b.createdAt || '';
      return bTime.localeCompare(aTime);
    })
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      goal: task.goal ?? '',
      status: task.status,
      statusLabel: taskStatusLabelZh(task.status),
      tone: toneForStatus(task.status),
    }));
}

export function findParentTaskLink(
  tasks: readonly ChildTaskSource[],
  current: { taskId: string; parentTaskId?: string | null } | null | undefined,
): ParentTaskLink | null {
  if (!current?.parentTaskId) return null;
  const parent = tasks.find((task) => task.taskId === current.parentTaskId);
  if (!parent) return null;
  return { taskId: parent.taskId, title: parent.title };
}

export function summarizeChildTasks(children: readonly ChildTaskView[]): string {
  if (children.length === 0) return '';
  const active = children.filter((c) => c.tone === 'active').length;
  const done = children.filter((c) => c.tone === 'done').length;
  const paused = children.filter((c) => c.tone === 'paused').length;
  const parts: string[] = [`${children.length} 项`];
  if (active) parts.push(`${active} 进行中`);
  if (done) parts.push(`${done} 完成`);
  if (paused) parts.push(`${paused} 暂停`);
  return parts.join(' · ');
}
