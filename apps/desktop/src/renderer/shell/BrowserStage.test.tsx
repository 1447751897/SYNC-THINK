/**
 * @vitest-environment jsdom
 */
// 浏览器独立页（Stage）：Profile 管理 + partition 切换。
// <webview> 在 jsdom 中不可用 —— mock 掉 BrowserPanel，只断言传参。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('./BrowserPanel.js', () => ({
  BrowserPanel: (props: { partition?: string; registerForAutomation?: boolean }) => (
    <div
      data-testid="mock-browser-panel"
      data-partition={props.partition}
      data-register={String(props.registerForAutomation)}
    />
  ),
}));

import { BrowserStage } from './BrowserStage.js';
import {
  createBrowserProfile,
  readBrowserProfiles,
} from '../browser-profiles.js';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function panel(): HTMLElement {
  return screen.getByTestId('mock-browser-panel');
}

describe('BrowserStage', () => {
  it('renders default profile selected and mounts BrowserPanel on the shared partition', () => {
    render(<BrowserStage />);
    expect(screen.getByTestId('browser-stage')).toBeTruthy();
    expect(screen.getByTestId('browser-profile-list')).toBeTruthy();
    expect(screen.getByText('浏览器')).toBeTruthy();
    expect(screen.getByText('每个 Profile 拥有独立的 Cookie 和登录态，可管理多账号')).toBeTruthy();
    expect(screen.getByText('默认浏览器')).toBeTruthy();
    expect(screen.getByText('与应用共享登录态')).toBeTruthy();
    expect(screen.getByText('启用中')).toBeTruthy();
    expect(panel().getAttribute('data-partition')).toBe('persist:browser-panel');
    // 独立页不抢 AI 操控注册。
    expect(panel().getAttribute('data-register')).toBe('false');
  });

  it('creates a profile via inline input, selects it, and switches partition', () => {
    render(<BrowserStage />);
    fireEvent.click(screen.getByTestId('browser-profile-new'));
    const input = screen.getByTestId('browser-profile-new-input');
    fireEvent.change(input, { target: { value: '工作号' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const stored = readBrowserProfiles();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe('工作号');
    expect(screen.getByTestId(`browser-profile-item-${stored[0]!.id}`)).toBeTruthy();
    // 新建后自动选中 → partition 切到独立 Profile。
    expect(panel().getAttribute('data-partition')).toBe(
      `persist:browser-profile-${stored[0]!.id}`,
    );
  });

  it('cancels inline creation with Escape', () => {
    render(<BrowserStage />);
    fireEvent.click(screen.getByTestId('browser-profile-new'));
    const input = screen.getByTestId('browser-profile-new-input');
    fireEvent.change(input, { target: { value: '不要了' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('browser-profile-new-input')).toBeNull();
    expect(readBrowserProfiles()).toHaveLength(0);
  });

  it('switches selection between default and a stored profile', () => {
    const profile = createBrowserProfile('小号')!;
    render(<BrowserStage />);

    fireEvent.click(screen.getByTestId(`browser-profile-item-${profile.id}`));
    expect(panel().getAttribute('data-partition')).toBe(`persist:browser-profile-${profile.id}`);

    fireEvent.click(screen.getByTestId('browser-profile-item-default'));
    expect(panel().getAttribute('data-partition')).toBe('persist:browser-panel');
  });

  it('renames a profile inline', () => {
    const profile = createBrowserProfile('旧名')!;
    render(<BrowserStage />);

    fireEvent.click(screen.getByTestId(`browser-profile-rename-${profile.id}`));
    const input = screen.getByTestId(`browser-profile-rename-input-${profile.id}`);
    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('新名')).toBeTruthy();
    expect(readBrowserProfiles()[0]!.name).toBe('新名');
  });

  it('deletes a profile only after second (confirm) click and falls back to default', () => {
    const profile = createBrowserProfile('要删的')!;
    render(<BrowserStage />);

    fireEvent.click(screen.getByTestId(`browser-profile-item-${profile.id}`));
    expect(panel().getAttribute('data-partition')).toBe(`persist:browser-profile-${profile.id}`);

    const del = screen.getByTestId(`browser-profile-delete-${profile.id}`);
    // 第一次点击：进入待确认，不删除。
    fireEvent.click(del);
    expect(readBrowserProfiles()).toHaveLength(1);
    expect(screen.getByTestId(`browser-profile-item-${profile.id}`)).toBeTruthy();

    // 第二次点击：真正删除，选中回落默认浏览器。
    fireEvent.click(del);
    expect(readBrowserProfiles()).toHaveLength(0);
    expect(screen.queryByTestId(`browser-profile-item-${profile.id}`)).toBeNull();
    expect(panel().getAttribute('data-partition')).toBe('persist:browser-panel');
  });
});
