/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserTaskDashboard } from './BrowserTaskDashboard.js';

const list = vi.fn();
const get = vi.fn();
const execute = vi.fn();
const executeDraft = vi.fn();
const approveAndExecute = vi.fn();
const detail = (id: string) => ({
  task: task(id, 'a'),
  version: { id: 'v1', steps: [{ kind: 'navigate', url: 'https://example.test' }], stepCount: 1 },
  reviews: [],
  recentRuns: [{ status: 'failed', error: 'Old failure must stay hidden' }],
  schedule: { enabled: true, intervalMinutes: 60 },
});
const profile = {
  id: 'default',
  name: '默认浏览器',
  revision: 1,
  isDefault: true,
  inUse: false,
  siteCount: 0,
  createdAt: '',
  updatedAt: '',
};
const task = (id: string, workspaceId?: string) => ({
  id,
  workspaceId,
  profileId: 'default',
  name: `任务 ${id}`,
  instruction: '每天签到',
  startUrl: 'https://example.test',
  source: 'manual',
  status: 'enabled',
  revision: 1,
  successCount: 0,
  failureCount: 0,
  createdAt: '',
  updatedAt: '',
});
const page = (id: string, workspaceId: string) => ({
  runId: id,
  taskId: id,
  workspaceId,
  profileId: 'default',
  name: `执行 ${id}`,
  currentStep: 2,
  stepCount: 4,
  startedAt: '',
  imageDataUrl: 'data:image/jpeg;base64,AAA',
  capturedAt: new Date().toISOString(),
});
const props = {
  workspaces: [
    { workspaceId: 'a', name: '工作区 A' },
    { workspaceId: 'b', name: '工作区 B' },
  ],
  renderManager: (_: unknown, back: () => void) => <button onClick={back}>返回总览</button>,
};

