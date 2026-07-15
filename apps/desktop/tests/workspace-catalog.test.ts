import { describe, expect, it } from 'vitest';
import {
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

  it('upserts task summaries by id', () => {
    const initial = new Map([
      [
        'ws_1',
        [task({ taskId: 'a' as never, title: 'A', taskVersion: 0 })],
      ],
    ]);
    const next = upsertTaskInMap(
      initial,
      task({ taskId: 'a' as never, title: 'A2', taskVersion: 2 }),
    );
    expect(next.get('ws_1')?.[0]?.title).toBe('A2');
    expect(next.get('ws_1')?.[0]?.taskVersion).toBe(2);
  });

  it('uses the newest hydrated task version when the catalog is stale', () => {
    expect(resolveExpectedTaskVersion(0, 2)).toBe(2);
    expect(resolveExpectedTaskVersion(3, 2)).toBe(3);
  });
});
