import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import { projectTodoFromEvents } from './todo-projection.js';

function makeEvent(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  options: { runId?: string; taskId?: string } = {},
): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-a' as Event['workspaceId'],
    category: 'tool',
    type,
    sequence,
    occurredAt: `2026-08-28T12:00:0${sequence}.000Z`,
    payload,
    runId: options.runId as Event['runId'],
    taskId: options.taskId as Event['taskId'],
  };
}

describe('projectTodoFromEvents', () => {
  it('reads Codex plan arguments nested under toolCall.argumentsJson', () => {
    const events = [
      makeEvent(1, 'run.started', {}),
      makeEvent(2, 'tool.requested', {
        toolCall: {
          id: 'codex-plan-turn-1',
          name: 'update_task_plan',
          argumentsJson: JSON.stringify({
            items: [
              { title: '检查当前状态', status: 'completed' },
              { title: '修复目标循环', status: 'in_progress' },
              { title: '完成回归验证', status: 'pending' },
            ],
          }),
        },
      }),
      makeEvent(3, 'run.completed', {}),
    ];

    expect(projectTodoFromEvents(events)).toEqual({
      items: [
        { title: '检查当前状态', status: 'completed' },
        { title: '修复目标循环', status: 'in_progress' },
        { title: '完成回归验证', status: 'pending' },
      ],
      running: false,
      completed: 1,
      total: 3,
    });
  });

  it('links a nameless completion to its plan request and ignores another thread starting', () => {
    const events = [
      makeEvent(
        1,
        'run.started',
        { threadId: 'thread-a' },
        { runId: 'run-a', taskId: 'shared-task' },
      ),
      makeEvent(
        2,
        'tool.requested',
        {
          toolCall: {
            id: 'codex-plan-a',
            name: 'update_task_plan',
            argumentsJson: JSON.stringify({
              items: [
                { title: '读取 package.json', status: 'in_progress' },
                { title: '运行 typecheck', status: 'pending' },
              ],
            }),
          },
        },
        { runId: 'run-a', taskId: 'shared-task' },
      ),
      makeEvent(
        3,
        'tool.completed',
        {
          toolCallId: 'codex-plan-a',
          result: JSON.stringify({
            ok: true,
            plan: {
              items: [
                { title: '读取 package.json', status: 'completed' },
                { title: '运行 typecheck', status: 'in_progress' },
              ],
            },
          }),
        },
        { runId: 'run-a', taskId: 'shared-task' },
      ),
      makeEvent(
        4,
        'run.started',
        { threadId: 'thread-b' },
        { runId: 'run-b', taskId: 'shared-task' },
      ),
    ];

    expect(projectTodoFromEvents(events, { threadId: 'thread-a', taskId: 'shared-task' })).toEqual({
      items: [
        { title: '读取 package.json', status: 'completed' },
        { title: '运行 typecheck', status: 'in_progress' },
      ],
      running: true,
      completed: 1,
      total: 2,
    });
  });

  it('ignores a plan tool without threadId when its run belongs to another thread', () => {
    const events = [
      makeEvent(
        1,
        'run.started',
        { threadId: 'thread-a' },
        { runId: 'run-a', taskId: 'shared-task' },
      ),
      makeEvent(
        2,
        'tool.requested',
        {
          toolCall: {
            id: 'codex-plan-a',
            name: 'update_task_plan',
            argumentsJson: JSON.stringify({
              items: [{ title: '当前对话计划', status: 'in_progress' }],
            }),
          },
        },
        { runId: 'run-a', taskId: 'shared-task' },
      ),
      makeEvent(
        3,
        'run.started',
        { threadId: 'thread-b' },
        { runId: 'run-b', taskId: 'shared-task' },
      ),
      makeEvent(
        4,
        'tool.requested',
        {
          toolCall: {
            id: 'codex-plan-b',
            name: 'update_task_plan',
            argumentsJson: JSON.stringify({
              items: [{ title: '其他对话计划', status: 'in_progress' }],
            }),
          },
        },
        { runId: 'run-b', taskId: 'shared-task' },
      ),
    ];

    expect(projectTodoFromEvents(events, { threadId: 'thread-a', taskId: 'shared-task' })).toEqual({
      items: [{ title: '当前对话计划', status: 'in_progress' }],
      running: true,
      completed: 0,
      total: 1,
    });
  });
});
