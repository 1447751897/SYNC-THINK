/**
 * @vitest-environment jsdom
 */
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
