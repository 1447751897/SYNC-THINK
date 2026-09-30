import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  Bot,
  Check,
  ChevronRight,
  FolderPlus,
  History,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  Settings2,
  Workflow,
} from 'lucide-react';
import clsx from 'clsx';
import type { Conversation, GlobalAgent } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import { AgentAvatarView } from './AgentAvatarView.js';
import { useDialog } from './Dialog.js';
import {
  agentChatHistory,
  isAgentActive,
  readAgentContactGroups,
  writeAgentContactGroups,
  type AgentContactGroup,
} from './agent-contacts.js';
import {
  agentActivationWorkspaces,
  setAgentGloballyActive,
  setAgentWorkspaceActive,
} from './agent-workspace-activation.js';
import { PROJECTLESS_SCOPE } from './projectless-scope.js';

export interface AgentContactsSidebarProps {
  agents: readonly GlobalAgent[];
  workspaces: readonly WorkspaceSummary[];
  workspaceId: string;
  conversations: readonly Conversation[];
  selectedConversationId?: string;
  conversationActivity?: ReadonlyMap<string, { running: boolean; unread: boolean }>;
  loading?: boolean;
  onChat(agentId: string, workspaceId: string, newConversation?: boolean): void;
  onOpenConversation(id: string): void;
  onManage(): void;
  onRefresh(): Promise<unknown> | void;
}

