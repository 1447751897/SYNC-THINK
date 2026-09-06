import { describe, expect, it } from 'vitest';
import type { Event } from './types/event.js';
import { projectTaskPlan, reduceTaskPlanEvents } from './task-plan.js';

function event(sequence: number, type: string, payload: Record<string, unknown>): Event {
  return {
    id: `event-${sequence}`,
    sequence,
    type,
    category: 'tool',
    workspaceId: 'workspace',
    taskId: 'task',
    runId: 'run',
    occurredAt: '2026-09-05T00:00:00Z',
    payload,
  } as Event;
}

function call(sequence: number, name: string, args: unknown): Event {
  return event(sequence, 'tool.requested', {
    toolCall: { id: `call-${sequence}`, name, argumentsJson: JSON.stringify(args) },
  });
}

function result(
  sequence: number,
  callSequence: number,
  structuredResult: unknown,
  failed = false,
): Event {
  return event(sequence, 'tool.completed', {
    toolCallId: `call-${callSequence}`,
    structuredResult,
    failed,
  });
}

describe('native task projection', () => {
  it('accepts raw Codex step/status snapshots and Claude TaskGet details', () => {
    const codex = reduceTaskPlanEvents([
      call(1, 'update_plan', {
        plan: [{ step: '检查事件\n只读取当前会话事件', status: 'inProgress' }],
      }),
    ]);
    expect(projectTaskPlan(codex)?.items).toEqual([
      { title: '检查事件', description: '只读取当前会话事件', status: 'in_progress' },
    ]);
    const claude = reduceTaskPlanEvents([
      call(1, 'TaskList', {}),
      result(2, 1, { tasks: [{ id: '9', subject: '恢复原生任务', status: 'in_progress' }] }),
      call(3, 'TaskGet', { taskId: '9' }),
      result(4, 3, {
        task: {
          id: '9',
          subject: '恢复原生任务',
          description: '读取原生任务完整说明',
          status: 'in_progress',
          blocks: [],
          blockedBy: [],
        },
      }),
    ]);
    expect(projectTaskPlan(claude)?.items[0]?.description).toBe('读取原生任务完整说明');
    expect(
      projectTaskPlan(
        reduceTaskPlanEvents(
          [call(5, 'TaskList', {}), result(6, 5, { tasks: [] })],
          undefined,
          claude,
        ),
      ),
    ).toBeNull();
  });

  it('keeps complete native arguments when streamed result metadata contains only the initial empty input', () => {
    const state = reduceTaskPlanEvents([
      call(1, 'TaskCreate', { subject: '读取任务', description: '保留完整参数说明' }),
      event(2, 'tool.completed', {
        toolCallId: 'call-1',
        argumentsJson: '{}',
        structuredResult: { task: { id: '1', subject: '读取任务' } },
      }),
    ]);
    expect(projectTaskPlan(state)?.items[0]?.description).toBe('保留完整参数说明');
  });

  it('reflects Claude native task ids, descriptions, successful updates and deletion', () => {
    const created = reduceTaskPlanEvents([
      call(1, 'TaskCreate', { subject: '检查数据库', description: '检查任务事件和订阅游标' }),
      result(2, 1, { task: { id: '1', subject: '检查数据库' } }),
      call(3, 'TaskUpdate', { taskId: '1', status: 'in_progress' }),
      result(4, 3, { success: true, taskId: '1', updatedFields: ['status'] }),
    ]);
    expect(projectTaskPlan(created)?.items).toEqual([
      {
        id: '1',
        title: '检查数据库',
        description: '检查任务事件和订阅游标',
        status: 'in_progress',
      },
    ]);
    const restored = JSON.parse(JSON.stringify(created));
    const updated = reduceTaskPlanEvents(
      [
        event(5, 'run.started', { kernelId: 'claude-code' }),
        call(6, 'TaskUpdate', { taskId: '1', status: 'completed' }),
        result(7, 6, { success: true, taskId: '1', updatedFields: ['status'] }),
        event(8, 'run.completed', {}),
      ],
      undefined,
      restored,
    );
    expect(projectTaskPlan(updated)).toMatchObject({ completed: 1, total: 1, running: false });
    expect(
      projectTaskPlan(
        reduceTaskPlanEvents(
          [
            call(9, 'TaskUpdate', { taskId: '1', status: 'deleted' }),
            result(10, 9, { success: true, taskId: '1' }),
          ],
          undefined,
          updated,
        ),
      ),
    ).toBeNull();
  });

  it('preserves descriptions across Claude TaskList and never accepts failed or unexecuted tasks', () => {
    const state = reduceTaskPlanEvents([
      call(1, 'TaskCreate', { subject: '检查存储', description: '读取 SQLite 中的任务事件' }),
      result(2, 1, { task: { id: '1', subject: '检查存储' } }),
      call(3, 'TaskUpdate', { taskId: '1', status: 'completed' }),
      result(4, 3, { success: false, error: 'not found' }),
      call(5, 'TaskCreate', { subject: '未执行的任务', description: '不应显示' }),
      call(6, 'TaskList', {}),
      result(7, 6, { tasks: [{ id: '1', subject: '检查存储', status: 'pending' }] }),
    ]);
    expect(projectTaskPlan(state)?.items).toEqual([
      { id: '1', title: '检查存储', description: '读取 SQLite 中的任务事件', status: 'pending' },
    ]);
  });

  it('supports TodoWrite content and explicit clearing, without deriving descriptions from activeForm', () => {
    const request = call(1, 'TodoWrite', {
      todos: [
        {
          content: '运行回归测试\n验证重启与会话隔离',
          status: 'in_progress',
          activeForm: '正在运行测试',
        },
      ],
    });
    expect(projectTaskPlan(reduceTaskPlanEvents([request]))).toBeNull();
    const state = reduceTaskPlanEvents([
      request,
      result(2, 1, {
        newTodos: [
          {
            content: '运行回归测试\n验证重启与会话隔离',
            status: 'in_progress',
            activeForm: '正在运行测试',
          },
        ],
      }),
    ]);
    expect(projectTaskPlan(state)?.items).toEqual([
      { title: '运行回归测试', description: '验证重启与会话隔离', status: 'in_progress' },
    ]);
    expect(
      projectTaskPlan(
        reduceTaskPlanEvents(
          [call(3, 'TodoWrite', { todos: [] }), result(4, 3, { newTodos: [] })],
          undefined,
          state,
        ),
      ),
    ).toBeNull();
  });

  it('restores Codex native plans and legacy saved plans beyond the activity cursor', () => {
    for (const name of ['update_plan', 'update_task_plan']) {
      const events = [
        call(1, name, {
          items: [
            { title: '修复任务回显', description: '从持久化事件恢复', status: 'in_progress' },
          ],
        }),
        result(2, 1, {
          ok: true,
          plan: {
            items: [
              { title: '修复任务回显', description: '从持久化事件恢复', status: 'completed' },
            ],
          },
        }),
        event(3, 'run.completed', {}),
      ];
      const durable = JSON.parse(JSON.stringify(reduceTaskPlanEvents(events)));
      expect(projectTaskPlan(reduceTaskPlanEvents([], { taskId: 'task' }, durable))).toMatchObject({
        completed: 1,
        total: 1,
        running: false,
      });
      expect(projectTaskPlan(reduceTaskPlanEvents(events, undefined, durable))).toEqual(
        projectTaskPlan(durable),
      );
    }
  });

  it('retains in-flight task arguments across a snapshot boundary and rejects failed plan results', () => {
    const state = reduceTaskPlanEvents([
      call(1, 'TaskCreate', { subject: '跨边界任务', description: '启动后完成' }),
    ]);
    expect(
      projectTaskPlan(
        reduceTaskPlanEvents(
          [result(2, 1, { task: { id: '1', subject: '跨边界任务' } })],
          undefined,
          JSON.parse(JSON.stringify(state)),
        ),
      )?.items[0]?.description,
    ).toBe('启动后完成');
    expect(
      projectTaskPlan(
        reduceTaskPlanEvents([
          call(1, 'update_task_plan', { items: [{ title: '失败计划', status: 'pending' }] }),
          result(2, 1, { ok: false, error: 'failed' }, true),
        ]),
      ),
    ).toBeNull();
  });
});
