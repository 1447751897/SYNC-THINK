/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerActiveModePill, ComposerModeKeywordHint } from './ComposerModeControls.js';

afterEach(cleanup);

describe('NewMax composer mode controls', () => {
  it('renders a local Help preview pill that can clear the preview', () => {
    const onClick = vi.fn();
    render(<ComposerActiveModePill mode="help" onClick={onClick} />);

    const pill = screen.getByRole('button', { name: '退出帮助模式' });
    expect(pill.textContent).toContain('帮助');
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an active Plan pill whose click exits the mode', () => {
    const onClick = vi.fn();
    render(<ComposerActiveModePill mode="plan" onClick={onClick} />);

    const pill = screen.getByRole('button', { name: '退出规划模式' });
    expect(pill.textContent).toContain('规划');
    expect(pill.querySelector('[data-mode-icon]')).not.toBeNull();
    expect(pill.querySelector('[data-close-icon]')).not.toBeNull();
    fireEvent.click(pill);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('changes the Goal label and action for active and paused goals', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <ComposerActiveModePill mode="goal" goalStatus="active" onClick={onClick} />,
    );
    expect(screen.getByRole('button', { name: '暂停目标' }).textContent).toContain('目标运行中');

    rerender(<ComposerActiveModePill mode="goal" goalStatus="paused" onClick={onClick} />);
    expect(screen.getByRole('button', { name: '继续目标' }).textContent).toContain('目标已暂停');
  });

  it('offers Shift + Tab, accepts the detected mode, and can be dismissed', () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ComposerModeKeywordHint kind="goal" onAccept={onAccept} onDismiss={onDismiss} />,
    );

    const hint = screen.getByTestId('composer-mode-keyword-hint');
    expect(hint.textContent).toContain('创建目标');
    expect(hint.textContent).toContain('Shift + Tab');
    fireEvent.click(screen.getByRole('button', { name: '使用目标模式' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭目标模式建议' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
