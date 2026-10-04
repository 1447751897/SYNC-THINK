/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComposerModeBanner,
  NEWMAX_GOAL_BANNER_TRANSITION_MS,
  NEWMAX_PLAN_BANNER_TRANSITION_MS,
  NewMaxComposerFrame,
} from '@sync-think/ui-kit';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
  vi.restoreAllMocks();
});

const planBanner = () => (
  <ComposerModeBanner
    mode="plan"
    planModelLabel="GPT-5.6 Sol"
    actModelLabel="Claude Sonnet 4.6"
    onOpenPlanSettings={() => undefined}
  />
);

const goalBanner = () => (
  <ComposerModeBanner mode="goal" pendingCondition="完成 Composer 动效对齐" />
);

describe('NewMaxComposerFrame', () => {
  it('shares one frame while preserving empty and conversation editor geometry', () => {
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
    expect(screen.getByTestId('newmax-composer-mode').textContent).toContain('规划模式');
  });

  it('uses the exact 220ms ease-out lifecycle for the Plan banner', () => {
    vi.useFakeTimers();
    const { rerender } = render(<NewMaxComposerFrame variant="conversation" />);

    rerender(<NewMaxComposerFrame variant="conversation" modeBanner={planBanner()} />);

    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'entering',
    );
    expect(screen.getByTestId('newmax-composer-mode').getAttribute('data-mode')).toBe('plan');

    act(() => vi.advanceTimersByTime(NEWMAX_PLAN_BANNER_TRANSITION_MS - 1));
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'entering',
    );
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'stable',
    );

    rerender(<NewMaxComposerFrame variant="conversation" />);

    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'exiting',
    );
    expect(screen.getByTestId('newmax-composer-mode').textContent).toContain('规划模式');

    act(() => vi.advanceTimersByTime(NEWMAX_PLAN_BANNER_TRANSITION_MS - 1));
    expect(screen.getByTestId('newmax-composer-mode')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));

    expect(screen.queryByTestId('newmax-composer-mode')).toBeNull();
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'idle',
    );
  });

  it('replays a keyed 240ms soft transition when Plan switches to Goal', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <NewMaxComposerFrame variant="conversation" modeBanner={planBanner()} />,
    );
    const planNode = screen.getByTestId('newmax-composer-mode');
    expect(planNode.getAttribute('data-mode')).toBe('plan');
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'stable',
    );

    rerender(<NewMaxComposerFrame variant="conversation" modeBanner={goalBanner()} />);

    const goalNode = screen.getByTestId('newmax-composer-mode');
    expect(goalNode).not.toBe(planNode);
    expect(goalNode.getAttribute('data-mode')).toBe('goal');
    expect(goalNode.getAttribute('data-motion-key')).toBe('goal');
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'entering',
    );

    act(() => vi.advanceTimersByTime(NEWMAX_GOAL_BANNER_TRANSITION_MS - 1));
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'entering',
    );
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'stable',
    );
  });

  it('changes mode banners without transitional frames when reduced motion is enabled', () => {
    document.documentElement.setAttribute('data-reduced-motion', '');
    const { rerender } = render(<NewMaxComposerFrame variant="conversation" />);

    rerender(<NewMaxComposerFrame variant="conversation" modeBanner={goalBanner()} />);
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'stable',
    );

    rerender(<NewMaxComposerFrame variant="conversation" />);
    expect(screen.queryByTestId('newmax-composer-mode')).toBeNull();
    expect(screen.getByTestId('newmax-composer-frame').getAttribute('data-mode-state')).toBe(
      'idle',
    );
  });
});


it.each(['plan', 'goal'] as const)('keeps the attachment backplate directly above the input with a %s mode card', (mode) => {
  render(
    <NewMaxComposerFrame
      variant="conversation"
      presentation="attachments"
      modeBanner={mode === 'plan' ? planBanner() : goalBanner()}
      contextBar={<nav data-testid="backplate">仓库与分支</nav>}
      input={<textarea aria-label="消息" />}
    />,
  );
  const frame = screen.getByTestId('newmax-composer-frame');
  const header = screen.getByTestId('backplate');
  const card = screen.getByTestId('newmax-composer-mode');
  expect(frame.firstElementChild).toBe(card);
  expect(card.nextElementSibling).toBe(header);
  expect(header.nextElementSibling?.classList.contains('shell-compose')).toBe(true);
  expect(screen.getAllByTestId('backplate')).toHaveLength(1);
  expect(screen.queryByTestId('composer-status-bar')).toBeNull();
});
