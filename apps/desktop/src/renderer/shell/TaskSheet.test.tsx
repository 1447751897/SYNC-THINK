/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskSheet } from './TaskSheet.js';
import { TaskSelect } from './TaskSelect.js';
import { TaskTemporalPicker } from './TaskTemporalPicker.js';
import { TaskScopePicker } from './TaskScopePicker.js';

afterEach(cleanup);

describe('task sheet popup scroll boundary', () => {
  const options = (
    <TaskSelect aria-label="任务选项" value="first" onChange={vi.fn()}>
      <option value="first">第一项</option>
      <option value="last">最后一项</option>
    </TaskSelect>
  );

  it.each(['select', 'time', 'scope'] as const)('keeps the %s popup inside the modal, outside its scrolling body', async (kind) => {
    render(
      <TaskSheet title="任务编辑" description="配置任务" footer={null} onClose={vi.fn()} testId="sheet">
        {kind === 'select' ? options : kind === 'time' ? (
          <TaskTemporalPicker type="time" value="09:00" onChange={vi.fn()} />
        ) : (
          <TaskScopePicker value="global" tasks={[]} workspaces={[]} onChange={vi.fn()} />
        )}
      </TaskSheet>,
    );
    const trigger = kind === 'select'
      ? screen.getByRole('combobox', { name: '任务选项' })
      : screen.getByRole('button', { name: kind === 'time' ? '选择开始时间' : '按任务归属筛选' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    expect(menu.closest('.task-sheet')).toBe(screen.getByTestId('sheet'));
    expect(menu.closest('.task-sheet__body')).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps standalone pickers on the default portal without introducing a dialog', async () => {
    const { container } = render(options);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown', code: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    expect(menu.closest('.task-sheet')).toBeNull();
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });
});
