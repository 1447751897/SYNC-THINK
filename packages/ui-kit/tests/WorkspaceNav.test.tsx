import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceNav, projectWorkspaceNavReadiness } from '../src/components/WorkspaceNav.js';
import type { WorkspaceNavTask, WorkspaceNavWorkspace } from '../src/components/workspace-nav-model.js';

const workspace: WorkspaceNavWorkspace = {
  workspaceId: 'ws_1',
  folderPath: 'D:/projects/SYNC-THINK',
  name: 'SYNC-THINK',
};

const tasks: WorkspaceNavTask[] = [
  {
    taskId: 't1',
    workspaceId: 'ws_1',
    title: 'Runtime recovery',
    goal: 'checkpoint',
    status: 'active',
    taskVersion: 1,
    threadId: 'thread-1',
    lastOpenedAt: '2026-07-12T10:00:00.000Z',
  },
  {
    taskId: 't2',
    workspaceId: 'ws_1',
    title: 'Visual calibration',
    goal: 'continuum',
    status: 'active',
    taskVersion: 0,
    threadId: 'thread-2',
  },
  {
    taskId: 't3',
    workspaceId: 'ws_1',
    parentTaskId: 't1',
    title: 'Child binding',
    goal: 'inherit parent context via explicit ref',
    status: 'active',
    taskVersion: 0,
    threadId: 'thread-3',
  },
];

