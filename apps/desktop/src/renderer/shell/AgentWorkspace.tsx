import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Archive, ArrowLeft, Check, ChevronDown, MessageSquare, MoreHorizontal, PanelLeft, Pin, Plus, Search, Settings2, Store, Users, X } from 'lucide-react';
import type { CollaborationSnapshot, Conversation, GlobalAgent, Team } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import type { ModelOption } from './NewConversationDialog.js';
import { AgentEditorPanel } from './collaboration-agent-editor.js';
import { CollaborationChatView } from './CollaborationChatView.js';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { AvatarCluster, collaborationGroupTitle } from './collaboration-identity.js';
import { collaborationRequest } from './use-collaboration-chat.js';
import { isAgentActive } from './agent-contacts.js';
import { PROJECTLESS_SCOPE, runtimeWorkspaceId } from './projectless-scope.js';
import { useKeepAliveActive } from './KeepAliveLayer.js';
import './agent-workspace.css';
import { preservePromotedDraft } from './collaboration-draft.js';
import { AgentModelRepair } from './AgentModelRepair.js';
import { isAgentConversation, type AgentWorkspaceNavigation } from './conversation-surface.js';

const WorkspaceTeamLibrary = lazy(() => import('./TeamLibrary.js').then(module => ({ default: module.TeamLibrary })));
const NO_TEAMS: readonly Team[] = [];

