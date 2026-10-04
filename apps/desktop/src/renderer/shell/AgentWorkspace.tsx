import { ATTENTION_LABELS, type ConversationActivityView } from '../../conversation-attention.js';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ArrowLeft, Check, ChevronDown, ChevronRight, MessageSquare, MoreHorizontal, PanelLeft, Pin, Plus, Search, Settings2, Users, X } from 'lucide-react';
import type { CollaborationSnapshot, Conversation, GlobalAgent, Team } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import type { ModelOption } from './NewConversationDialog.js';
import { AgentEditorPanel } from './collaboration-agent-editor.js';
import { SidebarChatActions, SidebarChatSearch } from './SidebarChatActions.js';
import { CollaborationChatView } from './CollaborationChatView.js';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { AvatarCluster, collaborationGroupTitle } from './collaboration-identity.js';
import { collaborationRequest } from './use-collaboration-chat.js';
import { useCollaborationRosters } from './collaboration-roster-store.js';
import { hasAgentChatMessages, isAgentActive } from './agent-contacts.js';
import { PROJECTLESS_SCOPE, runtimeWorkspaceId } from './projectless-scope.js';
import { KeepAliveLayer, useKeepAliveActive } from './KeepAliveLayer.js';
import './agent-workspace.css';
import { preservePromotedDraft } from './collaboration-draft.js';
import { AgentModelRepair } from './AgentModelRepair.js';
import { isAgentConversation, type AgentWorkspaceNavigation } from './conversation-surface.js';
import {
  buildAgentWorkspaceContacts,
  readContactOrder,
  readPinnedAgents,
  reorderContactIds,
  togglePinnedAgent,
  writeContactOrder,
  writePinnedAgents,
  type AgentWorkspaceContact,
} from './agent-workspace-contacts.js';

const WorkspaceTeamLibrary = lazy(() => import('./TeamLibrary.js').then(module => ({ default: module.TeamLibrary })));
const WorkspaceChatFolders = lazy(() => import('./GroupChatFolders.js'));
const NO_TEAMS: readonly Team[] = [];

export interface AgentWorkspaceProps {
  /** Reuse the shared shell; only portal the contact list into its sidebar. */
  embedded?: boolean;
  sidebarHost?: HTMLDivElement | null;
  actionsHost?: HTMLDivElement | null;
  sidebarVisible?: boolean;
  contentActive?: boolean;
  onContentSelected?(): void;
  onOpenSidebar?(): void;
  workspaceId: string;
  workspaces: readonly WorkspaceSummary[];
  conversations: readonly Conversation[];
  agents: readonly GlobalAgent[];
  teams?: readonly Team[];
  models?: readonly ModelOption[];
  loading?: boolean;
  navigation?: AgentWorkspaceNavigation;
  onNavigationHandled?(): void;
  conversationActivity?: ReadonlyMap<string, ConversationActivityView>;
  onResultsViewed?(conversationId: string, runIds: readonly string[]): void;
  onExit(): void;
  onSelectWorkspace(id: string): void;
  onRefresh(): Promise<unknown> | void;
  onSettings(): void;
  onManageAgents(): void;
  onTogglePin(id: string, pinned: boolean): void;
  onRename(id: string, title: string): void;
  onArchive(id: string): void;
  onUnarchive(id: string): void;
  renderAgentLibrary?(onBack: () => void, onStartConversation: (agentId: string) => void, initialAgentId?: string): ReactNode;
  renderLegacyConversation?(conversation: Conversation, onEditAgent: (id: string) => void, agents: readonly GlobalAgent[], onResultsViewed?: (runIds: readonly string[]) => void): ReactNode;
}
const selectionKey = (scope: string) => `sync-think.agent-workspace.selection.v1:${scope}`;
function readSelected(scope: string) {
  try { return localStorage.getItem(selectionKey(scope)) ?? undefined; } catch { return undefined; }
}
export function agentWorkspaceConversations(conversations: readonly Conversation[], workspaceId: string) {
  return conversations.filter(c => (c.workspaceId ?? PROJECTLESS_SCOPE) === workspaceId && isAgentConversation(c))
    .slice().sort((a, b) => Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) || (b.lastMessageAt ?? b.updatedAt).localeCompare(a.lastMessageAt ?? a.updatedAt));
}


/** Contact identity comes from the agent record; chat titles remain history labels. */
export function agentConversationName(conversation: Conversation, agents: readonly GlobalAgent[]) {
  if (conversation.collaborationKind === 'group' || conversation.track === 'team') return conversation.title || '智能体群聊';
  return agents.find(agent => agent.id === conversation.targetRef)?.name ?? '已移除的智能体';
}
export function agentContactConversations(conversations: readonly Conversation[], selectedId?: string) {
  const seen = new Set<string>();
  return conversations.flatMap(conversation => {
    if (conversation.collaborationKind === 'group' || conversation.track === 'team') return [conversation];
    if (seen.has(conversation.targetRef)) return [];
    seen.add(conversation.targetRef);
    return [conversations.find(item => item.id === selectedId && item.targetRef === conversation.targetRef && item.collaborationKind !== 'group' && item.track !== 'team') ?? conversation];
  });
}

