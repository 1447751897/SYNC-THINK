// @vitest-environment jsdom

import React, { createRef } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationExecutionLogs,
  ConversationTaskProgress,
  TaskArtifactDialog,
  TaskArtifactDirectory,
} from '../src/renderer/conversation-detail-rail.js';
import type { ConversationLogTurn } from '../src/renderer/conversation-log-projection.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | undefined;

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  document.body.replaceChildren();
});

function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

const logFixture: ConversationLogTurn = {
  id: 'turn-1',
  index: 1,
  userMessage: '请重新设计右侧任务详情，并让 Builder 实现、Reviewer 审查。',
  state: 'completed',
  startedAt: '2026-07-18T08:00:00.000Z',
  endedAt: '2026-07-18T08:01:18.000Z',
  durationMs: 78_000,
  runIds: ['run-0042'],
  modelCallCount: 2,
  toolCallCount: 1,
  tokensIn: 2400,
  tokensOut: 680,
  artifactCount: 1,
  errorCount: 1,
  finalResponse: '已完成右侧详情改造。',
  stages: [
    {
      id: 'runtime',
      title: 'SYNC-THINK Runtime',
      agentName: 'SYNC-THINK Runtime',
      state: 'completed',
      durationMs: 1_000,
      events: [
        {
          id: 'event-command',
          type: 'execution.tool.completed',
          summary: '运行命令 · pnpm test',
          occurredAt: '2026-07-18T08:00:30.000Z',
          details: [{ label: '命令', value: 'pnpm test' }],
        },
        {
          id: 'event-runtime',
          type: 'run.recovered',
          summary: 'Runtime 恢复执行',
          occurredAt: '2026-07-18T08:00:01.000Z',
          details: [],
        },
      ],
    },
    {
      id: 'step-builder',
      title: '实现界面',
      agentVersionId: 'agent-builder',
      agentName: 'Builder',
      role: '执行智能体',
      responsibility: '实现界面',
      modelLabel: 'gpt-5.6',
      color: '#2563eb',
      state: 'completed',
      durationMs: 42_000,
      events: [
        {
          id: 'event-build',
          type: 'step.completed',
          summary: '执行完成 · 实现界面',
          occurredAt: '2026-07-18T08:00:42.000Z',
          details: [{ label: 'Step', value: 'step-builder' }],
        },
      ],
    },
    {
      id: 'step-reviewer',
      title: '审查结果',
      agentVersionId: 'agent-reviewer',
      agentName: 'Reviewer',
      role: '审查智能体',
      responsibility: '检查结果',
      modelLabel: 'claude-sonnet-4',
      color: '#7c3aed',
      state: 'completed',
      durationMs: 36_000,
      events: [
        {
          id: 'event-review',
          type: 'review.accepted',
          summary: '审查通过',
          occurredAt: '2026-07-18T08:01:18.000Z',
          details: [{ label: '评审', value: '通过' }],
        },
      ],
    },
  ],
};

