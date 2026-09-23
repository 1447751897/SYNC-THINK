import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ComposerModeBanner,
  type ComposerGoalStatus,
} from '../src/components/ComposerModeBanner.js';

describe('ComposerModeBanner', () => {
  it('renders the read-only Plan route and opens model settings', () => {
    const onOpenSettings = vi.fn();
    render(
      <ComposerModeBanner
        mode="plan"
        planModelLabel="GPT-5.6 Sol"
        actModelLabel="Claude Sonnet 4.6"
        onOpenPlanSettings={onOpenSettings}
      />,
    );

    const banner = screen.getByTestId('composer-plan-banner');
    expect(banner.getAttribute('data-composer-mode')).toBe('plan');
    expect(banner.textContent).toContain('规划模式');
    expect(banner.textContent).toContain('只读');
    expect(banner.textContent).toContain('规划模型：GPT-5.6 Sol');
    expect(banner.textContent).toContain('执行模型：Claude Sonnet 4.6');
    fireEvent.click(screen.getByRole('button', { name: '设置规划/执行模型' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('renders Goal metrics and wires pause, resume and clear controls', () => {
    const goal: ComposerGoalStatus = {
      condition: '持续完成输入框重构，直到所有真实交互和视觉回归测试通过',
      status: 'active',
      turnCount: 3,
      roundsStarted: 4,
      maxGoalRounds: 10,
      tokensIn: 12000,
      tokensOut: 3400,
    };
    const handlers = {
      onPauseGoal: vi.fn(),
      onResumeGoal: vi.fn(),
      onConfigureGoal: vi.fn(),
      onClearGoal: vi.fn(),
    };
    const { rerender } = render(<ComposerModeBanner mode="goal" goal={goal} {...handlers} />);

    const banner = screen.getByTestId('composer-goal-banner');
    expect(banner.getAttribute('data-composer-mode')).toBe('goal');
    expect(banner.textContent).toContain('进行中');
    expect(banner.textContent).toContain('第 4/10 轮');
    expect(banner.textContent).toContain('15k token');
    fireEvent.click(screen.getByRole('button', { name: '暂停目标' }));
    fireEvent.click(screen.getByRole('button', { name: '清除目标' }));
    expect(handlers.onPauseGoal).toHaveBeenCalledTimes(1);
    expect(handlers.onConfigureGoal).not.toHaveBeenCalled();
    expect(handlers.onClearGoal).toHaveBeenCalledTimes(1);

    rerender(<ComposerModeBanner mode="goal" goal={{ ...goal, status: 'paused' }} {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: '继续目标' }));
    expect(handlers.onResumeGoal).toHaveBeenCalledTimes(1);
  });
});