export interface AgentWorkspaceProps {
  workspaceId: string;
  workspaces: readonly WorkspaceSummary[];
  conversations: readonly Conversation[];
  agents: readonly GlobalAgent[];
  teams?: readonly Team[];
  models?: readonly ModelOption[];
  loading?: boolean;
  navigation?: AgentWorkspaceNavigation;
  onNavigationHandled?(): void;
  conversationActivity?: ReadonlyMap<string, { running: boolean; unread: boolean }>;
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
  renderLegacyConversation?(conversation: Conversation, onEditAgent: (id: string) => void, agents: readonly GlobalAgent[]): ReactNode;
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

export default function AgentWorkspace(props: AgentWorkspaceProps) {
  const active = useKeepAliveActive();
  const teams = props.teams ?? NO_TEAMS;
  const [teamsOpen, setTeamsOpen] = useState(false);
  const teamCreateReceipts = useRef(new Map<string, string>());
  const [openingTeam, setOpeningTeam] = useState<string>();
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
  const editAgent = (id: string) => { setTeamsOpen(false); setProfile(id); setSidebarOpen(false); };
  const createAgent = () => { setPicker(false); setProfile('create'); setSidebarOpen(false); };

  const [selectedId, setSelectedId] = useState(() => readSelected(props.workspaceId));
  const [newConversation, setNewConversation] = useState<Conversation>();
  const [promoted, setPromoted] = useState<Record<string, Conversation>>({});
  const [upgradeError, setUpgradeError] = useState<{ id: string; busy: boolean; message: string }>();
  const [upgradeRevision, setUpgradeRevision] = useState(0);
  const refreshRef = useRef(props.onRefresh); refreshRef.current = props.onRefresh;
  const [rosters, setRosters] = useState<Record<string, CollaborationSnapshot['members']>>({});
  const [openError, setOpenError] = useState('');
  const navigationSequence = useRef(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [picker, setPicker] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [initialAgentId, setInitialAgentId] = useState<string>();
  const manage = () => props.renderAgentLibrary ? setLibraryOpen(true) : props.onManageAgents();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activations, setActivations] = useState<Record<string, boolean>>({});
  const [activationError, setActivationError] = useState('');
  const [activationReady, setActivationReady] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceId = props.workspaceId;
  useEffect(() => {
    if (!active) return;
    const search = () => setSearching(true);
    const create = () => setPicker(true);
    window.addEventListener('shell-open-conversation-search', search);
    window.addEventListener('shell-new-agent-chat', create);
    return () => { window.removeEventListener('shell-open-conversation-search', search); window.removeEventListener('shell-new-agent-chat', create); };
  }, [active]);
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
    const all = newConversation && !props.conversations.some(c => c.id === newConversation.id) ? [newConversation, ...props.conversations] : props.conversations;
    return agentWorkspaceConversations(all.map(c => c.collaborationKind && promoted[c.id] ? promoted[c.id] : c), workspaceId);
  }, [props.conversations, workspaceId, newConversation, promoted]);
  const selected = conversations.find(c => c.id === selectedId) ?? conversations.find(c => !c.archivedAt);
  const needsUpgrade = selected?.collaborationKind === 'direct' && Boolean(props.renderLegacyConversation);
  const upgradeId = needsUpgrade ? selected?.id : undefined;
  useEffect(() => {
    if (!active || !upgradeId) return;
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
  }, [active, upgradeId, upgradeRevision]);
  const searchTerm = query.trim().toLocaleLowerCase();
  const matching = conversations.filter(c => Boolean(c.archivedAt) === showArchived && `${c.title} ${c.lastMessagePreview ?? ''} ${agents.find(a => a.id === c.targetRef)?.name ?? ''}`.toLocaleLowerCase().includes(searchTerm));
  const groupedAgents = new Set(teams.flatMap(team => team.members.map(member => member.agentId as string)));
  const directAgentContacts = showArchived ? [] : available.flatMap(agent => {
    if (groupedAgents.has(agent.id)) return [];
    const history = conversations.filter(c => !c.archivedAt && c.collaborationKind !== 'group' && c.track !== 'team' && c.targetRef === agent.id);
    const agentText = `${agent.name} ${agent.description} ${history.map(c => `${c.title} ${c.lastMessagePreview ?? ''}`).join(' ')}`.toLocaleLowerCase();
    if (searchTerm && !agentText.includes(searchTerm)) return [];
    return [{ agent, history, conversation: history.find(c => c.id === selected?.id) ?? history[0] }];
  });
  const groupChats = showArchived ? [] : matching.filter(c => {
    const belongsToTeamSection = c.track === 'team' && teams.some(team => team.id === c.targetRef);
    return !belongsToTeamSection && c.collaborationKind === 'group';
  });
  const archivedChats = showArchived ? matching : [];
  const startAgentChat = (id: string) => { setInitialAgentId(id); setPicker(true); };
  const conversationLabel = (conversation: Conversation) => conversation.track === 'team' ? teams.find(team => team.id === conversation.targetRef)?.name ?? conversation.title : agentConversationName(conversation, agents);
  const selectedTeam = selected?.track === 'team' ? teams.find(team => team.id === selected.targetRef) : undefined;
  const selectedAgent = agents.find(agent => selected?.targetRef === agent.id);
  const open = (id: string) => {
    const sequence = ++navigationSequence.current;
    setTeamsOpen(false); setSelectedId(id); setSidebarOpen(false); setProfile(null); setOpenError('');
    if (!conversations.some(c => c.id === id)) void collaborationRequest({ action: 'get', conversationId: id }).then(result => {
      if (sequence !== navigationSequence.current || !result.snapshot) return;
      const c = result.snapshot.conversation;
      const coordinator = result.snapshot.members.find(m => m.id === c.coordinatorMemberId);
      setNewConversation({ id: c.id as Conversation['id'], workspaceId: workspaceId as Conversation['workspaceId'], title: c.title, track: 'agent', targetRef: coordinator?.agentId ?? '', collaborationKind: c.kind, executionMode: 'workspace', interactionMode: 'execute', createdAt: c.createdAt, updatedAt: c.createdAt });
      rememberSnapshot(result.snapshot);
      void Promise.resolve(props.onRefresh()).catch(() => undefined);
    }).catch(cause => { if (sequence === navigationSequence.current) setOpenError(cause instanceof Error ? cause.message : '打开关联会话失败'); });
    try { localStorage.setItem(selectionKey(workspaceId), id); } catch { /* session-only */ }
  };
  const rememberSnapshot = (snapshot: CollaborationSnapshot) => {
    setRosters(current => current[snapshot.conversation.id] === snapshot.members ? current : { ...current, [snapshot.conversation.id]: snapshot.members });
  };
  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching]);
  const startTeam = async (team: Team, fresh = false) => {
    if (openingTeam) return;
    const existing = conversations.find(c => c.track === 'team' && c.targetRef === team.id && !c.archivedAt);
    if (existing && !fresh) { setTeamsOpen(false); open(existing.id); return; }
    setOpeningTeam(team.id); setOpenError('');
    try {
      const key = workspaceId + ':' + team.id;
      const clientRequestId = teamCreateReceipts.current.get(key) ?? crypto.randomUUID();
      teamCreateReceipts.current.set(key, clientRequestId);
      const result = await collaborationRequest({ action: 'create', kind: 'group', clientRequestId, teamId: team.id, agentIds: [], workspaceId: runtimeWorkspaceId(workspaceId), title: team.name });
      if (!result.snapshot) throw new Error('团队群聊尚未就绪，请重试。');
      teamCreateReceipts.current.delete(key);
      const c = result.snapshot.conversation;
      const conversation = { id: c.id as Conversation['id'], workspaceId: runtimeWorkspaceId(workspaceId) as Conversation['workspaceId'], title: c.title, track: 'team', targetRef: team.id, collaborationKind: 'group', executionMode: 'ask', interactionMode: 'execute', createdAt: c.createdAt, updatedAt: c.createdAt } as Conversation;
      rememberSnapshot(result.snapshot);
      setNewConversation(conversation); setSelectedId(conversation.id); setTeamsOpen(false); setProfile(null); setSidebarOpen(false);
      try { localStorage.setItem(selectionKey(workspaceId), conversation.id); } catch { /* session only */ }
      void Promise.resolve(props.onRefresh()).catch(() => undefined);
    } catch (cause) { setOpenError(cause instanceof Error ? cause.message : '打开团队失败'); }
    finally { setOpeningTeam(undefined); }
  };
  // A command mailbox: use current handlers without rerunning a request after internal navigation.
  const navigationHandler = useRef<(request: AgentWorkspaceNavigation) => void>(() => {});
  navigationHandler.current = request => {
    setLibraryOpen(false); setTeamsOpen(false); setPicker(false); setProfile(null);
    setSearching(false); setQuery(''); setSidebarOpen(false);
    if (request.conversationId) {
      setShowArchived(Boolean(conversations.find(c => c.id === request.conversationId)?.archivedAt));
      open(request.conversationId);
    } else if (request.teamId !== undefined) {
      const team = teams.find(t => t.id === request.teamId);
      if (team) void startTeam(team, request.fresh);
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
  const teamSections = teams.flatMap(team => {
    const members = [...team.members].sort((a, b) => a.memberOrder - b.memberOrder).flatMap(member => {
      const agent = agents.find(a => a.id === member.agentId && !a.archived);
      return agent ? [{ ...member, agent }] : [];
    });
    const term = query.trim().toLocaleLowerCase();
    const matchGroup = (team.name + ' ' + team.mission).toLocaleLowerCase().includes(term);
    const visibleMembers = matchGroup ? members : members.filter(({ agent, title }) => (agent.name + ' ' + title).toLocaleLowerCase().includes(term));
    return matchGroup || visibleMembers.length ? [{ team, members, visibleMembers }] : [];
  });
  const renderConversationRow = (c: Conversation, directHistory: readonly Conversation[] = []) => {
    const agent = agents.find(a => a.id === c.targetRef);
    const roster = rosters[c.id]?.filter(m => m.active && m.kind !== 'user').map(m => ({ ...m, avatar: agents.find(a => a.id === m.agentId)?.avatar ?? m.avatar }));
    const label = conversationLabel(c);
    const direct = c.collaborationKind !== 'group' && c.track !== 'team';
    const history = direct ? directHistory : [];
    const activity = { running: (direct ? history : [c]).some(item => props.conversationActivity?.get(item.id)?.running), unread: (direct ? history : [c]).some(item => props.conversationActivity?.get(item.id)?.unread) };
    return <div key={c.id} className={`aw-conversation${selected?.id === c.id ? ' is-selected' : ''}`}>
      <button className="aw-conversation__select" aria-current={selected?.id === c.id ? 'page' : undefined} onClick={() => open(c.id)}>
        <span className="aw-conversation__avatar">{roster && roster.length > 1 ? <AvatarCluster members={roster} size={23} max={3} animate /> : <AgentWorkspaceAvatar name={label} avatar={agent?.avatar} size={34} animate state={activity.running ? 'working' : 'idle'} />}{c.collaborationKind === 'group' && !roster && <Users size={12} className="aw-group-badge" />}</span>
        <span className="aw-conversation__copy"><span className="aw-conversation__title">{label}</span><span className={activity.running ? 'aw-conversation__preview is-running' : 'aw-conversation__preview'}>{activity.running ? '正在协作…' : c.lastMessagePreview || (c.collaborationKind === 'group' ? '一起开始一场对话' : '开始聊聊你的想法')}</span></span>
        {activity.unread && <span className="aw-unread" aria-label="未读" />}{c.pinnedAt && <Pin size={12} className="aw-pinned" aria-label="已置顶" />}
      </button>
      <Menu.Root><Menu.Trigger asChild><button className="aw-row-menu" aria-label={`${label}的会话选项`}><MoreHorizontal size={16} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" side="right" align="start" sideOffset={8}>
        {direct && agent && <><Menu.Item onSelect={() => editAgent(agent.id)}>编辑智能体</Menu.Item><Menu.Item onSelect={() => startAgentChat(agent.id)}>新建对话</Menu.Item></>}
        {history.length > 1 && <Menu.Sub><Menu.SubTrigger>历史会话 · {history.length}</Menu.SubTrigger><Menu.Portal><Menu.SubContent className="aw-menu" sideOffset={8}>{history.map(item => <Menu.Item key={item.id} onSelect={() => open(item.id)}>{item.title || '未命名会话'}{item.id === selected?.id ? ' ✓' : ''}</Menu.Item>)}</Menu.SubContent></Menu.Portal></Menu.Sub>}
        <Menu.Item onSelect={() => props.onTogglePin(c.id, !c.pinnedAt)}>{c.pinnedAt ? '取消置顶' : '置顶会话'}</Menu.Item>
        <Menu.Item onSelect={() => props.onRename(c.id, c.title)}>重命名会话</Menu.Item>
        <Menu.Item onSelect={() => c.archivedAt ? props.onUnarchive(c.id) : props.onArchive(c.id)}>{c.archivedAt ? '移出归档' : '归档会话'}</Menu.Item>
      </Menu.Content></Menu.Portal></Menu.Root>
    </div>;
  };
  return <section className={`agent-chat-workspace${sidebarOpen ? ' is-sidebar-open' : ''}`} aria-label="智能体工作区" data-testid="agent-workspace">
    <button className="agent-chat-workspace__scrim" aria-label="关闭会话列表" onClick={() => setSidebarOpen(false)} tabIndex={sidebarOpen ? 0 : -1} />
    <aside className="agent-chat-workspace__sidebar" aria-label="智能体会话列表">
      <div className="agent-chat-workspace__tools">
        <button className="aw-tool" aria-label="搜索智能体会话" aria-pressed={searching} onClick={() => { setSearching(!searching); if (searching) setQuery(''); }}><Search size={18} /></button>
        <button className="aw-tool" aria-label="管理智能体" title="管理智能体" onClick={manage}><Store size={18} /></button>
        <button className="aw-tool aw-tool--primary" aria-label="新建智能体聊天" title="新建聊天" onClick={() => setPicker(true)}><Plus size={20} /></button>
      </div>
      {searching && <div className="aw-search"><Search size={15} /><input ref={searchRef} placeholder="搜索会话…" aria-label="搜索会话" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); setQuery(''); } }} /><button aria-label="清除搜索" onClick={() => { setQuery(''); setSearching(false); }}><X size={14} /></button></div>}
      <div className="agent-chat-workspace__conversations">
        {showArchived && <div className="aw-list-label">已归档</div>}
        {props.loading && <p className="aw-list-empty" role="status">正在读取会话…</p>}
        {!showArchived && <>
          <div className="aw-section-heading"><span>我的团队</span><button className="aw-icon" aria-label="管理团队" title="创建团队、调整成员" onClick={() => { setTeamsOpen(true); setProfile(null); setSidebarOpen(false); }}><Plus size={15} /></button></div>
          {teamSections.map(({ team, members, visibleMembers }) => {
            const history = conversations.filter(c => c.track === 'team' && c.targetRef === team.id && !c.archivedAt);
            const current = selected?.track === 'team' && selected.targetRef === team.id;
            const working = history.some(c => props.conversationActivity?.get(c.id)?.running);
            return <div className={'aw-conversation' + (current ? ' is-selected' : '')} key={team.id} data-testid="team-chat-contact">
              <button className="aw-conversation__select" aria-label={'与' + team.name + '聊天'} aria-current={current ? 'page' : undefined} disabled={members.length < 2 || Boolean(openingTeam)} onClick={() => void startTeam(team)}>
                <span className="aw-conversation__avatar"><AvatarCluster members={members.map(m => m.agent)} size={23} max={3} animate /></span>
                <span className="aw-conversation__copy"><span className="aw-conversation__title">{team.name}</span><span className={'aw-conversation__preview' + (working ? ' is-running' : '')}>{working ? '正在协作…' : history[0]?.lastMessagePreview || `${members.length} 位成员`}</span></span>
              </button>
              <Menu.Root><Menu.Trigger asChild><button className="aw-row-menu" aria-label={team.name + '的团队选项'}><MoreHorizontal size={16} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" side="right" align="start" sideOffset={8}>
                <Menu.Item onSelect={() => setTeamsOpen(true)}>管理团队与成员</Menu.Item>
                <Menu.Item disabled={members.length < 2} onSelect={() => void startTeam(team, true)}>新建团队群聊</Menu.Item>
                <Menu.Separator /><Menu.Label>成员 · {members.length}</Menu.Label>
                {visibleMembers.map(({ agent, title }) => <Menu.Item key={agent.id} onSelect={() => { const existing = conversations.find(c => c.track === 'agent' && c.collaborationKind !== 'group' && c.targetRef === agent.id && !c.archivedAt); if (existing) open(existing.id); else startAgentChat(agent.id); }}>{title || agent.name}</Menu.Item>)}
                {history.length > 0 && <><Menu.Separator /><Menu.Label>历史群聊</Menu.Label>{history.map(c => <Menu.Item key={c.id} onSelect={() => open(c.id)}>{c.title || team.name}{c.collaborationKind ? '' : ' · 旧版'}{c.id === selected?.id ? ' ✓' : ''}</Menu.Item>)}</>}
              </Menu.Content></Menu.Portal></Menu.Root>
            </div>;
          })}
          {!teams.length && <button className="aw-team-empty" onClick={() => setTeamsOpen(true)}>创建团队，把智能体组织在一起工作</button>}

          {directAgentContacts.length > 0 && <div className="aw-section-heading"><span>单个智能体</span></div>}
          {directAgentContacts.map(({ agent, conversation: directConversation, history }) => directConversation ? renderConversationRow(directConversation, history) : <div key={agent.id} className="aw-conversation">
            <button className="aw-conversation__select" onClick={() => startAgentChat(agent.id)}><span className="aw-conversation__avatar"><AgentWorkspaceAvatar name={agent.name} avatar={agent.avatar} size={34} animate /></span><span className="aw-conversation__copy"><span className="aw-conversation__title">{agent.name}</span><span className="aw-conversation__preview">{agent.description || '开始聊聊你的想法'}</span></span></button>
            <button className="aw-row-menu" aria-label={`编辑${agent.name}`} onClick={() => editAgent(agent.id)}><Settings2 size={15} /></button>
          </div>)}

          {groupChats.length > 0 && <div className="aw-section-heading"><span>群聊</span><button className="aw-icon" aria-label="新建群聊" title="选择多个智能体创建群聊" onClick={() => setPicker(true)}><Plus size={15} /></button></div>}
          {groupChats.map(c => renderConversationRow(c))}
        </>}
        {archivedChats.map(c => renderConversationRow(c))}
        {!props.loading && !teamSections.length && !directAgentContacts.length && !groupChats.length && !archivedChats.length && <p className="aw-list-empty">{query ? '没有匹配的会话' : showArchived ? '还没有归档会话' : '从上方 + 开始一场对话'}</p>}
      </div>
      <button className="aw-create-agent" onClick={createAgent}><Plus size={16} />创建智能体</button>
      <footer className="agent-chat-workspace__footer">
        <button className="aw-footer-link" onClick={props.onExit}><ArrowLeft size={17} />返回工作台</button>
        <div className="aw-footer-row"><button className="aw-footer-link" onClick={props.onSettings}><Settings2 size={17} />设置</button><button className={`aw-icon${showArchived ? ' is-active' : ''}`} aria-label={showArchived ? '显示活动会话' : '显示归档会话'} aria-pressed={showArchived} onClick={() => setShowArchived(v => !v)}><Archive size={16} /></button></div>
        <label className="aw-workspace-select"><span className="aw-workspace-mark"><MessageSquare size={19} /></span><span><span className="aw-workspace-caption">当前工作区</span><select aria-label="智能体工作区" value={workspaceId} onChange={e => props.onSelectWorkspace(e.target.value)}>{props.workspaces.map(w => <option key={w.workspaceId} value={w.workspaceId}>{w.name}</option>)}{!props.workspaces.some(w => w.workspaceId === workspaceId) && <option value={workspaceId}>不绑定工作区</option>}</select></span><ChevronDown size={14} /></label>
      </footer>
    </aside>
    <div className="agent-chat-workspace__content">
      {openError && <div className="aw-open-error" role="alert">{openError}<button onClick={() => selectedId && open(selectedId)}>重试</button></div>}
      {teamsOpen ? <div className="aw-team-library"><header><button className="aw-icon" aria-label="返回智能体聊天" onClick={() => setTeamsOpen(false)}><ArrowLeft size={18} /></button><strong>管理团队</strong><span>成员加入团队后，可以整队执行，也可以单独交流。</span></header><Suspense fallback={<p className="aw-list-empty">正在打开小队…</p>}><WorkspaceTeamLibrary teams={teams} agents={agents} onRefresh={() => { void props.onRefresh(); }} onStartConversation={id => { const team = teams.find(t => t.id === id); if (team) void startTeam(team); }} /></Suspense></div> : <>

      {selected && <AgentModelRepair key={selected.id} agents={selectedTeam ? agents.filter(a => selectedTeam.members.some(m => m.agentId === a.id)) : selectedAgent && selected.collaborationKind !== 'group' ? [selectedAgent] : agents.filter(a => rosters[selected.id]?.some(m => m.active && m.agentId === a.id))} models={props.models} onSaved={saveAgent} onSettings={props.onSettings} />}
      {needsUpgrade && (!upgradeError || upgradeError.id !== selected?.id || !upgradeError.busy) ? <main className="aw-welcome" aria-label="升级单聊"><p role={upgradeError ? 'alert' : 'status'}>{upgradeError?.id === selected?.id ? upgradeError.message : '正在保留历史记录并打开完整聊天…'}</p>{upgradeError?.id === selected?.id && <button className="collab-pill" onClick={() => setUpgradeRevision(v => v + 1)}>重试打开</button>}</main> : (selected?.collaborationKind || selected?.track === 'team') ? <>{needsUpgrade && <div className="collab-notice">{upgradeError?.message}<button className="collab-pill" onClick={() => setUpgradeRevision(v => v + 1)}>切换完整聊天</button></div>}<CollaborationChatView workspace key={selected.id} conversation={{ ...selected, title: conversationLabel(selected) }} agents={agents} models={props.models} onEditAgent={editAgent} active={active} onOpenConversation={open} onAgentsChanged={saveAgent} onSnapshot={rememberSnapshot} onOpenSidebar={() => setSidebarOpen(true)} onNewChat={() => setPicker(true)} projectFolder={props.workspaces.find(w => w.workspaceId === selected.workspaceId)?.folderPath} /></> : selected && props.renderLegacyConversation ? <div className="aw-legacy"><header><button className="aw-mobile-toggle aw-icon" aria-label="打开会话列表" onClick={() => setSidebarOpen(true)}><PanelLeft size={18} /></button><button className="aw-legacy__identity" aria-label={selectedAgent ? `编辑${selectedAgent.name}` : selectedTeam ? `管理${selectedTeam.name}` : '会话信息'} disabled={!selectedAgent && !selectedTeam} onClick={() => selectedAgent ? editAgent(selectedAgent.id) : setTeamsOpen(true)}><AgentWorkspaceAvatar name={conversationLabel(selected)} avatar={selectedAgent?.avatar ?? selectedTeam?.avatar} size={24} animate /><span>{conversationLabel(selected)}</span></button><Menu.Root><Menu.Trigger asChild><button className="aw-icon" aria-label="聊天设置"><MoreHorizontal size={18} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" sideOffset={8}>{selectedAgent && <Menu.Item onSelect={() => editAgent(selectedAgent.id)}>编辑智能体</Menu.Item>}<Menu.Item onSelect={() => { if (selectedTeam) void startTeam(selectedTeam, true); else { setInitialAgentId(selectedAgent?.id); setPicker(true); } }}>新建对话</Menu.Item><Menu.Item onSelect={manage}>管理智能体</Menu.Item></Menu.Content></Menu.Portal></Menu.Root></header><Suspense fallback={<p className="aw-list-empty">正在打开会话…</p>}>{props.renderLegacyConversation(selected, editAgent, agents)}</Suspense></div> : <main className="aw-welcome" aria-label="智能体聊天">
        <header><button className="aw-mobile-toggle aw-icon" aria-label="打开会话列表" onClick={() => setSidebarOpen(true)}><PanelLeft size={18} /></button><span>智能体</span><button className="aw-icon" aria-label="选择聊天成员" onClick={() => setPicker(true)}><Plus size={18} /></button></header>
        <div className="aw-welcome__body"><AvatarCluster members={available.slice(0, 3)} size={64} max={3} animate /><h1>{available.length ? '几个头脑，一场对话' : '让想法，多一种可能'}</h1><p>{available.length ? '和一位智能体深入交流，或把不同专长聚在一起。' : '添加你的第一位智能体，再一起开始。'}</p><button className="aw-primary" disabled={props.loading} onClick={available.length ? () => setPicker(true) : createAgent}>{available.length ? '开始聊天' : '添加智能体'}<Plus size={16} /></button></div>
        <div className="aw-welcome__hint">单聊、群聊与协作任务，都留在同一个地方。</div>
      </main>}
      </>}
    </div>
    {profile && (profile === 'create' || profileAgent) && <aside className="collab-panel aw-profile-panel" aria-label={profile === 'create' ? '创建智能体' : '智能体设置'}><header><strong>{profile === 'create' ? '创建智能体' : profileAgent?.name}</strong><button className="aw-icon" aria-label="关闭智能体编辑" onClick={() => setProfile(null)}><X size={16} /></button></header><AgentEditorPanel key={profile} workspace creating={profile === 'create'} agent={profileAgent} member={{ id: profile, agentId: profileAgent?.id, name: profileAgent?.name ?? '新智能体', avatar: profileAgent?.avatar ?? '', kind: 'agent', role: '成员', active: true }} models={props.models} onSaved={saveAgent} onCreated={agent => { saveAgent(agent); setProfile(agent.id); }} onAdvanced={manage} onModelSettings={props.onSettings} />{profileAgent && <button className="aw-text-button aw-profile-chat" onClick={() => startAgentChat(profileAgent.id)}>与 {profileAgent.name} 开始新对话</button>}</aside>}
    <AgentChatPicker onCreateAgent={createAgent} initialAgentId={initialAgentId} open={picker} onClose={() => { setPicker(false); setInitialAgentId(undefined); }} agents={available} loading={!activationReady || props.loading} warning={activationError} workspaceId={workspaceId} onManage={manage} onCreated={(snapshot, selectedAgents, direct) => {
      const c = snapshot.conversation;
      const now = c.createdAt;
      const next: Conversation = direct ?? { id: c.id as Conversation['id'], workspaceId: workspaceId as Conversation['workspaceId'], title: c.title, track: 'agent', targetRef: selectedAgents[0]?.id ?? '', collaborationKind: c.kind, executionMode: 'workspace', interactionMode: 'execute', createdAt: now, updatedAt: now };
      setNewConversation(next); rememberSnapshot(snapshot); setSelectedId(c.id); setSidebarOpen(false); setProfile(null);
      try { localStorage.setItem(selectionKey(workspaceId), c.id); } catch { /* session-only */ }
      setPicker(false); setInitialAgentId(undefined);
      void Promise.resolve(props.onRefresh()).catch(() => { /* the authoritative created snapshot remains usable */ });
    }} />
    {props.renderAgentLibrary && <Dialog.Root open={libraryOpen} onOpenChange={setLibraryOpen}><Dialog.Portal><Dialog.Overlay className="aw-dialog-overlay" /><Dialog.Content className="aw-library-modal"><Dialog.Title className="sr-only">管理智能体</Dialog.Title><Dialog.Description className="sr-only">管理真实智能体、模型与能力配置。</Dialog.Description><Dialog.Close className="aw-library-close" aria-label="关闭智能体管理"><X size={18} /></Dialog.Close><Suspense fallback={<p>正在打开智能体库…</p>}>{props.renderAgentLibrary(() => setLibraryOpen(false), id => { setLibraryOpen(false); setInitialAgentId(id); setPicker(true); }, profileAgent?.id)}</Suspense></Dialog.Content></Dialog.Portal></Dialog.Root>}
  </section>;
}

