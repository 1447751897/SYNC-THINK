/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  FIRST_LAUNCH_GUIDE_KEY,
  FirstLaunchGuide,
  readFirstLaunchGuideDismissed,
  writeFirstLaunchGuideDismissed,
} from './FirstLaunchGuide.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('FirstLaunchGuide preference', () => {
  it('defaults visible and persists an explicit dismissal', () => {
    expect(readFirstLaunchGuideDismissed(window.localStorage)).toBe(false);
    writeFirstLaunchGuideDismissed(true, window.localStorage);
    expect(window.localStorage.getItem(FIRST_LAUNCH_GUIDE_KEY)).toBe('1');
    expect(readFirstLaunchGuideDismissed(window.localStorage)).toBe(true);
    writeFirstLaunchGuideDismissed(false, window.localStorage);
    expect(readFirstLaunchGuideDismissed(window.localStorage)).toBe(false);
  });
});

describe('FirstLaunchGuide surface', () => {
  it('does not offer kernel installation or the old step card', () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        kernelUpdates: {
          getState: vi.fn(),
          installUpdate: vi.fn(),
        },
      },
    });

    render(
      <FirstLaunchGuide
        hasWorkspace
        hasProvider={false}
        onOpenWorkspaceMenu={vi.fn()}
        onOpenModelSettings={vi.fn()}
        onPickTrack={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '私有安装 Codex' })).toBeNull();
    expect(screen.queryByRole('button', { name: '私有安装 Pi' })).toBeNull();
    expect(screen.queryByText('Pi')).toBeNull();
    expect(screen.queryByRole('heading', { name: '开始第一项任务' })).toBeNull();
    expect(screen.queryByText('当前步骤')).toBeNull();
    expect(screen.queryByText('FIRST RUN · LOCAL WORKSPACE')).toBeNull();
  });

  it('stays off the start page until a workspace exists', () => {
    render(
      <FirstLaunchGuide
        hasWorkspace={false}
        hasProvider={false}
        onOpenWorkspaceMenu={vi.fn()}
        onPickTrack={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '添加 API 密钥' })).toBeNull();
    expect(screen.queryByRole('button', { name: '打开工作区' })).toBeNull();
  });

  it('asks workspace users without a provider to add an API key', () => {
    const onOpenModelSettings = vi.fn();
    render(
      <FirstLaunchGuide
        hasWorkspace
        hasProvider={false}
        onOpenWorkspaceMenu={vi.fn()}
        onOpenModelSettings={onOpenModelSettings}
        onPickTrack={vi.fn()}
      />,
    );

    const action = screen.getByRole('button', { name: '添加 API 密钥' });
    action.focus();
    expect(document.activeElement).toBe(action);
    fireEvent.click(action);
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '选择智能体' })).toBeNull();
  });

  it('hides itself once a provider is ready', () => {
    render(
      <FirstLaunchGuide
        hasWorkspace
        hasProvider
        onOpenWorkspaceMenu={vi.fn()}
        onPickTrack={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '添加 API 密钥' })).toBeNull();
  });

  it('dismisses without blocking the workspace and stays dismissed after remount', () => {
    const props = {
      hasWorkspace: true,
      hasProvider: false,
      onOpenWorkspaceMenu: vi.fn(),
      onOpenModelSettings: vi.fn(),
      onPickTrack: vi.fn(),
    };
    const view = render(<FirstLaunchGuide {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭首次使用引导' }));
    expect(screen.queryByRole('button', { name: '添加 API 密钥' })).toBeNull();
    expect(window.localStorage.getItem(FIRST_LAUNCH_GUIDE_KEY)).toBe('1');

    view.unmount();
    render(<FirstLaunchGuide {...props} />);
    expect(screen.queryByRole('button', { name: '添加 API 密钥' })).toBeNull();
  });
});
