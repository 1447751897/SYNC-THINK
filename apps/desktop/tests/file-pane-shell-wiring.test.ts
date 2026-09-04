import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const shellSource = readFileSync(
  new URL('../src/renderer/shell/ShellApp.tsx', import.meta.url),
  'utf8',
);
const chatSource = readFileSync(
  new URL('../src/renderer/shell/ChatView.tsx', import.meta.url),
  'utf8',
);
const workspaceFileViewSource = readFileSync(
  new URL('../src/renderer/shell/WorkspaceFileView.tsx', import.meta.url),
  'utf8',
);

describe('unified file pane shell wiring', () => {
  it('renders file resources from the workspace pane snapshot', () => {
    expect(shellSource).toContain("from './FilePane.js'");
    expect(shellSource).toContain('openFileInPane');
    expect(shellSource).toContain('activateFilePaneTab');
    expect(shellSource).toContain('closeFilePaneTab');
    expect(shellSource).toContain('isFilePaneSessionDirty');
    expect(shellSource).toContain('clearFilePaneSession');
    expect(shellSource).toContain("title: '关闭未保存的文件'");
    expect(shellSource).toContain('fileTabs={localFileTabs}');
    expect(shellSource).toContain('activeFilePath={activeFilePath}');
    expect(shellSource).toContain('<WorkspaceFileView');
    expect(shellSource).toContain('path={activeTab.path}');
    expect(shellSource).toContain('onDirtyChange={(dirty) =>');
    expect(workspaceFileViewSource).not.toContain('WorkspaceFilesPanel');
    expect(shellSource).toContain('toggleWorkspaceFilesWorkbench');
    expect(shellSource).toContain('<WorkspaceFilesPanel');
  });

  it('routes file and review actions through the shell-owned pane layout', () => {
    expect(shellSource).toContain('handleOpenFileInPane(pane.id, path, location)');
    expect(shellSource).toContain('handleOpenFileInSplit(pane.id, path, location)');
    expect(shellSource).toContain('handleOpenReviewInSplit(pane.id, view)');
    expect(chatSource).toContain(
      'onOpenFile?: (path: string, location?: ProjectTextLocation) => void',
    );
    expect(chatSource).toContain('onOpenReview?: (view: RunProcessView) => void');
    expect(chatSource).toContain('onOpenChange={onOpenFile}');
    expect(chatSource).toContain('onOpenReview={onOpenReview}');
    expect(chatSource).not.toContain("import { RightDock } from './RightDock.js'");
    expect(chatSource).not.toContain('data-testid="file-split-pane"');
    expect(chatSource).not.toContain('const [splitFile');
  });
});
