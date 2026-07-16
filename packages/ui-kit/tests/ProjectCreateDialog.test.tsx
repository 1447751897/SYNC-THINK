import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectCreateDialog } from '../src/components/ProjectCreateDialog.js';

describe('ProjectCreateDialog', () => {
  it('creates a named project without asking for a folder', () => {
    const onSubmit = vi.fn();
    render(
      <ProjectCreateDialog open busy={false} error={null} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('dialog', { name: '新建项目' })).toBeTruthy();
    expect(screen.queryByLabelText(/文件夹/)).toBeNull();
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: ' Project Atlas ' } });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(onSubmit).toHaveBeenCalledWith('Project Atlas');
  });

  it('keeps validation and runtime errors visible', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ProjectCreateDialog open busy={false} error={null} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(screen.getByRole('alert').textContent).toMatch(/请输入项目名称/);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <ProjectCreateDialog
        open
        busy={false}
        error="项目创建失败"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/项目创建失败/);
  });

  it('disables project input and submit while busy but keeps cancel available', () => {
    const onClose = vi.fn();
    render(<ProjectCreateDialog open busy error={null} onClose={onClose} onSubmit={vi.fn()} />);
    expect((screen.getByLabelText('项目名称') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '正在创建…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
