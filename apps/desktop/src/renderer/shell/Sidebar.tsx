import { useContextMenu } from './ContextMenu.js';
import { SidebarNavigationRail } from './SidebarNavigationRail.js';
import { SidebarChatActions, SidebarChatSearch } from './SidebarChatActions.js';
import { ATTENTION_LABELS, type ConversationActivityView } from '../../conversation-attention.js';
import { SidebarThinkingIndicator } from './SidebarThinkingIndicator.js';
// NewMax-style sidebar (shell constitution):
// fixed navigation + account rail · switchable conversation/agent list.
// Collapsed = fully hidden (parent omits this component). Width is resizable.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useDialog } from './Dialog.js';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  ChevronRight,
  Copy,
  FolderInput,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import syncThinkLogo from './assets/sync-think-logo.png';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { readSidebarMode, writeSidebarMode } from './agent-contacts.js';
import { isAgentConversation } from './conversation-surface.js';
import type { Conversation, ConversationTrack, GlobalAgent, Team } from '@sync-think/shared';
import type { ConversationGroupPreference, ConversationGroupsByTrack } from '../ui-preferences.js';
import {
  TRACK_LABELS,
  buildTrackTree,
  formatConversationRowTime,
  resolveConversationRowMark,
  targetName,
  type ConversationRowMark,
  type ShellNavState,
  type ShellStage,
  type TeamRowMemberMark,
} from './shell-state.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { useCollaborationRoster } from './collaboration-roster-store.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo } from './brand-icons.js';
import {
  SIDEBAR_WORKSPACE_SKELETON_ROW_WIDTHS,
  shouldRenderRecentConversationEmptyState,
  shouldShowSidebarWorkspaceListSkeleton,
} from './sidebar-newmax-loading.js';
import { readWorkspaceExpansion, writeWorkspaceExpansion } from './sidebar-workspace-expansion.js';
import { resolvePendingUpdateVersion, useDesktopUpdateState } from './use-desktop-update-state.js';

const AgentContactsSidebar = lazy(() => import('./AgentContactsSidebar.js'));
const EMPTY_WORKSPACES: readonly WorkspaceSummary[] = [];
// Agent and team histories live in the agent area, not the recent-chat list.
const RECENT_CONVERSATION_TRACKS: readonly ConversationTrack[] = ['model'];

export interface SidebarProps {
  nav: ShellNavState;
  width: number;
  /** When true the sidebar stays mounted but animates to zero width. */
  collapsed?: boolean;
  conversations: readonly Conversation[];
  agents: readonly GlobalAgent[];
  teams: readonly Team[];
  modelNames: ReadonlyMap<string, string>;
  /** Per-conversation compose model overrides (model-track identity). */
  modelOverrides?: Readonly<Record<string, string>>;
  /** Per-conversation compose kernel overrides (model-track logo). */
  kernelOverrides?: Readonly<Record<string, string>>;
  groups: ConversationGroupsByTrack;
  workspaceGroups?: Readonly<Record<string, ConversationGroupsByTrack>>;
  bootState?: 'loading' | 'ready' | 'error';
  bootError?: string;
  activeWorkspaceId?: string;
  workspaces?: readonly WorkspaceSummary[];
  onSelectWorkspace?(workspaceId: string): void;
  workspaceActivity?: ReadonlyMap<string, ConversationActivityView>;
  sidebarMode?: 'conversations' | 'agents';
  onSidebarModeChange?(mode: 'conversations' | 'agents'): void;
  onAgentSidebarMount?(host: HTMLDivElement | null): void;
  onAgentActionsMount?(host: HTMLDivElement | null): void;
  onAgentChat?(agentId: string, workspaceId: string, newConversation?: boolean): void;
  onAgentsRefresh?(): Promise<unknown> | void;
  settingsOpen?: boolean;
  multiSelect: boolean;
  selectedIds: ReadonlySet<string>;
  /** 各对话运行/未读状态（key = conversationId）。 */
  conversationActivity?: ReadonlyMap<string, ConversationActivityView>;
  onSelectStage(stage: ShellStage): void;
  onToggleTrack(track: ConversationTrack): void;
  onToggleSidebar(): void;
  onOpenConversation(id: string): void;
  onNewConversation(track?: ConversationTrack, workspaceId?: string): void;
  onTogglePin(id: string, pinned: boolean): void;
  onRename(id: string, currentTitle: string): void;
  onArchive(id: string): void;
  onUnarchive?(id: string): void;
  onDelete(id: string): void;
  onDuplicate?(id: string): void;
  onCopyLink?(id: string): void;
  onCreateGroup(track: ConversationTrack, name: string, workspaceId?: string): void;
  onRenameGroup(
    track: ConversationTrack,
    groupId: string,
    name: string,
    workspaceId?: string,
  ): void;
  onDeleteGroup(track: ConversationTrack, groupId: string, workspaceId?: string): void;
  onToggleGroupCollapsed(track: ConversationTrack, groupId: string, workspaceId?: string): void;
  onMoveToGroup(
    track: ConversationTrack,
    conversationId: string,
    groupId: string | null,
    workspaceId?: string,
  ): void;
  onToggleMultiSelect(): void;
  onToggleSelected(id: string): void;
  onBulkArchive(): void;
  onBulkDelete(): void;
  onBulkMoveToGroup(track: ConversationTrack, groupId: string | null): void;
  onResizeStart(clientX: number): void;
}

