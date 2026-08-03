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
afterEach(cleanup);

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
  it('starts with the workspace step and exposes a named keyboard action', () => {
    const onOpenWorkspaceMenu = vi.fn();
    render(
      <FirstLaunchGuide
        hasWorkspace={false}
        onOpenWorkspaceMenu={onOpenWorkspaceMenu}
        onPickTrack={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '三步开始第一项任务' })).toBeTruthy();
    expect(screen.getByText('当前步骤')).toBeTruthy();
    const openButton = screen.getByRole('button', { name: '打开工作区' });
    openButton.focus();
    expect(document.activeElement).toBe(openButton);
    fireEvent.click(openButton);
    expect(onOpenWorkspaceMenu).toHaveBeenCalledTimes(1);
  });

  it('routes workspace users into a model or agent conversation', () => {
    const onPickTrack = vi.fn();
    render(
      <FirstLaunchGuide
        hasWorkspace
        onOpenWorkspaceMenu={vi.fn()}
        onPickTrack={onPickTrack}
      />,
    );

    expect(screen.getByText('本地目录已就绪')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选择智能体' }));
    fireEvent.click(screen.getByRole('button', { name: '直接使用模型' }));
    expect(onPickTrack.mock.calls).toEqual([['agent'], ['model']]);
  });

  it('dismisses without blocking the workspace and stays dismissed after remount', () => {
    const props = {
      hasWorkspace: true,
      onOpenWorkspaceMenu: vi.fn(),
      onPickTrack: vi.fn(),
    };
    const view = render(<FirstLaunchGuide {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭首次使用引导' }));
    expect(screen.queryByRole('heading', { name: '三步开始第一项任务' })).toBeNull();
    expect(window.localStorage.getItem(FIRST_LAUNCH_GUIDE_KEY)).toBe('1');

    view.unmount();
    render(<FirstLaunchGuide {...props} />);
    expect(screen.queryByRole('heading', { name: '三步开始第一项任务' })).toBeNull();
  });
});
