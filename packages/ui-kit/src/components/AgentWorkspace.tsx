import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AGENT_PERMISSION_DISABLED,
  isAgentPermissionCategoryEnabled,
  isLegacyAgentPermissions,
  type AgentPermissions,
} from '@sync-think/shared';
import {
  Bot,
  BookMarked,
  History,
  Layers3,
  ListTodo,
  Plus,
  Radar,
  Search,
  Save,
  Sparkles,
  Wrench,
  ImagePlus,
  ArrowRight,
  Crown,
  Users,
  Pencil,
  MessageSquarePlus,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AgentBindingPanel,
  type AgentBindingPanelProps,
  type AgentBindingView,
  projectAgentCapabilityReadiness,
} from './AgentBindingPanel.js';
import { formatModelPathLabel } from './ModelPathBoard.js';

export type AgentWorkspaceTab =
  'overview' | 'tasks' | 'instructions' | 'skills' | 'runtime' | 'versions' | 'more';

export type AgentMemoryScopeView = 'task' | 'project' | 'global';
export type AgentApprovalModeView = 'request' | 'delegate' | 'full' | 'custom';

export interface AgentCreateInput {
  name: string;
  role: string;
  description: string;
  developerInstructions: string;
  maxConcurrency: number;
}

export interface AgentDefinitionView {
  agentId: string;
  agentVersionId: string;
  version: number;
  name: string;
  description?: string;
  visualIdentity?: { icon: string; color: string; avatarPath?: string; avatarUrl?: string };
  role: string;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  maxConcurrency?: number;
  memoryScope: AgentMemoryScopeView;
  approvalMode: AgentApprovalModeView;
  mcpToolAllowlist?: string[];
  permissions?: AgentPermissions;
  reviewBehavior?: {
    role: 'none' | 'reviewer' | 'executor-reviewer';
    maxIterations: number;
    onLimitReached: 'pause' | 'abort' | 'reassign';
    backupAgentVersionId?: string;
  };
  artifactRules?: {
    retainVersions: boolean;
    requireReview: boolean;
    defaultStatus: 'candidate' | 'final';
  };
  defaultModelId?: string;
  defaultCredentialGroupId?: string;
  pinnedCredentialRefId?: string | null;
  pauseOnFailure?: boolean;
  fallbackModelIds?: string[];
  skillVersionIds?: string[];
  mcpServerIds?: string[];
  policyId?: string | null;
}

export interface AgentVersionHistoryView extends AgentDefinitionView {
  createdAt: string;
}

export interface AgentDefinitionSaveInput extends Omit<
  AgentDefinitionView,
  'agentVersionId' | 'version'
> {
  expectedVersion: number;
}

export interface AgentWorkspaceTaskSummary {
  taskId: string;
  title: string;
  status?: string;
}

export interface AgentWorkspaceGroupSummary {
  groupId: string;
  name: string;
  responsibility: string;
  isLead: boolean;
}

export interface AgentWorkspaceListItem {
  agentId: string;
  name: string;
  role: string;
  version: number;
  defaultModelId?: string;
  skillCount?: number;
  mcpCount?: number;
  taskCount?: number;
  statusLabel?: string;
  visualIdentity?: { icon: string; color: string; avatarPath?: string; avatarUrl?: string };
}

export interface AgentWorkspaceReviewerVersion {
  agentVersionId: string;
  agentId: string;
  agentName: string;
  version: number;
  reviewerCapable: boolean;
  title?: string;
}

export interface AgentWorkspaceProps extends AgentBindingPanelProps {
  /** List of agents. M1 may pass a single item from getAgent. */
  agents?: readonly AgentWorkspaceListItem[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onCreateAgent?: (input: AgentCreateInput) => Promise<string | null | void>;
  onStartTask?: (agentId: string) => void;
  onJoinGroup?: (agentId: string) => void;
  /** Optional related tasks for the selected agent. */
  relatedTasks?: readonly AgentWorkspaceTaskSummary[];
  /** Persisted groups that include any version of the selected agent. */
  groupMemberships?: readonly AgentWorkspaceGroupSummary[];
  onOpenTask?: (taskId: string) => void;
  /** Role/work blurb for overview when API has no description. */
  workSummary?: string;
  /** Optional read-only instructions text for instructions tab (M1 may be empty). */
  instructionsText?: string;
  definition?: AgentDefinitionView | null;
  versions?: readonly AgentVersionHistoryView[];
  allAgentVersions?: readonly AgentWorkspaceReviewerVersion[];
  onSaveDefinition?: (input: AgentDefinitionSaveInput) => void | Promise<void>;
  onPickAvatar?: () => Promise<{ avatarPath: string; avatarUrl: string } | null>;
  defaultTab?: AgentWorkspaceTab;
}

const TABS: { id: AgentWorkspaceTab; label: string; icon: typeof Bot }[] = [
  { id: 'overview', label: '资料', icon: Radar },
  { id: 'tasks', label: '任务', icon: ListTodo },
  { id: 'instructions', label: '能力与指令', icon: BookMarked },
  { id: 'runtime', label: '运行时', icon: Layers3 },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'versions', label: '历史', icon: History },
  { id: 'more', label: '更多', icon: Wrench },
];

