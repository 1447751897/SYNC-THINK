// NewMax-style sidebar (shell constitution):
// top actions · three tracks with real groups · bottom settings + account.
// Collapsed = fully hidden (parent omits this component). Width is resizable.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDialog } from './Dialog.js';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Activity,
  Archive,
  ArchiveRestore,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  Copy,
  FolderInput,
  FolderPlus,
  Globe,
  Link2,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react';
import clsx from 'clsx';
import syncThinkLogo from './assets/sync-think-logo.png';
import type { Conversation, ConversationTrack, GlobalAgent, Team } from '@sync-think/shared';
import type { ConversationGroupPreference, ConversationGroupsByTrack } from '../ui-preferences.js';
import {
  TRACK_LABELS,
  buildTrackTree,
  resolveConversationRowMark,
  targetName,
  type ConversationRowMark,
  type ShellNavState,
  type ShellStage,
} from './shell-state.js';
import { AgentAvatarView } from './AgentAvatarView.js';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo } from './brand-icons.js';
import {
  SIDEBAR_WORKSPACE_SKELETON_ROW_WIDTHS,
  shouldRenderRecentConversationEmptyState,
  shouldShowSidebarWorkspaceListSkeleton,
} from './sidebar-newmax-loading.js';

const TRACK_ICONS: Record<ConversationTrack, typeof Sparkles> = {
  model: Sparkles,
  agent: Bot,
  team: Users,
};

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
  bootState?: 'loading' | 'ready' | 'error';
  bootError?: string;
  activeWorkspaceId?: string;
  settingsOpen?: boolean;
  multiSelect: boolean;
  selectedIds: ReadonlySet<string>;
  /** 各对话运行/未读状态（key = conversationId）。 */
  conversationActivity?: ReadonlyMap<string, { running: boolean; unread: boolean }>;
  onSelectStage(stage: ShellStage): void;
  onToggleTrack(track: ConversationTrack): void;
  onToggleSidebar(): void;
  onOpenConversation(id: string): void;
  onNewConversation(track?: ConversationTrack): void;
  onNewCanvas?(): void;
  onTogglePin(id: string, pinned: boolean): void;
  onRename(id: string, currentTitle: string): void;
  onArchive(id: string): void;
  onUnarchive?(id: string): void;
  onDelete(id: string): void;
  onDuplicate?(id: string): void;
  onCopyLink?(id: string): void;
  onCreateGroup(track: ConversationTrack, name: string): void;
  onRenameGroup(track: ConversationTrack, groupId: string, name: string): void;
  onDeleteGroup(track: ConversationTrack, groupId: string): void;
  onToggleGroupCollapsed(track: ConversationTrack, groupId: string): void;
  onMoveToGroup(track: ConversationTrack, conversationId: string, groupId: string | null): void;
  onToggleMultiSelect(): void;
  onToggleSelected(id: string): void;
  onBulkArchive(): void;
  onBulkDelete(): void;
  onBulkMoveToGroup(track: ConversationTrack, groupId: string | null): void;
  onResizeStart(clientX: number): void;
}

