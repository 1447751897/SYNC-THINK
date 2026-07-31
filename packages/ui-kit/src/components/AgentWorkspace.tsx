import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  BookMarked,
  History,
  Layers3,
  ListTodo,
  Plug,
  Plus,
  Radar,
  Search,
  Save,
  Sparkles,
  Wrench,
} from 'lucide-react';
import {
  AgentBindingPanel,
  type AgentBindingPanelProps,
  type AgentBindingView,
  projectAgentCapabilityReadiness,
} from './AgentBindingPanel.js';
import { formatModelPathLabel } from './ModelPathBoard.js';

export type AgentWorkspaceTab =
  | 'overview'
  | 'tasks'
  | 'instructions'
  | 'skills'
  | 'tools'
  | 'runtime'
  | 'versions'
  | 'more';

export type AgentMemoryScopeView = 'task' | 'project' | 'global';
export type AgentApprovalModeView = 'request' | 'delegate' | 'full' | 'custom';

export interface AgentDefinitionView {
  agentId: string;
  agentVersionId: string;
  version: number;
  name: string;
  description?: string;
  visualIdentity?: { icon: string; color: string };
  role: string;
  developerInstructions: string;
  inputContract: string;
  outputContract: string;
  memoryScope: AgentMemoryScopeView;
  approvalMode: AgentApprovalModeView;
  mcpToolAllowlist?: string[];
  permissions?: {
    file: string[];
    command: string[];
    browser: string[];
    desktop: string[];
    network: string[];
  };
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

export interface AgentDefinitionSaveInput
  extends Omit<AgentDefinitionView, 'agentVersionId' | 'version'> {
  expectedVersion: number;
}

export interface AgentWorkspaceTaskSummary {
  taskId: string;
  title: string;
  status?: string;
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
  onCreateAgent?: () => void;
  /** Optional related tasks for the selected agent. */
  relatedTasks?: readonly AgentWorkspaceTaskSummary[];
  /** Role/work blurb for overview when API has no description. */
  workSummary?: string;
  /** Optional read-only instructions text for instructions tab (M1 may be empty). */
  instructionsText?: string;
  definition?: AgentDefinitionView | null;
  versions?: readonly AgentVersionHistoryView[];
  allAgentVersions?: readonly AgentWorkspaceReviewerVersion[];
  onSaveDefinition?: (input: AgentDefinitionSaveInput) => void | Promise<void>;
  defaultTab?: AgentWorkspaceTab;
}

const TABS: { id: AgentWorkspaceTab; label: string; icon: typeof Bot }[] = [
  { id: 'overview', label: '概览', icon: Radar },
  { id: 'tasks', label: '任务', icon: ListTodo },
  { id: 'instructions', label: '指令', icon: BookMarked },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'tools', label: '工具', icon: Plug },
  { id: 'runtime', label: '运行时', icon: Layers3 },
  { id: 'versions', label: '版本', icon: History },
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
  ['memoryScope', '记忆范围'],
  ['approvalMode', '批准模式'],
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

function parseDefinitionList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

const AGENT_PERMISSION_FIELDS = [
  ['file', '文件'],
  ['command', '命令'],
  ['browser', '浏览器'],
  ['desktop', '桌面'],
  ['network', '网络'],
] as const;

function emptyDefinitionPermissions(): NonNullable<AgentDefinitionView['permissions']> {
  return { file: [], command: [], browser: [], desktop: [], network: [] };
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
  const [tab, setTab] = useState<AgentWorkspaceTab>(props.defaultTab ?? 'overview');
  const [selectedId, setSelectedId] = useState<string | null>(
    props.selectedAgentId ?? agents[0]?.agentId ?? null,
  );
  const [definitionDraft, setDefinitionDraft] = useState<AgentDefinitionView | null>(
    props.definition ?? null,
  );

  useEffect(() => {
    setDefinitionDraft(props.definition ?? null);
  }, [props.definition]);

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
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.agentId.toLowerCase().includes(q),
    );
  }, [agents, query]);

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
  const versionHistory = useMemo(
    () => [...(props.versions ?? [])].sort((left, right) => right.version - left.version),
    [props.versions],
  );
  const ascendingVersions = useMemo(
    () => [...versionHistory].sort((left, right) => left.version - right.version),
    [versionHistory],
  );
  const backupReviewerVersions = useMemo(
    () =>
      (props.allAgentVersions ?? []).filter(
        (version) =>
          version.reviewerCapable && version.agentVersionId !== definitionDraft?.agentVersionId,
      ),
    [definitionDraft?.agentVersionId, props.allAgentVersions],
  );
  const selectedBackupReviewerVersionId =
    definitionDraft?.reviewBehavior?.backupAgentVersionId?.trim() ?? '';
  const requiresBackupReviewer =
    definitionDraft?.reviewBehavior?.onLimitReached === 'reassign';
  const hasValidBackupReviewer =
    !requiresBackupReviewer ||
    (selectedBackupReviewerVersionId.length > 0 &&
      backupReviewerVersions.some(
        (version) => version.agentVersionId === selectedBackupReviewerVersionId,
      ));
  const hasStaleBackupReviewer =
    requiresBackupReviewer &&
    selectedBackupReviewerVersionId.length > 0 &&
    !hasValidBackupReviewer;

  const saveDefinition = () => {
    if (!definitionDraft || !props.onSaveDefinition) return;
    const required = [
      definitionDraft.name,
      definitionDraft.role,
      definitionDraft.developerInstructions,
      definitionDraft.inputContract,
      definitionDraft.outputContract,
    ];
    if (required.some((value) => !value.trim())) return;
    const draftReviewBehavior = definitionDraft.reviewBehavior ?? {
      role: 'none' as const,
      maxIterations: 0,
      onLimitReached: 'pause' as const,
    };
    const { backupAgentVersionId, ...reviewBehaviorWithoutBackup } = draftReviewBehavior;
    const normalizedBackupAgentVersionId = backupAgentVersionId?.trim();
    if (
      draftReviewBehavior.onLimitReached === 'reassign' &&
      (!normalizedBackupAgentVersionId ||
        !backupReviewerVersions.some(
          (version) => version.agentVersionId === normalizedBackupAgentVersionId,
        ))
    ) return;
    const reviewBehavior =
      draftReviewBehavior.onLimitReached === 'reassign'
        ? { ...reviewBehaviorWithoutBackup, backupAgentVersionId: normalizedBackupAgentVersionId }
        : reviewBehaviorWithoutBackup;
    props.onSaveDefinition({
      agentId: definitionDraft.agentId,
      expectedVersion: definitionDraft.version,
      name: definitionDraft.name.trim(),
      description: (definitionDraft.description ?? '').trim(),
      visualIdentity: definitionDraft.visualIdentity ?? { icon: 'bot', color: '#64748b' },
      role: definitionDraft.role.trim(),
      developerInstructions: definitionDraft.developerInstructions.trim(),
      inputContract: definitionDraft.inputContract.trim(),
      outputContract: definitionDraft.outputContract.trim(),
      memoryScope: definitionDraft.memoryScope,
      approvalMode: definitionDraft.approvalMode,
      mcpToolAllowlist: [...(definitionDraft.mcpToolAllowlist ?? [])],
      permissions: definitionDraft.permissions ?? emptyDefinitionPermissions(),
      reviewBehavior,
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
    <section
      className="st-agent-ws"
      data-testid="agent-workspace"
      aria-label="智能体中心"
    >
      <aside className="st-agent-ws__list" data-testid="agent-workspace-list">
        <header className="st-agent-ws__list-head">
          <div>
            <h2>智能体中心</h2>
            <p>全部智能体 · 点进详情配置工作与运行时</p>
          </div>
          <div className="st-agent-ws__search">
            <Search size={13} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索智能体…"
              aria-label="搜索智能体"
              data-testid="agent-workspace-search"
            />
          </div>
        </header>

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
                onClick={() => selectAgent(a.agentId)}
              >
                <div className="st-agent-ws__card-name">
                  <span>{a.name}</span>
                  <span className="st-agent-ws__pill">v{a.version}</span>
                </div>
                <div className="st-agent-ws__card-role">{a.role}</div>
                <div className="st-agent-ws__card-runtime" title={path}>
                  {path}
                </div>
                <div className="st-agent-ws__card-meta">
                  <span className="st-agent-ws__pill">
                    Skill {a.skillCount ?? 0}
                  </span>
                  <span className="st-agent-ws__pill">MCP {a.mcpCount ?? 0}</span>
                  {typeof a.taskCount === 'number' ? (
                    <span className="st-agent-ws__pill">Task {a.taskCount}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        <footer className="st-agent-ws__list-foot">
          <button
            type="button"
            className="st-agent-ws__new"
            data-testid="agent-workspace-new"
            onClick={() => props.onCreateAgent?.()}
            disabled={!props.onCreateAgent}
            title={props.onCreateAgent ? '新建智能体' : '多智能体创建将在后续版本开放'}
          >
            <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            新建智能体
          </button>
        </footer>
      </aside>

      <div className="st-agent-ws__detail" data-testid="agent-workspace-detail">
        {!selected ? (
          <div className="st-agent-ws__detail-empty">
            <Bot size={28} strokeWidth={1.5} aria-hidden="true" />
            <p>从左侧选择一个智能体</p>
          </div>
        ) : (
          <>
            <header className="st-agent-ws__detail-head">
              <div className="st-agent-ws__detail-titles">
                <h3 data-testid="agent-workspace-detail-name">{selected.name}</h3>
                <p>
                  {selected.role}
                  {' · '}
                  运行时 {runtimePath}
                </p>
              </div>
              <div className="st-agent-ws__badges">
                <span className="st-agent-ws__badge" data-testid="agent-workspace-version">
                  v{selected.version}
                </span>
                <span
                  className="st-agent-ws__badge"
                  data-tone={capability.level === 'ready' ? 'ok' : 'warn'}
                  data-testid="agent-workspace-cap"
                >
                  {capability.badge}
                </span>
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
                      <span>凭证</span>
                      <strong>{capability.credOk ? '已配置' : '未绑'}</strong>
                    </div>
                  </div>
                  <p className="st-agent-ws__work" data-testid="agent-workspace-work">
                    {props.workSummary?.trim() ||
                      `「${selected.name}」是当前默认对话智能体。在「运行时」按 分组 → 供应商 → 模型 配置默认模型；Skills / 工具 在对应页签白名单。`}
                  </p>
                  {relatedTasks.length > 0 ? (
                    <div className="st-agent-ws__task-preview">
                      <h4>最近任务</h4>
                      <ul>
                        {relatedTasks.slice(0, 4).map((t) => (
                          <li key={t.taskId}>
                            <strong>{t.title}</strong>
                            <span>{t.status ?? '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="st-agent-ws__hint">
                      任务关联列表将在多 Agent API 就绪后展示。当前可从左侧项目打开任务。
                    </p>
                  )}
                  <p className="st-agent-ws__hint">{capability.note}</p>
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
                      暂无关联任务摘要。请在左侧项目打开或创建任务；多 Agent 关联将在后续接入。
                    </p>
                  ) : (
                    <ul className="st-agent-ws__task-list">
                      {relatedTasks.map((t) => (
                        <li key={t.taskId}>
                          <div>
                            <strong>{t.title}</strong>
                            <small>{t.taskId}</small>
                          </div>
                          <span className="st-agent-ws__pill">{t.status ?? '—'}</span>
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
                      <div className="st-agent-ws__definition-grid">
                        <label>
                          <span>名称</span>
                          <input
                            aria-label="智能体名称"
                            value={definitionDraft.name}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({ ...definitionDraft, name: event.target.value })
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
                              setDefinitionDraft({ ...definitionDraft, role: event.target.value })
                            }
                          />
                        </label>
                        <label className="st-agent-ws__definition-wide">
                          <span>描述</span>
                          <textarea
                            data-testid="agent-definition-description"
                            rows={3}
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
                        <label>
                          <span>图标</span>
                          <input
                            data-testid="agent-definition-icon"
                            maxLength={128}
                            value={definitionDraft.visualIdentity?.icon ?? 'bot'}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                visualIdentity: {
                                  ...(definitionDraft.visualIdentity ?? {
                                    icon: 'bot',
                                    color: '#64748b',
                                  }),
                                  icon: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>强调色</span>
                          <input
                            type="color"
                            data-testid="agent-definition-color"
                            value={
                              /^#[0-9a-f]{6}$/i.test(definitionDraft.visualIdentity?.color ?? '')
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
                        <label className="st-agent-ws__definition-wide">
                          <span>开发者指令</span>
                          <textarea
                            aria-label="开发者指令"
                            rows={7}
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
                        <label className="st-agent-ws__definition-wide">
                          <span>输入契约</span>
                          <textarea
                            aria-label="输入契约"
                            rows={3}
                            value={definitionDraft.inputContract}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                inputContract: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="st-agent-ws__definition-wide">
                          <span>输出契约</span>
                          <textarea
                            aria-label="输出契约"
                            rows={3}
                            value={definitionDraft.outputContract}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                outputContract: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>记忆范围</span>
                          <select
                            aria-label="记忆范围"
                            value={definitionDraft.memoryScope}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                memoryScope: event.target.value as AgentMemoryScopeView,
                              })
                            }
                          >
                            <option value="task">当前任务</option>
                            <option value="project">当前项目</option>
                            <option value="global">全局</option>
                          </select>
                        </label>
                        <label>
                          <span>批准模式</span>
                          <select
                            aria-label="智能体批准模式"
                            value={definitionDraft.approvalMode}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                approvalMode: event.target.value as AgentApprovalModeView,
                              })
                            }
                          >
                            <option value="request">请求批准</option>
                            <option value="delegate">委托批准</option>
                            <option value="full">完全批准</option>
                            <option value="custom">自定义</option>
                          </select>
                        </label>
                        <label className="st-agent-ws__definition-wide">
                          <span>策略 ID（可选）</span>
                          <input
                            aria-label="智能体策略 ID"
                            value={definitionDraft.policyId ?? ''}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                policyId: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="st-agent-ws__definition-wide">
                          <span>MCP 工具白名单</span>
                          <textarea
                            data-testid="agent-definition-mcp-tools"
                            rows={2}
                            value={(definitionDraft.mcpToolAllowlist ?? []).join(', ')}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                mcpToolAllowlist: parseDefinitionList(event.target.value),
                              })
                            }
                          />
                        </label>
                        {AGENT_PERMISSION_FIELDS.map(([field, label]) => (
                          <label key={field}>
                            <span>{label}权限</span>
                            <textarea
                              data-testid={`agent-definition-permission-${field}`}
                              rows={2}
                              value={(definitionDraft.permissions?.[field] ?? []).join(', ')}
                              disabled={props.busy}
                              onChange={(event) =>
                                setDefinitionDraft({
                                  ...definitionDraft,
                                  permissions: {
                                    ...(definitionDraft.permissions ?? emptyDefinitionPermissions()),
                                    [field]: parseDefinitionList(event.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                        <label>
                          <span>评审角色</span>
                          <select
                            data-testid="agent-definition-review-role"
                            value={definitionDraft.reviewBehavior?.role ?? 'none'}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                reviewBehavior: {
                                  ...(definitionDraft.reviewBehavior ?? {
                                    role: 'none',
                                    maxIterations: 0,
                                    onLimitReached: 'pause',
                                  }),
                                  role: event.target.value as NonNullable<
                                    AgentDefinitionView['reviewBehavior']
                                  >['role'],
                                },
                              })
                            }
                          >
                            <option value="none">无</option>
                            <option value="reviewer">评审者</option>
                            <option value="executor-reviewer">执行并评审</option>
                          </select>
                        </label>
                        <label>
                          <span>最大评审轮次</span>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            data-testid="agent-definition-review-max-iterations"
                            value={definitionDraft.reviewBehavior?.maxIterations ?? 0}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                reviewBehavior: {
                                  ...(definitionDraft.reviewBehavior ?? {
                                    role: 'none',
                                    maxIterations: 0,
                                    onLimitReached: 'pause',
                                  }),
                                  maxIterations: Math.max(0, Number(event.target.value) || 0),
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>达到上限时</span>
                          <select
                            data-testid="agent-definition-review-on-limit"
                            value={definitionDraft.reviewBehavior?.onLimitReached ?? 'pause'}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                reviewBehavior: {
                                  ...(definitionDraft.reviewBehavior ?? {
                                    role: 'none',
                                    maxIterations: 0,
                                    onLimitReached: 'pause',
                                  }),
                                  onLimitReached: event.target.value as NonNullable<
                                    AgentDefinitionView['reviewBehavior']
                                  >['onLimitReached'],
                                  ...(event.target.value === 'reassign'
                                    ? {}
                                    : { backupAgentVersionId: undefined }),
                                },
                              })
                            }
                          >
                            <option value="pause">暂停</option>
                            <option value="abort">终止</option>
                            <option value="reassign">重新分配</option>
                          </select>
                        </label>
                        {definitionDraft.reviewBehavior?.onLimitReached === 'reassign' ? (
                          <label>
                            <span>备用审阅者</span>
                            <select
                              data-testid="agent-definition-review-backup"
                              value={definitionDraft.reviewBehavior.backupAgentVersionId ?? ''}
                              disabled={props.busy}
                              aria-invalid={!hasValidBackupReviewer}
                              aria-describedby={
                                hasValidBackupReviewer
                                  ? undefined
                                  : 'agent-definition-review-backup-error'
                              }
                              onChange={(event) =>
                                setDefinitionDraft({
                                  ...definitionDraft,
                                  reviewBehavior: {
                                    ...(definitionDraft.reviewBehavior ?? {
                                      role: 'none',
                                      maxIterations: 0,
                                      onLimitReached: 'reassign',
                                    }),
                                    backupAgentVersionId: event.target.value || undefined,
                                  },
                                })
                              }
                            >
                              <option value="">选择 exact AgentVersion</option>
                              {hasStaleBackupReviewer ? (
                                <option value={selectedBackupReviewerVersionId} disabled>
                                  已失效 · {selectedBackupReviewerVersionId}
                                </option>
                              ) : null}
                              {backupReviewerVersions.map((version) => (
                                <option
                                  key={version.agentVersionId}
                                  value={version.agentVersionId}
                                  title={version.title ?? version.agentName}
                                >
                                  {version.agentName} · v{version.version} · {version.agentVersionId}
                                  {version.title ? ` · ${version.title}` : ''}
                                </option>
                              ))}
                            </select>
                            {!hasValidBackupReviewer ? (
                              <span
                                className="st-agent-ws__definition-error"
                                id="agent-definition-review-backup-error"
                                data-testid="agent-definition-review-backup-error"
                                role="alert"
                              >
                                请选择目录中有效的 exact AgentVersion。
                              </span>
                            ) : null}
                          </label>
                        ) : null}
                        <label className="st-agent-ws__definition-check">
                          <input
                            type="checkbox"
                            data-testid="agent-definition-artifact-retain"
                            checked={definitionDraft.artifactRules?.retainVersions ?? true}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                artifactRules: {
                                  ...(definitionDraft.artifactRules ?? {
                                    retainVersions: true,
                                    requireReview: false,
                                    defaultStatus: 'candidate',
                                  }),
                                  retainVersions: event.target.checked,
                                },
                              })
                            }
                          />
                          <span>保留产物版本</span>
                        </label>
                        <label className="st-agent-ws__definition-check">
                          <input
                            type="checkbox"
                            data-testid="agent-definition-artifact-review"
                            checked={definitionDraft.artifactRules?.requireReview ?? false}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                artifactRules: {
                                  ...(definitionDraft.artifactRules ?? {
                                    retainVersions: true,
                                    requireReview: false,
                                    defaultStatus: 'candidate',
                                  }),
                                  requireReview: event.target.checked,
                                },
                              })
                            }
                          />
                          <span>产物必须评审</span>
                        </label>
                        <label>
                          <span>默认产物状态</span>
                          <select
                            data-testid="agent-definition-artifact-status"
                            value={definitionDraft.artifactRules?.defaultStatus ?? 'candidate'}
                            disabled={props.busy}
                            onChange={(event) =>
                              setDefinitionDraft({
                                ...definitionDraft,
                                artifactRules: {
                                  ...(definitionDraft.artifactRules ?? {
                                    retainVersions: true,
                                    requireReview: false,
                                    defaultStatus: 'candidate',
                                  }),
                                  defaultStatus: event.target.value as 'candidate' | 'final',
                                },
                              })
                            }
                          >
                            <option value="candidate">候选</option>
                            <option value="final">最终</option>
                          </select>
                        </label>
                      </div>
                      <div className="st-agent-ws__definition-save">
                        <span>
                          当前 {definitionDraft.agentVersionId} · v{definitionDraft.version}
                        </span>
                        <button
                          type="button"
                          onClick={saveDefinition}
                          disabled={
                            props.busy || !props.onSaveDefinition || !hasValidBackupReviewer
                          }
                        >
                          <Save size={13} strokeWidth={1.9} aria-hidden="true" />
                          保存为新版本
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
                              version.agentVersionId === props.definition?.agentVersionId ? '1' : '0'
                            }
                          >
                            <div className="st-agent-ws__version-head">
                              <strong>v{version.version}</strong>
                              <code>{version.agentVersionId}</code>
                              <time dateTime={version.createdAt}>{version.createdAt.slice(0, 16)}</time>
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
                              <div><dt>角色</dt><dd>{version.role}</dd></div>
                              <div><dt>记忆</dt><dd>{version.memoryScope}</dd></div>
                              <div><dt>批准</dt><dd>{version.approvalMode}</dd></div>
                              <div><dt>策略</dt><dd>{version.policyId ?? '无'}</dd></div>
                              <div><dt>Model</dt><dd>{version.defaultModelId ?? '—'}</dd></div>
                              <div><dt>Credential group</dt><dd>{version.defaultCredentialGroupId ?? '—'}</dd></div>
                              <div><dt>Credential pin</dt><dd>{version.pinnedCredentialRefId ?? '—'}</dd></div>
                              <div><dt>Failure</dt><dd>{version.pauseOnFailure ? 'pause' : 'continue'}</dd></div>
                              <div><dt>Fallback</dt><dd>{version.fallbackModelIds?.join(', ') || '—'}</dd></div>
                              <div><dt>Skills</dt><dd>{version.skillVersionIds?.join(', ') || '—'}</dd></div>
                              <div><dt>MCP servers</dt><dd>{version.mcpServerIds?.join(', ') || '—'}</dd></div>
                              <div><dt>MCP tools</dt><dd>{version.mcpToolAllowlist?.join(', ') || '—'}</dd></div>
                            </dl>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              ) : null}

              {tab === 'skills' ||
              tab === 'tools' ||
              tab === 'runtime' ||
              tab === 'more' ? (
                <div
                  className="st-agent-ws__panel st-agent-ws__panel--binding"
                  data-testid={`agent-workspace-panel-${tab}`}
                >
                  <AgentBindingPanel
                    {...props}
                    layout="tabs"
                    activeSection={
                      tab === 'skills'
                        ? 'skills'
                        : tab === 'tools'
                          ? 'tools'
                          : tab === 'runtime'
                            ? 'runtime'
                            : 'more'
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