const DEFINITION_FIELD_LABELS: Array<[keyof AgentDefinitionView, string]> = [
  ['name', '名称'],
  ['description', '描述'],
  ['visualIdentity', '视觉标识'],
  ['role', '角色'],
  ['developerInstructions', '指令'],
  ['inputContract', '输入契约'],
  ['outputContract', '输出契约'],
  ['maxConcurrency', '最大并发'],
  ['memoryScope', '记忆范围'],
  ['policyId', '策略'],
  ['reviewBehavior', '评审行为'],
  ['artifactRules', '产物规则'],
  ['permissions', '权限'],
  ['mcpToolAllowlist', 'MCP 工具'],
  ['defaultModelId', 'defaultModelId'],
  ['defaultCredentialGroupId', 'defaultCredentialGroupId'],
  ['pinnedCredentialRefId', 'pinnedCredentialRefId'],
  ['pauseOnFailure', 'pauseOnFailure'],
  ['fallbackModelIds', 'fallbackModelIds'],
  ['skillVersionIds', 'skillVersionIds'],
  ['mcpServerIds', 'mcpServerIds'],
];

const DEFINITION_FIELD_LABEL = new Map(DEFINITION_FIELD_LABELS);

function definitionChanges(
  current: AgentVersionHistoryView,
  previous?: AgentVersionHistoryView,
): string[] {
  if (!previous) return ['initial'];
  return DEFINITION_FIELD_LABELS.filter(
    ([field]) => JSON.stringify(current[field]) !== JSON.stringify(previous[field]),
  ).map(([field]) => field);
}

function emptyDefinitionPermissions(): NonNullable<AgentDefinitionView['permissions']> {
  return { file: [], command: [], browser: [], desktop: [], network: [] };
}

const AGENT_CAPABILITY_OPTIONS: ReadonlyArray<{
  id: keyof AgentPermissions;
  label: string;
  description: string;
}> = [
  { id: 'file', label: '文件', description: '读取和修改工作区文件' },
  { id: 'command', label: '命令', description: '执行终端命令' },
  { id: 'browser', label: '浏览器', description: '打开网页并使用已选浏览器身份' },
  { id: 'desktop', label: '桌面', description: '操作本机 Windows 应用' },
  { id: 'network', label: '网络', description: '访问外部网络资源' },
];

function materializeAgentPermissions(
  permissions: AgentDefinitionView['permissions'],
): AgentPermissions {
  const current = permissions ?? emptyDefinitionPermissions();
  if (isLegacyAgentPermissions(current)) {
    return { file: ['*'], command: ['*'], browser: ['*'], desktop: ['*'], network: ['*'] };
  }
  return {
    file: [...current.file],
    command: [...current.command],
    browser: [...current.browser],
    desktop: [...current.desktop],
    network: [...current.network],
  };
}

function toListItem(binding: AgentBindingView | null): AgentWorkspaceListItem | null {
  if (!binding) return null;
  return {
    agentId: binding.agentId,
    name: binding.name || '默认助手',
    role: binding.role || 'generalist',
    version: binding.version,
    defaultModelId: binding.defaultModelId,
    skillCount: binding.skillVersionIds?.length ?? 0,
    mcpCount: binding.mcpServerIds?.length ?? 0,
  };
}

