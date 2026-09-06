// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TodoProjection } from './todo-projection.js';
import { ComposerTaskPanel } from './ComposerTaskPanel.js';

const todo: TodoProjection = {
  running: true,
  completed: 1,
  total: 3,
  items: [
    { title: '确认需求', status: 'completed' },
    { title: '实现输入框', status: 'in_progress' },
    { title: '实窗验证', status: 'pending' },
  ],
};

afterEach(cleanup);

describe('ComposerTaskPanel', () => {
  it('hides empty and fully completed native lists, including restored snapshots', () => {
    const { rerender } = render(<ComposerTaskPanel todo={null} />);
    expect(screen.queryByTestId('composer-task-panel')).toBeNull();
    rerender(<ComposerTaskPanel todo={{ ...todo, items: [], total: 0, completed: 0 }} />);
    expect(screen.queryByTestId('composer-task-panel')).toBeNull();
    for (const running of [true, false]) {
      rerender(
        <ComposerTaskPanel
          todo={{
            ...todo,
            running,
            completed: todo.total,
            items: todo.items.map((item) => ({ ...item, status: 'completed' })),
          }}
        />,
      );
      expect(screen.queryByTestId('composer-task-panel')).toBeNull();
    }
    rerender(<ComposerTaskPanel todo={{ ...todo, running: false }} />);
    expect(screen.getByRole('button', { name: '任务进度 1/3' })).toBeTruthy();
    expect(within(screen.getByTestId('composer-task-list')).getByText('确认需求')).toBeTruthy();
  });

  it('shows step descriptions below their titles and keeps legacy items compact', () => {
    render(
      <ComposerTaskPanel
        todo={{
          ...todo,
          items: [
            { ...todo.items[0]!, description: '确认任务清单的生成、事件投影与展示链路' },
            { ...todo.items[1]!, description: '为每项增加具体范围，并验证状态更新保留说明' },
            todo.items[2]!,
          ],
        }}
      />,
    );
    const list = screen.getByTestId('composer-task-list');
    const description = within(list).getByText('为每项增加具体范围，并验证状态更新保留说明');
    expect(description.className).toBe('shell-composer-task-panel__description');
    expect(list.querySelectorAll('.shell-composer-task-panel__description')).toHaveLength(2);
    expect(within(list).getByText('实窗验证')).toBeTruthy();
  });

  it('shows a dismissed snapshot again when only its description changes', () => {
    const { rerender } = render(<ComposerTaskPanel todo={todo} />);
    fireEvent.click(screen.getByRole('button', { name: '清除任务清单' }));
    rerender(
      <ComposerTaskPanel
        todo={{
          ...todo,
          items: todo.items.map((item) => ({ ...item, description: '补充可核验的执行范围' })),
        }}
      />,
    );
    expect(screen.getByTestId('composer-task-panel')).toBeTruthy();
  });

  it('auto-expands the first real NewMax task summary and collapses in place', async () => {
    render(<ComposerTaskPanel todo={todo} scopeKey="conversation-a" />);

    const panel = screen.getByTestId('composer-task-panel');
    const toggle = within(panel).getByRole('button', { name: '任务进度 1/3' });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    expect(panel.textContent).toContain('实现输入框');
    expect(panel.textContent).toContain('(1/3)');
    expect(within(screen.getByTestId('composer-task-list')).getByText('确认需求')).toBeTruthy();
    expect(within(screen.getByTestId('composer-task-list')).getByText('实窗验证')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('composer-task-list')).toBeNull();
  });

  it('reflects even one native task and keeps dismissal scoped to one snapshot', () => {
    const { rerender } = render(<ComposerTaskPanel todo={todo} scopeKey="conversation-a" />);
    fireEvent.click(screen.getByRole('button', { name: '清除任务清单' }));
    expect(screen.queryByTestId('composer-task-panel')).toBeNull();

    rerender(
      <ComposerTaskPanel
        todo={{
          ...todo,
          completed: 2,
          items: todo.items.map((item, index) =>
            index === 1 ? { ...item, status: 'completed' as const } : item,
          ),
        }}
        scopeKey="conversation-a"
      />,
    );
    expect(screen.getByTestId('composer-task-panel')).toBeTruthy();

    rerender(
      <ComposerTaskPanel
        todo={{ running: true, completed: 0, total: 1, items: [todo.items[1]!] }}
        scopeKey="conversation-a"
      />,
    );
    expect(screen.getByTestId('composer-task-panel')).toBeTruthy();
  });

  it('auto-expands once per scope, including terminal snapshots, without reopening after manual collapse', async () => {
    const { rerender } = render(
      <ComposerTaskPanel todo={{ ...todo, running: false }} scopeKey="conversation-a" />,
    );
    const toggle = await screen.findByRole('button', { name: '任务进度 1/3' });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    rerender(<ComposerTaskPanel todo={null} scopeKey="conversation-a" />);
    rerender(
      <ComposerTaskPanel
        todo={{
          ...todo,
          completed: 2,
          items: todo.items.map((item, index) =>
            index === 1 ? { ...item, status: 'completed' as const } : item,
          ),
        }}
        scopeKey="conversation-a"
      />,
    );
    expect(screen.getByRole('button', { name: '任务进度 2/3' }).getAttribute('aria-expanded')).toBe(
      'false',
    );

    rerender(<ComposerTaskPanel todo={todo} scopeKey="conversation-b" />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '任务进度 1/3' }).getAttribute('aria-expanded'),
      ).toBe('true'),
    );
  });
});
