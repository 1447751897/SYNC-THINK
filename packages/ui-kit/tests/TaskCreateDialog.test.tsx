import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TaskCreateDialog } from '../src/components/TaskCreateDialog.js';

describe('TaskCreateDialog', () => {
  it('submits title and optional goal', () => {
    const onSubmit = vi.fn();
    render(
      <TaskCreateDialog
        open
        busy={false}
        error={null}
        workspaceName="博客"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('task-create-title'), {
      target: { value: '写缓存文章' },
    });
    fireEvent.change(screen.getByTestId('task-create-goal'), {
      target: { value: '按项目规范输出' },
    });
    fireEvent.submit(screen.getByTestId('task-create-form'));

    expect(onSubmit).toHaveBeenCalledWith({
      title: '写缓存文章',
      goal: '按项目规范输出',
    });
  });

  it('falls back goal to title when goal is empty', () => {
    const onSubmit = vi.fn();
    render(
      <TaskCreateDialog open busy={false} error={null} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByTestId('task-create-title'), {
      target: { value: '  仅标题  ' },
    });
    fireEvent.submit(screen.getByTestId('task-create-form'));
    expect(onSubmit).toHaveBeenCalledWith({ title: '仅标题', goal: '仅标题' });
  });

  it('blocks empty title', () => {
    const onSubmit = vi.fn();
    render(
      <TaskCreateDialog open busy={false} error={null} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByTestId('task-create-title'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByTestId('task-create-form'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('task-create-error').textContent).toMatch(/标题/);
  });
});
