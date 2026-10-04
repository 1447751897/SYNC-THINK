/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event, RunIndexEntry } from '@sync-think/shared';
import { ActivityCenterPage } from './ActivityCenterPage.js';
import { ToastProvider, resetToastStoreForTests } from './Toast.js';

const runtime = {
  activityListRuns: vi.fn(),
  activityListExternalEvents: vi.fn(),
  activityRetryAnchor: vi.fn(),
  collaboration: vi.fn(),
};

function run(overrides: Partial<RunIndexEntry> & { runId: string }): RunIndexEntry {
  return {
    workspaceId: 'workspace-a',
    state: 'completed',
    source: 'chat',
    startedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  } as unknown as RunIndexEntry;
}

const EMPTY_COUNTS = { running: 0, completed: 0, failed: 0, cancelled: 0, paused: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function lifecycleEvent(id: string, type: string): Event {
  return {
    id,
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    runId: 'run-a',
    category: 'run',
    type,
    sequence: 1,
    occurredAt: '2026-08-21T00:00:00.000Z',
    payload: {},
  } as unknown as Event;
}

beforeEach(() => {
  runtime.activityListRuns.mockReset().mockResolvedValue({
    entries: [run({ runId: 'run-1', title: '第一个 Run' })],
    counts: { ...EMPTY_COUNTS, completed: 1 },
  });
  runtime.activityListExternalEvents.mockReset().mockResolvedValue({ entries: [] });
  runtime.activityRetryAnchor.mockReset();
  runtime.collaboration.mockReset().mockResolvedValue({ activities: [] });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime } });
});