export function Sidebar(props: SidebarProps) {
  const [query, setQuery] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  /** 最近对话 wraps the three tracks; collapsing it hides all of them at once. */
  const [recentOpen, setRecentOpen] = useState(true);
  const [searchFocused, setSearchFocused] = useState(false);
  const dialog = useDialog();

  useEffect(() => {
    const openSearch = () => setSearchFocused(true);
    window.addEventListener('shell-open-conversation-search', openSearch);
    return () => window.removeEventListener('shell-open-conversation-search', openSearch);
  }, []);

  const resolveName = useMemo(
    () => (c: Conversation) =>
      targetName(c, props.agents, props.teams, props.modelNames, props.modelOverrides),
    [props.agents, props.modelNames, props.modelOverrides, props.teams],
  );

  const { active, archived } = useMemo(() => {
    const a: Conversation[] = [];
    const ar: Conversation[] = [];
    for (const c of props.conversations) {
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
  const filteredArchived = useMemo(() => filterQ(archived), [archived, filterQ]);

  const byTrack = useMemo(() => {
    const groups: Record<ConversationTrack, Conversation[]> = { model: [], agent: [], team: [] };
    for (const c of filteredActive) groups[c.track].push(c);
    return groups;
  }, [filteredActive]);

  const collapsed = props.collapsed === true;
  const targetWidth = collapsed ? 0 : props.width;
  const workspaceId = props.activeWorkspaceId ?? null;
  const isLoadingConversations = props.bootState === 'loading';
  const sidebarWorkspaceListsLoading =
    query.trim().length === 0 &&
    shouldShowSidebarWorkspaceListSkeleton({
      activeWorkspaceId: workspaceId,
      switchContentWorkspaceId: workspaceId,
      switchProjectsWorkspaceId: workspaceId,
      isLoadingConversations,
      conversationCount: active.length,
      projectCount: 0,
      archivedLoaded: true,
      isLoadingArchived: false,
    });

  return (
    <aside
      data-testid="shell-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={clsx(
        'shell-board shell-sidebar-panel relative flex min-h-0 shrink-0 flex-col border border-border bg-sidebar',
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
      <div className="shell-sidebar-panel__body gap-2 px-2 py-2">
        {/* Panel 1 — brand + primary nav. Rendered directly on the sidebar board
            (no card, no hover frame). */}
        <div className="shrink-0 px-2 py-1.5">
          {/* Header */}
          <div className="flex h-10 shrink-0 items-center gap-2 px-1">
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

          {/* Top actions */}
          <div className="flex shrink-0 flex-col gap-0.5">
            <ActionRow
              icon={<MessageSquarePlus size={15} />}
              label="新建对话"
              testId="nav-new-chat"
              onClick={() => props.onNewConversation()}
            />
            <ActionRow
              icon={<Pencil size={15} />}
              label="新建绘图"
              testId="nav-new-canvas"
              placeholder={!props.onNewCanvas}
              onClick={() => props.onNewCanvas?.()}
            />
            <ActionRow
              icon={<Search size={15} />}
              label="搜索"
              testId="nav-search"
              placeholder
              onClick={() => setSearchFocused(true)}
            />
            <ActionRow
              icon={<CalendarClock size={15} />}
              label="定时任务"
              testId="nav-scheduled"
              active={props.nav.stage === 'tasks'}
              onClick={() => props.onSelectStage('tasks')}
            />
            <ActionRow
              icon={<Activity size={15} />}
              label="后台活动"
              testId="nav-activity"
              active={props.nav.stage === 'activity'}
              onClick={() => props.onSelectStage('activity')}
            />
            <ActionRow
              icon={<Globe size={15} />}
              label="浏览器"
              testId="nav-browser"
              active={props.nav.stage === 'browser'}
              onClick={() => props.onSelectStage('browser')}
            />
            <ActionRow
              icon={<Bot size={15} />}
              label="智能体"
              testId="nav-agents"
              active={props.nav.stage === 'agents'}
              onClick={() => props.onSelectStage('agents')}
            />
            <ActionRow
              icon={<Users size={15} />}
              label="小队"
              testId="nav-teams"
              active={props.nav.stage === 'teams'}
              onClick={() => props.onSelectStage('teams')}
            />
            <ActionRow
              icon={<Wrench size={15} />}
              label="能力"
              testId="nav-abilities"
              active={props.nav.stage === 'abilities'}
              onClick={() => props.onSelectStage('abilities')}
            />
          </div>
        </div>

        {/* Panel 2 — conversation list (bright inner box on the dark board).
          Height follows its content: expanding/collapsing a track or archive
          grows/shrinks the box instead of it always filling the board. */}
        <div className="shell-sidebar-recent flex min-h-0 flex-col rounded-(--radius-card) border border-border bg-recent px-2 pb-2 pt-1.5">
          {/* Search field (shown when search action focused or query non-empty) */}
          {(searchFocused || query) && (
            <div className="relative shrink-0 py-1.5">
              <Search
                size={12}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-faint"
              />
              <input
                data-testid="sidebar-search"
                type="search"
                autoFocus={searchFocused}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => {
                  if (!query) setSearchFocused(false);
                }}
                placeholder="搜索对话…"
                className="h-7 w-full rounded-(--radius-row) border border-border bg-page pl-7 pr-2 text-[12px] text-text placeholder:text-text-faint outline-none focus:border-accent/40"
              />
            </div>
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
                    {(Object.keys(props.groups) as ConversationTrack[]).map((track) => {
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

          {/* Tracks */}
          <div className="shell-scrollbar min-h-0 flex-1 overflow-y-auto">
            <button
              type="button"
              data-testid="recent-section-toggle"
              className="st-press-motion st-row-motion flex h-8 w-full cursor-pointer items-center gap-1 rounded-(--radius-row) px-1.5 text-left hover:bg-hover"
              onClick={() => setRecentOpen((v) => !v)}
            >
              <ChevronRight
                size={13}
                className="st-chevron text-text-faint"
                data-open={recentOpen}
              />
              <span className="flex-1 text-[14px] font-semibold tracking-wide text-text-faint">
                最近对话
              </span>
            </button>

            <div className={clsx('shell-collapse', recentOpen && 'shell-collapse--open')}>
              <div className="shell-collapse__inner">
                {sidebarWorkspaceListsLoading ? (
                  <SidebarWorkspaceListSkeleton />
                ) : (
                <div>
                  {(Object.keys(TRACK_LABELS) as ConversationTrack[]).map((track) => {
                    const TrackIcon = TRACK_ICONS[track];
                    const expanded = props.nav.expandedTracks[track];
                    const items = byTrack[track];
                    const tree = buildTrackTree(items, props.groups[track] ?? []);
                    return (
                      <div key={track} className="mb-0.5">
                        <div
                          className="st-press-motion st-row-motion group flex h-8 cursor-pointer items-center gap-1 rounded-(--radius-row) px-1.5 hover:bg-hover"
                          data-testid={`track-header-${track}`}
                          onClick={() => props.onToggleTrack(track)}
                        >
                          <ChevronRight
                            size={13}
                            className="st-chevron text-text-faint"
                            data-open={expanded}
                          />
                          <TrackIcon size={13} className="text-text-secondary" />
                          <span className="flex-1 text-[13px] text-text-secondary">
                            {TRACK_LABELS[track]}
                          </span>
                          <button
                            data-testid={`track-new-group-${track}`}
                            className="st-icon-motion invisible flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible"
                            title="新建分组"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const name = await dialog.prompt({
                                title: '新建分组',
                                message: '为这个轨道新建一个对话分组',
                                placeholder: '分组名称',
                                confirmText: '新建',
                              });
                              if (!name?.trim()) return;
                              props.onCreateGroup(track, name.trim());
                            }}
                          >
                            <FolderPlus size={12} />
                          </button>
                          <button
                            data-testid={`track-new-${track}`}
                            className="st-icon-motion invisible flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible"
                            title={`新建${TRACK_LABELS[track]}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onNewConversation(track);
                            }}
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        <div className={clsx('shell-collapse', expanded && 'shell-collapse--open')}>
                          <div className="shell-collapse__inner">
                            <div className="shell-tree-branch">
                              {tree.groups.map(({ group, conversations: groupItems }) => (
                                <GroupBlock
                                  key={group.id}
                                  track={track}
                                  group={group}
                                  conversations={groupItems}
                                  allGroups={props.groups[track] ?? []}
                                  selectedConversationId={props.nav.selectedConversationId}
                                  multiSelect={props.multiSelect}
                                  selectedIds={props.selectedIds}
                                  resolveName={resolveName}
                                  onToggleCollapsed={() =>
                                    props.onToggleGroupCollapsed(track, group.id)
                                  }
                                  onRenameGroup={async () => {
                                    const name = await dialog.prompt({
                                      title: '重命名分组',
                                      message: '为这个分组设置一个新名称',
                                      defaultValue: group.name,
                                      placeholder: '分组名称',
                                      confirmText: '保存',
                                    });
                                    if (!name?.trim() || name.trim() === group.name) return;
                                    props.onRenameGroup(track, group.id, name.trim());
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
                                    props.onDeleteGroup(track, group.id);
                                  }}
                                  onOpenConversation={props.onOpenConversation}
                                  onTogglePin={props.onTogglePin}
                                  onRename={props.onRename}
                                  onArchive={props.onArchive}
                                  onDelete={props.onDelete}
                                  onDuplicate={props.onDuplicate}
                                  onCopyLink={props.onCopyLink}
                                  onMoveToGroup={props.onMoveToGroup}
                                  onToggleSelected={props.onToggleSelected}
                                  onToggleMultiSelect={props.onToggleMultiSelect}
                                  conversationActivity={props.conversationActivity}
                                  agents={props.agents}
                                  teams={props.teams}
                                  kernelOverrides={props.kernelOverrides}
                                />
                              ))}

                              {tree.ungrouped.length === 0 && tree.groups.length === 0 ? (
                                <div className="flex flex-col items-center gap-1 px-2 py-2.5 text-center">
                                  <MessageSquare
                                    size={14}
                                    className="text-text-faint opacity-50"
                                    aria-hidden="true"
                                  />
                                  <div className="text-[11px] text-text-faint">
                                    {props.bootState === 'error'
                                      ? props.bootError || '连接失败'
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
                                tree.ungrouped.map((c) => (
                                  <ConversationRow
                                    key={c.id}
                                    conversation={c}
                                    name={resolveName(c)}
                                    mark={resolveConversationRowMark(
                                      c,
                                      props.agents,
                                      props.teams,
                                      props.kernelOverrides,
                                    )}
                                    active={props.nav.selectedConversationId === c.id}
                                    multiSelect={props.multiSelect}
                                    selected={props.selectedIds.has(c.id)}
                                    groups={props.groups[track] ?? []}
                                    track={track}
                                    onOpen={() => props.onOpenConversation(c.id)}
                                    onTogglePin={() => props.onTogglePin(c.id, !c.pinnedAt)}
                                    onRename={() => props.onRename(c.id, c.title || resolveName(c))}
                                    onArchive={() => props.onArchive(c.id)}
                                    onDelete={() => props.onDelete(c.id)}
                                    onDuplicate={() => props.onDuplicate?.(c.id)}
                                    onCopyLink={() => props.onCopyLink?.(c.id)}
                                    onMoveToGroup={(groupId) =>
                                      props.onMoveToGroup(track, c.id, groupId)
                                    }
                                    onToggleSelected={() => props.onToggleSelected(c.id)}
                                    onStartMultiSelect={props.onToggleMultiSelect}
                                    activity={props.conversationActivity?.get(String(c.id))}
                                  />
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            </div>

            {(filteredArchived.length > 0 || archived.length > 0) && (
              <div className="mt-2 border-t border-border pt-1.5">
                <button
                  type="button"
                  data-testid="archive-section-toggle"
                  className="st-press-motion st-row-motion group flex h-7 w-full cursor-pointer items-center gap-1 rounded-(--radius-row) px-1.5 text-left hover:bg-hover"
                  onClick={() => setArchiveOpen((v) => !v)}
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
                              props.agents,
                              props.teams,
                              props.kernelOverrides,
                            )}
                            active={props.nav.selectedConversationId === c.id}
                            archived
                            multiSelect={props.multiSelect}
                            selected={props.selectedIds.has(c.id)}
                            groups={props.groups[c.track] ?? []}
                            track={c.track}
                            onOpen={() => props.onOpenConversation(c.id)}
                            onTogglePin={() => props.onTogglePin(c.id, !c.pinnedAt)}
                            onRename={() => props.onRename(c.id, c.title || resolveName(c))}
                            onArchive={() => props.onUnarchive?.(c.id)}
                            onDelete={() => props.onDelete(c.id)}
                            onDuplicate={() => props.onDuplicate?.(c.id)}
                            onCopyLink={() => props.onCopyLink?.(c.id)}
                            onMoveToGroup={(groupId) => props.onMoveToGroup(c.track, c.id, groupId)}
                            onToggleSelected={() => props.onToggleSelected(c.id)}
                            onStartMultiSelect={props.onToggleMultiSelect}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Panel 3 — account row. Renders directly on the board and only floats
          as a bright box on hover; clicking the box (or the gear) opens settings. */}
        <div
          className={clsx(
            'mt-auto shrink-0 cursor-pointer rounded-(--radius-card) border px-2 py-1 transition-colors duration-150',
            props.settingsOpen
              ? 'border-border bg-recent'
              : 'border-transparent hover:border-border hover:bg-recent',
          )}
          role="button"
          tabIndex={0}
          title="设置"
          data-testid="sidebar-settings-box"
          onClick={() => props.onSelectStage('settings')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              props.onSelectStage('settings');
            }
          }}
        >
          <div className="flex h-9 items-center gap-2 rounded-(--radius-row) px-1 text-text-secondary">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-active text-[11px] font-medium text-text">
              U
            </div>
            <span className="min-w-0 flex-1 truncate text-[12px]">本地用户</span>
            <button
              type="button"
              data-testid="nav-settings"
              className={clsx(
                'st-press-motion st-icon-motion flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-row)',
                props.settingsOpen
                  ? 'shell-row-active text-text'
                  : 'text-text-secondary hover:bg-hover hover:text-text',
              )}
              title="设置"
              aria-label="设置"
              onClick={(e) => {
                e.stopPropagation();
                props.onSelectStage('settings');
              }}
            >
              <Settings size={15} className="st-nav-icon transition-colors duration-150" />
            </button>
          </div>
        </div>
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

function ActionRow(props: {
  icon: React.ReactNode;
  label: string;
  testId: string;
  active?: boolean;
  accent?: boolean;
  placeholder?: boolean;
  onClick?(): void;
}) {
  const dialog = useDialog();
  return (
    <button
      type="button"
      data-testid={props.testId}
      className={clsx(
        'st-press-motion st-nav-item flex h-9 w-full items-center gap-2 rounded-(--radius-row) px-2 text-[14px]',
        props.active
          ? 'shell-row-active text-text'
          : props.accent
            ? 'text-text hover:bg-hover'
            : 'text-text-secondary hover:bg-hover hover:text-text',
        props.placeholder ? 'opacity-70' : '',
      )}
      onClick={() => {
        if (props.placeholder && !props.onClick) {
          void dialog.alert({
            title: props.label,
            message: '该功能即将推出，敬请期待。',
            dismissText: '知道了',
          });
          return;
        }
        props.onClick?.();
      }}
      title={props.placeholder ? `${props.label}（即将推出）` : props.label}
    >
      <span
        className={clsx(
          'st-nav-icon transition-colors duration-150',
          props.accent ? 'text-accent' : '',
        )}
      >
        {props.icon}
      </span>
      <span className="flex-1 text-left">{props.label}</span>
    </button>
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
  conversationActivity?: ReadonlyMap<string, { running: boolean; unread: boolean }>;
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

function ConversationIdentityMark(props: {
  conversationId: string;
  mark: ConversationRowMark;
}) {
  const logo = props.mark.kind === 'kernel' ? resolveKernelBrandLogo(props.mark.kernelId) : undefined;
  return (
    <span
      className="st-conv-row__identity"
      data-testid={`conversation-identity-${props.conversationId}`}
      data-kind={props.mark.kind}
      data-kernel={props.mark.kind === 'kernel' ? props.mark.kernelId : undefined}
    >
      {props.mark.kind === 'kernel' ? (
        logo ? (
          <BrandLogoMark logo={logo} size={16} />
        ) : (
          <Sparkles size={14} className="text-text-faint" aria-hidden="true" />
        )
      ) : (
        <AgentAvatarView name={props.mark.name} avatar={props.mark.avatar} size={16} />
      )}
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
  /** 运行中 / 完成未读状态圆点。 */
  activity?: { running: boolean; unread: boolean };
}) {
  const { conversation: c } = props;
  const title = c.title || props.name;
  const identity =
    props.track === 'agent'
      ? { icon: Bot, kind: '智能体', name: props.name }
      : props.track === 'team'
        ? { icon: Users, kind: '小队', name: props.name }
        : { icon: MessageSquare, kind: '模型', name: props.name };
  const IdentityIcon = identity.icon;
  const identityName =
    identity.name && identity.name !== title && identity.name !== identity.kind
      ? identity.name
      : '';

  return (
    <div
      data-testid={`conversation-${c.id}`}
      data-archived={props.archived ? '1' : '0'}
      className={clsx(
        'st-row-motion st-conv-row group relative flex cursor-pointer flex-col rounded-(--radius-row) py-1 pl-2 pr-1',
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
      <div className="flex items-center gap-1">
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
        <ConversationIdentityMark conversationId={String(c.id)} mark={props.mark} />
        <span className="flex-1 truncate text-[14px] font-medium leading-5">{title}</span>
        {title.startsWith('任务 ·') ? (
          <span className="shell-task-conv-badge" title="定时任务会话">
            任务
          </span>
        ) : null}
        {props.activity?.running ? (
          <span
            className="shell-activity-dot shell-activity-dot--running mr-0.5"
            title="正在运行"
            aria-label="正在运行"
          />
        ) : props.activity?.unread ? (
          <span
            className="shell-activity-dot shell-activity-dot--unread mr-0.5"
            title="已完成待查看"
            aria-label="已完成待查看"
          />
        ) : null}
        {c.pinnedAt && !props.archived && (
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center text-accent"
            title="已置顶"
          >
            <Pin size={11} className="fill-current" />
          </span>
        )}
        {!props.multiSelect && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                data-testid={`conversation-menu-trigger-${c.id}`}
                className="st-icon-motion invisible flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible data-[state=open]:visible data-[state=open]:bg-active data-[state=open]:text-text"
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
                        <div className="px-2 py-1.5 text-[11px] text-text-faint">暂无分组</div>
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
      </div>
      {props.track !== 'model' ? (
        <div className="mt-0.5 flex min-w-0 items-center gap-1 pl-0.5 text-[12px] text-text-faint">
          <IdentityIcon size={10.5} className="shrink-0" aria-hidden="true" />
          <span className="shrink-0">{identity.kind}</span>
          {identityName ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate" title={identity.name}>
                {identity.name}
              </span>
            </>
          ) : null}
          {props.archived ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">已归档</span>
            </>
          ) : null}
        </div>
      ) : null}
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
