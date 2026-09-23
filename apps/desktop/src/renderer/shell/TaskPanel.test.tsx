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
import type { WorkspaceSummary } from '@sync-think/protocol';
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

const models: ModelOption[] = [
  { modelId: 'model-a', displayName: 'DeepSeek V3', providerName: 'deepseek' },
];

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

function renderPanel(calendar = false, workspaces: WorkspaceSummary[] = []) {
  const result = render(
    <TaskPanel agents={[agent]} models={models} teams={[]} workspaces={workspaces} skills={[]} />,
  );
  if (!calendar) fireEvent.click(screen.getByRole('button', { name: '列表' }));
  return result;
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
    renderPanel();
    await screen.findByText('每日代码巡检');
    const deleteBtn = screen.getAllByRole('button').find((button) => button.title === '删除');
    fireEvent.click(deleteBtn!);
    expect(runtime.deleteScheduledTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(runtime.deleteScheduledTask).toHaveBeenCalledWith({ taskId: 'task-1' });
    });
  });

  it('filters by state chips', async () => {
    mockBridge({
      listScheduledTasks: vi.fn(async () => ({
        tasks: [task, { ...task, id: 'task-2', name: '停用任务', enabled: false }],
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
  it('defaults to the week calendar and switches views', async () => {
    mockBridge({ listScheduledTasks: vi.fn(async () => ({ tasks: [] })) });
    renderPanel(true);
    await screen.findByTestId('task-empty');
    expect(screen.getByRole('button', { name: '周' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.task-cal__day')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: '月' }));
    expect(document.querySelectorAll('.task-cal__month-cell').length).toBeGreaterThanOrEqual(28);
    fireEvent.click(screen.getByRole('button', { name: '日' }));
    expect(document.querySelectorAll('.task-cal__day')).toHaveLength(1);
  });

  it('lists actual workspaces including empty ones, and preselects the scope for creation', async () => {
    const runtime = mockBridge({
      listScheduledTasks: vi.fn(async () => ({
        tasks: [
          task,
          { ...task, id: 'workspace-task', name: '工作区任务', workspaceId: 'sync-think' },
        ],
      })),
    });
    renderPanel(false, [
      { workspaceId: 'sync-think', name: 'SYNC-THINK' },
      { workspaceId: 'cuitaliao', name: 'cuitaliao' },
    ] as WorkspaceSummary[]);
    await screen.findByText('工作区任务');
    fireEvent.keyDown(screen.getByRole('button', { name: '按任务归属筛选' }), { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitemcheckbox', { name: 'cuitaliao 工作区 0' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'SYNC-THINK 工作区 1' }));
    expect(screen.queryByText('每日代码巡检')).toBeNull();
    // Checkbox menu stays open so another workspace can be included.
    expect(screen.getByRole('menu')).toBeTruthy();
    // Multi-select another scope while keeping the dropdown open.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '全局任务 不隶属工作区 1' }));
    expect(screen.getByRole('button', { name: '按任务归属筛选' }).textContent).toContain('已选 2 项');
    expect(screen.getByText('每日代码巡检')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '全局任务 不隶属工作区 1' }));
    expect(screen.queryByText('每日代码巡检')).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByTestId('task-create'));
    expect(screen.getByRole('button', { name: '任务归属' }).textContent).toContain('SYNC-THINK');
    fireEvent.change(screen.getByPlaceholderText('如：每日代码巡检'), {
      target: { value: '新工作区任务' },
    });
    fireEvent.change(screen.getByPlaceholderText(/检查仓库/), { target: { value: '检查' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() =>
      expect(runtime.createScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'sync-think' }),
      ),
    );
  });

  it('uses a clicked time slot as the local single-run time', async () => {
    mockBridge({ listScheduledTasks: vi.fn(async () => ({ tasks: [] })) });
    renderPanel(true);
    await screen.findByTestId('task-empty');
    const slot = screen.getAllByRole('button', { name: /在 .* 10:00 新建任务/ })[0]!;
    const day = slot.getAttribute('aria-label')!.split(' ')[1];
    fireEvent.click(slot);
    expect((screen.getByLabelText('单次执行日期') as HTMLInputElement).value).toBe(day);
    expect((screen.getByLabelText('单次执行时间') as HTMLInputElement).value).toBe('10:00');
  });

  it('opens details and hands off to editing without leaving a blocking drawer', async () => {
    mockBridge({
      listScheduledTasks: vi.fn(async () => ({
        tasks: [{ ...task, enabled: false, nextRunAt: undefined }],
      })),
    });
    renderPanel(true);
    fireEvent.click(await screen.findByRole('button', { name: '每日代码巡检 · 已停用' }));
    expect(screen.getByRole('dialog', { name: '任务详情' })).toBeTruthy();
    fireEvent.click(screen.getByTitle('编辑'));
    expect(screen.queryByRole('dialog', { name: '任务详情' })).toBeNull();
    expect(screen.getByTestId('task-editor')).toBeTruthy();
  });
  it('creates a weekly task with an effective date and start time', async () => {
    const runtime = mockBridge();
    renderPanel();
    await screen.findByText('每日代码巡检');
    fireEvent.click(screen.getByTestId('task-create'));
    fireEvent.change(screen.getByPlaceholderText('如：每日代码巡检'), {
      target: { value: '工作日巡检' },
    });
    fireEvent.change(screen.getByPlaceholderText(/检查仓库/), { target: { value: '检查改动' } });
    fireEvent.keyDown(screen.getByRole('button', { name: '重复方式' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '每周' }));
    fireEvent.change(screen.getByLabelText('每周任务生效日期'), {
      target: { value: '2027-01-04' },
    });
    fireEvent.change(screen.getByLabelText('开始时间：小时'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('开始时间：分钟'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() =>
      expect(runtime.createScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          rule: {
            kind: 'weekly',
            selection: { mode: 'range', start: 1, end: 5 },
            time: '18:30',
            startDate: '2027-01-04',
          },
        }),
      ),
    );
  });

  it('switches between details and live history in one sheet, then edits the same task', async () => {
    const runtime = mockBridge({
      listScheduledTasks: vi.fn(async () => ({ tasks: [{ ...task, enabled: false }] })),
    });
    renderPanel(true);
    fireEvent.click(await screen.findByRole('button', { name: '每日代码巡检 · 已停用' }));
    fireEvent.click(screen.getByRole('button', { name: '运行记录' }));
    expect(await screen.findByText('未发现新的未提交改动，仓库状态正常')).toBeTruthy();
    expect(runtime.scheduledTaskHistory).toHaveBeenCalledWith({ taskId: task.id, limit: 20 });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '任务详情' }));
    expect(screen.getByText(task.instruction)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑任务' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect((screen.getByLabelText('任务名称') as HTMLInputElement).value).toBe(task.name);
    expect(screen.getByText('保存后保持停用')).toBeTruthy();
  });

  it('applies a custom calendar date and time shortcut to the weekly payload', async () => {
    const runtime = mockBridge();
    renderPanel();
    await screen.findByText(task.name);
    fireEvent.click(screen.getByTestId('task-create'));
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '日历选择测试' } });
    fireEvent.change(screen.getByLabelText('执行内容'), { target: { value: '整理待办' } });
    fireEvent.keyDown(screen.getByRole('button', { name: '重复方式' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '每周' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '重复方式' })),
    );
    fireEvent.change(screen.getByLabelText('每周任务生效日期'), {
      target: { value: '2027-01-01' },
    });
    fireEvent.keyDown(screen.getByRole('button', { name: '选择生效日期' }), { key: 'ArrowDown' });
    const dateOption = await screen.findByRole('menuitem', { name: '2027-01-04' });
    fireEvent.click(dateOption);
    await waitFor(() =>
      expect((screen.getByLabelText('每周任务生效日期') as HTMLInputElement).value).toBe(
        '2027-01-04',
      ),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: '选择生效日期' })),
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '选择开始时间' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '18' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '30' }));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() =>
      expect(runtime.createScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          rule: expect.objectContaining({ time: '18:30', startDate: '2027-01-04' }),
        }),
      ),
    );
  });

  it('restores a cross-week range on edit and saves specific weekdays', async () => {
    const runtime = mockBridge({
      listScheduledTasks: vi.fn(async () => ({
        tasks: [
          {
            ...task,
            rule: {
              kind: 'weekly',
              selection: { mode: 'range', start: 5, end: 1 },
              time: '18:30',
              startDate: '2027-01-04',
            },
          },
        ],
      })),
    });
    renderPanel();
    await screen.findByText('每日代码巡检');
    fireEvent.click(screen.getByTitle('编辑'));
    expect(screen.getByRole('button', { name: '重复方式' }).textContent).toContain('每周');
    expect(screen.getByRole('button', { name: '开始星期' }).textContent).toContain('周五');
    expect(screen.getByRole('button', { name: '结束星期' }).textContent).toContain('周一');
    expect((screen.getByLabelText('开始时间：小时') as HTMLInputElement).value).toBe('18');
    expect((screen.getByLabelText('每周任务生效日期') as HTMLInputElement).value).toBe(
      '2027-01-04',
    );
    fireEvent.click(screen.getByRole('button', { name: '指定星期' }));
    fireEvent.click(screen.getByRole('button', { name: '周六' }));
    fireEvent.click(screen.getByRole('button', { name: '周日' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() =>
      expect(runtime.updateScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({
            rule: {
              kind: 'weekly',
              selection: { mode: 'days', days: [1, 5] },
              time: '18:30',
              startDate: '2027-01-04',
            },
          }),
        }),
      ),
    );
  });

  it('blocks an empty weekly day selection', async () => {
    const runtime = mockBridge({
      listScheduledTasks: vi.fn(async () => ({
        tasks: [
          {
            ...task,
            rule: {
              kind: 'weekly',
              selection: { mode: 'days', days: [3] },
              time: '09:00',
              startDate: '2027-01-04',
            },
          },
        ],
      })),
    });
    renderPanel();
    await screen.findByText('每日代码巡检');
    fireEvent.click(screen.getByTitle('编辑'));
    fireEvent.click(screen.getByRole('button', { name: '周三' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(runtime.updateScheduledTask).not.toHaveBeenCalled();
    expect(screen.getByText('请至少选择一个星期。')).toBeTruthy();
  });
});
