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

  it('opens live output then folds successful results unless the user chose otherwise', () => {
    const { rerender } = render(
      <InlineProcessFlow
        items={[{ ...runningTool, result: 'first output' }]}
        defaultOpen
        streaming
      />,
    );
    expect(screen.getByTestId('inline-process-tool-details')).toBeTruthy();
    expect(screen.getByRole('button', { name: '复制输出' })).toBeTruthy();
    rerender(
      <InlineProcessFlow
        items={[{ ...runningTool, status: 'completed', result: 'done' }]}
        defaultOpen
      />,
    );
    expect(screen.queryByTestId('inline-process-tool-details')).toBeNull();
    fireEvent.click(
      screen
        .getByTestId('inline-process-tool')
        .querySelector('.shell-inline-process__tool-toggle')!,
    );
    rerender(
      <InlineProcessFlow
        items={[{ ...runningTool, status: 'completed', result: 'done again' }]}
        defaultOpen
      />,
    );
    expect(screen.getByTestId('inline-process-tool-details')).toBeTruthy();
  });

  it('folds failed results after the run finishes, and keeps them readable when opened', () => {
    render(<InlineProcessFlow items={[toolItem, failedToolItem]} answerStarted />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('inline-process-tool-result')).toBeNull();

    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    fireEvent.click(screen.getByTestId('process-action-summary-toggle'));
    const failedToggle = screen
      .getAllByTestId('inline-process-tool')
      .at(-1)
      ?.querySelector('.shell-inline-process__tool-toggle');
    expect(failedToggle?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(failedToggle!);
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('boom');
    expect(screen.getByRole('button', { name: '复制错误' })).toBeTruthy();
  });

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

  it('opens while running and automatically folds after the run finishes', () => {
    const { rerender } = render(
      <InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming />,
    );
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();

    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming answerStarted />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();

    rerender(
      <InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming={false} answerStarted />,
    );
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('inline-process-reasoning')).toBeNull();

    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();
  });

  it('requests lazy process details only when a folded panel opens', () => {
    const onPanelOpen = vi.fn();
    render(
      <InlineProcessFlow
        items={[reasoningItem]}
        runId="run-lazy"
        streaming={false}
        answerStarted
        onPanelOpen={onPanelOpen}
      />,
    );

    expect(onPanelOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    expect(onPanelOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    expect(onPanelOpen).toHaveBeenCalledTimes(1);
  });

  it('requests remaining timeline pages automatically without a next-page control', () => {
    const onLoadMoreTimeline = vi.fn();
    render(
      <InlineProcessFlow
        items={[reasoningItem]}
        runId="run-pages"
        defaultOpen
        timelineLoadState="loaded"
        timelineLoadedCount={64}
        timelineTotalSegments={157}
        timelineHasMore
        onLoadMoreTimeline={onLoadMoreTimeline}
      />,
    );

    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();
    expect(screen.queryByTestId('process-timeline-load-more')).toBeNull();
    expect(onLoadMoreTimeline).toHaveBeenCalledTimes(1);
  });

  it('shows a NewMax-style execution-process summary with the total duration', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem, toolItem]}
        startedAt="2026-08-16T10:00:00.000Z"
        completedAt="2026-08-16T10:01:08.000Z"
        answerStarted
      />,
    );

    const toggle = screen.getByTestId('process-panel-toggle');
    expect(toggle.textContent).toContain('执行过程');
    expect(toggle.textContent).toContain('1分8秒');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves a manual process-panel choice for the current run and resets on a new run', () => {
    const { rerender } = render(
      <InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming />,
    );
    const toggle = screen.getByTestId('process-panel-toggle');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    rerender(<InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming answerStarted />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    rerender(
      <InlineProcessFlow items={[reasoningItem]} runId="run-a" streaming={false} answerStarted />,
    );
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');

    rerender(
      <InlineProcessFlow items={[reasoningItem]} runId="run-b" streaming={false} answerStarted />,
    );
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('renders reasoning, markdown, commentary and tools in durable order', () => {
    render(
      <InlineProcessFlow items={[reasoningItem, textItem, commentaryItem, toolItem]} defaultOpen />,
    );
    const reasoning = screen.getByTestId('inline-process-reasoning');
    const text = screen.getByTestId('inline-process-text');
    const commentary = screen.getByTestId('inline-process-commentary');
    const tool = screen.getAllByTestId('inline-process-tool').at(-1)!;

    expect(follows(reasoning, text)).toBe(true);
    expect(follows(text, commentary)).toBe(true);
    expect(follows(commentary, tool)).toBe(true);
    expect(text.querySelector('strong')?.textContent).toBe('项目结构');
    expect(screen.queryByTestId('tool-batch')).toBeNull();
  });

  it('keeps process rows unnumbered in durable order and identifies the tool kind', () => {
    render(<InlineProcessFlow items={[reasoningItem, commentaryItem, toolItem]} defaultOpen />);

    const entries = screen.getAllByTestId('process-entry');
    expect(entries).toHaveLength(3);
    expect(screen.queryByTestId('process-entry-index')).toBeNull();
    expect(within(entries[2]).getByTestId('process-tool-kind').getAttribute('data-kind')).toBe(
      'read',
    );
  });

  it('uses the same icon box size for Think and tool rows', () => {
    render(<InlineProcessFlow items={[reasoningItem, toolItem]} defaultOpen />);

    const thinkIcon = screen
      .getByTestId('inline-process-reasoning')
      .querySelector('.shell-inline-process__row-symbol');
    const toolIcon = screen.getByTestId('process-tool-kind').querySelector('svg');

    expect(thinkIcon?.getAttribute('width')).toBe('14');
    expect(thinkIcon?.getAttribute('height')).toBe('14');
    expect(toolIcon?.getAttribute('width')).toBe('14');
    expect(toolIcon?.getAttribute('height')).toBe('14');
  });

  it('keeps Progress out of the timeline and only exposes real agent tasks', () => {
    render(
      <InlineProcessFlow
        items={[toolItem]}
        agentTaskContent={<div>审查持久会话实现</div>}
        defaultOpen
      />,
    );
    expect(screen.queryByTestId('process-turn-plan')).toBeNull();
    expect(screen.getByTestId('process-agent-tasks').textContent).toContain('审查持久会话实现');
  });

  it('keeps adjacent tool calls as independent Harness rows without a batch wrapper', () => {
    render(<InlineProcessFlow items={[toolItem, secondReadTool]} defaultOpen />);
    const tools = screen.getAllByTestId('inline-process-tool');

    expect(tools).toHaveLength(2);
    expect(tools[0].textContent).toContain('a.txt');
    expect(tools[1].textContent).toContain('b.txt');
    expect(screen.queryByTestId('tool-batch')).toBeNull();
    expect(screen.queryByText(/×2|2 个调用/)).toBeNull();
    expect(screen.getByTestId('process-action-summary').textContent).toContain('探索了 2 个文件');
  });

  it('omits bulk disclosure controls while preserving row-level expansion', () => {
    render(<InlineProcessFlow items={[reasoningItem, toolItem, secondReadTool]} defaultOpen />);

    expect(screen.queryByTestId('think-row-body')).toBeNull();
    expect(document.querySelectorAll('.shell-inline-process__tool-body')).toHaveLength(0);

    expect(screen.queryByRole('button', { name: '全部展开' })).toBeNull();
    expect(screen.queryByRole('button', { name: '全部收起' })).toBeNull();

    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(screen.getByTestId('think-row-body')).toBeTruthy();
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

  it('can hide tool calls while preserving reasoning and commentary', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem, commentaryItem, toolItem]}
        showToolUse={false}
        defaultOpen
      />,
    );

    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();
    expect(screen.getByTestId('inline-process-commentary')).toBeTruthy();
    expect(screen.queryByTestId('inline-process-tool')).toBeNull();
  });

  it('can hide Think rows from the execution process without collapsing the panel', () => {
    const onShowThinkingChange = vi.fn();
    render(
      <InlineProcessFlow
        items={[reasoningItem, commentaryItem, toolItem]}
        defaultOpen
        showThinking
        onShowThinkingChange={onShowThinkingChange}
      />,
    );

    const thinkSwitch = screen.getByRole('switch', { name: '显示 Think' });
    expect(thinkSwitch.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();

    fireEvent.click(thinkSwitch);
    expect(onShowThinkingChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('omits Think rows when showThinking is off and keeps the header switch available', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem, commentaryItem, toolItem]}
        defaultOpen
        showThinking={false}
      />,
    );

    expect(screen.queryByTestId('inline-process-reasoning')).toBeNull();
    expect(screen.getByTestId('inline-process-commentary')).toBeTruthy();
    expect(screen.getByTestId('inline-process-tool')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '显示 Think' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('shows the latest Think line on the activity row even when Think rows are hidden', () => {
    render(
      <InlineProcessFlow
        items={[
          {
            kind: 'reasoning',
            text: 'Think · Planning task tool discovery',
            status: 'streaming',
          },
        ]}
        streaming
        showThinking={false}
        defaultOpen
      />,
    );

    expect(screen.queryByTestId('inline-process-reasoning')).toBeNull();
    expect(screen.getByTestId('process-activity-label').textContent).toContain(
      'Planning task tool discovery',
    );
    expect(screen.getByTestId('process-activity-label').textContent).not.toContain('思考中');
    expect(screen.getByTestId('process-activity-label').textContent).not.toContain('等待模型响应');
  });

  it('folds a consecutive tool stretch in place while keeping Think visible', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem, toolItem, secondReadTool, runningTool]}
        defaultOpen
      />,
    );

    const summary = screen.getByTestId('process-action-summary');
    expect(summary.textContent).toContain('探索了 2 个文件');
    expect(summary.textContent).not.toContain('运行了 1 个命令');
    expect(screen.getAllByTestId('inline-process-tool')).toHaveLength(3);

    fireEvent.click(screen.getByTestId('process-action-summary-toggle'));
    expect(screen.queryByTestId('inline-process-tool')).toBeNull();
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();
    expect(screen.getByTestId('process-action-summary-toggle').getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('folds each consecutive tool stretch in place instead of one whole-turn summary', () => {
    render(
      <InlineProcessFlow
        items={[
          commentaryItem,
          toolItem,
          secondReadTool,
          reasoningItem,
          failedToolItem,
          {
            ...failedToolItem,
            toolCallId: 'tool-cmd-b',
            failed: false,
            status: 'completed',
            result: 'ok',
            argumentsJson: '{"command":"git","args":["status"]}',
          },
        ]}
        collapseExecutionProcess={false}
        answerStarted
      />,
    );

    const folds = screen.getAllByTestId('process-action-summary');
    expect(folds).toHaveLength(2);
    expect(folds[0].textContent).toContain('探索了 2 个文件');
    expect(folds[1].textContent).toContain('运行了 1 个命令');
    expect(screen.getByTestId('inline-process-commentary')).toBeTruthy();
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();
    expect(within(folds[0]).queryByTestId('inline-process-tool')).toBeNull();
    expect(within(folds[1]).queryByTestId('inline-process-tool')).toBeNull();
    expect(
      within(folds[1]).getByTestId('process-action-summary-toggle').getAttribute('aria-expanded'),
    ).toBe('false');

    fireEvent.click(within(folds[0]).getByTestId('process-action-summary-toggle'));
    fireEvent.click(within(folds[1]).getByTestId('process-action-summary-toggle'));
    expect(screen.getAllByTestId('inline-process-tool')).toHaveLength(4);
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();
    expect(
      within(folds[1]).getByTestId('process-action-summary-toggle').getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('folds a completed command stretch even before the next narrative starts', () => {
    render(
      <InlineProcessFlow
        items={[toolItem, secondReadTool]}
        streaming
        collapseExecutionProcess={false}
        runId="run-a"
      />,
    );

    expect(screen.queryByTestId('inline-process-tool')).toBeNull();
    expect(screen.getByTestId('process-action-summary-toggle').getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('folds a completed command stretch when the final answer starts', () => {
    render(
      <InlineProcessFlow
        items={[toolItem, secondReadTool]}
        streaming
        answerStarted
        collapseExecutionProcess={false}
        runId="run-a"
      />,
    );

    expect(screen.queryByTestId('inline-process-tool')).toBeNull();
    expect(screen.getByTestId('process-action-summary-toggle').getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('expands new tool calls by default without reopening a manually collapsed row', () => {
    const { rerender } = render(
      <InlineProcessFlow items={[toolItem]} toolCallExpandedByDefault defaultOpen runId="run-a" />,
    );
    expect(screen.getByTestId('inline-process-tool-details')).toBeTruthy();

    fireEvent.click(
      screen
        .getByTestId('inline-process-tool')
        .querySelector('.shell-inline-process__tool-toggle')!,
    );
    expect(screen.queryByTestId('inline-process-tool-details')).toBeNull();

    rerender(
      <InlineProcessFlow
        items={[toolItem, secondReadTool]}
        toolCallExpandedByDefault
        defaultOpen
        runId="run-a"
      />,
    );
    const tools = screen.getAllByTestId('inline-process-tool');
    expect(within(tools[0]).queryByTestId('inline-process-tool-details')).toBeNull();
    expect(within(tools[1]).getByTestId('inline-process-tool-details')).toBeTruthy();
  });

  it('shows the full execution process without a summary row when collapsing is disabled', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem, toolItem]}
        collapseExecutionProcess={false}
        answerStarted
      />,
    );

    expect(screen.queryByTestId('process-panel-toggle')).toBeNull();
    expect(screen.queryByTestId('process-action-summary')).toBeNull();
    expect(screen.getByTestId('inline-process-reasoning')).toBeTruthy();
    expect(screen.getByTestId('inline-process-tool')).toBeTruthy();
  });

  it('renders JSON arguments and results as structured key-value details', () => {
    render(
      <InlineProcessFlow
        items={[
          {
            ...toolItem,
            argumentsJson: '{"path":"a.txt","line":2,"options":{"encoding":"utf8"}}',
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
    const details = screen.getByTestId('inline-process-tool-details');
    expect(details.getAttribute('tabindex')).toBe('0');
    expect(details.getAttribute('aria-label')).toBe('读取文件详情');
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

    expect(
      within(tools[0]).getByTestId('inline-process-tool-status').getAttribute('data-status'),
    ).toBe('running');
    expect(
      within(tools[1]).getByTestId('inline-process-tool-status').getAttribute('data-status'),
    ).toBe('completed');
    expect(
      within(tools[2]).getByTestId('inline-process-tool-status').getAttribute('data-status'),
    ).toBe('failed');
    expect(tools[2].getAttribute('data-failed')).toBe('true');

    expect(
      tools[2].querySelector('.shell-inline-process__tool-toggle')?.getAttribute('aria-expanded'),
    ).toBe('false');
    fireEvent.click(tools[2].querySelector('.shell-inline-process__tool-toggle')!);
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('boom');
  });

  it('uses one Harness waiting row instead of a branded sync-thinking footer', () => {
    const { rerender } = render(<InlineProcessFlow items={[]} streaming />);
    expect(screen.getByTestId('process-activity-label').textContent).toContain('等待模型响应');
    expect(screen.queryByTestId('process-thinking')).toBeNull();

    rerender(<InlineProcessFlow items={[]} streaming answerStarted />);
    expect(screen.queryByTestId('process-activity-label')).toBeNull();

    rerender(<InlineProcessFlow items={[]} />);
    expect(screen.queryByTestId('process-panel')).toBeNull();
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

  it('keeps the current activity at the bottom with the 3x3 pixel mark while streaming', () => {
    render(<InlineProcessFlow items={[toolItem, runningTool]} streaming answerStarted />);

    const activity = screen.getByTestId('process-panel-activity');
    const panel = screen.getByTestId('process-panel');
    expect(activity.getAttribute('data-kind')).toBe('tool');
    expect(activity.textContent).toContain('运行命令');
    expect(activity.textContent).toContain('pnpm -s test');
    expect(screen.getByTestId('process-activity-label').getAttribute('data-label')).toContain(
      '运行命令',
    );
    expect(panel.lastElementChild).toBe(activity);
    expect(within(activity).getByTestId('loading-pixel-grid').children).toHaveLength(9);
    expect(
      within(screen.getAllByTestId('inline-process-tool').at(-1)!)
        .getByRole('button')
        .getAttribute('data-highlight-band'),
    ).toBe('true');
  });

  it('marks a streaming Think row with the same live highlight band', () => {
    render(
      <InlineProcessFlow
        items={[{ ...reasoningItem, status: 'streaming' }]}
        streaming
        defaultOpen
      />,
    );

    expect(screen.getByTestId('think-row-toggle').getAttribute('data-highlight-band')).toBe('true');
    expect(screen.getByTestId('inline-process-reasoning').classList.contains('is-running')).toBe(
      true,
    );
    const summary = screen.getByTestId('think-row-summary');
    expect(summary.classList.contains('shell-text-shimmer')).toBe(true);
    expect(summary.getAttribute('data-label')).toBe('第二行细节');
  });

  it('drops the activity summary once the turn reaches a terminal state', () => {
    render(<InlineProcessFlow items={[toolItem]} />);
    expect(screen.queryByTestId('process-panel-activity')).toBeNull();
  });

  it('shows the completed tool duration on the Harness row and in expanded details', () => {
    // 设计稿 01（Beautiful UI Tool Chips 采纳）：完成态收成行带耗时，
    // 展开详情保留同一数字。
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
    const tool = screen.getByTestId('inline-process-tool');
    fireEvent.click(within(tool).getByRole('button'));
    expect(tool.querySelector('.shell-inline-process__tool-body')?.textContent).toContain('2.0s');
  });

  it('names the running command on its own active Harness row', () => {
    render(
      <InlineProcessFlow items={[toolItem, runningTool]} runId="run-a" streaming answerStarted />,
    );

    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    const tool = screen.getAllByTestId('inline-process-tool').at(-1)!;
    expect(tool.classList.contains('is-running')).toBe(true);
    expect(tool.textContent).toContain('运行命令');
    expect(tool.textContent).toContain('pnpm -s test');
  });

  it('shows the full command line — not just the executable — on the tool row', () => {
    // {command,args[]} 只读 command 会把「pnpm -s test」显示成「pnpm」，
    // 等于看不出在跑什么。
    render(<InlineProcessFlow items={[runningTool]} defaultOpen />);
    expect(screen.getByTestId('inline-process-tool').textContent).toContain('pnpm -s test');
  });

  it('falls back to a waiting label before the first provider output arrives', () => {
    render(<InlineProcessFlow items={[toolItem]} runId="run-a" streaming />);
    expect(screen.getByTestId('process-activity-label').textContent).toContain('等待模型响应');
  });

  it('drops the waiting row once the run reaches a terminal state', () => {
    const { rerender } = render(<InlineProcessFlow items={[toolItem]} runId="run-a" streaming />);
    expect(screen.queryByTestId('process-activity-label')).toBeTruthy();

    rerender(<InlineProcessFlow items={[toolItem]} runId="run-a" streaming={false} />);
    expect(screen.queryByTestId('process-activity-label')).toBeNull();
  });

  it('counts elapsed time in expanded details and freezes when streaming settles', () => {
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
      const tool = screen.getByTestId('inline-process-tool');
      fireEvent.click(within(tool).getByRole('button'));
      expect(tool.querySelector('.shell-inline-process__tool-body')?.textContent).toContain('8s');

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(tool.querySelector('.shell-inline-process__tool-body')?.textContent).toContain('11s');

      // Renderer terminal settlement stops the shared clock even if a stale
      // tool item has not received its own completedAt yet.
      rerender(
        <InlineProcessFlow
          items={[{ ...runningTool, startedAt }]}
          runId="run-a"
          streaming={false}
          defaultOpen
        />,
      );
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(tool.querySelector('.shell-inline-process__tool-body')?.textContent).toContain('11s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides live elapsed for a stale running tool in a settled turn', () => {
    // 失败/中断的历史回合可能残留 status=running 的工具行；没有活的回合
    // 兜底时不得继续对着几天前的 startedAt 实时计时（会显示几百小时）。
    const startedAt = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    render(
      <InlineProcessFlow
        items={[{ ...runningTool, startedAt }]}
        runId="run-a"
        streaming={false}
        defaultOpen
      />,
    );
    expect(screen.queryByTestId('inline-process-tool-elapsed')).toBeNull();
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

  it('shows a failed tool as a red-dot row with its first error line in place', () => {
    render(
      <InlineProcessFlow
        items={[{ ...failedToolItem, result: 'Error: command failed\nfull stack trace' }]}
        defaultOpen
      />,
    );
    const status = screen.getByTestId('inline-process-tool-status');
    const summary = screen.getByTestId('inline-process-tool-error-summary');

    expect(status.getAttribute('data-status')).toBe('failed');
    expect(status.getAttribute('title')).toBe('失败');
    expect(status.getAttribute('aria-label')).toBe('失败');
    expect(status.textContent).toBe('');
    expect(screen.getByTestId('inline-process-tool').textContent).not.toContain('失败');
    expect(summary.textContent).toBe('Error: command failed');
    expect(summary.classList.contains('is-failed')).toBe(true);
    expect(document.querySelector('.shell-inline-process__state-dot')).toBeTruthy();
  });

  it('explains a failed tool whose provider returned no error body', () => {
    render(<InlineProcessFlow items={[{ ...failedToolItem, result: '' }]} defaultOpen />);

    fireEvent.click(
      screen.getByTestId('inline-process-tool').querySelector('.shell-inline-process__tool-toggle')!,
    );
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain(
      '工具未返回错误详情',
    );
  });

  it('extracts the useful error from a structured tool result', () => {
    render(
      <InlineProcessFlow
        items={[
          {
            ...failedToolItem,
            result: JSON.stringify({ ok: false, error: 'grep search failed (exit 2)' }),
          },
        ]}
        defaultOpen
      />,
    );

    expect(screen.getByTestId('inline-process-tool-error-summary').textContent).toBe(
      'grep search failed (exit 2)',
    );
  });

  it('shows an ok:false transport completion as a failed Harness row', () => {
    render(
      <InlineProcessFlow
        items={[
          {
            ...toolItem,
            name: 'mcp__browser__browser_screenshot',
            displayName: 'Browser Screenshot',
            status: 'completed',
            result: JSON.stringify({
              ok: false,
              code: 'browser.command-persist-failed',
              error: 'Browser command idempotency key was reused with different input.',
              failureClass: 'unknown',
            }),
          },
        ]}
        defaultOpen
      />,
    );

    expect(screen.getByTestId('inline-process-tool-status').getAttribute('data-status')).toBe(
      'failed',
    );
    expect(screen.getByTestId('inline-process-tool-error-summary').textContent).toBe(
      'Browser command idempotency key was reused with different input.',
    );
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

  it('keeps commentary segments when ordered tool items are already present', () => {
    render(
      <InlineProcessFlow
        items={[toolItem]}
        commentarySegments={[
          {
            id: 'seg-before-tool',
            text: '我先检查运行环境。',
            startedAt: '2026-08-22T10:00:00.000Z',
            afterSequence: 10,
          },
        ]}
        defaultOpen
      />,
    );

    const commentary = screen.getByTestId('inline-process-commentary');
    const tool = screen.getByTestId('inline-process-tool');
    expect(commentary.textContent).toContain('我先检查运行环境。');
    expect(follows(commentary, tool)).toBe(true);
  });

  it('restores missing commentary at its durable tool boundary without dropping repeated text', () => {
    const firstTool: InlineProcessItem = {
      ...toolItem,
      toolCallId: 'tool-read-a',
    };
    const secondTool: InlineProcessItem = {
      ...secondReadTool,
      toolCallId: 'tool-read-b',
    };
    render(
      <InlineProcessFlow
        items={[
          reasoningItem,
          { kind: 'commentary', id: 'seg-existing', text: '继续检查。' },
          firstTool,
          secondTool,
        ]}
        steps={[
          {
            id: 'tool-read-a',
            label: 'read_file',
            verb: 'Read',
            zh: '读取文件',
            toolName: 'read_file',
            kind: 'file',
            status: 'done',
            sequence: 11,
          } as never,
          {
            id: 'tool-read-b',
            label: 'read_file',
            verb: 'Read',
            zh: '读取文件',
            toolName: 'read_file',
            kind: 'file',
            status: 'done',
            sequence: 13,
          } as never,
        ]}
        commentarySegments={[
          {
            id: 'seg-existing',
            text: '继续检查。',
            startedAt: '2026-08-22T10:00:00.000Z',
            afterSequence: 9,
          },
          {
            id: 'seg-before',
            text: '准备读取第一个文件。',
            startedAt: '2026-08-22T10:00:01.000Z',
            afterSequence: 10,
          },
          {
            id: 'seg-between',
            text: '第一个文件已确认。',
            startedAt: '2026-08-22T10:00:02.000Z',
            afterSequence: 12,
          },
          {
            id: 'seg-repeated',
            text: '继续检查。',
            startedAt: '2026-08-22T10:00:03.000Z',
            afterSequence: 14,
          },
        ]}
        defaultOpen
      />,
    );

    const tools = screen.getAllByTestId('inline-process-tool');
    const commentary = screen.getAllByTestId('inline-process-commentary');
    expect(commentary).toHaveLength(4);
    expect(follows(commentary[1], tools[0])).toBe(true);
    expect(follows(tools[0], commentary[2])).toBe(true);
    expect(follows(commentary[2], tools[1])).toBe(true);
    expect(follows(tools[1], commentary[3])).toBe(true);
    expect(commentary.filter((entry) => entry.textContent?.includes('继续检查。'))).toHaveLength(2);
  });
});
describe('paged process reading state', () => {
  afterEach(() => cleanup());
  it('keeps expansion attached to a tool identity when a process page changes', () => {
    const step = (id: string) => ({
      id,
      toolName: 'run_command',
      label: 'Bash',
      verb: 'Bash',
      zh: '执行命令',
      status: 'done' as const,
      kind: 'bash' as const,
      command: `echo ${id}`,
      preview: `result ${id}`,
      completedAt: '2026-09-05T16:00:00Z',
    });
    const fixture = render(
      <InlineProcessFlow items={[]} steps={[step('one')]} collapseExecutionProcess={false} />,
    );
    const toggle = () =>
      screen
        .getByTestId('inline-process-tool')
        .querySelector('.shell-inline-process__tool-toggle')!;
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fixture.rerender(
      <InlineProcessFlow items={[]} steps={[step('two')]} collapseExecutionProcess={false} />,
    );
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fixture.rerender(
      <InlineProcessFlow items={[]} steps={[step('one')]} collapseExecutionProcess={false} />,
    );
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });
  it('does not keep a finished failed process open across a clean page', () => {
    const fixture = render(
      <InlineProcessFlow items={[failedToolItem]} answerStarted totalFailedTools={10} />,
    );
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
    fixture.rerender(<InlineProcessFlow items={[toolItem]} answerStarted totalFailedTools={10} />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('approval wait presentation', () => {
  it('keeps approval waits neutral and restarts the progress clock after a decision', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T07:00:00Z'));
    try {
      const view = render(
        <InlineProcessFlow items={[runningTool]} streaming waitingForApproval defaultOpen />,
      );
      act(() => vi.advanceTimersByTime(600000));
      expect(screen.getByTestId('process-activity-label').textContent).toBe('等待你的批准');
      expect(screen.getByTestId('process-panel-activity').getAttribute('data-kind')).toBe(
        'approval',
      );
      expect(screen.getByTestId('process-panel-activity').getAttribute('data-stall')).toBe(
        'active',
      );
      expect(screen.queryByText('长时间无输出')).toBeNull();
      view.rerender(<InlineProcessFlow items={[runningTool]} streaming defaultOpen />);
      act(() => vi.advanceTimersByTime(20000));
      expect(screen.getByTestId('process-panel-activity').getAttribute('data-kind')).toBe('tool');
      expect(screen.getByTestId('process-panel-activity').getAttribute('data-stall')).toBe(
        'active',
      );
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it('shows a restored approval even before any process segments arrive', () => {
    try {
      render(<InlineProcessFlow items={[]} waitingForApproval defaultOpen />);
      expect(screen.getByTestId('process-activity-label').textContent).toBe('等待你的批准');
    } finally {
      cleanup();
    }
  });
});
