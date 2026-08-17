/**
 * @vitest-environment jsdom
 *
 * 任务清单：事件投影生命周期（run 开始清空 / 终态保留 / 下一轮清空）+
 * TodoPanel 折叠展开与进度文案。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Event } from '@sync-think/shared';
import { TodoPanel } from './TodoPanel.js';
import { projectTodoFromEvents, todoProgressLabel, type TodoProjection } from './todo-projection.js';

function event(sequence: number, type: string, payload: Record<string, unknown> = {}): Event {
  return {
    id: `e-${sequence}` as Event['id'],
    workspaceId: 'w-1' as Event['workspaceId'],
    sequence,
    type,
    occurredAt: '2025-01-01T00:00:00.000Z',
    category: 'run',
    payload,
  };
}

function toolEvent(
  sequence: number,
  name: string,
  items: Array<{ title: string; status: string }>,
): Event {
  return event(sequence, 'tool.completed', {
    toolName: name,
    arguments: { items },
  });
}

const todo: TodoProjection = {
  items: [
    { title: 'A', status: 'completed' },
    { title: 'B', status: 'in_progress' },
    { title: 'C', status: 'pending' },
  ],
  running: true,
  completed: 1,
  total: 3,
};

describe('projectTodoFromEvents', () => {
  it('returns null without any task plan snapshot', () => {
    expect(projectTodoFromEvents([event(1, 'run.started')])).toBeNull();
    expect(projectTodoFromEvents([])).toBeNull();
  });

  it('tracks the latest snapshot within the current run and clears on a new run', () => {
    const events = [
      event(1, 'run.started'),
      toolEvent(2, 'update_task_plan', [
        { title: 'A', status: 'pending' },
        { title: 'B', status: 'pending' },
      ]),
      toolEvent(3, 'update_task_plan', [
        { title: 'A', status: 'completed' },
        { title: 'B', status: 'in_progress' },
      ]),
    ];
    const projected = projectTodoFromEvents(events)!;
    expect(projected.items.map((item) => item.status)).toEqual(['completed', 'in_progress']);
    expect(projected.running).toBe(true);
    expect(todoProgressLabel(projected)).toBe('1 完成 · 1 进行中');
  });

  it('keeps the finished list after the run ends and clears on the next run start', () => {
    const events = [
      event(1, 'run.started'),
      toolEvent(2, 'TaskCreate', [{ title: 'A', status: 'completed' }]),
      event(3, 'run.completed'),
    ];
    const afterEnd = projectTodoFromEvents(events)!;
    expect(afterEnd.items).toEqual([{ title: 'A', status: 'completed' }]);
    expect(afterEnd.running).toBe(false);

    const afterNextRun = projectTodoFromEvents([...events, event(4, 'run.started')]);
    expect(afterNextRun).toBeNull();
  });

  it('reads the plan from tool result payloads when present', () => {
    const events = [
      event(1, 'run.started'),
      event(2, 'tool.completed', {
        toolName: 'TaskList',
        result: JSON.stringify({
          ok: true,
          plan: { items: [{ title: 'X', status: 'completed' }] },
        }),
      }),
    ];
    const projected = projectTodoFromEvents(events)!;
    expect(projected.items).toEqual([{ title: 'X', status: 'completed' }]);
  });
});

describe('todoProgressLabel', () => {
  it('omits zero-count segments', () => {
    expect(todoProgressLabel(todo)).toBe('1 完成 · 1 进行中 · 1 待办');
    expect(
      todoProgressLabel({
        items: [{ title: 'A', status: 'completed' }],
        running: false,
        completed: 1,
        total: 1,
      }),
    ).toBe('1 完成');
  });
});

describe('TodoPanel', () => {
  afterEach(cleanup);

  it('collapses by default and expands on header click', () => {
    render(<TodoPanel todo={todo} />);
    expect(screen.getByTestId('todo-panel')).toBeTruthy();
    expect(screen.getByText('任务清单')).toBeTruthy();
    expect(screen.getByTestId('todo-progress').textContent).toBe('1 完成 · 1 进行中 · 1 待办');
    expect(screen.queryByRole('list')).toBeNull();

    fireEvent.click(screen.getByTestId('todo-panel-toggle'));
    expect(screen.getByRole('list')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(
      <TodoPanel todo={{ items: [], running: false, completed: 0, total: 0 }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
