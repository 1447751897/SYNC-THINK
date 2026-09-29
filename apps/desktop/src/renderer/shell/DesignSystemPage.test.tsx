/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { DesignSystemPage } from './DesignSystemPage.js';
import { DOCUMENTED_COMPONENTS, routeHash } from './design-system/catalog.js';
import { STORAGE_KEY } from './design-system/theme.js';
vi.mock('./design-system/PreviewFrame.js', async () => {
  const { createContext } = await import('react');
  return {
    PreviewTheme: createContext({}),
    PreviewFrame: ({ name, thumbnail }: { name: string; thumbnail?: boolean }) => (
      <div data-testid={thumbnail ? 'thumbnail' : 'fixture'}>{name}</div>
    ),
  };
});
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
describe('DesignSystemPage', () => {
  it('updates real scoped CSS variables and preserves edits when switching modes and remounting', () => {
    const original = document.documentElement.getAttribute('style');
    const view = render(<DesignSystemPage />);
    fireEvent.click(screen.getByRole('button', { name: '打开主题工作台' }));
    const accent = screen.getByRole('textbox', { name: '--color-accent' });
    fireEvent.change(accent, { target: { value: '#aabbcc' } });
    fireEvent.keyDown(accent, { key: 'Enter' });
    expect(screen.getByTestId('design-system-page').style.getPropertyValue('--color-accent')).toBe(
      '#aabbcc',
    );
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(screen.getByTestId('design-system-page').classList.contains('dark')).toBe(true);
    expect(
      screen.getByTestId('design-system-page').style.getPropertyValue('--color-accent'),
    ).not.toBe('#aabbcc');
    fireEvent.click(screen.getByRole('button', { name: '浅色' }));
    expect(
      (screen.getByRole('textbox', { name: '--color-accent' }) as HTMLInputElement).value,
    ).toBe('#aabbcc');
    expect(document.documentElement.getAttribute('style')).toBe(original);
    view.unmount();
    render(<DesignSystemPage />);
    expect(screen.getByTestId('design-system-page').style.getPropertyValue('--color-accent')).toBe(
      '#aabbcc',
    );
    fireEvent.click(screen.getByRole('button', { name: '打开主题工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '重置主题' }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).overrides.light).toEqual({});
  });
  it('opens a visual design first, with implementation details secondary', () => {
    render(<DesignSystemPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索组件或 token' }), {
      target: { value: 'ShellApp' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查看 App Shell · ShellApp' }));
    expect(screen.getByTestId('fixture').textContent).toBe('ShellApp');
    expect(screen.queryByText('apps/desktop/src/renderer/shell/ShellApp.tsx')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '实现说明' }));
    expect(screen.getByText('apps/desktop/src/renderer/shell/ShellApp.tsx')).toBeTruthy();
    expect(screen.getByText(/本场景由 Sync-Think 原有组件组合/)).toBeTruthy();
  });
  it('lists every token and filters by group, with an empty state', () => {
    render(<DesignSystemPage />);
    fireEvent.click(screen.getByRole('button', { name: '主题 Token' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Token 分组' }), {
      target: { value: 'radius' },
    });
    expect(screen.getByText('5 个 token')).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('textbox', { name: '--radius-card' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索组件或 token' }), {
      target: { value: 'does-not-exist' },
    });
    expect(screen.getByText('没有匹配的 token，试试其他关键词。')).toBeTruthy();
  });
  it('imports validated local JSON and reports invalid input without losing state', async () => {
    render(<DesignSystemPage />);
    fireEvent.click(screen.getByRole('button', { name: '打开主题工作台' }));
    const input = screen.getByLabelText('导入主题 JSON');
    fireEvent.change(input, {
      target: {
        files: [
          {
            size: 120,
            text: async () =>
              JSON.stringify({
                version: 1,
                mode: 'dark',
                preset: 'azure',
                overrides: { light: {}, dark: { '--color-accent': '#abc123' } },
              }),
          },
        ],
      },
    });
    await waitFor(() => expect(screen.getByText('主题草稿已导入。')).toBeTruthy());
    expect(screen.getByTestId('design-system-page').style.getPropertyValue('--color-accent')).toBe(
      '#abc123',
    );
    fireEvent.change(input, { target: { files: [{ size: 3, text: async () => 'bad' }] } });
    await waitFor(() => expect(screen.getByText(/导入失败/)).toBeTruthy());
    expect(screen.getByTestId('design-system-page').style.getPropertyValue('--color-accent')).toBe(
      '#abc123',
    );
  });

  it('categorizes the full collection and renders only the selected live fixture', () => {
    render(<DesignSystemPage />);
    const sidebar = screen.getByRole('complementary', { name: '组件分类导航' });
    fireEvent.click(within(sidebar).getByRole('button', { name: /基础交互\s*16/ }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('基础交互');
    expect(
      within(screen.getByRole('main')).getAllByRole('button', { name: /^查看 .* · / }),
    ).toHaveLength(16);
    fireEvent.click(screen.getByRole('button', { name: '查看 Button · CodeBlockButton' }));
    expect(screen.getByTestId('fixture').textContent).toBe('CodeBlockButton');
    expect(screen.getAllByTestId('fixture')).toHaveLength(1);
    expect(
      within(sidebar)
        .getByRole('button', { name: /^Button\s*可交互$/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '实现说明' }));
    expect(screen.queryByTestId('fixture')).toBeNull();
    expect(screen.getByText('apps/desktop/src/renderer/shell/CodeBlockButton.tsx')).toBeTruthy();
  });
  it('restores deep links and responds to history navigation', () => {
    const component = DOCUMENTED_COMPONENTS.find((c) => c.name === 'ComposerEditor')!;
    window.history.replaceState(null, '', routeHash({ view: 'component', id: component.id }));
    const view = render(<DesignSystemPage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Prompt Input');
    view.unmount();
    render(<DesignSystemPage />);
    expect(screen.getByTestId('fixture').textContent).toBe('ComposerEditor');
    window.history.replaceState(null, '', routeHash({ view: 'category', section: 'legacy' }));
    fireEvent(window, new PopStateEvent('popstate'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('历史 UI Kit');
    expect(
      within(screen.getByRole('main')).getAllByRole('button', { name: /^查看 .* · / }),
    ).toHaveLength(23);
    expect(screen.queryByTestId('fixture')).toBeNull();
  });
  it('offers all live examples and global search with a recoverable empty state', () => {
    render(<DesignSystemPage />);
    fireEvent.click(screen.getByRole('button', { name: /^设计场景\s*123$/ }));
    expect(
      within(screen.getByRole('main')).getAllByRole('button', { name: /^查看 .* · / }),
    ).toHaveLength(123);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索组件或 token' }), {
      target: { value: 'ShellApp' },
    });
    expect(screen.getByRole('button', { name: '查看 App Shell · ShellApp' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索组件或 token' }), {
      target: { value: 'zz-does-not-exist' },
    });
    expect(screen.getByRole('heading', { name: '没有找到匹配的组件' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '清空搜索' })[1]);
    expect(screen.getByRole('heading', { name: '可交互的真实组件' })).toBeTruthy();
  });

  it('downloads scoped CSS and a reloadable JSON draft', () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return 'blob:design-preview';
      },
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<DesignSystemPage />);
    fireEvent.click(screen.getByRole('button', { name: '导出 CSS' }));
    fireEvent.click(screen.getByRole('button', { name: '打开主题工作台' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    expect(click).toHaveBeenCalledTimes(2);
    expect(blobs.map((blob) => blob.type)).toEqual(['text/css', 'application/json']);
    expect(blobs.every((blob) => blob.size > 0)).toBe(true);
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
