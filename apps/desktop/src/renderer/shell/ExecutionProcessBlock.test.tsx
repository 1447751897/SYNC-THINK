/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionProcessStep, RunProcessView } from '@sync-think/protocol';
import { ExecutionProcessBlock } from './ExecutionProcessBlock.js';

function step(overrides: Partial<ExecutionProcessStep> = {}): ExecutionProcessStep {
  return {
    id: 'step-1',
    label: 'git status',
    verb: 'run',
    zh: '执行',
    toolName: 'run_command',
    kind: 'bash',
    status: 'running',
    command: 'git status',
    ...overrides,
  };
}

function processView(steps: ExecutionProcessStep[]): RunProcessView {
  return {
    runId: 'run-1',
    steps,
    fileChanges: [],
    running: true,
    doneCount: 0,
    errorCount: 0,
  } as unknown as RunProcessView;
}

/** Match the header row regardless of how the title is formatted. */
function headerRow(): Element | null {
  return screen.getByTestId('execution-process').querySelector('.shell-tool-card');
}

afterEach(() => {
  cleanup();
});

describe('ExecutionProcessBlock step collapse', () => {
  it('renders a running step folded by default while streaming', () => {
    render(<ExecutionProcessBlock view={processView([step()])} />);

    expect(screen.getByText('执行 · git status')).toBeTruthy();
    expect(headerRow()?.getAttribute('data-open')).toBe('0');
  });

  it('preserves the folded state once a running step completes', () => {
    const { rerender } = render(<ExecutionProcessBlock view={processView([step()])} />);

    expect(headerRow()?.getAttribute('data-open')).toBe('0');

    rerender(
      <ExecutionProcessBlock view={processView([step({ status: 'done', preview: '已完成' })])} />,
    );

    expect(headerRow()?.getAttribute('data-open')).toBe('0');
    expect(screen.getByText('执行 · git status')).toBeTruthy();
  });

  it('keeps a finished step open when the user expanded it manually', () => {
    const { rerender } = render(
      <ExecutionProcessBlock view={processView([step({ status: 'done', preview: '已完成' })])} />,
    );

    // User clicks the folded header to inspect the finished step.
    act(() => {
      screen.getByText('执行 · git status').click();
    });

    expect(headerRow()?.getAttribute('data-open')).toBe('1');

    // Re-render with the same status must not force-collapse the manual choice.
    rerender(
      <ExecutionProcessBlock view={processView([step({ status: 'done', preview: '已完成' })])} />,
    );
    expect(headerRow()?.getAttribute('data-open')).toBe('1');
  });

  it('renders a failed step folded with its header still visible', () => {
    render(
      <ExecutionProcessBlock
        view={processView([step({ status: 'error', error: 'command not found' })])}
      />,
    );

    expect(headerRow()?.getAttribute('data-open')).toBe('0');
    expect(screen.getByText('执行 · git status')).toBeTruthy();
  });
});
