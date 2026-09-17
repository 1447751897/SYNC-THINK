/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelListSelect, computeMenuLayout, menuNaturalHeight } from './ModelListSelect.js';

afterEach(cleanup);

const OPTIONS = Array.from({ length: 7 }, (_, index) => ({
  value: `model-${index}`,
  label: `model-${index}`,
}));

const rect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    left: 20,
    right: 320,
    width: 300,
    height: bottom - top,
    x: 20,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

describe('menuNaturalHeight', () => {
  it('7 项内容需要 246px —— 这正是写死 240px 时被切掉一行下半截的原因', () => {
    expect(menuNaturalHeight(7)).toBe(246);
  });
});

describe('computeMenuLayout', () => {
  it('下方空间充足时完整展开，不产生滚动', () => {
    const layout = computeMenuLayout({
      itemCount: 7,
      triggerTop: 100,
      triggerBottom: 140,
      triggerLeft: 20,
      triggerWidth: 300,
      viewportHeight: 900,
    });
    expect(layout.maxHeight).toBe(246);
    expect(layout.maxHeight).toBeGreaterThanOrEqual(menuNaturalHeight(7));
    expect(layout.top).toBe(144);
  });

  it('下方不足且上方宽裕时向上翻转，菜单不越出视口', () => {
    const layout = computeMenuLayout({
      itemCount: 12,
      triggerTop: 700,
      triggerBottom: 740,
      triggerLeft: 20,
      triggerWidth: 300,
      viewportHeight: 800,
    });
    // 菜单整体落在触发器上方，且底部不越过视口下边距
    expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(700);
    expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(800 - 8);
    expect(layout.top).toBeGreaterThanOrEqual(8);
  });

  it('空间极窄时保证最小可见行数并压回可视区', () => {
    const layout = computeMenuLayout({
      itemCount: 30,
      triggerTop: 90,
      triggerBottom: 130,
      triggerLeft: 20,
      triggerWidth: 300,
      viewportHeight: 200,
    });
    expect(layout.maxHeight).toBeGreaterThanOrEqual(4 * 34 + 10);
    expect(layout.top).toBeGreaterThanOrEqual(8);
  });

  it('宽度不小于 160px', () => {
    const layout = computeMenuLayout({
      itemCount: 3,
      triggerTop: 100,
      triggerBottom: 140,
      triggerLeft: 20,
      triggerWidth: 80,
      viewportHeight: 900,
    });
    expect(layout.width).toBe(160);
  });
});

describe('ModelListSelect', () => {
  it('展开时按可用空间下发内联 maxHeight，而不是固定 240px', () => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    render(
      <ModelListSelect
        label="视觉模型"
        value=""
        placeholder="选择视觉模型…"
        options={OPTIONS}
        onChange={() => {}}
      />,
    );
    const trigger = screen.getByRole('combobox');
    trigger.getBoundingClientRect = () => rect(100, 140);
    fireEvent.click(trigger);
    const menu = screen.getByRole('listbox');
    expect(menu.style.maxHeight).toBe('246px');
    expect(menu.querySelectorAll('.model-list-select__option')).toHaveLength(7);
  });
});
