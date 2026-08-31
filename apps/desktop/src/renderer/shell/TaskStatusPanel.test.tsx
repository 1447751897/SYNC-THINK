/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GoalStatus } from '@sync-think/protocol';
import type { TodoProjection } from './todo-projection.js';
import { TaskStatusPanel } from './TaskStatusPanel.js';

const runtime = {
  getGitInfo: vi.fn(),
  getGitReview: vi.fn(),
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
};

const todo: TodoProjection = {
  items: [
    { title: '初始化棋盘', status: 'completed' },
    { title: '实现落子逻辑', status: 'in_progress' },
    { title: '补充验证', status: 'pending' },
  ],
  completed: 1,
  total: 3,
  running: true,
};

const goal: GoalStatus = {
  conversationId: 'conversation-a',
  condition: '完成五子棋并通过全部验证',
  status: 'active',
  startedAt: '2026-08-27T08:00:00.000Z',
  turnCount: 1,
  tokensIn: 0,
  tokensOut: 0,
  roundsStarted: 2,
  maxGoalRounds: 5,
  lastReason: '核心流程已完成，仍需视觉验证',
};

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-27T08:02:00.000Z'));
  runtime.getGitInfo.mockReset().mockResolvedValue({
    branch: 'feat/status-card',
    branches: ['feat/status-card', 'main'],
    changes: [
      { status: 'M', path: 'src/App.tsx' },
      { status: '??', path: 'src/new.ts' },
    ],
    recentCommits: [{ hash: 'abc1234', subject: 'initial', files: [], truncated: false }],
    additions: 34,
    deletions: 7,
    ahead: 1,
    behind: 0,
    hasRemote: true,
    isRepo: true,
  });
  runtime.gitCheckout.mockReset().mockResolvedValue({
    ok: true,
    dirty: false,
    changes: [],
    error: null,
  });
  runtime.gitCreateBranch.mockReset().mockResolvedValue({ ok: true, error: null });
  runtime.gitCommit.mockReset().mockResolvedValue({
    ok: true,
    committed: true,
    pushed: false,
    error: null,
  });
  runtime.gitPush.mockReset().mockResolvedValue({ ok: true, pushed: true, error: null });
  runtime.getGitReview.mockReset().mockResolvedValue({
    files: [
      {
        path: 'src/App.tsx',
        action: 'edited',
        previousContent: 'old\n',
        content: 'new\n',
      },
    ],
  });
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('TaskStatusPanel', () => {
  it('renders the complete local-ZCode section order from real data', async () => {
    render(
      <TaskStatusPanel projectFolder="D:/project" goal={goal} evaluatorConfigured todo={todo} />,
    );

    const panel = await screen.findByTestId('task-status-panel');
    const sections = within(panel).getAllByTestId('task-status-section');
    expect(sections.map((section) => section.getAttribute('data-section'))).toEqual([
      'git',
      'goal',
      'progress',
    ]);
    expect(panel.textContent).toContain('+34');
    expect(panel.textContent).toContain('-7');
    expect(panel.textContent).toContain('feat/status-card');
    expect(panel.textContent).toContain('完成五子棋并通过全部验证');
    expect(panel.textContent).toContain('第 2/5 轮');
    expect(panel.textContent).toContain('1/3');
    expect(screen.getByText('初始化棋盘').className).toContain('is-completed');
    expect(panel.textContent).toContain('Git 工具');
    expect(panel.textContent).toContain('目标');
    expect(panel.textContent).toContain('任务清单');
    expect(panel.textContent).not.toContain('Git tools');
    expect(panel.textContent).not.toContain('Progress');
  });

  it('collapses each section independently', async () => {
    render(<TaskStatusPanel projectFolder="D:/project" goal={goal} todo={todo} />);
    const panel = await screen.findByTestId('task-status-panel');
    const goalToggle = within(panel).getByRole('button', { name: /目标/ });

    fireEvent.click(goalToggle);

    expect(screen.queryByText('完成五子棋并通过全部验证')).toBeNull();
    expect(within(panel).getByText('实现落子逻辑')).toBeTruthy();
  });

  it('does not expose legacy evaluator configuration as Goal status', async () => {
    render(<TaskStatusPanel goal={goal} evaluatorConfigured={false} />);

    const panel = await screen.findByTestId('task-status-panel');
    expect(panel.textContent).toContain('完成五子棋并通过全部验证');
    expect(panel.textContent).not.toContain('评估模型未配置');
  });

  it('opens worktree review directly and keeps branch and commit tools functional', async () => {
    const onOpenReview = vi.fn();
    render(
      <TaskStatusPanel
        projectFolder="D:/project"
        goal={goal}
        todo={todo}
        onOpenReview={onOpenReview}
      />,
    );
    await screen.findByTestId('task-status-panel');

    fireEvent.click(screen.getByRole('button', { name: /更改/ }));
    await waitFor(() => expect(runtime.getGitReview).toHaveBeenCalledWith({ root: 'D:/project' }));
    expect(onOpenReview).toHaveBeenCalledWith(
      expect.objectContaining({
        fileChanges: [expect.objectContaining({ path: 'src/App.tsx', action: 'edited' })],
      }),
    );
    expect(screen.queryByRole('dialog', { name: /更改/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /feat\/status-card/ }));
    expect(screen.getByRole('menu', { name: 'Git 分支' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'main' }));
    await waitFor(() => expect(runtime.gitCheckout).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^提交 \/ 推送/ }));
    const dialog = screen.getByRole('dialog', { name: '提交更改' });
    fireEvent.change(within(dialog).getByLabelText('提交信息'), {
      target: { value: 'feat: add status panel' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '提交' }));
    await waitFor(() =>
      expect(runtime.gitCommit).toHaveBeenCalledWith({
        root: 'D:/project',
        message: 'feat: add status panel',
        includeUnstaged: true,
        push: false,
      }),
    );
  });

  it('focuses a long Progress list and exposes folded rows on hover', () => {
    const longTodo: TodoProjection = {
      items: Array.from({ length: 8 }, (_, index) => ({
        title: `步骤 ${index + 1}`,
        status: index < 4 ? 'completed' : index === 4 ? 'in_progress' : 'pending',
      })),
      completed: 4,
      total: 8,
      running: true,
    };
    render(<TaskStatusPanel todo={longTodo} />);

    expect(screen.getAllByTestId('task-progress-item')).toHaveLength(3);
    const before = screen.getByTestId('task-progress-fold-before');
    fireEvent.mouseEnter(before);
    expect(screen.getByRole('tooltip').textContent).toContain('步骤 1');
    expect(screen.getByRole('tooltip').textContent).toContain('步骤 3');
  });

  it('opens the task checklist when a live plan first appears', async () => {
    render(<TaskStatusPanel todo={todo} />);

    await waitFor(() => {
      expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBe('true');
    });
    expect(screen.getAllByText('实现落子逻辑')).toHaveLength(2);
  });

  it('opens a newly delivered checklist even when the run terminal event arrived in the same batch', async () => {
    render(<TaskStatusPanel todo={{ ...todo, running: false }} />);

    await waitFor(() => {
      expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBe('true');
    });
    expect(screen.getByText('任务清单')).toBeTruthy();
  });

  it('opens when a checklist appears later and does not reopen after the user closes it', async () => {
    const { rerender } = render(<TaskStatusPanel todo={null} />);
    expect(screen.queryByTestId('task-status-panel')).toBeNull();

    rerender(<TaskStatusPanel todo={todo} />);
    await waitFor(() => {
      expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: '关闭任务状态' }));
    expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBeNull();

    rerender(
      <TaskStatusPanel
        todo={{
          ...todo,
          completed: 2,
          items: todo.items.map((item, index) =>
            index === 1 ? { ...item, status: 'completed' as const } : item,
          ),
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBeNull();
    });
  });

  it('auto-opens once per conversation scope without resetting during a temporary clear', async () => {
    const nextTodo: TodoProjection = {
      ...todo,
      items: [
        { title: '检查新一轮', status: 'in_progress' },
        { title: '完成新一轮', status: 'pending' },
      ],
      completed: 0,
      total: 2,
    };
    const { rerender } = render(<TaskStatusPanel scopeKey="conversation-a" todo={todo} />);

    await waitFor(() => {
      expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBe('true');
    });
    fireEvent.click(screen.getByRole('button', { name: '关闭任务状态' }));

    rerender(<TaskStatusPanel scopeKey="conversation-a" todo={null} />);
    expect(screen.queryByTestId('task-status-panel')).toBeNull();
    rerender(<TaskStatusPanel scopeKey="conversation-a" todo={nextTodo} />);
    expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBeNull();

    rerender(<TaskStatusPanel scopeKey="conversation-b" todo={nextTodo} />);
    await waitFor(() => {
      expect(screen.getByTestId('task-status-panel').getAttribute('data-manual-open')).toBe('true');
    });
  });

  it('renders nothing when Git, Goal and Progress have no real data', async () => {
    runtime.getGitInfo.mockResolvedValue({
      branch: null,
      branches: [],
      changes: [],
      recentCommits: [],
      additions: 0,
      deletions: 0,
      ahead: 0,
      behind: 0,
      hasRemote: false,
      isRepo: false,
    });
    const { container } = render(<TaskStatusPanel projectFolder="D:/not-a-repo" />);
    await waitFor(() => expect(runtime.getGitInfo).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
