/**
 * @vitest-environment jsdom
 *
 * InlineProcessFlow renders the DSH-style execution process flat inside the
 * message flow: thinking rows (collapsed to their first line), intermediate
 * commentary/text, and tool batches in time order. The final answer is
 * rendered separately by the message bubble.
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

  it('renders the sequence flat and in durable order', () => {
    render(
      <InlineProcessFlow items={[reasoningItem, textItem, commentaryItem, toolItem]} />,
    );
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
      />,
    );
    const batches = screen.getAllByTestId('tool-batch');
    expect(batches).toHaveLength(2);
    expect(batches[0].textContent).toContain('read_file ×2');
    expect(batches[0].textContent).toContain('write_file');
  });

  it('does not merge tools separated by a thinking row', () => {
    render(
      <InlineProcessFlow items={[toolItem, reasoningItem, writeTool]} />,
    );
    expect(screen.getAllByTestId('tool-batch')).toHaveLength(2);
  });

  it('expands a batch to individual tool cards, then each card to its result', () => {
    render(<InlineProcessFlow items={[toolItem, writeTool]} />);
    const batch = screen.getByTestId('tool-batch');
    expect(batch.querySelectorAll('[data-testid="inline-process-tool"]')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('tool-batch-toggle'));
    const cards = batch.querySelectorAll('[data-testid="inline-process-tool"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('read_file');
    fireEvent.click(cards[0].querySelector('button')!);
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('a.txt: 1 line');
  });

  it('collapses a reasoning row to its first line and expands to the full text', () => {
    render(<InlineProcessFlow items={[reasoningItem]} />);
    const summary = screen.getByTestId('think-row-summary');
    expect(summary.textContent).toContain('第一行摘要');
    expect(summary.textContent).not.toContain('第二行细节');
    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(screen.getByTestId('think-row-body').textContent).toContain('第二行细节');
  });

  it('marks a failed tool card inside the batch', () => {
    render(<InlineProcessFlow items={[failedToolItem]} />);
    fireEvent.click(screen.getByTestId('tool-batch-toggle'));
    expect(
      screen.getByTestId('inline-process-tool').getAttribute('data-failed'),
    ).toBe('true');
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
      />,
    );
    fireEvent.click(screen.getByTestId('tool-batch-toggle'));
    const card = screen.getByTestId('inline-process-tool');
    expect(card.textContent).toContain('list_files');
    expect(card.getAttribute('data-failed')).toBe('false');
  });

  it('interleaves reasoning, commentary segments and steps in boundary order', () => {
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
      />,
    );
    const rows = screen.getAllByTestId(/^inline-process-(reasoning|commentary)$/);
    expect(rows.map((node) => node.dataset.testid)).toEqual([
      'inline-process-reasoning',
      'inline-process-commentary',
    ]);
    // the tool batch follows the commentary (afterSequence 10 < step sequence 12)
    const commentary = screen.getByTestId('inline-process-commentary');
    const batch = screen.getByTestId('tool-batch');
    expect(commentary.compareDocumentPosition(batch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
