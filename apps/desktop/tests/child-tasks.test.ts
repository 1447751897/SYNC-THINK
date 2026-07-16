import { describe, expect, it } from 'vitest';
import {
  findParentTaskLink,
  projectChildTasks,
  summarizeChildTasks,
} from '../src/renderer/child-tasks.js';

describe('child task surface projection', () => {
  const tasks = [
    {
      taskId: 'p1',
      title: '页面重构',
      status: 'active',
      goal: '主目标',
      updatedAt: '2026-07-16T10:00:00.000Z',
    },
    {
      taskId: 'c1',
      parentTaskId: 'p1',
      title: '写登录 API',
      status: 'active',
      goal: 'API',
      updatedAt: '2026-07-16T11:00:00.000Z',
    },
    {
      taskId: 'c2',
      parentTaskId: 'p1',
      title: '画登录页',
      status: 'completed',
      goal: 'UI',
      updatedAt: '2026-07-16T10:30:00.000Z',
    },
    {
      taskId: 'other',
      parentTaskId: 'x',
      title: '无关',
      status: 'active',
      updatedAt: '2026-07-16T12:00:00.000Z',
    },
  ];

  it('lists only direct children newest first', () => {
    const children = projectChildTasks(tasks, 'p1');
    expect(children.map((c) => c.taskId)).toEqual(['c1', 'c2']);
    expect(children[0]?.statusLabel).toBe('进行中');
    expect(children[1]?.tone).toBe('done');
  });

  it('summarizes progress for the parent surface', () => {
    const summary = summarizeChildTasks(projectChildTasks(tasks, 'p1'));
    expect(summary).toMatch(/2 项/);
    expect(summary).toMatch(/进行中/);
    expect(summary).toMatch(/完成/);
  });

  it('resolves parent link for breadcrumb jump-back', () => {
    expect(findParentTaskLink(tasks, { taskId: 'c1', parentTaskId: 'p1' })).toEqual({
      taskId: 'p1',
      title: '页面重构',
    });
    expect(findParentTaskLink(tasks, { taskId: 'p1' })).toBeNull();
  });
});
