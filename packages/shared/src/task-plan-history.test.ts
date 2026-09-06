import { describe, expect, it } from 'vitest';
import type { Event } from './types/event.js';
import { projectTaskPlanHistory } from './task-plan-history.js';

function entry(
  sequence: number,
  runId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Event {
  return {
    id: 'event-' + sequence,
    sequence,
    runId,
    type,
    payload,
    category: 'tool',
    workspaceId: 'workspace',
    taskId: 'task',
    occurredAt: '2026-09-06T03:00:00Z',
  } as Event;
}
const started = (sequence: number, runId: string, kernelId = 'codex') =>
  entry(sequence, runId, 'run.started', { threadId: 'thread', kernelId });
const request = (sequence: number, runId: string, name: string, args: unknown) =>
  entry(sequence, runId, 'tool.requested', {
    toolCall: { id: 'call-' + sequence, name, argumentsJson: JSON.stringify(args) },
  });
const result = (
  sequence: number,
  runId: string,
  callSequence: number,
  output: unknown,
  failed = false,
) =>
  entry(sequence, runId, 'tool.completed', {
    toolCallId: 'call-' + callSequence,
    structuredResult: output,
    failed,
  });
const scope = { taskId: 'task', threadId: 'thread' };

describe('confirmed native task history', () => {
  it('preserves the last confirmed Codex plan when a later run has no plan, without changing recorded statuses', () => {
    const events = [
      started(1, 'old'),
      request(2, 'old', 'update_plan', {
        plan: [{ step: '审计架构\n核对原生事件', status: 'in_progress' }],
      }),
      result(3, 'old', 2, { ok: true }),
      entry(4, 'old', 'run.completed'),
      started(5, 'new'),
      entry(6, 'new', 'run.completed'),
    ];
    expect(projectTaskPlanHistory(events, scope)).toMatchObject({
      runs: [{ runId: 'old', kernelId: 'codex', status: 'completed', total: 1 }],
      selected: {
        runId: 'old',
        items: [{ title: '审计架构', description: '核对原生事件', status: 'in_progress' }],
      },
    });
  });

  it('ignores failed, partial and unconfirmed tools and retains explicit clearing', () => {
    const events = [
      started(1, 'old'),
      request(2, 'old', 'update_plan', { plan: [{ step: '真实任务', status: 'pending' }] }),
      result(3, 'old', 2, { ok: true }),
      request(4, 'old', 'update_plan', { plan: [{ step: '失败任务', status: 'pending' }] }),
      result(5, 'old', 4, { ok: false }, true),
      request(6, 'old', 'update_plan', { plan: [{ step: '未执行', status: 'pending' }] }),
      entry(7, 'old', 'run.failed'),
      started(8, 'clear'),
      request(9, 'clear', 'update_plan', { plan: [] }),
      result(10, 'clear', 9, { ok: true }),
      entry(11, 'clear', 'run.completed'),
    ];
    const page = projectTaskPlanHistory(events, scope);
    expect(page.selected).toMatchObject({ runId: 'clear', total: 0, items: [] });
    expect(projectTaskPlanHistory(events, scope, { runId: 'old' }).selected?.items).toEqual([
      { title: '真实任务', status: 'pending' },
    ]);
  });

  it('replays Claude native descriptions and cross-run updates, with no fabricated tasks for unknown ids', () => {
    const events = [
      started(1, 'create', 'claude-code'),
      request(2, 'create', 'TaskCreate', {
        subject: '检查数据库',
        description: '保留完整原生说明',
      }),
      result(3, 'create', 2, { task: { id: '1', subject: '检查数据库' } }),
      entry(4, 'create', 'run.completed'),
      started(5, 'update', 'claude-code'),
      request(6, 'update', 'TaskUpdate', { taskId: '1', status: 'completed' }),
      result(7, 'update', 6, { success: true, taskId: '1' }),
      entry(8, 'update', 'run.completed'),
      started(9, 'unknown', 'claude-code'),
      request(10, 'unknown', 'TaskUpdate', { taskId: 'absent', status: 'completed' }),
      result(11, 'unknown', 10, { success: true, taskId: 'absent' }),
    ];
    const page = projectTaskPlanHistory(events, scope);
    expect(page.runs.map((run) => run.runId)).toEqual(['update', 'create']);
    expect(page.selected).toMatchObject({
      runId: 'update',
      completed: 1,
      items: [
        { id: '1', title: '检查数据库', description: '保留完整原生说明', status: 'completed' },
      ],
    });
    expect(
      projectTaskPlanHistory(events, scope, { runId: 'create' }).selected?.items[0]?.status,
    ).toBe('pending');
  });

  it('returns bounded run pages, orders by run boundary, and excludes another thread', () => {
    const events: Event[] = [];
    for (let index = 0; index < 13; index += 1) {
      const base = index * 4;
      events.push(
        started(base + 1, 'run-' + index),
        request(base + 2, 'run-' + index, 'update_plan', {
          plan: [{ step: '任务' + index, status: 'pending' }],
        }),
        result(base + 3, 'run-' + index, base + 2, { ok: true }),
        entry(base + 4, 'run-' + index, 'run.completed'),
      );
    }
    events.push(
      entry(60, 'foreign', 'run.started', { threadId: 'other' }),
      request(61, 'foreign', 'update_plan', { plan: [{ step: '其它会话', status: 'pending' }] }),
      result(62, 'foreign', 61, { ok: true }),
    );
    const first = projectTaskPlanHistory(events, scope);
    expect(first.runs).toHaveLength(10);
    expect(first.runs[0]?.runId).toBe('run-12');
    const second = projectTaskPlanHistory(events, scope, {
      beforeSequence: first.nextBeforeSequence,
    });
    expect(second.runs.map((run) => run.runId)).toEqual(['run-2', 'run-1', 'run-0']);
    expect(second.nextBeforeSequence).toBeUndefined();
    expect(projectTaskPlanHistory(events, scope, { runId: 'foreign' }).selected).toBeUndefined();
  });
});

it('uses a stable compound run cursor when legacy run boundaries share a sequence', () => {
  const events: Event[] = [];
  for (let index = 0; index < 14; index += 1) {
    const runId = 'run-' + String(index).padStart(2, '0');
    const base = 100 + index * 3;
    events.push(
      started(1, runId),
      request(base, runId, 'update_plan', { plan: [{ step: runId, status: 'pending' }] }),
      result(base + 1, runId, base, { ok: true }),
      entry(base + 2, runId, 'run.completed'),
    );
  }
  const first = projectTaskPlanHistory(events, scope);
  expect(first.runs).toHaveLength(10);
  const second = projectTaskPlanHistory(events, scope, {
    beforeSequence: first.nextBeforeSequence,
    beforeRunId: first.nextBeforeRunId,
  });
  expect(second.runs.map((run) => run.runId)).toEqual(['run-03', 'run-02', 'run-01', 'run-00']);
  expect(new Set([...first.runs, ...second.runs].map((run) => run.runId)).size).toBe(14);
});

it('orders tied run identifiers by code units rather than host locale', () => {
  const events: Event[] = [];
  for (const [index, runId] of ['run-A', 'run-a', 'run-_'].entries()) {
    const base = 100 + index * 3;
    events.push(
      started(1, runId),
      request(base, runId, 'update_plan', { plan: [{ step: runId, status: 'pending' }] }),
      result(base + 1, runId, base, { ok: true }),
    );
  }
  expect(projectTaskPlanHistory(events, scope).runs.map((run) => run.runId)).toEqual([
    'run-a',
    'run-_',
    'run-A',
  ]);
});
