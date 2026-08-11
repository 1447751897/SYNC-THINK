import { useState } from 'react';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { FilePane, type FileRevealTarget } from './FilePane.js';
import { WorkspaceFilesPanel } from './RightDock.js';

export function WorkspaceFileView({
  projectFolder,
  path,
  revealTarget,
  onDirtyChange,
  onOpenFileInCurrentTab,
  onOpenFileInNewTab,
}: {
  projectFolder?: string;
  path: string;
  revealTarget?: FileRevealTarget;
  onDirtyChange?(dirty: boolean): void;
  onOpenFileInCurrentTab(path: string, location?: ProjectTextLocation): void;
  onOpenFileInNewTab(path: string, location?: ProjectTextLocation): void;
}) {
  const [workspaceFilesOpen, setWorkspaceFilesOpen] = useState(true);

  return (
    <div
      className="shell-file-workbench"
      data-testid="workspace-file-view"
      data-explorer-open={workspaceFilesOpen ? 'true' : 'false'}
    >
      <div className="shell-file-workbench__layout">
        <div className="shell-file-workbench__editor">
          <FilePane
            projectFolder={projectFolder}
            path={path}
            revealTarget={revealTarget}
            onDirtyChange={onDirtyChange}
            workspaceFilesOpen={workspaceFilesOpen}
            onToggleWorkspaceFiles={() => setWorkspaceFilesOpen((open) => !open)}
          />
        </div>
        {workspaceFilesOpen ? (
          <aside
            className="shell-file-workbench__explorer"
            aria-label="嵌入的工作区文件"
            data-testid="workspace-file-explorer"
          >
            <WorkspaceFilesPanel
              projectFolder={projectFolder}
              activeFilePath={path}
              onOpenFile={onOpenFileInCurrentTab}
              onOpenFileInNewTab={onOpenFileInNewTab}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
