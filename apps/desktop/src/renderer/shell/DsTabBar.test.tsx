/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DsTabBar } from './DsTabBar.js';
import { SettingsSectionTabs } from './SettingsSectionTabs.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function KeyboardFixture() {
  const [value, setValue] = useState<'first' | 'disabled' | 'last'>('first');
  return (
    <DsTabBar<'first' | 'disabled' | 'last'>
      aria-label="测试分类"
      value={value}
      onChange={setValue}
      items={[
        { value: 'first', label: '第一项' },
        { value: 'disabled', label: '已停用', disabled: true },
        { value: 'last', label: '最后一项' },
      ]}
    />
  );
}

describe('DsTabBar', () => {
  it('uses roving focus and skips disabled tabs with arrow keys', () => {
    render(<KeyboardFixture />);
    const first = screen.getByRole('tab', { name: '第一项' });
    const last = screen.getByRole('tab', { name: '最后一项' });

    expect(first.tabIndex).toBe(0);
    expect(last.tabIndex).toBe(-1);

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(last.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(last);
    expect(last.tabIndex).toBe(0);

    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(first);
  });

  it('supports Home and End navigation', () => {
    render(<KeyboardFixture />);
    const first = screen.getByRole('tab', { name: '第一项' });
    const last = screen.getByRole('tab', { name: '最后一项' });

    fireEvent.keyDown(first, { key: 'End' });
    expect(last.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(last, { key: 'Home' });
    expect(first.getAttribute('aria-selected')).toBe('true');
  });
});

describe('SettingsSectionTabs', () => {
  it('applies the shared settings dimensions and scroll viewport', () => {
    render(
      <SettingsSectionTabs
        className="page-tabs"
        aria-label="页面分类"
        value="one"
        onChange={() => undefined}
        items={[
          { value: 'one', label: '一' },
          { value: 'two', label: '二' },
        ]}
      />,
    );

    const tablist = screen.getByRole('tablist', { name: '页面分类' });
    expect(tablist.classList.contains('settings-section-tabs')).toBe(true);
    expect(tablist.classList.contains('is-large')).toBe(true);
    expect(tablist.parentElement?.classList.contains('settings-section-tabs-viewport')).toBe(true);
    expect(tablist.parentElement?.classList.contains('page-tabs')).toBe(true);
  });
});
