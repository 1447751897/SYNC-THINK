/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