export default function AgentContactsSidebar(props: AgentContactsSidebarProps) {
  const { agents, workspaces, workspaceId } = props;
  const dialog = useDialog();
  const activationWorkspaces = useMemo(() => agentActivationWorkspaces(workspaces), [workspaces]);
  const projectless = workspaceId === PROJECTLESS_SCOPE;
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState(() => readAgentContactGroups(workspaceId));
  const [activations, setActivations] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const savingRef = useRef(new Set<string>());
  const mounted = useRef(true);
  const request = useRef(0);
  const [scopeOverrides, setScopeOverrides] = useState<
    Record<string, { source: GlobalAgent; scope: 'global' | 'workspace' }>
  >({});
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, []);
  const reload = useCallback(async () => {
    const generation = ++request.current;
    if (activationWorkspaces.length === 0) {
      setActivations({});
      setLoaded(true);
      setError('');
      return;
    }
    const api = window.syncThink?.runtime;
    if (!api?.listGlobalAgentWorkspaceActivations) throw new Error('运行时未连接，请稍后重试');
    const results = await Promise.all(
      activationWorkspaces.map((workspace) =>
        api.listGlobalAgentWorkspaceActivations({ workspaceId: workspace.workspaceId }),
      ),
    ).catch((error: unknown) => {
      if (!mounted.current || generation !== request.current) return null;
      throw error;
    });
    if (!results) return;
    if (!mounted.current || generation !== request.current) return;
    const next: Record<string, boolean> = {};
    for (const result of results)
      for (const activation of result.activations)
        next[`${activation.agentId}:${activation.workspaceId}`] = activation.active;
    setActivations(next);
    setLoaded(true);
    setError('');
  }, [activationWorkspaces]);
  useEffect(() => {
    void reload().catch((e: unknown) => {
      if (mounted.current) setError(e instanceof Error ? e.message : '读取激活状态失败');
    });
  }, [reload, agents]);

  const persistGroups = (next: AgentContactGroup[]) => {
    setGroups(next);
    writeAgentContactGroups(workspaceId, next);
  };
  const editGroup = async (group?: AgentContactGroup) => {
    const name = await dialog.prompt({
      title: group ? '重命名智能体分组' : '新建智能体分组',
      defaultValue: group?.name,
      placeholder: '例如：产品维护组',
      validate: (v) => (v.trim() ? undefined : '请输入分组名称'),
    });
    if (!name?.trim() || !mounted.current) return;
    const label = name.trim().slice(0, 60);
    persistGroups(
      group
        ? groups.map((g) => (g.id === group.id ? { ...g, name: label } : g))
        : [...groups, { id: crypto.randomUUID(), name: label, agentIds: [] }],
    );
  };
  const moveToGroup = (agentId: string, groupId: string | null) =>
    persistGroups(
      groups.map((g) => ({
        ...g,
        agentIds: [
          ...g.agentIds.filter((id) => id !== agentId),
          ...(g.id === groupId ? [agentId] : []),
        ],
      })),
    );

  const changeActivation = async (
    agent: GlobalAgent,
    target: string | 'all',
    active: boolean,
    chatAfter = false,
  ) => {
    if (savingRef.current.has(agent.id)) return;
    savingRef.current.add(agent.id);
    setSaving(new Set(savingRef.current));
    setError('');
    try {
      const api = window.syncThink?.runtime;
      if (!api) throw new Error('运行时未连接');
      if (target === 'all') await setAgentGloballyActive(api, agent, workspaces, active);
      else await setAgentWorkspaceActive(api, agent, workspaces, target, active);
      if (mounted.current) {
        const source = agents.find((a) => a.id === agent.id) ?? agent;
        setScopeOverrides((previous) => ({
          ...previous,
          [agent.id]: { source, scope: target === 'all' && active ? 'global' : 'workspace' },
        }));
      }
      await reload();
      await props.onRefresh();
      // The component is keyed by workspace, so an in-flight activation never
      // opens a chat in the workspace the user switched to while it was saving.
      if (chatAfter && mounted.current) props.onChat(agent.id, workspaceId);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '保存激活状态失败');
      // Re-read server truth after partial writes instead of showing a false rollback.
      await reload().catch(() => {});
      await Promise.resolve(props.onRefresh()).catch(() => {});
      if (mounted.current) setError(e instanceof Error ? e.message : '保存激活状态失败');
    } finally {
      savingRef.current.delete(agent.id);
      if (mounted.current) setSaving(new Set(savingRef.current));
    }
  };

  const contacts = useMemo(
    () =>
      agents
        .filter((a) => !a.archived)
        .map((source) => {
          const override = scopeOverrides[source.id];
          const agent =
            override?.source === source ? { ...source, availabilityScope: override.scope } : source;
          const history = agentChatHistory(props.conversations, workspaceId, agent.id);
          const latest = history.find((c) => !c.id.startsWith('draft:'));
          return {
            agent,
            history,
            latest,
            active: isAgentActive(agent, workspaceId, activations),
            running: history.some((c) => props.conversationActivity?.get(c.id)?.running),
            unread: history.some((c) => props.conversationActivity?.get(c.id)?.unread),
            selected: history.some((c) => c.id === props.selectedConversationId),
          };
        })
        .filter(contact => contact.history.length > 0)
        .sort(
          (a, b) =>
            (b.latest?.lastMessageAt ?? b.latest?.createdAt ?? '').localeCompare(
              a.latest?.lastMessageAt ?? a.latest?.createdAt ?? '',
            ) || a.agent.name.localeCompare(b.agent.name, 'zh-CN'),
        ),
    [
      agents,
      scopeOverrides,
      activations,
      props.conversations,
      props.conversationActivity,
      props.selectedConversationId,
      workspaceId,
    ],
  );
  const needle = query.trim().toLocaleLowerCase();
  const filtered = contacts.filter(
    ({ agent, latest }) =>
      !needle ||
      `${agent.name} ${agent.description} ${latest?.lastMessagePreview ?? ''}`
        .toLocaleLowerCase()
        .includes(needle),
  );
  const assigned = new Set(groups.flatMap((g) => g.agentIds));
  const sections = [
    ...groups.map((group) => ({
      id: group.id,
      name: group.name,
      group,
      contacts: filtered.filter((c) => c.active && group.agentIds.includes(c.agent.id)),
    })),
    {
      id: 'ungrouped',
      name: '未分组',
      group: undefined,
      contacts: filtered.filter((c) => c.active && !assigned.has(c.agent.id)),
    },
    {
      id: 'inactive',
      name: projectless ? '仅在指定工作区可用' : '未在此工作区激活',
      group: undefined,
      contacts: filtered.filter((c) => !c.active),
    },
  ];
  const workspace = workspaces.find((w) => w.workspaceId === workspaceId);
  return (
    <section className="agent-contacts" aria-label="智能体聊天列表">
      <div className="agent-contacts__workspace">
        <Workflow size={13} />
        <span title={workspace?.name}>{workspace?.name ?? '当前工作区'}</span>
        <span className="agent-contacts__count">
          {contacts.filter((c) => c.active).length} 位已激活
        </span>
      </div>
      <label className="agent-contacts__search">
        <Search size={13} />
        <input
          type="search"
          aria-label="搜索智能体"
          placeholder="搜索智能体…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && (
        <div className="agent-contacts__error" role="alert">
          {error}
          <button
            type="button"
            onClick={() =>
              void reload().catch((e: unknown) =>
                setError(e instanceof Error ? e.message : '读取失败'),
              )
            }
          >
            重试
          </button>
        </div>
      )}
      <div className="agent-contacts__list">
        {props.loading && contacts.length === 0 ? (
          <p className="agent-contacts__empty" role="status">
            正在读取智能体…
          </p>
        ) : null}
        {!props.loading && filtered.length === 0 && (
          <div className="agent-contacts__empty">
            <Bot size={24} />
            <p>{needle ? '没有找到匹配的智能体' : '还没有智能体'}</p>
            <span>
              {needle ? '试试其他名字或消息关键词' : '添加智能体后，就可以在这里单独聊天'}
            </span>
          </div>
        )}
        {sections.map(
          (section) =>
            (section.contacts.length > 0 || (section.group && !needle)) && (
              <div key={section.id} className="agent-contacts__group">
                <div className="agent-contacts__group-heading">
                  <button
                    type="button"
                    disabled={!section.group}
                    aria-expanded={section.group ? !section.group.collapsed || !!needle : undefined}
                    onClick={() =>
                      section.group &&
                      persistGroups(
                        groups.map((g) =>
                          g.id === section.id ? { ...g, collapsed: !g.collapsed } : g,
                        ),
                      )
                    }
                  >
                    {section.group && (
                      <ChevronRight
                        size={11}
                        className={clsx((!section.group.collapsed || needle) && 'is-expanded')}
                      />
                    )}
                    {section.name}
                  </button>
                  {section.group && (
                    <Menu.Root modal={false}>
                      <Menu.Trigger asChild>
                        <button type="button" aria-label={`管理分组 ${section.name}`}>
                          <MoreHorizontal size={13} />
                        </button>
                      </Menu.Trigger>
                      <Menu.Portal>
                        <Menu.Content className="agent-contact-menu" align="end" sideOffset={4}>
                          <Menu.Item onSelect={() => void editGroup(section.group)}>
                            重命名分组
                          </Menu.Item>
                          <Menu.Item
                            onSelect={() =>
                              persistGroups(groups.filter((g) => g.id !== section.id))
                            }
                          >
                            解散分组（保留智能体）
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Portal>
                    </Menu.Root>
                  )}
                </div>
                {(!section.group?.collapsed || needle) && (
                  <>
                    {section.contacts.length === 0 && (
                      <p className="agent-contacts__group-empty">在智能体菜单中移入此分组</p>
                    )}
                    {section.contacts.map(
                      ({ agent, active, latest, history, running, unread, selected }) => {
                        const busy = saving.has(agent.id);
                        const ready =
                          !!workspaceId && !busy && agent.enabled !== false && (active || (!projectless && loaded));
                        const subtitle = busy
                          ? '正在更新工作区…'
                          : agent.enabled === false
                            ? '智能体已停用'
                            : !active
                              ? projectless
                                ? '可在菜单中设为全局可用后聊天'
                                : loaded
                                  ? '点击激活到此工作区并聊天'
                                  : '正在读取激活状态…'
                              : running
                                ? '正在处理任务…'
                                : latest?.lastMessagePreview ||
                                  (latest?.lastMessageAt ? '打开查看最近对话' : '开始一段新对话');
                        return (
                          <div
                            className={clsx(
                              'agent-contact',
                              selected && 'is-selected',
                              !active && 'is-inactive',
                            )}
                            key={agent.id}
                            data-testid={`agent-contact-${agent.id}`}
                          >
                            <button
                              type="button"
                              className="agent-contact__open"
                              disabled={!ready}
                              aria-label={`${active ? '与' : '激活并与'} ${agent.name} 聊天`}
                              aria-pressed={selected}
                              onClick={() =>
                                active
                                  ? props.onChat(agent.id, workspaceId)
                                  : void changeActivation(agent, workspaceId, true, true)
                              }
                            >
                              <span className="agent-contact__avatar">
                                <AgentAvatarView
                                  name={agent.name}
                                  avatar={agent.avatar}
                                  size={36}
                                  state={running ? 'working' : active ? 'idle' : 'inactive'}
                                  animate={running || (active && agent.enabled !== false)}
                                />
                                {unread && (
                                  <span className="agent-contact__unread" aria-label="有未读消息" />
                                )}
                              </span>
                              <span className="agent-contact__text">
                                <span className="agent-contact__name">
                                  <span>{agent.name}</span>
                                  {running && (
                                    <span className="agent-contact__running" aria-label="运行中" />
                                  )}
                                </span>
                                <span className="agent-contact__preview" title={subtitle}>
                                  {subtitle}
                                </span>
                              </span>
                            </button>
                            <ContactMenu
                              agent={agent}
                              history={history}
                              groups={groups}
                              workspaces={activationWorkspaces}
                              activations={activations}
                              saving={busy}
                              loaded={loaded}
                              active={active}
                              onNew={() => props.onChat(agent.id, workspaceId, true)}
                              onOpen={props.onOpenConversation}
                              onMove={(groupId) => moveToGroup(agent.id, groupId)}
                              onActivation={(id, enabled) =>
                                void changeActivation(agent, id, enabled)
                              }
                            />
                          </div>
                        );
                      },
                    )}
                  </>
                )}
              </div>
            ),
        )}
      </div>
      <div className="agent-contacts__footer">
        <button type="button" onClick={() => void editGroup()} disabled={!workspaceId}>
          <FolderPlus size={14} />
          新建分组
        </button>
        <button type="button" onClick={props.onManage}>
          <Settings2 size={14} />
          管理智能体
        </button>
      </div>
      <p className="agent-contacts__hint">同一智能体，多个工作区；对话各自独立</p>
    </section>
  );
}

