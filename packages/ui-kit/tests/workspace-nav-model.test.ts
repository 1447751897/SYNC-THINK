import { describe, expect, it } from 'vitest';
import {
  buildTaskTree,
  buildWorkspaceNavModel,
  filterTasksByQuery,
  pickLastOpenedTaskId,
  type WorkspaceNavTask,
  type WorkspaceNavWorkspace,
} from '../src/components/workspace-nav-model.js';

function task(
  partial: Partial<WorkspaceNavTask> & Pick<WorkspaceNavTask, 'taskId' | 'title'>,
): WorkspaceNavTask {
  return {
    workspaceId: 'ws_1',
    goal: partial.goal ?? partial.title,
    status: 'active',
    taskVersion: 0,
    threadId: `thread-${partial.taskId}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...partial,
  };
}

describe('workspace-nav-model', () => {
  it('filters tasks by title or goal (case-insensitive)', () => {
    const tasks = [
      task({ taskId: 't1', title: 'Runtime recovery', goal: 'checkpoint' }),
      task({ taskId: 't2', title: 'Pipe protocol', goal: 'HMAC' }),
    ];
    expect(filterTasksByQuery(tasks, 'recovery').map((t) => t.taskId)).toEqual(['t1']);
    expect(filterTasksByQuery(tasks, 'hmac').map((t) => t.taskId)).toEqual(['t2']);
    expect(filterTasksByQuery(tasks, '  ').length).toBe(2);
  });

  it('nests children and promotes orphans when parent is missing', () => {
    const tasks = [
      task({ taskId: 'root', title: 'Root' }),
      task({ taskId: 'child', title: 'Child', parentTaskId: 'root' }),
      task({ taskId: 'orphan', title: 'Orphan', parentTaskId: 'gone' }),
    ];
    const tree = buildTaskTree(tasks);
    expect(tree.map((n) => n.task.taskId)).toEqual(['root', 'orphan']);
    expect(tree[0]?.children.map((n) => n.task.taskId)).toEqual(['child']);
    expect(tree[0]?.children[0]?.depth).toBe(1);
  });

  it('picks the most recent lastOpenedAt task', () => {
    const tasks = [
      task({
        taskId: 'a',
        title: 'A',
        lastOpenedAt: '2026-07-11T10:00:00.000Z',
      }),
      task({
        taskId: 'b',
        title: 'B',
        lastOpenedAt: '2026-07-12T10:00:00.000Z',
      }),
      task({ taskId: 'c', title: 'C' }),
    ];
    expect(pickLastOpenedTaskId(tasks)).toBe('b');
  });

  it('builds a nav model with folders and last-open across workspaces', () => {
    const workspaces: WorkspaceNavWorkspace[] = [
      {
        workspaceId: 'ws_1',
        folderPath: 'D:/projects/SYNC-THINK',
        name: 'SYNC-THINK',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      },
    ];
    const tasks = [
      task({
        taskId: 't1',
        title: 'Recovery chain',
        lastOpenedAt: '2026-07-12T08:00:00.000Z',
      }),
      task({ taskId: 't2', title: 'Visual calibration' }),
    ];
    const model = buildWorkspaceNavModel(workspaces, new Map([['ws_1', tasks]]), 'Recovery');
    expect(model.folders).toHaveLength(1);
    expect(model.totalTaskCount).toBe(1);
    expect(model.lastOpenedTaskId).toBe('t1');
    expect(model.folders[0]?.tasks[0]?.task.title).toBe('Recovery chain');
  });
});
