/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDiffViewport, formatFilePatch } from './FileDiffSurface.js';
import {
  FileChangeDiff,
  FileChangesCard,
  LineDiffView,
  computeLineDiff,
} from './ExecutionProcessBlock.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import type { FileChangeItem, RunProcessView } from '@sync-think/protocol';

const change: FileChangeItem = {
  path: 'src/task.ts',
  action: 'edited',
  toolCallId: 'write-1',
  previousContent: 'const version = 1;\n',
  content: 'const version = 2;\n',
};
const view = (changes: FileChangeItem[]): RunProcessView =>
  ({
    runId: 'run-diff' as RunProcessView['runId'],
    steps: [],
    fileChanges: changes,
    running: false,
    doneCount: 1,
    errorCount: 0,
  }) as RunProcessView;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Be UI file diff integration', () => {
  it('keeps independent file disclosures and their reading positions after folding', () => {
    const { rerender } = render(
      <FileChangesCard
        view={view([change, { ...change, path: 'src/other.ts', toolCallId: 'write-2' }])}
      />,
    );
    expect(screen.queryByRole('region', { name: '文件差异内容' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开 src/task.ts diff' }));
    const viewport = screen.getByRole('region', { name: '文件差异内容' });
    viewport.scrollTop = 70;
    viewport.scrollLeft = 30;
    fireEvent.click(screen.getByRole('button', { name: '展开 src/other.ts diff' }));
    expect(screen.getAllByRole('region', { name: '文件差异内容' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '收起 src/task.ts diff' }));
    expect(screen.getAllByRole('region', { name: '文件差异内容' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '展开 src/task.ts diff' }));
    expect(viewport.isConnected).toBe(true);
    expect(viewport.scrollTop).toBe(70);
    expect(viewport.scrollLeft).toBe(30);
    rerender(<FileChangesCard view={view([{ ...change, toolCallId: 'different-call' }])} />);
    expect(screen.queryByRole('region', { name: '文件差异内容' })).toBeNull();
  });

  it('copies the patch separately from the unchanged modified source and handles wrap', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <LineDiffView oldText={change.previousContent} newText={change.content} path={change.path} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '复制差异' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '--- "a/src/task.ts"\n+++ "b/src/task.ts"\n@@ -1,1 +1,1 @@\n-const version = 1;\n+const version = 2;\n',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: '复制修改后内容' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(change.content));
    fireEvent.click(screen.getByRole('button', { name: '自动换行' }));
    expect(screen.getByRole('region', { name: '文件差异内容' }).classList.contains('is-wrap')).toBe(
      false,
    );
  });

  it('uses an empty known side for creation and deletion but never infers a missing edit snapshot', () => {
    const { container, rerender } = render(
      <FileChangeDiff item={{ path: 'new.ts', action: 'created', content: 'const a = 1;' }} />,
    );
    expect(container.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(0);
    rerender(
      <FileChangeDiff
        item={{ path: 'old.ts', action: 'deleted', previousContent: 'const a = 1;' }}
      />,
    );
    expect(container.querySelectorAll('[data-kind="del"]')).toHaveLength(1);
    rerender(
      <FileChangeDiff
        item={{ path: 'unknown.ts', action: 'edited', content: 'new', preview: 'new' }}
      />,
    );
    expect(container.querySelector('[data-kind]')).toBeNull();
    expect(screen.getByText(/缺少完整前后快照/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制差异' })).toBeNull();
  });

  it('associates tool diffs by call id, including when the same file was edited twice', () => {
    const onOpenChange = vi.fn();
    render(
      <InlineProcessFlow
        defaultOpen
        onOpenChange={onOpenChange}
        items={[
          {
            kind: 'tool',
            toolCallId: 'write-1',
            name: 'write_file',
            argumentsJson: '{"path":"src/task.ts"}',
            result: 'ok',
            status: 'completed',
          },
        ]}
        fileChanges={[change, { ...change, toolCallId: 'write-2', content: 'wrong edit' }]}
      />,
    );
    expect(screen.queryByTestId('tool-file-diffs')).toBeNull();
    fireEvent.click(screen.getByTestId('inline-process-tool').querySelector('button')!);
    const details = screen.getByTestId('tool-file-diffs');
    expect(details.querySelector('[data-kind="add"] code')?.textContent).toBe('const version = 2;');
    expect(details.textContent).not.toContain('wrong edit');
    fireEvent.click(within(details).getByRole('button', { name: 'src/task.ts' }));
    expect(onOpenChange).toHaveBeenCalledWith('src/task.ts');
    expect(screen.queryByTestId('inline-process-tool-arguments')).toBeNull();
    expect(screen.queryByTestId('inline-process-tool-result')).toBeNull();
    expect(screen.queryByText('原始工具')).toBeNull();
  });

  it.each(['file_change', 'Edit'])(
    'shows only the diff for %s, while preserving a failed edit diagnostic',
    (name) => {
      const item = {
        kind: 'tool' as const,
        toolCallId: 'write-1',
        name,
        argumentsJson: JSON.stringify({ changes: [{ path: change.path, diff: '@@ -1 +1 @@' }] }),
        result: JSON.stringify({ ok: true, status: 'completed', changes: [{ path: change.path }] }),
        status: 'completed' as const,
      };
      const { rerender } = render(
        <InlineProcessFlow defaultOpen items={[item]} fileChanges={[change]} />,
      );
      const toggle = screen.getByTestId('inline-process-tool').querySelector('button')!;
      expect(toggle.textContent).toContain(change.path);
      expect(toggle.textContent).not.toContain('changes');
      fireEvent.click(toggle);
      expect(screen.getByTestId('tool-file-diffs').textContent).toContain('const version = 2;');
      expect(screen.queryByTestId('inline-process-tool-arguments')).toBeNull();
      expect(screen.queryByTestId('inline-process-tool-result')).toBeNull();
      expect(screen.queryByText('原始工具')).toBeNull();
      fireEvent.click(toggle);
      expect(screen.queryByTestId('tool-file-diffs')).toBeNull();
      fireEvent.click(toggle);
      rerender(
        <InlineProcessFlow
          defaultOpen
          items={[{ ...item, status: 'failed', result: '目标文件已变化，编辑未应用' }]}
          fileChanges={[change]}
        />,
      );
      expect(screen.getByTestId('tool-file-diffs')).toBeTruthy();
      expect(screen.getByTestId('inline-process-tool-result').textContent).toContain(
        '目标文件已变化，编辑未应用',
      );
      expect(screen.queryByTestId('inline-process-tool-arguments')).toBeNull();
    },
  );

  it('preserves stream reading position and only follows again after explicit action', async () => {
    const { rerender } = render(
      <FileDiffViewport streaming revision={1}>
        <div>first</div>
      </FileDiffViewport>,
    );
    const viewport = screen.getByRole('region', { name: '文件差异内容' });
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, writable: true, value: 80 },
    });
    fireEvent.scroll(viewport);
    rerender(
      <FileDiffViewport streaming revision={2}>
        <div>second</div>
      </FileDiffViewport>,
    );
    expect(viewport.scrollTop).toBe(80);
    fireEvent.click(screen.getByRole('button', { name: '跟随最新差异' }));
    expect(viewport.scrollTop).toBe(600);
    rerender(
      <FileDiffViewport revision={3}>
        <div>done</div>
      </FileDiffViewport>,
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: '跟随最新差异' })).toBeNull());
    expect(screen.getByText('done')).toBeTruthy();
  });

  it('does not offer a zero-line patch for newline-only changes', () => {
    render(<LineDiffView oldText={'const a = 1;\n'} newText="const a = 1;" path="a.ts" />);
    expect(screen.getByText(/末尾换行发生变化/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制差异' })).toBeNull();
    expect(screen.getByRole('button', { name: '复制修改后内容' })).toBeTruthy();
  });

  it('preserves a changed final newline in exported patches with other edits', () => {
    const before = 'old\nlast\n',
      after = 'new\nlast';
    const patch = formatFilePatch('a.ts', before, after, computeLineDiff(before, after)!);
    expect(patch).toContain('-last\n+last\n\\ No newline at end of file\n');
    expect(formatFilePatch('a.ts', '', 'new', computeLineDiff('', 'new')!)).toContain(
      '@@ -0,0 +1,1 @@',
    );
  });
});
