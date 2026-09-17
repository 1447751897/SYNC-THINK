/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastProvider, resetToastStoreForTests, toastApi } from './Toast.js';

afterEach(() => {
  cleanup();
  resetToastStoreForTests();
});

describe('ToastProvider', () => {
  it('renders NewMax-style top-right toasts and replaces the same id', () => {
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      toastApi.toast({ type: 'error', title: '发送失败', description: 'append failed', id: 'send' });
    });
    expect(screen.getByTestId('shell-toast-host')).toBeTruthy();
    expect(screen.getByTestId('shell-toast').getAttribute('data-type')).toBe('error');
    expect(screen.getByText('发送失败')).toBeTruthy();
    expect(screen.getByText('append failed')).toBeTruthy();

    act(() => {
      toastApi.toast({ type: 'success', title: '已切换模型', id: 'send' });
    });
    expect(screen.getByText('已切换模型')).toBeTruthy();
    expect(screen.queryByText('发送失败')).toBeNull();
    expect(screen.getAllByTestId('shell-toast')).toHaveLength(1);
  });

  it('dismisses from the close button', () => {
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      toastApi.toast({ type: 'warning', title: '斜杠命令只能出现在输入开头', duration: 0 });
    });
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.getByTestId('shell-toast').className).toContain('is-leaving');
  });
});

/**
 * 回归锚点：提示层曾被模型能力对话框的遮罩（z-index 10040）盖住 ——
 * 因为 `.shell-toast-host` 当时是 9999。被「页面色 72%」的遮罩压住之后，
 * 提示视觉上就是发灰、模糊，看不清。
 */
describe('Toast stacking order', () => {
  const SHELL_CSS = readFileSync(
    resolve(process.cwd(), 'src/renderer/shell/shell.css'),
    'utf8',
  );

  function cssBlockFor(selector: string): string {
    const start = SHELL_CSS.indexOf(`${selector} {`);
    if (start < 0) throw new Error(`Missing CSS rule: ${selector}`);
    return SHELL_CSS.slice(start + selector.length + 2, SHELL_CSS.indexOf('}', start));
  }

  function blockZIndex(selector: string): number {
    const match = /z-index:\s*(\d+)/.exec(cssBlockFor(selector));
    if (!match) throw new Error(`Missing z-index in: ${selector}`);
    return Number(match[1]);
  }

  it('keeps the toast host above every modal layer in the stylesheet', () => {
    const toastZ = blockZIndex('.shell-toast-host');

    // 拖拽分栏盾（.shell-pane-resize-shield）只在拖拽期间存在，有意排在最上层。
    const RESIZE_SHIELD_Z = 2147483647;
    const higher = Array.from(SHELL_CSS.matchAll(/z-index:\s*(\d+)/g))
      .map((m) => Number(m[1]))
      .filter((z) => z > toastZ && z !== RESIZE_SHIELD_Z);

    expect(
      higher,
      `提示层 ${toastZ} 必须高于所有遮罩，当前仍被这些层级盖住: ${higher.join(', ')}`,
    ).toEqual([]);
  });
});
