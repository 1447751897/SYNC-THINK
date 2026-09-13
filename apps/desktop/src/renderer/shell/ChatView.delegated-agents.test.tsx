/**
 * Render coverage for the parent-scoped delegated child Agent cards.
 *
 * These components used to live only inside ChatView, so the collaboration
 * surface had no render test: identity, status labels, the 20-row tool-log
 * fold, stop actions and parallel groups were all unverified in the UI.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DelegatedAgentProjection } from '@sync-think/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DelegatedAgentTasks, type InlineProcessItem } from './ChatView.js';

afterEach(cleanup);

/** Branded RunId values are build-time only; tests need plain strings. */
function childId(value: string): DelegatedAgentProjection['childRunId'] {
  return value as unknown as DelegatedAgentProjection['childRunId'];
}

function delegatedTask(
  overrides: Partial<DelegatedAgentProjection> = {},
): DelegatedAgentProjection {
  return {
    childRunId: childId('child-1'),
    parentRunId: childId('run-parent'),
    name: '子任务 Agent',
    avatar: '🤖',
    kind: 'temporary',
    status: 'running',
    toolEvents: [],
    ...overrides,
  };
}

function renderTasks(options: {
  items?: readonly InlineProcessItem[];
  delegatedAgents?: readonly DelegatedAgentProjection[];
  onStopChild?: (childRunId: string) => void;
}) {
  return render(
    <DelegatedAgentTasks
      items={options.items ?? []}
      delegatedAgents={options.delegatedAgents}
      onStopChild={options.onStopChild}
    />,
  );
}

