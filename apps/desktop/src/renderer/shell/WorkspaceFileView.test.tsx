/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./FilePane.js', () => ({
  FilePane: (props: {
    projectFolder?: string;
    path: string;
    revealTarget?: { line: number; column: number; nonce: number };
    onDirtyChange?(dirty: boolean): void;
  }) => (
    <div
      data-testid="mock-file-pane"
      data-project-folder={props.projectFolder}
      data-path={props.path}
      data-reveal-line={props.revealTarget?.line}
    >
      <button type="button" onClick={() => props.onDirtyChange?.(true)}>
        标记修改
      </button>
    </div>
  ),
}));

vi.mock('./RightDock.js', () => ({
  WorkspaceFilesPanel: () => <div data-testid="mock-workspace-files-panel" />,
}));

import { WorkspaceFileView } from './WorkspaceFileView.js';

afterEach(cleanup);

describe('WorkspaceFileView', () => {
  it('keeps workspace files out of the main content view', () => {
    render(<WorkspaceFileView projectFolder="C:/workspace" path="src/index.ts" />);

    expect(screen.getByTestId('mock-file-pane')).toBeTruthy();
    expect(screen.queryByTestId('mock-workspace-files-panel')).toBeNull();
    expect(screen.queryByTestId('workspace-file-explorer')).toBeNull();
    expect(screen.queryByRole('separator', { name: '调整工作区文件宽度' })).toBeNull();
  });

  it('forwards only editor state to the file pane', () => {
    const onDirtyChange = vi.fn();
    render(
      <WorkspaceFileView
        projectFolder="C:/workspace"
        path="notes/spec.md"
        revealTarget={{ line: 12, column: 3, nonce: 1 }}
        onDirtyChange={onDirtyChange}
      />,
    );

    const filePane = screen.getByTestId('mock-file-pane');
    expect(filePane.getAttribute('data-project-folder')).toBe('C:/workspace');
    expect(filePane.getAttribute('data-path')).toBe('notes/spec.md');
    expect(filePane.getAttribute('data-reveal-line')).toBe('12');
    fireEvent.click(screen.getByRole('button', { name: '标记修改' }));
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('keeps canvases full-width without injecting a project tree', () => {
    render(<WorkspaceFileView projectFolder="C:/workspace" path="designs/board.excalidraw" />);

    expect(screen.getByTestId('workspace-file-layout')).toBeTruthy();
    expect(screen.queryByTestId('mock-workspace-files-panel')).toBeNull();
  });
});
