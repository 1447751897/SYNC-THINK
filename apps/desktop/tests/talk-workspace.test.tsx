// @vitest-environment jsdom

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TalkAutomationWorkspace,
  TalkConversationTaskWorkspace,
  TalkGroupsWorkspace,
  TalkProjectsWorkspace,
  TalkSettingsWorkspace,
  TalkSkillsWorkspace,
  TalkTopBar,
} from '../src/renderer/talk-workspace.js';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | undefined;

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
});

function automationFixture() {
  return {
    id: 'automation-1' as never,
    name: '每日检查',
    workspaceId: 'workspace-1' as never,
    target: { type: 'agent' as const, agentVersionId: 'agent-version-1' as never },
    instruction: '检查项目状态并汇总',
    approvalMode: 'full' as const,
    trigger: { type: 'cron' as const, expression: '0 9 * * 1-5' },
    timezone: 'Asia/Shanghai',
    concurrencyPolicy: 'queue' as const,
    maxConcurrency: 2,
    maxRetries: 1,
    enabled: true,
    webhookSecretConfigured: false,
    version: 1,
    nextTriggerAt: '2026-07-19T01:00:00.000Z',
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter unavailable');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Textarea value setter unavailable');
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Select value setter unavailable');
  setter.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function controlByLabel<T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
  container: ParentNode,
  label: string,
  selector: string,
): T {
  const wrapper = [...container.querySelectorAll('label')].find(
    (candidate) => candidate.querySelector(':scope > span')?.textContent?.trim() === label,
  );
  const control = wrapper?.querySelector<T>(selector);
  if (!control) throw new Error(`Control not found: ${label}`);
  return control;
}