describe('DelegatedAgentTasks card', () => {
  it('renders nothing when the parent turn delegated no work', () => {
    const { container } = renderTasks({});
    expect(container.querySelector('.shell-delegated-agent-list')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('labels an existing Agent and shows its Agent Library id', () => {
    renderTasks({
      delegatedAgents: [
        delegatedTask({
          kind: 'existing',
          agentId: 'agent-code-reviewer',
          name: '代码审查 Agent',
          status: 'completed',
        }),
      ],
    });

    expect(screen.getByText('代码审查 Agent')).toBeTruthy();
    expect(screen.getByText('已有 Agent')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    const agentId = screen.getByText('agent-code-reviewer');
    expect(agentId.getAttribute('title')).toBe('Agent Library id：agent-code-reviewer');
  });

  it('labels a temporary profile and renders no id chip', () => {
    const { container } = renderTasks({
      delegatedAgents: [delegatedTask({ kind: 'temporary', status: 'completed' })],
    });

    expect(screen.getByText('临时 Agent')).toBeTruthy();
    expect(container.querySelector('.shell-delegated-agent__agent-id')).toBeNull();
    expect(screen.getByText('子任务 Agent')).toBeTruthy();
  });

  it('maps every child status to its Chinese label', () => {
    const { container } = renderTasks({
      delegatedAgents: [
        delegatedTask({ childRunId: childId('child-running'), name: '状态 A', status: 'running' }),
        delegatedTask({
          childRunId: childId('child-completed'),
          name: '状态 B',
          status: 'completed',
        }),
        delegatedTask({ childRunId: childId('child-failed'), name: '状态 C', status: 'failed' }),
        delegatedTask({
          childRunId: childId('child-cancelled'),
          name: '状态 D',
          status: 'cancelled',
        }),
        delegatedTask({
          childRunId: childId('child-timed-out'),
          name: '状态 E',
          status: 'timed_out',
        }),
      ],
    });

    const labels = [...container.querySelectorAll('.shell-delegated-agent__status')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(['运行中', '已完成', '失败', '已取消', '已超时']);
  });

  it('folds the child tool log after 20 rows and toggles it open again', () => {
    const events = Array.from({ length: 21 }, (_, index) => ({
      toolName: 'tool_' + index,
      status: 'completed' as const,
      output: 'output ' + index,
    }));
    const { container } = renderTasks({
      delegatedAgents: [delegatedTask({ toolEvents: events })],
    });

    expect(container.querySelectorAll('.shell-delegated-agent__tool').length).toBe(20);
    const toggle = screen.getByRole('button', {
      name: '展开全部 21 项工具调用（还有 1 项）',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    expect(container.querySelectorAll('.shell-delegated-agent__tool').length).toBe(21);
    const collapse = screen.getByRole('button', { name: '收起工具调用' });
    expect(collapse.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(collapse);

    expect(container.querySelectorAll('.shell-delegated-agent__tool').length).toBe(20);
    expect(screen.getByRole('button', { name: '展开全部 21 项工具调用（还有 1 项）' })).toBeTruthy();
  });

  it('keeps a short tool log whole and reports an empty one', () => {
    const { container } = renderTasks({
      delegatedAgents: [
        delegatedTask({
          childRunId: childId('child-with-tools'),
          name: '有工具的子任务',
          status: 'completed',
          toolEvents: Array.from({ length: 20 }, (_, index) => ({
            toolName: 'tool_' + index,
            status: 'completed' as const,
          })),
        }),
        delegatedTask({
          childRunId: childId('child-without-tools'),
          name: '无工具的子任务',
          status: 'completed',
        }),
      ],
    });

    expect(container.querySelectorAll('.shell-delegated-agent__tool').length).toBe(20);
    expect(screen.queryByRole('button', { name: '展开全部 20 项工具调用（还有 0 项）' })).toBeNull();
    expect(screen.getByText('本次任务没有调用工具')).toBeTruthy();
  });

  it('stops a single running child from its own card', () => {
    const onStopChild = vi.fn();
    renderTasks({ delegatedAgents: [delegatedTask({ status: 'running' })], onStopChild });

    fireEvent.click(screen.getByRole('button', { name: '停止当前子任务' }));

    expect(onStopChild).toHaveBeenCalledTimes(1);
    expect(onStopChild).toHaveBeenCalledWith('child-1');
  });

  it('offers no stop action for a finished child', () => {
    renderTasks({
      delegatedAgents: [
        delegatedTask({ childRunId: childId('child-done'), name: 'A', status: 'completed' }),
        delegatedTask({ childRunId: childId('child-cancelled'), name: 'B', status: 'cancelled' }),
      ],
      onStopChild: vi.fn(),
    });

    expect(screen.queryByRole('button', { name: '停止当前子任务' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止全部子任务' })).toBeNull();
  });

  it('stops every running sibling at once when more than one is live', () => {
    const onStopChild = vi.fn();
    renderTasks({
      delegatedAgents: [
        delegatedTask({ childRunId: childId('child-a'), name: '并行 A', status: 'running' }),
        delegatedTask({ childRunId: childId('child-b'), name: '并行 B', status: 'running' }),
        delegatedTask({ childRunId: childId('child-c'), name: '并行 C', status: 'completed' }),
      ],
      onStopChild,
    });

    fireEvent.click(screen.getByRole('button', { name: '停止全部子任务' }));

    expect(onStopChild.mock.calls.map((call) => call[0])).toEqual(['child-a', 'child-b']);
  });

  it('groups parallel siblings under one header', () => {
    const { container } = renderTasks({
      delegatedAgents: [
        delegatedTask({
          childRunId: childId('child-a'),
          name: '并行 A',
          parallelGroup: 'review',
        }),
        delegatedTask({
          childRunId: childId('child-b'),
          name: '并行 B',
          parallelGroup: 'review',
        }),
        delegatedTask({ childRunId: childId('child-c'), name: '独立 C' }),
      ],
    });

    const headers = container.querySelectorAll('.shell-delegated-agent-group__header');
    expect(headers.length).toBe(1);
    expect(headers[0]?.textContent).toContain('并行任务组：review');
    expect(headers[0]?.textContent).toContain('2 个任务');
  });

  it('rebuilds a card from the durable agent_delegate tool result', () => {
    const items: InlineProcessItem[] = [
      {
        kind: 'tool',
        name: 'agent_delegate',
        argumentsJson: '{}',
        result: JSON.stringify({
          childRunId: 'child-durable',
          status: 'failed',
          result: '找不到登录入口文件',
          parallelGroup: 'review',
          assignment: {
            name: '探索 Agent',
            avatar: '🧭',
            kind: 'existing',
            agentId: 'agent-explorer',
          },
          toolEvents: [
            { toolName: 'rg', status: 'completed', arguments: '--files', output: 'src/app.ts' },
          ],
        }),
      },
    ];

    const { container } = renderTasks({ items });

    expect(screen.getByText('探索 Agent')).toBeTruthy();
    expect(screen.getByText('已有 Agent')).toBeTruthy();
    expect(screen.getByText('失败')).toBeTruthy();
    expect(screen.getByText('找不到登录入口文件')).toBeTruthy();
    expect(container.querySelectorAll('.shell-delegated-agent__tool').length).toBe(1);
    expect(screen.getByText('rg')).toBeTruthy();
    expect(screen.getByText('agent-explorer')).toBeTruthy();
  });

  it('lets the durable assignment win over an older live projection of the same child', () => {
    const items: InlineProcessItem[] = [
      {
        kind: 'tool',
        name: 'agent_delegate',
        argumentsJson: '{}',
        result: JSON.stringify({
          childRunId: 'child-shared',
          status: 'completed',
          assignment: { name: '持久名称', kind: 'temporary' },
          toolEvents: [],
        }),
      },
    ];

    renderTasks({
      items,
      delegatedAgents: [
        delegatedTask({
          childRunId: childId('child-shared'),
          name: '实时名称',
          status: 'running',
        }),
      ],
    });

    expect(screen.getByText('持久名称')).toBeTruthy();
    expect(screen.queryByText('实时名称')).toBeNull();
  });
});
