/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlidingTabs } from './SlidingTabs.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Fixture() {
  const [tab, setTab] = useState<'plan' | 'debug'>('plan');
  return (
    <SlidingTabs aria-label="工作模式">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'plan'}
        onClick={() => setTab('plan')}
      >
        规划
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'debug'}
        onClick={() => setTab('debug')}
      >
        调试模式
      </button>
    </SlidingTabs>
  );
}

describe('SlidingTabs', () => {
  it('measures the active tab and slides to a differently sized tab', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.textContent === '调试模式' ? 52 : 3;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.textContent === '调试模式' ? 76 : 46;
    });

    const { container } = render(<Fixture />);
    const pill = container.querySelector<HTMLElement>('.shell-sliding-tabs__pill')!;
    expect(pill.style.transform).toBe('translateX(3px)');
    expect(pill.style.width).toBe('46px');

    fireEvent.click(screen.getByRole('tab', { name: '调试模式' }));
    expect(pill.style.transform).toBe('translateX(52px)');
    expect(pill.style.width).toBe('76px');
  });

  it('does not let an intrinsic resize observer snap the selected-tab transition', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const ResizeObserverMock = vi.fn().mockImplementation(() => ({ observe, disconnect }));
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    render(<Fixture />);
    fireEvent.click(screen.getByRole('tab', { name: '调试模式' }));

    expect(ResizeObserverMock).not.toHaveBeenCalled();
  });
});
