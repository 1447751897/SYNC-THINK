// NewMax-style sidebar:「最近对话 → 模型/智能体/小队 → 会话」+ 一级导航。
// Quiet visuals: tokens only, light hover, small ghost + buttons.
// Row actions live behind a hover-revealed ⋯ menu (not right-click); the whole
// panel collapses to an icon rail via the header toggle.
import { useMemo, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  PanelLeft,
  PanelLeftClose,
  Pin,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import type { Conversation, ConversationTrack, GlobalAgent, Team } from '@sync-think/shared';
import {
  filterConversationsByQuery,
  groupConversations,
  partitionActiveArchived,
  STAGE_LABELS,
  TRACK_LABELS,
  targetName,
  type ShellNavState,
  type ShellStage,
} from './shell-state.js';

const STAGE_ICONS: Record<ShellStage, typeof MessageSquare> = {
  talk: MessageSquare,
  projects: FolderKanban,
  agents: Bot,
  teams: Users,
  abilities: Wrench,
  settings: Settings,
};

const TRACK_ICONS: Record<ConversationTrack, typeof Sparkles> = {
  model: Sparkles,
  agent: Bot,
  team: Users,
};

const PRIMARY_STAGES: ShellStage[] = ['projects', 'agents', 'teams', 'abilities', 'settings'];

export interface SidebarProps {
  nav: ShellNavState;
  conversations: readonly Conversation[];
  agents: readonly GlobalAgent[];
  teams: readonly Team[];
  /** modelId → displayName, resolved from the provider catalog. */
  modelNames: ReadonlyMap<string, string>;
  /** Cold-start state for conversation catalog. */
  bootState?: 'loading' | 'ready' | 'error';
  bootError?: string;
  onSelectStage(stage: ShellStage): void;
  onToggleTrack(track: ConversationTrack): void;
  onToggleSidebar(): void;
  onOpenConversation(id: string): void;
  onNewConversation(track: ConversationTrack): void;
  onTogglePin(id: string, pinned: boolean): void;
  onRename(id: string, currentTitle: string): void;
  onArchive(id: string): void;
  /** Restore an archived conversation to the active list. */
  onUnarchive?(id: string): void;
  onDelete(id: string): void;
}

export function Sidebar(props: SidebarProps) {
  const [query, setQuery] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);

  const resolveName = useMemo(
    () => (c: Conversation) => targetName(c, props.agents, props.teams, props.modelNames),
    [props.agents, props.modelNames, props.teams],
  );

  const { active, archived } = useMemo(
    () => partitionActiveArchived(props.conversations),
    [props.conversations],
  );

  const filteredActive = useMemo(
    () => filterConversationsByQuery(active, query, resolveName),
    [active, query, resolveName],
  );
  const filteredArchived = useMemo(
    () => filterConversationsByQuery(archived, query, resolveName),
    [archived, query, resolveName],
  );

  const groups = useMemo(() => groupConversations(filteredActive), [filteredActive]);

  if (props.nav.sidebarCollapsed) {
    return (
      <aside
        data-testid="shell-sidebar"
        data-collapsed="true"
        className="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border bg-surface py-2"
      >
        <button
          data-testid="sidebar-toggle"
          className="flex h-8 w-8 items-center justify-center rounded-(--radius-row) text-text-secondary hover:bg-hover hover:text-text"
          title="展开侧栏"
          onClick={props.onToggleSidebar}
        >
          <PanelLeft size={16} />
        </button>
        <div className="mt-2 flex flex-col items-center gap-1 border-t border-border pt-2">
          {PRIMARY_STAGES.map((stage) => {
            const Icon = STAGE_ICONS[stage];
            const active = props.nav.stage === stage;
            return (
              <button
                key={stage}
                data-testid={`nav-${stage}`}
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-(--radius-row)',
                  active
                    ? 'bg-accent-soft text-accent-text'
                    : 'text-text-secondary hover:bg-hover hover:text-text',
                )}
                title={STAGE_LABELS[stage]}
                onClick={() => props.onSelectStage(stage)}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside
      data-testid="shell-sidebar"
      className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-surface"
    >
      {/* 最近对话 */}
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-2">
        <div className="flex h-7 shrink-0 items-center px-1.5">
          <span className="flex-1 text-[11px] font-medium text-text-faint">最近对话</span>
          <button
            data-testid="sidebar-toggle"
            className="flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
            title="收起侧栏"
            onClick={props.onToggleSidebar}
          >
            <PanelLeftClose size={14} />
          </button>
        </div>

        {/* Local search (title / target name) */}
        <div className="relative mb-1.5 shrink-0 px-0.5">
          <Search
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint"
          />
          <input
            data-testid="sidebar-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话…"
            className="h-7 w-full rounded-(--radius-row) border border-border bg-page pl-7 pr-7 text-[12px] text-text placeholder:text-text-faint outline-none focus:border-accent/40"
          />
          {query ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
              title="清除"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {(Object.keys(TRACK_LABELS) as ConversationTrack[]).map((track) => {
            const TrackIcon = TRACK_ICONS[track];
            const expanded = props.nav.expandedTracks[track];
            const items = groups[track];
            return (
              <div key={track} className="mb-0.5">
                <div
                  className="group flex h-7 cursor-pointer items-center gap-1 rounded-(--radius-row) px-1.5 hover:bg-hover"
                  data-testid={`track-header-${track}`}
                  onClick={() => props.onToggleTrack(track)}
                >
                  {expanded ? (
                    <ChevronDown size={13} className="text-text-faint" />
                  ) : (
                    <ChevronRight size={13} className="text-text-faint" />
                  )}
                  <TrackIcon size={13} className="text-text-secondary" />
                  <span className="flex-1 text-[12px] text-text-secondary">
                    {TRACK_LABELS[track]}
                  </span>
                  <button
                    data-testid={`track-new-${track}`}
                    className="invisible flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible"
                    title={`新建${TRACK_LABELS[track]}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onNewConversation(track);
                    }}
                  >
                    <Plus size={13} />
                  </button>
                </div>
                {expanded && (
                  <div className="ml-4">
                    {items.length === 0 ? (
                      <div className="px-2 py-1 text-[11px] text-text-faint">
                        {props.bootState === 'loading'
                          ? '加载中…'
                          : props.bootState === 'error'
                            ? props.bootError || '连接失败'
                            : query.trim()
                              ? '无匹配'
                              : '暂无对话'}
                      </div>
                    ) : (
                      items.map((c) => (
                        <ConversationRow
                          key={c.id}
                          conversation={c}
                          name={resolveName(c)}
                          active={props.nav.selectedConversationId === c.id}
                          onOpen={() => props.onOpenConversation(c.id)}
                          onTogglePin={() => props.onTogglePin(c.id, !c.pinnedAt)}
                          onRename={() =>
                            props.onRename(c.id, c.title || resolveName(c))
                          }
                          onArchive={() => props.onArchive(c.id)}
                          onDelete={() => props.onDelete(c.id)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Archived section */}
          {(filteredArchived.length > 0 || archived.length > 0) && (
            <div className="mt-2 border-t border-border pt-1.5">
              <button
                type="button"
                data-testid="archive-section-toggle"
                className="group flex h-7 w-full cursor-pointer items-center gap-1 rounded-(--radius-row) px-1.5 text-left hover:bg-hover"
                onClick={() => setArchiveOpen((v) => !v)}
              >
                {archiveOpen ? (
                  <ChevronDown size={13} className="text-text-faint" />
                ) : (
                  <ChevronRight size={13} className="text-text-faint" />
                )}
                <Archive size={13} className="text-text-secondary" />
                <span className="flex-1 text-[12px] text-text-secondary">归档</span>
                <span className="text-[10.5px] text-text-faint">{filteredArchived.length}</span>
              </button>
              {archiveOpen && (
                <div className="ml-4">
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
                        active={props.nav.selectedConversationId === c.id}
                        archived
                        onOpen={() => props.onOpenConversation(c.id)}
                        onTogglePin={() => props.onTogglePin(c.id, !c.pinnedAt)}
                        onRename={() => props.onRename(c.id, c.title || resolveName(c))}
                        onArchive={() => props.onUnarchive?.(c.id)}
                        onDelete={() => props.onDelete(c.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 一级导航（对话之外的舞台） */}
      <nav className="border-t border-border px-2 py-2">
        {PRIMARY_STAGES.map((stage) => {
          const Icon = STAGE_ICONS[stage];
          const active = props.nav.stage === stage;
          return (
            <button
              key={stage}
              data-testid={`nav-${stage}`}
              className={clsx(
                'flex h-8 w-full items-center gap-2 rounded-(--radius-row) px-2 text-[12.5px]',
                active
                  ? 'bg-accent-soft text-accent-text'
                  : 'text-text-secondary hover:bg-hover hover:text-text',
              )}
              onClick={() => props.onSelectStage(stage)}
            >
              <Icon size={15} />
              {STAGE_LABELS[stage]}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 7) return `${d}天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function ConversationRow(props: {
  conversation: Conversation;
  name: string;
  active: boolean;
  archived?: boolean;
  onOpen(): void;
  onTogglePin(): void;
  onRename(): void;
  onArchive(): void;
  onDelete(): void;
}) {
  const { conversation: c } = props;
  const title = c.title || props.name;
  const timeStr = relativeTime(c.lastMessageAt ?? c.updatedAt);
  return (
    <div
      data-testid={`conversation-${c.id}`}
      data-archived={props.archived ? '1' : '0'}
      className={clsx(
        'group relative flex cursor-pointer flex-col rounded-(--radius-row) pl-2 pr-1 py-1.5',
        props.active ? 'bg-active text-text' : 'text-text-secondary hover:bg-hover',
        props.archived && !props.active ? 'opacity-80' : '',
      )}
      onClick={props.onOpen}
    >
      {props.active && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-accent" />
      )}
      {/* Title + menu row */}
      <div className="flex items-center gap-1">
        <span className="flex-1 truncate text-[12.5px] font-medium">{title}</span>
        {c.pinnedAt && !props.archived && (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-accent" title="已置顶">
            <Pin size={11} className="fill-current" />
          </span>
        )}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              data-testid={`conversation-menu-trigger-${c.id}`}
              className="invisible flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-faint hover:bg-active hover:text-text group-hover:visible data-[state=open]:visible data-[state=open]:bg-active data-[state=open]:text-text"
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
              className="z-50 min-w-[140px] rounded-(--radius-card) border border-border bg-overlay p-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuItem icon={<Pencil size={13} />} label="重命名" onSelect={props.onRename} />
              {!props.archived && (
                <MenuItem
                  icon={<Pin size={13} />}
                  label={c.pinnedAt ? '取消置顶' : '置顶'}
                  onSelect={props.onTogglePin}
                />
              )}
              <MenuItem
                icon={props.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                label={props.archived ? '取消归档' : '归档'}
                onSelect={props.onArchive}
              />
              <DropdownMenu.Separator className="mx-1 my-1 h-px bg-border" />
              <MenuItem icon={<Trash2 size={13} />} label="删除" danger onSelect={props.onDelete} />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      {/* Timestamp */}
      {timeStr && (
        <span className="pl-0.5 text-[10.5px] text-text-faint">
          {props.archived ? `已归档 · ${timeStr}` : timeStr}
        </span>
      )}
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
