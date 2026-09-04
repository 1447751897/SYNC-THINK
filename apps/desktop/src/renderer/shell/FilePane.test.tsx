/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FilePane,
  clearFilePaneSession,
  isFilePaneSessionDirty,
  seedFilePaneUnsavedDraft,
} from './FilePane.js';

interface Change {
  path: string;
  exists: boolean;
  mtimeMs: number | null;
  size: number | null;
}

function installBridge() {
  let changeListener: ((change: Change) => void) | undefined;
  const unsubscribe = vi.fn(async () => undefined);
  const readProjectFile = vi.fn();
  const writeProjectFile = vi.fn();
  const watchProjectFile = vi.fn(
    (_payload: { root: string; path: string }, listener: (change: Change) => void) => {
      changeListener = listener;
      return {
        ready: Promise.resolve({ subscriptionId: 'file-watch-1' }),
        unsubscribe,
      };
    },
  );
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime: { readProjectFile, writeProjectFile, watchProjectFile } },
  });
  return {
    readProjectFile,
    writeProjectFile,
    watchProjectFile,
    unsubscribe,
    emitChange(change: Change) {
      changeListener?.(change);
    },
  };
}

function installClipboard() {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

afterEach(() => {
  cleanup();
  clearFilePaneSession('C:/workspace', 'notes.txt');
  clearFilePaneSession('C:/workspace', 'src/example.ts');
  clearFilePaneSession('C:/workspace', 'README.md');
  clearFilePaneSession('C:/workspace', 'designs/draft.excalidraw');
  clearFilePaneSession('C:/workspace', 'notes/未命名文档.md');
  Reflect.deleteProperty(window, 'syncThink');
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('FilePane', () => {
  it('uses compact view controls without repeating the filename', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'src/example.ts',
      content: 'const answer: number = 42;',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 26,
    });

    render(<FilePane projectFolder="C:/workspace" path="src/example.ts" />);

    const preview = await screen.findByTestId('file-pane-preview');
    expect(preview.hidden).toBe(false);
    expect(preview.querySelector('[data-language="typescript"]')).toBeTruthy();
    expect(preview.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(screen.getByRole('tab', { name: '高亮预览' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: '高亮预览' }).textContent).toBe('');
    expect(screen.getByRole('tab', { name: '源码' }).textContent).toBe('');
    expect(document.querySelector('.shell-file-pane-path')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '源码' }));
    const editor = screen.getByTestId('file-pane-editor') as HTMLTextAreaElement;
    expect(editor.hidden).toBe(false);
    fireEvent.change(editor, { target: { value: 'const answer: number = 43;' } });

    fireEvent.click(screen.getByRole('tab', { name: '高亮预览' }));
    expect(preview.textContent).toContain('43');
    expect(
      document.querySelector('.shell-file-pane-view-tabs .shell-sliding-tabs__pill'),
    ).toBeTruthy();
  });

  it('keeps save status on the save control instead of a separate label', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'notes.txt',
      content: 'before',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 6,
    });

    render(<FilePane projectFolder="C:/workspace" path="notes.txt" />);
    await screen.findByTestId('file-pane-editor');

    const save = screen.getByTestId('file-pane-save');
    const status = screen.getByTestId('file-pane-status');
    expect(save.contains(status)).toBe(true);
    expect(status.textContent).toContain('已同步');
    expect(save.getAttribute('aria-label')).toBe('保存文件');
  });

  it('renders Markdown as a document preview while preserving editable source', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'README.md',
      content:
        '# Preview title\n\n- First item\n- Second item\n\n| Name | Value |\n| --- | --- |\n| Cache | 42 |',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 92,
    });

    render(<FilePane projectFolder="C:/workspace" path="README.md" />);

    const richEditor = await screen.findByTestId('file-pane-rich-editor');
    const preview = screen.getByTestId('file-pane-preview');
    expect(richEditor.hidden).toBe(false);
    expect(preview.hidden).toBe(true);
    expect(richEditor.querySelector('[data-preview-kind="markdown"]')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Preview title' })).toBeTruthy();
    expect(richEditor.querySelectorAll('li')).toHaveLength(2);
    expect(richEditor.querySelector('table')?.textContent).toContain('Cache');
    expect(richEditor.querySelector('.shell-code-preview__ln')).toBeNull();
    expect(screen.getByRole('toolbar', { name: '富文本编辑' })).toBeTruthy();
    expect(richEditor.querySelector('[contenteditable="true"]')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '富文本编辑' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('tab', { name: '源码编辑' }));
    const editor = screen.getByTestId('file-pane-editor') as HTMLTextAreaElement;
    expect(editor.value).toContain('# Preview title');
    fireEvent.change(editor, { target: { value: '# Updated title\n\nNew body' } });
    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    expect(preview.hidden).toBe(false);
    expect(preview.querySelector('[contenteditable="true"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Updated title' })).toBeTruthy();
  });

  it('opens a Markdown content-search hit in source mode so the exact line remains visible', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'README.md',
      content: '# Title\n\nFirst paragraph\n\nNeedle line\n',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 42,
    });

    render(
      <FilePane
        projectFolder="C:/workspace"
        path="README.md"
        revealTarget={{ line: 5, column: 1, nonce: 7 }}
      />,
    );

    const editor = (await screen.findByTestId('file-pane-editor')) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.hidden).toBe(false));
    expect(screen.getByRole('tab', { name: '源码编辑' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(editor.selectionStart).toBe('# Title\n\nFirst paragraph\n\n'.length);
  });

  it('keeps canvas resources in one drawing mode without preview or source tabs', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'designs/draft.excalidraw',
      content: '{}',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 2,
    });

    render(<FilePane projectFolder="C:/workspace" path="designs/draft.excalidraw" />);

    expect(await screen.findByTestId('file-pane-canvas')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByLabelText('文件查看方式')).toBeNull();
    expect(screen.getByTestId('file-pane').getAttribute('data-kind')).toBe('canvas');
  });

  it('copies the complete current source from the status menu', async () => {
    const bridge = installBridge();
    const writeText = installClipboard();
    bridge.readProjectFile.mockResolvedValue({
      path: 'src/example.ts',
      content: 'const answer: number = 42;\nexport { answer };\n',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 47,
    });

    render(<FilePane projectFolder="C:/workspace" path="src/example.ts" />);

    await screen.findByTestId('file-pane-editor');
    expect(screen.queryByRole('menuitem', { name: '复制源码' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '源码' }));
    const editor = screen.getByTestId('file-pane-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: { value: 'const answer: number = 43;\nexport { answer };\n' },
    });
    fireEvent.click(screen.getByTestId('file-pane-save-menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制源码' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('const answer: number = 43;\nexport { answer };\n'),
    );
    expect(screen.getByRole('menuitem', { name: '源码已复制' }).textContent).toContain('已复制');
  });

  it('loads metadata, tracks a dirty draft, and saves with optimistic concurrency', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'notes.txt',
      content: 'before',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 6,
    });
    bridge.writeProjectFile.mockResolvedValue({
      path: 'notes.txt',
      ok: true,
      conflict: false,
      error: null,
      errorCode: null,
      mtimeMs: 20,
      size: 5,
    });
    const onDirtyChange = vi.fn();

    render(
      <FilePane projectFolder="C:/workspace" path="notes.txt" onDirtyChange={onDirtyChange} />,
    );
    const editor = await screen.findByTestId('file-pane-editor');
    expect((editor as HTMLTextAreaElement).value).toBe('before');

    fireEvent.change(editor, { target: { value: 'draft' } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByTestId('file-pane-status').textContent).toContain('未保存');
    fireEvent.keyDown(editor, { key: 's', ctrlKey: true });

    await waitFor(() =>
      expect(bridge.writeProjectFile).toHaveBeenCalledWith({
        root: 'C:/workspace',
        path: 'notes.txt',
        content: 'draft',
        expectedMtimeMs: 10,
        expectedSize: 6,
      }),
    );
    expect(screen.getByTestId('file-pane-status').textContent).toContain('已保存');
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it('reloads a clean editor automatically when the watcher reports a disk change', async () => {
    const bridge = installBridge();
    bridge.readProjectFile
      .mockResolvedValueOnce({
        path: 'notes.txt',
        content: 'before',
        error: null,
        errorCode: null,
        mtimeMs: 10,
        size: 6,
      })
      .mockResolvedValueOnce({
        path: 'notes.txt',
        content: 'from disk',
        error: null,
        errorCode: null,
        mtimeMs: 30,
        size: 9,
      });

    render(<FilePane projectFolder="C:/workspace" path="notes.txt" />);
    expect(((await screen.findByTestId('file-pane-editor')) as HTMLTextAreaElement).value).toBe(
      'before',
    );
    await waitFor(() => expect(bridge.watchProjectFile).toHaveBeenCalledTimes(1));

    bridge.emitChange({ path: 'notes.txt', exists: true, mtimeMs: 30, size: 9 });

    await waitFor(() =>
      expect((screen.getByTestId('file-pane-editor') as HTMLTextAreaElement).value).toBe(
        'from disk',
      ),
    );
    expect(screen.queryByTestId('file-pane-conflict')).toBeNull();
  });

  it('keeps a dirty draft on external change and can explicitly load the disk version', async () => {
    const bridge = installBridge();
    bridge.readProjectFile
      .mockResolvedValueOnce({
        path: 'notes.txt',
        content: 'before',
        error: null,
        errorCode: null,
        mtimeMs: 10,
        size: 6,
      })
      .mockResolvedValueOnce({
        path: 'notes.txt',
        content: 'from disk',
        error: null,
        errorCode: null,
        mtimeMs: 30,
        size: 9,
      });

    render(<FilePane projectFolder="C:/workspace" path="notes.txt" />);
    const editor = await screen.findByTestId('file-pane-editor');
    fireEvent.change(editor, { target: { value: 'local draft' } });
    bridge.emitChange({ path: 'notes.txt', exists: true, mtimeMs: 30, size: 9 });

    expect((await screen.findByTestId('file-pane-conflict')).textContent).toContain(
      '磁盘上的文件已变化',
    );
    expect((editor as HTMLTextAreaElement).value).toBe('local draft');
    fireEvent.click(screen.getByRole('button', { name: '加载磁盘版本' }));

    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('from disk'));
    expect(screen.queryByTestId('file-pane-conflict')).toBeNull();
    expect(screen.getByTestId('file-pane-status').textContent).toContain('已同步');
  });

  it('surfaces an mtime conflict and overwrites only after the explicit command', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'notes.txt',
      content: 'before',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 6,
    });
    bridge.writeProjectFile
      .mockResolvedValueOnce({
        path: 'notes.txt',
        ok: false,
        conflict: true,
        error: '文件已在磁盘上发生变化',
        errorCode: 'file_conflict',
        mtimeMs: 30,
        size: 9,
      })
      .mockResolvedValueOnce({
        path: 'notes.txt',
        ok: true,
        conflict: false,
        error: null,
        errorCode: null,
        mtimeMs: 40,
        size: 11,
      });

    render(<FilePane projectFolder="C:/workspace" path="notes.txt" />);
    const editor = await screen.findByTestId('file-pane-editor');
    fireEvent.change(editor, { target: { value: 'local draft' } });
    fireEvent.click(screen.getByTestId('file-pane-save'));
    expect(await screen.findByTestId('file-pane-conflict')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '覆盖磁盘版本' }));
    await waitFor(() => expect(bridge.writeProjectFile).toHaveBeenCalledTimes(2));
    expect(bridge.writeProjectFile.mock.calls[1]?.[0]).toEqual({
      root: 'C:/workspace',
      path: 'notes.txt',
      content: 'local draft',
      expectedMtimeMs: 10,
      expectedSize: 6,
      force: true,
    });
    expect(screen.getByTestId('file-pane-status').textContent).toContain('已保存');
  });

  it('opens a seeded untitled draft without reading or writing disk', async () => {
    const bridge = installBridge();
    bridge.writeProjectFile.mockResolvedValue({
      path: 'notes/未命名文档.md',
      ok: true,
      conflict: false,
      error: null,
      errorCode: null,
      mtimeMs: 20,
      size: 10,
    });
    seedFilePaneUnsavedDraft('C:/workspace', 'notes/未命名文档.md', '# 未命名文档\n\n');

    render(<FilePane projectFolder="C:/workspace" path="notes/未命名文档.md" />);

    const editor = await screen.findByTestId('file-pane-editor');
    expect((editor as HTMLTextAreaElement).value).toBe('# 未命名文档\n\n');
    expect(bridge.readProjectFile).not.toHaveBeenCalled();
    expect(bridge.writeProjectFile).not.toHaveBeenCalled();
    expect(bridge.watchProjectFile).not.toHaveBeenCalled();
    expect(isFilePaneSessionDirty('C:/workspace', 'notes/未命名文档.md')).toBe(false);
    expect(screen.getByTestId('file-pane-status').textContent).toContain('草稿');

    fireEvent.click(screen.getByTestId('file-pane-save'));
    await waitFor(() =>
      expect(bridge.writeProjectFile).toHaveBeenCalledWith({
        root: 'C:/workspace',
        path: 'notes/未命名文档.md',
        content: '# 未命名文档\n\n',
        expectedMtimeMs: null,
        expectedSize: null,
      }),
    );
    expect(screen.getByTestId('file-pane-status').textContent).toContain('已保存');
  });

  it('keeps an unsaved in-memory draft when its tab unmounts and mounts again', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'notes.txt',
      content: 'before',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 6,
    });

    const first = render(<FilePane projectFolder="C:/workspace" path="notes.txt" />);
    const editor = await screen.findByTestId('file-pane-editor');
    fireEvent.change(editor, { target: { value: 'local draft' } });
    await waitFor(() => expect(isFilePaneSessionDirty('C:/workspace', 'notes.txt')).toBe(true));
    first.unmount();

    render(<FilePane projectFolder="C:/workspace" path="notes.txt" />);
    const restored = await screen.findByTestId('file-pane-editor');
    expect((restored as HTMLTextAreaElement).value).toBe('local draft');
    expect(screen.getByTestId('file-pane-status').textContent).toContain('未保存');
  });

  it('reveals a transient content-search line without persisting editor position', async () => {
    const bridge = installBridge();
    bridge.readProjectFile.mockResolvedValue({
      path: 'notes.txt',
      content: 'first line\nsecond Needle line\nthird line',
      error: null,
      errorCode: null,
      mtimeMs: 10,
      size: 40,
    });

    render(
      <FilePane
        projectFolder="C:/workspace"
        path="notes.txt"
        revealTarget={{ line: 2, column: 8, nonce: 1 }}
      />,
    );

    const editor = (await screen.findByTestId('file-pane-editor')) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.selectionStart).toBe('first line\n'.length + 7));
    expect(editor.selectionEnd).toBe(editor.selectionStart);
  });
});
