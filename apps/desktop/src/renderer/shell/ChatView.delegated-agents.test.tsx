/**
 * Render coverage for the parent-scoped delegated child Agent cards.
 *
 * These components used to live only inside ChatView, so the collaboration
 * surface had no render test: identity, status labels, the 20-row tool-log
 * fold, stop actions and parallel groups were all unverified in the UI.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Message } from '@sync-think/shared';
import type { DelegatedAgentProjection } from '@sync-think/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DelegatedAgentTasks,
  InlineDelegatedAgentTask,
  messageToChat,
  type InlineProcessItem,
} from './ChatView.js';

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
    kind: 'existing',
    agentId: 'agent-child',
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
  it('restores a settled background child from parent message metadata', () => {
    const message = messageToChat({
      id: 'asst-parent',
      threadId: 'thread-1',
      role: 'assistant',
      runId: 'run-parent',
      sequence: 1,
      createdAt: '2026-09-19T00:00:00.000Z',
      blocks: [
        {
          type: 'text',
          text: '子任务已在后台运行。',
          payload: {
            delegatedAgents: [
              delegatedTask({
                childRunId: childId('child-restored'),
                status: 'completed',
                result: '审查完成。',
                toolEvents: [{ toolName: 'Read', status: 'completed', output: 'runtime.ts' }],
              }),
            ],
          },
        },
      ],
    } as Message);

    expect(message.delegatedAgents).toHaveLength(1);
    expect(message.delegatedAgents?.[0]).toMatchObject({
      childRunId: 'child-restored',
      status: 'completed',
      result: '审查完成。',
    });
    expect(message.delegatedAgents?.[0]?.toolEvents).toEqual([
      { toolName: 'Read', status: 'completed', output: 'runtime.ts' },
    ]);
  });

  it('renders nothing when the parent turn delegated no work', () => {
    const { container } = renderTasks({});
    expect(container.querySelector('.shell-delegated-agent-list')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows the Agent avatar and name without exposing its internal id', () => {
    renderTasks({
      delegatedAgents: [
        delegatedTask({
          kind: 'existing',
          agentId: 'agent-code-reviewer',
          name: '代码审查 Agent',
          avatar: '代码',
          status: 'completed',
        }),
      ],
    });

    expect(screen.getByText('代码审查 Agent')).toBeTruthy();
    expect(screen.queryByText('已有 Agent')).toBeNull();
    expect(screen.queryByText('agent-code-reviewer')).toBeNull();
    expect(screen.getByLabelText('已完成')).toBeTruthy();
    const avatar = screen.getByRole('img', { name: '代码审查 Agent' });
    expect(avatar.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('ignores a legacy temporary assignment without an existing Agent id', () => {
    const { container } = renderTasks({
      items: [
        {
          kind: 'tool',
          name: 'agent_delegate',
          argumentsJson: '{}',
          result: JSON.stringify({
            childRunId: 'legacy-child',
            status: 'completed',
            assignment: { name: '旧临时 Agent', kind: 'temporary' },
          }),
        },
      ],
    });

    expect(container.querySelector('.shell-delegated-agent-list')).toBeNull();
    expect(screen.queryByText('临时 Agent')).toBeNull();
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

    for (const label of ['运行中', '已完成', '失败', '已取消', '已超时']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    // One status glyph per card, each labelled for screen readers.
    expect(container.querySelectorAll('.shell-delegated-agent__status').length).toBe(5);
  });

  it('shows authoritative status observation diagnostics on a delegated card', () => {
    renderTasks({
      delegatedAgents: [
        delegatedTask({ status: 'completed', statusObservation: { source: 'query', diagnostic: 'completed_unnotified', observedAt: '2026-01-01T00:00:00Z', probeCount: 1 } }),
      ],
    });
    expect(screen.getByText('已完成，通知延迟')).toBeTruthy();
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

  it('shows a visible cancellation state and explains that execution records remain', () => {
    const { container } = renderTasks({
      delegatedAgents: [
        delegatedTask({
          childRunId: childId('child-cancelled'),
          name: '代码审查员',
          status: 'cancelled',
          toolEvents: [{ toolName: 'read_file', status: 'completed' }],
        }),
      ],
    });

    expect(screen.getByText('已取消')).toBeTruthy();
    const card = container.querySelector('details.shell-delegated-agent');
    expect(card).toBeTruthy();
    fireEvent.click(card!.querySelector('summary')!);
    expect(screen.getByText('任务已由用户停止，执行记录已保留。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '停止当前子任务' })).toBeNull();
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
    expect(screen.queryByText('已有 Agent')).toBeNull();
    expect(screen.getByLabelText('失败')).toBeTruthy();
    expect(screen.getByText('找不到登录入口文件')).toBeTruthy();
    expect(container.querySelectorAll('.shell-delegated-agent__tool').length).toBe(1);
    // The child's tool rows use the same surface as the parent's own rows:
    // friendly name in the header, and 参数 / 输出 detail blocks once expanded —
    // not a raw `<code>`/`<pre>` JSON dump.
    const row = screen.getByTestId('delegated-agent-tool');
    expect(within(row).getByText('Rg')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button'));
    expect(within(row).getByTestId('inline-process-tool-arguments')).toBeTruthy();
    expect(within(row).getByTestId('inline-process-tool-result')).toBeTruthy();
    expect(within(row).getByText('rg')).toBeTruthy();
    expect(screen.queryByText('agent-explorer')).toBeNull();
  });

  it('keeps a command row when the delegated tool returned no output', () => {
    renderTasks({
      items: [
        {
          kind: 'tool',
          name: 'agent_run',
          argumentsJson: '{}',
          result: JSON.stringify({
            childRunId: 'child-command-without-output',
            status: 'running',
            assignment: {
              name: '代码审查员',
              kind: 'existing',
              agentId: 'builtin-code-reviewer',
            },
            toolEvents: [
              {
                toolName: 'command_execution',
                status: 'completed',
                arguments: JSON.stringify({
                  command: 'pnpm test --filter runtime',
                  cwd: 'D:\\projects\\SYNC-THINK',
                }),
              },
            ],
          }),
        },
      ],
    });

    const row = screen.getByTestId('delegated-agent-tool');
    expect(within(row).getByText('命令执行')).toBeTruthy();
    expect(within(row).getByText('pnpm test --filter runtime')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button'));
    expect(within(row).queryByText(/工具调用未返回/)).toBeNull();
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
          assignment: { name: '持久名称', kind: 'existing', agentId: 'agent-persistent' },
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
    expect(screen.queryByText('agent-persistent')).toBeNull();
  });

  it('rebuilds a card from the durable agent_run tool result', () => {
    // `agent_run` (agent-library MCP) delegates to an existing Agent through the
    // same child run as `agent_delegate`. Without this the card survived only
    // while the live projection lived, then disappeared once the run settled.
    const items: InlineProcessItem[] = [
      {
        kind: 'tool',
        name: 'agent_run',
        argumentsJson: '{}',
        result: JSON.stringify({
          childRunId: 'child-agent-run',
          status: 'completed',
          result: '审查完成，未发现阻塞项。',
          assignment: {
            name: '代码审查员',
            avatar: '🎯',
            kind: 'existing',
            agentId: 'builtin-code-reviewer',
          },
          toolEvents: [
            { toolName: 'Read', status: 'completed', arguments: '{}', output: 'service.ts' },
            { toolName: 'Grep', status: 'completed', arguments: '{}', output: '3 matches' },
          ],
        }),
      },
    ];

    const { container } = renderTasks({ items });

    expect(screen.getByText('代码审查员')).toBeTruthy();
    expect(screen.getByLabelText('已完成')).toBeTruthy();
    expect(screen.getByText('审查完成，未发现阻塞项。')).toBeTruthy();
    expect(screen.queryByText('builtin-code-reviewer')).toBeNull();
    expect(container.querySelector('details.shell-delegated-agent')?.hasAttribute('open')).toBe(
      true,
    );
    // The child's own tool calls stay visible after the run ended, rendered with
    // the shared tool-row surface (friendly names + 参数/输出 detail blocks).
    expect(container.querySelectorAll('.shell-delegated-agent__tool').length).toBe(2);
    const rows = screen.getAllByTestId('delegated-agent-tool');
    expect(within(rows[0]!).getByText('读取文件')).toBeTruthy();
    expect(within(rows[1]!).getByText('搜索内容')).toBeTruthy();
    fireEvent.click(within(rows[0]!).getByRole('button'));
    expect(within(rows[0]!).getByTestId('inline-process-tool-arguments')).toBeTruthy();
    expect(within(rows[0]!).getByTestId('inline-process-tool-result')).toBeTruthy();
  });

  it('unwraps the host MCP envelope and recognizes the fully qualified tool name', () => {
    // Persisted platform MCP results use the real host envelope, not a bare
    // content-block array. The timeline also retains the fully qualified name.
    const payload = JSON.stringify({
      ok: true,
      childRunId: 'child-block-wrapped',
      status: 'completed',
      assignment: { name: '代码审查员', kind: 'existing', agentId: 'builtin-code-reviewer' },
      toolEvents: [],
      result: '结论：未发现阻塞项。',
    });
    renderTasks({
      items: [
        {
          kind: 'tool',
          name: 'mcp__sync-think-platform__agent_run',
          argumentsJson: '{}',
          result: JSON.stringify({
            content: [{ type: 'text', text: payload }],
            structuredContent: null,
            _meta: null,
          }),
        },
      ],
    });

    expect(screen.getByText('代码审查员')).toBeTruthy();
    expect(screen.getByText('结论：未发现阻塞项。')).toBeTruthy();
  });

  it('renders no card for a kernel-truncated result envelope', () => {
    // Historical runs whose payload exceeded the kernel limit came back as an
    // envelope; there is no payload to read, so the card must stay absent rather
    // than throw. Bounding the payload is what prevents this going forward.
    const { container } = renderTasks({
      items: [
        {
          kind: 'tool',
          name: 'agent_run',
          argumentsJson: '{}',
          result:
            '<persisted-output>\nOutput too large (60KB). Full output saved to: C:\\tmp\\x.json\n\nPreview (first 2KB):\n[',
        },
      ],
    });

    expect(container.querySelector('.shell-delegated-agent-list')).toBeNull();
  });

  it('shows the child run spend on the card itself', () => {
    // A delegated run bills separately from its parent, so the numbers have to be
    // on the card — readable without expanding it.
    renderTasks({
      delegatedAgents: [
        delegatedTask({
          childRunId: childId('child-metered'),
          name: '代码审查员',
          status: 'running',
          usage: {
            tokensIn: 4_200,
            tokensOut: 1_100,
            cachedTokensHit: 8_100,
            cachedTokensCreated: 2_000,
          },
          durationMs: 64_000,
        }),
      ],
    });

    const usage = screen.getByTestId('delegated-agent-usage');
    expect(usage.textContent).toBe('5.3k tokens · 缓存读 8.1k · 缓存写 2k · 1m 4s');
  });

  it('shows the spend carried by a durable result, and omits it when unknown', () => {
    renderTasks({
      items: [
        {
          kind: 'tool',
          name: 'agent_run',
          argumentsJson: '{}',
          result: JSON.stringify({
            childRunId: 'child-metered-durable',
            status: 'completed',
            assignment: { name: '代码审查员', kind: 'existing', agentId: 'builtin-code-reviewer' },
            toolEvents: [],
            usage: { tokensIn: 900, tokensOut: 100 },
          }),
        },
      ],
    });

    expect(screen.getByTestId('delegated-agent-usage').textContent).toBe('1k tokens');
  });

  it('renders no usage chip when the child reported none', () => {
    renderTasks({
      delegatedAgents: [delegatedTask({ childRunId: childId('child-unmetered') })],
    });

    expect(screen.queryByTestId('delegated-agent-usage')).toBeNull();
  });

  it('anchors a running delegation inline by the tool call that spawned it', () => {
    // No durable result yet: the parent tool row carries no childRunId, so the
    // only link is `parentToolCallId`. Without it the card rendered nowhere
    // inline and piled up in the panel's fallback list until the child finished.
    const runningRow: InlineProcessItem = {
      kind: 'tool',
      name: 'agent_run',
      toolCallId: 'toolu_delegate_1',
      argumentsJson: '{"agentId":"builtin-code-reviewer","task":"审查最近变更"}',
      status: 'running',
    };

    render(
      <InlineDelegatedAgentTask
        item={runningRow}
        delegatedAgents={[
          delegatedTask({
            childRunId: childId('child-running'),
            parentToolCallId: 'toolu_delegate_1',
            agentId: 'builtin-code-reviewer',
            name: '代码审查员',
            status: 'running',
          }),
        ]}
      />,
    );

    expect(screen.getByText('代码审查员')).toBeTruthy();
    expect(screen.getByLabelText('运行中')).toBeTruthy();
    expect(screen.queryByText('builtin-code-reviewer')).toBeNull();
  });

  it('does not anchor a running delegation to another tool row', () => {
    render(
      <InlineDelegatedAgentTask
        item={{
          kind: 'tool',
          name: 'agent_run',
          toolCallId: 'toolu_delegate_1',
          argumentsJson: '{}',
          status: 'running',
        }}
        delegatedAgents={[
          delegatedTask({
            childRunId: childId('child-other'),
            parentToolCallId: 'toolu_delegate_OTHER',
            name: '别的智能体',
          }),
        ]}
      />,
    );

    expect(screen.queryByText('别的智能体')).toBeNull();
  });
});
