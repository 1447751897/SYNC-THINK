/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      activities: [{
        conversationId: 'collaboration-1', conversationTitle: '发布协作',
        taskId: 'task-1', taskTitle: '验证发布', assigneeName: '验证员',
        status: 'running', updatedAt: '2026-08-21T01:00:00.000Z',
      }],
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
    runtime.activityListRuns.mockImplementation(
      (payload: { states?: string[] }) => {
        if (payload.states?.[0] === 'failed') return failed.promise;
        if (payload.states?.[0] === 'completed') return completed.promise;
        return Promise.resolve({
          entries: [run({ runId: 'run-initial', title: '初始结果' })],
          counts: { ...EMPTY_COUNTS, completed: 1 },
        });
      },
    );

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
    expect(screen.getByText(/Webhook、Git 推送和文件监听等系统触发记录/)).toBeTruthy();
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
