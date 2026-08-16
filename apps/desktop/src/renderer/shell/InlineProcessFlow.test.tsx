/**
 * @vitest-environment jsdom
 *
 * InlineProcessFlow renders the DSH-style execution process inside the
 * assistant message: reasoning rows (collapsed to their first line),
 * intermediate commentary/text, and paired tool cards — in durable block
 * order. The final answer is rendered separately by the message bubble.
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
  name: 'run_command',
  argumentsJson: '{"command":"dir"}',
  result: 'done',
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

  it('renders items in durable order with distinct test ids', () => {
    render(
      <InlineProcessFlow
        items={[reasoningItem, textItem, commentaryItem, toolItem]}
      />,
    );
    const rows = screen.getAllByTestId(/^inline-process-(reasoning|text|commentary|tool)$/);
    expect(rows.map((node) => node.dataset.testid)).toEqual([
      'inline-process-reasoning',
      'inline-process-text',
      'inline-process-commentary',
      'inline-process-tool',
    ]);
  });

  it('collapses a reasoning row to its first line and expands to the full text', () => {
    render(<InlineProcessFlow items={[reasoningItem]} />);
    const summary = screen.getByTestId('think-row-summary');
    expect(summary.textContent).toContain('第一行摘要');
    expect(summary.textContent).not.toContain('第二行细节');
    fireEvent.click(screen.getByTestId('think-row-toggle'));
    expect(screen.getByTestId('think-row-body').textContent).toContain('第二行细节');
  });

  it('renders the tool name and its result on one card', () => {
    render(<InlineProcessFlow items={[toolItem]} />);
    const card = screen.getByTestId('inline-process-tool');
    expect(card.textContent).toContain('run_command');
    // the result body is collapsed by default; expand to see it
    fireEvent.click(card.querySelector('button')!);
    expect(card.textContent).toContain('done');
  });

  it('marks a failed tool card', () => {
    render(<InlineProcessFlow items={[failedToolItem]} />);
    expect(screen.getByTestId('inline-process-tool').getAttribute('data-failed')).toBe('true');
  });

  it('shows an empty tool as pending when no result arrived', () => {
    render(
      <InlineProcessFlow items={[{ kind: 'tool', name: 'list_files', argumentsJson: '{}' }]} />,
    );
    expect(screen.getByTestId('inline-process-tool').textContent).toContain('list_files');
  });
});