function groupFixture() {
  return {
    id: 'group-1' as never,
    name: '发布小队',
    description: '并行完成发布准备',
    kind: 'fixed' as const,
    visualIdentity: { icon: 'users', color: '#0d9488' },
    leadAgentVersionId: 'agent-version-1' as never,
    approvalMode: 'full' as const,
    collaborationMode: 'parallel' as const,
    maxConcurrency: 3,
    version: 2,
    members: [
      {
        agentVersionId: 'agent-version-1' as never,
        responsibility: '统筹、委派与最终总结',
        sortOrder: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
      },
      {
        agentVersionId: 'agent-version-2' as never,
        responsibility: '执行发布检查',
        sortOrder: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T01:00:00.000Z',
  };
}

const groupAgents = [
  {
    agentVersionId: 'agent-version-1',
    name: '规划助手',
    role: 'planner',
    color: '#0d9488',
  },
  {
    agentVersionId: 'agent-version-2',
    name: '执行助手',
    role: 'executor',
    color: '#2563eb',
  },
];

describe('Talk workspace', () => {
  it('renders the Figma conversation task workspace without dropping functional slots', async () => {
    const onCreateConversation = vi.fn();
    const onSelectTask = vi.fn();
    const onDetailTabChange = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkConversationTaskWorkspace
          tasks={[
            {
              taskId: 'task-1',
              title: '重新设计信息架构',
              summary: '请审阅并确认执行计划',
              participantLabel: 'Architect',
              participantIcon: 'planner',
              participantColor: '#7c3aed',
              participantAvatarUrl: 'data:image/png;base64,c3RhYmxlLWF2YXRhcg==',
              workspaceName: 'SYNC-THINK 产品重设计',
              updatedAt: '2026-07-18T14:23:00.000Z',
              status: 'active',
              kind: 'direct',
            },
            {
              taskId: 'task-2',
              title: 'API 接入层重构',
              summary: 'Coder 正在编写适配器',
              participantLabel: '5 名 Agent',
              workspaceName: 'API 接入层重构',
              participantIcon: 'users',
              participantColor: '#0d9488',
              updatedAt: '2026-07-18T14:28:00.000Z',
              status: 'running',
              kind: 'group',
            },
          ]}
          activeTaskId="task-1"
          activeTaskTitle="重新设计信息架构"
          activeWorkspaceName="SYNC-THINK 产品重设计"
          participantName="Architect"
          participantIcon="planner"
          participantKind="direct"
          modelLabel="claude-opus-4"
          taskStatusLabel="进行中"
          detailTab="progress"
          onCreateConversation={onCreateConversation}
          onSelectTask={onSelectTask}
          onDetailTabChange={onDetailTabChange}
          contextRail={<div data-testid="real-task-notices">真实任务提示</div>}
          conversation={<div data-testid="real-conversation-slot">真实完整对话</div>}
          compose={<textarea data-testid="real-compose-slot" aria-label="发送消息" />}
          trace={<div data-testid="real-detail-slot">真实任务详情</div>}
        />,
      );
    });

    expect(
      container.querySelector('[data-testid="talk-conversation-task-workspace"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="talk-conversation-directory"]')).not.toBeNull();
    expect(container.textContent).toContain('全部');
    expect(container.textContent).toContain('单聊');
    expect(container.textContent).toContain('群聊');
    expect(container.textContent).toContain('新建对话');
    expect(container.textContent).toContain('Architect');
    expect(container.textContent).toContain('claude-opus-4');
    const taskAvatar = container.querySelector<HTMLElement>(
      '[data-task-id="task-1"] [data-testid="talk-task-agent-avatar"]',
    );
    expect(taskAvatar?.getAttribute('style')).toContain('#7c3aed');
    expect(taskAvatar?.querySelector('img')?.getAttribute('src')).toContain('c3RhYmxlLWF2YXRhcg==');
    const groupAvatar = container.querySelector<HTMLElement>(
      '[data-task-id="task-2"] [data-testid="talk-task-agent-avatar"]',
    );
    expect(groupAvatar?.getAttribute('data-icon')).toBe('users');
    expect(groupAvatar?.querySelector('[data-agent-glyph="users"]')).not.toBeNull();
    const headerAvatar = container.querySelector<HTMLElement>('.st-talk-task-header__avatar');
    expect(headerAvatar?.getAttribute('data-icon')).toBe('planner');
    expect(headerAvatar?.querySelector('[data-agent-glyph="planner"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="real-conversation-slot"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="real-compose-slot"]')).not.toBeNull();
    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="talk-composer-resize-handle"]',
    );
    expect(resizeHandle).not.toBeNull();
    expect(resizeHandle?.getAttribute('aria-valuenow')).toBe('126');
    await act(async () => {
      resizeHandle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(resizeHandle?.getAttribute('aria-valuenow')).toBe('150');
    await act(async () => {
      resizeHandle?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientY: 200 }),
      );
      window.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientY: 160 }),
      );
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(resizeHandle?.getAttribute('aria-valuenow')).toBe('190');
    expect(readFileSync(join(process.cwd(), 'src/renderer/renderer.css'), 'utf8')).toMatch(
      /data-has-attachments='1'[\s\S]*max\(var\(--st-talk-composer-height\),\s*220px\)/,
    );
    expect(container.querySelector('[data-testid="real-detail-slot"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="talk-detail-tab-"]')).toHaveLength(3);
    expect(container.textContent).not.toContain('介入');
    expect(container.textContent).not.toContain('暂停');
    expect(container.textContent).not.toContain('终止');

    await act(async () => buttonByText(container, '新建对话').click());
    expect(onCreateConversation).toHaveBeenCalledTimes(1);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-task-id="task-2"]')?.click(),
    );
    expect(onSelectTask).toHaveBeenCalledWith('task-2');
    await act(async () => buttonByText(container, '文件与产物').click());
    expect(onDetailTabChange).toHaveBeenCalledWith('files');
  });

  it('keeps conversation rows in catalog order when activity timestamps change', () => {
    const html = renderToStaticMarkup(
      <TalkConversationTaskWorkspace
        tasks={[
          {
            taskId: 'task-first',
            title: '先创建的任务',
            summary: '较早更新',
            participantLabel: 'Agent',
            workspaceName: 'TEST',
            updatedAt: '2026-07-18T01:00:00.000Z',
            status: 'active',
            kind: 'direct',
          },
          {
            taskId: 'task-second',
            title: '后创建的任务',
            summary: '刚刚更新',
            participantLabel: 'Agent',
            workspaceName: 'TEST',
            updatedAt: '2026-07-19T01:00:00.000Z',
            status: 'active',
            kind: 'direct',
          },
        ]}
        activeTaskId="task-second"
        onCreateConversation={() => undefined}
        conversation={<div />}
        compose={<div />}
        trace={<div />}
      />,
    );

    expect(html.indexOf('data-task-id="task-first"')).toBeLessThan(
      html.indexOf('data-task-id="task-second"'),
    );
  });

  it('opens a different task at its latest conversation message', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);
    const renderTask = (taskId: string) => (
      <TalkConversationTaskWorkspace
        tasks={[]}
        activeTaskId={taskId}
        activeTaskTitle={taskId}
        conversation={<div>latest message for {taskId}</div>}
        compose={<div />}
        trace={<div />}
      />
    );

    await act(async () => mountedRoot?.render(renderTask('task-a')));
    const conversation = container.querySelector<HTMLElement>('#st-main-conversation')!;
    Object.defineProperty(conversation, 'scrollHeight', { configurable: true, value: 640 });
    conversation.scrollTop = 0;
    await act(async () => mountedRoot?.render(renderTask('task-b')));
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 220)));

    expect(conversation.scrollTop).toBe(640);
  });

  it('renders every supported Agent identity icon consistently in the task directory and header', () => {
    const html = renderToStaticMarkup(
      <TalkConversationTaskWorkspace
        tasks={[
          {
            taskId: 'task-brain',
            title: 'Research task',
            participantLabel: 'Researcher',
            participantIcon: 'brain',
            status: 'active',
            kind: 'direct',
          },
          {
            taskId: 'task-image',
            title: 'Image task',
            participantLabel: 'Designer',
            participantIcon: 'image',
            status: 'active',
            kind: 'direct',
          },
        ]}
        activeTaskId="task-brain"
        activeTaskTitle="Research task"
        participantName="Researcher"
        participantIcon="brain"
      />,
    );

    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('svg[data-agent-glyph="brain"]')).not.toBeNull();
    expect(container.querySelector('svg[data-agent-glyph="image"]')).not.toBeNull();
  });

  it('renders the compact Figma section breadcrumb with truthful Runtime state', () => {
    const html = renderToStaticMarkup(
      <TalkTopBar
        section="tasks"
        runtimeState="online"
        workspaceName="SYNC-THINK"
        taskTitle="替换桌面界面"
      />,
    );

    expect(html).toContain('对话任务');
    expect(html).toContain('SYNC-THINK');
    expect(html).not.toContain('替换桌面界面');
    expect(html).toContain('Runtime 就绪');
  });

  it('keeps parent, child-task, archive, restore, and approval tools reachable in task mode', async () => {
    const onCreateChildTask = vi.fn();
    const onArchiveTask = vi.fn();
    const onUnarchiveTask = vi.fn();
    const onOpenParentTask = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkConversationTaskWorkspace
          tasks={[
            {
              taskId: 'task-parent',
              title: '主任务',
              status: 'active',
              kind: 'direct',
            },
            {
              taskId: 'task-child',
              parentTaskId: 'task-parent',
              title: '子任务',
              status: 'active',
              kind: 'direct',
            },
            {
              taskId: 'task-archived',
              title: '已归档任务',
              status: 'archived',
              kind: 'direct',
            },
          ]}
          showArchived
          activeTaskId="task-child"
          activeTaskTitle="子任务"
          parentTaskTitle="主任务"
          onCreateChildTask={onCreateChildTask}
          onArchiveTask={onArchiveTask}
          onUnarchiveTask={onUnarchiveTask}
          onOpenParentTask={onOpenParentTask}
          utilityLabel="操作审批"
          utilityCount={2}
          utilityPanel={<div data-testid="real-approval-panel">审批工具</div>}
          contextRail={null}
          conversation={null}
          compose={null}
          trace={null}
        />,
      );
    });

    expect(container.querySelector('[data-task-id="task-child"]')?.getAttribute('data-child')).toBe(
      '1',
    );
    const childToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="task-children-toggle-task-parent"]',
    );
    expect(childToggle?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => childToggle?.click());
    expect(container.querySelector('[data-task-id="task-child"]')).toBeNull();
    expect(childToggle?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => childToggle?.click());
    expect(container.querySelector('[data-task-id="task-child"]')).not.toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-task-actions="task-parent"] button[title="新建子任务"]',
        )
        ?.click(),
    );
    expect(onCreateChildTask).toHaveBeenCalledWith('task-parent');
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-task-actions="task-parent"] button[title="归档任务"]',
        )
        ?.click(),
    );
    expect(onArchiveTask).toHaveBeenCalledWith('task-parent');
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-task-actions="task-archived"] button[title="恢复任务"]',
        )
        ?.click(),
    );
    expect(onUnarchiveTask).toHaveBeenCalledWith('task-archived');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="task-parent-breadcrumb"]')?.click(),
    );
    expect(onOpenParentTask).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('返回父任务');

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[title="操作审批"]')?.click(),
    );
    expect(container.querySelector('[data-testid="real-approval-panel"]')).not.toBeNull();
  });

  it('renders persisted projects and wires task continuation to the real callback', async () => {
    const onOpenTask = vi.fn(async () => undefined);
    const onCreateTask = vi.fn(async () => undefined);
    const onSelectProject = vi.fn();
    const onBindGitRepository = vi.fn(async () => undefined);
    const task = {
      taskId: 'task-1' as never,
      workspaceId: 'workspace-1' as never,
      title: '替换桌面界面',
      goal: '按照 Talk V8 完成真实界面替换',
      status: 'active',
      participationMode: 'conversation' as const,
      executionMode: 'workspace' as const,
      taskVersion: 3,
      threadId: 'thread-1' as never,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T01:00:00.000Z',
      execution: {
        mode: 'managed_worktree' as const,
        state: 'ready' as const,
        executionPath: 'D:\\worktrees\\task-1',
        baseRef: 'main',
      },
    };
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkProjectsWorkspace
          workspaces={[
            {
              workspaceId: 'workspace-1' as never,
              name: 'SYNC-THINK',
              folderPath: 'D:\\projects\\SYNC-THINK',
              createdAt: '2026-07-17T00:00:00.000Z',
              updatedAt: '2026-07-18T01:00:00.000Z',
              resourceType: 'git_repository' as const,
              repositoryUrl: 'https://github.com/example/current.git',
              defaultRef: 'develop',
              executionProfileName: '默认运行配置',
              executionMode: 'managed_worktree' as const,
              browserIdentityName: '工作账号',
            },
          ]}
          tasksByWorkspace={new Map([['workspace-1', [task]]])}
          activeWorkspaceId="workspace-1"
          activeTaskId="task-1"
          onCreateProject={() => undefined}
          onBindFolder={() => undefined}
          onBindGitRepository={onBindGitRepository}
          onCreateTask={onCreateTask}
          onOpenTask={onOpenTask}
          onSelectProject={onSelectProject}
        />,
      );
    });

    expect(container.textContent).toContain('替换桌面界面');
    expect(container.textContent).toContain('完整对话上下文');
    expect(container.textContent).toContain('隔离工作树');
    expect(container.textContent).toContain('基准分支');
    await act(async () =>
      container.querySelector<HTMLButtonElement>('.st-talk-project-row')?.click(),
    );
    expect(onSelectProject).toHaveBeenCalledWith('workspace-1');
    expect(onOpenTask).toHaveBeenCalledWith(task);
    onOpenTask.mockClear();
    await act(async () => container.querySelector<HTMLButtonElement>('.st-talk-task-row')?.click());
    expect(onOpenTask).toHaveBeenCalledWith(task);
    onOpenTask.mockClear();
    await act(async () => buttonByText(container, '继续对话').click());
    expect(onOpenTask).toHaveBeenCalledWith(task);
    await act(async () => buttonByText(container, '新建任务').click());
    expect(onCreateTask).toHaveBeenCalledWith('workspace-1');
    await act(async () => buttonByText(container, '项目设置').click());
    expect(container.textContent).toContain('Git 仓库');
    expect(container.textContent).toContain('工作账号');
    expect(container.textContent).toContain('https://github.com/example/current.git');
    expect(container.textContent).toContain('develop');
    await act(async () => buttonByText(container, '编辑 Git 仓库').click());
    const repositoryInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="https://github.com/owner/repository.git"]',
    );
    expect(repositoryInput?.value).toBe('https://github.com/example/current.git');
    expect(controlByLabel<HTMLInputElement>(container, '默认分支', 'input').value).toBe('develop');
    await act(async () => {
      if (!repositoryInput) throw new Error('Repository input not found');
      setInputValue(repositoryInput, 'https://github.com/example/project.git');
    });
    await act(async () => buttonByText(container, '绑定仓库').click());
    expect(onBindGitRepository).toHaveBeenCalledWith(
      'workspace-1',
      'https://github.com/example/project.git',
      'develop',
    );
  });

  it('nests project conversations directly under the opened project in the directory', async () => {
    const onOpenTask = vi.fn(async () => undefined);
    const onCreateTask = vi.fn(async () => undefined);
    const onCreateProject = vi.fn();
    const onCreateProjectFromFolder = vi.fn(async () => undefined);
    const firstTask = {
      taskId: 'task-design' as never,
      workspaceId: 'workspace-1' as never,
      title: '设计复刻',
      goal: '按 Figma 还原',
      status: 'active',
      participationMode: 'conversation' as const,
      executionMode: 'workspace' as const,
      taskVersion: 1,
      threadId: 'thread-design' as never,
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T01:00:00.000Z',
    };
    const secondTask = {
      ...firstTask,
      taskId: 'task-build' as never,
      title: '实现页面',
      threadId: 'thread-build' as never,
      updatedAt: '2026-07-18T02:00:00.000Z',
    };
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkProjectsWorkspace
          workspaces={[
            {
              workspaceId: 'workspace-1' as never,
              name: 'SYNC-THINK',
              createdAt: '2026-07-17T00:00:00.000Z',
              updatedAt: '2026-07-18T01:00:00.000Z',
            },
          ]}
          tasksByWorkspace={new Map([['workspace-1', [firstTask, secondTask]]])}
          activeWorkspaceId="workspace-1"
          activeTaskId="task-design"
          onCreateProject={onCreateProject}
          onCreateProjectFromFolder={onCreateProjectFromFolder}
          onBindFolder={() => undefined}
          onCreateTask={onCreateTask}
          onOpenTask={onOpenTask}
        />,
      );
    });

    const nestedTree = container.querySelector(
      '[data-testid="talk-project-task-tree-workspace-1"]',
    );
    expect(nestedTree).not.toBeNull();
    expect(nestedTree?.textContent).toContain('设计复刻');
    expect(nestedTree?.textContent).toContain('实现页面');
    expect(nestedTree?.querySelectorAll('.st-talk-project-task-row')).toHaveLength(2);
    const projectRow = container.querySelector<HTMLButtonElement>('.st-talk-project-row');
    expect(projectRow?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => projectRow?.click());
    expect(projectRow?.getAttribute('aria-expanded')).toBe('false');
    expect(
      container.querySelector('[data-testid="talk-project-task-tree-workspace-1"]'),
    ).toBeNull();
    await act(async () => projectRow?.click());
    expect(projectRow?.getAttribute('aria-expanded')).toBe('true');
    const createTaskButton =
      nestedTree?.querySelector<HTMLButtonElement>('button[title="新建对话任务"]');
    expect(createTaskButton?.textContent?.trim()).toBe('');
    await act(async () => createTaskButton?.click());
    expect(onCreateTask).toHaveBeenCalledWith('workspace-1');

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[title="新建项目"]')?.click(),
    );
    expect(container.textContent).toContain('新建空白项目');
    expect(container.textContent).toContain('使用现有文件夹');
    const fromFolderButton = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((button) => button.textContent?.includes('使用现有文件夹'));
    await act(async () => fromFolderButton?.click());
    expect(onCreateProjectFromFolder).toHaveBeenCalledTimes(1);

    await act(async () =>
      nestedTree
        ?.querySelector<HTMLButtonElement>('[data-testid="talk-project-task-row-task-build"]')
        ?.click(),
    );
    expect(onOpenTask).toHaveBeenCalledWith(secondTask);
  });

  it('opens project settings in the detail column and clears a stale task for an empty project', async () => {
    const onOpenTask = vi.fn(async () => undefined);
    const onClearTask = vi.fn();
    const onSelectProject = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkProjectsWorkspace
          workspaces={[
            {
              workspaceId: 'workspace-1' as never,
              name: '已有任务',
              createdAt: '2026-07-17T00:00:00.000Z',
              updatedAt: '2026-07-18T01:00:00.000Z',
            },
            {
              workspaceId: 'workspace-empty' as never,
              name: '空项目',
              createdAt: '2026-07-18T00:00:00.000Z',
              updatedAt: '2026-07-18T01:00:00.000Z',
            },
          ]}
          tasksByWorkspace={new Map()}
          activeWorkspaceId="workspace-1"
          activeTaskId="task-old"
          onCreateProject={() => undefined}
          onBindFolder={() => undefined}
          onCreateTask={() => undefined}
          onOpenTask={onOpenTask}
          onClearTask={onClearTask}
          onSelectProject={onSelectProject}
        />,
      );
    });

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[title="项目设置"]')?.click(),
    );
    expect(
      container.querySelector('[data-testid="talk-projects-workspace"]')?.getAttribute('data-view'),
    ).toBe('settings');
    expect(container.textContent).toContain('绑定工作区');

    const emptyProject = [
      ...container.querySelectorAll<HTMLButtonElement>('.st-talk-project-row'),
    ].find((button) => button.textContent?.includes('空项目'));
    await act(async () => emptyProject?.click());
    expect(onSelectProject).toHaveBeenCalledWith('workspace-empty');
    expect(onClearTask).toHaveBeenCalledTimes(1);
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it('renders readable Skill details without exposing the internal object dump', () => {
    const html = renderToStaticMarkup(
      <TalkSkillsWorkspace
        skills={[
          {
            skillVersionId: 'skill-version-1',
            name: 'Repository review',
            version: '1.2.0',
            description: 'Review a repository against project rules.',
            allowedTools: ['read_file', 'git_diff'],
            permissionNote: 'Read-only project access',
          },
        ]}
        mcpServers={[]}
      />,
    );

    expect(html).toContain('允许工具');
    expect(html).toContain('read_file');
    expect(html).toContain('Read-only project access');
    expect(html).not.toContain('skillVersionId');
  });

  it('uses one full-height directory/detail skeleton for groups, automation, and Skill & MCP', () => {
    const groupsHtml = renderToStaticMarkup(
      <TalkGroupsWorkspace
        groups={[groupFixture()]}
        agents={groupAgents}
        workspaces={[]}
        loading={false}
        busy={false}
        onCreate={async () => undefined}
        onUpdate={async () => undefined}
        onAddMember={async () => undefined}
        onRemoveMember={async () => undefined}
        onUpdateResponsibility={async () => undefined}
        onSetLead={async () => undefined}
        onCreateTask={async () => undefined}
      />,
    );
    const automationHtml = renderToStaticMarkup(
      <TalkAutomationWorkspace
        automations={[automationFixture()]}
        executions={[]}
        runtime={{ schedulerAvailable: true, webhookAvailable: true }}
        workspaces={[]}
        agents={[]}
        groups={[]}
        loading={false}
        busy={false}
        revealedSecret={null}
        onCreate={async () => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
        onTrigger={async () => undefined}
        onOpenTask={async () => undefined}
        onDismissSecret={() => undefined}
      />,
    );
    const skillsHtml = renderToStaticMarkup(<TalkSkillsWorkspace skills={[]} mcpServers={[]} />);

    for (const [html, testId, createTitle] of [
      [groupsHtml, 'talk-groups-workspace', '新建群聊'],
      [automationHtml, 'talk-automation-workspace', '新建自动化'],
      [skillsHtml, 'talk-skills-workspace', '导入 Skill'],
    ]) {
      const container = document.createElement('div');
      container.innerHTML = html;
      const root = container.querySelector(`[data-testid="${testId}"]`);
      expect(root?.classList.contains('st-talk-resource-page')).toBe(true);
      expect(root?.querySelector(':scope > .st-talk-directory__list')).not.toBeNull();
      expect(root?.querySelector(':scope > .st-talk-directory__detail')).not.toBeNull();
      expect(root?.querySelector(`button[title="${createTitle}"]`)).not.toBeNull();
    }
  });

  it('submits group type, collaboration, permission, concurrency, lead, and members on create', async () => {
    const onCreate = vi.fn(async () => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkGroupsWorkspace
          groups={[]}
          agents={groupAgents}
          workspaces={[]}
          loading={false}
          busy={false}
          onCreate={onCreate}
          onUpdate={async () => undefined}
          onAddMember={async () => undefined}
          onRemoveMember={async () => undefined}
          onUpdateResponsibility={async () => undefined}
          onSetLead={async () => undefined}
          onCreateTask={async () => undefined}
        />,
      );
    });

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[title="新建群聊"]')?.click(),
    );
    await act(async () => {
      setInputValue(controlByLabel(container, '名称', 'input'), '临时发布小队');
      setTextareaValue(controlByLabel(container, '描述', 'textarea'), '串行完成发布复核');
      setSelectValue(controlByLabel(container, '主智能体', 'select'), 'agent-version-2');
      setSelectValue(controlByLabel(container, '群聊类型', 'select'), 'temporary');
      setSelectValue(controlByLabel(container, '协作模式', 'select'), 'sequential');
      setSelectValue(controlByLabel(container, '操作权限', 'select'), 'delegate');
      setInputValue(controlByLabel(container, '最大并发', 'input'), '5');
    });
    await act(async () => buttonByText(container, '创建群聊').click());

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '临时发布小队',
        description: '串行完成发布复核',
        kind: 'temporary',
        leadAgentVersionId: 'agent-version-2',
        collaborationMode: 'sequential',
        approvalMode: 'delegate',
        maxConcurrency: 5,
        members: expect.arrayContaining([
          expect.objectContaining({ agentVersionId: 'agent-version-1' }),
          expect.objectContaining({
            agentVersionId: 'agent-version-2',
            responsibility: '统筹、委派与最终总结',
          }),
        ]),
      }),
    );
  });

  it('creates a group chat task directly from the primary group action', async () => {
    const onCreateTask = vi.fn(async () => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkGroupsWorkspace
          groups={[groupFixture()]}
          agents={groupAgents}
          workspaces={[
            {
              workspaceId: 'workspace-other' as never,
              name: 'OTHER',
              createdAt: '2026-07-18T00:00:00.000Z',
              updatedAt: '2026-07-18T00:00:00.000Z',
            },
            {
              workspaceId: 'workspace-1' as never,
              name: 'TEST',
              createdAt: '2026-07-18T00:00:00.000Z',
              updatedAt: '2026-07-18T00:00:00.000Z',
            },
          ]}
          defaultWorkspaceId="workspace-1"
          loading={false}
          busy={false}
          onCreate={async () => undefined}
          onUpdate={async () => undefined}
          onAddMember={async () => undefined}
          onRemoveMember={async () => undefined}
          onUpdateResponsibility={async () => undefined}
          onSetLead={async () => undefined}
          onCreateTask={onCreateTask}
        />,
      );
    });

    await act(async () => buttonByText(container, '新建协作任务').click());

    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        workspaceId: 'workspace-1',
        title: expect.stringContaining('发布小队'),
        goal: expect.stringContaining('并行完成发布准备'),
      }),
    );
    expect(container.querySelector('.st-talk-task-create')).toBeNull();
  });

  it('persists edited group collaboration, permission, and concurrency fields', async () => {
    const onUpdate = vi.fn(async () => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkGroupsWorkspace
          groups={[groupFixture()]}
          agents={groupAgents}
          workspaces={[]}
          loading={false}
          busy={false}
          onCreate={async () => undefined}
          onUpdate={onUpdate}
          onAddMember={async () => undefined}
          onRemoveMember={async () => undefined}
          onUpdateResponsibility={async () => undefined}
          onSetLead={async () => undefined}
          onCreateTask={async () => undefined}
        />,
      );
    });

    await act(async () => buttonByText(container, '编辑资料').click());
    await act(async () => {
      setSelectValue(controlByLabel(container, '群聊类型', 'select'), 'temporary');
      setSelectValue(controlByLabel(container, '协作模式', 'select'), 'sequential');
      setSelectValue(controlByLabel(container, '操作权限', 'select'), 'custom');
      setInputValue(controlByLabel(container, '最大并发', 'input'), '7');
    });
    await act(async () => buttonByText(container, '保存').click());

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: 'group-1',
        expectedVersion: 2,
        kind: 'temporary',
        collaborationMode: 'sequential',
        approvalMode: 'custom',
        maxConcurrency: 7,
      }),
    );
  });

  it('imports Skill content and registers MCP metadata through the real callbacks', async () => {
    const onImportSkill = vi.fn(async () => undefined);
    const onRegisterMcp = vi.fn(async () => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkSkillsWorkspace
          skills={[]}
          mcpServers={[]}
          onImportSkill={onImportSkill}
          onRegisterMcp={onRegisterMcp}
        />,
      );
    });

    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[title="导入 Skill"]')?.click(),
    );
    const skillMd = '---\nname: repository-review\ndescription: Review repositories\n---';
    await act(async () =>
      setTextareaValue(controlByLabel(container, 'SKILL.md', 'textarea'), `  ${skillMd}  `),
    );
    await act(async () => buttonByText(container, '导入').click());
    expect(onImportSkill).toHaveBeenCalledWith(skillMd);

    await act(async () => buttonByText(container, 'MCP').click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[title="注册 MCP"]')?.click(),
    );
    await act(async () => {
      setInputValue(controlByLabel(container, '名称', 'input'), 'Local tools');
      setSelectValue(controlByLabel(container, '传输', 'select'), 'remote-http');
      setInputValue(
        controlByLabel(container, '端点 / 命令', 'input'),
        'http://127.0.0.1:47822/mcp',
      );
      setTextareaValue(
        controlByLabel(container, '工具（JSON 或逗号分隔）', 'textarea'),
        'read_file,write_file',
      );
      controlByLabel<HTMLInputElement>(container, '信任此 Server', 'input').click();
    });
    await act(async () => buttonByText(container, '注册').click());
    expect(onRegisterMcp).toHaveBeenCalledWith({
      name: 'Local tools',
      transport: 'remote-http',
      endpoint: 'http://127.0.0.1:47822/mcp',
      toolsJson: 'read_file,write_file',
      trusted: true,
    });
  });

  it('switches settings views, shows truthful counts and status, and changes theme', async () => {
    const onThemeChange = vi.fn();
    const onFontSizeChange = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkSettingsWorkspace
          theme="light"
          runtimeState="online"
          runtime={{
            schedulerAvailable: true,
            webhookAvailable: false,
            webhookBaseUrl: 'http://127.0.0.1:47821',
          }}
          workspaceCount={2}
          agentCount={4}
          providerCount={3}
          groupCount={1}
          browserIdentities={[
            {
              id: 'browser-work',
              name: '工作账号',
              isDefault: true,
              createdAt: '2026-07-18T00:00:00.000Z',
              updatedAt: '2026-07-18T00:00:00.000Z',
            },
            {
              id: 'browser-test',
              name: '测试账号',
              isDefault: false,
              createdAt: '2026-07-18T00:00:00.000Z',
              updatedAt: '2026-07-18T00:00:00.000Z',
            },
          ]}
          fontSize={14}
          onThemeChange={onThemeChange}
          onFontSizeChange={onFontSizeChange}
        />,
      );
    });

    const runtimeRows = container.querySelectorAll('.st-talk-runtime-row');
    expect(runtimeRows).toHaveLength(4);
    expect(runtimeRows[0]?.getAttribute('data-ready')).toBe('1');
    expect(runtimeRows[2]?.getAttribute('data-ready')).toBe('0');

    await act(async () => buttonByText(container, '浏览器身份').click());
    expect(container.textContent).toContain('工作账号');
    expect(container.textContent).toContain('默认 · 新任务继承');

    await act(async () => buttonByText(container, '数据与存储').click());
    expect(container.textContent).toContain('项目2');
    expect(container.textContent).toContain('智能体4');
    expect(container.textContent).toContain('供应商3');
    expect(container.textContent).toContain('群聊1');

    await act(async () => buttonByText(container, '外观').click());
    await act(async () => buttonByText(container, '深色').click());
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    const fontSize = container.querySelector<HTMLInputElement>(
      'input[type="range"][aria-label="字体大小"]',
    );
    expect(fontSize?.min).toBe('13');
    expect(fontSize?.max).toBe('18');
    expect(fontSize?.value).toBe('14');
    await act(async () => {
      if (!fontSize) throw new Error('Font size slider not found');
      setInputValue(fontSize, '16');
    });
    expect(onFontSizeChange).toHaveBeenCalledWith(16);

    await act(async () => buttonByText(container, '诊断').click());
    expect(container.textContent).toContain('已连接');
    expect(container.textContent).toContain('受限渲染进程 + 上下文隔离');
  });

  it('opens browser identity management directly and explains its task scope', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkSettingsWorkspace
          defaultTab="browser"
          theme="light"
          fontSize={14}
          runtimeState="online"
          workspaceCount={1}
          agentCount={1}
          providerCount={1}
          groupCount={0}
          browserIdentities={[]}
          onThemeChange={() => undefined}
          onFontSizeChange={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain('每个身份会隔离 Cookie、登录状态和网站数据');
    expect(container.textContent).toContain('新任务继承默认身份');
    expect(container.textContent).toContain('任务右侧栏');
    expect(container.textContent).toContain('工作账号');
    expect(container.textContent).toContain('个人账号');
    expect(container.textContent).toContain('不会串用 Cookie');
  });

  it('renders real automation status, trigger controls, and execution history', () => {
    const html = renderToStaticMarkup(
      <TalkAutomationWorkspace
        automations={[automationFixture()]}
        executions={[
          {
            id: 'execution-1' as never,
            automationId: 'automation-1' as never,
            triggerId: 'trigger-1',
            source: 'manual',
            status: 'completed',
            attempt: 0,
            taskId: 'task-1' as never,
            inputDigest: 'a'.repeat(64),
            createdAt: '2026-07-18T00:00:00.000Z',
          },
        ]}
        runtime={{ schedulerAvailable: true, webhookAvailable: true }}
        workspaces={[]}
        agents={[]}
        groups={[]}
        loading={false}
        busy={false}
        revealedSecret={null}
        onCreate={async () => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
        onTrigger={async () => undefined}
        onOpenTask={async () => undefined}
        onDismissSecret={() => undefined}
      />,
    );

    expect(html).toContain('每日检查');
    expect(html).toContain('立即运行');
    expect(html).toContain('运行历史');
    expect(html).toContain('打开任务');
    expect(html).not.toContain('暂无自动化');
  });

  it('wires automation editing, manual runs, history, and deletion to Runtime actions', async () => {
    const onUpdate = vi.fn(async () => undefined);
    const onDelete = vi.fn(async () => undefined);
    const onTrigger = vi.fn(async () => undefined);
    const onOpenTask = vi.fn(async () => undefined);
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TalkAutomationWorkspace
          automations={[automationFixture()]}
          executions={[
            {
              id: 'execution-1' as never,
              automationId: 'automation-1' as never,
              triggerId: 'trigger-1',
              source: 'manual',
              status: 'completed',
              attempt: 0,
              taskId: 'task-1' as never,
              inputDigest: 'a'.repeat(64),
              createdAt: '2026-07-18T00:00:00.000Z',
            },
          ]}
          runtime={{ schedulerAvailable: true, webhookAvailable: true }}
          workspaces={[{ workspaceId: 'workspace-1' as never, name: 'SYNC-THINK' }]}
          agents={[
            {
              agentId: 'agent-1',
              agentVersionId: 'agent-version-1',
              name: '默认助手',
              role: 'generalist',
            },
          ]}
          groups={[]}
          loading={false}
          busy={false}
          revealedSecret={null}
          onCreate={async () => undefined}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onTrigger={onTrigger}
          onOpenTask={onOpenTask}
          onDismissSecret={() => undefined}
        />,
      );
    });

    await act(async () => buttonByText(container, '编辑').click());
    const enabled = container.querySelector<HTMLInputElement>('.st-talk-check input');
    expect(enabled?.checked).toBe(true);
    await act(async () => enabled?.click());
    await act(async () => buttonByText(container, '保存').click());
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'automation-1',
        expectedVersion: 1,
        enabled: false,
      }),
    );

    const manualInput = container.querySelector<HTMLInputElement>(
      '.st-talk-automation-run > input',
    );
    await act(async () => {
      if (!manualInput) throw new Error('Manual input not found');
      setInputValue(manualInput, '只检查失败项');
    });
    await act(async () => buttonByText(container, '运行').click());
    expect(onTrigger).toHaveBeenCalledWith('automation-1', '只检查失败项');

    await act(async () => buttonByText(container, '打开任务').click());
    expect(onOpenTask).toHaveBeenCalledWith('task-1');
    const deleteButton = container.querySelector<HTMLButtonElement>('button[title="删除自动化"]');
    await act(async () => deleteButton?.click());
    expect(onDelete).toHaveBeenCalledWith('automation-1', 1);
  });
});
