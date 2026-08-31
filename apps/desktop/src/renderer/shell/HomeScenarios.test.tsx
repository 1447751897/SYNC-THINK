/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeScenarios } from './HomeScenarios.js';

let resize: ResizeObserverCallback | undefined;

beforeEach(() => {
  class ResizeObserverFixture implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resize = callback;
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverFixture);
});

afterEach(() => {
  cleanup();
  resize = undefined;
  vi.unstubAllGlobals();
});

describe('HomeScenarios', () => {
  it('shows at most six scenarios, adapts to width, and keeps overflow in More', () => {
    render(<HomeScenarios onSelectTemplate={vi.fn()} />);

    expect(screen.getAllByTestId('home-scenario-pill')).toHaveLength(6);
    expect(screen.getByRole('button', { name: '更多场景' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '管理场景' })).toBeTruthy();

    act(() => {
      resize?.(
        [{ contentRect: { width: 260 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    expect(screen.getAllByTestId('home-scenario-pill')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '更多场景' }));
    const overflow = screen.getByRole('menu', { name: '更多场景' });
    expect(within(overflow).getByRole('menuitem', { name: 'PPT' })).toBeTruthy();
    expect(within(overflow).getByRole('menuitem', { name: '翻译' })).toBeTruthy();
  });

  it('fills the composer from a real local template and does not fake scenario management', () => {
    const onSelectTemplate = vi.fn();
    render(<HomeScenarios onSelectTemplate={onSelectTemplate} />);

    fireEvent.click(screen.getByRole('button', { name: '研究' }));
    fireEvent.click(screen.getByRole('button', { name: /快速调研/ }));

    expect(onSelectTemplate).toHaveBeenCalledWith(
      '请先询问我要研究的主题和时间范围，再给出带来源的关键事实、分歧点和结论。',
    );
    const manage = screen.getByRole('button', { name: '管理场景' }) as HTMLButtonElement;
    expect(manage.disabled).toBe(true);
    expect(manage.title).toBe('当前使用内置场景模板');
  });

  it('opens a real management entry when the host provides one', () => {
    const onManage = vi.fn();
    render(<HomeScenarios onSelectTemplate={vi.fn()} onManage={onManage} />);

    fireEvent.click(screen.getByRole('button', { name: '管理场景' }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });
});