afterEach(() => {
  cleanup();
  resetToastStoreForTests();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('ActivityCenterPage', () => {
  it('shows collaboration tasks across conversations and opens the owning chat', async () => {
    const onOpenConversation = vi.fn();
    runtime.collaboration.mockResolvedValue({
      activities: [
        {
          conversationId: 'collaboration-1',
          conversationTitle: '发布协作',
          taskId: 'task-1',
          taskTitle: '验证发布',
          assigneeName: '验证员',
          status: 'running',
          updatedAt: '2026-08-21T01:00:00.000Z',
        },
      ],
    });

    render(<ActivityCenterPage onOpenConversation={onOpenConversation} />);

    expect(await screen.findByText('验证发布')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开协作' }));
    expect(onOpenConversation).toHaveBeenCalledWith('collaboration-1');
  });

  it('renders runs from the read model and shows per-state counts', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [
        run({ runId: 'run-1', title: '失败的 Run', state: 'failed', errorMessage: '内核退出' }),
        run({ runId: 'run-2', title: '完成的 Run' }),
      ],
      counts: { ...EMPTY_COUNTS, failed: 1, completed: 1 },
    });

    render(<ActivityCenterPage />);

    expect(await screen.findByText('失败的 Run')).toBeTruthy();
    expect(screen.getByText('完成的 Run')).toBeTruthy();
    expect(screen.getByText('内核退出')).toBeTruthy();
    // 全部 Run 的计数是各状态之和，不是当前页行数。
    expect(screen.getByTestId('activity-filter-all').textContent).toContain('2');
  });

  it('never presents a raw run or model id as the row title', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [
        run({
          runId: '1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ',
          modelId: '1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ',
        }),
      ],
      counts: { ...EMPTY_COUNTS, completed: 1 },
    });

    render(<ActivityCenterPage />);

    const row = await screen.findByTestId('activity-run-row');
    expect(row.textContent).toContain('对话');
    expect(row.textContent).not.toContain('1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ');
  });

  it('shows a provider model name when the stored model id is opaque', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [
        run({
          runId: 'run-model',
          title: '分析登录流程',
          modelId: '1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ',
          providerModelId: 'gpt-5.2',
        }),
      ],
      counts: { ...EMPTY_COUNTS, completed: 1 },
    });

    render(<ActivityCenterPage />);

    expect(await screen.findByText('分析登录流程')).toBeTruthy();
    expect(screen.getByText('gpt-5.2')).toBeTruthy();
    expect(screen.queryByText('1BH6F4YC5ST8SWWW10TB4QNQNVKZSRZ')).toBeNull();
  });

  it('uses user-facing kernel names without changing stored kernel ids', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [run({ runId: 'run-gpt', title: 'GPT Run', kernelId: 'codex' })],
      counts: { ...EMPTY_COUNTS, completed: 1 },
    });

    render(<ActivityCenterPage />);

    expect(await screen.findByText('GPT')).toBeTruthy();
    expect(screen.queryByText('codex')).toBeNull();
  });

  it('sends the picked state to the Runtime instead of filtering locally', async () => {
    render(<ActivityCenterPage />);
    await screen.findByText('第一个 Run');

    fireEvent.click(screen.getByTestId('activity-filter-failed'));

    await waitFor(() => {
      expect(runtime.activityListRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ states: ['failed'] }),
      );
    });
  });

  it('keeps the latest filter result when refresh responses finish out of order', async () => {
    const failed = deferred<{
      entries: RunIndexEntry[];
      counts: typeof EMPTY_COUNTS;
    }>();
    const completed = deferred<{
      entries: RunIndexEntry[];
      counts: typeof EMPTY_COUNTS;
    }>();
    runtime.activityListRuns.mockImplementation((payload: { states?: string[] }) => {
      if (payload.states?.[0] === 'failed') return failed.promise;
      if (payload.states?.[0] === 'completed') return completed.promise;
      return Promise.resolve({
        entries: [run({ runId: 'run-initial', title: '初始结果' })],
        counts: { ...EMPTY_COUNTS, completed: 1 },
      });
    });

    render(<ActivityCenterPage />);
    await screen.findByText('初始结果');
    fireEvent.click(screen.getByTestId('activity-filter-failed'));
    fireEvent.click(screen.getByTestId('activity-filter-completed'));

    await act(async () => {
      completed.resolve({
        entries: [run({ runId: 'run-current', title: '最新完成结果' })],
        counts: { ...EMPTY_COUNTS, completed: 1 },
      });
      await completed.promise;
    });
    expect(await screen.findByText('最新完成结果')).toBeTruthy();

    await act(async () => {
      failed.resolve({
        entries: [run({ runId: 'run-stale', title: '过期失败结果', state: 'failed' })],
        counts: { ...EMPTY_COUNTS, failed: 1 },
      });
      await failed.promise;
    });
    expect(screen.queryByText('过期失败结果')).toBeNull();
    expect(screen.getByText('最新完成结果')).toBeTruthy();
  });

  it('appends the next page instead of replacing the current one', async () => {
    runtime.activityListRuns.mockResolvedValueOnce({
      entries: [run({ runId: 'run-1', title: '第一页' })],
      counts: { ...EMPTY_COUNTS, completed: 2 },
      nextCursor: 'cursor-1',
    });
    runtime.activityListRuns.mockResolvedValueOnce({
      entries: [run({ runId: 'run-2', title: '第二页' })],
      counts: { ...EMPTY_COUNTS, completed: 2 },
    });

    render(<ActivityCenterPage />);
    await screen.findByText('第一页');

    fireEvent.click(screen.getByTestId('activity-load-more'));

    expect(await screen.findByText('第二页')).toBeTruthy();
    // 游标严格向更旧的行走，所以拼接不会丢掉已显示的第一页。
    expect(screen.getByText('第一页')).toBeTruthy();
    expect(runtime.activityListRuns).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'cursor-1' }),
    );
  });

  it('restores a failed Run prompt for editing without sending or changing models', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [run({ runId: 'run-1', title: '失败的 Run', state: 'failed' })],
      counts: { ...EMPTY_COUNTS, failed: 1 },
    });
    runtime.activityRetryAnchor.mockResolvedValue({
      retryable: true,
      conversationId: 'conversation-a',
      text: '请重新分析这段日志',
    });
    const onRetryRun = vi.fn();
    const onOpenConversation = vi.fn();

    render(<ActivityCenterPage onRetryRun={onRetryRun} onOpenConversation={onOpenConversation} />);
    expect(screen.getByText(/统一查看对话、定时任务和外部触发的执行结果/)).toBeTruthy();
    const restore = await screen.findByRole('button', { name: '重新编辑' });
    expect(restore.getAttribute('title')).toContain('不会自动发送或更换模型');
    expect(screen.queryByRole('button', { name: '重发' })).toBeNull();
    fireEvent.click(restore);

    await waitFor(() => {
      expect(onRetryRun).toHaveBeenCalledWith({
        conversationId: 'conversation-a',
        text: '请重新分析这段日志',
      });
    });
    expect(onOpenConversation).toHaveBeenCalledWith('conversation-a');
    // 发送仍归 ChatView：本页不得触碰 appendMessage 的 task-version 栅栏。
    expect(runtime).not.toHaveProperty('appendMessage');
  });

  it('reports a non-retryable run inline rather than seeding an empty prompt', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [run({ runId: 'run-1', title: '进行中的 Run', state: 'failed' })],
      counts: { ...EMPTY_COUNTS, failed: 1 },
    });
    runtime.activityRetryAnchor.mockResolvedValue({
      retryable: false,
      reason: '该 Run 仍在进行中',
    });
    const onRetryRun = vi.fn();

    render(
      <ToastProvider>
        <ActivityCenterPage onRetryRun={onRetryRun} />
      </ToastProvider>,
    );
    fireEvent.click(await screen.findByTestId('activity-retry'));

    expect((await screen.findByTestId('shell-toast')).textContent).toContain('该 Run 仍在进行中');
    expect(onRetryRun).not.toHaveBeenCalled();
  });

  it('does not refetch for run history that predates mounting', async () => {
    const history = [lifecycleEvent('event-1', 'run.completed')];
    const { rerender } = render(<ActivityCenterPage eventHistory={history} />);
    await screen.findByText('第一个 Run');
    expect(runtime.activityListRuns).toHaveBeenCalledTimes(1);

    // 同一批历史再渲染一次不应触发查询；只有新的终态事件才算「列表已过期」。
    rerender(<ActivityCenterPage eventHistory={history} />);
    await Promise.resolve();
    expect(runtime.activityListRuns).toHaveBeenCalledTimes(1);

    rerender(
      <ActivityCenterPage eventHistory={[...history, lifecycleEvent('event-2', 'run.failed')]} />,
    );
    await waitFor(() => {
      expect(runtime.activityListRuns).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores run events that do not change a run’s lifecycle state', async () => {
    const history = [lifecycleEvent('event-1', 'run.completed')];
    const { rerender } = render(<ActivityCenterPage eventHistory={history} />);
    await screen.findByText('第一个 Run');
    expect(runtime.activityListRuns).toHaveBeenCalledTimes(1);

    // `plan.approved` 也属于 run 分类，但不会改变列表里的任何一行。
    rerender(
      <ActivityCenterPage
        eventHistory={[...history, lifecycleEvent('event-2', 'plan.approved')]}
      />,
    );
    await Promise.resolve();
    expect(runtime.activityListRuns).toHaveBeenCalledTimes(1);
  });
});

