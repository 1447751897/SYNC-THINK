/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FilePane,
  clearFilePaneSession,
  isFilePaneSessionDirty,
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

afterEach(() => {
  cleanup();
  clearFilePaneSession('C:/workspace', 'notes.txt');
  Reflect.deleteProperty(window, 'syncThink');
});

describe('FilePane', () => {
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
      <FilePane
        projectFolder="C:/workspace"
        path="notes.txt"
        onDirtyChange={onDirtyChange}
      />,
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
    expect((await screen.findByTestId('file-pane-editor') as HTMLTextAreaElement).value).toBe('before');
    await waitFor(() => expect(bridge.watchProjectFile).toHaveBeenCalledTimes(1));

    bridge.emitChange({ path: 'notes.txt', exists: true, mtimeMs: 30, size: 9 });

    await waitFor(() =>
      expect((screen.getByTestId('file-pane-editor') as HTMLTextAreaElement).value).toBe('from disk'),
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

    expect((await screen.findByTestId('file-pane-conflict')).textContent).toContain('磁盘上的文件已变化');
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
