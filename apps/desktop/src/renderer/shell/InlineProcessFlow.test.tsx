/**
 * @vitest-environment jsdom
 *
 * InlineProcessFlow renders the DSH-style execution process inside the
 * assistant message: an outer collapsible process panel that holds the
 * ordered sequence (thinking rows / commentary / text / tool batches), with
 * adjacent tool calls merged into one expandable batch whose individual
 * cards show arguments and results. The final answer is rendered separately
 * by the message bubble.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { InlineProcessItem } from './ChatView.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';

const reasoningItem: InlineProcessItem = {
  kind: 'reasoning',
  text: '第一行摘要\n第二行细节',
};
const textItem: InlineProcessItem = { kind: 'text', text: '我先检查一下。' };
const commentaryItem: InlineProcessItem = { kind: 'commentary', text: '（内部注释）' };
const toolItem: InlineProcessItem = {
  kind: 'tool',
  name: 'read_file',
  argumentsJson: '{"path":"a.txt"}',
  result: 'a.txt: 1 line',
};
const writeTool: InlineProcessItem = {
  kind: 'tool',
  name: 'write_file',
  argumentsJson: '{"path":"b.txt"}',
  result: 'ok',
};
const failedToolItem: InlineProcessItem = {
  kind: 'tool',
  name: 'run_command',
  argumentsJson: '{}',
  result: 'boom',
  failed: true,
};

describe('InlineProcessFlow', () => {
  afterEach(cleanup);

  it('renders nothing when there are no items', () => {
    const { container } = render(<InlineProcessFlow items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('collapses the outer panel by default and expands on demand', () => {
    render(<InlineProcessFlow items={[reasoningItem, toolItem]} />);
    expect(screen.getByTestId('process-panel-toggle')).toBeTruthy();
    expect(screen.queryByTestId('process-panel-body')).toBeNull();
    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    expect(screen.getByTestId('process-panel-body')).toBeTruthy();
  });

  it('auto-opens the outer panel while streaming (live process visible)', () => {
    render(<InlineProcessFlow items={[toolItem]} streaming autoOpen />);
    expect(screen.getByTestId('process-panel-body')).toBeTruthy();
  });

  it('renders the sequence in durable order inside the panel', () => {
    render(<InlineProcessFlow items={[reasoningItem, textItem, commentaryItem, toolItem]} autoOpen />);
    const rows = screen.getAllByTestId(/^inline-process-(reasoning|text|commentary)$/);
    expect(rows.map((node) => node.dataset.testid)).toEqual([
      'inline-process-reasoning',
      'inline-process-text',
      'inline-process-commentary',
    ]);
    expect(screen.getByTestId('tool-batch')).toBeTruthy();
  });

  it('groups adjacent tool calls into one batch and counts them in the title', () => {
    render(
      <InlineProcessFlow
        items={[toolItem, toolItem, writeTool, commentaryItem, toolItem]}
        autoOpen
      />,
    );
    const batches = screen.getAllByTestId('tool-batch');
    expect(batches).toHaveLength(2);
    expect(batches[0].textContent).toContain('read_file ×2');
    expect(batches[0].textContent).toContain('write_file');
  });

  it('does not merge tools separated by a thinking row', () => {
    render(
      <InlineProcessFlow items={[toolItem, reasoningItem, writeTool]} autoOpen />,
    );
    expect(screen.getAllByTestId('tool-batch')).toHaveLength(2);
  });

  it('expands a batch to individual tool cards, then each card to its result', () => {
    render(<InlineProcessFlow items={[toolItem, writeTool]} autoOpen />);
    const batch = screen.getByTestId('tool-batch');
    // collapsed: individual cards hidden
    expect(batch.querySelectorAll('[data-testid="inline-process-tool"]')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('tool-batch-toggle'));
    const cards = batch.querySelectorAll('[data-testid="inline-process-tool"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('read_file');
    // expand the first card to see its result
    fireEvent.click(cards[0].querySelector('button')!);
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('a.txt: 1 line');
  });

  it('collapses a reasoning row to its first line and expands to the full text', () => {
    render(<InlineProcessFlow items={[reasoningItem]} autoOpen />);
    const summary = screen.getByTestId('think-row-summary');
    expect(summary.textContent).toContain('第一行摘要');
    expect(summary.textContent).not.toContain('第二行细节');
    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(screen.getByTestId('think-row-body').textContent).toContain('第二行细节');
  });

  it('marks a failed tool card inside the batch', () => {
    render(<InlineProcessFlow items={[failedToolItem]} autoOpen />);
    fireEvent.click(screen.getByTestId('tool-batch-toggle'));
    expect(
      screen.getByTestId('inline-process-tool').getAttribute('data-failed'),
    ).toBe('true');
  });

  it('shows the overall elapsed time in the outer panel title', () => {
    render(<InlineProcessFlow items={[toolItem]} durationMs={12_000} autoOpen />);
    expect(screen.getByTestId('process-panel-toggle').textContent).toContain('12');
  });

  it('shows a batch elapsed time from step timestamps', () => {
    render(
      <InlineProcessFlow
        items={[]}
        steps={[
          {
            id: 's1',
            label: 'read_file',
            verb: 'Read',
            zh: '读取文件',
            toolName: 'read_file',
            kind: 'file',
            status: 'done',
            startedAt: '2026-08-16T10:00:00.000Z',
            completedAt: '2026-08-16T10:00:02.000Z',
          } as never,
          {
            id: 's2',
            label: 'read_file',
            verb: 'Read',
            zh: '读取文件',
            toolName: 'read_file',
            kind: 'file',
            status: 'done',
            startedAt: '2026-08-16T10:00:02.500Z',
            completedAt: '2026-08-16T10:00:03.000Z',
          } as never,
        ]}
        autoOpen
      />,
    );
    const batch = screen.getByTestId('tool-batch');
    expect(batch.textContent).toContain('×2');
  });

  it('merges native-kernel run steps into tool cards when blocks carry no tools', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem]}
        steps={[
          {
            id: 'step-1',
            label: 'list_files',
            verb: 'List',
            zh: '列出文件',
            toolName: 'list_files',
            kind: 'file',
            status: 'done',
            preview: '[dirs]',
            sequence: 10,
          } as never,
        ]}
        autoOpen
      />,
    );
    fireEvent.click(screen.getByTestId('tool-batch-toggle'));
    const card = screen.getByTestId('inline-process-tool');
    expect(card.textContent).toContain('list_files');
    expect(card.getAttribute('data-failed')).toBe('false');
  });
});
