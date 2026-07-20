import { describe, expect, it } from 'vitest';
import {
  deriveProjectNameFromFolderPath,
  resolveExpectedTaskVersion,
  resolvePreferredTask,
  upsertTaskInMap,
} from '../src/renderer/workspace-catalog.js';
import type { TaskSummary, WorkspaceSummary } from '@sync-think/protocol';

const workspace: WorkspaceSummary = {
  workspaceId: 'ws_1' as never,
  folderPath: 'D:/projects/SYNC-THINK',
  name: 'SYNC-THINK',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

function task(partial: Partial<TaskSummary> & Pick<TaskSummary, 'taskId' | 'title'>): TaskSummary {
  return {
    workspaceId: 'ws_1' as never,
    goal: partial.goal ?? partial.title,
    status: 'active',
    taskVersion: 0,
    threadId: `thread-${partial.taskId}` as never,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    ...partial,
  } as TaskSummary;
}

describe('workspace-catalog selection', () => {
  it('prefers explicit task, then last-open, then first', () => {
    const tasks = [
      task({ taskId: 'a' as never, title: 'A' }),
      task({
        taskId: 'b' as never,
        title: 'B',
        lastOpenedAt: '2026-07-12T10:00:00.000Z',
      }),
    ];
    const map = new Map([['ws_1', tasks]]);
    expect(resolvePreferredTask([workspace], map)?.taskId).toBe('b');
    expect(resolvePreferredTask([workspace], map, 'a')?.taskId).toBe('a');
  });

  it('preserves the persisted participation mode in the active task selection', () => {
    const tasks = [
      task({
        taskId: 'mode-task' as never,
        title: 'Mode task',
        participationMode: 'collaboration',
      }),
    ];
    const selected = resolvePreferredTask([workspace], new Map([['ws_1', tasks]]));
    expect(selected?.participationMode).toBe('collaboration');
  });

  it('projects tasks from a project that has no folder binding', () => {
    const unboundWorkspace: WorkspaceSummary = {
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
    const tasks = [task({ taskId: 'unbound-task' as never, title: 'Unbound task' })];
    const selected = resolvePreferredTask(
      [unboundWorkspace],
      new Map([['ws_1', tasks]]),
      'unbound-task',
    );
    expect(selected).toMatchObject({
      taskId: 'unbound-task',
      workspaceId: 'ws_1',
      workspaceName: 'SYNC-THINK',
    });
    expect(selected?.folderPath).toBeUndefined();
  });

  it('upserts task summaries by id', () => {
    const initial = new Map([
      ['ws_1', [task({ taskId: 'a' as never, title: 'A', taskVersion: 0 })]],
    ]);
    const next = upsertTaskInMap(
      initial,
      task({ taskId: 'a' as never, title: 'A2', taskVersion: 2 }),
    );
    expect(next.get('ws_1')?.[0]?.title).toBe('A2');
    expect(next.get('ws_1')?.[0]?.taskVersion).toBe(2);
  });

  it('replaces an opened task in place instead of moving the clicked conversation', () => {
    const initialTasks = [
      task({ taskId: 'a' as never, title: 'A' }),
      task({ taskId: 'b' as never, title: 'B' }),
      task({ taskId: 'c' as never, title: 'C' }),
    ];
    const next = upsertTaskInMap(
      new Map([['ws_1', initialTasks]]),
      task({
        taskId: 'b' as never,
        title: 'B opened',
        lastOpenedAt: '2026-07-19T00:10:00.000Z',
      }),
    );

    expect(next.get('ws_1')?.map((item) => item.taskId)).toEqual(['a', 'b', 'c']);
    expect(next.get('ws_1')?.[1]?.title).toBe('B opened');
  });

  it('uses the newest hydrated task version when the catalog is stale', () => {
    expect(resolveExpectedTaskVersion(0, 2)).toBe(2);
    expect(resolveExpectedTaskVersion(3, 2)).toBe(3);
  });

  it('derives a project name from Windows and POSIX folder paths', () => {
    expect(deriveProjectNameFromFolderPath('D:\\projects\\SYNC-THINK\\')).toBe('SYNC-THINK');
    expect(deriveProjectNameFromFolderPath('/workspaces/release')).toBe('release');
  });
});
