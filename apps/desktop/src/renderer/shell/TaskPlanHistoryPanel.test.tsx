// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TaskPlanHistoryPage } from '@sync-think/protocol';
import { TaskPlanHistoryPanel } from './TaskPlanHistoryPanel.js';

const conversationId = 'conversation' as import('@sync-think/shared').ConversationId;
const run = {
  runId: 'old-run',
  sequence: 1,
  updatedSequence: 3,
  updatedAt: '2026-09-06T03:00:00Z',
  kernelId: 'codex',
  source: 'plan' as const,
  status: 'completed' as const,
  title: '审计架构',
  completed: 0,
  total: 1,
};
const page = (): TaskPlanHistoryPage => ({
  runs: [run],
  selected: {
    ...run,
    offset: 0,
    version: 'a'.repeat(64),
    items: [{ title: '审计架构', description: '核对原生任务完整说明', status: 'in_progress' }],
  },
});
afterEach(cleanup);

describe('read-only native task history', () => {
  it('loads only on explicit open, displays recorded status and preserves descriptions', async () => {
    const read = vi.fn().mockResolvedValue(page());
    render(<TaskPlanHistoryPanel conversationId={conversationId} readHistory={read} />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    expect(await screen.findByText('核对原生任务完整说明')).toBeTruthy();
    expect(read).toHaveBeenCalledWith({ conversationId, offset: 0 });
    expect(screen.getByText('记录时进行中')).toBeTruthy();
    expect(screen.getByText(/不代表当前执行/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /执行|批准|删除/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    expect(screen.queryByText('核对原生任务完整说明')).toBeNull();
  });

  it('pages task items with the selected source version and keeps a failed page visible for explicit refresh', async () => {
    const first = page();
    first.selected!.nextOffset = 1;
    first.selected!.total = 2;
    const read = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('history.version-changed'))
      .mockResolvedValueOnce(page());
    render(<TaskPlanHistoryPanel conversationId={conversationId} readHistory={read} />);
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一页任务' }));
    expect((await screen.findByRole('alert')).textContent).toContain('历史记录已更新');
    expect(screen.getByText('核对原生任务完整说明')).toBeTruthy();
    expect(read.mock.calls[1]?.[0]).toMatchObject({
      runId: 'old-run',
      offset: 1,
      version: 'a'.repeat(64),
    });
    fireEvent.click(screen.getByRole('button', { name: '刷新历史任务' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(read.mock.calls[2]?.[0].version).toBeUndefined();
  });

  it('ignores late responses after switching conversation and does not eagerly read the new scope', async () => {
    let resolve: (value: TaskPlanHistoryPage) => void = () => {};
    const read = vi.fn().mockImplementation(
      () =>
        new Promise<TaskPlanHistoryPage>((done) => {
          resolve = done;
        }),
    );
    const view = render(
      <TaskPlanHistoryPanel conversationId={conversationId} readHistory={read} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    view.rerender(
      <TaskPlanHistoryPanel conversationId={'other' as typeof conversationId} readHistory={read} />,
    );
    resolve(page());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '历史任务' }).getAttribute('aria-expanded')).toBe(
        'false',
      ),
    );
    expect(screen.queryByText('核对原生任务完整说明')).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit clearing distinct from missing history and supports older run pages', async () => {
    const cleared = page();
    cleared.selected!.items = [];
    cleared.selected!.total = 0;
    cleared.nextBeforeSequence = 1;
    cleared.nextBeforeRunId = 'old-run';
    const read = vi.fn().mockResolvedValueOnce(cleared).mockResolvedValueOnce({ runs: [] });
    render(<TaskPlanHistoryPanel conversationId={conversationId} readHistory={read} />);
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    expect(await screen.findByText('此轮已明确清空任务清单。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '更早轮次' }));
    expect(await screen.findByText('这一页没有已确认的原生任务记录。')).toBeTruthy();
    expect(read.mock.calls[1]?.[0]).toMatchObject({
      beforeSequence: 1,
      beforeRunId: 'old-run',
      offset: 0,
    });
  });
});

it('does not reformat and rerender an unchanged historical page on unrelated parent updates', async () => {
  const format = vi.spyOn(Date.prototype, 'toLocaleString');
  try {
    const read = vi.fn().mockResolvedValue(page());
    const view = render(
      <TaskPlanHistoryPanel conversationId={conversationId} readHistory={read} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '历史任务' }));
    await screen.findByText('核对原生任务完整说明');
    const count = format.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    view.rerender(<TaskPlanHistoryPanel conversationId={conversationId} readHistory={read} />);
    expect(format).toHaveBeenCalledTimes(count);
  } finally {
    format.mockRestore();
  }
});