describe('WorkspaceNav', () => {
  it('can hide the internal Runtime footer for product composition', () => {
    const { rerender } = render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([[workspace.workspaceId, tasks]])}
        connectionState="online"
      />,
    );
    expect(screen.getByTestId('workspace-nav-footer')).toBeTruthy();

    rerender(
      <WorkspaceNav
        hideFooter
        workspaces={[workspace]}
        tasksByWorkspace={new Map([[workspace.workspaceId, tasks]])}
        connectionState="online"
      />,
    );
    expect(screen.queryByTestId('workspace-nav-footer')).toBeNull();
  });

  it('renders empty state with single clear CTA', () => {
    const onCreate = vi.fn();
    render(
      <WorkspaceNav
        workspaces={[]}
        tasksByWorkspace={new Map()}
        onCreateWorkspace={onCreate}
      />,
    );
    expect(screen.getByTestId('workspace-nav-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('workspace-nav-add-folder'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('can hide the development readiness strip in the product workspace', () => {
    render(
      <WorkspaceNav
        workspaces={[]}
        tasksByWorkspace={new Map()}
        hideReadiness
      />,
    );
    expect(screen.queryByTestId('workspace-nav-ia-strip')).toBeNull();
    expect(screen.getByTestId('workspace-nav-empty')).toBeTruthy();
    expect(screen.getByTestId('workspace-nav-footer')).toBeTruthy();
  });

  it('filters tasks and marks last-open resume pulse', () => {
    render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        activeTaskId="t2"
      />,
    );
    expect(screen.getByText('Runtime recovery')).toBeTruthy();
    expect(screen.getByText('Visual calibration')).toBeTruthy();
    const resume = document.querySelector('[data-resume="true"]');
    expect(resume?.textContent).toContain('Runtime recovery');

    fireEvent.change(screen.getByTestId('workspace-nav-search'), {
      target: { value: 'Visual' },
    });
    expect(screen.queryByText('Runtime recovery')).toBeNull();
    expect(screen.getByText('Visual calibration')).toBeTruthy();
  });

  it('selects task and requests create task under folder', () => {
    const onSelect = vi.fn();
    const onCreateTask = vi.fn();
    render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        onSelectTask={onSelect}
        onCreateTask={onCreateTask}
      />,
    );
    fireEvent.click(screen.getByText('Runtime recovery'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1' }));
    fireEvent.click(screen.getByTestId('workspace-nav-add-task-ws_1'));
    expect(onCreateTask).toHaveBeenCalledWith('ws_1');
  });
  it('requests nested child task under parent (explicit cross-task edge)', () => {
    const onCreateChild = vi.fn();
    render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        onCreateChildTask={onCreateChild}
      />,
    );
    fireEvent.click(screen.getByTestId('workspace-nav-add-child-t1'));
    expect(onCreateChild).toHaveBeenCalledWith('ws_1', 't1');
    expect(screen.getByText('Child binding')).toBeTruthy();
  });



  it('shows IA structure strip empty → with folders/tasks', () => {
    const { rerender } = render(
      <WorkspaceNav workspaces={[]} tasksByWorkspace={new Map()} connectionState="offline" />,
    );
    expect(screen.getByTestId('workspace-nav-ia-strip').getAttribute('data-level')).toBe('empty');
    expect(screen.getByTestId('workspace-nav-ia-badge').textContent).toMatch(/等待文件夹/);
    expect(screen.getByTestId('workspace-nav-ia-folders').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('workspace-nav-footer-label').textContent).toMatch(/本地 Runtime/);
    expect(screen.getByTestId('workspace-nav-footer-detail').textContent).toMatch(/未连接/);

    rerender(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        activeTaskId="t1"
        connectionState="online"
      />,
    );
    expect(screen.getByTestId('workspace-nav-ia-strip').getAttribute('data-level')).toBe('ready');
    expect(screen.getByTestId('workspace-nav-ia-badge').textContent).toMatch(/任务已打开/);
    expect(screen.getByTestId('workspace-nav-ia-folders').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('workspace-nav-ia-tasks').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('workspace-nav-ia-active').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('workspace-nav-footer-detail').textContent).toMatch(/持久事件流|已连接/);
    expect(screen.getByTestId('workspace-nav-ia-note').textContent).toMatch(/会话就绪|Runtime|运行轨迹|嵌套/);
  });

  it('marks partial when folders exist but no active task', () => {
    render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        connectionState="connecting"
      />,
    );
    expect(screen.getByTestId('workspace-nav-ia-strip').getAttribute('data-level')).toBe('partial');
    expect(screen.getByTestId('workspace-nav-ia-badge').textContent).toMatch(/待选任务/);
    expect(screen.getByTestId('workspace-nav-footer-detail').textContent).toMatch(/正在连接/);
  });



  it('marks filtering when search active with matches', () => {
    render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        activeTaskId="t1"
        query="Visual"
        connectionState="online"
      />,
    );
    expect(screen.getByTestId('workspace-nav-ia-strip').getAttribute('data-level')).toBe('filtering');
    expect(screen.getByTestId('workspace-nav-ia-badge').textContent).toMatch(/筛选中/);
    expect(screen.getByTestId('workspace-nav-ia-filter').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('workspace-nav-ia-nested').getAttribute('data-ok')).toBe('0');
  });

  it('marks filtering empty match as 无匹配', () => {
    render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        activeTaskId="t1"
        query="zzz-no-match"
        connectionState="online"
      />,
    );
    expect(screen.getByTestId('workspace-nav-ia-strip').getAttribute('data-level')).toBe('filtering');
    expect(screen.getByTestId('workspace-nav-ia-badge').textContent).toMatch(/无匹配/);
    expect(screen.getByTestId('workspace-nav-ia-tasks').getAttribute('data-ok')).toBe('0');
  });

  it('shows nested child count when hierarchy present', () => {
    render(
      <WorkspaceNav
        workspaces={[workspace]}
        tasksByWorkspace={new Map([['ws_1', tasks]])}
        activeTaskId="t1"
        connectionState="online"
      />,
    );
    expect(screen.getByTestId('workspace-nav-ia-nested').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('workspace-nav-ia-nested').textContent).toMatch(/嵌套子任务 1/);
    expect(screen.getByTestId('workspace-nav').getAttribute('data-level')).toBe('ready');
  });
});

describe('projectWorkspaceNavReadiness', () => {
  it('projects empty shell', () => {
    const r = projectWorkspaceNavReadiness({});
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('等待文件夹');
    expect(r.runtimeOk).toBe(false);
  });

  it('projects ready full nav', () => {
    const r = projectWorkspaceNavReadiness({
      folderCount: 1,
      taskCount: 3,
      nestedTaskCount: 1,
      hasActiveTask: true,
      connectionState: 'online',
    });
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('任务已打开');
    expect(r.runtimeOk).toBe(true);
    expect(r.note).toMatch(/嵌套子任务/);
  });

  it('projects partial without active task', () => {
    const r = projectWorkspaceNavReadiness({
      folderCount: 1,
      taskCount: 2,
      hasActiveTask: false,
      connectionState: 'connecting',
    });
    expect(r.level).toBe('partial');
    expect(r.badge).toBe('待选任务');
  });

  it('projects filtering when query active', () => {
    const r = projectWorkspaceNavReadiness({
      folderCount: 1,
      taskCount: 1,
      hasActiveTask: true,
      connectionState: 'online',
      query: 'Visual',
    });
    expect(r.level).toBe('filtering');
    expect(r.badge).toBe('筛选中');
    expect(r.queryActive).toBe(true);
  });
});
