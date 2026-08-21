/**
 * @vitest-environment jsdom
 *
 * InlineProcessFlow renders one DSH-style ordered execution timeline: Think is
 * a compact expandable row, every tool call owns one row, and commentary or
 * status events keep their original positions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { InlineProcessItem } from './ChatView.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';

const reasoningItem: InlineProcessItem = {
  kind: 'reasoning',
  text: '第一行摘要\n第二行细节',
  status: 'completed',
};
const textItem: InlineProcessItem = { kind: 'text', text: '我先检查 **项目结构**。' };
const commentaryItem: InlineProcessItem = { kind: 'commentary', text: '（内部注释）' };
const toolItem: InlineProcessItem = {
  kind: 'tool',
  toolCallId: 'tool-read-a',
  name: 'read_file',
  argumentsJson: '{"path":"a.txt"}',
  result: 'a.txt: 1 line',
  status: 'completed',
};
const secondReadTool: InlineProcessItem = {
  ...toolItem,
  toolCallId: 'tool-read-b',
  argumentsJson: '{"path":"b.txt"}',
  result: 'b.txt: 2 lines',
};
const runningTool: InlineProcessItem = {
  kind: 'tool',
  toolCallId: 'tool-running',
  name: 'run_command',
  argumentsJson: '{"command":"pnpm","args":["-s","test"]}',
  status: 'running',
};
const failedToolItem: InlineProcessItem = {
  kind: 'tool',
  toolCallId: 'tool-failed',
  name: 'run_command',
  argumentsJson: '{}',
  result: 'boom',
  failed: true,
  status: 'failed',
};

function follows(left: Element, right: Element): boolean {
  return Boolean(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('InlineProcessFlow', () => {
  afterEach(cleanup);

  it('renders nothing when there are no items', () => {
    const { container } = render(<InlineProcessFlow items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps every process row in one panel while the final answer stays outside', () => {
    render(
      <>
        <InlineProcessFlow
          items={[reasoningItem, textItem, commentaryItem, toolItem]}
          defaultOpen
        />
        <div data-testid="final-answer">最终总结</div>
      </>,
    );

    const panel = screen.getByTestId('process-panel');
    expect(within(panel).getByTestId('inline-process-reasoning')).toBeTruthy();
    expect(within(panel).getByTestId('inline-process-text')).toBeTruthy();
    expect(within(panel).getByTestId('inline-process-commentary')).toBeTruthy();
    expect(within(panel).getByTestId('inline-process-tool')).toBeTruthy();
    expect(within(panel).queryByTestId('final-answer')).toBeNull();
    expect(screen.getByTestId('final-answer').textContent).toBe('最终总结');
  });

  it('opens while running and collapses when the final answer starts or the run ends', () => {
    const { rerender } = render(
      <InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming />,
    );
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');

    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming answerStarted />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');

    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-b" streaming />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');

    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-b" streaming={false} />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the total run elapsed time in the panel header', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem, toolItem]}
        startedAt="2026-08-16T10:00:00.000Z"
        completedAt="2026-08-16T10:01:08.000Z"
      />,
    );

    const toggle = screen.getByTestId('process-panel-toggle');
    expect(toggle.textContent).toContain('2 项');
    expect(toggle.textContent).toContain('1分8秒');
  });

  it('preserves a manual panel choice for the current run and resets it for a new run', () => {
    const { rerender } = render(
      <InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming />,
    );
    const toggle = screen.getByTestId('process-panel-toggle');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming answerStarted />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming={false} />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');

    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-b" streaming={false} />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('renders reasoning, markdown, commentary and tools in durable order', () => {
    render(
      <InlineProcessFlow items={[reasoningItem, textItem, commentaryItem, toolItem]} defaultOpen />,
    );
    const reasoning = screen.getByTestId('inline-process-reasoning');
    const text = screen.getByTestId('inline-process-text');
    const commentary = screen.getByTestId('inline-process-commentary');
    const tool = screen.getByTestId('inline-process-tool');

    expect(follows(reasoning, text)).toBe(true);
    expect(follows(text, commentary)).toBe(true);
    expect(follows(commentary, tool)).toBe(true);
    expect(text.querySelector('strong')?.textContent).toBe('项目结构');
    expect(screen.queryByTestId('tool-batch')).toBeNull();
  });

  it('numbers process rows in durable order and identifies the tool kind', () => {
    render(
      <InlineProcessFlow items={[reasoningItem, commentaryItem, toolItem]} defaultOpen />,
    );

    const entries = screen.getAllByTestId('process-entry');
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => within(entry).getByTestId('process-entry-index').textContent)).toEqual([
      '01',
      '02',
      '03',
    ]);
    expect(
      within(entries[2]).getByTestId('process-tool-kind').getAttribute('data-kind'),
    ).toBe('read');
  });

  it('shows the turn plan before the timeline and only exposes real agent tasks', () => {
    const turnPlan = {
      items: [
        { title: '确认执行入口', status: 'completed' as const },
        { title: '实现过程面板', status: 'in_progress' as const },
        { title: '完成回归验证', status: 'pending' as const },
      ],
      completed: 1,
      total: 3,
    };
    const { rerender } = render(
      <InlineProcessFlow items={[toolItem]} turnPlan={turnPlan} defaultOpen />,
    );

    const plan = screen.getByTestId('process-turn-plan');
    const timeline = screen.getByTestId('inline-process-flow');
    expect(follows(plan, timeline)).toBe(true);
    expect(plan.textContent).toContain('本轮计划');
    expect(plan.textContent).toContain('1/3');
    expect(within(plan).getByText('实现过程面板').closest('li')?.dataset.status).toBe(
      'in_progress',
    );
    expect(screen.queryByTestId('process-agent-tasks')).toBeNull();

    rerender(
      <InlineProcessFlow
        items={[toolItem]}
        turnPlan={turnPlan}
        agentTaskContent={<div>审查持久会话实现</div>}
        defaultOpen
      />,
    );
    expect(screen.getByTestId('process-agent-tasks').textContent).toContain(
      '审查持久会话实现',
    );
  });

  it('keeps repeated adjacent tool calls as separate rows without count badges', () => {
    render(<InlineProcessFlow items={[toolItem, secondReadTool]} defaultOpen />);
    const tools = screen.getAllByTestId('inline-process-tool');

    expect(tools).toHaveLength(2);
    expect(tools[0].textContent).toContain('a.txt');
    expect(tools[1].textContent).toContain('b.txt');
    expect(screen.queryByText(/×2|2 个调用/)).toBeNull();
    expect(screen.queryByTestId('tool-batch')).toBeNull();
  });

  it('expands and collapses all available row details from the panel toolbar', () => {
    render(
      <InlineProcessFlow items={[reasoningItem, toolItem, secondReadTool]} defaultOpen />,
    );

    expect(screen.queryByTestId('think-row-body')).toBeNull();
    expect(document.querySelectorAll('.shell-inline-process__tool-body')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));
    expect(screen.getByTestId('think-row-body')).toBeTruthy();
    expect(document.querySelectorAll('.shell-inline-process__tool-body')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '全部收起' }));
    expect(screen.queryByTestId('think-row-body')).toBeNull();
    expect(document.querySelectorAll('.shell-inline-process__tool-body')).toHaveLength(0);
  });

  it('shows a friendly tool name and key input, then reveals raw details in place', () => {
    render(<InlineProcessFlow items={[toolItem]} defaultOpen />);
    const tool = screen.getByTestId('inline-process-tool');

    expect(tool.textContent).toContain('读取文件');
    expect(tool.textContent).toContain('a.txt');
    expect(within(tool).getByTestId('inline-process-tool-status').getAttribute('data-status')).toBe(
      'completed',
    );
    expect(tool.textContent).not.toContain('read_file');

    fireEvent.click(within(tool).getByRole('button'));
    expect(tool.textContent).toContain('原始工具');
    expect(tool.textContent).toContain('read_file');
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('a.txt: 1 line');
  });

  it('renders JSON arguments and results as structured key-value details', () => {
    render(
      <InlineProcessFlow
        items={[
          {
            ...toolItem,
            argumentsJson:
              '{"path":"a.txt","line":2,"options":{"encoding":"utf8"}}',
            result: '{"ok":true,"lines":1}',
          },
        ]}
        defaultOpen
      />,
    );

    fireEvent.click(within(screen.getByTestId('inline-process-tool')).getByRole('button'));
    const argumentsView = screen.getByTestId('inline-process-tool-arguments');
    expect(within(argumentsView).getByText('path')).toBeTruthy();
    expect(within(argumentsView).getByText('a.txt')).toBeTruthy();
    expect(within(argumentsView).getByText('line')).toBeTruthy();
    expect(within(argumentsView).getByText('2')).toBeTruthy();
    expect(within(argumentsView).getByText('options')).toBeTruthy();
    expect(argumentsView.textContent).toContain('encoding');

    const resultView = screen.getByTestId('inline-process-tool-result');
    expect(within(resultView).getByText('ok')).toBeTruthy();
    expect(within(resultView).getByText('true')).toBeTruthy();
    expect(within(resultView).getByText('lines')).toBeTruthy();
  });

  it('collapses Think to one summary line and expands the full Markdown body', () => {
    render(<InlineProcessFlow items={[reasoningItem]} defaultOpen />);
    const summary = screen.getByTestId('think-row-summary');

    expect(summary.textContent).toBe('第一行摘要');
    expect(summary.textContent).not.toContain('第二行细节');
    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(screen.getByTestId('think-row-body').textContent).toContain('第二行细节');
  });

  it('strips Markdown markers from the collapsed Think summary', () => {
    render(
      <InlineProcessFlow
        items={[{ ...reasoningItem, text: '**分析字段匹配**\n\n先确认 `toolName` 的形态。' }]}
        defaultOpen
      />,
    );
    // 折叠行是纯文本节点：Markdown 不会被渲染，只会漏出 ** 噪声。
    expect(screen.getByTestId('think-row-summary').textContent).toBe('分析字段匹配');
  });

  it('does not repeat a heading first line inside the expanded Think body', () => {
    render(
      <InlineProcessFlow
        items={[{ ...reasoningItem, text: '**分析字段匹配**\n\n先确认 toolName 的形态。' }]}
        defaultOpen
      />,
    );

    fireEvent.click(screen.getByTestId('think-row-toggle'));
    const body = screen.getByTestId('think-row-body');
    expect(body.textContent).toContain('先确认 toolName 的形态。');
    expect(body.textContent).not.toContain('分析字段匹配');
  });

  it('keeps the collapsed Think row closed when the thought is only a heading', () => {
    render(<InlineProcessFlow items={[{ ...reasoningItem, text: '**只有标题**' }]} defaultOpen />);

    expect(screen.getByTestId('think-row-summary').textContent).toBe('只有标题');
    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(screen.queryByTestId('think-row-body')).toBeNull();
  });

  it('uses the latest non-empty Think line while reasoning is streaming', () => {
    render(
      <InlineProcessFlow
        items={[{ ...reasoningItem, text: '旧摘要\n\n当前进度', status: 'streaming' }]}
        streaming
        defaultOpen
      />,
    );
    expect(screen.getByTestId('think-row-summary').textContent).toBe('当前进度');
  });

  it('does not render Markdown typing cursors inside the ordered process flow', () => {
    const { container } = render(
      <InlineProcessFlow
        items={[
          { ...reasoningItem, status: 'streaming' },
          { ...textItem, status: 'completed' },
          { ...commentaryItem, status: 'streaming' },
        ]}
        streaming
        defaultOpen
      />,
    );

    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(container.querySelector('.shell-md-cursor')).toBeNull();
  });

  it('shows running, completed and failed tool states independently', () => {
    render(<InlineProcessFlow items={[runningTool, toolItem, failedToolItem]} defaultOpen />);
    const tools = screen.getAllByTestId('inline-process-tool');

    expect(within(tools[0]).getByTestId('inline-process-tool-status').getAttribute('data-status')).toBe('running');
    expect(within(tools[1]).getByTestId('inline-process-tool-status').getAttribute('data-status')).toBe('completed');
    expect(within(tools[2]).getByTestId('inline-process-tool-status').getAttribute('data-status')).toBe('failed');
    expect(tools[2].getAttribute('data-failed')).toBe('true');

    fireEvent.click(within(tools[2]).getByRole('button'));
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('boom');
  });

  it('shows the sync-thinking pulse while streaming before the final answer, hides it after', () => {
    const { rerender } = render(
      <InlineProcessFlow items={[runningTool]} streaming defaultOpen />,
    );
    expect(screen.getByTestId('process-thinking').textContent).toContain('sync-thinking');

    rerender(
      <InlineProcessFlow items={[runningTool]} streaming answerStarted defaultOpen />,
    );
    expect(screen.queryByTestId('process-thinking')).toBeNull();

    rerender(<InlineProcessFlow items={[runningTool]} defaultOpen />);
    expect(screen.queryByTestId('process-thinking')).toBeNull();
  });

  it('shows elapsed time in the expanded details for one tool call', () => {
    render(
      <InlineProcessFlow
        items={[
          {
            ...toolItem,
            startedAt: '2026-08-16T10:00:00.000Z',
            completedAt: '2026-08-16T10:00:02.000Z',
          },
        ]}
        defaultOpen
      />,
    );
    const tool = screen.getByTestId('inline-process-tool');
    fireEvent.click(within(tool).getByRole('button'));
    expect(tool.querySelector('.shell-inline-process__tool-body')?.textContent).toContain('2.0s');
  });

  it('keeps a completed tool duration visible on the collapsed row', () => {
    render(
      <InlineProcessFlow
        items={[
          {
            ...toolItem,
            startedAt: '2026-08-16T10:00:00.000Z',
            completedAt: '2026-08-16T10:00:02.000Z',
          },
        ]}
        defaultOpen
      />,
    );

    expect(screen.getByTestId('inline-process-tool-elapsed').textContent).toBe('2.0s');
  });

  it('names the running tool in the header so a collapsed panel still says what is happening', () => {
    render(
      <InlineProcessFlow items={[toolItem, runningTool]} runId="run-a" streaming answerStarted />,
    );

    const toggle = screen.getByTestId('process-panel-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const activity = screen.getByTestId('process-panel-activity');
    expect(activity.getAttribute('data-kind')).toBe('tool');
    expect(activity.textContent).toContain('运行命令 pnpm -s test');
  });

  it('shows the full command line — not just the executable — on the tool row', () => {
    // {command,args[]} 只读 command 会把「pnpm -s test」显示成「pnpm」，
    // 等于看不出在跑什么。
    render(<InlineProcessFlow items={[runningTool]} defaultOpen />);
    expect(screen.getByTestId('inline-process-tool').textContent).toContain('pnpm -s test');
  });

  it('falls back to a waiting label before the first provider output arrives', () => {
    render(<InlineProcessFlow items={[toolItem]} runId="run-a" streaming />);
    const activity = screen.getByTestId('process-panel-activity');

    expect(activity.getAttribute('data-kind')).toBe('waiting');
    expect(activity.textContent).toContain('等待模型响应');
  });

  it('drops the activity summary once the run reaches a terminal state', () => {
    const { rerender } = render(
      <InlineProcessFlow items={[runningTool]} runId="run-a" streaming />,
    );
    expect(screen.queryByTestId('process-panel-activity')).toBeTruthy();

    rerender(<InlineProcessFlow items={[runningTool]} runId="run-a" streaming={false} />);
    expect(screen.queryByTestId('process-panel-activity')).toBeNull();
  });

  it('counts up elapsed time on a running tool row and freezes it once completed', () => {
    vi.useFakeTimers();
    try {
      const startedAt = new Date(Date.now() - 8_000).toISOString();
      const { rerender } = render(
        <InlineProcessFlow
          items={[{ ...runningTool, startedAt }]}
          runId="run-a"
          streaming
          defaultOpen
        />,
      );
      expect(screen.getByTestId('inline-process-tool-elapsed').textContent).toBe('8s');

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(screen.getByTestId('inline-process-tool-elapsed').textContent).toBe('11s');

      // 终态耗时冻结在主行，便于不展开就比较各步骤耗时。
      rerender(
        <InlineProcessFlow
          items={[
            {
              ...runningTool,
              startedAt,
              completedAt: new Date().toISOString(),
              status: 'completed',
              result: 'ok',
            },
          ]}
          runId="run-a"
          streaming={false}
          defaultOpen
        />,
      );
      expect(screen.getByTestId('inline-process-tool-elapsed').textContent).toBe('11s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a tool row mounted and its details open while it flips to completed', () => {
    // §12.17.17：running → completed 原位翻转不得重挂载，也不得丢掉展开选择。
    const { rerender } = render(
      <InlineProcessFlow items={[runningTool]} runId="run-a" streaming defaultOpen />,
    );
    fireEvent.click(within(screen.getByTestId('inline-process-tool')).getByRole('button'));
    const before = screen.getByTestId('inline-process-tool');
    expect(before.querySelector('.shell-inline-process__tool-body')).toBeTruthy();

    rerender(
      <InlineProcessFlow
        items={[{ ...runningTool, status: 'completed', result: 'done' }]}
        runId="run-a"
        streaming
        defaultOpen
      />,
    );
    const after = screen.getByTestId('inline-process-tool');
    expect(after).toBe(before);
    expect(after.querySelector('.shell-inline-process__tool-body')).toBeTruthy();
  });

  it('shows the latest output line of a running tool and hides it when finished', () => {
    const { rerender } = render(
      <InlineProcessFlow
        items={[{ ...runningTool, progressLine: 'compiling @sync-think/ui-kit' }]}
        defaultOpen
      />,
    );
    expect(screen.getByTestId('inline-process-tool-progress').textContent).toBe(
      'compiling @sync-think/ui-kit',
    );

    rerender(
      <InlineProcessFlow
        items={[
          {
            ...runningTool,
            progressLine: 'compiling @sync-think/ui-kit',
            status: 'completed',
            result: 'ok',
          },
        ]}
        defaultOpen
      />,
    );
    expect(screen.queryByTestId('inline-process-tool-progress')).toBeNull();
  });

  it('marks a failed tool with a cross rather than a status word', () => {
    render(<InlineProcessFlow items={[failedToolItem]} defaultOpen />);
    const status = screen.getByTestId('inline-process-tool-status');

    expect(status.getAttribute('data-status')).toBe('failed');
    expect(status.getAttribute('title')).toBe('失败');
    expect(status.getAttribute('aria-label')).toBe('失败');
    expect(status.textContent).toBe('');
    expect(screen.getByTestId('inline-process-tool').textContent).not.toContain('失败');
  });

  it('renders status events as their own lightweight row', () => {
    const status: InlineProcessItem = {
      kind: 'status',
      statusType: 'retry',
      label: '正在重试当前模型（1/2）',
      detail: 'timeout',
    };
    render(<InlineProcessFlow items={[commentaryItem, status, runningTool]} defaultOpen />);

    const commentary = screen.getByTestId('inline-process-commentary');
    const statusRow = screen.getByTestId('inline-process-status');
    const tool = screen.getByTestId('inline-process-tool');
    expect(statusRow.textContent).toContain('正在重试当前模型（1/2）');
    expect(statusRow.textContent).toContain('timeout');
    expect(follows(commentary, statusRow)).toBe(true);
    expect(follows(statusRow, tool)).toBe(true);
  });

  it('keeps legacy process steps as one tool row per call when no ordered tools exist', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem]}
        steps={[
          {
            id: 'step-1',
            label: 'read_file',
            verb: 'Read',
            zh: '读取文件',
            toolName: 'read_file',
            kind: 'file',
            status: 'done',
            preview: 'a',
            sequence: 11,
          } as never,
          {
            id: 'step-2',
            label: 'read_file',
            verb: 'Read',
            zh: '读取文件',
            toolName: 'read_file',
            kind: 'file',
            status: 'done',
            preview: 'b',
            sequence: 12,
          } as never,
        ]}
        commentarySegments={[
          {
            id: 'seg-1',
            text: '我先读取文件。',
            startedAt: '2026-08-16T10:00:00.000Z',
            afterSequence: 10,
          },
        ]}
        defaultOpen
      />,
    );

    const commentary = screen.getByTestId('inline-process-commentary');
    const tools = screen.getAllByTestId('inline-process-tool');
    expect(tools).toHaveLength(2);
    expect(follows(commentary, tools[0])).toBe(true);
    expect(follows(tools[0], tools[1])).toBe(true);
    expect(screen.queryByTestId('tool-batch')).toBeNull();
  });
});