export function Sidebar(props: SidebarProps) {
  const [localSidebarMode, setLocalSidebarMode] = useState(readSidebarMode);
  const sidebarMode = props.sidebarMode ?? localSidebarMode;
  const onSidebarModeChange = props.onSidebarModeChange;
  const selectSidebarMode = useCallback((mode: 'conversations' | 'agents') => {
    setLocalSidebarMode(mode);
    writeSidebarMode(mode);
    onSidebarModeChange?.(mode);
  }, [onSidebarModeChange]);
  const [query, setQuery] = useState('');
  const [legacyArchiveOpen, setArchiveOpen] = useState(false);
  /** Collapsing 最近对话 hides the regular conversation groups. */
  const [legacyRecentOpen, setRecentOpen] = useState(true);
  const [workspaceExpansion, setWorkspaceExpansion] = useState(() => {
    const saved = readWorkspaceExpansion();
    const id = props.activeWorkspaceId;
    return id && saved[id] === undefined ? { ...saved, [id]: true } : saved;
  });
  const [workspaceArchives, setWorkspaceArchives] = useState<Readonly<Record<string, boolean>>>({});
  useEffect(() => writeWorkspaceExpansion(workspaceExpansion), [workspaceExpansion]);
  useEffect(() => {
    const id = props.activeWorkspaceId;
    if (id)
      setWorkspaceExpansion((current) =>
        current[id] === undefined ? { ...current, [id]: true } : current,
      );
  }, [props.activeWorkspaceId]);
  const [searchFocused, setSearchFocused] = useState(false);
  const dialog = useDialog();
  // 与「设置 → 关于」共用同一份更新快照：有可安装版本时把版本号挂到设置入口上，
  // 用户不进设置也能看见有新版本。bridge 缺失时这里是 null，不显示任何提示。
  const { snapshot: updateSnapshot } = useDesktopUpdateState();
  const pendingUpdateVersion = resolvePendingUpdateVersion(updateSnapshot);

  useEffect(() => {
    const openSearch = () => {
      if (sidebarMode === 'agents') return;
      selectSidebarMode('conversations');
      setSearchFocused(true);
    };
    window.addEventListener('shell-open-conversation-search', openSearch);
    return () => window.removeEventListener('shell-open-conversation-search', openSearch);
  }, [sidebarMode, selectSidebarMode]);

  const resolveName = useMemo(
    () => (c: Conversation) =>
      targetName(c, props.agents, props.teams, props.modelNames, props.modelOverrides),
    [props.agents, props.modelNames, props.modelOverrides, props.teams],
  );

  const { active } = useMemo(() => {
    const a: Conversation[] = [];
    const ar: Conversation[] = [];
    for (const c of props.conversations) {
      if (isAgentConversation(c)) continue;
      if (c.archivedAt) ar.push(c);
      else a.push(c);
    }
    return { active: a, archived: ar };
  }, [props.conversations]);

  const filterQ = useCallback(
    (list: readonly Conversation[]) => {
      const q = query.trim().toLowerCase();
      if (!q) return [...list];
      return list.filter((c) => {
        const title = (c.title || '').toLowerCase();
        const name = resolveName(c).toLowerCase();
        const ref = (c.targetRef || '').toLowerCase();
        return title.includes(q) || name.includes(q) || ref.includes(q);
      });
    },
    [query, resolveName],
  );

  const filteredActive = useMemo(() => filterQ(active), [active, filterQ]);

  const collapsed = props.collapsed === true;
  const targetWidth = collapsed ? 0 : props.width;
  const isLoadingConversations = props.bootState === 'loading';

  const projectNavigation = Boolean(props.onSelectWorkspace && props.workspaces?.length);
  const visibleWorkspaces = (props.workspaces ?? []).filter(
    (workspace) => !workspace.hidden || workspace.workspaceId === props.activeWorkspaceId,
  );

  const renderWorkspaceSection = (workspace?: WorkspaceSummary) => {
    const workspaceId = workspace?.workspaceId ?? props.activeWorkspaceId ?? null;
    const isCurrent = !workspace || workspace.workspaceId === props.activeWorkspaceId;
    const localGroups = workspace
      ? (props.workspaceGroups?.[workspace.workspaceId] ??
        (isCurrent ? props.groups : { model: [], agent: [], team: [] }))
      : props.groups;
    const sectionProps: SidebarProps = {
      ...props,
      groups: localGroups,
      multiSelect: props.multiSelect && isCurrent,
      onToggleMultiSelect: () => {
        if (workspace && !isCurrent) props.onSelectWorkspace?.(workspace.workspaceId);
        props.onToggleMultiSelect();
      },
      onNewConversation: (track) =>
        workspace
          ? props.onNewConversation(track, workspace.workspaceId)
          : props.onNewConversation(track),
      onCreateGroup: (track, name) =>
        workspace
          ? props.onCreateGroup(track, name, workspace.workspaceId)
          : props.onCreateGroup(track, name),
      onRenameGroup: (track, id, name) =>
        workspace
          ? props.onRenameGroup(track, id, name, workspace.workspaceId)
          : props.onRenameGroup(track, id, name),
      onDeleteGroup: (track, id) =>
        workspace
          ? props.onDeleteGroup(track, id, workspace.workspaceId)
          : props.onDeleteGroup(track, id),
      onToggleGroupCollapsed: (track, id) =>
        workspace
          ? props.onToggleGroupCollapsed(track, id, workspace.workspaceId)
          : props.onToggleGroupCollapsed(track, id),
      onMoveToGroup: (track, id, group) =>
        workspace
          ? props.onMoveToGroup(track, id, group, workspace.workspaceId)
          : props.onMoveToGroup(track, id, group),
    };
    const localActive = workspace
      ? filteredActive.filter((c) => c.workspaceId === workspace.workspaceId)
      : filteredActive;
    const archived = workspace
      ? props.conversations.filter(
          (c) => !isAgentConversation(c) && c.archivedAt && c.workspaceId === workspace.workspaceId,
        )
      : props.conversations.filter((c) => !isAgentConversation(c) && c.archivedAt);
    const filteredArchived = filterQ(archived);
    const recentTree = buildTrackTree(localActive, localGroups.model);
    const recentOpen = workspace
      ? query.trim()
        ? localActive.length > 0 || filteredArchived.length > 0
        : (workspaceExpansion[workspace.workspaceId] ?? isCurrent)
      : legacyRecentOpen;
    const archiveOpen = workspace
      ? (workspaceArchives[workspace.workspaceId] ?? false)
      : legacyArchiveOpen;
    const setSectionOpen = (value: boolean | ((open: boolean) => boolean)) => {
      if (!workspace) {
        setRecentOpen(value);
        return;
      }
      setWorkspaceExpansion((current) => ({
        ...current,
        [workspace.workspaceId]:
          typeof value === 'function' ? value(current[workspace.workspaceId] ?? isCurrent) : value,
      }));
    };
    const setSectionArchiveOpen = (value: boolean | ((open: boolean) => boolean)) => {
      if (!workspace) {
        setArchiveOpen(value);
        return;
      }
      setWorkspaceArchives((current) => ({
        ...current,
        [workspace.workspaceId]:
          typeof value === 'function' ? value(current[workspace.workspaceId] ?? false) : value,
      }));
    };
    const sidebarWorkspaceListsLoading =
      query.trim().length === 0 &&
      shouldShowSidebarWorkspaceListSkeleton({
        activeWorkspaceId: workspaceId,
        switchContentWorkspaceId: workspaceId,
        switchProjectsWorkspaceId: workspaceId,
        isLoadingConversations,
        conversationCount: localActive.length,
        projectCount: 0,
        archivedLoaded: true,
        isLoadingArchived: false,
      });
    return (
      <div
        key={workspaceId ?? 'recent'}
        data-testid={workspace ? `sidebar-workspace-section-${workspaceId}` : undefined}
        data-workspace-active={isCurrent ? 'true' : undefined}
      >
        <div className="shell-sidebar-project-heading group flex h-8 items-center gap-1 rounded-(--radius-row) px-1.5 hover:bg-hover">
          <button
            type="button"
            data-testid={isCurrent ? 'recent-section-toggle' : `sidebar-workspace-${workspaceId}`}
            aria-label={
              workspace ? `${recentOpen ? '收起' : '展开'}工作区 ${workspace.name}` : undefined
            }
            className="st-press-motion st-row-motion flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
            onClick={() => setSectionOpen((v) => !v)}
            aria-expanded={recentOpen}
            aria-controls={workspace ? `sidebar-workspace-content-${workspaceId}` : undefined}
            title={workspace?.folderPath}
          >
            {projectNavigation && workspace ? (
              recentOpen ? (
                <FolderOpen size={17} aria-hidden="true" />
              ) : (
                <Folder size={17} aria-hidden="true" />
              )
            ) : (
              <ChevronRight
                size={13}
                className="st-chevron text-text-faint"
                data-open={recentOpen}
              />
            )}
            <span className="shell-sidebar-project-title flex-1 truncate text-[14px] font-semibold tracking-wide text-text-faint">
              {projectNavigation && workspace ? workspace.name : '最近对话'}
            </span>
            {workspace && (
              <RowActivityDot activity={props.workspaceActivity?.get(workspace.workspaceId)} />
            )}
          </button>
          <button
            type="button"
            data-testid={isCurrent ? 'recent-new-group' : `recent-new-group-${workspaceId}`}
            className="st-icon-motion invisible flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible focus:visible"
            title="新建分组"
            onClick={async () => {
              const name = await dialog.prompt({
                title: '新建分组',
                message: '为最近对话新建一个分组',
                placeholder: '分组名称',
                confirmText: '新建',
              });
              if (!name?.trim()) return;
              sectionProps.onCreateGroup('model', name.trim());
              setSectionOpen(true);
            }}
          >
            <FolderPlus size={12} />
          </button>
          <button
            type="button"
            data-testid={
              isCurrent ? 'recent-new-conversation' : `recent-new-conversation-${workspaceId}`
            }
            className="st-icon-motion invisible flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible focus:visible"
            title="新建对话"
            onClick={() => {
              sectionProps.onNewConversation('model');
              setSectionOpen(true);
            }}
          >
            <Plus size={13} />
          </button>
        </div>

        <div
          id={workspace ? `sidebar-workspace-content-${workspaceId}` : undefined}
          aria-hidden={!recentOpen}
          className={clsx('shell-collapse', recentOpen && 'shell-collapse--open')}
        >
          <div className="shell-collapse__inner">
            {sidebarWorkspaceListsLoading ? (
              <SidebarWorkspaceListSkeleton />
            ) : (
              <div>
                {recentTree.groups.map(({ group, conversations: groupItems }) => (
                  <GroupBlock
                    key={group.id}
                    track="model"
                    group={group}
                    conversations={groupItems}
                    allGroups={sectionProps.groups.model ?? []}
                    selectedConversationId={sectionProps.nav.selectedConversationId}
                    multiSelect={sectionProps.multiSelect}
                    selectedIds={sectionProps.selectedIds}
                    resolveName={resolveName}
                    onToggleCollapsed={() => sectionProps.onToggleGroupCollapsed('model', group.id)}
                    onRenameGroup={async () => {
                      const name = await dialog.prompt({
                        title: '重命名分组',
                        message: '为这个分组设置一个新名称',
                        defaultValue: group.name,
                        placeholder: '分组名称',
                        confirmText: '保存',
                      });
                      if (!name?.trim() || name.trim() === group.name) return;
                      sectionProps.onRenameGroup('model', group.id, name.trim());
                    }}
                    onDeleteGroup={async () => {
                      if (
                        !(await dialog.confirm({
                          title: '删除分组',
                          message: `删除分组「${group.name}」？组内对话会回到未分组，不会被删除。`,
                          confirmText: '删除',
                          danger: true,
                        }))
                      ) {
                        return;
                      }
                      sectionProps.onDeleteGroup('model', group.id);
                    }}
                    onOpenConversation={sectionProps.onOpenConversation}
                    onTogglePin={sectionProps.onTogglePin}
                    onRename={sectionProps.onRename}
                    onArchive={sectionProps.onArchive}
                    onDelete={sectionProps.onDelete}
                    onDuplicate={sectionProps.onDuplicate}
                    onCopyLink={sectionProps.onCopyLink}
                    onMoveToGroup={sectionProps.onMoveToGroup}
                    onToggleSelected={sectionProps.onToggleSelected}
                    onToggleMultiSelect={sectionProps.onToggleMultiSelect}
                    conversationActivity={sectionProps.conversationActivity}
                    agents={sectionProps.agents}
                    teams={sectionProps.teams}
                    kernelOverrides={sectionProps.kernelOverrides}
                  />
                ))}

                {recentTree.ungrouped.length === 0 && recentTree.groups.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-2 py-2.5 text-center">
                    <MessageSquare
                      size={14}
                      className="text-text-faint opacity-50"
                      aria-hidden="true"
                    />
                    <div className="text-[11px] text-text-faint">
                      {sectionProps.bootState === 'error'
                        ? sectionProps.bootError || '连接失败'
                        : query.trim()
                          ? '无匹配'
                          : shouldRenderRecentConversationEmptyState({
                                conversationCount: 0,
                                isSyncingCCHistory: false,
                                isLoadingConversations,
                                activeWorkspaceId: workspaceId,
                                switchContentWorkspaceId: workspaceId,
                                switchProjectsWorkspaceId: workspaceId,
                              })
                            ? '暂无对话'
                            : ''}
                    </div>
                  </div>
                ) : (
                  recentTree.ungrouped.map((c) => (
                    <ConversationRow
                      key={c.id}
                      conversation={c}
                      name={resolveName(c)}
                      mark={resolveConversationRowMark(
                        c,
                        sectionProps.agents,
                        sectionProps.teams,
                        sectionProps.kernelOverrides,
                      )}
                      active={sectionProps.nav.selectedConversationId === c.id}
                      multiSelect={sectionProps.multiSelect}
                      selected={sectionProps.selectedIds.has(c.id)}
                      groups={sectionProps.groups.model ?? []}
                      track="model"
                      onOpen={() => sectionProps.onOpenConversation(c.id)}
                      onTogglePin={() => sectionProps.onTogglePin(c.id, !c.pinnedAt)}
                      onRename={() => sectionProps.onRename(c.id, c.title || resolveName(c))}
                      onArchive={() => sectionProps.onArchive(c.id)}
                      onDelete={() => sectionProps.onDelete(c.id)}
                      onDuplicate={() => sectionProps.onDuplicate?.(c.id)}
                      onCopyLink={() => sectionProps.onCopyLink?.(c.id)}
                      onMoveToGroup={(groupId) =>
                        sectionProps.onMoveToGroup('model', c.id, groupId)
                      }
                      onToggleSelected={() => sectionProps.onToggleSelected(c.id)}
                      onStartMultiSelect={sectionProps.onToggleMultiSelect}
                      activity={sectionProps.conversationActivity?.get(String(c.id))}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {recentOpen && (filteredArchived.length > 0 || archived.length > 0) && (
          <div className="mt-2 border-t border-border pt-1.5">
            <button
              type="button"
              data-testid={
                isCurrent ? 'archive-section-toggle' : `archive-section-toggle-${workspaceId}`
              }
              className="st-press-motion st-row-motion group flex h-7 w-full cursor-pointer items-center gap-1 rounded-(--radius-row) px-1.5 text-left hover:bg-hover"
              onClick={() => setSectionArchiveOpen((v) => !v)}
            >
              <ChevronRight
                size={13}
                className="st-chevron text-text-faint"
                data-open={archiveOpen}
              />
              <Archive size={13} className="text-text-secondary" />
              <span className="flex-1 text-[12px] text-text-secondary">归档</span>
              <span className="text-[10.5px] text-text-faint">{filteredArchived.length}</span>
            </button>
            <div className={clsx('shell-collapse', archiveOpen && 'shell-collapse--open')}>
              <div className="shell-collapse__inner">
                <div className="ml-1">
                  {filteredArchived.length === 0 ? (
                    <div className="px-2 py-1 text-[11px] text-text-faint">
                      {query.trim() ? '无匹配' : '暂无归档'}
                    </div>
                  ) : (
                    filteredArchived.map((c) => (
                      <ConversationRow
                        key={c.id}
                        conversation={c}
                        name={resolveName(c)}
                        mark={resolveConversationRowMark(
                          c,
                          sectionProps.agents,
                          sectionProps.teams,
                          sectionProps.kernelOverrides,
                        )}
                        active={sectionProps.nav.selectedConversationId === c.id}
                        archived
                        multiSelect={sectionProps.multiSelect}
                        selected={sectionProps.selectedIds.has(c.id)}
                        groups={sectionProps.groups[c.track] ?? []}
                        track={c.track}
                        onOpen={() => sectionProps.onOpenConversation(c.id)}
                        onTogglePin={() => sectionProps.onTogglePin(c.id, !c.pinnedAt)}
                        onRename={() => sectionProps.onRename(c.id, c.title || resolveName(c))}
                        onArchive={() => sectionProps.onUnarchive?.(c.id)}
                        onDelete={() => sectionProps.onDelete(c.id)}
                        onDuplicate={() => sectionProps.onDuplicate?.(c.id)}
                        onCopyLink={() => sectionProps.onCopyLink?.(c.id)}
                        onMoveToGroup={(groupId) =>
                          sectionProps.onMoveToGroup(c.track, c.id, groupId)
                        }
                        onToggleSelected={() => sectionProps.onToggleSelected(c.id)}
                        onStartMultiSelect={sectionProps.onToggleMultiSelect}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      data-testid="shell-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={clsx(
        'shell-board shell-sidebar-panel shell-sidebar-panel--rail shell-sidebar--chat relative flex min-h-0 shrink-0 flex-row border border-border bg-sidebar',
        collapsed && 'shell-sidebar-panel--collapsed',
      )}
      style={{
        width: targetWidth,
        minWidth: targetWidth,
        maxWidth: targetWidth,
        // Keep inner content at the expanded width so text doesn't reflow mid-animation.
        ['--sidebar-width' as string]: `${props.width}px`,
        opacity: collapsed ? 0 : 1,
        // Collapse the boards gap too, otherwise a 9px empty seam remains.
        marginRight: collapsed ? 'calc(-1 * var(--shell-board-gap))' : 0,
        pointerEvents: collapsed ? 'none' : undefined,
        overflow: 'hidden',
      }}
      aria-hidden={collapsed}
    >
      {/* Body is width-locked for collapse animation; resize handle stays outside. */}
      <SidebarNavigationRail stage={props.nav.stage} onSelectStage={props.onSelectStage}
        settingsOpen={props.settingsOpen} pendingUpdateVersion={pendingUpdateVersion ?? undefined} onHome={() => {
        selectSidebarMode('conversations');
        props.onSelectStage('talk');
      }} />
      <div className="shell-sidebar-panel__body gap-2 px-2 py-2">
        {/* Panel 1 — brand + primary nav. Rendered directly on the sidebar board
            (no card, no hover frame). */}
        <div className="shell-sidebar-navigation shrink-0 px-2 py-1.5">
          {/* Header */}
          <div className="shell-sidebar-brand flex h-10 shrink-0 items-center gap-2 px-1">
            <img
              src={syncThinkLogo}
              alt="Sync-Think"
              draggable={false}
              className="sync-think-logo h-5 w-5 shrink-0 rounded-md object-contain"
            />
            <span className="flex-1 truncate text-[13px] font-semibold tracking-tight text-text">
              Sync-Think
            </span>
            <button
              data-testid="sidebar-toggle"
              className="st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-faint hover:bg-hover hover:text-text"
              title="收起侧栏"
              onClick={props.onToggleSidebar}
            >
              <PanelLeftClose size={15} />
            </button>
          </div>

          <div className="sidebar-mode-switch" role="group" aria-label="侧栏视图">
            <button
              type="button"
              aria-pressed={sidebarMode === 'conversations'}
              onClick={() => {
                selectSidebarMode('conversations');
              }}
            >
              <MessageSquare size={13} />
              会话
            </button>
            <button
              type="button"
              aria-pressed={sidebarMode === 'agents'}
              onClick={() => {
                selectSidebarMode('agents');
              }}
            >
              <Bot size={13} />
              智能体
            </button>
          </div>
          {/* Top actions */}
          {sidebarMode === 'conversations' ? (
            <SidebarChatActions onSearch={() => setSearchFocused(true)} onNewConversation={() => props.onNewConversation()} searching={searchFocused || Boolean(query)} />
          ) : props.onAgentActionsMount ? (
            <div key="agent-actions-host" ref={props.onAgentActionsMount} data-testid="sidebar-agent-actions-host" />
          ) : null}
        </div>

        {sidebarMode === 'agents' ? (
          props.onAgentSidebarMount ? (
            <div key="agent-sidebar-host" ref={props.onAgentSidebarMount} className="sidebar-agent-host" data-testid="sidebar-agent-host" />
          ) : props.activeWorkspaceId ? (
            <Suspense
              fallback={
                <p className="agent-contacts__empty" role="status">
                  正在打开智能体…
                </p>
              }
            >
              <AgentContactsSidebar
                key={props.activeWorkspaceId}
                workspaceId={props.activeWorkspaceId}
                agents={props.agents}
                workspaces={props.workspaces ?? EMPTY_WORKSPACES}
                conversations={props.conversations}
                selectedConversationId={
                  props.nav.stage === 'talk' ? props.nav.selectedConversationId : undefined
                }
                conversationActivity={props.conversationActivity}
                loading={props.bootState === 'loading'}
                onChat={(agentId, ws, fresh) => props.onAgentChat?.(agentId, ws, fresh)}
                onOpenConversation={props.onOpenConversation}
                onManage={() => props.onSelectStage('agents')}
                onRefresh={() => props.onAgentsRefresh?.()}
              />
            </Suspense>
          ) : (
            <p className="agent-contacts__empty">请先选择一个工作区，再与智能体聊天</p>
          )
        ) : (
          /* Panel 2 — conversation list (bright inner box on the dark board).
          Height follows its content: expanding/collapsing recent chats or archive
          grows/shrinks the box instead of it always filling the board. */
          <div key="conversation-sidebar-list" className="shell-sidebar-recent flex min-h-0 flex-col rounded-(--radius-card) border border-border bg-recent px-2 pb-2 pt-1.5">
            {/* Search field (shown when search action focused or query non-empty) */}
            {(searchFocused || query) && (
              <SidebarChatSearch value={query} onChange={setQuery} autoFocus={searchFocused} onEmptyBlur={() => setSearchFocused(false)} onClose={() => { setSearchFocused(false); setQuery(''); }} />
            )}

            {/* Multi-select bulk bar */}
            {props.multiSelect ? (
              <div
                data-testid="sidebar-multiselect-bar"
                className="mb-1 flex shrink-0 flex-wrap items-center gap-1 rounded-(--radius-row) border border-border bg-surface px-2 py-1.5"
              >
                <span className="mr-1 text-[11px] text-text-secondary">
                  已选 {props.selectedIds.size}
                </span>
                <button
                  type="button"
                  className="st-row-motion h-6 rounded px-1.5 text-[11px] text-text-secondary hover:bg-hover"
                  onClick={props.onBulkArchive}
                  disabled={props.selectedIds.size === 0}
                >
                  归档
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      data-testid="sidebar-bulk-move"
                      className="st-row-motion h-6 rounded px-1.5 text-[11px] text-text-secondary hover:bg-hover"
                      disabled={props.selectedIds.size === 0}
                    >
                      移动到分组
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className="st-popover-in z-[300] min-w-[160px] rounded-(--radius-row) border border-border bg-overlay p-1 shadow-xl"
                      sideOffset={4}
                    >
                      {RECENT_CONVERSATION_TRACKS.map((track) => {
                        const selectedInTrack = props.conversations.some(
                          (conversation) =>
                            conversation.track === track && props.selectedIds.has(conversation.id),
                        );
                        if (!selectedInTrack) return null;
                        return (
                          <div key={track}>
                            <DropdownMenu.Item
                              className="st-row-motion cursor-pointer rounded px-2 py-1.5 text-[12px] text-text-secondary outline-none hover:bg-hover focus:bg-hover"
                              onSelect={() => props.onBulkMoveToGroup(track, null)}
                            >
                              {TRACK_LABELS[track]} · 移出分组
                            </DropdownMenu.Item>
                            {props.groups[track].map((group) => (
                              <DropdownMenu.Item
                                key={`${track}:${group.id}`}
                                className="st-row-motion cursor-pointer rounded px-2 py-1.5 text-[12px] text-text-secondary outline-none hover:bg-hover focus:bg-hover"
                                onSelect={() => props.onBulkMoveToGroup(track, group.id)}
                              >
                                {TRACK_LABELS[track]} · {group.name}
                              </DropdownMenu.Item>
                            ))}
                          </div>
                        );
                      })}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
                <button
                  type="button"
                  className="st-row-motion h-6 rounded px-1.5 text-[11px] text-error hover:bg-error/10"
                  onClick={props.onBulkDelete}
                  disabled={props.selectedIds.size === 0}
                >
                  删除
                </button>
                <button
                  type="button"
                  className="st-row-motion ml-auto h-6 rounded px-1.5 text-[11px] text-text-faint hover:bg-hover"
                  onClick={props.onToggleMultiSelect}
                >
                  取消
                </button>
              </div>
            ) : null}

            {/* Projects open their existing scoped conversation tree, preserving groups and archives. */}
            <div className="shell-scrollbar min-h-0 flex-1 overflow-y-auto">
              {projectNavigation ? <p className="shell-sidebar-project-label">工作区</p> : null}
              {projectNavigation
                ? visibleWorkspaces.map((workspace) => renderWorkspaceSection(workspace))
                : renderWorkspaceSection()}
            </div>
          </div>
        )}


      </div>

      {/* Resize handle — must stay outside the min-width body or it becomes a
          full-width click-blocking sheet over the whole sidebar. */}
      {!collapsed ? (
        <div
          data-testid="sidebar-resize"
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize hover:bg-accent/40"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            props.onResizeStart(e.clientX);
          }}
        />
      ) : null}
    </aside>
  );
}

function GroupBlock(props: {
  track: ConversationTrack;
  group: ConversationGroupPreference;
  conversations: Conversation[];
  allGroups: readonly ConversationGroupPreference[];
  selectedConversationId?: string;
  multiSelect: boolean;
  selectedIds: ReadonlySet<string>;
  resolveName(c: Conversation): string;
  onToggleCollapsed(): void;
  onRenameGroup(): void;
  onDeleteGroup(): void;
  onOpenConversation(id: string): void;
  onTogglePin(id: string, pinned: boolean): void;
  onRename(id: string, currentTitle: string): void;
  onArchive(id: string): void;
  onDelete(id: string): void;
  onDuplicate?(id: string): void;
  onCopyLink?(id: string): void;
  onMoveToGroup(track: ConversationTrack, conversationId: string, groupId: string | null): void;
  onToggleSelected(id: string): void;
  onToggleMultiSelect(): void;
  conversationActivity?: ReadonlyMap<string, ConversationActivityView>;
  agents: readonly GlobalAgent[];
  teams: readonly Team[];
  kernelOverrides?: Readonly<Record<string, string>>;
}) {
  const collapsed = props.group.collapsed === true;
  return (
    <div className="mb-0.5" data-testid={`group-${props.group.id}`}>
      <div className="st-press-motion st-row-motion group flex h-6 cursor-pointer items-center gap-1 rounded-(--radius-row) px-1.5 hover:bg-hover">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 text-left"
          onClick={props.onToggleCollapsed}
        >
          <ChevronRight size={12} className="st-chevron text-text-faint" data-open={!collapsed} />
          <span className="flex-1 truncate text-[11.5px] font-medium text-text-secondary">
            {props.group.name}
          </span>
          <span className="text-[10px] text-text-faint">{props.conversations.length}</span>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="st-icon-motion invisible flex h-4 w-4 items-center justify-center rounded text-text-faint hover:bg-active group-hover:visible data-[state=open]:visible"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="st-popover-in z-50 min-w-[132px] rounded-(--radius-card) border border-border bg-overlay p-1 shadow-lg"
            >
              <MenuItem
                icon={<Pencil size={13} />}
                label="重命名分组"
                onSelect={props.onRenameGroup}
              />
              <MenuItem
                icon={<Trash2 size={13} />}
                label="删除分组"
                danger
                onSelect={props.onDeleteGroup}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className={clsx('shell-collapse', !collapsed && 'shell-collapse--open')}>
        <div className="shell-collapse__inner">
          <div className="shell-tree-branch">
            {props.conversations.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                name={props.resolveName(c)}
                mark={resolveConversationRowMark(
                  c,
                  props.agents,
                  props.teams,
                  props.kernelOverrides,
                )}
                active={props.selectedConversationId === c.id}
                multiSelect={props.multiSelect}
                selected={props.selectedIds.has(c.id)}
                groups={props.allGroups}
                track={props.track}
                inGroupId={props.group.id}
                onOpen={() => props.onOpenConversation(c.id)}
                onTogglePin={() => props.onTogglePin(c.id, !c.pinnedAt)}
                onRename={() => props.onRename(c.id, c.title || props.resolveName(c))}
                onArchive={() => props.onArchive(c.id)}
                onDelete={() => props.onDelete(c.id)}
                onDuplicate={() => props.onDuplicate?.(c.id)}
                onCopyLink={() => props.onCopyLink?.(c.id)}
                onMoveToGroup={(groupId) => props.onMoveToGroup(props.track, c.id, groupId)}
                onToggleSelected={() => props.onToggleSelected(c.id)}
                onStartMultiSelect={props.onToggleMultiSelect}
                activity={props.conversationActivity?.get(String(c.id))}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Roster faces shown side by side before the tail collapses into a `+N` badge. */
const TEAM_STACK_MAX = 3;
/** Sidebar conversation-row identity mark (kernel logo / agent face / team stack). */
const IDENTITY_SIZE = 18;
/** Stacked team faces shrink with the mark so the lead face still reads as 18px. */
const TEAM_STACK_FACE = 13;

/** Running / unread indicator, pinned to the identity mark's bottom-right. */
function RowActivityDot(props: { activity?: ConversationActivityView }) {
  if (props.activity?.attention || props.activity?.failed) {
    const label = props.activity.attention ? ATTENTION_LABELS[props.activity.attention] : '执行失败待查看';
    return <span className={`shell-activity-dot shell-activity-dot--${props.activity.attention ? 'attention' : 'failed'} st-conv-row__activity`} title={label} aria-label={label} />;
  }
  if (props.activity?.running) {
    return (
      <span
        className="shell-activity-dot shell-activity-dot--running st-conv-row__activity"
        title="正在运行"
        aria-label="正在运行"
      />
    );
  }
  if (props.activity?.unread) {
    return (
      <span
        className="shell-activity-dot shell-activity-dot--unread st-conv-row__activity"
        title="已完成待查看"
        aria-label="已完成待查看"
      />
    );
  }
  return null;
}

/**
 * Team mark: roster faces stacked left-to-right, with everything past
 * `TEAM_STACK_MAX` collapsed into a `+N` badge. A team whose roster is empty
 * (or shows a single member) falls back to one plain face so the row keeps the
 * same visual weight as the other tracks.
 */
function TeamAvatarStack(props: {
  name: string;
  fallbackAvatar?: string;
  members: readonly TeamRowMemberMark[];
}) {
  const { members } = props;
  if (members.length <= 1) {
    return (
      <AgentAvatarView
        name={members[0]?.name ?? props.name}
        avatar={members[0]?.avatar ?? props.fallbackAvatar}
        size={IDENTITY_SIZE}
      />
    );
  }
  const shown = members.slice(0, TEAM_STACK_MAX);
  const overflow = members.length - shown.length;
  return (
    <span className="st-conv-stack">
      {shown.map((member, index) => (
        <span key={`${member.name}-${index}`} className="st-conv-stack__face">
          <AgentAvatarView name={member.name} avatar={member.avatar} size={TEAM_STACK_FACE} />
        </span>
      ))}
      {overflow > 0 ? <span className="st-conv-stack__overflow">+{overflow}</span> : null}
    </span>
  );
}

function ConversationIdentityMark(props: {
  conversationId: string;
  mark: ConversationRowMark;
  activity?: ConversationActivityView;
}) {
  const logo =
    props.mark.kind === 'kernel' ? resolveKernelBrandLogo(props.mark.kernelId) : undefined;
  return (
    <span
      className="st-conv-row__identity"
      data-testid={`conversation-identity-${props.conversationId}`}
      data-kind={props.mark.kind}
      data-kernel={props.mark.kind === 'kernel' ? props.mark.kernelId : undefined}
    >
      {props.mark.kind === 'kernel' ? (
        logo ? (
          <BrandLogoMark logo={logo} size={IDENTITY_SIZE} />
        ) : (
          <Sparkles size={18} className="text-text-faint" aria-hidden="true" />
        )
      ) : props.mark.kind === 'team' ? (
        <TeamAvatarStack
          name={props.mark.name}
          fallbackAvatar={props.mark.avatar}
          members={props.mark.members}
        />
      ) : (
        <AgentAvatarView name={props.mark.name} avatar={props.mark.avatar} size={IDENTITY_SIZE} />
      )}
      <RowActivityDot activity={props.activity} />
    </span>
  );
}

function ConversationRow(props: {
  conversation: Conversation;
  name: string;
  mark: ConversationRowMark;
  active: boolean;
  archived?: boolean;
  multiSelect: boolean;
  selected: boolean;
  groups: readonly ConversationGroupPreference[];
  track: ConversationTrack;
  inGroupId?: string;
  onOpen(): void;
  onTogglePin(): void;
  onRename(): void;
  onArchive(): void;
  onDelete(): void;
  onDuplicate?(): void;
  onCopyLink?(): void;
  onMoveToGroup(groupId: string | null): void;
  onToggleSelected(): void;
  onStartMultiSelect(): void;
  /** 运行中动效 / 完成未读状态。 */
  activity?: ConversationActivityView;
}) {
  const openContextMenu = useContextMenu();
  const { conversation: c } = props;
  const title = c.title || props.name;
  const time = formatConversationRowTime(c.lastMessageAt ?? c.updatedAt ?? c.createdAt, Date.now());
  /*
   * Agent and team rows are two lines: the identity name on top, the conversation
   * title underneath (standing in for the message summary we do not carry yet).
   * The model track stays single-line — its title already *is* the identity.
   */
  const group = c.collaborationKind === 'group';
  const roster = useCollaborationRoster(String(c.id), group);
  // A group row is identified by its whole roster, not the coordinator behind targetRef.
  const mark: ConversationRowMark = group
    ? { kind: 'team', name: title, members: roster?.members ?? [] }
    : props.mark;
  const twoLine = mark.kind === 'agent' || mark.kind === 'team';
  const heading = group ? title : twoLine ? props.name : title;
  const rawTitle = (c.title ?? '').trim();
  const thinking = group && roster?.busy === true;
  const running = !props.activity?.attention && (props.activity?.running === true || thinking);
  const summary = group
    ? roster?.preview
      ? `${roster.previewSender ? `${roster.previewSender}：` : ''}${roster.preview}`
      : roster
        ? `${roster.members.length} 位成员`
        : ''
    : twoLine && rawTitle && rawTitle !== props.name
      ? rawTitle
      : '';

  return (
    <div
      data-testid={`conversation-${c.id}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        if (props.multiSelect) props.onToggleSelected();
        else props.onOpen();
      }}
      onContextMenu={(event) =>
        openContextMenu(event, [
          { id: 'rename', label: '重命名对话', icon: <Pencil size={14} />, run: props.onRename },
          {
            id: 'duplicate',
            label: '复制对话',
            icon: <Copy size={14} />,
            disabled: !props.onDuplicate,
            run: props.onDuplicate,
          },
          {
            id: 'link',
            label: '复制对话链接',
            icon: <Link2 size={14} />,
            disabled: !props.onCopyLink,
            run: props.onCopyLink,
          },
          ...(!props.archived
            ? [
                {
                  id: 'pin',
                  label: c.pinnedAt ? '取消置顶' : '置顶对话',
                  icon: <Pin size={14} />,
                  run: props.onTogglePin,
                },
              ]
            : []),
          {
            id: 'group',
            label: '移动到分组',
            icon: <FolderInput size={14} />,
            disabled: !props.groups.length && !props.inGroupId,
            children: [
              ...props.groups.map((group) => ({
                id: group.id,
                label: group.name,
                icon: props.inGroupId === group.id ? <Check size={14} /> : undefined,
                run: () => props.onMoveToGroup(group.id),
              })),
              ...(props.inGroupId
                ? [
                    {
                      id: 'ungroup',
                      label: '移出分组',
                      separator: true,
                      run: () => props.onMoveToGroup(null),
                    },
                  ]
                : []),
            ],
          },
          {
            id: 'archive',
            label: props.archived ? '取消归档' : '归档对话',
            icon: props.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
            run: props.onArchive,
          },
          {
            id: 'select',
            label: props.multiSelect ? (props.selected ? '取消选择' : '选择对话') : '多选',
            icon: <Check size={14} />,
            run: props.multiSelect ? props.onToggleSelected : props.onStartMultiSelect,
          },
          {
            id: 'delete',
            label: '删除对话',
            icon: <Trash2 size={14} />,
            separator: true,
            danger: true,
            run: props.onDelete,
          },
        ])
      }
      data-archived={props.archived ? '1' : '0'}
      className={clsx(
        'st-row-motion st-conv-row group relative flex cursor-pointer items-center gap-2 rounded-(--radius-row) py-2 pl-2 pr-1',
        props.active ? 'shell-row-active text-text' : 'text-text-secondary hover:bg-hover',
        props.archived && !props.active ? 'opacity-80' : '',
      )}
      onClick={() => {
        if (props.multiSelect) {
          props.onToggleSelected();
          return;
        }
        props.onOpen();
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {props.multiSelect ? (
          <span
            className={clsx(
              'mr-0.5 flex h-3.5 w-3.5 items-center justify-center rounded border',
              props.selected
                ? 'border-accent bg-accent text-[var(--color-accent-fg)]'
                : 'border-border-strong text-transparent',
            )}
          >
            <Check size={10} />
          </span>
        ) : null}
        <ConversationIdentityMark
          conversationId={String(c.id)}
          mark={mark}
          activity={running ? undefined : props.activity}
        />
        <span className="st-conv-row__body">
          <span className="flex min-w-0 items-center gap-2">
            {/* The legacy 12/16 fallback stays below; the opt-in workbench uses
                the agent-aligned 14/20 scale through this semantic title hook. */}
            <span className="st-conv-row__title flex-1 truncate text-[12px] font-medium leading-4">
              {heading}
            </span>
            {props.activity?.attention ? <span className="st-conv-row__attention">{ATTENTION_LABELS[props.activity.attention]}</span> : null}
            {running ? <SidebarThinkingIndicator conversationId={String(c.id)} /> : null}
            {title.startsWith('任务 ·') ? (
              <span className="shell-task-conv-badge" title="定时任务会话">
                任务
              </span>
            ) : null}
            {c.pinnedAt && !props.archived && (
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center text-accent"
                title="已置顶"
              >
                <Pin size={11} className="fill-current" />
              </span>
            )}
            <span className="st-conv-row__trail">
              {time ? (
                <span className="st-conv-row__time" data-testid={`conversation-time-${c.id}`}>
                  {time}
                </span>
              ) : null}
              {!props.multiSelect && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button
                      data-testid={`conversation-menu-trigger-${c.id}`}
                      className="st-conv-row__menu st-icon-motion invisible flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible data-[state=open]:visible data-[state=open]:bg-active data-[state=open]:text-text"
                      title="更多操作"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      data-testid={`conversation-menu-${c.id}`}
                      align="end"
                      sideOffset={4}
                      className="st-popover-in z-50 min-w-[160px] rounded-(--radius-card) border border-border bg-overlay p-1 shadow-lg"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MenuItem
                        icon={<Pencil size={13} />}
                        label="重命名对话"
                        onSelect={props.onRename}
                      />
                      <MenuItem
                        icon={<Copy size={13} />}
                        label="复制对话"
                        onSelect={() => props.onDuplicate?.()}
                      />
                      <MenuItem
                        icon={<Link2 size={13} />}
                        label="复制深度链接"
                        onSelect={() => props.onCopyLink?.()}
                      />
                      {!props.archived && (
                        <MenuItem
                          icon={<Pin size={13} />}
                          label={c.pinnedAt ? '取消置顶' : '置顶对话'}
                          onSelect={props.onTogglePin}
                        />
                      )}
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className="flex h-7 cursor-pointer items-center gap-2 rounded-(--radius-row) px-2 text-[12.5px] text-text-secondary outline-none data-[highlighted]:bg-hover data-[highlighted]:text-text">
                          <FolderInput size={13} />
                          移动到分组…
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent
                            className="st-popover-in z-50 min-w-[140px] rounded-(--radius-card) border border-border bg-overlay p-1 shadow-lg"
                            sideOffset={4}
                          >
                            {props.groups.map((g) => (
                              <MenuItem
                                key={g.id}
                                icon={
                                  props.inGroupId === g.id ? (
                                    <Check size={13} />
                                  ) : (
                                    <span className="w-[13px]" />
                                  )
                                }
                                label={g.name}
                                onSelect={() => props.onMoveToGroup(g.id)}
                              />
                            ))}
                            {props.inGroupId ? (
                              <MenuItem
                                icon={<FolderInput size={13} />}
                                label="移出分组"
                                onSelect={() => props.onMoveToGroup(null)}
                              />
                            ) : null}
                            {props.groups.length === 0 ? (
                              <div className="px-2 py-1.5 text-[11px] text-text-faint">
                                暂无分组
                              </div>
                            ) : null}
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                      <MenuItem
                        icon={props.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                        label={props.archived ? '取消归档' : '归档对话'}
                        onSelect={props.onArchive}
                      />
                      <MenuItem
                        icon={<Check size={13} />}
                        label="多选"
                        onSelect={props.onStartMultiSelect}
                      />
                      <DropdownMenu.Separator className="mx-1 my-1 h-px bg-border" />
                      <MenuItem
                        icon={<Trash2 size={13} />}
                        label="删除对话"
                        danger
                        onSelect={props.onDelete}
                      />
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}
            </span>
          </span>
          {thinking ? (
            <span
              className="st-conv-row__sub shell-text-shimmer"
              data-label="一起思考中…"
              data-testid={`conversation-sub-${c.id}`}
            >
              一起思考中…
            </span>
          ) : summary ? (
            <span className="st-conv-row__sub" data-testid={`conversation-sub-${c.id}`}>
              {summary}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function SidebarWorkspaceRowSkeleton({ width }: { width: string }) {
  return (
    <div className="flex min-h-[35.5px] items-center pr-1.5 pl-[10px]">
      <div className="ds-skeleton rounded-sm" style={{ width, height: 10 }} />
    </div>
  );
}

function SidebarWorkspaceGroupLabelSkeleton() {
  return (
    <div className="py-1">
      <div className="flex min-h-[28px] items-center pr-1 pl-2">
        <div className="ds-skeleton rounded-sm" style={{ width: 44, height: 8 }} />
      </div>
    </div>
  );
}

function SidebarWorkspaceListSkeleton() {
  return (
    <div
      className="flex flex-col gap-px"
      data-testid="sidebar-workspace-list-skeleton"
      role="status"
      aria-label="正在加载对话"
    >
      <SidebarWorkspaceGroupLabelSkeleton />
      {SIDEBAR_WORKSPACE_SKELETON_ROW_WIDTHS.map((width) => (
        <SidebarWorkspaceRowSkeleton key={width} width={width} />
      ))}
    </div>
  );
}

function MenuItem(props: {
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  onSelect(): void;
}) {
  return (
    <DropdownMenu.Item
      className={clsx(
        'flex h-7 cursor-pointer items-center gap-2 rounded-(--radius-row) px-2 text-[12.5px] outline-none',
        props.danger
          ? 'text-error data-[highlighted]:bg-error/10'
          : 'text-text-secondary data-[highlighted]:bg-hover data-[highlighted]:text-text',
      )}
      onSelect={props.onSelect}
    >
      {props.icon}
      {props.label}
    </DropdownMenu.Item>
  );
}
