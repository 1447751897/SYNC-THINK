import { FilePane, type FileRevealTarget } from './FilePane.js';

export interface WorkspaceFileViewProps {
  projectFolder?: string;
  path: string;
  revealTarget?: FileRevealTarget;
  onDirtyChange?(dirty: boolean): void;
}

/**
 * Main-pane file content only. The project tree is owned exclusively by
 * WorkspaceWorkbench so it can never leak into chat, document, or canvas panes.
 */
export function WorkspaceFileView({
  projectFolder,
  path,
  revealTarget,
  onDirtyChange,
}: WorkspaceFileViewProps) {
  return (
    <div className="shell-file-workbench" data-testid="workspace-file-view">
      <div className="shell-file-workbench__layout" data-testid="workspace-file-layout">
        <div className="shell-file-workbench__editor">
          <FilePane
            projectFolder={projectFolder}
            path={path}
            revealTarget={revealTarget}
            onDirtyChange={onDirtyChange}
          />
        </div>
      </div>
    </div>
  );
}
