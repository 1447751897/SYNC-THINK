/**
 * @vitest-environment jsdom
 *
 * 定时任务面板：空态、列表渲染（规则摘要/徽标）、筛选（归属/状态）、
 * 执行历史弹层、新建对话框校验与创建、启停/立即触发/删除操作。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GlobalAgent, ScheduledTask } from '@sync-think/shared';
import type { ModelOption } from './NewConversationDialog.js';
import { TaskPanel } from './TaskPanel.js';

const agent = {
  id: 'agent-1',
  name: '代码审查员',
  avatar: '🛡️',
  description: '代码巡检与风险报告',
  defaultModelId: 'model-a',
  fallbackModelIds: [],
  skillIds: [],
  mcpServerIds: [],
  archived: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
} as unknown as GlobalAgent;

const models: ModelOption[] = [{ modelId: 'model-a', displayName: 'DeepSeek V3', providerName: 'deepseek' }];

const task: ScheduledTask = {
  id: 'task-1',
  name: '每日代码巡检',
  instruction: '检查未提交改动',
  target: { kind: 'agent', agentId: 'agent-1' },
  rule: { kind: 'every', intervalMinutes: 60 },
  timeZone: 'UTC',
  enabled: true,
  nextRunAt: '2025-01-02T01:00:00.000Z',
  lastRunAt: '2025-01-01T01:00:00.000Z',
  lastResult: { status: 'success', firedAt: '2025-01-01T01:00:00.000Z' },
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

function mockBridge(overrides: Record<string, unknown> = {}) {
  const runtime = {
    listScheduledTasks: vi.fn(async () => ({ tasks: [task] })),
    createScheduledTask: vi.fn(async () => ({ task })),
    updateScheduledTask: vi.fn(async () => ({ task })),
    deleteScheduledTask: vi.fn(async () => ({ deleted: true })),
    triggerScheduledTask: vi.fn(async () => ({ task, fired: true })),
    scheduledTaskHistory: vi.fn(async () => ({
      entries: [
        {
          id: 'h1',
          taskId: 'task-1',
          status: 'success',
          firedAt: '2025-01-01T01:00:00.000Z',
          summary: '未发现新的未提交改动，仓库状态正常',
        },
      ],
    })),
    ...overrides,
  };
  (window as unknown as Record<string, unknown>).syncThink = { runtime };
  return runtime;
}

function renderPanel() {
  return render(
    <TaskPanel
      agents={[agent]}
      models={models}
      teams={[]}
      workspaces={[]}
      skills={[]}
    />,
  );
}

describe('TaskPanel', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).syncThink;
  });

  it('renders task cards with rule summaries and results', async () => {
    mockBridge();
    renderPanel();
    expect(await screen.findByText('每日代码巡检')).toBeTruthy();
    expect(screen.getByText(/每 60 分钟/)).toBeTruthy();
    expect(screen.getByText(/智能体 · 代码审查员/)).toBeTruthy();
    const last = document.querySelector('.task-panel__last-result[data-status="success"]');
    expect(last).toBeTruthy();
    expect(last?.textContent).toContain('✓');
  });

  it('shows the empty state without tasks', async () => {
    mockBridge({ listScheduledTasks: vi.fn(async () => ({ tasks: [] })) });
    renderPanel();
    expect(await screen.findByTestId('task-empty')).toBeTruthy();
  });

  it('opens the create dialog and saves a new task', async () => {
    const runtime = mockBridge();
    renderPanel();
    await screen.findByText('每日代码巡检');
    fireEvent.click(screen.getByTestId('task-create'));
    expect(screen.getByTestId('task-editor')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('如：每日代码巡检'), {
      target: { value: '周报生成' },
    });
    fireEvent.change(screen.getByPlaceholderText(/检查仓库/), {
      target: { value: '汇总本周变更并生成报告' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => {
      expect(runtime.createScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '周报生成',
          instruction: '汇总本周变更并生成报告',
          target: { kind: 'agent', agentId: 'agent-1' },
          rule: expect.objectContaining({ kind: 'every', intervalMinutes: 60 }),
        }),
      );
    });
  });

  it('validates required fields before creating', async () => {
    const runtime = mockBridge();
    renderPanel();
    await screen.findByText('每日代码巡检');
    fireEvent.click(screen.getByTestId('task-create'));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(runtime.createScheduledTask).not.toHaveBeenCalled();
  });

  it('toggles enabled and triggers immediately', async () => {
    const runtime = mockBridge();
    renderPanel();
    await screen.findByText('每日代码巡检');
    const buttons = screen.getAllByRole('button');
    const trigger = buttons.find((button) => button.title === '立即触发');
    const toggle = buttons.find((button) => button.title === '停用');
    fireEvent.click(trigger!);
    await waitFor(() => {
      expect(runtime.triggerScheduledTask).toHaveBeenCalledWith({ taskId: 'task-1' });
    });
    fireEvent.click(toggle!);
    await waitFor(() => {
      expect(runtime.updateScheduledTask).toHaveBeenCalledWith({
        taskId: 'task-1',
        patch: { enabled: false },
      });
    });
  });

  it('deletes with confirmation', async () => {
    const runtime = mockBridge();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel();
    await screen.findByText('每日代码巡检');
    const deleteBtn = screen
      .getAllByRole('button')
      .find((button) => button.title === '删除');
    fireEvent.click(deleteBtn!);
    await waitFor(() => {
      expect(runtime.deleteScheduledTask).toHaveBeenCalledWith({ taskId: 'task-1' });
    });
    confirmSpy.mockRestore();
  });

  it('filters by state chips', async () => {
    mockBridge({
      listScheduledTasks: vi.fn(async () => ({
        tasks: [
          task,
          { ...task, id: 'task-2', name: '停用任务', enabled: false },
        ],
      })),
    });
    renderPanel();
    await screen.findByText('每日代码巡检');
    fireEvent.click(screen.getByRole('button', { name: /已停用/ }));
    expect(screen.getByText('停用任务')).toBeTruthy();
    expect(screen.queryByText('每日代码巡检')).toBeNull();
  });

  it('opens the history panel and loads entries', async () => {
    const runtime = mockBridge();
    renderPanel();
    await screen.findByText('每日代码巡检');
    fireEvent.click(screen.getByTitle('执行历史'));
    expect(await screen.findByTestId('task-history')).toBeTruthy();
    expect(runtime.scheduledTaskHistory).toHaveBeenCalledWith({
      taskId: 'task-1',
      limit: 20,
    });
    expect(await screen.findByText('未发现新的未提交改动，仓库状态正常')).toBeTruthy();
    expect(screen.getByText(/成功 1/)).toBeTruthy();
  });
});
