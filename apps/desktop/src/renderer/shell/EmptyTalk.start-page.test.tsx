/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmptyTalk } from './ShellApp.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const baseProps = {
  models: [] as const,
  agents: [] as const,
  teams: [] as const,
  draft: '',
  selectedModelId: '',
  sending: false,
  onDraftChange: vi.fn(),
  onModelChange: vi.fn(),
  onSend: vi.fn(async () => true),
  onPickTrack: vi.fn(),
};

describe('EmptyTalk start page', () => {
  it('matches the conversation empty rhythm and opens a workspace from the composer', () => {
    const onOpenWorkspaceMenu = vi.fn();
    render(
      <EmptyTalk hasWorkspace={false} onOpenWorkspaceMenu={onOpenWorkspaceMenu} {...baseProps} />,
    );

    expect(screen.getByTestId('welcome-greeting')).toBeTruthy();
    expect(screen.queryByText('先打开一个工作区')).toBeNull();
    expect(screen.queryByRole('heading', { name: '开始第一项任务' })).toBeNull();
    expect(screen.queryByText('私有内核（可选）')).toBeNull();
    expect(screen.getByTestId('empty-compose')).toBeTruthy();
    expect(screen.getByTestId('empty-compose-wrap').getAttribute('data-locked')).toBe('true');
    expect(screen.getByPlaceholderText('打开工作区后即可输入')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '打开工作区' }));
    expect(onOpenWorkspaceMenu).toHaveBeenCalledTimes(1);
  });

  it('keeps a single API key hint after a workspace exists but no provider is ready', () => {
    const onOpenModelSettings = vi.fn();
    render(
      <EmptyTalk
        hasWorkspace
        onOpenWorkspaceMenu={vi.fn()}
        onOpenModelSettings={onOpenModelSettings}
        {...baseProps}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加 API 密钥' }));
    expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('empty-workspace-gate')).toBeNull();
    expect(screen.getByPlaceholderText('输入消息…（输入 / 打开快捷面板）')).toBeTruthy();
  });
});
