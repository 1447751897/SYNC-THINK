/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSER_PEEK_TRANSITION_MS,
  ComposerApprovalStack,
} from './ComposerApprovalStack.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ComposerApprovalStack', () => {
  it('stacks tool approval above plan approval and keeps only the bottom surface peeking', () => {
    render(
      <ComposerApprovalStack
        tool={{ key: 'tool-1', node: <div>工具审批</div> }}
        plan={{ key: 'plan-1', node: <div>方案审批</div> }}
      />,
    );

    const surfaces = screen.getAllByTestId('composer-peek-surface');
    expect(surfaces).toHaveLength(2);
    expect(surfaces[0]?.textContent).toContain('工具审批');
    expect(surfaces[0]?.getAttribute('data-detached')).toBe('true');
    expect(surfaces[1]?.textContent).toContain('方案审批');
    expect(surfaces[1]?.getAttribute('data-detached')).toBe('false');
  });

  it('detaches the bottom approval when a mode banner is below it', () => {
    render(
      <ComposerApprovalStack
        hasSurfaceBelow
        plan={{ key: 'plan-1', node: <div>方案审批</div> }}
      />,
    );

    expect(screen.getByTestId('composer-peek-surface').getAttribute('data-detached')).toBe('true');
  });

  it('retains a disappearing approval through the NewMax exit animation', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ComposerApprovalStack tool={{ key: 'tool-1', node: <div>工具审批</div> }} />,
    );

    rerender(<ComposerApprovalStack />);
    expect(screen.getByTestId('composer-peek-surface').getAttribute('data-state')).toBe('exiting');
    expect(screen.getByText('工具审批')).toBeTruthy();

    act(() => vi.advanceTimersByTime(COMPOSER_PEEK_TRANSITION_MS));
    expect(screen.queryByText('工具审批')).toBeNull();
  });

  it('keeps the entering phase alive when the same approval rerenders', () => {
    vi.useFakeTimers();
    const { rerender } = render(<ComposerApprovalStack />);

    rerender(<ComposerApprovalStack tool={{ key: 'tool-1', node: <div>等待审批</div> }} />);
    expect(screen.getByTestId('composer-peek-surface').getAttribute('data-state')).toBe('entering');

    rerender(<ComposerApprovalStack tool={{ key: 'tool-1', node: <div>正在处理</div> }} />);
    expect(screen.getByTestId('composer-peek-surface').getAttribute('data-state')).toBe('entering');
    expect(screen.getByText('正在处理')).toBeTruthy();

    act(() => vi.advanceTimersByTime(COMPOSER_PEEK_TRANSITION_MS));
    expect(screen.getByTestId('composer-peek-surface').getAttribute('data-state')).toBe('stable');
  });
});
