import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ComposerTaskPanel,
  type ComposerTaskProjection,
} from '../src/components/ComposerTaskPanel.js';

const todo: ComposerTaskProjection = {
  running: true,
  completed: 1,
  total: 3,
  items: [
    { title: '确认需求', status: 'completed' },
    { title: '实现输入框', status: 'in_progress' },
    { title: '实窗验证', status: 'pending' },
  ],
};

describe('ComposerTaskPanel', () => {
  it('hides empty and fully completed lists', () => {
    const { rerender } = render(<ComposerTaskPanel todo={null} />);
    expect(screen.queryByTestId('composer-task-panel')).toBeNull();
    rerender(<ComposerTaskPanel todo={{ ...todo, items: [], total: 0, completed: 0 }} />);
    expect(screen.queryByTestId('composer-task-panel')).toBeNull();
    rerender(
      <ComposerTaskPanel
        todo={{
          ...todo,
          completed: todo.total,
          items: todo.items.map((item) => ({ ...item, status: 'completed' })),
        }}
      />,
    );
    expect(screen.queryByTestId('composer-task-panel')).toBeNull();
  });

  it('shows descriptions while keeping legacy items compact', () => {
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
    expect(list.querySelectorAll('.shell-composer-task-panel__description')).toHaveLength(2);
    expect(within(list).getByText('实窗验证')).toBeTruthy();
  });

  it('shows a dismissed snapshot again when its description changes', () => {
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

  it('auto-expands the first summary and collapses in place', async () => {
    render(<ComposerTaskPanel todo={todo} scopeKey="conversation-a" />);

    const toggle = screen.getByRole('button', { name: '任务进度 1/3' });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByTestId('composer-task-list').textContent).toContain('实现输入框');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('composer-task-list').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('composer-task-list').closest('.shell-composer-task-panel__reveal')?.getAttribute('data-expanded')).toBe('false');
  });

  it('keeps dismissal scoped to one snapshot', () => {
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
  });

  it('auto-expands only once per scope', async () => {
    const { rerender } = render(<ComposerTaskPanel todo={todo} scopeKey="conversation-a" />);
    const toggle = await screen.findByRole('button', { name: '任务进度 1/3' });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    fireEvent.click(toggle);

    rerender(<ComposerTaskPanel todo={null} scopeKey="conversation-a" />);
    rerender(<ComposerTaskPanel todo={todo} scopeKey="conversation-a" />);
    expect(screen.getByRole('button', { name: '任务进度 1/3' }).getAttribute('aria-expanded')).toBe(
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
