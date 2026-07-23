// NewMax-style top bar: project (=workspace) tabs + open-folder (P0.3).
// The active project filters the sidebar's recent conversations; "全部" shows
// everything including 未归类 conversations with no workspace.
import { FolderOpen, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { WorkspaceSummary } from '@sync-think/protocol';

export interface TopBarProps {
  workspaces: readonly WorkspaceSummary[];
  /** undefined = 全部（no filter）. */
  activeWorkspaceId?: string;
  onSelectWorkspace(workspaceId: string | undefined): void;
  onOpenFolder(): void;
}

export function TopBar(props: TopBarProps) {
  return (
    <header
      data-testid="shell-topbar"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-surface px-2"
    >
      <ProjectTab
        label="全部"
        active={props.activeWorkspaceId === undefined}
        onClick={() => props.onSelectWorkspace(undefined)}
      />
      {props.workspaces.map((workspace) => (
        <ProjectTab
          key={workspace.workspaceId}
          label={workspace.name}
          title={workspace.folderPath}
          active={props.activeWorkspaceId === workspace.workspaceId}
          onClick={() => props.onSelectWorkspace(workspace.workspaceId)}
        />
      ))}
      <button
        data-testid="topbar-open-folder"
        className="flex h-7 items-center gap-1 rounded-(--radius-row) px-2 text-[12px] text-text-secondary hover:bg-hover hover:text-text"
        title="打开文件夹作为项目"
        onClick={props.onOpenFolder}
      >
        <Plus size={13} />
        <FolderOpen size={13} />
      </button>
    </header>
  );
}

function ProjectTab(props: {
  label: string;
  title?: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      data-testid={`project-tab-${props.label}`}
      title={props.title}
      className={clsx(
        'flex h-7 max-w-[180px] items-center rounded-(--radius-row) px-3 text-[12.5px]',
        props.active
          ? 'bg-accent-soft text-accent-text'
          : 'text-text-secondary hover:bg-hover hover:text-text',
      )}
      onClick={props.onClick}
    >
      <span className="truncate">{props.label}</span>
    </button>
  );
}
