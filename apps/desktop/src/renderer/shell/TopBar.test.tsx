/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { TopBar } from './TopBar.js';

afterEach(cleanup);

const workspace = {
  workspaceId: 'workspace-1',
  name: '同步工作区',
  folderPath: 'D:\\projects\\SYNC-THINK',
  hidden: true,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
} as unknown as WorkspaceSummary;

describe('TopBar workspace menu', () => {
  it('flips the workspace picker above the trigger near the viewport bottom', async () => {
    const previousHeight = window.innerHeight;
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });

    try {
      render(
        <TopBar
          workspaces={[workspace]}
          activeWorkspaceId={workspace.workspaceId}
          sidebarCollapsed={false}
          onSelectWorkspace={vi.fn()}
          onOpenFolder={vi.fn()}
          onCreateWorkspace={vi.fn().mockResolvedValue(true)}
          onUpdateWorkspace={vi.fn().mockResolvedValue(true)}
          onDeleteWorkspace={vi.fn().mockResolvedValue(true)}
          onToggleSidebar={vi.fn()}
          onPickFolder={vi.fn().mockResolvedValue({ canceled: true })}
        />,
      );

      const trigger = screen.getByTestId('topbar-workspace-menu');
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        x: 650,
        y: 260,
        top: 260,
        left: 650,
        right: 680,
        bottom: 287,
        width: 30,
        height: 27,
        toJSON: () => ({}),
      });

      fireEvent.click(trigger);

      const menu = await screen.findByTestId('workspace-menu');
      expect(menu.style.position).toBe('fixed');
      expect(menu.style.bottom).not.toBe('');
      expect(menu.style.top).toBe('auto');
      expect(menu.style.overflowY).toBe('auto');
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: previousHeight,
      });
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: previousWidth,
      });
    }
  });
});