describe('Inbox master/detail workbench', () => {
  it('opens a message without navigating and returns to the list', async () => {
    const open = vi.fn();
    render(<ActivityCenterPage onOpenConversation={open} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看消息：第一个 Run' }));
    const detail = screen.getByTestId('inbox-message-detail');
    expect(within(detail).getByRole('heading', { name: '第一个 Run' })).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    expect(
      document.querySelector('.inbox-workbench__frame')?.getAttribute('data-detail-open'),
    ).toBe('true');
    fireEvent.click(within(detail).getByRole('button', { name: '返回消息列表' }));
    expect(
      document.querySelector('.inbox-workbench__frame')?.getAttribute('data-detail-open'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: '查看消息：第一个 Run' })).toBeTruthy();
  });

  it('searches loaded messages, reports no match and restores results when cleared', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [
        run({ runId: 'alpha', title: '分析日志' }),
        run({ runId: 'beta', title: '设计页面' }),
      ],
      counts: { ...EMPTY_COUNTS, completed: 2 },
    });
    render(<ActivityCenterPage />);
    await screen.findByText('分析日志');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索消息或任务' }), {
      target: { value: '设计' },
    });
    expect(screen.queryByRole('button', { name: '查看消息：分析日志' })).toBeNull();
    expect(screen.getByRole('button', { name: '查看消息：设计页面' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索消息或任务' }), {
      target: { value: '不存在的关键词' },
    });
    expect(screen.getByText('没有找到匹配的消息')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(screen.getByRole('button', { name: '查看消息：分析日志' })).toBeTruthy();
  });

  it('filters collaboration and system messages as well as runs', async () => {
    runtime.collaboration.mockResolvedValue({
      activities: [
        {
          conversationId: 'chat-a',
          taskId: 'a',
          taskTitle: '等待确认',
          conversationTitle: '团队发布',
          assigneeName: '设计员',
          status: 'waiting_input',
          updatedAt: '2026-10-04T01:00:00Z',
        },
        {
          conversationId: 'chat-b',
          taskId: 'b',
          taskTitle: '交付完成',
          conversationTitle: '团队发布',
          assigneeName: '开发员',
          status: 'succeeded',
          updatedAt: '2026-10-04T02:00:00Z',
        },
      ],
    });
    runtime.activityListExternalEvents.mockResolvedValue({
      entries: [
        {
          id: 'event-a',
          dedupeKey: 'private-dedupe-key',
          title: '外部回调失败',
          state: 'failed',
          sourceKind: 'webhook',
          attemptCount: 2,
          createdAt: '2026-10-04T03:00:00Z',
          updatedAt: '2026-10-04T03:00:00Z',
        },
      ],
    });
    render(<ActivityCenterPage />);
    await screen.findByText('等待确认');
    fireEvent.click(
      within(screen.getByRole('group', { name: '消息分类' })).getByRole('button', {
        name: /需关注/,
      }),
    );
    expect(screen.getByRole('button', { name: '查看消息：等待确认' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看消息：外部回调失败' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看消息：交付完成' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看消息：第一个 Run' })).toBeNull();
    fireEvent.click(screen.getByTestId('activity-source-external'));
    await waitFor(() =>
      expect(runtime.activityListRuns).toHaveBeenLastCalledWith(
        expect.objectContaining({ sources: ['external'] }),
      ),
    );
    expect(screen.queryByRole('button', { name: '查看消息：等待确认' })).toBeNull();
    expect(screen.getByRole('button', { name: '查看消息：外部回调失败' })).toBeTruthy();
    expect(screen.queryByText('private-dedupe-key')).toBeNull();
  });

  it('shows the full error and seeds feedback only after explicit submission', async () => {
    const open = vi.fn();
    const seed = vi.fn();
    runtime.activityListRuns.mockResolvedValue({
      entries: [
        run({
          runId: 'failed',
          title: '检查交付',
          conversationId: 'chat-a',
          state: 'failed',
          errorMessage: '产物尚未提交',
          failureClass: 'delivery',
        }),
      ],
      counts: { ...EMPTY_COUNTS, failed: 1 },
    });
    render(<ActivityCenterPage onOpenConversation={open} onRetryRun={seed} />);
    fireEvent.click(await screen.findByRole('button', { name: '查看消息：检查交付' }));
    const detail = within(screen.getByTestId('inbox-message-detail'));
    expect(detail.getByText('[delivery] 产物尚未提交')).toBeTruthy();
    const submit = detail.getByRole('button', { name: '将反馈带回对话' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(detail.getByRole('textbox', { name: '补充反馈' }), {
      target: { value: '  请补充验收报告  ' },
    });
    expect(seed).not.toHaveBeenCalled();
    fireEvent.click(submit);
    expect(seed).toHaveBeenCalledWith({ conversationId: 'chat-a', text: '请补充验收报告' });
    expect(open).toHaveBeenCalledWith('chat-a');
    expect(runtime).not.toHaveProperty('appendMessage');
  });

  it('keeps message identity separate even when sources share an id', async () => {
    runtime.activityListRuns.mockResolvedValue({
      entries: [run({ runId: 'same', title: '执行结果' })],
      counts: { ...EMPTY_COUNTS, completed: 1 },
    });
    runtime.activityListExternalEvents.mockResolvedValue({
      entries: [
        {
          id: 'same',
          title: '系统事件',
          state: 'completed',
          sourceKind: 'webhook',
          attemptCount: 1,
          createdAt: '2026-10-04T00:00:00Z',
          updatedAt: '2026-10-04T00:00:00Z',
        },
      ],
    });
    render(<ActivityCenterPage />);
    fireEvent.click(await screen.findByRole('button', { name: '查看消息：系统事件' }));
    expect(
      within(screen.getByTestId('inbox-message-detail')).getByRole('heading', { name: '系统事件' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '将反馈带回对话' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看消息：执行结果' }));
    expect(
      within(screen.getByTestId('inbox-message-detail')).getByRole('heading', { name: '执行结果' }),
    ).toBeTruthy();
  });

  it('refreshes system events together with the other message sources', async () => {
    render(<ActivityCenterPage />);
    await screen.findByText('第一个 Run');
    expect(runtime.activityListExternalEvents).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('activity-refresh'));
    await waitFor(() => expect(runtime.activityListExternalEvents).toHaveBeenCalledTimes(2));
  });
});

describe('Inbox attention paging', () => {
  it('requests attention states so older failures are not hidden behind the first page', async () => {
    runtime.activityListRuns.mockImplementation((payload: { states?: string[] }) =>
      Promise.resolve({
        entries: payload.states?.includes('failed')
          ? [run({ runId: 'old-failure', title: '历史执行异常', state: 'failed' })]
          : [run({ runId: 'recent', title: '最近完成的执行' })],
        counts: { ...EMPTY_COUNTS, failed: 12, completed: 25 },
      }),
    );
    render(<ActivityCenterPage />);
    await screen.findByText('最近完成的执行');
    fireEvent.click(
      within(screen.getByRole('group', { name: '消息分类' })).getByRole('button', {
        name: /需关注/,
      }),
    );
    expect(await screen.findByRole('button', { name: '查看消息：历史执行异常' })).toBeTruthy();
    expect(runtime.activityListRuns).toHaveBeenLastCalledWith(
      expect.objectContaining({ states: ['failed', 'paused'] }),
    );
  });

  it('retains the selected message and updates its detail after a refresh', async () => {
    runtime.activityListRuns.mockResolvedValueOnce({
      entries: [run({ runId: 'stable', title: '核对交付', state: 'running' })],
      counts: { ...EMPTY_COUNTS, running: 1 },
    });
    render(<ActivityCenterPage />);
    fireEvent.click(await screen.findByRole('button', { name: '查看消息：核对交付' }));
    expect(
      within(screen.getByTestId('inbox-message-detail')).getByText(
        '任务正在执行，运行状态会自动更新。',
      ),
    ).toBeTruthy();
    runtime.activityListRuns.mockResolvedValue({
      entries: [run({ runId: 'stable', title: '核对交付', state: 'completed' })],
      counts: { ...EMPTY_COUNTS, completed: 1 },
    });
    fireEvent.click(screen.getByTestId('activity-refresh'));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('inbox-message-detail')).getByText('已完成执行'),
      ).toBeTruthy(),
    );
    expect(
      within(screen.getByTestId('inbox-message-detail')).getByRole('heading', { name: '核对交付' }),
    ).toBeTruthy();
  });
});
