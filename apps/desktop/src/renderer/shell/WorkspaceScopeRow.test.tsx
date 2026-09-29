/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkspaceScopeRow } from './WorkspaceScopeRow.js';

afterEach(cleanup);

const options = [
  { id: 'global', label: '全局' },
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `workspace-${index + 1}`,
    label: `工作区 ${index + 1}`,
  })),
];

it('keeps overflow selections in their original position and marks them in the menu', async () => {
  const onChange = vi.fn();
  const view = render(
    <WorkspaceScopeRow
      options={options}
      fixedCount={1}
      value="global"
      label="工作区范围"
      onChange={onChange}
    />,
  );
  const group = screen.getByRole('group', { name: '工作区范围' });
  expect(within(group).getByRole('button', { name: '还有 2 个工作区' })).toBeTruthy();
  fireEvent.keyDown(within(group).getByRole('button', { name: '还有 2 个工作区' }), {
    key: 'ArrowDown',
  });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: '工作区 6' }));
  expect(onChange).toHaveBeenCalledWith('workspace-6');
  await waitFor(() => expect(screen.queryByRole('menuitemradio')).toBeNull());
  view.rerender(
    <WorkspaceScopeRow
      options={options}
      fixedCount={1}
      value="workspace-6"
      label="工作区范围"
      onChange={onChange}
    />,
  );
  expect(within(group).queryByRole('button', { name: '工作区 6' })).toBeNull();
  expect(
    Array.from(group.querySelectorAll('.ability-hub__scope-pill'), (pill) => pill.textContent),
  ).toEqual(options.map((option) => option.label));
  const more = within(group).getByRole('button', { name: '还有 2 个工作区，当前选择：工作区 6' });
  expect(more.classList.contains('is-active')).toBe(true);
  fireEvent.keyDown(more, { key: 'ArrowDown' });
  expect(
    (await screen.findByRole('menuitemradio', { name: '工作区 6' })).getAttribute('aria-checked'),
  ).toBe('true');
  expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
    '工作区 5',
    '工作区 6',
  ]);
});

it.each([1, 2])(
  'preserves the supplied order when clicking visible workspaces with %s fixed entries',
  (fixedCount) => {
    const stableOptions = [options[0]!, options[3]!, options[1]!, options[2]!];
    const onChange = vi.fn();
    const props = { options: stableOptions, fixedCount, label: '工作区范围', onChange };
    const view = render(<WorkspaceScopeRow {...props} value="global" />);
    const group = screen.getByRole('group', { name: '工作区范围' });
    for (const option of [...stableOptions].reverse()) {
      fireEvent.click(within(group).getByRole('button', { name: option.label }));
      expect(onChange).toHaveBeenLastCalledWith(option.id);
      view.rerender(<WorkspaceScopeRow {...props} value={option.id} />);
      expect(
        within(group)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(stableOptions.map((item) => item.label));
      expect(
        within(group).getByRole('button', { name: option.label }).getAttribute('aria-pressed'),
      ).toBe('true');
    }
  },
);

it('does not offer +N when every workspace is visible', () => {
  render(
    <WorkspaceScopeRow
      options={options.slice(0, 3)}
      fixedCount={1}
      value="global"
      label="工作区范围"
      onChange={() => {}}
    />,
  );
  expect(screen.queryByRole('button', { name: /还有 .* 个工作区/ })).toBeNull();
});

it('shows +N only after chips exceed the available row width', () => {
  let width = 600;
  let notify = () => {};
  const oldResizeObserver = globalThis.ResizeObserver;
  const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('ability-hub__workspace-row') ? width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('ability-hub__scope-pill') ? 60 : 0;
    },
  });
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      notify = () => callback([], this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  try {
    render(
      <WorkspaceScopeRow
        options={options}
        fixedCount={1}
        value="workspace-6"
        label="工作区范围"
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /还有 .* 个工作区/ })).toBeNull();
    width = 200;
    act(() => notify());
    expect(
      screen.getByRole('button', { name: '还有 5 个工作区，当前选择：工作区 6' }),
    ).toBeTruthy();
    width = 600;
    act(() => notify());
    const group = screen.getByRole('group', { name: '工作区范围' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(options.map((option) => option.label));
    expect(
      within(group).getByRole('button', { name: '工作区 6' }).getAttribute('aria-pressed'),
    ).toBe('true');
  } finally {
    if (oldResizeObserver === undefined)
      delete (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    else globalThis.ResizeObserver = oldResizeObserver;
    if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
  }
});
