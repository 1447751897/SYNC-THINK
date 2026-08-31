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

  it('does not render one-item checklists and keeps dismissal scoped to one snapshot', () => {
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
        todo={{ running: true, completed: 0, total: 1, items: [todo.items[0]!] }}
        scopeKey="conversation-a"
      />,
    );
    expect(screen.queryByTestId('composer-task-panel')).toBeNull();
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
      expect(screen.getByRole('button', { name: '任务进度 1/3' }).getAttribute('aria-expanded')).toBe(
        'true',
      ),
    );
  });
});