export function AgentChatPicker({ onCreateAgent, initialAgentId, open, onClose, agents, loading, warning, workspaceId, onManage, onCreated }: {
  onCreateAgent?(): void; initialAgentId?: string; open: boolean; onClose(): void; agents: readonly GlobalAgent[]; loading?: boolean; warning?: string; workspaceId: string; onManage(): void; onCreated(snapshot: CollaborationSnapshot, agents: readonly GlobalAgent[], direct?: Conversation): void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receipt = useRef<{ key: string; id: string }>();
  const submitting = useRef(false);
  useEffect(() => { if (open) { setIds(initialAgentId ? [initialAgentId] : []); setTitle(''); setQuery(''); setError(''); receipt.current = undefined; } }, [open, initialAgentId]);
  const selected = ids.flatMap(id => agents.find(a => a.id === id) ?? []);
  const visible = agents.filter(a => `${a.name} ${a.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const create = async () => {
    if (!selected.length || submitting.current || loading) return;
    const kind = selected.length === 1 ? 'direct' : 'group';
    const label = title.trim() || (kind === 'direct' ? selected[0].name : collaborationGroupTitle(selected.map(a => a.name)));
    const key = JSON.stringify([workspaceId, ids, label]);
    if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await collaborationRequest({ action: 'create', clientRequestId: receipt.current.id, kind, title: label, workspaceId: runtimeWorkspaceId(workspaceId), agentIds: selected.map(a => a.id), coordinatorAgentId: selected[0].id });
      if (!result.snapshot) throw new Error('服务尚未返回会话，请重试。');
      if (kind === 'direct') {
        const promoted = await collaborationRequest({ action: 'promote-direct', conversationId: result.snapshot.conversation.id });
        if (!promoted.promotedConversation) throw new Error('请重启应用加载统一聊天服务后重试。');
        onCreated(result.snapshot, selected, promoted.promotedConversation);
      } else onCreated(result.snapshot, selected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建会话失败，请重试。'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}><Dialog.Portal><Dialog.Overlay className="aw-dialog-overlay" /><Dialog.Content className="aw-picker" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
    <Dialog.Close className="aw-picker__close aw-icon" aria-label="关闭成员选择" disabled={busy}><X size={18} /></Dialog.Close>
    <div className="aw-picker__cluster"><AvatarCluster members={selected.length ? selected : agents.slice(0, 3)} size={64} max={5} animate /></div>
    <Dialog.Title>和你的智能体聊聊</Dialog.Title><Dialog.Description className="aw-picker__description">一个想法，也可以有不同的视角。选择一起参与的成员。</Dialog.Description>
    <label className="aw-picker__search"><Search size={16} /><input aria-label="搜索智能体" placeholder="搜索智能体…" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="aw-picker__agents">{visible.map(a => <button type="button" className={`aw-agent-chip${ids.includes(a.id) ? ' is-selected' : ''}`} key={a.id} aria-pressed={ids.includes(a.id)} disabled={busy} onClick={() => setIds(current => current.includes(a.id) ? current.filter(id => id !== a.id) : [...current, a.id])}><AgentWorkspaceAvatar name={a.name} avatar={a.avatar} size={25} animate /><span>{a.name}</span>{ids.includes(a.id) && <Check size={13} />}</button>)}</div>
    {!visible.length && <p className="aw-muted">{loading ? '正在读取智能体…' : query ? '没有匹配的智能体' : '当前工作区还没有可用的智能体。'}</p>}
    {selected.length > 1 && <label className="aw-picker__title">会话名称<input maxLength={120} aria-label="群聊名称" placeholder={collaborationGroupTitle(selected.map(a => a.name))} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} /><span>由 {selected[0].name} 协调，发送时也可以 @ 指定成员。</span></label>}
    {warning && <p className="aw-muted">{warning}</p>}{error && <p className="aw-error" role="alert">{error}</p>}
    <button className="aw-primary aw-picker__start" disabled={!selected.length || busy || loading} onClick={() => void create()}>{busy ? '正在创建…' : selected.length ? `开始聊天 · ${selected.length} 位智能体` : '选择成员开始聊天'}</button>
    <div className="aw-picker__footer">{onCreateAgent && <button className="aw-text-button" disabled={busy} onClick={() => { onClose(); onCreateAgent(); }}>＋ 创建智能体</button>}<button className="aw-text-button" disabled={busy} onClick={() => { onClose(); onManage(); }}>管理智能体</button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}