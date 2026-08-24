/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { TopBar, calculateWorkspaceTabLayout } from './TopBar.js';

afterEach(cleanup);

const workspace = {
  workspaceId: 'workspace-1',
  name: '同步工作区',
  folderPath: 'D:\\projects\\SYNC-THINK',
  hidden: true,
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
} as unknown as WorkspaceSummary;

const workspaceTwo = {
  ...workspace,
  workspaceId: 'workspace-2',
  name: '第二工作区',
  folderPath: 'D:\\projects\\SECOND',
  hidden: false,
} as unknown as WorkspaceSummary;

describe('TopBar NewMax tab track', () => {
  it('uses the measured width rules and keeps the active workspace visible on overflow', () => {
    const ids = Array.from({ length: 10 }, (_, index) => `workspace-${index + 1}`);

    const full = calculateWorkspaceTabLayout(1567, ids, ids[0]);
    expect(full.visibleIds).toEqual(ids);
    expect(full.tabWidth).toBeCloseTo(147.6, 1);
    expect(full.overflowCount).toBe(0);

    const overflow = calculateWorkspaceTabLayout(300, ids, ids[9]);
    expect(overflow.visibleIds).toEqual([ids[0], ids[1], ids[9]]);
    expect(overflow.tabWidth).toBe(61);
    expect(overflow.overflowCount).toBe(7);
  });

  it('draws the connected SVG surface only behind the active workspace', () => {
    const visibleWorkspace = { ...workspace, hidden: false } as WorkspaceSummary;
    render(
      <TopBar
        workspaces={[visibleWorkspace, workspaceTwo]}
        activeWorkspaceId={visibleWorkspace.workspaceId}
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

    const active = screen.getByTestId('project-tab-同步工作区');
    const inactive = screen.getByTestId('project-tab-第二工作区');
    expect(active.getAttribute('data-active')).toBe('true');
    expect(active.querySelector('[data-testid="workspace-tab-shape"]')).toBeTruthy();
    expect(inactive.querySelector('[data-testid="workspace-tab-shape"]')).toBeNull();
  });

  it('exposes the bottom and right workbench toggles with their persisted state', () => {
    const visibleWorkspace = { ...workspace, hidden: false } as WorkspaceSummary;
    const onToggleBottomWorkbench = vi.fn();
    const onToggleRightWorkbench = vi.fn();
    render(
      <TopBar
        workspaces={[visibleWorkspace]}
        activeWorkspaceId={visibleWorkspace.workspaceId}
        sidebarCollapsed={false}
        bottomWorkbenchOpen={false}
        rightWorkbenchOpen
        onSelectWorkspace={vi.fn()}
        onOpenFolder={vi.fn()}
        onCreateWorkspace={vi.fn().mockResolvedValue(true)}
        onUpdateWorkspace={vi.fn().mockResolvedValue(true)}
        onDeleteWorkspace={vi.fn().mockResolvedValue(true)}
        onToggleSidebar={vi.fn()}
        onToggleBottomWorkbench={onToggleBottomWorkbench}
        onToggleRightWorkbench={onToggleRightWorkbench}
        onPickFolder={vi.fn().mockResolvedValue({ canceled: true })}
      />,
    );

    const bottom = screen.getByTestId('topbar-toggle-bottom-workbench');
    const right = screen.getByTestId('topbar-toggle-right-workbench');
    expect(bottom.getAttribute('data-workspace-bottom-toggle')).toBe('true');
    expect(bottom.getAttribute('aria-pressed')).toBe('false');
    expect(right.getAttribute('data-workspace-files-toggle')).toBe('true');
    expect(right.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(bottom);
    fireEvent.click(right);
    expect(onToggleBottomWorkbench).toHaveBeenCalledTimes(1);
    expect(onToggleRightWorkbench).toHaveBeenCalledTimes(1);
  });
});

describe('TopBar workspace menu', () => {
  it('replaces workspace controls with one contextual tab outside conversations', () => {
    render(
      <TopBar
        workspaces={[workspaceTwo]}
        activeWorkspaceId={workspaceTwo.workspaceId}
        sidebarCollapsed={false}
        contextStage="tasks"
        onSelectWorkspace={vi.fn()}
        onOpenFolder={vi.fn()}
        onCreateWorkspace={vi.fn().mockResolvedValue(true)}
        onUpdateWorkspace={vi.fn().mockResolvedValue(true)}
        onDeleteWorkspace={vi.fn().mockResolvedValue(true)}
        onToggleSidebar={vi.fn()}
        onPickFolder={vi.fn().mockResolvedValue({ canceled: true })}
      />,
    );

    expect(screen.getByTestId('topbar-context-tab').textContent).toContain('定时任务');
    expect(screen.getByTestId('topbar-workspace-scroller').classList.contains('hidden')).toBe(true);
  });

  it('uses native dragging to reorder workspace tabs without transforming the scroll track', () => {
    const visibleWorkspace = { ...workspace, hidden: false } as WorkspaceSummary;
    const onReorderWorkspaces = vi.fn();
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn((type: string, value: string) => values.set(type, value)),
      getData: vi.fn((type: string) => values.get(type) ?? ''),
    };

    render(
      <TopBar
        workspaces={[visibleWorkspace, workspaceTwo]}
        activeWorkspaceId={visibleWorkspace.workspaceId}
        sidebarCollapsed={false}
        onSelectWorkspace={vi.fn()}
        onOpenFolder={vi.fn()}
        onCreateWorkspace={vi.fn().mockResolvedValue(true)}
        onUpdateWorkspace={vi.fn().mockResolvedValue(true)}
        onReorderWorkspaces={onReorderWorkspaces}
        onDeleteWorkspace={vi.fn().mockResolvedValue(true)}
        onToggleSidebar={vi.fn()}
        onPickFolder={vi.fn().mockResolvedValue({ canceled: true })}
      />,
    );

    const first = screen.getByTestId('project-tab-同步工作区');
    const second = screen.getByTestId('project-tab-第二工作区');
    expect(first.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragOver(second, { dataTransfer });
    fireEvent.drop(second, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-sync-think-workspace',
      visibleWorkspace.workspaceId,
    );
    expect(onReorderWorkspaces).toHaveBeenCalledWith([
      workspaceTwo.workspaceId,
      visibleWorkspace.workspaceId,
    ]);
  });

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