function SortableWorkspaceRow({
  id,
  disabled,
  className,
  children,
}: {
  id: string;
  disabled: boolean;
  className: string;
  children: (bind: { attributes: object; listeners: object | undefined }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${className}${isDragging ? ' is-dragging' : ''}${disabled ? '' : ' is-sortable'}`}
      data-testid="workspace-contact"
      data-contact-id={id}
    >
      {children({
        attributes: disabled ? {} : attributes,
        listeners: disabled ? undefined : listeners,
      })}
    </div>
  );
}

function WorkspaceRowMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="aw-row-menu"
          aria-label={label}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => { if (!open) setOpen(true); }}
        >
          <MoreHorizontal size={16} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="aw-menu" side="right" align="start" sideOffset={8} onCloseAutoFocus={event => event.preventDefault()}>
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export default function AgentWorkspace(props: AgentWorkspaceProps) {
  const active = useKeepAliveActive();
  const contentActive = active && (props.contentActive ?? true);
  const sidebarActive = active && (props.sidebarVisible ?? true);
  const openSidebar = () => props.embedded ? props.onOpenSidebar?.() : setSidebarOpen(true);
  const collaborationRosters = useCollaborationRosters(active);
  const teams = props.teams ?? NO_TEAMS;
  const [teamsOpen, setTeamsOpen] = useState(false);
  const teamCreateReceipts = useRef(new Map<string, string>());
  const invitingTeam = useRef(false);
  const [updatedAgents, setUpdatedAgents] = useState<Record<string, GlobalAgent>>({});
  const agents = useMemo(() => {
    const merged = props.agents.map(agent => {
      const local = updatedAgents[agent.id];
      return local && (!agent.updatedAt || local.updatedAt >= agent.updatedAt) ? local : agent;
    });
    return [...merged, ...Object.values(updatedAgents).filter(agent => !props.agents.some(item => item.id === agent.id))];
  }, [props.agents, updatedAgents]);
  const [profile, setProfile] = useState<string | null>(null);
  const profileAgent = agents.find(agent => agent.id === profile);
  const saveAgent = (agent?: GlobalAgent) => {
    if (agent) setUpdatedAgents(current => ({ ...current, [agent.id]: agent }));
    void Promise.resolve(props.onRefresh()).catch(() => undefined);
  };
  const editAgent = (id: string) => { props.onContentSelected?.(); setTeamsOpen(false); setProfile(id); setSidebarOpen(false); };
  const createAgent = () => { props.onContentSelected?.(); setPicker(false); setProfile('create'); setSidebarOpen(false); };

  const [selectedId, setSelectedId] = useState(() => readSelected(props.workspaceId));
  const [localConversations, setLocalConversations] = useState<Record<string, Conversation>>({});
  const rememberConversation = (conversation: Conversation) => setLocalConversations(current => ({ ...current, [conversation.id]: conversation }));
  const [promoted, setPromoted] = useState<Record<string, Conversation>>({});
  const [upgradeError, setUpgradeError] = useState<{ id: string; busy: boolean; message: string }>();
  const [upgradeRevision, setUpgradeRevision] = useState(0);
  const refreshRef = useRef(props.onRefresh); refreshRef.current = props.onRefresh;
  const [chatEvidence, setChatEvidence] = useState<Record<string, string>>({});
  const [roomStates, setRoomStates] = useState<Record<string, string>>({});
  const [rosters, setRosters] = useState<Record<string, CollaborationSnapshot['members']>>({});
  const [openError, setOpenError] = useState('');
  const navigationSequence = useRef(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [picker, setPicker] = useState(false);
  const [initialTaskRoom, setInitialTaskRoom] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [initialAgentId, setInitialAgentId] = useState<string>();
  const manage = () => props.renderAgentLibrary ? setLibraryOpen(true) : props.onManageAgents();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activations, setActivations] = useState<Record<string, boolean>>({});
  const [activationError, setActivationError] = useState('');
  const [activationReady, setActivationReady] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceId = props.workspaceId;
  const [contactOrder, setContactOrder] = useState(() => readContactOrder(workspaceId));
  const [pinnedAgentIds, setPinnedAgentIds] = useState(() => readPinnedAgents(workspaceId));
  useEffect(() => {
    setContactOrder(readContactOrder(workspaceId));
    setPinnedAgentIds(readPinnedAgents(workspaceId));
  }, [workspaceId]);
  const contactSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  useEffect(() => {
    if (!sidebarActive) return;
    const search = () => setSearching(true);
    const create = () => setPicker(true);
    window.addEventListener('shell-open-conversation-search', search);
    window.addEventListener('shell-new-agent-chat', create);
    return () => { window.removeEventListener('shell-open-conversation-search', search); window.removeEventListener('shell-new-agent-chat', create); };
  }, [sidebarActive]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setActivationReady(false);
    const api = window.syncThink?.runtime;
    const id = runtimeWorkspaceId(workspaceId);
    if (!id) { setActivations({}); setActivationReady(true); setActivationError(''); return; }
    if (!api?.listGlobalAgentWorkspaceActivations) { setActivationError('激活状态暂不可用；仍可使用全局智能体。'); setActivationReady(true); return; }
    void api.listGlobalAgentWorkspaceActivations({ workspaceId: id }).then(result => {
      if (cancelled) return;
      setActivations(Object.fromEntries(result.activations.map(item => [`${item.agentId}:${item.workspaceId}`, item.active])));
      setActivationError('');
    }).catch(() => { if (!cancelled) setActivationError('读取激活状态失败；仍可使用全局智能体。'); })
      .finally(() => { if (!cancelled) setActivationReady(true); });
    return () => { cancelled = true; };
  }, [workspaceId, agents, active]);
  const available = useMemo(() => agents.filter(a => isAgentActive(a, workspaceId, activations)), [agents, workspaceId, activations]);
  const conversations = useMemo(() => {
    const known = new Set<string>(props.conversations.map(conversation => conversation.id));
    const all = [...Object.values(localConversations).filter(conversation => !known.has(conversation.id)), ...props.conversations];
    return agentWorkspaceConversations(all.map(c => { const current = c.collaborationKind && promoted[c.id] ? { ...c, ...promoted[c.id] } : c; return chatEvidence[c.id] ? { ...current, hasMessages: true, lastMessageAt: chatEvidence[c.id] } : current; }), workspaceId);
  }, [props.conversations, workspaceId, localConversations, promoted, chatEvidence]);
  useEffect(() => {
    const known = new Set<string>(props.conversations.map(conversation => conversation.id));
    setLocalConversations(current => Object.keys(current).some(id => known.has(id))
      ? Object.fromEntries(Object.entries(current).filter(([id]) => !known.has(id))) : current);
  }, [props.conversations]);
  const selected = conversations.find(c => c.id === selectedId) ?? conversations.find(c => !c.archivedAt);
  const needsUpgrade = selected?.collaborationKind === 'direct' && Boolean(props.renderLegacyConversation);
  const upgradeId = needsUpgrade ? selected?.id : undefined;
  useEffect(() => {
    if (!contentActive || !upgradeId) return;
    let cancelled = false;
    const id = upgradeId;
    setUpgradeError(undefined);
    void collaborationRequest({ action: 'promote-direct', conversationId: id }).then(result => {
      if (cancelled) return;
      if (!result.promotedConversation) throw new Error('运行时尚未支持统一单聊，请重启应用加载本次更新。');
      preservePromotedDraft(id, result.snapshot);
      setPromoted(current => ({ ...current, [id]: result.promotedConversation! }));
      void Promise.resolve(refreshRef.current()).catch(() => undefined);
    }).catch(cause => {
      if (!cancelled) setUpgradeError({ id, busy: String(cause).includes('direct_busy'), message: String(cause).includes('direct_busy') ? '当前任务仍在执行，结束后可切换到完整聊天；已有记录会保留。' : '完整聊天尚未就绪，请重试。' });
    });
    return () => { cancelled = true; };
  }, [contentActive, upgradeId, upgradeRevision]);
  const searchTerm = query.trim().toLocaleLowerCase();
  const archivedConversations = conversations.filter(c => c.archivedAt && !c.id.startsWith('draft:') && (c.collaborationKind === 'group' || c.track === 'team' || hasAgentChatMessages(c)));
  const contacts = buildAgentWorkspaceContacts({
        agents: available,
        conversations,
        selectedId: selected?.id,
        searchTerm,
        order: contactOrder,
        pinnedAgentIds: new Set(pinnedAgentIds),
      });
  const roomContacts = contacts.filter(contact => contact.kind === 'group');
  const directContacts = contacts.filter(contact => contact.kind === 'agent');
  const archivedChats = archivedConversations.filter(c => `${c.title} ${c.lastMessagePreview ?? ''} ${agents.find(a => a.id === c.targetRef)?.name ?? ''}`.toLocaleLowerCase().includes(searchTerm));
  const dragDisabled = Boolean(searchTerm);
  const onContactDragEnd = (event: DragEndEvent) => {
    const overId = event.over ? String(event.over.id) : '';
    const activeId = String(event.active.id);
    if (!overId || overId === activeId || dragDisabled || contacts.find(item => item.id === activeId)?.kind !== contacts.find(item => item.id === overId)?.kind) return;
    const next = reorderContactIds(contacts.map((item) => item.id), activeId, overId);
    setContactOrder(next);
    writeContactOrder(workspaceId, next);
  };
  const pinAgentContact = (agentId: string) => {
    const next = togglePinnedAgent(pinnedAgentIds, agentId);
    setPinnedAgentIds(next);
    writePinnedAgents(workspaceId, next);
  };
  const startAgentChat = (id: string) => { setInitialTaskRoom(false); setInitialAgentId(id); setPicker(true); };
  const conversationLabel = (conversation: Conversation) => agentConversationName(conversation, agents);
  const selectedTeam = selected?.track === 'team' ? teams.find(team => team.id === selected.targetRef) : undefined;
  const selectedAgent = agents.find(agent => selected?.targetRef === agent.id);
  const open = (id: string) => {
    props.onContentSelected?.();
    const sequence = ++navigationSequence.current;
    setTeamsOpen(false); setSelectedId(id); setSidebarOpen(false); setProfile(null); setOpenError('');
    if (!conversations.some(c => c.id === id)) void collaborationRequest({ action: 'get', conversationId: id }).then(result => {
      if (sequence !== navigationSequence.current || !result.snapshot) return;
      const c = result.snapshot.conversation;
      const coordinator = result.snapshot.members.find(m => m.id === c.coordinatorMemberId);
      rememberConversation({ id: c.id as Conversation['id'], workspaceId: workspaceId as Conversation['workspaceId'], title: c.title, track: 'agent', targetRef: coordinator?.agentId ?? '', collaborationKind: c.kind, executionMode: 'workspace', interactionMode: 'execute', createdAt: c.createdAt, updatedAt: c.createdAt });
      rememberSnapshot(result.snapshot);
      void Promise.resolve(props.onRefresh()).catch(() => undefined);
    }).catch(cause => { if (sequence === navigationSequence.current) setOpenError(cause instanceof Error ? cause.message : '打开关联会话失败'); });
    try { localStorage.setItem(selectionKey(workspaceId), id); } catch { /* session-only */ }
  };
  const rememberSnapshot = (snapshot: CollaborationSnapshot) => {
    const state = snapshot.conversation.room?.state;
    if (state) setRoomStates(current => current[snapshot.conversation.id] === state ? current : { ...current, [snapshot.conversation.id]: state });
    const message = snapshot.messages.findLast(item => item.kind === 'chat' && snapshot.members.some(member => member.id === item.senderMemberId && member.kind === 'user'));
    if (message) setChatEvidence(current => current[snapshot.conversation.id] === message.createdAt ? current : { ...current, [snapshot.conversation.id]: message.createdAt });
    setRosters(current => current[snapshot.conversation.id] === snapshot.members ? current : { ...current, [snapshot.conversation.id]: snapshot.members });
  };
  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching]);
  const inviteTeam = async (team: Team) => {
    if (invitingTeam.current) return;
    invitingTeam.current = true;
    setOpenError('');
    try {
      const key = workspaceId + ':' + team.id;
      const clientRequestId = teamCreateReceipts.current.get(key) ?? crypto.randomUUID();
      teamCreateReceipts.current.set(key, clientRequestId);
      const titleBase = team.name + ' · 群聊';
      const titles = new Set(conversations.map(conversation => conversation.title));
      let number = 1;
      while (titles.has(titleBase + ' ' + number)) number++;
      const result = await collaborationRequest({ action: 'create', kind: 'group', clientRequestId, teamId: team.id, agentIds: [], workspaceId: runtimeWorkspaceId(workspaceId), title: titleBase + ' ' + number });
      if (!result.snapshot) throw new Error('团队群聊尚未就绪，请重试。');
      teamCreateReceipts.current.delete(key);
      const c = result.snapshot.conversation;
      const conversation = { id: c.id as Conversation['id'], workspaceId: runtimeWorkspaceId(workspaceId) as Conversation['workspaceId'], title: c.title, track: 'team', targetRef: team.id, collaborationKind: 'group', executionMode: 'ask', interactionMode: 'execute', createdAt: c.createdAt, updatedAt: c.createdAt } as Conversation;
      props.onContentSelected?.();
      rememberSnapshot(result.snapshot);
      rememberConversation(conversation); setSelectedId(conversation.id); setShowArchived(false); setTeamsOpen(false); setProfile(null); setSidebarOpen(false);
      try { localStorage.setItem(selectionKey(workspaceId), conversation.id); } catch { /* session only */ }
      void Promise.resolve(props.onRefresh()).catch(() => undefined);
    } catch (cause) { setOpenError(cause instanceof Error ? cause.message : '邀请小队失败'); }
    finally { invitingTeam.current = false; }
  };
  // A command mailbox: use current handlers without rerunning a request after internal navigation.
  const navigationHandler = useRef<(request: AgentWorkspaceNavigation) => void>(() => {});
  navigationHandler.current = request => {
    setLibraryOpen(false); setTeamsOpen(false); setPicker(false); setInitialTaskRoom(false); setProfile(null);
    setSearching(false); setQuery(''); setSidebarOpen(false);
    if (request.conversationId) {
      setShowArchived(Boolean(conversations.find(c => c.id === request.conversationId)?.archivedAt));
      open(request.conversationId);
    } else if (request.teamId !== undefined) {
      const team = teams.find(t => t.id === request.teamId);
      if (team) void inviteTeam(team);
      else setTeamsOpen(true);
    } else {
      setInitialAgentId(request.agentId); setPicker(true);
    }
  };
  const handledNavigation = useRef<AgentWorkspaceNavigation>();
  const { navigation, onNavigationHandled } = props;
  useEffect(() => {
    if (!active || !navigation || navigation.workspaceId !== workspaceId || handledNavigation.current === navigation) return;
    handledNavigation.current = navigation;
    navigationHandler.current(navigation);
    onNavigationHandled?.();
  }, [active, navigation, onNavigationHandled, workspaceId]);
  const conversationActivity = (items: readonly Conversation[]) => ({
    attention: items.map(item => props.conversationActivity?.get(item.id)?.attention).find(Boolean),
    running: items.some(item => props.conversationActivity?.get(item.id)?.running),
    unread: items.some(item => props.conversationActivity?.get(item.id)?.unread),
  });
  const renderConversationBody = (
    c: Conversation,
    directHistory: readonly Conversation[],
    pinned: boolean,
    drag?: { attributes: object; listeners: object | undefined },
    folderMenu?: ReactNode,
  ) => {
    const agent = agents.find(a => a.id === c.targetRef);
    const summary = collaborationRosters.get(c.id);
    const roomState = summary?.roomState ?? roomStates[c.id];
    const roster = summary?.members ?? rosters[c.id]?.filter(m => m.active && m.kind !== 'user' && !m.teamParticipantId).map(m => ({ ...m, avatar: m.kind === 'team' ? m.avatar : agents.find(a => a.id === m.agentId)?.avatar ?? m.avatar }));
    const label = conversationLabel(c);
    const direct = c.collaborationKind !== 'group' && c.track !== 'team';
    const history = direct ? directHistory : [];
    const activity = conversationActivity(direct ? history : [c]);
    if (!direct && summary && !activity.attention) activity.running ||= summary.busy && !['paused', 'completed'].includes(roomState ?? '');
    if (activity.attention) activity.running = false;
    return <>
      <button type="button" className="aw-conversation__select" aria-label={!direct ? `打开群聊：${label}` : undefined} aria-current={contentActive && selected?.id === c.id ? 'page' : undefined} {...drag?.attributes} {...drag?.listeners} onClick={() => open(c.id)}>
        <span className="aw-conversation__avatar">{roster && roster.length > 1 ? <AvatarCluster members={roster} size={23} max={3} animate /> : <AgentWorkspaceAvatar name={label} avatar={agent?.avatar} size={34} animate state={activity.running ? 'working' : 'idle'} />}{c.collaborationKind === 'group' && !roster && <Users size={12} className="aw-group-badge" />}</span>
        <span className="aw-conversation__copy"><span className="aw-conversation__title">{label}</span><span className={activity.running ? 'aw-conversation__preview is-running' : 'aw-conversation__preview'}>{!direct && roomState && <span>{{ discussion: '讨论', blocked: '有阻塞', running: '工作中', pausing: '正在暂停', paused: '已暂停', review: '待验收', completed: '已验收' }[roomState]} · </span>}{activity.attention ? ATTENTION_LABELS[activity.attention] : activity.running ? '正在协作…' : summary?.preview || c.lastMessagePreview || (!direct ? '成员已加入，开始讨论或确认任务' : '开始聊聊你的想法')}</span></span>
        {activity.unread && <span className="aw-unread" aria-label="未读" />}{pinned && <Pin size={12} className="aw-pinned" aria-label="已置顶" />}
      </button>
      <WorkspaceRowMenu label={`${label}的选项`}>
        {direct && agent && <><Menu.Item onSelect={() => editAgent(agent.id)}>编辑智能体</Menu.Item><Menu.Item onSelect={() => startAgentChat(agent.id)}>新建对话</Menu.Item></>}
        {history.length > 1 && <Menu.Sub><Menu.SubTrigger>历史会话 · {history.length}</Menu.SubTrigger><Menu.Portal><Menu.SubContent className="aw-menu" sideOffset={8}>{history.map(item => <Menu.Item key={item.id} onSelect={() => open(item.id)}>{item.title || '未命名会话'}{props.conversationActivity?.get(item.id)?.unread ? ' · 未读' : ''}{item.id === selected?.id ? ' ✓' : ''}</Menu.Item>)}</Menu.SubContent></Menu.Portal></Menu.Sub>}
        {folderMenu}
        <Menu.Item onSelect={() => props.onTogglePin(c.id, !c.pinnedAt)}>{pinned ? '取消置顶' : '置顶'}</Menu.Item>
        <Menu.Item onSelect={() => props.onRename(c.id, c.title)}>重命名会话</Menu.Item>
        <Menu.Item onSelect={() => c.archivedAt ? props.onUnarchive(c.id) : props.onArchive(c.id)}>{c.archivedAt ? '取消归档' : '归档会话'}</Menu.Item>
      </WorkspaceRowMenu>
    </>;
  };
  const renderConversationRow = (c: Conversation, directHistory: readonly Conversation[] = []) => (
    <div key={c.id} className={`aw-conversation${contentActive && selected?.id === c.id ? ' is-selected' : ''}`}>
      {renderConversationBody(c, directHistory, Boolean(c.pinnedAt))}
    </div>
  );
  const renderContact = (contact: AgentWorkspaceContact, folderMenu?: ReactNode) => {
    if (contact.kind === 'agent' && !contact.conversation) {
      const { agent, pinned } = contact;
      return <SortableWorkspaceRow key={contact.id} id={contact.id} disabled={dragDisabled} className="aw-conversation">
        {bind => <>
          <button type="button" className="aw-conversation__select" {...bind.attributes} {...bind.listeners} onClick={() => startAgentChat(agent.id)}>
            <span className="aw-conversation__avatar"><AgentWorkspaceAvatar name={agent.name} avatar={agent.avatar} size={34} animate /></span>
            <span className="aw-conversation__copy"><span className="aw-conversation__title">{agent.name}</span><span className="aw-conversation__preview">{agent.description || '开始聊聊你的想法'}</span></span>
            {pinned && <Pin size={12} className="aw-pinned" aria-label="已置顶" />}
          </button>
          <WorkspaceRowMenu label={`${agent.name}的选项`}>
            <Menu.Item onSelect={() => editAgent(agent.id)}>编辑智能体</Menu.Item>
            <Menu.Item onSelect={() => pinAgentContact(agent.id)}>{pinned ? '取消置顶' : '置顶'}</Menu.Item>
          </WorkspaceRowMenu>
        </>}
      </SortableWorkspaceRow>;
    }
    const conversation = contact.kind === 'group' ? contact.conversation : contact.conversation!;
    const history = contact.kind === 'agent' ? contact.history : [];
    return <SortableWorkspaceRow key={contact.id} id={contact.id} disabled={dragDisabled} className={`aw-conversation${contentActive && selected?.id === conversation.id ? ' is-selected' : ''}`}>
      {bind => renderConversationBody(conversation, history, contact.pinned, bind, folderMenu)}
    </SortableWorkspaceRow>;
  };
  const actions = <SidebarChatActions searchLabel="搜索智能体会话" newConversationLabel="新建智能体聊天" searching={searching} onSearch={() => setSearching(true)} onNewConversation={() => { setInitialAgentId(undefined); setPicker(true); }} />;
  const sidebar = <aside className="agent-chat-workspace__sidebar" aria-label="智能体会话列表">
      {(!props.embedded || !props.actionsHost) && actions}
      {searching && <SidebarChatSearch value={query} onChange={setQuery} inputRef={searchRef} autoFocus label="搜索会话" placeholder="搜索对话…" onEmptyBlur={() => setSearching(false)} onClose={() => { setSearching(false); setQuery(''); }} />}
      <div className="agent-chat-workspace__conversations">
        {props.loading && <p className="aw-list-empty" role="status">正在读取会话…</p>}
          <DndContext sensors={contactSensors} collisionDetection={closestCenter} onDragEnd={onContactDragEnd}>
            <SortableContext items={contacts.map(item => item.id)} strategy={verticalListSortingStrategy}>
              <Suspense fallback={<section aria-label="群聊列表"><div className="aw-section-heading">群聊</div>{roomContacts.map(contact => renderContact(contact))}</section>}><WorkspaceChatFolders key={workspaceId} scope={workspaceId} contacts={roomContacts} searchTerm={searchTerm} onCreateChat={() => { setInitialTaskRoom(true); setPicker(true); }} renderContact={renderContact} /></Suspense>
              {directContacts.length > 0 && <section aria-label="智能体私聊列表"><div className="aw-section-heading"><span>智能体私聊</span></div>{directContacts.map(contact => renderContact(contact))}</section>}
            </SortableContext>
          </DndContext>

        {!props.loading && !contacts.length && !archivedChats.length && <p className="aw-list-empty">{query ? '没有匹配的会话' : '从上方“新建对话”开始一场对话'}</p>}
        {archivedConversations.length > 0 && <section className="aw-archive-section" aria-label="智能体归档列表">
          <button type="button" data-testid="agent-archive-section-toggle" className="st-press-motion st-row-motion aw-archive-toggle" aria-label="归档会话" aria-expanded={showArchived} onClick={() => setShowArchived(value => !value)}>
            <ChevronRight size={13} className="st-chevron" data-open={showArchived} /><Archive size={13} /><span>归档</span><span className="aw-archive-count">{archivedChats.length}</span>
          </button>
          <div className={'shell-collapse' + (showArchived ? ' shell-collapse--open' : '')} aria-hidden={!showArchived}>
            <div className="shell-collapse__inner">{archivedChats.length ? archivedChats.map(c => renderConversationRow(c)) : <p className="aw-list-empty">{query ? '无匹配' : '暂无归档'}</p>}</div>
          </div>
        </section>}
      </div>
      <button className="aw-create-agent" onClick={createAgent}><Plus size={16} />创建智能体</button>
      <footer className="agent-chat-workspace__footer">
        {!props.embedded && <button className="aw-footer-link" onClick={props.onExit}><ArrowLeft size={17} />返回工作台</button>}
        {!props.embedded && <div className="aw-footer-row"><button className="aw-footer-link" onClick={props.onSettings}><Settings2 size={17} />设置</button></div>}
        <label className="aw-workspace-select"><span className="aw-workspace-mark"><MessageSquare size={19} /></span><span><span className="aw-workspace-caption">当前工作区</span><select aria-label="智能体工作区" value={workspaceId} onChange={e => props.onSelectWorkspace(e.target.value)}>{props.workspaces.map(w => <option key={w.workspaceId} value={w.workspaceId}>{w.name}</option>)}{!props.workspaces.some(w => w.workspaceId === workspaceId) && <option value={workspaceId}>不绑定工作区</option>}</select></span><ChevronDown size={14} /></label>
      </footer>
    </aside>;
  return <>
    {props.embedded && sidebarActive && props.actionsHost && createPortal(actions, props.actionsHost)}
    {props.embedded && sidebarActive && props.sidebarHost && createPortal(
      <div className="agent-chat-workspace agent-chat-workspace--sidebar-only">{sidebar}</div>,
      props.sidebarHost,
    )}
    <section className={`agent-chat-workspace${props.embedded ? ' agent-chat-workspace--embedded' : ''}${sidebarOpen ? ' is-sidebar-open' : ''}`} aria-label="智能体工作区" data-testid="agent-workspace">
    {!props.embedded && <><button className="agent-chat-workspace__scrim" aria-label="关闭会话列表" onClick={() => setSidebarOpen(false)} tabIndex={sidebarOpen ? 0 : -1} />{sidebar}</>}
    <KeepAliveLayer active={contentActive} className="agent-chat-workspace__content-layer">
    <div className="agent-chat-workspace__content">
      {openError && <div className="aw-open-error" role="alert">{openError}<button onClick={() => selectedId && open(selectedId)}>重试</button></div>}
      {teamsOpen ? <div className="aw-team-library"><header><button className="aw-icon" aria-label="返回智能体聊天" onClick={() => setTeamsOpen(false)}><ArrowLeft size={18} /></button><strong>管理团队</strong><span>成员加入团队后，可以整队执行，也可以单独交流。</span></header><Suspense fallback={<p className="aw-list-empty">正在打开小队…</p>}><WorkspaceTeamLibrary teams={teams} agents={agents} onRefresh={() => { void props.onRefresh(); }} onStartConversation={id => { const team = teams.find(t => t.id === id); if (team) void inviteTeam(team); }} /></Suspense></div> : <>

      {selected && <AgentModelRepair key={selected.id} agents={selectedTeam ? agents.filter(a => selectedTeam.members.some(m => m.agentId === a.id)) : selectedAgent && selected.collaborationKind !== 'group' ? [selectedAgent] : agents.filter(a => rosters[selected.id]?.some(m => m.active && m.agentId === a.id))} models={props.models} onSaved={saveAgent} onSettings={props.onSettings} />}
      {needsUpgrade && (!upgradeError || upgradeError.id !== selected?.id || !upgradeError.busy) ? <main className="aw-welcome" aria-label="升级单聊"><p role={upgradeError ? 'alert' : 'status'}>{upgradeError?.id === selected?.id ? upgradeError.message : '正在保留历史记录并打开完整聊天…'}</p>{upgradeError?.id === selected?.id && <button className="collab-pill" onClick={() => setUpgradeRevision(v => v + 1)}>重试打开</button>}</main> : (selected?.collaborationKind || selected?.track === 'team') ? <>{needsUpgrade && <div className="collab-notice">{upgradeError?.message}<button className="collab-pill" onClick={() => setUpgradeRevision(v => v + 1)}>切换完整聊天</button></div>}<CollaborationChatView workspace key={selected.id} conversation={{ ...selected, title: conversationLabel(selected) }} agents={agents} teams={teams} models={props.models} onEditAgent={editAgent} active={contentActive} onOpenConversation={open} onAgentsChanged={saveAgent} onSnapshot={rememberSnapshot} onResultsViewed={runIds => props.onResultsViewed?.(selected.id, runIds)} onOpenSidebar={openSidebar} onNewChat={() => setPicker(true)} projectFolder={props.workspaces.find(w => w.workspaceId === selected.workspaceId)?.folderPath} /></> : selected && props.renderLegacyConversation ? <div className="aw-legacy"><header><button className="aw-mobile-toggle aw-icon" aria-label="打开会话列表" onClick={openSidebar}><PanelLeft size={18} /></button><button className="aw-legacy__identity" aria-label={selectedAgent ? `编辑${selectedAgent.name}` : selectedTeam ? `管理${selectedTeam.name}` : '会话信息'} disabled={!selectedAgent && !selectedTeam} onClick={() => selectedAgent ? editAgent(selectedAgent.id) : setTeamsOpen(true)}><AgentWorkspaceAvatar name={conversationLabel(selected)} avatar={selectedAgent?.avatar ?? selectedTeam?.avatar} size={24} animate /><span>{conversationLabel(selected)}</span></button><Menu.Root><Menu.Trigger asChild><button className="aw-icon" aria-label="聊天设置"><MoreHorizontal size={18} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" sideOffset={8}>{selectedAgent && <Menu.Item onSelect={() => editAgent(selectedAgent.id)}>编辑智能体</Menu.Item>}<Menu.Item onSelect={() => { if (selectedTeam) void inviteTeam(selectedTeam); else { setInitialAgentId(selectedAgent?.id); setPicker(true); } }}>新建对话</Menu.Item><Menu.Item onSelect={manage}>管理智能体</Menu.Item></Menu.Content></Menu.Portal></Menu.Root></header><Suspense fallback={<p className="aw-list-empty">正在打开会话…</p>}>{props.renderLegacyConversation(selected, editAgent, agents, runIds => props.onResultsViewed?.(selected.id, runIds))}</Suspense></div> : <main className="aw-welcome" aria-label="智能体聊天">
        <header><button className="aw-mobile-toggle aw-icon" aria-label="打开会话列表" onClick={openSidebar}><PanelLeft size={18} /></button><span>智能体</span><button className="aw-icon" aria-label="选择聊天成员" onClick={() => setPicker(true)}><Plus size={18} /></button></header>
        <div className="aw-welcome__body"><AvatarCluster members={available.slice(0, 3)} size={64} max={3} animate /><h1>{available.length ? '几个头脑，一场对话' : '让想法，多一种可能'}</h1><p>{available.length ? '和一位智能体深入交流，或把不同专长聚在一起。' : '添加你的第一位智能体，再一起开始。'}</p><button className="aw-primary" disabled={props.loading} onClick={available.length ? () => setPicker(true) : createAgent}>{available.length ? '开始聊天' : '添加智能体'}<Plus size={16} /></button></div>
        <div className="aw-welcome__hint">单聊、群聊与协作任务，都留在同一个地方。</div>
      </main>}
      </>}
    </div>
    {profile && (profile === 'create' || profileAgent) && <aside className="collab-panel aw-profile-panel" aria-label={profile === 'create' ? '创建智能体' : '智能体设置'}><header><strong>{profile === 'create' ? '创建智能体' : profileAgent?.name}</strong><button className="aw-icon" aria-label="关闭智能体编辑" onClick={() => setProfile(null)}><X size={16} /></button></header>{profile === 'create' && <button type="button" className="aw-text-button aw-profile-chat" onClick={() => { setInitialAgentId(undefined); setPicker(true); }}><MessageSquare size={16} />与已有智能体聊天</button>}<AgentEditorPanel key={profile} workspace creating={profile === 'create'} agent={profileAgent} member={{ id: profile, agentId: profileAgent?.id, name: profileAgent?.name ?? '新智能体', avatar: profileAgent?.avatar ?? '', kind: 'agent', role: '成员', active: true }} models={props.models} onSaved={saveAgent} onCreated={agent => { saveAgent(agent); setProfile(agent.id); }} onAdvanced={manage} onModelSettings={props.onSettings} />{profileAgent && <button className="aw-text-button aw-profile-chat" onClick={() => startAgentChat(profileAgent.id)}>与 {profileAgent.name} 开始新对话</button>}</aside>}
    </KeepAliveLayer>
    <AgentChatPicker existingTitles={conversations.map(c => c.title)} initialTaskRoom={initialTaskRoom} teams={teams} onManageTeams={() => { props.onContentSelected?.(); setLibraryOpen(false); setTeamsOpen(true); }} onCreateAgent={createAgent} initialAgentId={initialAgentId} open={picker} onClose={() => { setPicker(false); setInitialAgentId(undefined); setInitialTaskRoom(false); }} agents={available} loading={!activationReady || props.loading} warning={activationError} workspaceId={workspaceId} onManage={manage} onCreated={(snapshot, selectedAgents, direct, teamId) => {
      const c = snapshot.conversation;
      const now = c.createdAt;
      const next: Conversation = direct ?? { id: c.id as Conversation['id'], workspaceId: workspaceId as Conversation['workspaceId'], title: c.title, track: teamId ? 'team' : 'agent', targetRef: teamId ?? snapshot.members.find(member => member.id === c.coordinatorMemberId)?.agentId ?? selectedAgents[0]?.id ?? '', collaborationKind: c.kind, executionMode: 'workspace', interactionMode: 'execute', createdAt: now, updatedAt: now };
      props.onContentSelected?.();
      rememberConversation(next); rememberSnapshot(snapshot); setSelectedId(c.id); setShowArchived(false); setSidebarOpen(false); setProfile(null);
      try { localStorage.setItem(selectionKey(workspaceId), c.id); } catch { /* session-only */ }
      setPicker(false); setInitialAgentId(undefined); setInitialTaskRoom(false);
      void Promise.resolve(props.onRefresh()).catch(() => { /* the authoritative created snapshot remains usable */ });
    }} />
    {props.renderAgentLibrary && <Dialog.Root open={libraryOpen} onOpenChange={setLibraryOpen}><Dialog.Portal><Dialog.Overlay className="aw-dialog-overlay" /><Dialog.Content className="aw-library-modal"><Dialog.Title className="sr-only">管理智能体</Dialog.Title><Dialog.Description className="sr-only">管理真实智能体、模型与能力配置。</Dialog.Description><Dialog.Close className="aw-library-close" aria-label="关闭智能体管理"><X size={18} /></Dialog.Close><Suspense fallback={<p>正在打开智能体库…</p>}>{props.renderAgentLibrary(() => setLibraryOpen(false), id => { setLibraryOpen(false); setInitialAgentId(id); setPicker(true); }, profileAgent?.id)}</Suspense></Dialog.Content></Dialog.Portal></Dialog.Root>}
  </section>
  </>;
}

export function AgentChatPicker({ existingTitles, onCreateAgent, initialAgentId, initialTaskRoom = false, open, onClose, agents, teams = NO_TEAMS, loading, warning, workspaceId, onManage, onManageTeams, onCreated }: {
  existingTitles?: readonly string[]; onCreateAgent?(): void; initialAgentId?: string; initialTaskRoom?: boolean; open: boolean; onClose(): void; agents: readonly GlobalAgent[]; teams?: readonly Team[]; loading?: boolean; warning?: string; workspaceId: string; onManage(): void; onManageTeams?(): void; onCreated(snapshot: CollaborationSnapshot, agents: readonly GlobalAgent[], direct?: Conversation, teamId?: string): void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState('');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [taskRoom, setTaskRoom] = useState(false);
  const [coordinatorId, setCoordinatorId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receipt = useRef<{ key: string; id: string }>();
  const submitting = useRef(false);
  useEffect(() => { if (open) { setIds(initialAgentId ? [initialAgentId] : []); setTeamId(''); setTaskRoom(initialTaskRoom); setCoordinatorId(initialAgentId ?? ''); setTitle(''); setQuery(''); setError(''); receipt.current = undefined; } }, [open, initialAgentId, initialTaskRoom]);
  const eligibleAgents = agents.filter(agent => !agent.archived && agent.enabled !== false);
  const agentById = new Map(eligibleAgents.map(agent => [agent.id as string, agent]));
  const teamOptions = teams.map(team => {
    const memberIds = [...new Set([...team.members].sort((a, b) => a.memberOrder - b.memberOrder).map(member => member.agentId))];
    const members = memberIds.flatMap(id => agentById.get(id) ?? []);
    const coordinator = agentById.get(team.coordinatorAgentId ?? memberIds[0]);
    const unavailable = !memberIds.length ? '小队尚未配置成员' : members.length !== memberIds.length ? '部分成员未启用或未在当前工作区激活' : !coordinator || !memberIds.includes(coordinator.id) ? '请先在小队设置中选择有效协调员' : '';
    return { team, memberIds, members, coordinator, unavailable };
  });
  const selectedTeam = teamOptions.find(option => option.team.id === teamId);
  const selectedIds = [...new Set([...(selectedTeam?.memberIds ?? []), ...ids])];
  const selected = selectedIds.flatMap(id => agentById.get(id) ?? []);
  const coordinator = selected.find(agent => agent.id === coordinatorId) ?? selectedTeam?.coordinator ?? selected[0];
  const group = Boolean(teamId) || selected.length > 1 || taskRoom;
  const selectionError = teamId ? selectedTeam?.unavailable ?? '该小队已被删除，请重新选择。' : '';
  const search = query.trim().toLocaleLowerCase();
  const visible = eligibleAgents.filter(agent => `${agent.name} ${agent.description}`.toLocaleLowerCase().includes(search));
  const visibleTeams = teamOptions.filter(({ team, members }) => `${team.name} ${team.mission} ${members.map(agent => agent.name).join(' ')}`.toLocaleLowerCase().includes(search));
  const titleBase = selectedTeam?.team.name ?? collaborationGroupTitle(selected.map(agent => agent.name));
  let defaultTitle = titleBase;
  for (let number = 2; existingTitles?.includes(defaultTitle); number++) defaultTitle = titleBase + ' · ' + number;
  const create = async () => {
    if (!selected.length || !coordinator || selectionError || submitting.current || loading) return;
    const kind = group ? 'group' : 'direct';
    const label = title.trim() || (kind === 'direct' ? selected[0].name : defaultTitle);
    const key = JSON.stringify([workspaceId, selected.map(agent => agent.id), teamId, label, coordinator.id, kind]);
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await collaborationRequest({ action: 'create', clientRequestId: receipt.current.id, kind, title: label, workspaceId: runtimeWorkspaceId(workspaceId), agentIds: selected.map(a => a.id), coordinatorAgentId: coordinator.id, ...(teamId ? { teamId } : {}) });
      if (!result.snapshot) throw new Error('服务尚未返回会话，请重试。');
      if (kind === 'direct') {
        const promoted = await collaborationRequest({ action: 'promote-direct', conversationId: result.snapshot.conversation.id });
        if (!promoted.promotedConversation) throw new Error('请重启应用加载统一聊天服务后重试。');
        onCreated(result.snapshot, selected, promoted.promotedConversation);
      } else onCreated(result.snapshot, selected, undefined, teamId || undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建会话失败，请重试。'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="aw-dialog-overlay" /><Dialog.Content className="aw-picker" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
    <Dialog.Close className="aw-picker__close aw-icon" aria-label="关闭成员选择" disabled={busy}><X size={18} /></Dialog.Close>
    <div className="aw-picker__cluster"><AvatarCluster members={(selected.length ? selected : eligibleAgents).slice(0, 3)} size={64} max={3} animate /></div>
    <Dialog.Title>和你的智能体聊聊</Dialog.Title><Dialog.Description className="aw-picker__description">选择已有小队，或自由组合智能体。每个群聊独立保存聊天记录与成果。</Dialog.Description>
    <label className="aw-picker__search"><Search size={16} /><input aria-label="搜索小队或智能体" placeholder="搜索小队或智能体…" value={query} disabled={busy} onChange={e => setQuery(e.target.value)} /></label>
    <section className="aw-picker__section" aria-label="选择已有小队">
      <div className="aw-picker__section-heading"><strong>选择已有小队</strong><span>整队加入 · 可额外添加成员</span></div>
      <div className="aw-picker__agents aw-picker__teams">{visibleTeams.map(option => <button type="button" className={`aw-agent-chip aw-team-chip${teamId === option.team.id ? ' is-selected' : ''}`} key={option.team.id} aria-label={`选择小队：${option.team.name}`} title={option.unavailable || `${option.team.name} · 协调员：${option.coordinator?.name}`} aria-pressed={teamId === option.team.id} disabled={busy || loading || Boolean(option.unavailable)} onClick={() => { setTeamId(teamId === option.team.id ? '' : option.team.id); setCoordinatorId(teamId === option.team.id ? '' : option.coordinator?.id ?? ''); setError(''); }}>
        <span className="aw-team-chip__avatar" aria-hidden="true">{option.members.length ? <AvatarCluster members={option.members.slice(0, 3)} size={20} max={3} animate /> : <AgentWorkspaceAvatar name={option.team.name} avatar={option.team.avatar} size={28} />}</span><span className="aw-team-chip__copy"><strong>{option.team.name}</strong><small>{option.unavailable || `${option.memberIds.length} 位成员`}</small></span>{teamId === option.team.id && <Check size={13} />}
      </button>)}</div>
      {!visibleTeams.length && <p className="aw-muted">{loading ? '正在读取小队…' : search ? '没有匹配的小队' : '还没有小队，也可以直接选择下方智能体。'}</p>}
    </section>
    <section className="aw-picker__section" aria-label="选择智能体">
      <div className="aw-picker__section-heading"><strong>{selectedTeam ? '小队成员与额外智能体' : '自由选择智能体'}</strong><span>{selectedTeam ? '小队成员已自动加入' : '单独聊天或一起协作'}</span></div>
      <div className="aw-picker__agents">{visible.map(agent => {
        const fromTeam = selectedTeam?.memberIds.includes(agent.id) ?? false;
        const picked = selectedIds.includes(agent.id);
        return <button type="button" className={`aw-agent-chip${picked ? ' is-selected' : ''}`} key={agent.id} aria-label={agent.name} aria-pressed={picked} title={fromTeam ? '随小队加入；本次创建保留完整小队' : undefined} disabled={busy || fromTeam} onClick={() => setIds(current => current.includes(agent.id) ? current.filter(id => id !== agent.id) : [...current, agent.id])}><AgentWorkspaceAvatar name={agent.name} avatar={agent.avatar} size={25} animate /><span>{agent.name}</span>{fromTeam ? <small>小队</small> : picked && <Check size={13} />}</button>;
      })}</div>
      {!visible.length && <p className="aw-muted">{loading ? '正在读取智能体…' : search ? '没有匹配的智能体' : '当前工作区还没有可用的智能体。'}</p>}
    </section>
    {selectedTeam && <p className="aw-picker__selection" role="status">已选「{selectedTeam.team.name}」 · 共 {selected.length} 位智能体；创建新群聊，不影响小队配置和已有会话。</p>}
    {selectionError && <p className="aw-error" role="alert">{selectionError}<button type="button" className="aw-text-button" disabled={busy} onClick={() => { setTeamId(''); setCoordinatorId(''); }}>取消小队选择</button></p>}
    <label className="aw-picker__title"><span><input type="checkbox" checked={group} disabled={Boolean(teamId) || selected.length > 1 || busy} onChange={e => setTaskRoom(e.target.checked)} />创建群聊</span></label>
    {group && <>
      <label className="aw-picker__title">会话名称<input maxLength={120} aria-label="群聊名称" placeholder={defaultTitle} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /></label>
      <label className="aw-picker__title">群聊协调员<select aria-label="群聊协调员" value={coordinator?.id ?? ''} disabled={busy || !selected.length} onChange={event => setCoordinatorId(event.target.value)}>{!selected.length && <option value="">请先选择小队或成员</option>}{selected.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><span>{coordinator ? `由 ${coordinator.name} 负责本群工作；先沟通，明确要求开始后协调成员。` : '选择成员后可指定本群协调员。'}</span></label>
    </>}
    {warning && <p className="aw-muted">{warning}</p>}{error && <p className="aw-error" role="alert">{error}</p>}
    <button className="aw-primary aw-picker__start" disabled={!selected.length || Boolean(selectionError) || busy || loading} onClick={() => void create()}>{busy ? '正在创建…' : selected.length ? `${selectedTeam ? '创建群聊' : '开始聊天'} · ${selected.length} 位智能体` : '选择小队或成员开始聊天'}</button>
    <div className="aw-picker__footer">{onCreateAgent && <button className="aw-text-button" disabled={busy} onClick={() => { onClose(); onCreateAgent(); }}>＋ 创建智能体</button>}<button className="aw-text-button" disabled={busy} onClick={() => { onClose(); onManage(); }}>管理智能体</button>{onManageTeams && <button className="aw-text-button" disabled={busy} onClick={() => { onClose(); onManageTeams(); }}>管理小队</button>}</div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
