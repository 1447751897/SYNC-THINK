/**
 * @vitest-environment jsdom
 *
 * InlineProcessFlow renders one DSH-style ordered execution timeline: Think is
 * a compact expandable row, every tool call owns one row, and commentary or
 * status events keep their original positions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  argumentsJson: '{"command":"pnpm test"}',
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

  it('keeps repeated adjacent tool calls as separate rows without count badges', () => {
    render(<InlineProcessFlow items={[toolItem, secondReadTool]} defaultOpen />);
    const tools = screen.getAllByTestId('inline-process-tool');

    expect(tools).toHaveLength(2);
    expect(tools[0].textContent).toContain('a.txt');
    expect(tools[1].textContent).toContain('b.txt');
    expect(screen.queryByText(/×2|2 个调用/)).toBeNull();
    expect(screen.queryByTestId('tool-batch')).toBeNull();
  });

  it('shows a friendly tool name and key input, then reveals raw details in place', () => {
    render(<InlineProcessFlow items={[toolItem]} defaultOpen />);
    const tool = screen.getByTestId('inline-process-tool');

    expect(tool.textContent).toContain('读取文件');
    expect(tool.textContent).toContain('a.txt');
    expect(tool.textContent).toContain('完成');
    expect(tool.textContent).not.toContain('read_file');

    fireEvent.click(within(tool).getByRole('button'));
    expect(tool.textContent).toContain('原始工具');
    expect(tool.textContent).toContain('read_file');
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('a.txt: 1 line');
  });

  it('collapses Think to one summary line and expands the full Markdown body', () => {
    render(<InlineProcessFlow items={[reasoningItem]} defaultOpen />);
    const summary = screen.getByTestId('think-row-summary');

    expect(summary.textContent).toBe('第一行摘要');
    expect(summary.textContent).not.toContain('第二行细节');
    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(screen.getByTestId('think-row-body').textContent).toContain('第二行细节');
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

    expect(within(tools[0]).getByText('运行中')).toBeTruthy();
    expect(within(tools[1]).getByText('完成')).toBeTruthy();
    expect(within(tools[2]).getByText('失败')).toBeTruthy();
    expect(tools[2].getAttribute('data-failed')).toBe('true');

    fireEvent.click(within(tools[2]).getByRole('button'));
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('boom');
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
    fireEvent.click(within(screen.getByTestId('inline-process-tool')).getByRole('button'));
    expect(screen.getByText('2.0s')).toBeTruthy();
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
