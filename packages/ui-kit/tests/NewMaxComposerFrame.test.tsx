import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NEWMAX_GOAL_BANNER_TRANSITION_MS,
  NEWMAX_PLAN_BANNER_TRANSITION_MS,
  NewMaxComposerFrame,
} from '../src/components/NewMaxComposerFrame.js';

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
  vi.restoreAllMocks();
});

const planBanner = () => <div mode="plan">规划模式</div>;
const goalBanner = () => <div mode="goal">目标模式</div>;

describe('NewMaxComposerFrame', () => {
  it.each(['empty', 'conversation'] as const)('keeps %s repository context outside the input and above mode banners', (variant) => {
    const { rerender } = render(
      <NewMaxComposerFrame
        variant={variant}
        contextBar={<div data-testid="repository-context">仓库</div>}
        modeBanner={planBanner()}
      >
        <textarea aria-label="消息" />
      </NewMaxComposerFrame>,
    );
    const frame = screen.getByTestId('newmax-composer-frame');
    const context = screen.getByTestId('repository-context');
    const surface = screen.getByRole('textbox').closest('.shell-compose');
    expect(context.parentElement).toBe(frame);
    expect(context.closest('.shell-compose')).toBeNull();
    expect(context.nextElementSibling).toBe(screen.getByTestId('newmax-composer-mode'));
    expect(surface?.parentElement).toBe(frame);

    rerender(<NewMaxComposerFrame variant={variant} input={<textarea aria-label="消息" />} />);
    expect(screen.queryByTestId('repository-context')).toBeNull();
    // No context wrapper or reserved gap when the context component returns null.
    expect(frame.querySelector('.shell-compose')).toBeTruthy();
  });

  it('preserves empty and conversation editor geometry', () => {
    const { rerender } = render(
      <NewMaxComposerFrame
        variant="empty"
        input={<textarea aria-label="消息" />}
        toolbar={<div>工具</div>}
      />,
    );

    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-variant')).toBe('empty');
    expect(screen.getByTestId('newmax-composer-editor').className).toContain('is-empty');

    rerender(
      <NewMaxComposerFrame
        variant="conversation"
        modeBanner={<div>规划模式</div>}
        input={<textarea aria-label="消息" />}
        toolbar={<div>工具</div>}
      />,
    );

    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-variant')).toBe(
      'conversation',
    );
    expect(screen.getByTestId('newmax-composer-editor').className).toContain('is-conversation');
  });

  it('retains a Plan banner for its 220ms exit motion', () => {
    vi.useFakeTimers();
    const { rerender } = render(<NewMaxComposerFrame variant="conversation" />);

    rerender(<NewMaxComposerFrame variant="conversation" modeBanner={planBanner()} />);
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'entering',
    );
    act(() => vi.advanceTimersByTime(NEWMAX_PLAN_BANNER_TRANSITION_MS));
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'stable',
    );

    rerender(<NewMaxComposerFrame variant="conversation" />);
    expect(screen.getByTestId('newmax-composer-mode').textContent).toContain('规划模式');
    expect(screen.getByTestId('newmax-composer-mode').getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(NEWMAX_PLAN_BANNER_TRANSITION_MS));
    expect(screen.queryByTestId('newmax-composer-mode')).toBeNull();
  });

  it('replays the 240ms transition when Plan switches to Goal', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <NewMaxComposerFrame variant="conversation" modeBanner={planBanner()} />,
    );

    rerender(<NewMaxComposerFrame variant="conversation" modeBanner={goalBanner()} />);
    expect(screen.getByTestId('newmax-composer-mode').getAttribute('data-mode')).toBe('goal');
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'entering',
    );
    act(() => vi.advanceTimersByTime(NEWMAX_GOAL_BANNER_TRANSITION_MS));
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'stable',
    );
  });

  it('skips transitional frames when reduced motion is enabled', () => {
    document.documentElement.setAttribute('data-reduced-motion', '');
    const { rerender } = render(<NewMaxComposerFrame variant="conversation" />);

    rerender(<NewMaxComposerFrame variant="conversation" modeBanner={goalBanner()} />);
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'stable',
    );

    rerender(<NewMaxComposerFrame variant="conversation" />);
    expect(screen.queryByTestId('newmax-composer-mode')).toBeNull();
  });
});
