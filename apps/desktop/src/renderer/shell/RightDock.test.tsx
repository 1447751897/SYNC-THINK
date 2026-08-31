/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RunProcessView } from '@sync-think/protocol';
import { ReviewPanel, WorkspaceFilesPanel } from './RightDock.js';

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
    this.isPrimary = init.isPrimary ?? true;
  }
}

const nativePointerEvent = window.PointerEvent;

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill,
  });
});

afterAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: nativePointerEvent,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'syncThink');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

describe('WorkspaceFilesPanel', () => {
  it('offers current-file and new-tab actions when embedded in a file view', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listProjectDir: vi.fn(async () => ({
            dir: '',
            entries: [{ path: 'src/app.ts', name: 'app.ts', kind: 'file' }],
          })),
          listProjectFiles: vi.fn(async () => ({ root: 'C:/workspace', files: [] })),
        },
      },
    });
    const onOpenFile = vi.fn();
    const onOpenFileInNewTab = vi.fn();

    render(
      <WorkspaceFilesPanel
        projectFolder="C:/workspace"
        activeFilePath="src/current.ts"
        onOpenFile={onOpenFile}
        onOpenFileInNewTab={onOpenFileInNewTab}
      />,
    );

    fireEvent.click(
      await screen.findByRole('treeitem', { name: '在当前文件标签打开 src/app.ts' }),
    );
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts', undefined);

    fireEvent.click(screen.getByRole('button', { name: '在新文件标签打开 src/app.ts' }));
    expect(onOpenFileInNewTab).toHaveBeenCalledWith('src/app.ts', undefined);
  });

  it('uses file-format icons in the workspace tree', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listProjectDir: vi.fn(async () => ({
            dir: '',
            entries: [
              { path: 'scripts/check.cjs', name: 'check.cjs', kind: 'file' },
              { path: 'scripts/report.py', name: 'report.py', kind: 'file' },
              { path: 'src/app.tsx', name: 'app.tsx', kind: 'file' },
              { path: 'src/theme.css', name: 'theme.css', kind: 'file' },
              { path: 'package.json', name: 'package.json', kind: 'file' },
              { path: 'README.md', name: 'README.md', kind: 'file' },
            ],
          })),
          listProjectFiles: vi.fn(async () => ({ root: 'C:/workspace', files: [] })),
        },
      },
    });

    render(<WorkspaceFilesPanel projectFolder="C:/workspace" />);

    expect(await screen.findByText('check.cjs')).toBeTruthy();
    expect(document.querySelector('[data-file-type="javascript"]')).toBeTruthy();
    expect(document.querySelector('[data-file-type="python"]')).toBeTruthy();
    for (const kind of ['javascript', 'python', 'typescript', 'css', 'package', 'markdown']) {
      expect(document.querySelector(`[data-file-type="${kind}"] svg`)).toBeTruthy();
    }
  });

  it('supports tree semantics and arrow-key navigation across lazy folders', async () => {
    const listProjectDir = vi.fn(async ({ dir }: { dir: string }) => ({
      dir,
      entries:
        dir === 'src'
          ? [{ path: 'src/app.ts', name: 'app.ts', kind: 'file' as const }]
          : [
              { path: 'src', name: 'src', kind: 'dir' as const },
              { path: 'README.md', name: 'README.md', kind: 'file' as const },
            ],
    }));
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listProjectDir,
          listProjectFiles: vi.fn(async () => ({ root: 'C:/workspace', files: [] })),
        },
      },
    });

    render(<WorkspaceFilesPanel projectFolder="C:/workspace" />);

    expect(await screen.findByRole('tree', { name: '工作区文件' })).toBeTruthy();
    const folder = screen.getByRole('treeitem', { name: 'src' });
    folder.focus();
    fireEvent.keyDown(folder, { key: 'ArrowRight' });
    expect(await screen.findByRole('treeitem', { name: '打开文件 src/app.ts' })).toBeTruthy();
    expect(folder.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(folder, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(
      screen.getByRole('treeitem', { name: '打开文件 src/app.ts' }),
    );
  });

  it('renders Markdown documents in the standalone workspace-file preview', async () => {
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: {
        runtime: {
          listProjectDir: vi.fn(async () => ({
            dir: '',
            entries: [{ path: 'README.md', name: 'README.md', kind: 'file' }],
          })),
          listProjectFiles: vi.fn(async () => ({ root: 'C:/workspace', files: [] })),
          readProjectFile: vi.fn(async () => ({
            path: 'README.md',
            content: '# Standalone preview\n\n- Rendered item',
            error: null,
            errorCode: null,
            mtimeMs: 10,
            size: 39,
          })),
        },
      },
    });

    render(<WorkspaceFilesPanel projectFolder="C:/workspace" />);

    fireEvent.click(await screen.findByRole('treeitem', { name: '打开文件 README.md' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Standalone preview' }),
    ).toBeTruthy();
    expect(document.querySelector('[data-preview-kind="markdown"]')).toBeTruthy();
    expect(document.querySelector('.shell-code-preview__ln')).toBeNull();
  });

  it('uses NewMax all/changes scopes without invented Git or review views', () => {
    const view = {
      runId: 'run-files',
      steps: [],
      fileChanges: [{ path: 'src/app.ts', action: 'edited' }],
      running: false,
      doneCount: 1,
      errorCount: 0,
    } as unknown as RunProcessView;
    render(<WorkspaceFilesPanel projectFolder="C:/workspace" reviewView={view} />);

    expect(screen.getByRole('tab', { name: '所有文件' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tab', { name: '对话文件 1' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.queryByRole('button', { name: '工作区文件更多操作' })).toBeNull();
    expect(screen.queryByText('Git 状态')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '对话文件 1' }));
    expect(screen.getByRole('tab', { name: '对话文件 1' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText('app.ts')).toBeTruthy();
  });
});

describe('ReviewPanel', () => {
  const reviewView = {
    runId: 'run-1',
    steps: [],
    fileChanges: [
      {
        path: 'src/app.ts',
        action: 'edited',
        previousContent: 'const value = 1;',
        content: 'const value = 2;',
      },
      {
        path: 'scripts/report.py',
        action: 'created',
        previousContent: '',
        content: 'print("ready")',
      },
    ],
    running: false,
    doneCount: 1,
    errorCount: 0,
  } as unknown as RunProcessView;

  it('renders a standalone file tree and switches the selected diff', () => {
    render(<ReviewPanel view={reviewView} projectFolder={'D:\\projects\\SYNC-THINK'} standalone />);

    expect(screen.getByTestId('review-panel').className).toContain('is-standalone');
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('scripts')).toBeTruthy();
    expect(document.querySelector('[data-file-type="typescript"]')).toBeTruthy();
    expect(document.querySelector('[data-file-type="python"]')).toBeTruthy();
    expect(document.querySelector('[data-path="src/app.ts"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('listitem', { name: /report\.py/ }));
    expect(document.querySelector('[data-path="scripts/report.py"]')).toBeTruthy();
  });

  it('opens the selected file and exposes its absolute path', () => {
    const onOpenFile = vi.fn();
    render(
      <ReviewPanel
        view={reviewView}
        projectFolder={'D:\\projects\\SYNC-THINK'}
        onOpenFile={onOpenFile}
      />,
    );

    const appItem = screen.getByRole('listitem', { name: /app\.ts/ });
    expect(appItem.getAttribute('title')).toBe('D:\\projects\\SYNC-THINK\\src\\app.ts');
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    expect(onOpenFile).toHaveBeenCalledWith('src/app.ts');
  });

  it('resizes the standalone change list with pointer and keyboard controls', () => {
    render(<ReviewPanel view={reviewView} standalone />);

    const panel = screen.getByTestId('review-panel');
    const reviewList = screen.getByRole('list', { name: '本轮变动文件' });
    const separator = screen.getByRole('separator', { name: '调整本轮变动宽度' });
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      width: 900,
      height: 700,
      top: 0,
      right: 900,
      bottom: 700,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(reviewList, 'getBoundingClientRect').mockReturnValue({
      width: 280,
      height: 700,
      top: 0,
      right: 900,
      bottom: 700,
      left: 620,
      x: 620,
      y: 0,
      toJSON: () => ({}),
    });

    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuenow')).toBe('288');
    fireEvent.pointerDown(separator, { clientX: 620, pointerId: 1 });
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.pointerMove(separator, { clientX: 540, pointerId: 1 });
    expect(separator.getAttribute('aria-valuenow')).toBe('360');
    expect(panel.style.getPropertyValue('--shell-review-list-width')).toBe('360px');
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('344');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('360');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('221');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator.getAttribute('aria-valuenow')).toBe('539');
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('288');
  });

  it('keeps enough room for the diff while resizing the change list', () => {
    render(<ReviewPanel view={reviewView} standalone />);

    const panel = screen.getByTestId('review-panel');
    const reviewList = screen.getByRole('list', { name: '本轮变动文件' });
    const separator = screen.getByRole('separator', { name: '调整本轮变动宽度' });
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 700,
      top: 0,
      right: 600,
      bottom: 700,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(reviewList, 'getBoundingClientRect').mockReturnValue({
      width: 280,
      height: 700,
      top: 0,
      right: 600,
      bottom: 700,
      left: 320,
      x: 320,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(separator, { clientX: 320, pointerId: 2 });
    fireEvent.pointerMove(separator, { clientX: -500, pointerId: 2 });
    expect(separator.getAttribute('aria-valuenow')).toBe('239');
    fireEvent.pointerUp(separator, { pointerId: 2 });
  });

  it('restores the intended list width after a temporary narrow layout', () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    render(<ReviewPanel view={reviewView} standalone />);

    const panel = screen.getByTestId('review-panel');
    const separator = screen.getByRole('separator', { name: '调整本轮变动宽度' });
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      width: 900,
      height: 700,
      top: 0,
      right: 900,
      bottom: 700,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    act(() => {
      resizeCallback?.(
        [{ contentRect: { width: 525 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('164');

    act(() => {
      resizeCallback?.(
        [{ contentRect: { width: 900 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('288');

    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator.getAttribute('aria-valuenow')).toBe('304');

    act(() => {
      resizeCallback?.(
        [{ contentRect: { width: 525 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
      resizeCallback?.(
        [{ contentRect: { width: 900 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('304');
  });
});
