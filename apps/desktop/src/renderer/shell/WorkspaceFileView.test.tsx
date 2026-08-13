/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

vi.mock('./FilePane.js', () => ({
  FilePane: (props: { onToggleWorkspaceFiles?(): void; workspaceFilesOpen?: boolean }) => (
    <div data-testid="mock-file-pane" data-explorer-open={String(props.workspaceFilesOpen)}>
      <button type="button" onClick={props.onToggleWorkspaceFiles}>
        切换工作区文件
      </button>
    </div>
  ),
}));

vi.mock('./RightDock.js', () => ({
  WorkspaceFilesPanel: (props: {
    onOpenFile?(path: string, location?: unknown): void;
    onOpenFileInNewTab?(path: string, location?: unknown): void;
  }) => (
    <div data-testid="mock-workspace-files-panel">
      <button type="button" onClick={() => props.onOpenFile?.('src/current.ts', undefined)}>
        当前标签打开
      </button>
      <button type="button" onClick={() => props.onOpenFileInNewTab?.('src/new.ts', undefined)}>
        新标签打开
      </button>
    </div>
  ),
}));

import { WorkspaceFileView } from './WorkspaceFileView.js';

afterEach(cleanup);

describe('WorkspaceFileView', () => {
  it('embeds an expanded workspace tree beside the file and can collapse it', () => {
    render(
      <WorkspaceFileView
        projectFolder="C:/workspace"
        path="src/index.ts"
        onOpenFileInCurrentTab={vi.fn()}
        onOpenFileInNewTab={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mock-file-pane').getAttribute('data-explorer-open')).toBe('true');
    expect(screen.getByTestId('mock-workspace-files-panel')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '切换工作区文件' }));
    expect(screen.queryByTestId('mock-workspace-files-panel')).toBeNull();
    expect(screen.getByTestId('mock-file-pane').getAttribute('data-explorer-open')).toBe('false');
  });

  it('routes embedded tree actions to the current file tab or a separate file tab', () => {
    const onOpenFileInCurrentTab = vi.fn();
    const onOpenFileInNewTab = vi.fn();
    render(
      <WorkspaceFileView
        projectFolder="C:/workspace"
        path="src/index.ts"
        onOpenFileInCurrentTab={onOpenFileInCurrentTab}
        onOpenFileInNewTab={onOpenFileInNewTab}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '当前标签打开' }));
    fireEvent.click(screen.getByRole('button', { name: '新标签打开' }));
    expect(onOpenFileInCurrentTab).toHaveBeenCalledWith('src/current.ts', undefined);
    expect(onOpenFileInNewTab).toHaveBeenCalledWith('src/new.ts', undefined);
  });

  it('resizes the embedded workspace tree with pointer and keyboard controls', () => {
    render(
      <WorkspaceFileView
        projectFolder="C:/workspace"
        path="src/index.ts"
        onOpenFileInCurrentTab={vi.fn()}
        onOpenFileInNewTab={vi.fn()}
      />,
    );

    const layout = screen.getByTestId('workspace-file-layout');
    const explorer = screen.getByTestId('workspace-file-explorer');
    const separator = screen.getByRole('separator', { name: '调整工作区文件宽度' });
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
      width: 1_000,
      height: 700,
      top: 0,
      right: 1_000,
      bottom: 700,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(explorer, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 700,
      top: 0,
      right: 1_000,
      bottom: 700,
      left: 700,
      x: 700,
      y: 0,
      toJSON: () => ({}),
    });

    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    expect(separator.getAttribute('aria-valuenow')).toBe('30');
    fireEvent.pointerDown(separator, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(separator, { pointerId: 1 });

    expect(separator.getAttribute('aria-valuenow')).toBe('40');
    expect(
      screen
        .getByTestId('workspace-file-view')
        .style.getPropertyValue('--shell-file-explorer-width'),
    ).toBe('40%');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator.getAttribute('aria-valuenow')).toBe('35');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator.getAttribute('aria-valuenow')).toBe('22');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator.getAttribute('aria-valuenow')).toBe('60');
    fireEvent.doubleClick(separator);
    expect(separator.getAttribute('aria-valuenow')).toBe('30');
  });

  it('clamps drag resizing so both the editor and explorer remain usable', () => {
    render(
      <WorkspaceFileView
        projectFolder="C:/workspace"
        path="src/index.ts"
        onOpenFileInCurrentTab={vi.fn()}
        onOpenFileInNewTab={vi.fn()}
      />,
    );

    const layout = screen.getByTestId('workspace-file-layout');
    const explorer = screen.getByTestId('workspace-file-explorer');
    const separator = screen.getByRole('separator', { name: '调整工作区文件宽度' });
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
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
    vi.spyOn(explorer, 'getBoundingClientRect').mockReturnValue({
      width: 220,
      height: 700,
      top: 0,
      right: 600,
      bottom: 700,
      left: 380,
      x: 380,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(separator, { clientX: 380, pointerId: 2 });
    fireEvent.pointerMove(separator, { clientX: -500, pointerId: 2 });
    expect(separator.getAttribute('aria-valuenow')).toBe('53');
    fireEvent.pointerMove(separator, { clientX: 1_500, pointerId: 2 });
    expect(separator.getAttribute('aria-valuenow')).toBe('37');
    fireEvent.pointerUp(separator, { pointerId: 2 });
  });

  it('ends an active resize when the window loses focus', () => {
    render(
      <WorkspaceFileView
        projectFolder="C:/workspace"
        path="src/index.ts"
        onOpenFileInCurrentTab={vi.fn()}
        onOpenFileInNewTab={vi.fn()}
      />,
    );

    const layout = screen.getByTestId('workspace-file-layout');
    const explorer = screen.getByTestId('workspace-file-explorer');
    const separator = screen.getByRole('separator', { name: '调整工作区文件宽度' });
    vi.spyOn(layout, 'getBoundingClientRect').mockReturnValue({
      width: 1_000,
      height: 700,
      top: 0,
      right: 1_000,
      bottom: 700,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(explorer, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 700,
      top: 0,
      right: 1_000,
      bottom: 700,
      left: 700,
      x: 700,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(separator, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(separator, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(separator, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => true),
    });

    fireEvent.pointerDown(separator, { clientX: 700, pointerId: 3 });
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.blur(window);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');

    fireEvent.pointerMove(separator, { clientX: 500, pointerId: 3 });
    expect(separator.getAttribute('aria-valuenow')).toBe('30');
  });
});
