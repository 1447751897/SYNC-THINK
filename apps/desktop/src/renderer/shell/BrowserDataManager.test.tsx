/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserDataRequest, BrowserDataSnapshot } from '../../browser-data.js';
import { BrowserDataManager } from './BrowserDataManager.js';

const snapshot: BrowserDataSnapshot = {
  storagePath: 'C:/fixture/Partitions/browser-panel', persistent: true, encryptionAvailable: true,
  passwords: [{ id: 'password-1', origin: 'https://example.test', username: 'fixture-user', updatedAt: '2026-10-03T00:00:00Z' }, { id: 'password-2', origin: 'https://other.test', username: 'other-user', updatedAt: '2026-10-03T00:00:00Z' }],
  sites: [{ domain: 'example.test', count: 3, persistentCount: 2 }, { domain: 'other.test', count: 1, persistentCount: 1 }],
};
function setup(initialView: 'passwords' | 'cookies' | 'import' | 'settings' = 'passwords', currentUrl = 'https://example.test/login') {
  const api = vi.fn(async (_request: BrowserDataRequest) => ({ ok: true as const, snapshot }));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { manageEmbeddedBrowserData: api } } });
  const onClose = vi.fn();
  render(<BrowserDataManager webContentsId={42} currentUrl={currentUrl} initialView={initialView} onClose={onClose} />);
  return { api, onClose };
}
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'syncThink', { configurable: true, value: undefined });
  window.localStorage.removeItem('sync-think:embedded-browser-settings:v1');
});

describe('browser password and Cookie settings', () => {
  it('shows metadata and the real directory without showing passwords or Cookie values', async () => {
    const f = setup();
    expect(await screen.findByText('fixture-user · ••••••••')).toBeTruthy();
    expect(screen.getByText('C:/fixture/Partitions/browser-panel')).toBeTruthy();
    expect(f.api).toHaveBeenCalledWith({ action: 'list', webContentsId: 42 });
    expect(screen.getByRole('dialog', { name: '密码和自动填充' })).toBeTruthy();
  });
  it('fills only matching sites, through the native broker, without clicking login', async () => {
    const f = setup(); await screen.findByText('fixture-user · ••••••••');
    const buttons = screen.getAllByRole('button', { name: '填充' });
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(f.api).toHaveBeenCalledWith({ action: 'fill-password', id: 'password-1', webContentsId: 42 }));
  });
  it.each(['https://', 'about:blank', 'file:///fixture.html'])('opens settings for a blank, invalid, or local page: %s', async currentUrl => {
    setup('passwords', currentUrl);
    await screen.findByText('fixture-user · ••••••••');
    expect(screen.getAllByRole('button', { name: '填充' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect((screen.getByRole('textbox', { name: '密码网站地址' }) as HTMLInputElement).value).toBe('');
  });
  it('requires confirmation before deleting a password or clearing a site', async () => {
    const f = setup(); await screen.findByText('fixture-user · ••••••••');
    fireEvent.click(screen.getByRole('button', { name: '删除 fixture-user 的密码' }));
    expect(f.api).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cookie 和站点数据' }));
    fireEvent.click(screen.getAllByRole('button', { name: '清除' })[0]);
    expect(f.api).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(f.api).toHaveBeenCalledWith(expect.objectContaining({ action: 'clear-site', domain: 'example.test', webContentsId: 42 })));
  });
  it('adds passwords explicitly, masks entry fields, and clears the local password value after saving', async () => {
    const f = setup(); await screen.findByText('fixture-user · ••••••••');
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    const password = screen.getByRole('textbox', { name: '密码用户名' });
    fireEvent.change(password, { target: { value: 'new-user' } });
    const field = screen.getByLabelText('保存的密码') as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: 'fixture-only-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '加密保存' }));
    await waitFor(() => expect(f.api).toHaveBeenCalledWith(expect.objectContaining({ action: 'save-password', username: 'new-user', password: 'fixture-only-secret' })));
    await waitFor(() => expect(screen.queryByLabelText('保存的密码')).toBeNull());
  });
  it('opens a native import chooser only on an explicit click and explains supported formats', async () => {
    const f = setup('import'); await screen.findByText('fixture-user · ••••••••');
    expect(f.api).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Chrome \/ Edge 导出的 CSV/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    await waitFor(() => expect(f.api).toHaveBeenCalledWith({ action: 'import-file', webContentsId: 42 }));
  });
  it('searches sites, handles native errors, and offers a retry', async () => {
    const f = setup('cookies'); await screen.findByText('example.test');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索浏览器资料' }), { target: { value: 'other' } });
    expect(screen.queryByText('example.test')).toBeNull();
    f.api.mockResolvedValueOnce({ ok: false, error: 'fixture error' } as never);
    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  it('opens the settings form without reading the guest, and persists every switch', async () => {
    const f = setup('settings');
    expect(screen.getByRole('dialog', { name: '浏览器设置' })).toBeTruthy();
    expect(f.api).not.toHaveBeenCalled();
    const autoFit = screen.getByRole('switch', { name: '默认自动适应网页' });
    const autofill = screen.getByRole('switch', { name: '自动填充已保存密码' });
    const blocking = screen.getByRole('switch', { name: '拦截广告与追踪器' });
    expect([autoFit, autofill, blocking].map(item => item.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true']);
    fireEvent.click(autoFit);
    expect(autoFit.getAttribute('aria-checked')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('sync-think:embedded-browser-settings:v1') ?? '{}')).toMatchObject({ autoFit: false, autofill: true, contentBlocking: true });
  });
  it('broadcasts a settings change so every mounted browser panel follows', async () => {
    const received: unknown[] = [];
    const listener = (event: Event) => received.push((event as CustomEvent).detail);
    window.addEventListener('sync-think:embedded-browser-settings-changed', listener);
    try {
      setup('settings');
      fireEvent.click(screen.getByRole('switch', { name: '拦截广告与追踪器' }));
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ autoFit: true, autofill: true, contentBlocking: false, contentBlockingAllowedHosts: [] });
    } finally {
      window.removeEventListener('sync-think:embedded-browser-settings-changed', listener);
    }
  });
  it('keeps the settings form reachable from the other tabs and back', async () => {
    setup('passwords'); await screen.findByText('fixture-user · ••••••••');
    fireEvent.click(screen.getByRole('button', { name: '浏览器设置' }));
    expect(screen.getByRole('switch', { name: '默认自动适应网页' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cookie 和站点数据' }));
    expect(await screen.findByText('example.test')).toBeTruthy();
  });
});