function ContactMenu({
  agent,
  history,
  groups,
  workspaces,
  activations,
  saving,
  loaded,
  active,
  onNew,
  onOpen,
  onMove,
  onActivation,
}: {
  agent: GlobalAgent;
  history: Conversation[];
  groups: AgentContactGroup[];
  workspaces: readonly WorkspaceSummary[];
  activations: Readonly<Record<string, boolean>>;
  saving: boolean;
  loaded: boolean;
  active: boolean;
  onNew(): void;
  onOpen(id: string): void;
  onMove(id: string | null): void;
  onActivation(id: string, active: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const global = (agent.availabilityScope ?? 'global') === 'global';
  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="agent-contact__more"
          aria-label={`${agent.name} 的聊天与工作区设置`}
          onClick={() => {
            if (!open) setOpen(true);
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="agent-contact-menu"
          align="start"
          side="right"
          sideOffset={6}
          collisionPadding={12}
        >
          <Menu.Label>{agent.name}</Menu.Label>
          <Menu.Item disabled={!active || saving} onSelect={onNew}>
            <MessageSquarePlus size={14} />
            新建独立对话
          </Menu.Item>
          <Menu.Sub>
            <Menu.SubTrigger>
              <History size={14} />
              当前工作区历史
              <ChevronRight size={12} />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent
                className="agent-contact-menu agent-contact-menu--history"
                sideOffset={4}
              >
                {history.filter((c) => !c.id.startsWith('draft:')).length === 0 && (
                  <Menu.Item disabled>暂无历史对话</Menu.Item>
                )}
                {history
                  .filter((c) => !c.id.startsWith('draft:'))
                  .map((c) => (
                    <Menu.Item
                      key={c.id}
                      onSelect={() => onOpen(c.id)}
                      title={c.title || agent.name}
                    >
                      <span>{c.title || agent.name}</span>
                      <small>{(c.lastMessageAt ?? c.createdAt).slice(0, 10)}</small>
                    </Menu.Item>
                  ))}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Separator />
          <Menu.Sub>
            <Menu.SubTrigger>
              <Workflow size={14} />
              激活到工作区
              <ChevronRight size={12} />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className="agent-contact-menu" sideOffset={4}>
                <Menu.Label>可同时在多个工作区工作</Menu.Label>
                <Menu.CheckboxItem
                  checked={global}
                  disabled={saving || !loaded || workspaces.length === 0}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) => onActivation('all', v === true)}
                >
                  <Menu.ItemIndicator>
                    <Check size={12} />
                  </Menu.ItemIndicator>
                  全部工作区（含以后新建）
                </Menu.CheckboxItem>
                <Menu.Separator />
                {workspaces.map((w) => (
                  <Menu.CheckboxItem
                    key={w.workspaceId}
                    checked={global || activations[`${agent.id}:${w.workspaceId}`] === true}
                    disabled={saving || !loaded}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(v) => onActivation(w.workspaceId, v === true)}
                  >
                    <Menu.ItemIndicator>
                      <Check size={12} />
                    </Menu.ItemIndicator>
                    {w.name}
                  </Menu.CheckboxItem>
                ))}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
          <Menu.Sub>
            <Menu.SubTrigger>
              <FolderPlus size={14} />
              移动到分组
              <ChevronRight size={12} />
            </Menu.SubTrigger>
            <Menu.Portal>
              <Menu.SubContent className="agent-contact-menu" sideOffset={4}>
                <Menu.Item onSelect={() => onMove(null)}>未分组</Menu.Item>
                {groups.map((g) => (
                  <Menu.Item key={g.id} onSelect={() => onMove(g.id)}>
                    {g.name}
                  </Menu.Item>
                ))}
              </Menu.SubContent>
            </Menu.Portal>
          </Menu.Sub>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
