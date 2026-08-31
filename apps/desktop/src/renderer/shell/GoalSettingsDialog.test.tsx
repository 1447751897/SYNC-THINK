/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoalSettingsDialog } from './GoalSettingsDialog.js';

afterEach(cleanup);

describe('GoalSettingsDialog', () => {
  it('opens with the NewMax advanced settings copy, single-line fields, and defaults', () => {
    const onOpenChange = vi.fn();
    render(
      <GoalSettingsDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '目标高级设置' })).toBeTruthy();
    expect(screen.getByText('可选配置；不修改时目标模式会使用默认轮次和预算')).toBeTruthy();

    const objective = screen.getByLabelText('目标') as HTMLInputElement;
    const stopCondition = screen.getByLabelText('停止条件') as HTMLInputElement;
    expect(objective.tagName).toBe('INPUT');
    expect(objective.value).toBe('');
    expect(objective.placeholder).toBe('例：整理一份客户拜访计划');
    expect(stopCondition.tagName).toBe('INPUT');
    expect(stopCondition.value).toBe('');
    expect(stopCondition.placeholder).toBe('例：形成一版可直接发送的拜访邮件');
    expect((screen.getByLabelText('最大轮次') as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText('Token 预算') as HTMLInputElement).value).toBe('1000000');
    expect(
      screen.getByText('达到最大轮次或 token 预算时自动停止；可在 GoalPanel 随时暂停或取消。'),
    ).toBeTruthy();
    const dialog = screen.getByTestId('goal-settings-dialog');
    expect(dialog.classList.contains('goal-settings-dialog__content')).toBe(true);
    expect(dialog.className).toContain('w-[min(480px,calc(100vw-32px))]');
    expect(dialog.className).toContain('rounded-[18px]');
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('enables start only after both required descriptions are present', () => {
    const onSubmit = vi.fn();
    render(
      <GoalSettingsDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const start = screen.getByRole('button', { name: '开始' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('目标'), { target: { value: '完成输入框重构' } });
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('停止条件'), { target: { value: '相关测试全部通过' } });
    expect(start.disabled).toBe(false);
  });

  it('clamps numeric limits immediately with the same NewMax defaults and bounds', () => {
    render(
      <GoalSettingsDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const rounds = screen.getByLabelText('最大轮次') as HTMLInputElement;
    const tokens = screen.getByLabelText('Token 预算') as HTMLInputElement;

    fireEvent.change(rounds, { target: { value: '-5' } });
    expect(rounds.value).toBe('1');
    fireEvent.change(rounds, { target: { value: '80' } });
    expect(rounds.value).toBe('50');
    fireEvent.change(rounds, { target: { value: '' } });
    expect(rounds.value).toBe('10');
    fireEvent.change(rounds, { target: { value: '3.5' } });
    expect(rounds.value).toBe('3.5');

    fireEvent.change(tokens, { target: { value: '9999' } });
    expect(tokens.value).toBe('10000');
    fireEvent.change(tokens, { target: { value: '' } });
    expect(tokens.value).toBe('1000000');
    fireEvent.change(tokens, { target: { value: '1500000.5' } });
    expect(tokens.value).toBe('1500000.5');
  });

  it('preserves unfinished stop and limit fields across close while resyncing the objective', () => {
    const props = {
      initialValues: { condition: '初始目标' },
      onOpenChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    const { rerender } = render(<GoalSettingsDialog open {...props} />);

    fireEvent.change(screen.getByLabelText('目标'), { target: { value: '未提交目标' } });
    fireEvent.change(screen.getByLabelText('停止条件'), { target: { value: '未提交停止条件' } });
    fireEvent.change(screen.getByLabelText('最大轮次'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('Token 预算'), { target: { value: '1800000' } });

    rerender(<GoalSettingsDialog open={false} {...props} />);
    rerender(<GoalSettingsDialog open {...props} />);

    expect((screen.getByLabelText('目标') as HTMLInputElement).value).toBe('初始目标');
    expect((screen.getByLabelText('停止条件') as HTMLInputElement).value).toBe('未提交停止条件');
    expect((screen.getByLabelText('最大轮次') as HTMLInputElement).value).toBe('18');
    expect((screen.getByLabelText('Token 预算') as HTMLInputElement).value).toBe('1800000');
  });

  it('edits initial values and submits a trimmed typed payload', () => {
    const onSubmit = vi.fn();
    render(
      <GoalSettingsDialog
        open
        mode="edit"
        initialValues={{
          condition: '旧目标',
          stopCondition: '旧停止条件',
          maxGoalRounds: 8,
          maxGoalTokens: 800_000,
        }}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect((screen.getByLabelText('目标') as HTMLInputElement).value).toBe('旧目标');
    expect((screen.getByLabelText('停止条件') as HTMLInputElement).value).toBe('旧停止条件');
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: '  完成 NewMax 对齐  ' } });
    fireEvent.change(screen.getByLabelText('停止条件'), { target: { value: '  宽窄屏回归通过  ' } });
    fireEvent.change(screen.getByLabelText('最大轮次'), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText('Token 预算'), { target: { value: '1500000' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(onSubmit).toHaveBeenCalledWith({
      condition: '完成 NewMax 对齐',
      stopCondition: '宽窄屏回归通过',
      maxGoalRounds: 24,
      maxGoalTokens: 1_500_000,
    });
  });

  it('requires a second confirmation for a high-risk goal without losing form input', () => {
    const onSubmit = vi.fn();
    render(
      <GoalSettingsDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText('目标'), {
      target: { value: '  执行 rm -rf ./generated 后重建  ' },
    });
    fireEvent.change(screen.getByLabelText('停止条件'), {
      target: { value: '  构建和测试通过  ' },
    });
    fireEvent.change(screen.getByLabelText('最大轮次'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Token 预算'), { target: { value: '1200000' } });
    fireEvent.click(screen.getByRole('button', { name: '开始' }));

    const warning = screen.getByRole('dialog', { name: '高风险操作' });
    expect(screen.getByTestId('goal-risk-confirmation-dialog').className).toContain(
      'w-[min(420px,calc(100vw-32px))]',
    );
    expect(warning.textContent).toContain(
      '目标中包含高风险操作（如 rm -rf、force push、DROP TABLE 等）。AI 在自主循环模式下可能直接执行这些操作，请确认你了解风险。',
    );
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(screen.queryByRole('dialog', { name: '高风险操作' })).toBeNull();
    expect((screen.getByLabelText('目标') as HTMLInputElement).value).toBe(
      '  执行 rm -rf ./generated 后重建  ',
    );
    expect((screen.getByLabelText('停止条件') as HTMLInputElement).value).toBe('  构建和测试通过  ');
    expect((screen.getByLabelText('最大轮次') as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText('Token 预算') as HTMLInputElement).value).toBe('1200000');

    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    fireEvent.click(screen.getByRole('button', { name: '仍然继续' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      condition: '执行 rm -rf ./generated 后重建',
      stopCondition: '构建和测试通过',
      maxGoalRounds: 12,
      maxGoalTokens: 1_200_000,
    });
  });
});