function AgentCreateForm(props: {
  busy: boolean;
  error?: string | null;
  statusNote?: string | null;
  onCancel: () => void;
  onCreate: (input: AgentCreateInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AgentCreateInput>({
    name: '',
    role: 'specialist',
    description: '',
    developerInstructions: '',
    maxConcurrency: 3,
  });

  const canCreate =
    draft.name.trim().length > 0 &&
    draft.role.trim().length > 0 &&
    draft.developerInstructions.trim().length > 0;

  return (
    <form
      className="st-agent-ws__create"
      data-testid="agent-workspace-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate || props.busy) return;
        void props.onCreate({
          name: draft.name.trim(),
          role: draft.role.trim(),
          description: draft.description.trim(),
          developerInstructions: draft.developerInstructions.trim(),
          maxConcurrency: draft.maxConcurrency,
        });
      }}
    >
      <header>
        <div>
          <h3>新建智能体</h3>
          <p>定义它负责的工作，运行时可在创建后继续配置。</p>
        </div>
        <button type="button" aria-label="取消创建" title="取消创建" onClick={props.onCancel}>
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      {props.error ? (
        <p className="st-agent-ws__create-feedback" role="alert">
          {props.error}
        </p>
      ) : props.statusNote ? (
        <p className="st-agent-ws__create-feedback" role="status">
          {props.statusNote}
        </p>
      ) : null}
      <div className="st-agent-ws__create-grid">
        <label>
          <span>名称</span>
          <input
            aria-label="智能体名称"
            value={draft.name}
            autoFocus
            disabled={props.busy}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <label>
          <span>角色</span>
          <input
            aria-label="智能体角色"
            value={draft.role}
            disabled={props.busy}
            onChange={(event) => setDraft({ ...draft, role: event.target.value })}
          />
        </label>
        <label className="st-agent-ws__create-wide">
          <span>描述</span>
          <textarea
            aria-label="智能体描述"
            rows={3}
            value={draft.description}
            disabled={props.busy}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <label className="st-agent-ws__create-wide">
          <span>固定指令</span>
          <textarea
            aria-label="固定指令"
            rows={7}
            value={draft.developerInstructions}
            disabled={props.busy}
            onChange={(event) => setDraft({ ...draft, developerInstructions: event.target.value })}
          />
        </label>
        <label>
          <span>支持的任务并发数</span>
          <input
            type="number"
            min={1}
            max={16}
            aria-label="支持的任务并发数"
            value={draft.maxConcurrency}
            disabled={props.busy}
            onChange={(event) =>
              setDraft({
                ...draft,
                maxConcurrency: Math.max(1, Math.min(16, Number(event.target.value) || 1)),
              })
            }
          />
        </label>
      </div>
      <footer>
        <button type="button" onClick={props.onCancel} disabled={props.busy}>
          取消
        </button>
        <button type="submit" className="is-primary" disabled={!canCreate || props.busy}>
          <Plus size={13} aria-hidden="true" />
          创建智能体
        </button>
      </footer>
    </form>
  );
}

/**
 * 智能体中心：全部智能体列表 + 详情页签。
 * 运行时页签内嵌 分组 → 供应商 → 模型 三栏选板。
 */
