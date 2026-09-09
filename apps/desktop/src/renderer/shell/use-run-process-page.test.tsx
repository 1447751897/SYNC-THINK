/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RunProcessView } from '@sync-think/protocol';
import { FileChangesCard, ExecutionProcessBlock } from './ExecutionProcessBlock.js';
import { ReviewPanel } from './RightDock.js';
import { accumulateRunProcessSection, runProcessPageReader } from './use-run-process-page.js';

const version = 'a'.repeat(64);
const page = { offset: 0, total: 3, nextOffset: 1 };
const first = {
  runId: 'run',
  conversationId: 'conversation-a',
  steps: [
    {
      id: 'first-step',
      label: 'First step',
      status: 'done',
      kind: 'bash',
      toolName: 'run_command',
      verb: 'Bash',
      zh: '执行命令',
    },
  ],
  fileChanges: [{ path: 'first.txt', action: 'created', content: 'first' }],
  doneCount: 3,
  errorCount: 0,
  running: false,
  pages: { version, steps: page, fileChanges: page, taskPlan: { offset: 0, total: 0 } },
} as unknown as RunProcessView;
const second = {
  ...first,
  fileChanges: [{ path: 'second.txt', action: 'created', content: 'second' }],
  pages: { ...first.pages!, fileChanges: { offset: 1, total: 3, nextOffset: 2 } },
} as RunProcessView;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('process page controls', () => {
  it('shows full file totals, fetches only on intent and preserves version on next/back', async () => {
    const read = vi
      .spyOn(runProcessPageReader, 'read')
      .mockResolvedValueOnce({ process: second })
      .mockResolvedValueOnce({ process: first });
    render(<FileChangesCard view={first} />);
    expect(screen.getByText('编辑了 3 个文件')).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下一页文件' }));
    await screen.findByText('second.txt');
    expect(screen.queryByText('first.txt')).toBeNull();
    expect(read.mock.calls[0][0]).toMatchObject({
      conversationId: 'conversation-a',
      page: { section: 'fileChanges', offset: 1, version },
    });
    fireEvent.click(screen.getByRole('button', { name: '上一页文件' }));
    await screen.findByText('first.txt');
    expect(read.mock.calls[1][0].page?.offset).toBe(0);
  });

  it('retains the old Review page after a version change and restarts explicitly', async () => {
    const restarted = {
      ...first,
      pages: { ...first.pages!, fileChanges: { offset: 0, total: 1 } },
    } as RunProcessView;
    const read = vi
      .spyOn(runProcessPageReader, 'read')
      .mockRejectedValueOnce(new Error('history.version-changed'))
      .mockResolvedValueOnce({ process: restarted });
    render(<ReviewPanel view={first} standalone />);
    await screen.findByRole('alert');
    expect(screen.getAllByText('first.txt').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '下一页文件' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新读取文件' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(read.mock.calls[1][0].page?.version).toBeUndefined();
  });

  it('cancels a previous conversation consumer and ignores its late page', async () => {
    let finish!: (value: { process: RunProcessView }) => void;
    const read = vi.spyOn(runProcessPageReader, 'read').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const fixture = render(<FileChangesCard view={first} />);
    fireEvent.click(screen.getByRole('button', { name: '下一页文件' }));
    const signal = read.mock.calls[0][1];
    fixture.rerender(<FileChangesCard view={{ ...first, conversationId: 'conversation-b' }} />);
    expect(signal?.aborted).toBe(true);
    await act(async () => finish({ process: second }));
    expect(screen.queryByText('second.txt')).toBeNull();
  });

  it('assembles every standalone review file without showing page controls', async () => {
    const later = {
      ...first,
      fileChanges: [{ path: 'second.txt', action: 'created', content: 'second' }],
      pages: { ...first.pages!, fileChanges: { offset: 1, total: 3 } },
    } as RunProcessView;
    const read = vi.spyOn(runProcessPageReader, 'read').mockResolvedValueOnce({ process: later });
    render(<ReviewPanel view={first} standalone />);
    expect(screen.queryByRole('button', { name: '下一页文件' })).toBeNull();
    await screen.findByText('second.txt');
    expect(screen.getAllByText('first.txt').length).toBeGreaterThan(0);
    expect(read.mock.calls[0][0]).toMatchObject({
      page: { section: 'fileChanges', offset: 1, version },
    });
  });

  it('assembles every process step without showing page controls', async () => {
    const later = {
      ...first,
      steps: [
        { ...first.steps[0], id: 'second-step', zh: '第二步' },
        { ...first.steps[0], id: 'third-step', zh: '第三步' },
      ],
      pages: { ...first.pages!, steps: { offset: 1, total: 3 } },
    } as RunProcessView;
    const read = vi.spyOn(runProcessPageReader, 'read').mockResolvedValueOnce({ process: later });
    render(<ExecutionProcessBlock view={first} />);
    expect(screen.queryByRole('button', { name: '下一页步骤' })).toBeNull();
    await screen.findByText('第二步');
    expect(screen.getByText('第三步')).toBeTruthy();
    expect(screen.getByText('执行命令')).toBeTruthy();
    expect(read.mock.calls[0][0]).toMatchObject({
      page: { section: 'steps', offset: 1, version },
    });
  });
});

describe('accumulateRunProcessSection', () => {
  it('appends later pages and replaces a restart from offset 0', () => {
    const incoming = {
      ...first,
      steps: [{ ...first.steps[0], id: 'second-step' }],
      pages: { ...first.pages!, steps: { offset: 1, total: 3 } },
    } as RunProcessView;
    const merged = accumulateRunProcessSection(first, incoming, 'steps');
    expect(merged.steps.map((step) => step.id)).toEqual(['first-step', 'second-step']);
    expect(accumulateRunProcessSection(merged, first, 'steps').steps.map((step) => step.id)).toEqual(
      ['first-step'],
    );
  });
});