describe('conversation detail rail', () => {
  it('keeps task access compact and hides raw capabilities from the normal rail', async () => {
    const onPermissionModeChange = vi.fn();
    const onBrowserIdentityChange = vi.fn();
    const onManageBrowserIdentities = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <ConversationTaskProgress
          summary={{ state: 'running', completedSteps: 1, totalSteps: 2 }}
          steps={[]}
          participants={[]}
          accessDetails={{
            approvalMode: 'full',
            executionMode: 'managed_worktree',
            executionState: 'ready',
            baseRef: 'main',
            browserIdentityName: '工作账号',
            effectiveToolNames: ['read_file', 'run_command', 'browser_navigate'],
            capabilityCeiling: {
              file: ['*'],
              command: ['*'],
              browser: ['*'],
              desktop: [],
              network: [],
            },
          }}
          permissionMode="full-access"
          onPermissionModeChange={onPermissionModeChange}
          browserIdentities={[
            { id: 'browser-default', name: '默认身份', isDefault: true },
            { id: 'browser-work', name: '工作账号' },
          ]}
          selectedBrowserIdentityId="browser-default"
          onBrowserIdentityChange={onBrowserIdentityChange}
          onManageBrowserIdentities={onManageBrowserIdentities}
        />,
      );
    });

    const permission = container.querySelector<HTMLSelectElement>(
      'select[aria-label="当前任务操作权限"]',
    );
    const browser = container.querySelector<HTMLSelectElement>(
      'select[aria-label="当前任务浏览器身份"]',
    );
    expect(permission?.value).toBe('full-access');
    expect(browser?.value).toBe('browser-default');
    await act(async () => {
      if (!permission || !browser) throw new Error('Task access controls not found');
      permission.value = 'workspace';
      permission.dispatchEvent(new Event('change', { bubbles: true }));
      browser.value = 'browser-work';
      browser.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onPermissionModeChange).toHaveBeenCalledWith('workspace');
    expect(onBrowserIdentityChange).toHaveBeenCalledWith('browser-work');
    expect(container.textContent).not.toContain('本次可用能力');
    expect(container.textContent).not.toContain('智能体能力上限');
    expect(container.textContent).not.toContain('文件、命令、浏览器');
    expect(container.textContent).not.toContain('browser_navigate');

    await act(async () => {
      const manageButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="管理浏览器身份"]',
      );
      if (!manageButton) throw new Error('Manage browser identity button not found');
      manageButton.click();
    });
    expect(onManageBrowserIdentities).toHaveBeenCalledTimes(1);
  });

  it('renders the Figma task progress hierarchy without approval UI', () => {
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    act(() => {
      mountedRoot?.render(
        <ConversationTaskProgress
          projectName="SYNC-THINK"
          ownerLabel="0到1交付小队"
          summary={{
            runId: 'run-0042',
            state: 'running',
            completedSteps: 3,
            totalSteps: 6,
            durationMs: 438_000,
          }}
          steps={[
            { id: '1', title: '需求梳理与现状分析', state: 'completed', agentName: 'Architect' },
            { id: '2', title: '竞品调研', state: 'completed', agentName: 'Researcher' },
            { id: '3', title: '组件规范草稿', state: 'running', agentName: 'Builder' },
            { id: '4', title: 'Reviewer 审查', state: 'waiting', agentName: 'Reviewer' },
            { id: '5', title: '文档整合与输出', state: 'waiting', agentName: 'Writer' },
            { id: '6', title: '人工最终审批', state: 'waiting', agentName: 'Architect' },
          ]}
          participants={[
            {
              id: 'agent-architect',
              name: 'Architect',
              responsibility: '统筹与拆解',
              modelLabel: 'claude-opus-4',
              state: 'running',
              color: '#7c3aed',
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain('属性');
    expect(container.textContent).toContain('0到1交付小队');
    expect(container.textContent).toContain('SYNC-THINK');
    expect(container.textContent).not.toContain('Run ID');
    expect(container.textContent).not.toContain('run-0042');
    expect(container.textContent).toContain('3 / 6');
    expect(container.textContent).toContain('7m 18s');
    expect(container.textContent).toContain('本轮任务');
    expect(container.textContent).toContain('需求梳理与现状分析');
    expect(container.textContent).toContain('Architect');
    expect(container.querySelector('[data-testid="task-progress-approval"]')).toBeNull();
    expect(container.querySelector('.st-conversation-progress')).toBeTruthy();
    expect(container.querySelector('li[aria-label*="已完成"]')).toBeTruthy();
  });

  it('shows worktree conflicts and wires both explicit resolution choices', async () => {
    const onResolve = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);
    await act(async () => {
      mountedRoot?.render(
        <ConversationTaskProgress
          summary={{ state: 'completed', completedSteps: 1, totalSteps: 1 }}
          steps={[]}
          participants={[]}
          childTasks={[
            {
              taskId: 'child-1',
              title: '实现设置页',
              status: 'completed',
              integrationStatus: 'conflicted',
              conflictFiles: ['settings.tsx'],
            },
          ]}
          onResolveChildIntegration={onResolve}
        />,
      );
    });
    expect(container.textContent).toContain('改动集成冲突');
    expect(container.textContent).toContain('1 个文件');
    const childToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-controls="rail-progress-child-list"]',
    );
    expect(childToggle?.getAttribute('aria-expanded')).toBe('true');
    await act(async () => childToggle?.click());
    expect(container.textContent).not.toContain('实现设置页');
    await act(async () => childToggle?.click());
    expect(container.textContent).toContain('实现设置页');
    await act(async () => buttonByText(container, '采用子任务').click());
    await act(async () => buttonByText(container, '保留父任务').click());
    expect(onResolve).toHaveBeenNthCalledWith(1, 'child-1', 'accept-child');
    expect(onResolve).toHaveBeenNthCalledWith(2, 'child-1', 'keep-parent');
  });

  it('renders a compact artifact directory and opens the selected real artifact', async () => {
    const onOpenArtifact = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TaskArtifactDirectory
          items={[
            {
              id: 'artifact-1',
              name: 'detail-rail.tsx',
              mimeType: 'text/typescript',
              latestVersion: 3,
              selectedVersion: 2,
              producerName: 'Builder',
              modelLabel: 'gpt-5.6',
              createdAt: '2026-07-18T08:00:42.000Z',
              state: 'ready',
            },
          ]}
          onOpenArtifact={onOpenArtifact}
        />,
      );
    });

    expect(container.textContent).toContain('detail-rail.tsx');
    expect(container.textContent).toContain('v3');
    expect(container.textContent).toContain('当前 v2');
    expect(container.textContent).toContain('Builder');
    expect(container.textContent).toContain('gpt-5.6');
    await act(async () => buttonByText(container, 'detail-rail.tsx').click());
    expect(onOpenArtifact).toHaveBeenCalledWith('artifact-1');
  });

  it('renders artifact details in an accessible modal and restores focus on Escape', async () => {
    const onClose = vi.fn();
    const origin = document.createElement('button');
    origin.textContent = 'open artifact';
    document.body.append(origin);
    origin.focus();
    const originRef = createRef<HTMLButtonElement>();
    Object.defineProperty(originRef, 'current', { value: origin });
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(
        <TaskArtifactDialog
          artifactName="detail-rail.tsx"
          returnFocusRef={originRef}
          onClose={onClose}
        >
          <div data-testid="real-artifact-panel">版本比较与合并</div>
        </TaskArtifactDialog>,
      );
    });

    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.body.textContent).toContain('版本比较与合并');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(origin);
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="关闭"]')?.click(),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(origin);
  });

  it('keeps focus inside the current dialog control when live data rerenders', async () => {
    const origin = document.createElement('button');
    document.body.append(origin);
    const originRef = createRef<HTMLButtonElement>();
    Object.defineProperty(originRef, 'current', { value: origin });
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    const renderDialog = (version: number) => (
      <TaskArtifactDialog
        artifactName="detail-rail.tsx"
        returnFocusRef={originRef}
        onClose={() => undefined}
      >
        <button type="button">版本 {version}</button>
      </TaskArtifactDialog>
    );

    await act(async () => mountedRoot?.render(renderDialog(1)));
    const versionButton = buttonByText(document, '版本 1');
    versionButton.focus();
    await act(async () => mountedRoot?.render(renderDialog(2)));

    expect(document.activeElement).toBe(buttonByText(document, '版本 2'));
  });

  it('shows one row per user turn and expands logs only for the selected Agent stage', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);

    await act(async () => {
      mountedRoot?.render(<ConversationExecutionLogs turns={[logFixture]} />);
    });

    expect(container.querySelectorAll('.st-conversation-log-row')).toHaveLength(1);
    const turnButton = buttonByText(container, '请重新设计右侧任务详情');
    turnButton.focus();
    await act(async () => turnButton.click());

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('Builder');
    expect(dialog?.textContent).toContain('Reviewer');
    expect(dialog?.textContent).toContain('gpt-5.6');
    expect(dialog?.textContent).toContain('claude-sonnet-4');
    expect(dialog?.textContent).not.toContain('run-0042');
    expect(dialog?.querySelector('.st-conversation-log-dialog__metadata')?.textContent).toContain(
      '2 Agent',
    );
    expect(dialog?.textContent).toContain('2 次模型调用');
    expect(dialog?.textContent).toContain('1 次工具调用');
    expect(turnButton.textContent).toContain('1 个产物');
    expect(turnButton.textContent).toContain('1 个异常');
    expect(dialog?.textContent).not.toContain('执行完成 · 实现界面');
    expect(dialog?.textContent).not.toContain('审查通过');

    const builderStage = buttonByText(dialog!, 'Builder');
    expect(builderStage.getAttribute('aria-label')).toContain('已完成');
    expect(builderStage.title).toContain('gpt-5.6');
    await act(async () => builderStage.click());
    expect(dialog?.textContent).toContain('执行完成 · 实现界面');
    expect(dialog?.textContent).not.toContain('运行命令 · pnpm test');
    expect(dialog?.textContent).not.toContain('审查通过');

    await act(async () => buttonByText(dialog!, '工具').click());
    const runtimeStage = buttonByText(dialog!, 'SYNC-THINK Runtime');
    await act(async () => runtimeStage.click());
    expect(dialog?.textContent).toContain('运行命令 · pnpm test');
    expect(dialog?.textContent).not.toContain('执行完成 · 实现界面');

    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(turnButton);
  });
});
