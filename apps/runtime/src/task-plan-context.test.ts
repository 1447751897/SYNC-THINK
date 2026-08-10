import type { Event } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import {
  extractLatestTaskPlanFromEvents,
  formatTaskPlanForModel,
} from './runtime.js';

function toolEvent(
  sequence: number,
  type: 'tool.requested' | 'tool.completed' | 'tool.failed',
  payload: Record<string, unknown>,
): Event {
  return {
    id: `evt-${sequence}` as Event['id'],
    workspaceId: 'ws-1' as Event['workspaceId'],
    category: 'tool',
    type,
    sequence,
    occurredAt: '2026-08-10T00:00:00.000Z',
    payload,
  };
}

const planRequested = toolEvent(3, 'tool.requested', {
  threadId: 'thread-a',
  toolName: 'update_task_plan',
  arguments: {
    items: [
      { title: '第一步', status: 'in_progress' },
      { title: '第二步', status: 'pending' },
      { title: '第三步', status: 'completed' },
    ],
  },
});

const planCompleted = toolEvent(4, 'tool.completed', {
  threadId: 'thread-a',
  toolName: 'update_task_plan',
  result: JSON.stringify({
    ok: true,
    plan: {
      items: [
        { title: '第一步', status: 'completed' },
        { title: '第二步', status: 'in_progress' },
      ],
    },
  }),
});

describe('extractLatestTaskPlanFromEvents', () => {
  it('prefers the executed result over the request arguments', () => {
    const plan = extractLatestTaskPlanFromEvents([planRequested, planCompleted], 'thread-a');
    expect(plan).toEqual({
      items: [
        { title: '第一步', status: 'completed' },
        { title: '第二步', status: 'in_progress' },
      ],
      total: 2,
      completed: 1,
    });
  });

  it('falls back to request arguments when no result is available yet', () => {
    const plan = extractLatestTaskPlanFromEvents([planRequested], 'thread-a');
    expect(plan).toMatchObject({
      total: 3,
      completed: 1,
    });
    expect(plan?.items[0]).toEqual({ title: '第一步', status: 'in_progress' });
  });

  it('ignores other threads and unrelated tool events', () => {
    const otherThread = toolEvent(5, 'tool.requested', {
      threadId: 'thread-b',
      toolName: 'update_task_plan',
      arguments: { items: [{ title: 'B 清单', status: 'pending' }] },
    });
    const otherTool = toolEvent(6, 'tool.completed', {
      threadId: 'thread-a',
      toolName: 'search_files',
      result: '{"ok":true}',
    });
    expect(extractLatestTaskPlanFromEvents([otherTool, otherThread], 'thread-a')).toBeUndefined();
  });

  it('normalizes invalid statuses to pending and drops empty titles', () => {
    const messy = toolEvent(7, 'tool.requested', {
      threadId: 'thread-a',
      toolName: 'update_task_plan',
      arguments: {
        items: [
          { title: '', status: 'completed' },
          { title: '有效步骤', status: 'weird-status' },
          { title: '   ', status: 'pending' },
        ],
      },
    });
    const plan = extractLatestTaskPlanFromEvents([messy], 'thread-a');
    expect(plan?.items).toEqual([{ title: '有效步骤', status: 'pending' }]);
  });

  it('takes the latest call when the model sent the checklist multiple times', () => {
    const later = toolEvent(8, 'tool.requested', {
      threadId: 'thread-a',
      toolName: 'update_task_plan',
      arguments: { items: [{ title: '更新后的步骤', status: 'in_progress' }] },
    });
    const plan = extractLatestTaskPlanFromEvents([planRequested, later], 'thread-a');
    expect(plan?.items).toEqual([{ title: '更新后的步骤', status: 'in_progress' }]);
  });
});

describe('formatTaskPlanForModel', () => {
  it('renders the NewMax-style checkbox checklist', () => {
    const text = formatTaskPlanForModel({
      items: [
        { title: '第一步', status: 'in_progress' },
        { title: '第二步', status: 'pending' },
        { title: '第三步', status: 'completed' },
      ],
      total: 3,
      completed: 1,
    });
    expect(text).toBe(
      '当前任务清单（1/3 已完成）：\n- [~] 第一步\n- [ ] 第二步\n- [x] 第三步',
    );
  });
});