export function AgentWorkspace(inputProps: AgentWorkspaceProps) {
  const props: AgentWorkspaceProps = {
    ...inputProps,
    busy: Boolean(inputProps.busy || inputProps.loading),
  };
  const derived = toListItem(props.binding);
  const agents = useMemo(() => {
    if (props.agents && props.agents.length > 0) return props.agents;
    return derived ? [derived] : [];
  }, [props.agents, derived]);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'busy' | 'offline'>('all');
  const [tab, setTab] = useState<AgentWorkspaceTab>(props.defaultTab ?? 'overview');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    props.selectedAgentId ?? agents[0]?.agentId ?? null,
  );
  const [definitionDraft, setDefinitionDraft] = useState<AgentDefinitionView | null>(
    props.definition ?? null,
  );

  useEffect(() => {
    if (props.defaultTab) setTab(props.defaultTab);
  }, [props.defaultTab]);

  useEffect(() => {
    setDefinitionDraft(props.definition ?? null);
  }, [props.definition?.agentVersionId]);

  useEffect(() => {
    if (props.selectedAgentId) {
      setSelectedId(props.selectedAgentId);
      return;
    }
    if (agents.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !agents.some((a) => a.agentId === selectedId)) {
      setSelectedId(agents[0]!.agentId);
    }
  }, [props.selectedAgentId, agents, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => {
      const matchesQuery =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.agentId.toLowerCase().includes(q);
      const status = a.statusLabel ?? '在线';
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'online' && status === '在线') ||
        (statusFilter === 'busy' && status === '忙碌中') ||
        (statusFilter === 'offline' && status === '离线');
      return matchesQuery && matchesStatus;
    });
  }, [agents, query, statusFilter]);

  const statusCounts = useMemo(
    () => ({
      all: agents.length,
      online: agents.filter((agent) => (agent.statusLabel ?? '在线') === '在线').length,
      busy: agents.filter((agent) => agent.statusLabel === '忙碌中').length,
      offline: agents.filter((agent) => agent.statusLabel === '离线').length,
    }),
    [agents],
  );

  const selected = agents.find((a) => a.agentId === selectedId) ?? agents[0] ?? null;
  const binding = props.binding;
  const runtimePath = formatModelPathLabel(
    props.models,
    binding?.defaultModelId ?? selected?.defaultModelId,
  );

  const capability = useMemo(
    () =>
      projectAgentCapabilityReadiness({
        hasBinding: Boolean(binding),
        defaultModelId: binding?.defaultModelId,
        fallbackModelIds: binding?.fallbackModelIds,
        credentialGroupId: binding?.defaultCredentialGroupId,
        pinnedCredentialRefId: binding?.pinnedCredentialRefId,
        skillVersionIds: binding?.skillVersionIds,
        mcpServerIds: binding?.mcpServerIds,
        skillLibraryCount: props.skills?.length ?? 0,
        mcpLibraryCount: props.mcpServers?.length ?? 0,
        credentialOptionCount: props.credentials?.length ?? 0,
      }),
    [binding, props.skills, props.mcpServers, props.credentials],
  );

  const relatedTasks = props.relatedTasks ?? [];
  const groupMemberships = props.groupMemberships ?? [];
  const versionHistory = useMemo(
    () => [...(props.versions ?? [])].sort((left, right) => right.version - left.version),
    [props.versions],
  );
  const ascendingVersions = useMemo(
    () => [...versionHistory].sort((left, right) => left.version - right.version),
    [versionHistory],
  );
  const saveDefinition = () => {
    if (!definitionDraft || !props.onSaveDefinition) return;
    const required = [
      definitionDraft.name,
      definitionDraft.role,
      definitionDraft.developerInstructions,
    ];
    if (required.some((value) => !value.trim())) return;
    const draftReviewBehavior = definitionDraft.reviewBehavior ?? {
      role: 'none' as const,
      maxIterations: 0,
      onLimitReached: 'pause' as const,
    };
    props.onSaveDefinition({
      agentId: definitionDraft.agentId,
      expectedVersion: definitionDraft.version,
      name: definitionDraft.name.trim(),
      description: (definitionDraft.description ?? '').trim(),
      visualIdentity: definitionDraft.visualIdentity ?? { icon: 'bot', color: '#64748b' },
      role: definitionDraft.role.trim(),
      developerInstructions: definitionDraft.developerInstructions.trim(),
      inputContract: definitionDraft.inputContract,
      outputContract: definitionDraft.outputContract,
      maxConcurrency: definitionDraft.maxConcurrency ?? 3,
      memoryScope: 'task',
      approvalMode: 'full',
      mcpToolAllowlist: [...(definitionDraft.mcpToolAllowlist ?? [])],
      permissions: definitionDraft.permissions ?? emptyDefinitionPermissions(),
      reviewBehavior: draftReviewBehavior,
      artifactRules: definitionDraft.artifactRules ?? {
        retainVersions: true,
        requireReview: false,
        defaultStatus: 'candidate',
      },
      policyId: definitionDraft.policyId?.trim() || null,
    });
  };

  const selectAgent = (agentId: string) => {
    setSelectedId(agentId);
    setTab('overview');
    props.onSelectAgent?.(agentId);
  };

  return (
    <section className="st-agent-ws" data-testid="agent-workspace" aria-label="智能体中心">
      <aside className="st-agent-ws__list" data-testid="agent-workspace-list">
        <header className="st-agent-ws__list-head">
          <div>
            <h2>好友</h2>
            <p>{agents.length} 个智能体</p>
          </div>
          <button
            type="button"
            className="st-agent-ws__new"
            data-testid="agent-workspace-new"
            onClick={() => setCreating(true)}
            disabled={!props.onCreateAgent}
            title="新建智能体"
          >
            <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            新建
          </button>
        </header>

        <div className="st-agent-ws__filters" role="tablist" aria-label="按状态筛选">
          {(
            [
              ['all', '全部'],
              ['online', '在线'],
              ['busy', '忙碌'],
              ['offline', '离线'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              data-active={statusFilter === value ? '1' : '0'}
              aria-selected={statusFilter === value}
              onClick={() => setStatusFilter(value)}
            >
              <span>{label}</span>
              <em>{statusCounts[value]}</em>
            </button>
          ))}
        </div>
        <div className="st-agent-ws__search">
          <Search size={13} strokeWidth={1.8} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索智能体"
            aria-label="搜索智能体"
            data-testid="agent-workspace-search"
          />
        </div>

        <div className="st-agent-ws__cards" data-testid="agent-workspace-cards">
          {props.loading && agents.length === 0 ? (
            <p className="st-agent-ws__empty">读取智能体…</p>
          ) : null}
          {!props.loading && filtered.length === 0 ? (
            <p className="st-agent-ws__empty" data-testid="agent-workspace-empty">
              {query.trim() ? '无匹配智能体' : '连接 Runtime 后显示智能体'}
            </p>
          ) : null}
          {filtered.map((a) => {
            const active = a.agentId === selected?.agentId;
            const path = formatModelPathLabel(props.models, a.defaultModelId);
            return (
              <button
                key={a.agentId}
                type="button"
                className="st-agent-ws__card"
                data-testid={`agent-workspace-card-${a.agentId}`}
                data-active={active ? '1' : '0'}
                data-status={a.statusLabel ?? '在线'}
                onClick={() => selectAgent(a.agentId)}
              >
                <span
                  className="st-agent-ws__avatar"
                  style={
                    { '--st-agent-color': a.visualIdentity?.color ?? '#64748b' } as CSSProperties
                  }
                  aria-hidden="true"
                >
                  {a.visualIdentity?.avatarUrl ? (
                    <img src={a.visualIdentity.avatarUrl} alt="" />
                  ) : (
                    <Bot size={15} strokeWidth={1.8} />
                  )}
                  <i data-status={a.statusLabel ?? '在线'} />
                </span>
                <div className="st-agent-ws__card-content">
                  <div className="st-agent-ws__card-name">
                    <span>{a.name}</span>
                    <span className="st-agent-ws__status">{a.statusLabel ?? '在线'}</span>
                  </div>
                  <div className="st-agent-ws__card-role">{a.role}</div>
                  <div className="st-agent-ws__card-runtime" title={path}>
                    {path}
                  </div>
                  <div className="st-agent-ws__card-meta">
                    {typeof a.taskCount === 'number' && a.taskCount > 0 ? (
                      <span className="st-agent-ws__pill">{a.taskCount} 个任务</span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="st-agent-ws__detail" data-testid="agent-workspace-detail">
        {creating ? (
          <AgentCreateForm
            busy={Boolean(props.busy)}
            error={props.error}
            statusNote={props.statusNote}
            onCancel={() => setCreating(false)}
            onCreate={async (input) => {
              const agentId = await props.onCreateAgent?.(input);
              if (typeof agentId !== 'string' || !agentId) return;
              setCreating(false);
              setSelectedId(agentId);
              setTab('overview');
            }}
          />
        ) : !selected ? (
          <div className="st-agent-ws__detail-empty">
            <Bot size={28} strokeWidth={1.5} aria-hidden="true" />
            <p>从左侧选择一个智能体</p>
          </div>
        ) : (
          <>
            <header className="st-agent-ws__detail-head">
              <span
                className="st-agent-ws__avatar st-agent-ws__avatar--large"
                style={
                  {
                    '--st-agent-color': selected.visualIdentity?.color ?? '#64748b',
                  } as CSSProperties
                }
                aria-hidden="true"
              >
                {selected.visualIdentity?.avatarUrl ? (
                  <img src={selected.visualIdentity.avatarUrl} alt="" />
                ) : (
                  <Bot size={25} strokeWidth={1.7} />
                )}
                <i data-status={selected.statusLabel ?? '在线'} />
              </span>
              <div className="st-agent-ws__detail-titles">
                <h3 data-testid="agent-workspace-detail-name">{selected.name}</h3>
                <p>
                  {selected.role}
                  {' · '}
                  {selected.statusLabel ?? '在线'}
                </p>
              </div>
              <div className="st-agent-ws__badges">
                <span
                  className="st-agent-ws__badge st-agent-ws__badge--status"
                  data-status={selected.statusLabel ?? '在线'}
                >
                  <i aria-hidden="true" />
                  {selected.statusLabel ?? '在线'}
                </span>
                {selected.taskCount && selected.taskCount > 0 ? (
                  <span className="st-agent-ws__badge">{selected.taskCount} 个任务</span>
                ) : null}
              </div>
              <div className="st-agent-ws__profile-actions">
                <button
                  type="button"
                  aria-label="编辑智能体"
                  title="编辑智能体"
                  onClick={() => setTab('instructions')}
                >
                  <Pencil size={13} aria-hidden="true" />
                  编辑
                </button>
                <button
                  type="button"
                  aria-label="开始任务"
                  title="开始任务"
                  disabled={!props.onStartTask}
                  onClick={() => props.onStartTask?.(selected.agentId)}
                >
                  <MessageSquarePlus size={13} aria-hidden="true" />
                  开始任务
                </button>
                <button
                  type="button"
                  aria-label="加入群聊"
                  title="加入群聊"
                  disabled={!props.onJoinGroup}
                  onClick={() => props.onJoinGroup?.(selected.agentId)}
                >
                  <UserPlus size={13} aria-hidden="true" />
                  加入群聊
                </button>
              </div>
            </header>

            <nav className="st-agent-ws__tabs" role="tablist" aria-label="智能体详情页签">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    className="st-agent-ws__tab"
                    data-testid={`agent-workspace-tab-${t.id}`}
                    data-active={active ? '1' : '0'}
                    aria-selected={active}
                    onClick={() => setTab(t.id)}
                  >
                    <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
                    {t.label}
                  </button>
                );
              })}
            </nav>

            <div className="st-agent-ws__panels" data-testid="agent-workspace-panels">
              {tab === 'overview' ? (
                <div className="st-agent-ws__panel" data-testid="agent-workspace-panel-overview">
                  <div className="st-agent-ws__stat-grid">
                    <div className="st-agent-ws__stat">
                      <span>运行时</span>
                      <strong title={runtimePath}>{runtimePath}</strong>
                    </div>
                    <div className="st-agent-ws__stat">
                      <span>能力</span>
                      <strong>
                        Skill {capability.skillBound}/{capability.skillLib}
                        {' · '}
                        MCP {capability.mcpBound}/{capability.mcpLib}
                      </strong>
                    </div>
                    <div className="st-agent-ws__stat">
                      <span>Fallback</span>
                      <strong>{capability.fallbackCount} 条</strong>
                    </div>
                    <div className="st-agent-ws__stat">
                      <span>最大并发</span>
                      <strong>{definitionDraft?.maxConcurrency ?? 3} 个任务</strong>
                    </div>
                    <div className="st-agent-ws__stat">
                      <span>凭证</span>
                      <strong>{capability.credOk ? '已配置' : '未绑'}</strong>
                    </div>
                  </div>
                  <p className="st-agent-ws__work" data-testid="agent-workspace-work">
                    {props.workSummary?.trim() ||
                      definitionDraft?.description?.trim() ||
                      selected.role}
                  </p>
                  {relatedTasks.length > 0 ? (
                    <div className="st-agent-ws__task-preview">
                      <h4>最近任务</h4>
                      <ul>
                        {relatedTasks.slice(0, 4).map((t) => (
                          <li key={t.taskId}>
                            <div className="st-agent-ws__task-copy">
                              <strong>{t.title}</strong>
                              <small>{t.status ?? '—'}</small>
                            </div>
                            {props.onOpenTask ? (
                              <button
                                type="button"
                                className="st-agent-ws__row-action"
                                aria-label={`打开任务 ${t.title}`}
                                title="打开任务"
                                onClick={() => props.onOpenTask?.(t.taskId)}
                              >
                                <ArrowRight size={13} aria-hidden="true" />
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="st-agent-ws__hint">
                      还没有由这个智能体参与的任务。开始执行后会自动出现在这里。
                    </p>
                  )}
                  <div className="st-agent-ws__memberships">
                    <h4>所在群聊</h4>
                    {groupMemberships.length === 0 ? (
                      <p className="st-agent-ws__hint">尚未加入群聊。</p>
                    ) : (
                      <ul>
                        {groupMemberships.map((membership) => (
                          <li key={membership.groupId}>
                            <span className="st-agent-ws__membership-icon" aria-hidden="true">
                              {membership.isLead ? <Crown size={13} /> : <Users size={13} />}
                            </span>
                            <div>
                              <strong>{membership.name}</strong>
                              <small>{membership.responsibility}</small>
                            </div>
                            {membership.isLead ? (
                              <span className="st-agent-ws__pill">主智能体</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="st-agent-ws__quick">
                    <button
                      type="button"
                      className="st-agent-ws__quick-btn"
                      onClick={() => setTab('runtime')}
                    >
                      配置运行时
                    </button>
                    <button
                      type="button"
                      className="st-agent-ws__quick-btn st-agent-ws__quick-btn--ghost"
                      onClick={() => setTab('skills')}
                    >
                      管理 Skills
                    </button>
                  </div>
                </div>
              ) : null}

              {tab === 'tasks' ? (
                <div className="st-agent-ws__panel" data-testid="agent-workspace-panel-tasks">
                  {relatedTasks.length === 0 ? (
                    <p className="st-agent-ws__empty">
                      还没有由这个智能体参与的任务。智能体开始执行后会自动出现在这里。
                    </p>
                  ) : (
                    <ul className="st-agent-ws__task-list">
                      {relatedTasks.map((t) => (
                        <li key={t.taskId}>
                          <div className="st-agent-ws__task-copy">
                            <strong>{t.title}</strong>
                            <small>{t.taskId}</small>
                          </div>
                          <span className="st-agent-ws__task-actions">
                            <span className="st-agent-ws__pill">{t.status ?? '—'}</span>
                            {props.onOpenTask ? (
                              <button
                                type="button"
                                className="st-agent-ws__row-action"
                                aria-label={`打开任务 ${t.title}`}
                                title="打开任务"
                                onClick={() => props.onOpenTask?.(t.taskId)}
                              >
                                <ArrowRight size={13} aria-hidden="true" />
                              </button>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {tab === 'instructions' ? (
                <div
                  className="st-agent-ws__panel"
                  data-testid="agent-workspace-panel-instructions"
                >
                  {definitionDraft ? (
                    <div className="st-agent-ws__definition" data-testid="agent-definition-editor">
                      <div className="st-agent-ws__definition-sections">
                        <section className="st-agent-ws__definition-section">
                          <header>
                            <h4>身份</h4>
                          </header>
                          <div className="st-agent-ws__definition-grid">
                            <label>
                              <span>名称</span>
                              <input
                                aria-label="智能体名称"
                                value={definitionDraft.name}
                                disabled={props.busy}
                                onChange={(event) =>
                                  setDefinitionDraft({
                                    ...definitionDraft,
                                    name: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              <span>角色</span>
                              <input
                                aria-label="智能体角色"
                                value={definitionDraft.role}
                                disabled={props.busy}
                                onChange={(event) =>
                                  setDefinitionDraft({
                                    ...definitionDraft,
                                    role: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <div className="st-agent-ws__avatar-editor">
                              <span>头像</span>
                              <span
                                className="st-agent-ws__avatar st-agent-ws__avatar--preview"
                                data-testid="agent-definition-avatar-preview"
                                style={
                                  {
                                    '--st-agent-color':
                                      definitionDraft.visualIdentity?.color ?? '#64748b',
                                  } as CSSProperties
                                }
                              >
                                {definitionDraft.visualIdentity?.avatarUrl ? (
                                  <img
                                    src={definitionDraft.visualIdentity.avatarUrl}
                                    alt="头像预览"
                                  />
                                ) : (
                                  <Bot size={18} strokeWidth={1.8} aria-hidden="true" />
                                )}
                              </span>
                              <button
                                type="button"
                                data-testid="agent-definition-avatar-pick"
                                disabled={props.busy || !props.onPickAvatar}
                                onClick={() => {
                                  void props.onPickAvatar?.().then((picked) => {
                                    if (!picked) return;
                                    setDefinitionDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            visualIdentity: {
                                              ...(current.visualIdentity ?? {
                                                icon: 'bot',
                                                color: '#64748b',
                                              }),
                                              avatarPath: picked.avatarPath,
                                              avatarUrl: picked.avatarUrl,
                                            },
                                          }
                                        : current,
                                    );
                                  });
                                }}
                              >
                                <ImagePlus size={13} strokeWidth={1.8} aria-hidden="true" />
                                选择图片
                              </button>
                            </div>
                            <label>
                              <span>强调色</span>
                              <input
                                type="color"
                                data-testid="agent-definition-color"
                                value={
                                  /^#[0-9a-f]{6}$/i.test(
                                    definitionDraft.visualIdentity?.color ?? '',
                                  )
                                    ? definitionDraft.visualIdentity!.color
                                    : '#64748b'
                                }
                                disabled={props.busy}
                                onChange={(event) =>
                                  setDefinitionDraft({
                                    ...definitionDraft,
                                    visualIdentity: {
                                      ...(definitionDraft.visualIdentity ?? {
                                        icon: 'bot',
                                        color: '#64748b',
                                      }),
                                      color: event.target.value,
                                    },
                                  })
                                }
                              />
                            </label>
                          </div>
                        </section>

                        <section className="st-agent-ws__definition-section">
                          <header>
                            <h4>工作能力</h4>
                          </header>
                          <label className="st-agent-ws__definition-field">
                            <span>能力描述</span>
                            <textarea
                              data-testid="agent-definition-description"
                              rows={4}
                              maxLength={4000}
                              value={definitionDraft.description ?? ''}
                              disabled={props.busy}
                              onChange={(event) =>
                                setDefinitionDraft({
                                  ...definitionDraft,
                                  description: event.target.value,
                                })
                              }
                            />
                          </label>
                        </section>

                        <section className="st-agent-ws__definition-section">
                          <header>
                            <h4>工作指令</h4>
                          </header>
                          <label className="st-agent-ws__definition-field">
                            <span>固定 Prompt</span>
                            <textarea
                              aria-label="工作指令"
                              rows={8}
                              value={definitionDraft.developerInstructions}
                              disabled={props.busy}
                              onChange={(event) =>
                                setDefinitionDraft({
                                  ...definitionDraft,
                                  developerInstructions: event.target.value,
                                })
                              }
                            />
                          </label>
                        </section>

                        <section className="st-agent-ws__definition-section">
                          <header>
                            <h4>能力上限</h4>
                          </header>
                          <div className="st-agent-ws__capability-ceiling">
                            <p>任务可以临时收紧这些能力，但不能超过此处的范围。</p>
                            <div>
                              {AGENT_CAPABILITY_OPTIONS.map((capabilityOption) => {
                                const permissions =
                                  definitionDraft.permissions ?? emptyDefinitionPermissions();
                                const enabled = isAgentPermissionCategoryEnabled(
                                  permissions[capabilityOption.id],
                                  isLegacyAgentPermissions(permissions),
                                );
                                return (
                                  <label key={capabilityOption.id}>
                                    <input
                                      type="checkbox"
                                      aria-label={`允许${capabilityOption.label}能力`}
                                      checked={enabled}
                                      disabled={props.busy}
                                      onChange={(event) => {
                                        const nextPermissions = materializeAgentPermissions(
                                          definitionDraft.permissions,
                                        );
                                        nextPermissions[capabilityOption.id] = event.target.checked
                                          ? ['*']
                                          : [AGENT_PERMISSION_DISABLED];
                                        setDefinitionDraft({
                                          ...definitionDraft,
                                          permissions: nextPermissions,
                                        });
                                      }}
                                    />
                                    <span>
                                      <strong>{capabilityOption.label}</strong>
                                      <small>{capabilityOption.description}</small>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </section>

                        <section className="st-agent-ws__definition-section">
                          <header>
                            <h4>执行设置</h4>
                          </header>
                          <div className="st-agent-ws__definition-grid">
                            <label>
                              <span>支持的任务并发数</span>
                              <input
                                type="number"
                                min={1}
                                max={16}
                                step={1}
                                aria-label="最大并发任务数"
                                data-testid="agent-definition-max-concurrency"
                                value={definitionDraft.maxConcurrency ?? 3}
                                disabled={props.busy}
                                onChange={(event) =>
                                  setDefinitionDraft({
                                    ...definitionDraft,
                                    maxConcurrency: Math.max(
                                      1,
                                      Math.min(16, Number(event.target.value) || 1),
                                    ),
                                  })
                                }
                              />
                            </label>
                          </div>
                        </section>
                      </div>
                      <div className="st-agent-ws__definition-save">
                        <span>修改会保存并用于后续任务</span>
                        <button
                          type="button"
                          data-testid="agent-definition-save"
                          onClick={saveDefinition}
                          disabled={props.busy || !props.onSaveDefinition}
                        >
                          <Save size={13} strokeWidth={1.9} aria-hidden="true" />
                          保存修改
                        </button>
                      </div>
                    </div>
                  ) : props.instructionsText?.trim() ? (
                    <pre className="st-agent-ws__instructions">{props.instructionsText}</pre>
                  ) : (
                    <div className="st-agent-ws__placeholder">
                      <p>
                        指令 / 人设编辑将在 Agent 版本字段开放后可写。当前智能体：
                        <strong> {selected.name}</strong>（{selected.role}）。
                      </p>
                      <p className="st-agent-ws__hint">
                        运行时、Skills、MCP 白名单仍可在其它页签配置并保存绑定。
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {tab === 'versions' ? (
                <div className="st-agent-ws__panel" data-testid="agent-workspace-panel-versions">
                  {versionHistory.length === 0 ? (
                    <p className="st-agent-ws__empty">尚无版本历史。</p>
                  ) : (
                    <ol className="st-agent-ws__versions" aria-label="智能体版本历史">
                      {versionHistory.map((version) => {
                        const previous = ascendingVersions.find(
                          (candidate) => candidate.version === version.version - 1,
                        );
                        const changes = definitionChanges(version, previous);
                        return (
                          <li
                            key={version.agentVersionId}
                            data-testid={`agent-version-${version.agentVersionId}`}
                            data-changes={changes.join(',')}
                            data-current={
                              version.agentVersionId === props.definition?.agentVersionId
                                ? '1'
                                : '0'
                            }
                          >
                            <div className="st-agent-ws__version-head">
                              <strong>v{version.version}</strong>
                              <code>{version.agentVersionId}</code>
                              <time dateTime={version.createdAt}>
                                {version.createdAt.slice(0, 16)}
                              </time>
                            </div>
                            <p>
                              {changes
                                .map((field) =>
                                  field === 'initial'
                                    ? '初始版本'
                                    : (DEFINITION_FIELD_LABEL.get(
                                        field as keyof AgentDefinitionView,
                                      ) ?? field),
                                )
                                .join(' · ')}
                            </p>
                            <dl>
                              <div>
                                <dt>角色</dt>
                                <dd>{version.role}</dd>
                              </div>
                              <div>
                                <dt>并发</dt>
                                <dd>{version.maxConcurrency ?? 3}</dd>
                              </div>
                              <div>
                                <dt>记忆</dt>
                                <dd>{version.memoryScope}</dd>
                              </div>
                              <div>
                                <dt>策略</dt>
                                <dd>{version.policyId ?? '无'}</dd>
                              </div>
                              <div>
                                <dt>Model</dt>
                                <dd>{version.defaultModelId ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Credential group</dt>
                                <dd>{version.defaultCredentialGroupId ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Credential pin</dt>
                                <dd>{version.pinnedCredentialRefId ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Failure</dt>
                                <dd>{version.pauseOnFailure ? 'pause' : 'continue'}</dd>
                              </div>
                              <div>
                                <dt>Fallback</dt>
                                <dd>{version.fallbackModelIds?.join(', ') || '—'}</dd>
                              </div>
                              <div>
                                <dt>Skills</dt>
                                <dd>{version.skillVersionIds?.join(', ') || '—'}</dd>
                              </div>
                              <div>
                                <dt>MCP servers</dt>
                                <dd>{version.mcpServerIds?.join(', ') || '—'}</dd>
                              </div>
                              <div>
                                <dt>MCP tools</dt>
                                <dd>{version.mcpToolAllowlist?.join(', ') || '—'}</dd>
                              </div>
                            </dl>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              ) : null}

              {tab === 'skills' || tab === 'runtime' || tab === 'more' ? (
                <div
                  className="st-agent-ws__panel st-agent-ws__panel--binding"
                  data-testid={`agent-workspace-panel-${tab}`}
                >
                  <AgentBindingPanel
                    {...props}
                    layout="tabs"
                    activeSection={
                      tab === 'skills' ? 'skills' : tab === 'runtime' ? 'runtime' : 'more'
                    }
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