beforeEach(() => {
  get.mockReset().mockImplementation(async ({ taskId }) => detail(taskId));
  execute.mockReset().mockResolvedValue({ ok: true });
  executeDraft.mockReset().mockResolvedValue({ ok: true });
  approveAndExecute.mockReset().mockResolvedValue({ ok: true });
  list.mockReset().mockResolvedValue({
    tasks: [task('one', 'a'), task('two', 'b'), task('old')],
    livePages: [page('one', 'a'), page('two', 'b')],
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        browserWorkflow: { list, get, execute, executeDraft, approveAndExecute },
        listBrowserProfiles: vi.fn().mockResolvedValue({
          profiles: [profile, { ...profile, id: 'work', name: '工作浏览器' }],
        }),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('browser task dashboard', () => {
  it('includes an AI browser run without a saved workflow in the task list', async () => {
    list.mockResolvedValue({ tasks: [], livePages: [page('chat', 'a')] });
    render(<BrowserTaskDashboard {...props} />);
    const tasks = within(screen.getByLabelText('浏览器任务列表'));
    fireEvent.click(await tasks.findByRole('button', { name: '查看 执行 chat 的信息' }));
    expect(within(screen.getByRole('dialog')).getByAltText('执行 chat 执行页面')).toBeTruthy();
  });

  it('lists tasks across profiles and filters the left list without hiding running pages', async () => {
    render(<BrowserTaskDashboard {...props} />);
    await screen.findByText('任务 one');
    expect(list).toHaveBeenCalledWith({ limit: 100, includeLive: true });
    fireEvent.change(screen.getByLabelText('筛选工作区'), { target: { value: 'a' } });
    expect(screen.getByText('任务 one')).toBeTruthy();
    expect(screen.queryByText('任务 two')).toBeNull();
    expect(screen.getByRole('button', { name: '放大 执行 two' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('筛选工作区'), { target: { value: 'unassigned' } });
    expect(screen.getByText('任务 old')).toBeTruthy();
    expect(screen.queryByText('任务 one')).toBeNull();
  });

  it('enlarges the current page and removes completed runs on the next refresh', async () => {
    render(<BrowserTaskDashboard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '放大 执行 one' }));
    expect(within(screen.getByRole('dialog')).getByAltText('执行 one 执行页面')).toBeTruthy();
    list.mockResolvedValue({ tasks: [], livePages: [] });
    await waitFor(() => expect(screen.getByText('任务已结束')).toBeTruthy(), { timeout: 3500 });
    expect(screen.queryByRole('button', { name: '放大 执行 one' })).toBeNull();
    fireEvent.click(screen.getByLabelText('关闭放大预览'));
    expect(screen.getByText('等待任务开始')).toBeTruthy();
  });

  it('stops refreshing when the browser stage is inactive and ignores stale responses', async () => {
    let finish!: (value: unknown) => void;
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<BrowserTaskDashboard {...props} />);
    view.rerender(<BrowserTaskDashboard {...props} active={false} />);
    await act(async () => finish({ tasks: [task('late')], livePages: [] }));
    expect(screen.queryByText('任务 late')).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps one creation entry and inherits the chosen profile', async () => {
    render(<BrowserTaskDashboard {...props} activeWorkspaceId="a" onStartAiTask={vi.fn()} />);
    await screen.findByText('任务 one');
    fireEvent.change(screen.getByLabelText('浏览器环境 Profile'), { target: { value: 'work' } });
    fireEvent.click(screen.getByRole('button', { name: '让 AI 创建任务' }));
    const dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByLabelText('新任务所属工作区') as HTMLSelectElement).value).toBe('a');
    expect(dialog.getByText('工作浏览器')).toBeTruthy();
    expect(screen.queryByLabelText('手动创建任务')).toBeNull();
    expect(dialog.queryByLabelText('新任务浏览器环境')).toBeNull();
  });

  it('filters tasks by Profile while keeping all running pages visible', async () => {
    list.mockResolvedValue({
      tasks: [task('one', 'a'), { ...task('work', 'a'), profileId: 'work' }],
      livePages: [page('one', 'a')],
    });
    render(<BrowserTaskDashboard {...props} />);
    await screen.findByText('任务 one');
    expect(screen.queryByText('任务 work')).toBeNull();
    fireEvent.change(screen.getByLabelText('浏览器环境 Profile'), { target: { value: 'work' } });
    expect(screen.getByText('任务 work')).toBeTruthy();
    expect(screen.queryByText('任务 one')).toBeNull();
    expect(screen.getByRole('button', { name: '放大 执行 one' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /浏览器环境/ })).toBeNull();
  });

  it('shows only task information in a dialog, without creation or run history', async () => {
    render(<BrowserTaskDashboard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看 任务 one 的信息' }));
    const info = within(screen.getByRole('dialog', { name: '任务 one' }));
    expect(await info.findByText('每 60 分钟')).toBeTruthy();
    expect(info.getByText('打开 https://example.test')).toBeTruthy();
    expect(info.queryByText('Old failure must stay hidden')).toBeNull();
    expect(info.getAllByRole('button')).toHaveLength(1);
    expect(info.queryByRole('combobox')).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('starts prepared tasks immediately, prevents duplicate clicks and allows another task to run', async () => {
    list.mockResolvedValue({ tasks: [task('one'), task('two')], livePages: [] });
    let finish!: (value: unknown) => void;
    execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<BrowserTaskDashboard {...props} />);
    const button = await screen.findByRole('button', { name: '立即执行 任务 one' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      (screen.getByRole('button', { name: '正在执行 任务 one' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '立即执行 任务 two' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await act(async () => finish({ ok: true }));
    expect(await screen.findByRole('button', { name: '立即执行 任务 one' })).toBeTruthy();
  });

  it('asks for missing variables, then requests permission only for the returned origins', async () => {
    list.mockResolvedValue({ tasks: [task('one')], livePages: [] });
    get.mockResolvedValue({
      ...detail('one'),
      version: { steps: [{ kind: 'fill', value: { kind: 'variable', name: '部门' } }] },
    });
    execute.mockResolvedValue({ ok: false, missingOrigins: ['https://example.test'] });
    render(<BrowserTaskDashboard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '立即执行 任务 one' }));
    const input = await screen.findByLabelText('部门');
    expect(execute).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '产品' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByText('确认访问站点');
    expect(execute).toHaveBeenCalledWith({ taskId: 'one', variables: { 部门: '产品' } });
    expect(approveAndExecute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '允许并执行' }));
    await waitFor(() =>
      expect(approveAndExecute).toHaveBeenCalledWith({
        taskId: 'one',
        variables: { 部门: '产品' },
        origins: ['https://example.test'],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('executes a recorded draft and explains an empty draft without sending an execution', async () => {
    list.mockResolvedValue({ tasks: [task('one'), task('two')], livePages: [] });
    get.mockImplementation(async ({ taskId }) => ({
      ...detail(taskId),
      version: undefined,
      draft: { steps: taskId === 'one' ? [{ kind: 'navigate', url: 'https://example.test' }] : [] },
    }));
    render(<BrowserTaskDashboard {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '立即执行 任务 one' }));
    await waitFor(() => expect(executeDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '立即执行 任务 two' }));
    expect(await screen.findByText('「任务 two」尚未配置操作步骤。')).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
    expect(executeDraft).toHaveBeenCalledTimes(1);
  });

  it('marks stale previews on a connection error and supports retry', async () => {
    list.mockRejectedValue(new Error('connection lost'));
    render(<BrowserTaskDashboard {...props} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('连接中断')).toBeTruthy();
    list.mockResolvedValue({ tasks: [], livePages: [] });
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
