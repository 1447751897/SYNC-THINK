import { StrictMode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AppShell,
  Compose,
  ModeSwitch,
  MessageBubble,
  TraceList,
  ProvidersPanel,
  AgentWorkspace,
  MemoryDiagnosticsPanel,
  ApprovalCenterPanel,
  PlanRevisionPanel,
  ExecutionGraphPanel,
  ArtifactVersionsPanel,
  ManifestPanel,
  WorkspaceNav,
  type ComposeModelOption,
  type ComposeSendOptions,
  type ProviderCreateInput,
  type ProviderUpdateInput,
  type CcSwitchPreviewItem,
  type ProviderPanelItem,
  type AgentBindingView,
  type AgentBindingModelOption,
  type AgentBindingSaveInput,
  type AgentBindingCredentialOption,
  type AgentBindingSkillOption,
  type AgentBindingMcpOption,
  type AgentWorkspaceListItem,
  type AgentDefinitionView,
  type AgentVersionHistoryView,
  type AgentDefinitionSaveInput,
  type MemoryEntryView,
  type MemoryChangeView,
  type DiagnosticView,
  type MemoryDecideInput,
  type MemoryRollbackInput,
  type ApprovalItemView,
  type ApprovalDecideInput,
  type ApprovalModeView,
  type ApprovalPolicyView,
  type ApprovalPolicySaveInput,
  type ArtifactVersionsView,
  type ArtifactComparisonView,
  type ArtifactMergeConflictView,
  type ArtifactMergeStepView,
  type ManifestInspectView,
  type Theme,
  type WorkspaceNavTask,
} from '@sync-think/ui-kit';
import type {
  AgentBindingSummary,
  AgentDefinitionSummary,
  SkillVersionSummary,
  McpServerSummary,
  DurableMemoryEntrySummary,
  MemoryChangeSummary,
  ApprovalRequestSummary,
  DiagnosticSummary,
  ProviderSummary,
  TaskSummary,
  WorkspaceSummary,
  RefreshMcpToolsResponse,
  RunGraphResponse,
  ArtifactListItem,
  ArtifactMergeConflictListItem,
  PolicyVersionSummary,
} from '@sync-think/protocol';
import {
  ulid,
  type ArtifactMergeConflictResolutionStrategy,
  type PlanRevision,
  type PlanStepDraft,
} from '@sync-think/shared';
import {
  Activity,
  AlignLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  ChevronLeft,
  Circle,
  Columns2,
  Files,
  GitBranch,
  ListTodo,
  Monitor,
  Moon,
  PackageCheck,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { projectBeginnerWorkspace } from './beginner-workspace.js';
import { projectConversation } from './m0-projection.js';
import { formatProviderDiscoveryError } from './provider-error-copy.js';
import { startRuntimeConnection } from './runtime-connection.js';
import {
  canSendRuntimeMessage,
  createInitialRuntimeViewState,
  runtimeViewReducer,
} from './runtime-view-state.js';
import {
  pickLastOpenedTaskId,
  resolveExpectedTaskVersion,
  resolvePreferredTask,
  upsertTaskInMap,
  type ActiveTaskSelection,
} from './workspace-catalog.js';
import {
  buildComposeModelOptions,
  resolveAgentDefaultModelLabel,
  sanitizeSelectedModelId,
} from './compose-models.js';
import { classifyAppendMessageFailure } from './append-message-error.js';
import {
  buildAgentCreatePayload,
  buildAgentVersionPayload,
  canSaveAgentBindingForSelection,
  createM2LoadRequestGate,
  deriveM2WorkspaceIdentity,
  findNearestCommonArtifactAncestor,
  hasApprovedPlanRevision,
  isApprovalDelegateAgentVersion,
  isM2RefreshEvent,
  mergeTaskVersionForTarget,
  projectAgentWorkspace,
  projectM2ExecutionGraph,
  resolveAutomaticModeRecovery,
  resolveVisibleAutomaticModeRecovery,
  type AutomaticModeRecovery,
} from './m2-workspace.js';
import {
  projectM1SessionReadiness,
  isM1SessionChipJumpable,
  type M1SessionJumpTarget,
} from './m1-session-readiness.js';
import { projectM1ExitEvidenceProgress, type M1ExitEvidenceProgress } from './m1-exit-evidence.js';
import {
  isM1HandtestItemJumpable,
  projectM1CurrentMilestoneCopy,
  projectM1HandtestChecklist,
  type M1HandtestChecklist,
} from './m1-handtest-checklist.js';
import {
  isM1NextActionJumpable,
  isM1NextOpenDocAction,
  isM1NextDogfoodFillAction,
  isM1NextExternalFocusAction,
  projectM1NextAction,
  type M1NextAction,
} from './m1-next-action.js';
import {
  formatM1OpenDocFeedback,
  isM1ExitChipActionable,
  resolveM1ExitChipAction,
} from './m1-exit-chip-action.js';
import { formatM1SoftSnapshot } from './m1-soft-snapshot.js';
import {
  formatM1SoftRegressionMatrix,
  filterM1SoftRegressionRows,
  countM1SoftRegressionFilter,
  resolveM1SoftRegressionRowAction,
  isM1SoftRegressionRowActionable,
  type M1SoftRegressionMatrix,
  type M1SoftRegressionListFilter,
} from './m1-soft-regression.js';
import { formatM1DogfoodDayDraft } from './m1-dogfood-draft.js';
import {
  projectM1DogfoodFillBoard,
  formatM1DogfoodFillBoardPaste,
  type M1DogfoodFillBoard,
  type M1DogfoodFillDayRow,
} from './m1-dogfood-fill-board.js';
import {
  formatM1EvidenceBundle,
  projectM1EvidenceBundlePreview,
  M1_EVIDENCE_BUNDLE_SECTIONS,
} from './m1-evidence-bundle.js';
import {
  projectM1ExitPath,
  formatM1ExitPathPaste,
  isM1ExitPathStepActionable,
  type M1ExitPathBoard,
  type M1ExitPathCtaAction,
} from './m1-exit-path.js';
import { mapHandtestDocBoxesToItems, type HandtestDocBox } from '../m1-handtest-doc-parse.js';
import {
  projectM1HandtestDocDiff,
  listM1HandtestDocDiffAttention,
  formatM1HandtestDocDiffPaste,
  planM1HandtestDocDiffCta,
  isM1HandtestDocDiffCtaActionable,
  type M1HandtestDocDiffBoard,
  type M1HandtestDocDiffRow,
} from './m1-handtest-doc-diff.js';
import {
  projectM1HandtestSectionBoard,
  type M1HandtestSectionBoard,
} from './m1-handtest-section-board.js';
import {
  projectM1ExternalFocusFromChecklist,
  formatM1ExternalFocusRunSheet,
  isM1ExternalFocusCtaActionable,
  type M1ExternalFocusBoard,
  type M1ExternalFocusCtaAction,
} from './m1-external-focus.js';
import { projectM1ObsLayout, isM1ObsSecondaryTestId } from './m1-obs-layout.js';
import {
  projectM1HardgateStrip,
  isM1HardgateCtaActionable,
  type M1HardgateStrip,
  type M1HardgateCtaAction,
} from './m1-hardgate-strip.js';
import {
  closeLeftInstrumentDrawer,
  projectLeftInstrumentSwitch,
  resolveLeftInstrumentDrawer,
  leftInstrumentFromJump,
  type LeftInstrumentId,
} from './left-instrument-switch.js';
import {
  countM1HandtestFilter,
  filterM1HandtestItems,
  formatM1HandtestPaste,
  type M1HandtestListFilter,
} from './m1-handtest-paste.js';
import {
  projectConversationStreamReadiness,
  type ConversationFailureCtaAction,
} from './conversation-stream-readiness.js';
import {
  readConversationLayoutPreference,
  readThemePreference,
  readTraceCollapsedPreference,
  writeConversationLayoutPreference,
  writeThemePreference,
  writeTraceCollapsedPreference,
  type ConversationLayoutPreference,
  type ThemePreference,
} from './ui-preferences.js';
import './renderer.css';

const FALLBACK_THREAD_ID = 'thread-desktop-main';
const SHOW_M1_VALIDATION_WORKBENCH = false;

interface ConversationAgentIdentity {
  agentId?: string;
  name: string;
  icon: string;
  color: string;
}

type RightRailTab = 'overview' | 'trace' | 'graph' | 'approvals' | 'artifacts';

const leftPrimaryToolOrder: readonly LeftInstrumentId[] = ['agent', 'providers', 'approvals'];

function taskStatusLabel(status: string): string {
  if (status === 'active') return '进行中';
  if (status === 'paused') return '已暂停';
  if (status === 'completed') return '已完成';
  if (status === 'archived') return '已归档';
  return '等待开始';
}

const conversationLayoutOptions: Array<{
  value: ConversationLayoutPreference;
  label: string;
  icon: typeof Columns2;
}> = [
  { value: 'default', label: '分栏对话（用户右 / 助手左）', icon: Columns2 },
  { value: 'single', label: '单列阅读', icon: AlignLeft },
];

const themeOptions: Array<{
  value: Theme;
  label: string;
  icon: typeof Sun;
}> = [
  { value: 'light', label: '浅色主题', icon: Sun },
  { value: 'dark', label: '深色主题', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

const leftToolMeta: Record<LeftInstrumentId, { label: string; icon: typeof ServerCog }> = {
  providers: { label: '模型源', icon: ServerCog },
  agent: { label: '智能体', icon: Bot },
  memory: { label: '记忆', icon: BrainCircuit },
  approvals: { label: '审批', icon: ShieldCheck },
};

function toNavTask(task: TaskSummary): WorkspaceNavTask {
  return {
    taskId: task.taskId,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    goal: task.goal,
    status: task.status,
    participationMode: task.participationMode,
    taskVersion: task.taskVersion,
    threadId: task.threadId,
    lastOpenedAt: task.lastOpenedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toProviderPanelItem(provider: ProviderSummary): ProviderPanelItem {
  return {
    providerId: provider.providerId,
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: provider.protocol,
    supportsDiscovery: provider.supportsDiscovery,
    surface: provider.surface,
    credentials: provider.credentials.map((credential) => ({
      credentialRefId: credential.credentialRefId,
      credentialGroupId: credential.credentialGroupId,
      groupName: credential.groupName,
      label: credential.label,
      kind: credential.kind,
      hasSecret: credential.hasSecret,
    })),
    models: provider.models.map((model) => ({
      modelId: model.modelId,
      providerModelId: model.providerModelId,
      displayName: model.displayName,
      protocol: model.protocol,
      capabilities: (model.capabilities ??
        []) as ProviderPanelItem['models'][number]['capabilities'],
      capabilitiesConfirmed: model.capabilitiesConfirmed,
    })),
    createdAt: provider.createdAt,
  };
}

function toMemoryEntryView(entry: DurableMemoryEntrySummary): MemoryEntryView {
  return {
    id: entry.id,
    key: entry.key,
    value: entry.value,
    scope: entry.scope,
    active: entry.active,
    updatedAt: entry.updatedAt,
    taskId: entry.taskId,
  };
}

function toMemoryChangeView(change: MemoryChangeSummary): MemoryChangeView {
  return {
    id: change.id,
    taskId: change.taskId,
    targetScope: change.targetScope,
    approvalState: change.approvalState,
    confidence: change.confidence,
    additions: change.additions.map((a) => ({
      id: a.id,
      key: a.key,
      value: a.value,
      targetScope: a.targetScope,
    })),
    modifications: change.modifications.map((m) => ({
      id: m.id,
      key: m.key,
      value: m.value,
      targetScope: m.targetScope,
    })),
    deprecations: change.deprecations,
    unresolvedAmbiguity: change.unresolvedAmbiguity,
    createdAt: change.createdAt,
    decidedAt: change.decidedAt,
  };
}

function toDiagnosticView(item: DiagnosticSummary): DiagnosticView {
  return {
    id: item.id,
    category: item.category,
    failureClass: item.failureClass,
    summary: item.summary,
    createdAt: item.createdAt,
    runId: item.runId,
  };
}
function toApprovalItemView(item: ApprovalRequestSummary): ApprovalItemView {
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    taskId: item.taskId,
    kind: item.kind as ApprovalItemView['kind'],
    action: item.action,
    summary: item.summary,
    humanOnly: item.humanOnly,
    humanOnlyAction: item.humanOnlyAction,
    mode: item.mode as ApprovalModeView,
    gate: item.gate,
    state: item.state as ApprovalItemView['state'],
    decidedBy: item.decidedBy,
    delegateAgentVersionId: item.delegateAgentVersionId,
    decisionNote: item.decisionNote,
    runId: item.runId,
    stepId: item.stepId,
    createdAt: item.createdAt,
    decidedAt: item.decidedAt,
  };
}

function toApprovalPolicyView(policy: PolicyVersionSummary): ApprovalPolicyView {
  return {
    id: policy.id,
    policyId: policy.policyId,
    version: policy.version,
    scopeType: policy.scopeType,
    scopeId: policy.scopeId,
    approvalMode: policy.approvalMode,
    rules: policy.rules.map((rule) => ({
      action: rule.action,
      approvalMode: rule.approvalMode,
      delegateAgentVersionId: rule.delegateAgentVersionId,
    })),
    createdAt: policy.createdAt,
  };
}

function toAgentBindingView(agent: AgentBindingSummary): AgentBindingView {
  return {
    agentId: agent.agentId,
    agentVersionId: agent.agentVersionId,
    version: agent.version,
    name: agent.name,
    role: agent.role,
    defaultModelId: agent.defaultModelId,
    fallbackModelIds: agent.fallbackModelIds,
    pauseOnFailure: agent.pauseOnFailure,
    defaultCredentialGroupId: agent.defaultCredentialGroupId,
    pinnedCredentialRefId: agent.pinnedCredentialRefId ?? null,
    skillVersionIds: agent.skillVersionIds ?? [],
    mcpServerIds: agent.mcpServerIds ?? [],
  };
}

function toSkillOption(skill: SkillVersionSummary): AgentBindingSkillOption {
  return {
    skillVersionId: skill.skillVersionId,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    hasScripts: skill.hasScripts,
    allowedTools: skill.allowedTools ?? [],
    contentFingerprint: skill.contentFingerprint,
  };
}

function formatMcpPolicyLabelLocal(
  timeoutMs: number,
  maxOutputBytes: number,
  trusted: boolean,
): string {
  const kb =
    maxOutputBytes >= 1024 ? Math.round(maxOutputBytes / 1024) + 'KB' : maxOutputBytes + 'B';
  const sec =
    timeoutMs >= 1000
      ? (timeoutMs / 1000).toFixed(timeoutMs % 1000 === 0 ? 0 : 1) + 's'
      : timeoutMs + 'ms';
  return sec + ' · ' + kb + ' · ' + (trusted ? 'trusted' : 'untrusted');
}

function toMcpOption(server: McpServerSummary): AgentBindingMcpOption {
  const toolNames = (server.tools ?? [])
    .map((t) => (typeof t?.name === 'string' ? t.name.trim() : ''))
    .filter(Boolean);
  return {
    mcpServerId: server.mcpServerId,
    name: server.name,
    transport: server.transport,
    endpoint: server.endpoint,
    toolCount: toolNames.length,
    toolNames,
    trusted: server.trusted,
    maxOutputBytes: server.maxOutputBytes,
    timeoutMs: server.timeoutMs,
    policyLabel: formatMcpPolicyLabelLocal(server.timeoutMs, server.maxOutputBytes, server.trusted),
  };
}

function parseMcpToolsDraft(
  toolsJson?: string,
): Array<{ name: string; description: string; inputSchemaJson?: string }> | undefined {
  if (!toolsJson || !toolsJson.trim()) return undefined;
  const raw = toolsJson.trim();
  // JSON array of {name, description?} or plain comma-separated tool names
  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('tools JSON 必须是数组');
    return parsed.map((item, index) => {
      if (typeof item === 'string') {
        const name = item.trim();
        if (!name) throw new Error(`tools[${index}] 名称为空`);
        return { name, description: '' };
      }
      if (!item || typeof item !== 'object') throw new Error(`tools[${index}] 无效`);
      const rec = item as { name?: unknown; description?: unknown; inputSchemaJson?: unknown };
      if (typeof rec.name !== 'string' || !rec.name.trim())
        throw new Error(`tools[${index}] 缺少 name`);
      return {
        name: rec.name.trim(),
        description: typeof rec.description === 'string' ? rec.description : '',
        inputSchemaJson: typeof rec.inputSchemaJson === 'string' ? rec.inputSchemaJson : undefined,
      };
    });
  }
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, description: '' }));
}

function connectionDetail(state: string): string {
  switch (state) {
    case 'online':
      return '已连接 · 持久事件流';
    case 'connecting':
      return '正在连接';
    case 'offline':
      return '未连接';
    default:
      return '浏览器预览';
  }
}

function DesktopShell() {
  const [theme, setTheme] = useState<Theme>(() => readThemePreference());
  const [conversationLayout, setConversationLayout] = useState<ConversationLayoutPreference>(() =>
    readConversationLayoutPreference(),
  );
  const [exitEvidenceRaw, setExitEvidenceRaw] = useState<{
    handtestChecked: number;
    handtestTotal: number;
    handtestBoxes: HandtestDocBox[];
    dogfoodFileCount: number;
    dogfoodRealDays: number;
    dogfoodDays: Array<{
      date: string;
      kind: string;
      pendingCount: number;
      checkedCount: number;
      filledSignals: number;
      fileName: string;
    }>;
    dualAutomatedOk: boolean;
    loadNote: string | null;
    ok: boolean;
  } | null>(null);
  const [exitEvidenceTick, setExitEvidenceTick] = useState(0);
  const [m1ObsWorkspaceOpen, setM1ObsWorkspaceOpen] = useState(false);
  const [m1ObsSecondaryOpen, setM1ObsSecondaryOpen] = useState(false);
  const [leftInstrument, setLeftInstrument] = useState<LeftInstrumentId>('providers');
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const leftToolButtonRefs = useRef<Partial<Record<LeftInstrumentId, HTMLButtonElement | null>>>(
    {},
  );
  const m1ObsLayout = useMemo(() => projectM1ObsLayout({ softCraftRound: 65 }), []);
  const [m1OpenDocFeedback, setM1OpenDocFeedback] = useState<{
    level: 'ok' | 'warn' | 'error';
    message: string;
    dataOk: '1' | '0';
    dataCreated: '1' | '0';
    openDocId: string;
    basename: string | null;
  } | null>(null);
  const [handtestListFilter, setHandtestListFilter] = useState<M1HandtestListFilter>('all');
  const [regressionListFilter, setRegressionListFilter] =
    useState<M1SoftRegressionListFilter>('all');

  const [traceCollapsed, setTraceCollapsed] = useState<boolean>(() =>
    readTraceCollapsedPreference(),
  );
  const [previewMessages, setPreviewMessages] = useState<string[]>([]);
  const [runtimeView, dispatchRuntimeView] = useReducer(
    runtimeViewReducer,
    Boolean(window.syncThink?.runtime),
    createInitialRuntimeViewState,
  );

  const dismissLeftDrawer = useCallback(
    (restoreFocus = false) => {
      const next = closeLeftInstrumentDrawer(leftInstrument);
      setLeftDrawerOpen(next.open);
      if (restoreFocus) {
        window.setTimeout(() => leftToolButtonRefs.current[next.active]?.focus(), 0);
      }
    },
    [leftInstrument],
  );

  useEffect(() => {
    if (!leftDrawerOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismissLeftDrawer(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dismissLeftDrawer, leftDrawerOpen]);
  const connectCancelRef = useRef<(() => void) | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [sendPending, setSendPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [automaticRecovery, setAutomaticRecovery] = useState<AutomaticModeRecovery>(null);

  const [workspaces, setWorkspaces] = useState<readonly WorkspaceSummary[]>([]);
  const [tasksByWorkspace, setTasksByWorkspace] = useState<
    ReadonlyMap<string, readonly TaskSummary[]>
  >(() => new Map());
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveTaskSelection | null>(null);
  const [navQuery, setNavQuery] = useState('');
  const [providers, setProviders] = useState<readonly ProviderPanelItem[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [agents, setAgents] = useState<readonly AgentWorkspaceListItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const selectedAgentIdRef = useRef<string | null>(null);
  const agentLoadRequestRef = useRef(0);
  const [agentBinding, setAgentBinding] = useState<AgentBindingView | null>(null);
  const [agentDefinition, setAgentDefinition] = useState<AgentDefinitionView | null>(null);
  const [agentVersions, setAgentVersions] = useState<readonly AgentVersionHistoryView[]>([]);
  const [allAgentVersions, setAllAgentVersions] = useState<readonly AgentDefinitionSummary[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [skills, setSkills] = useState<readonly AgentBindingSkillOption[]>([]);
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillStatus, setSkillStatus] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<readonly AgentBindingMcpOption[]>([]);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpProbeBusy, setMcpProbeBusy] = useState(false);
  const [mcpRequestBusy, setMcpRequestBusy] = useState(false);
  const [mcpSpawnBusy, setMcpSpawnBusy] = useState(false);
  const [mcpCallBusy, setMcpCallBusy] = useState(false);
  const [mcpRefreshBusy, setMcpRefreshBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpStatus, setMcpStatus] = useState<string | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntryView[]>([]);
  const [memoryChanges, setMemoryChanges] = useState<MemoryChangeView[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticView[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null);
  const [approvalItems, setApprovalItems] = useState<ApprovalItemView[]>([]);
  const [approvalPendingCount, setApprovalPendingCount] = useState(0);
  const [approvalHumanOnlyActions, setApprovalHumanOnlyActions] = useState<string[]>([]);
  const [approvalModes, setApprovalModes] = useState<ApprovalModeView[]>([
    'request',
    'delegate',
    'full',
    'custom',
  ]);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [approvalPolicies, setApprovalPolicies] = useState<ApprovalPolicyView[]>([]);
  const approvalLoadGateRef = useRef(createM2LoadRequestGate());
  const policyLoadGateRef = useRef(createM2LoadRequestGate());
  const planLoadGateRef = useRef(createM2LoadRequestGate());
  const graphLoadGateRef = useRef(createM2LoadRequestGate());
  const artifactLoadGateRef = useRef(createM2LoadRequestGate());
  const openTaskLoadGateRef = useRef(createM2LoadRequestGate());
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>('overview');
  const [planRevision, setPlanRevision] = useState<PlanRevision | null>(null);
  const [planRevisions, setPlanRevisions] = useState<PlanRevision[]>([]);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [runGraph, setRunGraph] = useState<RunGraphResponse | null>(null);
  const [selectedGraphStepId, setSelectedGraphStepId] = useState<string | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [artifactItems, setArtifactItems] = useState<ArtifactListItem[]>([]);
  const [artifactConflicts, setArtifactConflicts] = useState<ArtifactMergeConflictListItem[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactComparison, setArtifactComparison] = useState<ArtifactComparisonView | null>(null);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [selectedManifestId, setSelectedManifestId] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [m2RefreshNonce, setM2RefreshNonce] = useState(0);
  const m2RefreshTimerRef = useRef<number | null>(null);
  const [peekManifest, setPeekManifest] = useState<ManifestInspectView | null>(null);
  const [peekBusy, setPeekBusy] = useState(false);
  const [peekStatus, setPeekStatus] = useState<string | null>(null);
  const [activeExcludeSourceIds, setActiveExcludeSourceIds] = useState<string[]>([]);
  const [amendBusy, setAmendBusy] = useState(false);
  const [amendStatus, setAmendStatus] = useState<string | null>(null);

  const threadId = active?.threadId ?? FALLBACK_THREAD_ID;

  useEffect(() => {
    setSelectedManifestId(null);
    setSelectedTraceId(null);
    setPeekManifest(null);
    setPeekStatus(null);
    setActiveExcludeSourceIds([]);
    setAmendStatus(null);
  }, [threadId]);
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const activeTaskIdRef = useRef(active?.taskId ?? null);
  activeTaskIdRef.current = active?.taskId ?? null;

  const projection = useMemo(
    () => projectConversation(runtimeView.eventHistory, threadId, active?.taskId),
    [runtimeView.eventHistory, threadId, active?.taskId],
  );
  const m2Identity = useMemo(
    () => deriveM2WorkspaceIdentity(runtimeView.eventHistory, active?.taskId),
    [runtimeView.eventHistory, active?.taskId],
  );
  const agentVersionById = useMemo(
    () =>
      new Map(
        allAgentVersions.map((version) => [String(version.agentVersionId), version] as const),
      ),
    [allAgentVersions],
  );
  const fallbackConversationAgentIdentity = useMemo<ConversationAgentIdentity>(
    () => ({
      agentId: agentDefinition?.agentId ?? agentBinding?.agentId ?? selectedAgentId ?? undefined,
      name: agentDefinition?.name ?? agentBinding?.name ?? 'Agent',
      icon: agentDefinition?.visualIdentity?.icon ?? 'bot',
      color: agentDefinition?.visualIdentity?.color ?? '#64748b',
    }),
    [agentDefinition, agentBinding, selectedAgentId],
  );
  const conversationAgentIdentityByMessageId = useMemo(() => {
    const identities = new Map<string, ConversationAgentIdentity>();
    for (const message of projection.messages) {
      if (message.role !== 'assistant') continue;
      const exactVersion = message.agentVersionId
        ? agentVersionById.get(message.agentVersionId)
        : undefined;
      identities.set(
        message.id,
        exactVersion
          ? {
              agentId: String(exactVersion.agentId),
              name: exactVersion.name,
              icon: exactVersion.visualIdentity.icon,
              color: exactVersion.visualIdentity.color,
            }
          : fallbackConversationAgentIdentity,
      );
    }
    return identities;
  }, [projection.messages, agentVersionById, fallbackConversationAgentIdentity]);
  const delegateAgentVersions = useMemo(
    () =>
      allAgentVersions.filter(isApprovalDelegateAgentVersion).map((version) => ({
        id: String(version.agentVersionId),
        agentId: String(version.agentId),
        agentName: version.name,
        version: version.version,
      })),
    [allAgentVersions],
  );
  const automaticModeReadiness = useMemo(() => {
    const approvedPlan = hasApprovedPlanRevision(planRevisions);
    const applicablePolicy = Boolean(
      active &&
      approvalPolicies.some(
        (policy) =>
          (policy.scopeType === 'task' && policy.scopeId === active.taskId) ||
          ((policy.scopeType === 'workspace' || policy.scopeType === 'project') &&
            policy.scopeId === active.workspaceId) ||
          policy.scopeType === 'user',
      ),
    );
    return { approvedPlan, applicablePolicy };
  }, [active, approvalPolicies, planRevisions]);
  const visibleAutomaticRecovery = resolveVisibleAutomaticModeRecovery({
    hasActiveTask: Boolean(active),
    hasApprovedPlan: automaticModeReadiness.approvedPlan,
    hasPolicy: automaticModeReadiness.applicablePolicy,
    runtimeRecovery: automaticRecovery,
  });
  const isStreaming = projection.stream.state === 'streaming';

  useEffect(() => {
    approvalLoadGateRef.current.invalidate();
    policyLoadGateRef.current.invalidate();
    planLoadGateRef.current.invalidate();
    graphLoadGateRef.current.invalidate();
    artifactLoadGateRef.current.invalidate();
    openTaskLoadGateRef.current.invalidate();
    setApprovalItems([]);
    setApprovalPendingCount(0);
    setApprovalPolicies([]);
    setApprovalLoading(false);
    setPlanRevision(null);
    setPlanRevisions([]);
    setPlanError(null);
    setRunGraph(null);
    setSelectedGraphStepId(null);
    setGraphError(null);
    setArtifactItems([]);
    setArtifactConflicts([]);
    setSelectedArtifactId(null);
    setArtifactComparison(null);
    setArtifactError(null);
    setSelectedTraceId(null);
    setSelectedManifestId(null);
    setRightRailTab('overview');
    setAutomaticRecovery(null);
  }, [active?.taskId]);

  const PEEK_MANIFEST_ID = 'peek:live';

  const manifestInspectViews: ManifestInspectView[] = useMemo(() => {
    const fromEvents: ManifestInspectView[] = projection.manifests.map((m) => ({
      id: m.id,
      packetId: m.packetId,
      proofHash: m.proofHash,
      runId: m.runId,
      modelId: m.modelId,
      providerModelId: m.providerModelId,
      resolutionSource: m.resolutionSource,
      credentialResolutionSource: m.credentialResolutionSource,
      credentialRefId: m.credentialRefId,
      agentVersionId: m.agentVersionId,
      fallbackIndex: m.fallbackIndex,
      tokenEstimate: m.tokenEstimate,
      includedSourceIds: m.includedSourceIds,
      excludedSourceIds: m.excludedSourceIds,
      included: m.included,
      excluded: m.excluded,
      summaries: m.summaries,
      truncations: m.truncations,
      crossTaskRefs: m.crossTaskRefs,
      evidenceRefsForMemory: m.evidenceRefsForMemory,
      occurredAt: m.occurredAt,
    }));
    if (!peekManifest) return fromEvents;
    // Keep durable history, append live peek as newest inspectable entry.
    const withoutOldPeek = fromEvents.filter((m) => m.id !== PEEK_MANIFEST_ID);
    return [...withoutOldPeek, peekManifest];
  }, [projection.manifests, peekManifest]);

  const peekContextNow = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.peekContextPacket) {
      setPeekStatus('当前环境未连接 Runtime，无法预览上下文');
      return;
    }
    setPeekBusy(true);
    setPeekStatus(null);
    try {
      const result = await runtime.peekContextPacket({
        threadId: threadId as never,
        userText: '（预览：尚未发送的上下文）',
      });
      const view: ManifestInspectView = {
        id: PEEK_MANIFEST_ID,
        packetId: result.packetId,
        proofHash: result.proofHash,
        modelId: result.modelId,
        providerModelId: result.providerModelId,
        resolutionSource: result.resolutionSource,
        credentialResolutionSource: result.credentialResolutionSource,
        credentialRefId: result.credentialRefId,
        agentVersionId: result.agentVersionId,
        agentVersion: result.agentVersion,
        skillVersionIds: result.skillVersionIds,
        mcpServerIds: result.mcpServerIds,
        policyId: result.policyId,
        tokenEstimate: result.tokenEstimate,
        includedSourceIds: result.includedSourceIds,
        excludedSourceIds: result.excludedSourceIds,
        included: result.includedSources,
        excluded: result.excludedSources,
        summaries: result.summaries,
        truncations: result.truncations,
        crossTaskRefs: result.crossTaskRefs,
        evidenceRefsForMemory: result.evidenceRefsForMemory,
        occurredAt: result.peekedAt,
      };
      setPeekManifest(view);
      setSelectedManifestId(PEEK_MANIFEST_ID);
      const memCount = result.evidenceRefsForMemory?.length ?? 0;
      const skillN = result.skillVersionIds?.length ?? 0;
      const mcpN = result.mcpServerIds?.length ?? 0;
      const toolN = (result.includedSources ?? []).filter((s) => s.kind === 'tool-schema').length;
      const ver = result.agentVersion != null ? `agent v${result.agentVersion}` : 'agent';
      setPeekStatus(
        memCount > 0
          ? `预览完成 · ${ver} · skills ${skillN} · mcp ${mcpN}（入包 ${toolN}） · 记忆证据 ${memCount} · ~${result.tokenEstimate} tok`
          : `预览完成 · ${ver} · skills ${skillN} · mcp ${mcpN}（入包 ${toolN}） · ~${result.tokenEstimate} tok · 无项目记忆`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '预览上下文失败';
      setPeekStatus(message || '预览上下文失败');
    } finally {
      setPeekBusy(false);
    }
  }, [threadId]);

  const amendExcludeSource = useCallback(
    async (sourceId: string) => {
      const runtime = window.syncThink?.runtime;
      if (!runtime?.amendContextPacket) {
        setAmendStatus('当前环境未连接 Runtime，无法修订上下文');
        return;
      }
      setAmendBusy(true);
      setAmendStatus(null);
      try {
        const next = [...new Set([...activeExcludeSourceIds, sourceId])];
        const result = await runtime.amendContextPacket({
          threadId: threadId as never,
          excludeSourceIds: next,
        });
        setActiveExcludeSourceIds(result.excludeSourceIds ?? []);
        const refused = result.refusedProtectedIds ?? [];
        if (refused.length > 0) {
          setAmendStatus(
            `受保护来源不可排除 · ${refused.slice(0, 2).join(', ')}${refused.length > 2 ? '…' : ''}`,
          );
        } else {
          setAmendStatus(
            `已修订 · 强制排除 ${(result.excludeSourceIds ?? []).length} 项 · 请再点「预览上下文」`,
          );
        }
        // Auto re-peek so Manifest stays observable
        if (runtime.peekContextPacket) {
          try {
            const peek = await runtime.peekContextPacket({
              threadId: threadId as never,
              userText: '（预览：尚未发送的上下文）',
            });
            const view: ManifestInspectView = {
              id: PEEK_MANIFEST_ID,
              packetId: peek.packetId,
              proofHash: peek.proofHash,
              modelId: peek.modelId,
              providerModelId: peek.providerModelId,
              resolutionSource: peek.resolutionSource,
              credentialResolutionSource: peek.credentialResolutionSource,
              credentialRefId: peek.credentialRefId,
              agentVersionId: peek.agentVersionId,
              agentVersion: peek.agentVersion,
              skillVersionIds: peek.skillVersionIds,
              mcpServerIds: peek.mcpServerIds,
              policyId: peek.policyId,
              tokenEstimate: peek.tokenEstimate,
              includedSourceIds: peek.includedSourceIds,
              excludedSourceIds: peek.excludedSourceIds,
              included: peek.includedSources,
              excluded: peek.excludedSources,
              summaries: peek.summaries,
              truncations: peek.truncations,
              crossTaskRefs: peek.crossTaskRefs,
              evidenceRefsForMemory: peek.evidenceRefsForMemory,
              occurredAt: peek.peekedAt,
            };
            setPeekManifest(view);
            setSelectedManifestId(PEEK_MANIFEST_ID);
            setPeekStatus(
              `修订后预览 · ~${peek.tokenEstimate} tok · 排除 ${(result.excludeSourceIds ?? []).length}`,
            );
          } catch {
            /* peek is best-effort after amend */
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '修订上下文失败';
        setAmendStatus(message || '修订上下文失败');
      } finally {
        setAmendBusy(false);
      }
    },
    [activeExcludeSourceIds, threadId],
  );

  const clearContextAmendments = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.amendContextPacket) {
      setAmendStatus('当前环境未连接 Runtime，无法清除修订');
      return;
    }
    setAmendBusy(true);
    setAmendStatus(null);
    try {
      const result = await runtime.amendContextPacket({
        threadId: threadId as never,
        clearAll: true,
      });
      setActiveExcludeSourceIds(result.excludeSourceIds ?? []);
      setAmendStatus('已恢复自动选择');
      if (runtime.peekContextPacket) {
        try {
          const peek = await runtime.peekContextPacket({
            threadId: threadId as never,
            userText: '（预览：尚未发送的上下文）',
          });
          const view: ManifestInspectView = {
            id: PEEK_MANIFEST_ID,
            packetId: peek.packetId,
            proofHash: peek.proofHash,
            modelId: peek.modelId,
            providerModelId: peek.providerModelId,
            resolutionSource: peek.resolutionSource,
            credentialResolutionSource: peek.credentialResolutionSource,
            credentialRefId: peek.credentialRefId,
            agentVersionId: peek.agentVersionId,
            agentVersion: peek.agentVersion,
            skillVersionIds: peek.skillVersionIds,
            mcpServerIds: peek.mcpServerIds,
            policyId: peek.policyId,
            tokenEstimate: peek.tokenEstimate,
            includedSourceIds: peek.includedSourceIds,
            excludedSourceIds: peek.excludedSourceIds,
            included: peek.includedSources,
            excluded: peek.excludedSources,
            summaries: peek.summaries,
            truncations: peek.truncations,
            crossTaskRefs: peek.crossTaskRefs,
            evidenceRefsForMemory: peek.evidenceRefsForMemory,
            occurredAt: peek.peekedAt,
          };
          setPeekManifest(view);
          setSelectedManifestId(PEEK_MANIFEST_ID);
          setPeekStatus(`已恢复 · ~${peek.tokenEstimate} tok`);
        } catch {
          /* ignore */
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '清除修订失败';
      setAmendStatus(message || '清除修订失败');
    } finally {
      setAmendBusy(false);
    }
  }, [threadId]);

  const handleTraceSelect = useCallback(
    (id: string | null) => {
      setSelectedTraceId(id);
      if (id !== null && projection.manifests.some((manifest) => manifest.id === id)) {
        setSelectedManifestId(id);
      }
    },
    [projection.manifests],
  );

  const handleManifestSelect = useCallback(
    (id: string | null) => {
      setSelectedManifestId(id);
      if (id !== null && projection.manifests.some((manifest) => manifest.id === id)) {
        setSelectedTraceId(id);
      }
    },
    [projection.manifests],
  );

  const composeModels: ComposeModelOption[] = useMemo(
    () => buildComposeModelOptions(providers),
    [providers],
  );
  const agentDefaultModelLabel = resolveAgentDefaultModelLabel(
    agentBinding?.defaultModelId,
    composeModels,
  );
  const m1SessionReadiness = useMemo(
    () =>
      projectM1SessionReadiness({
        connectionState: runtimeView.connectionState,
        providers,
        manifestCount: manifestInspectViews.length,
        theme,
        traceCollapsed,
        hasActiveTask: Boolean(active),
        conversationLayout,
        agentDefaultModelId: agentBinding?.defaultModelId ?? null,
        agentFallbackCount: agentBinding?.fallbackModelIds?.length ?? 0,
        agentSkillBound: agentBinding?.skillVersionIds?.length ?? 0,
        agentMcpBound: agentBinding?.mcpServerIds?.length ?? 0,
        approvalPendingCount,
        memoryEntryCount: memoryEntries.filter((e) => e.active).length,
        memoryPendingCount: memoryChanges.filter((c) => c.approvalState === 'pending').length,
        memoryDiagCount: diagnostics.length,
      }),
    [
      runtimeView.connectionState,
      providers,
      manifestInspectViews.length,
      theme,
      traceCollapsed,
      active,
      conversationLayout,
      agentBinding?.defaultModelId,
      agentBinding?.fallbackModelIds,
      agentBinding?.skillVersionIds,
      agentBinding?.mcpServerIds,
      approvalPendingCount,
      memoryEntries,
      memoryChanges,
      diagnostics,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const api = window.syncThink?.runtime?.getM1ExitEvidence;
        if (!api) {
          if (!cancelled) {
            setExitEvidenceRaw({
              handtestChecked: 0,
              handtestTotal: 0,
              handtestBoxes: [],
              dogfoodFileCount: 0,
              dogfoodRealDays: 0,
              dogfoodDays: [],
              dualAutomatedOk: true,
              loadNote: '当前壳未暴露退出证据读取（需 desktop IPC）',
              ok: false,
            });
          }
          return;
        }
        const res = await api();
        if (cancelled) return;
        setExitEvidenceRaw({
          handtestChecked: res.handtestChecked ?? 0,
          handtestTotal: res.handtestTotal ?? 0,
          handtestBoxes: Array.isArray(res.handtestBoxes)
            ? (res.handtestBoxes as HandtestDocBox[])
            : [],
          dogfoodFileCount: res.dogfoodFileCount ?? 0,
          dogfoodRealDays: res.dogfoodRealDays ?? 0,
          dogfoodDays: Array.isArray(res.dogfoodDays) ? res.dogfoodDays : [],
          dualAutomatedOk: res.dualAutomatedOk !== false,
          loadNote: res.loadNote ?? null,
          ok: Boolean(res.ok),
        });
      } catch {
        if (!cancelled) {
          setExitEvidenceRaw({
            handtestChecked: 0,
            handtestTotal: 0,
            handtestBoxes: [],
            dogfoodFileCount: 0,
            dogfoodRealDays: 0,
            dogfoodDays: [],
            dualAutomatedOk: true,
            loadNote: '读取退出证据文档失败',
            ok: false,
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [exitEvidenceTick]);
  // soft #39: when window regains focus, re-read handtest/dogfood docs (m1-exit-focus-refresh)
  useEffect(() => {
    const onFocus = () => {
      setExitEvidenceTick((n) => n + 1);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const m1ExitEvidence: M1ExitEvidenceProgress = useMemo(
    () =>
      projectM1ExitEvidenceProgress({
        handtestChecked: exitEvidenceRaw?.handtestChecked ?? 0,
        handtestTotal: exitEvidenceRaw?.handtestTotal ?? 0,
        dogfoodFileCount: exitEvidenceRaw?.dogfoodFileCount ?? 0,
        dogfoodRealDays: exitEvidenceRaw?.dogfoodRealDays ?? 0,
        dogfoodDays: exitEvidenceRaw?.dogfoodDays ?? [],
        sessionLevel: m1SessionReadiness.level,
        dualAutomatedOk: exitEvidenceRaw?.dualAutomatedOk ?? true,
        loadNote: exitEvidenceRaw?.loadNote ?? null,
      }),
    [exitEvidenceRaw, m1SessionReadiness.level],
  );

  const distinctMessageModelCount = useMemo(() => {
    const ids = new Set<string>();
    for (const m of projection.messages) {
      const mid = m.modelId;
      if (mid && String(mid).trim()) ids.add(String(mid).trim());
    }
    const streamModel = projection.stream.modelId;
    if (streamModel && String(streamModel).trim()) ids.add(String(streamModel).trim());
    return ids.size;
  }, [projection.messages, projection.stream.modelId]);

  const m1HandtestChecklist: M1HandtestChecklist = useMemo(() => {
    const providerCount = m1SessionReadiness.providerCount;
    const modelCount = m1SessionReadiness.modelCount;
    const secretCount = m1SessionReadiness.secretCount;
    return projectM1HandtestChecklist({
      connectionOnline: runtimeView.connectionState === 'online',
      hasActiveTask: Boolean(active),
      providerCount,
      modelCount,
      secretCount,
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      composeStructurallyReady:
        runtimeView.connectionState === 'online' && Boolean(active) && modelCount > 0,
      hasTraceEvents: projection.trace.length > 0,
      manifestCount: manifestInspectViews.length,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      agentFallbackCount: agentBinding?.fallbackModelIds?.length ?? 0,
      distinctMessageModelCount,
      dualAutomatedOk: exitEvidenceRaw?.dualAutomatedOk ?? true,
      knownLimitsVisible: true,
      docChecked: exitEvidenceRaw?.handtestChecked ?? 0,
      docTotal: exitEvidenceRaw?.handtestTotal ?? 18,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
    });
  }, [
    m1SessionReadiness.providerCount,
    m1SessionReadiness.modelCount,
    m1SessionReadiness.secretCount,
    m1SessionReadiness.providersOk,
    m1SessionReadiness.modelsOk,
    runtimeView.connectionState,
    active,
    projection.trace.length,
    manifestInspectViews.length,
    agentBinding?.defaultModelId,
    agentBinding?.fallbackModelIds,
    distinctMessageModelCount,
    exitEvidenceRaw?.dualAutomatedOk,
    exitEvidenceRaw?.handtestChecked,
    exitEvidenceRaw?.handtestTotal,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
  ]);

  const m1CurrentMilestoneCopy = useMemo(
    () =>
      projectM1CurrentMilestoneCopy({
        handtestChecked: m1ExitEvidence.handtestChecked,
        handtestTotal: m1ExitEvidence.handtestTotal,
        dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
        dogfoodRequired: m1ExitEvidence.dogfoodRequired,
        m2Complete: true,
      }),
    [
      m1ExitEvidence.handtestChecked,
      m1ExitEvidence.handtestTotal,
      m1ExitEvidence.dogfoodRealDays,
      m1ExitEvidence.dogfoodRequired,
    ],
  );

  const m1HandtestDocMap = useMemo(() => {
    const boxes = exitEvidenceRaw?.handtestBoxes ?? [];
    return mapHandtestDocBoxesToItems(
      boxes,
      m1HandtestChecklist.items.map((it) => ({
        id: it.id,
        label: it.label,
        section: it.section,
      })),
    );
  }, [exitEvidenceRaw?.handtestBoxes, m1HandtestChecklist.items]);

  const m1HandtestDocMapById = useMemo(() => {
    const m = new Map<string, (typeof m1HandtestDocMap)[number]>();
    for (const e of m1HandtestDocMap) m.set(e.itemId, e);
    return m;
  }, [m1HandtestDocMap]);

  const m1HandtestDocDiff: M1HandtestDocDiffBoard = useMemo(() => {
    return projectM1HandtestDocDiff(
      m1HandtestChecklist.items.map((it) => {
        const entry = m1HandtestDocMapById.get(it.id);
        return {
          id: it.id,
          label: it.label,
          section: it.section,
          status: it.status,
          gate: it.gate,
          docChecked: entry && entry.docChecked != null ? entry.docChecked : null,
        };
      }),
    );
  }, [m1HandtestChecklist.items, m1HandtestDocMapById]);

  const m1HandtestDocDiffAttention = useMemo(
    () => listM1HandtestDocDiffAttention(m1HandtestDocDiff),
    [m1HandtestDocDiff],
  );

  const m1DogfoodFillBoard: M1DogfoodFillBoard = useMemo(() => {
    return projectM1DogfoodFillBoard({
      days: m1ExitEvidence.dogfoodDays,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      softCraftRound: 65,
    });
  }, [
    m1ExitEvidence.dogfoodDays,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodFileCount,
    m1ExitEvidence.dogfoodRequired,
  ]);

  const m1HandtestSectionBoard: M1HandtestSectionBoard = useMemo(
    () => projectM1HandtestSectionBoard(m1HandtestChecklist.items),
    [m1HandtestChecklist.items],
  );

  const m1ExternalFocus: M1ExternalFocusBoard = useMemo(
    () =>
      projectM1ExternalFocusFromChecklist(m1HandtestChecklist.items, {
        handtestDocChecked: m1HandtestChecklist.docChecked,
        handtestDocTotal: m1HandtestChecklist.docTotal,
        softCraftRound: 65,
        sections: m1HandtestSectionBoard.sections,
        dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
        dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      }),
    [
      m1HandtestChecklist.items,
      m1HandtestChecklist.docChecked,
      m1HandtestChecklist.docTotal,
      m1HandtestSectionBoard.sections,
      m1ExitEvidence.dogfoodRealDays,
      m1ExitEvidence.dogfoodRequired,
    ],
  );

  const m1HandtestFilteredItems = useMemo(
    () => filterM1HandtestItems(m1HandtestChecklist.items, handtestListFilter),
    [m1HandtestChecklist.items, handtestListFilter],
  );

  const m1HandtestFilterCounts = useMemo(
    () => ({
      all: countM1HandtestFilter(m1HandtestChecklist.items, 'all'),
      gaps: countM1HandtestFilter(m1HandtestChecklist.items, 'gaps'),
      external: countM1HandtestFilter(m1HandtestChecklist.items, 'external'),
    }),
    [m1HandtestChecklist.items],
  );

  const m1NextAction: M1NextAction = useMemo(
    () =>
      projectM1NextAction({
        connectionOnline: runtimeView.connectionState === 'online',
        hasActiveTask: Boolean(active),
        providerCount: m1SessionReadiness.providerCount,
        modelCount: m1SessionReadiness.modelCount,
        secretCount: m1SessionReadiness.secretCount,
        providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
        agentDefaultSet: Boolean(agentBinding?.defaultModelId),
        sessionLevel: m1SessionReadiness.level,
        handtestLivePass: m1HandtestChecklist.livePass,
        handtestLiveTotal: m1HandtestChecklist.liveTotal,
        handtestSoftLiveAllPass: m1HandtestChecklist.softLiveAllPass,
        handtestExternalPending: m1HandtestChecklist.externalPending,
        handtestDocChecked: m1HandtestChecklist.docChecked,
        handtestDocTotal: m1HandtestChecklist.docTotal,
        dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
        dogfoodRequired: m1ExitEvidence.dogfoodRequired,
        dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
        dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
        hardGatesMet: m1ExitEvidence.hardGatesMet,
        dogfoodFillLevel: m1DogfoodFillBoard.level,
        dogfoodDraftDays: m1DogfoodFillBoard.draftDays,
        dogfoodScaffoldDays: m1DogfoodFillBoard.scaffoldDays,
        dogfoodMissingCount: m1DogfoodFillBoard.missingSlots.length,
        dogfoodFillPrimaryAction: m1DogfoodFillBoard.primaryCta.action,
        externalFocusId: m1ExternalFocus.focus?.id ?? null,
        externalFocusLabel: m1ExternalFocus.focus?.label ?? null,
        externalFocusSection: m1ExternalFocus.focus?.sectionLabel ?? null,
        externalFocusJumpTarget: m1ExternalFocus.focus?.jumpTarget ?? null,
        externalFocusJumpable: Boolean(m1ExternalFocus.focus?.jumpable),
        externalFocusPending: m1ExternalFocus.externalPending,
        exitLevel: m1ExitEvidence.level,
      }),
    [
      runtimeView.connectionState,
      active,
      m1SessionReadiness.providerCount,
      m1SessionReadiness.modelCount,
      m1SessionReadiness.secretCount,
      m1SessionReadiness.providersOk,
      m1SessionReadiness.modelsOk,
      m1SessionReadiness.level,
      agentBinding?.defaultModelId,
      m1HandtestChecklist.livePass,
      m1HandtestChecklist.liveTotal,
      m1HandtestChecklist.softLiveAllPass,
      m1HandtestChecklist.externalPending,
      m1HandtestChecklist.docChecked,
      m1HandtestChecklist.docTotal,
      m1ExitEvidence.dogfoodRealDays,
      m1ExitEvidence.dogfoodRequired,
      m1ExitEvidence.dogfoodFileCount,
      m1ExitEvidence.dualAutomatedOk,
      m1ExitEvidence.hardGatesMet,
      m1ExitEvidence.level,
      m1DogfoodFillBoard.level,
      m1DogfoodFillBoard.draftDays,
      m1DogfoodFillBoard.scaffoldDays,
      m1DogfoodFillBoard.missingSlots.length,
      m1DogfoodFillBoard.primaryCta.action,
      m1ExternalFocus.focus?.id,
      m1ExternalFocus.focus?.label,
      m1ExternalFocus.focus?.sectionLabel,
      m1ExternalFocus.focus?.jumpTarget,
      m1ExternalFocus.focus?.jumpable,
      m1ExternalFocus.externalPending,
    ],
  );

  const m1HardgateStrip: M1HardgateStrip = useMemo(
    () =>
      projectM1HardgateStrip({
        handtestChecked: m1HandtestChecklist.docChecked,
        handtestTotal: m1HandtestChecklist.docTotal,
        dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
        dogfoodRequired: m1ExitEvidence.dogfoodRequired,
        dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
        dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
        hardGatesMet: m1ExitEvidence.hardGatesMet,
        exitLevel: m1ExitEvidence.level,
        externalPending: m1ExternalFocus.externalPending,
        softCraftRound: 65,
      }),
    [
      m1HandtestChecklist.docChecked,
      m1HandtestChecklist.docTotal,
      m1ExitEvidence.dogfoodRealDays,
      m1ExitEvidence.dogfoodRequired,
      m1ExitEvidence.dogfoodFileCount,
      m1ExitEvidence.dualAutomatedOk,
      m1ExitEvidence.hardGatesMet,
      m1ExitEvidence.level,
      m1ExternalFocus.externalPending,
    ],
  );

  const leftInstrumentSwitch = useMemo(
    () =>
      projectLeftInstrumentSwitch({
        active: leftInstrument,
        providerCount: providers.length,
        skillCount: skills.length,
        memoryPending:
          memoryChanges.filter((c) => (c as { status?: string }).status === 'pending').length ||
          memoryEntries.length,
        approvalPending: approvalPendingCount,
        softCraftRound: 65,
      }),
    [
      leftInstrument,
      providers.length,
      skills.length,
      memoryChanges,
      memoryEntries.length,
      approvalPendingCount,
    ],
  );

  const conversationStreamReadiness = useMemo(
    () =>
      projectConversationStreamReadiness({
        connectionState: runtimeView.connectionState,
        streamState: projection.stream.state,
        hasActiveTask: Boolean(active),
        messageCount: projection.messages.length,
        previewCount: previewMessages.length,
        eventHistoryCount: runtimeView.eventHistory.length,
        modelId: projection.stream.modelId ?? null,
        notice: projection.stream.notice ?? null,
        errorSummary: projection.stream.errorSummary ?? null,
        modelOptionCount: composeModels.length,
        multiProvider: new Set(composeModels.map((m) => m.providerName).filter(Boolean)).size > 1,
        connectFailureCode: runtimeView.lastConnectFailure?.code ?? null,
        connectRetryable: runtimeView.lastConnectFailure?.retryable ?? null,
      }),
    [
      runtimeView.connectionState,
      runtimeView.eventHistory.length,
      runtimeView.lastConnectFailure,
      projection.stream.state,
      projection.stream.modelId,
      projection.stream.notice,
      projection.stream.errorSummary,
      projection.messages.length,
      previewMessages.length,
      active,
      composeModels,
    ],
  );

  const agentModels: AgentBindingModelOption[] = useMemo(
    () =>
      composeModels.map((m) => ({
        modelId: m.modelId,
        label: m.label,
        providerName: m.providerName,
        providerId: m.providerId,
        providerModelId: m.providerModelId,
        surface: m.surface,
        protocol: m.protocol,
      })),
    [composeModels],
  );

  const agentCredentials: AgentBindingCredentialOption[] = useMemo(
    () =>
      providers.flatMap((provider) =>
        (provider.credentials ?? []).map((credential) => ({
          credentialRefId: credential.credentialRefId,
          credentialGroupId:
            (credential as { credentialGroupId?: string }).credentialGroupId ??
            'credential-group-unassigned',
          groupName: credential.groupName,
          label: credential.label,
          providerName: provider.name,
          kind: credential.kind,
        })),
      ),
    [providers],
  );
  const safeSelectedModelId = useMemo(
    () => sanitizeSelectedModelId(selectedModelId, composeModels),
    [selectedModelId, composeModels],
  );

  const applySelection = useCallback(
    (selection: ActiveTaskSelection | null, options?: { syncTaskVersion?: boolean }) => {
      approvalLoadGateRef.current.invalidate();
      policyLoadGateRef.current.invalidate();
      planLoadGateRef.current.invalidate();
      graphLoadGateRef.current.invalidate();
      artifactLoadGateRef.current.invalidate();
      openTaskLoadGateRef.current.invalidate();
      setActive(selection);
      if (selection && options?.syncTaskVersion !== false) {
        dispatchRuntimeView({
          type: 'append-succeeded',
          taskVersion: selection.taskVersion,
        });
      }
    },
    [],
  );

  const loadWorkspaceCatalog = useCallback(
    async (preferredTaskId?: string | null) => {
      const runtime = window.syncThink?.runtime;
      if (!runtime?.listWorkspaces || !runtime.listTasks) return;
      setWorkspaceLoading(true);
      setWorkspaceError(null);
      try {
        const listed = await runtime.listWorkspaces({});
        const nextWorkspaces = listed.workspaces;
        const entries: Array<[string, TaskSummary[]]> = [];
        for (const workspace of nextWorkspaces) {
          const listedTasks = await runtime.listTasks({ workspaceId: workspace.workspaceId });
          entries.push([workspace.workspaceId, listedTasks.tasks]);
        }
        const nextMap = new Map(entries);
        setWorkspaces(nextWorkspaces);
        setTasksByWorkspace(nextMap);
        const selection = resolvePreferredTask(nextWorkspaces, nextMap, preferredTaskId);
        applySelection(selection);
      } catch {
        setWorkspaceError('工作区加载失败');
      } finally {
        setWorkspaceLoading(false);
      }
    },
    [applySelection],
  );

  const loadProviders = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listProviders) return;
    setProviderLoading(true);
    setProviderError(null);
    try {
      const listed = await runtime.listProviders({});
      setProviders(listed.providers.map(toProviderPanelItem));
    } catch {
      setProviderError('Provider 列表加载失败');
    } finally {
      setProviderLoading(false);
    }
  }, [
    m1DogfoodFillBoard.level,
    m1DogfoodFillBoard.draftDays,
    m1DogfoodFillBoard.scaffoldDays,
    m1DogfoodFillBoard.missingSlots.length,
    m1DogfoodFillBoard.primaryCta.action,
  ]);

  const loadSkills = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listSkills) return;
    try {
      const result = await runtime.listSkills({});
      setSkills(result.skills.map(toSkillOption));
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载 Skills 失败';
      setSkillError(message || '加载 Skills 失败');
    }
  }, []);

  const loadMcpServers = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listMcpServers) return;
    try {
      const result = await runtime.listMcpServers({});
      setMcpServers(result.servers.map(toMcpOption));
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载 MCP 失败';
      setMcpError(message || '加载 MCP 失败');
    }
  }, []);

  const loadAgent = useCallback(async (preferredAgentId?: string) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getAgent || !runtime.listAgents || !runtime.listAgentVersions) return;
    const requestId = ++agentLoadRequestRef.current;
    setAgentLoading(true);
    setAgentError(null);
    try {
      const listResult = await runtime.listAgents({});
      if (requestId !== agentLoadRequestRef.current) return;
      const requestedAgentId = preferredAgentId ?? selectedAgentIdRef.current;
      const selected =
        listResult.agents.find((agent) => String(agent.agentId) === requestedAgentId) ??
        listResult.agents[0] ??
        null;
      if (!selected) {
        selectedAgentIdRef.current = null;
        setSelectedAgentId(null);
        setAgents([]);
        setAgentBinding(null);
        setAgentDefinition(null);
        setAgentVersions([]);
        setAllAgentVersions([]);
        return;
      }

      const agentId = String(selected.agentId);
      const allVersionsPromise = Promise.all(
        listResult.agents.map((agent) => runtime.listAgentVersions({ agentId: agent.agentId })),
      );
      const [bindingResult, allVersionResults] = await Promise.all([
        runtime.getAgent({ agentId: selected.agentId }),
        allVersionsPromise,
      ]);
      if (requestId !== agentLoadRequestRef.current) return;
      const exactAgentVersions = allVersionResults.flatMap((result) => result.versions);
      const selectedVersions = exactAgentVersions.filter(
        (version) => String(version.agentId) === agentId,
      );
      const projected = projectAgentWorkspace(listResult.agents, agentId, selectedVersions);
      selectedAgentIdRef.current = projected.selectedAgentId;
      setSelectedAgentId(projected.selectedAgentId);
      setAgents(projected.agents);
      setAgentBinding(toAgentBindingView(bindingResult.agent));
      setAgentDefinition(projected.definition);
      setAgentVersions(projected.versions);
      setAllAgentVersions(exactAgentVersions);
    } catch (error) {
      if (requestId !== agentLoadRequestRef.current) return;
      const message = error instanceof Error ? error.message : 'Agent 加载失败';
      setAgentError(message || 'Agent 加载失败');
    } finally {
      if (requestId === agentLoadRequestRef.current) setAgentLoading(false);
    }
  }, []);

  const selectAgent = (agentId: string) => {
    selectedAgentIdRef.current = agentId;
    setSelectedAgentId(agentId);
    setAgentBinding(null);
    setAgentDefinition(null);
    setAgentVersions([]);
    setAgentLoading(true);
    void loadAgent(agentId);
  };

  const saveAgentBinding = async (input: AgentBindingSaveInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.updateAgentBinding) {
      setAgentError('当前环境未连接 Runtime，无法保存 Agent 绑定');
      return;
    }
    const binding = agentBinding;
    const selectedAgentId = selectedAgentIdRef.current;
    const bindingMatchesSelection = binding ? binding.agentId === selectedAgentId : false;
    if (
      !binding ||
      !selectedAgentId ||
      !canSaveAgentBindingForSelection(binding, selectedAgentId) ||
      !bindingMatchesSelection
    ) {
      setAgentError('智能体选择已变化，请等待当前绑定加载后再保存');
      return;
    }
    setAgentBusy(true);
    setAgentError(null);
    setAgentStatus(null);
    try {
      const result = await runtime.updateAgentBinding({
        agentId: selectedAgentId as never,
        defaultModelId: input.defaultModelId as never,
        fallbackModelIds: input.fallbackModelIds as never,
        pauseOnFailure: input.pauseOnFailure,
        defaultCredentialGroupId: input.defaultCredentialGroupId as never,
        pinnedCredentialRefId: input.pinnedCredentialRefId as never,
        skillVersionIds: input.skillVersionIds,
        mcpServerIds: input.mcpServerIds,
      });
      setAgentBinding(toAgentBindingView(result.agent));
      const skillN = result.agent.skillVersionIds?.length ?? 0;
      const mcpN = result.agent.mcpServerIds?.length ?? 0;
      setAgentStatus(
        `已保存 · v${result.agent.version} · fallback ${result.agent.fallbackModelIds.length} · skills ${skillN} · mcp ${mcpN} · 凭证组 ${result.agent.defaultCredentialGroupId && result.agent.defaultCredentialGroupId !== 'credential-group-unassigned' ? '已绑' : '未绑'}${result.agent.pinnedCredentialRefId ? ' · 已固定密钥' : ''}`,
      );
      await loadAgent(String(result.agent.agentId));
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存 Agent 绑定失败';
      setAgentError(message || '保存 Agent 绑定失败');
      setAgentStatus(null);
    } finally {
      setAgentBusy(false);
    }
  };

  const saveAgentDefinition = async (input: AgentDefinitionSaveInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.createAgentVersion || !agentBinding) {
      setAgentError('当前环境未连接 Runtime，无法保存智能体版本');
      return;
    }
    const selectedAgentId = selectedAgentIdRef.current;
    if (
      !selectedAgentId ||
      input.agentId !== agentBinding.agentId ||
      agentBinding.agentId !== selectedAgentId ||
      !canSaveAgentBindingForSelection(agentBinding, selectedAgentId)
    ) {
      setAgentError('智能体选择已变化，请重新打开后再保存');
      return;
    }
    setAgentBusy(true);
    setAgentError(null);
    setAgentStatus(null);
    try {
      const result = await runtime.createAgentVersion(
        buildAgentVersionPayload(input, agentBinding),
      );
      setAgentBinding(toAgentBindingView(result.agent));
      await loadAgent(String(result.agent.agentId));
      setAgentStatus(`已保存 ${result.agent.name} · v${result.agent.version}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存智能体版本失败';
      setAgentError(message || '保存智能体版本失败');
    } finally {
      setAgentBusy(false);
    }
  };

  const createAgent = async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.createAgent || !agentBinding) {
      setAgentError('请先连接 Runtime 并配置一个可用的智能体运行时');
      return;
    }
    const name = window.prompt('智能体名称', '新智能体')?.trim();
    if (!name) return;
    const role = window.prompt('智能体角色', 'specialist')?.trim();
    if (!role) return;

    setAgentBusy(true);
    setAgentError(null);
    setAgentStatus(null);
    try {
      const result = await runtime.createAgent(
        buildAgentCreatePayload({ name, role }, agentBinding),
      );
      const agentId = String(result.agent.agentId);
      selectedAgentIdRef.current = agentId;
      setSelectedAgentId(agentId);
      await loadAgent(agentId);
      setAgentStatus(`已新建 ${result.agent.name} · v${result.agent.version}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '新建智能体失败';
      setAgentError(message || '新建智能体失败');
    } finally {
      setAgentBusy(false);
    }
  };

  const importSkill = async (skillMd: string) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.importSkill) {
      setSkillError('当前环境未连接 Runtime，无法导入 Skill');
      setLeftInstrument('agent');
      return;
    }
    const raw = String(skillMd ?? '');
    const trimmed = raw.trim();
    if (!trimmed) {
      setSkillError('SKILL.md 为空 · 请粘贴完整文件（含 YAML frontmatter）');
      setLeftInstrument('agent');
      return;
    }
    if (!trimmed.startsWith('---')) {
      setSkillError(
        '格式不对：必须以 --- 开头的 YAML frontmatter（点「填入示例」）。纯中文说明或没有 name 会导入失败。',
      );
      setLeftInstrument('agent');
      return;
    }
    const fenceMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
    if (!fenceMatch) {
      setSkillError(
        '找不到闭合的 --- frontmatter · 结构：\n---\nname: my-skill\nversion: 0.1.0\n---\n正文…',
      );
      setLeftInstrument('agent');
      return;
    }
    const fmBlock = fenceMatch[1] ?? '';
    const nameLine = fmBlock
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /^name\s*:/i.test(l));
    const nameVal = nameLine
      ? nameLine
          .replace(/^name\s*:\s*/i, '')
          .replace(/^["']|["']$/g, '')
          .trim()
      : '';
    if (!nameVal) {
      setSkillError('frontmatter 缺少 name · 至少写 name: my-skill');
      setLeftInstrument('agent');
      return;
    }
    if (/\.\.|\\/.test(fmBlock) || /references\s*:\s*.*\.\./i.test(trimmed)) {
      setSkillError('安全拒绝：references / 路径含 .. 或反斜杠（防目录穿越）');
      setLeftInstrument('agent');
      return;
    }
    setSkillBusy(true);
    setSkillError(null);
    setSkillStatus('解析 SKILL.md（不执行脚本）…');
    setLeftInstrument('agent');
    try {
      const result = await runtime.importSkill({ skillMd: raw });
      const diff = result.permissionDiff;
      const reapproval = diff
        ? ' · ' +
          diff.label +
          (diff.requiresReapproval && diff.addedTools?.length
            ? ' · +' + diff.addedTools.join(',')
            : '')
        : '';
      const queued = result.reapprovalRequest?.id
        ? ' · 已入队审批 · ' + result.reapprovalRequest.id.slice(0, 8)
        : '';
      setSkillStatus(
        result.deduped
          ? '已存在 · ' +
              result.skill.name +
              ' v' +
              result.skill.version +
              ' · fp ' +
              result.skill.contentFingerprint +
              reapproval +
              queued
          : '已导入 · ' +
              result.skill.name +
              ' v' +
              result.skill.version +
              (result.skill.hasScripts ? ' · scripts 仅记录' : '') +
              ' · fp ' +
              result.skill.contentFingerprint +
              reapproval +
              queued,
      );
      if (result.reapprovalRequest) {
        setApprovalStatus(
          'Skill 升级已入队审批 · ' +
            result.skill.name +
            '@' +
            result.skill.version +
            ' · ' +
            result.reapprovalRequest.id.slice(0, 8),
        );
        await loadApprovals();
      }
      await loadSkills();
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : '导入 Skill 失败';
      let message = rawMsg || '导入 Skill 失败';
      if (/missing_frontmatter|must start with YAML|empty/i.test(rawMsg)) {
        message = '解析失败：缺少 YAML frontmatter · 请用 --- / name / --- 结构（点「填入示例」）';
      } else if (/missing_name|name is required/i.test(rawMsg)) {
        message = '解析失败：frontmatter 需要 name 字段';
      } else if (/path_traversal|traversal/i.test(rawMsg)) {
        message = '安全拒绝：路径穿越（references 不可含 ..）';
      } else if (/not connected|Runtime|ECONN|pipe/i.test(rawMsg)) {
        message = 'Runtime 未连接或通信失败 · 先看连接状态：' + rawMsg;
      }
      setSkillError(message);
      setSkillStatus(null);
      setLeftInstrument('agent');
    } finally {
      setSkillBusy(false);
    }
  };

  const registerMcp = async (input: {
    name: string;
    transport?: string;
    endpoint?: string;
    toolsJson?: string;
    trusted?: boolean;
    maxOutputBytes?: number;
    timeoutMs?: number;
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.registerMcpServer) {
      setMcpError('当前环境未连接 Runtime，无法登记 MCP');
      return;
    }
    setMcpBusy(true);
    setMcpError(null);
    setMcpStatus('登记 MCP 元数据（不启动进程、不执行工具）…');
    try {
      const tools = parseMcpToolsDraft(input.toolsJson);
      const result = await runtime.registerMcpServer({
        name: input.name,
        transport: input.transport,
        endpoint: input.endpoint,
        tools,
        trusted: input.trusted,
        maxOutputBytes: input.maxOutputBytes,
        timeoutMs: input.timeoutMs,
      });
      const toolN = result.server.tools?.length ?? 0;
      const policy = formatMcpPolicyLabelLocal(
        result.server.timeoutMs,
        result.server.maxOutputBytes,
        result.server.trusted,
      );
      setMcpStatus(
        result.updated
          ? `已更新 · ${result.server.name} · tools ${toolN} · ${policy} · id ${result.server.mcpServerId.slice(0, 12)}`
          : `已登记 · ${result.server.name} · tools ${toolN} · ${policy} · id ${result.server.mcpServerId.slice(0, 12)}（未入白名单）`,
      );
      await loadMcpServers();
    } catch (error) {
      const message = error instanceof Error ? error.message : '登记 MCP 失败';
      setMcpError(message || '登记 MCP 失败');
      setMcpStatus(null);
    } finally {
      setMcpBusy(false);
    }
  };

  const probeMcpPolicy = async (input: {
    mcpServerId?: string;
    maxOutputBytes?: number;
    timeoutMs?: number;
    trusted?: boolean;
    simulatedOutput?: string;
    simulatedElapsedMs?: number;
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.probeMcpPolicy) {
      setMcpError('当前环境未连接 Runtime，无法探测 MCP 策略');
      return;
    }
    setMcpProbeBusy(true);
    setMcpError(null);
    setMcpStatus('探测 MCP 策略（模拟输出 · 不启动进程）…');
    try {
      const result = await runtime.probeMcpPolicy({
        mcpServerId: input.mcpServerId,
        maxOutputBytes: input.maxOutputBytes,
        timeoutMs: input.timeoutMs,
        trusted: input.trusted,
        simulatedOutput: input.simulatedOutput,
        simulatedElapsedMs: input.simulatedElapsedMs,
        toolName: 'ui-probe',
      });
      const flags = [
        result.ok ? 'ok' : 'fail',
        result.truncated ? 'truncated' : 'full',
        result.timedOut ? 'timeout' : null,
        result.contentTrust,
      ]
        .filter(Boolean)
        .join(' · ');
      setMcpStatus(
        `策略探测 · ${flags} · ${result.policyLabel} · raw ${result.rawBytes}B → kept ${result.keptBytes}B · ${result.auditNote}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP 策略探测失败';
      setMcpError(message || 'MCP 策略探测失败');
      setMcpStatus(null);
    } finally {
      setMcpProbeBusy(false);
    }
  };

  const probeMcpSpawn = async (input: {
    mcpServerId?: string;
    endpoint?: string;
    maxOutputBytes?: number;
    timeoutMs?: number;
    trusted?: boolean;
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.probeMcpSpawn) {
      setMcpError('当前环境未连接 Runtime，无法真 spawn 探测');
      return;
    }
    setMcpSpawnBusy(true);
    setMcpError(null);
    setMcpStatus('真 spawn 探测中（短进程 · 不执行 JSON-RPC 工具）…');
    try {
      const result = await runtime.probeMcpSpawn({
        mcpServerId: input.mcpServerId,
        endpoint: input.endpoint,
        maxOutputBytes: input.maxOutputBytes,
        timeoutMs: input.timeoutMs,
        trusted: input.trusted,
        transport: 'local-stdio',
      });
      const flags = [
        result.spawned ? 'spawned' : 'no-spawn',
        result.ok ? 'ok' : 'fail',
        result.timedOut ? 'timeout' : null,
        result.truncated ? 'trunc' : null,
        result.contentTrust,
        result.exitCode !== null && result.exitCode !== undefined
          ? 'exit=' + result.exitCode
          : null,
        result.elapsedMs ? result.elapsedMs + 'ms' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const refuse = result.refuseReason ? ' · 拒绝: ' + result.refuseReason : '';
      setMcpStatus(
        '真 spawn · ' +
          flags +
          ' · ' +
          (result.command || '') +
          (result.args?.length ? ' ' + result.args.join(' ') : '') +
          ' · ' +
          result.policyLabel +
          refuse +
          (result.preview ? ' · preview: ' + result.preview.slice(0, 80) : ''),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP 真 spawn 探测失败';
      setMcpError(message || 'MCP 真 spawn 探测失败');
      setMcpStatus(null);
    } finally {
      setMcpSpawnBusy(false);
    }
  };

  const requestMcpTool = async (input: {
    mcpServerId?: string;
    toolName: string;
    forceSensitive?: boolean;
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.requestMcpTool) {
      setMcpError('当前环境未连接 Runtime，无法请求 MCP 工具审批');
      return;
    }
    setMcpRequestBusy(true);
    setMcpError(null);
    setMcpStatus('请求 MCP 工具审批（模拟 · 不启动进程）…');
    try {
      const result = await runtime.requestMcpTool({
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        forceSensitive: input.forceSensitive,
      });
      const appr = result.approvalRequest?.id?.slice(0, 8);
      setMcpStatus(
        result.enqueued
          ? `MCP 已入队审批 · ${result.toolName} · ${result.sensitivity.labelZh} · ${appr ?? ''}`
          : result.autoApproved
            ? `MCP 策略放行 · ${result.toolName} · ${result.evaluation.labelZh}`
            : `MCP 未入队 · ${result.toolName} · ${result.sensitivity.labelZh}`,
      );
      if (result.enqueued) {
        await loadApprovals();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP 工具审批请求失败';
      setMcpError(message || 'MCP 工具审批请求失败');
      setMcpStatus(null);
    } finally {
      setMcpRequestBusy(false);
    }
  };

  const callMcpTool = async (input: {
    mcpServerId?: string;
    toolName: string;
    argumentsJson?: string;
    forceSensitive?: boolean;
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.callMcpTool) {
      setMcpError('当前环境未连接 Runtime，无法真工具调用');
      return;
    }
    if (!input.mcpServerId) {
      setMcpError('请先登记并勾选 MCP server');
      return;
    }
    const runId = projection.stream.runId;
    const exactStepEvent = [...runtimeView.eventHistory]
      .reverse()
      .find((event) => event.runId === runId && typeof event.stepId === 'string');
    if (!active || !runId || !exactStepEvent?.stepId || !agentBinding?.agentVersionId) {
      setMcpError('真实工具调用必须从当前 Run 的具体 Step 发起；当前没有可验证的执行步骤');
      return;
    }
    setMcpCallBusy(true);
    setMcpError(null);
    setMcpStatus('真工具调用中（白名单 · 审批闸 · JSON-RPC）…');
    try {
      const result = await runtime.callMcpTool({
        mcpServerId: input.mcpServerId,
        toolName: input.toolName,
        argumentsJson: input.argumentsJson,
        forceSensitive: input.forceSensitive,
        workspaceId: active.workspaceId as never,
        taskId: active.taskId as never,
        runId: runId as never,
        stepId: exactStepEvent.stepId as never,
        agentVersionId: agentBinding.agentVersionId as never,
      });
      if (result.refuseReason && !result.executed && !result.enqueued) {
        setMcpStatus(
          '真工具 · 拒绝 · ' +
            result.toolName +
            ' · ' +
            result.refuseReason +
            (result.onAgentAllowlist ? '' : ' · 未白名单'),
        );
        return;
      }
      if (result.enqueued) {
        const appr = result.approvalRequest?.id?.slice(0, 8);
        setMcpStatus(
          '真工具 · 已入队审批 · ' +
            result.toolName +
            ' · ' +
            result.sensitivity.labelZh +
            (appr ? ' · ' + appr : '') +
            ' · 批准后自动执行',
        );
        await loadApprovals();
        return;
      }
      if (result.executed && result.result) {
        const r = result.result;
        const flags = [
          r.ok ? 'ok' : 'fail',
          r.spawned ? 'spawned' : 'no-spawn',
          r.jsonRpcOk ? 'jsonrpc' : 'no-jsonrpc',
          r.timedOut ? 'timeout' : null,
          r.truncated ? 'trunc' : null,
          r.contentTrust,
          r.elapsedMs ? r.elapsedMs + 'ms' : null,
        ]
          .filter(Boolean)
          .join(' · ');
        setMcpStatus(
          '真工具 · 已执行 · ' +
            result.toolName +
            ' · ' +
            flags +
            (r.preview ? ' · preview: ' + r.preview.slice(0, 80) : ''),
        );
        return;
      }
      setMcpStatus(
        '真工具 · ' +
          result.toolName +
          ' · ' +
          (result.autoApproved ? 'auto' : 'idle') +
          ' · executed=' +
          String(result.executed),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP 真工具调用失败';
      setMcpError(message || 'MCP 真工具调用失败');
      setMcpStatus(null);
    } finally {
      setMcpCallBusy(false);
    }
  };

  const refreshMcpTools = async (input: {
    mcpServerId?: string;
    maxOutputBytes?: number;
    timeoutMs?: number;
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.refreshMcpTools) {
      setMcpError('当前环境未连接 Runtime，无法刷新 MCP 工具目录');
      return;
    }
    if (!input.mcpServerId) {
      setMcpError('请先登记 MCP server 再刷新工具目录');
      return;
    }
    setMcpRefreshBusy(true);
    setMcpError(null);
    setMcpStatus('刷新工具目录中（JSON-RPC tools/list · 不执行工具）…');
    try {
      const result: RefreshMcpToolsResponse = await runtime.refreshMcpTools({
        mcpServerId: input.mcpServerId,
        maxOutputBytes: input.maxOutputBytes,
        timeoutMs: input.timeoutMs,
      });
      const flags = [
        result.spawned ? 'spawned' : 'no-spawn',
        result.ok ? 'ok' : 'fail',
        result.jsonRpcOk ? 'jsonrpc' : 'no-jsonrpc',
        result.timedOut ? 'timeout' : null,
        result.truncated ? 'trunc' : null,
        result.contentTrust,
        typeof result.toolCount === 'number' ? 'tools=' + result.toolCount : null,
        typeof result.previousToolCount === 'number' ? 'prev=' + result.previousToolCount : null,
        result.elapsedMs ? result.elapsedMs + 'ms' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const delta = [
        result.addedToolNames?.length ? '新增 ' + result.addedToolNames.join(',') : null,
        result.removedToolNames?.length ? '移除 ' + result.removedToolNames.join(',') : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const refuse = result.refuseReason ? ' · 拒绝: ' + result.refuseReason : '';
      const names =
        result.tools?.length > 0
          ? ' · 目录: ' +
            result.tools
              .map((t: { name: string }) => t.name)
              .slice(0, 12)
              .join(',')
          : '';
      setMcpStatus(
        '工具目录 · ' +
          flags +
          (delta ? ' · ' + delta : '') +
          names +
          refuse +
          (result.preview ? ' · preview: ' + result.preview.slice(0, 60) : ''),
      );
      await loadMcpServers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP 工具目录刷新失败';
      setMcpError(message || 'MCP 工具目录刷新失败');
      setMcpStatus(null);
    } finally {
      setMcpRefreshBusy(false);
    }
  };

  const createProvider = async (input: ProviderCreateInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.createProvider) {
      setProviderError('当前环境未连接 Runtime，无法创建 Provider');
      return;
    }
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus('正在创建 Provider 并写入 SecureStore…');
    try {
      const result = await runtime.createProvider({
        name: input.name,
        baseUrl: input.baseUrl,
        protocol: input.protocol as never,
        supportsDiscovery: input.supportsDiscovery,
        credentialLabel: input.credentialLabel || undefined,
      });
      setProviderStatus(
        `已创建 · ${result.provider.name} · 密钥已入仓 · 发现模型 ${result.discoveredModelCount}`,
      );
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建 Provider 失败';
      setProviderError(message || '创建 Provider 失败');
      setProviderStatus(null);
    } finally {
      setProviderBusy(false);
    }
  };

  const updateProvider = async (input: ProviderUpdateInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.updateProvider) {
      setProviderError('当前环境未连接 Runtime，无法编辑 Provider');
      return;
    }
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus('正在保存 Provider…');
    try {
      const payload: {
        providerId: never;
        name: string;
        baseUrl: string;
        protocol: never;
        supportsDiscovery: boolean;
        credentialLabel?: string;
        rotateCredentialFromClipboard: boolean;
      } = {
        providerId: input.providerId as never,
        name: input.name,
        baseUrl: input.baseUrl,
        protocol: input.protocol as never,
        supportsDiscovery: input.supportsDiscovery,
        credentialLabel: input.credentialLabel || undefined,
        rotateCredentialFromClipboard: input.rotateCredentialFromClipboard,
      };
      const result = await runtime.updateProvider(payload);
      setProviderStatus(
        result.secretRotated
          ? `已更新 · ${result.provider.name} · 密钥已轮换`
          : `已更新 · ${result.provider.name}`,
      );
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新 Provider 失败';
      setProviderError(message || '更新 Provider 失败');
      setProviderStatus(null);
    } finally {
      setProviderBusy(false);
    }
  };

  const previewCcSwitchImport = async (): Promise<{ items: CcSwitchPreviewItem[] }> => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.previewCcSwitchImport) {
      throw new Error('当前环境未连接 Runtime，无法预览 CC Switch');
    }
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus('正在预览 CC Switch 配置…');
    try {
      const result = await runtime.previewCcSwitchImport({});
      setProviderStatus(
        `CC Switch 预览 · 可导入 ${result.importableCount} · 跳过 ${result.skippedCount}`,
      );
      return { items: result.items as CcSwitchPreviewItem[] };
    } catch (error) {
      const message = error instanceof Error ? error.message : '预览 CC Switch 失败';
      setProviderError(message);
      setProviderStatus(null);
      throw error;
    } finally {
      setProviderBusy(false);
    }
  };

  const importCcSwitch = async (sourceIds: string[]) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.importCcSwitch) {
      setProviderError('当前环境未连接 Runtime，无法导入 CC Switch');
      return;
    }
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus(`正在导入 ${sourceIds.length} 项 CC Switch 配置…`);
    try {
      const result = await runtime.importCcSwitch({ sourceIds });
      const failed = result.results.filter((r) => !r.ok);
      setProviderStatus(
        `CC Switch 导入完成 · 成功 ${result.importedCount} · 失败 ${result.failedCount}`,
      );
      if (failed.length > 0) {
        setProviderError(
          failed
            .slice(0, 3)
            .map((f) => `${f.name ?? f.sourceId}: ${f.error ?? '失败'}`)
            .join('；'),
        );
      }
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入 CC Switch 失败';
      setProviderError(message);
      setProviderStatus(null);
    } finally {
      setProviderBusy(false);
    }
  };

  const discoverProviderModels = async (providerId: string) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.discoverModels) {
      setProviderError('当前环境未连接 Runtime，无法发现模型');
      return;
    }
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus('正在从网关发现模型…');
    try {
      const result = await runtime.discoverModels({
        providerId: providerId as never,
      });
      const proto = result.protocol ? ` · ${result.protocol}` : '';
      const added =
        result.addedIds && result.addedIds.length > 0
          ? ` · 新增 ${result.addedIds.slice(0, 4).join(',')}${result.addedIds.length > 4 ? '…' : ''}`
          : '';
      const prev =
        typeof result.previousModelCount === 'number' ? ` · 原有 ${result.previousModelCount}` : '';
      setProviderStatus(
        result.models.length > 0
          ? `发现 ${result.models.length} 个模型 · 来源 ${result.source}${proto}${prev}${added}`
          : `发现完成 · 未返回模型（可手动添加）${proto}`,
      );
      // Refresh diagnostics so Memory/Diagnostics shows scrubbed discovery failures / successes context
      void loadMemory();
      await loadProviders();
    } catch (error) {
      setProviderError(formatProviderDiscoveryError(error));
      setProviderStatus(null);
      void loadMemory();
    } finally {
      setProviderBusy(false);
    }
  };

  const addProviderModel = async (
    providerId: string,
    providerModelId: string,
    displayName?: string,
  ) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.addModels) {
      setProviderError('当前环境未连接 Runtime，无法添加模型');
      return;
    }
    const provider = providers.find((item) => item.providerId === providerId);
    const protocol = provider?.protocol ?? provider?.models[0]?.protocol ?? 'openai-chat';
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus('正在添加模型…');
    try {
      const result = await runtime.addModels({
        providerId: providerId as never,
        protocol: protocol as never,
        models: [
          {
            providerModelId,
            displayName: displayName || providerModelId,
          },
        ],
      });
      setProviderStatus(`已添加 ${result.models.length} 个模型 · ${providerModelId}`);
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : '添加模型失败';
      setProviderError(message || '添加模型失败');
      setProviderStatus(null);
    } finally {
      setProviderBusy(false);
    }
  };

  const loadMemory = useCallback(async () => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listMemory || !runtime?.listDiagnostics) return;
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const workspaceId = active?.workspaceId;
      const taskId = active?.taskId;
      const [memory, diags] = await Promise.all([
        runtime.listMemory({
          ...(workspaceId ? { workspaceId: workspaceId as never } : {}),
          ...(taskId ? { taskId: taskId as never } : {}),
          limit: 100,
        }),
        runtime.listDiagnostics({
          ...(workspaceId ? { workspaceId: workspaceId as never } : {}),
          ...(taskId ? { taskId: taskId as never } : {}),
          limit: 50,
        }),
      ]);
      setMemoryEntries(memory.entries.map(toMemoryEntryView));
      setMemoryChanges(memory.changes.map(toMemoryChangeView));
      setDiagnostics(diags.diagnostics.map(toDiagnosticView));
      const pending = memory.changes.filter((c) => c.approvalState === 'pending').length;
      setMemoryStatus(
        pending > 0
          ? `Memory ${memory.entries.length} · 待审 ${pending} · 诊断 ${diags.diagnostics.length}`
          : `Memory ${memory.entries.length} · 诊断 ${diags.diagnostics.length}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Memory/Diagnostics 加载失败';
      setMemoryError(message || 'Memory/Diagnostics 加载失败');
    } finally {
      setMemoryLoading(false);
    }
  }, [active?.workspaceId, active?.taskId]);

  const decideMemoryChange = async (input: MemoryDecideInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.decideMemory) {
      setMemoryError('当前环境未连接 Runtime，无法审批 Memory');
      return;
    }
    setMemoryBusy(true);
    setMemoryError(null);
    try {
      const result = await runtime.decideMemory({
        changeId: input.changeId as never,
        decision: input.decision,
      });
      setMemoryStatus(
        result.change.approvalState === 'approved'
          ? `已批准 Memory 变更 · ${result.change.id.slice(0, 8)}`
          : `已拒绝 Memory 变更 · ${result.change.id.slice(0, 8)}`,
      );
      await loadMemory();
      await loadApprovals();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Memory 审批失败';
      setMemoryError(message || 'Memory 审批失败');
    } finally {
      setMemoryBusy(false);
    }
  };

  const rollbackMemoryChange = async (input: MemoryRollbackInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.rollbackMemory) {
      setMemoryError('当前环境未连接 Runtime，无法回滚 Memory');
      return;
    }
    setMemoryBusy(true);
    setMemoryError(null);
    try {
      const result = await runtime.rollbackMemory({
        changeId: input.changeId as never,
      });
      setMemoryStatus(`已回滚 Memory 变更 · ${result.change.id.slice(0, 8)} · 恢复上一版本`);
      await loadMemory();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Memory 回滚失败';
      setMemoryError(message || 'Memory 回滚失败');
    } finally {
      setMemoryBusy(false);
    }
  };

  const loadApprovals = useCallback(async () => {
    const workspaceId = active?.workspaceId;
    const taskId = active?.taskId;
    const requestToken = approvalLoadGateRef.current.begin(
      `${workspaceId ?? ''}\u0000${taskId ?? ''}`,
    );
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listApprovals) {
      if (approvalLoadGateRef.current.isCurrent(requestToken)) setApprovalLoading(false);
      return;
    }
    setApprovalLoading(true);
    setApprovalError(null);
    try {
      const result = await runtime.listApprovals({
        ...(workspaceId ? { workspaceId: workspaceId as never } : {}),
        ...(taskId ? { taskId: taskId as never } : {}),
        limit: 100,
      });
      if (!approvalLoadGateRef.current.isCurrent(requestToken)) return;
      setApprovalItems(result.items.map(toApprovalItemView));
      setApprovalPendingCount(result.pendingCount);
      setApprovalHumanOnlyActions(result.humanOnlyActions ?? []);
      if (result.modes?.length) {
        setApprovalModes(result.modes as ApprovalModeView[]);
      }
      const pending = result.pendingCount ?? 0;
      const humanOnlyPending = result.items.filter(
        (item) => item.state === 'pending' && item.humanOnly,
      ).length;
      setApprovalStatus(
        pending > 0
          ? `审批中心 · 待审 ${pending}${humanOnlyPending > 0 ? ` · 仅限真人 ${humanOnlyPending}` : ''} · 共 ${result.items.length}`
          : `审批中心 · 暂无待审 · 共 ${result.items.length}`,
      );
    } catch (error) {
      if (!approvalLoadGateRef.current.isCurrent(requestToken)) return;
      const message = error instanceof Error ? error.message : '审批中心加载失败';
      setApprovalError(message || '审批中心加载失败');
    } finally {
      if (approvalLoadGateRef.current.isCurrent(requestToken)) setApprovalLoading(false);
    }
  }, [active?.workspaceId, active?.taskId]);

  const loadPolicies = useCallback(async () => {
    const workspaceId = active?.workspaceId;
    const taskId = active?.taskId;
    const requestToken = policyLoadGateRef.current.begin(
      `${workspaceId ?? ''}\u0000${taskId ?? ''}`,
    );
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listPolicies || !workspaceId || !taskId) {
      if (policyLoadGateRef.current.isCurrent(requestToken)) setApprovalPolicies([]);
      return;
    }
    try {
      const result = await runtime.listPolicies({
        workspaceId: workspaceId as never,
        taskId: taskId as never,
      });
      if (!policyLoadGateRef.current.isCurrent(requestToken)) return;
      setApprovalPolicies(result.policies.map(toApprovalPolicyView));
    } catch (error) {
      if (!policyLoadGateRef.current.isCurrent(requestToken)) return;
      const message = error instanceof Error ? error.message : '批准策略加载失败';
      setApprovalError(message || '批准策略加载失败');
    }
  }, [active?.workspaceId, active?.taskId]);

  const saveApprovalPolicy = async (input: ApprovalPolicySaveInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.savePolicy || !active?.workspaceId) {
      setApprovalError('当前环境未连接 Runtime，无法保存批准策略');
      return;
    }
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      const result = await runtime.savePolicy({
        workspaceId: active.workspaceId as never,
        ...(input.policyId ? { policyId: input.policyId } : {}),
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        approvalMode: input.approvalMode,
        rules: input.rules.map((rule) => ({
          action: rule.action,
          approvalMode: rule.approvalMode,
          ...(rule.delegateAgentVersionId
            ? { delegateAgentVersionId: rule.delegateAgentVersionId as never }
            : {}),
        })),
      });
      setApprovalStatus(`策略已保存 · ${result.policy.scopeType} · v${result.policy.version}`);
      await loadPolicies();
    } catch (error) {
      const message = error instanceof Error ? error.message : '批准策略保存失败';
      setApprovalError(message || '批准策略保存失败');
    } finally {
      setApprovalBusy(false);
    }
  };

  const syncTaskVersion = useCallback((targetTaskId: string, taskVersion: number) => {
    if (activeTaskIdRef.current !== targetTaskId) return;
    setActive((current) => mergeTaskVersionForTarget(current, targetTaskId, taskVersion));
    dispatchRuntimeView({ type: 'append-succeeded', taskVersion });
  }, []);

  const loadPlanRevisions = useCallback(async () => {
    const workspaceId = active?.workspaceId;
    const taskId = active?.taskId;
    const planId = m2Identity.planId;
    const targetRevision = m2Identity.revision;
    const requestToken = planLoadGateRef.current.begin(
      `${workspaceId ?? ''}\u0000${taskId ?? ''}\u0000${planId ?? ''}`,
    );
    const runtime = window.syncThink?.runtime;
    if (!runtime?.listPlanRevisions || !planId) {
      if (planLoadGateRef.current.isCurrent(requestToken)) {
        setPlanRevision(null);
        setPlanRevisions([]);
      }
      return;
    }
    try {
      const result = await runtime.listPlanRevisions({
        planId: planId as never,
      });
      if (!planLoadGateRef.current.isCurrent(requestToken)) return;
      const revisions = [...result.revisions].sort((left, right) => left.revision - right.revision);
      setPlanRevisions(revisions);
      setPlanRevision(
        revisions.find((item) => item.revision === targetRevision) ?? revisions.at(-1) ?? null,
      );
    } catch (error) {
      if (!planLoadGateRef.current.isCurrent(requestToken)) return;
      const message = error instanceof Error ? error.message : '计划版本加载失败';
      setPlanError(message || '计划版本加载失败');
    }
  }, [active?.workspaceId, active?.taskId, m2Identity.planId, m2Identity.revision]);

  const createDefaultPlan = async () => {
    const runtime = window.syncThink?.runtime;
    if (
      !runtime?.createPlan ||
      !active ||
      active.participationMode !== 'collaboration' ||
      !agentBinding?.agentVersionId
    ) {
      setPlanError('先打开协作模式任务并为智能体保存运行时配置，再创建计划。');
      return;
    }
    setPlanBusy(true);
    setPlanError(null);
    const targetTaskId = active.taskId;
    try {
      const stepId = ulid() as PlanStepDraft['id'];
      const result = await runtime.createPlan({
        taskId: active.taskId as never,
        expectedTaskVersion: resolveExpectedTaskVersion(active.taskVersion, projection.taskVersion),
        title: active.title,
        steps: [
          {
            id: stepId,
            title: '执行任务',
            instructions: active.goal,
            agentVersionId: agentBinding.agentVersionId as never,
            dependsOn: [],
          },
        ],
      });
      setPlanRevision(result);
      setPlanRevisions([result]);
      if (activeTaskIdRef.current !== targetTaskId) return;
      syncTaskVersion(targetTaskId, result.taskVersion);
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建计划失败';
      setPlanError(message || '创建计划失败');
    } finally {
      setPlanBusy(false);
    }
  };

  const reviseCurrentPlan = async (input: {
    planId: string;
    expectedRevision: number;
    title: string;
    steps: PlanStepDraft[];
  }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.revisePlan) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const result = await runtime.revisePlan({
        planId: input.planId as never,
        expectedRevision: input.expectedRevision,
        title: input.title,
        steps: input.steps,
      });
      setPlanRevision(result);
      setPlanRevisions((current) => [...current, result]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存计划新版本失败';
      setPlanError(message || '保存计划新版本失败');
    } finally {
      setPlanBusy(false);
    }
  };

  const approveCurrentPlan = async (input: { planId: string; revision: number }) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.approvePlan) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const graph = await runtime.approvePlan({
        planId: input.planId as never,
        revision: input.revision,
      });
      setRunGraph(graph);
      setRightRailTab('graph');
      await loadPlanRevisions();
    } catch (error) {
      const message = error instanceof Error ? error.message : '批准计划失败';
      setPlanError(message || '批准计划失败');
    } finally {
      setPlanBusy(false);
    }
  };

  const loadRunGraph = useCallback(async () => {
    const workspaceId = active?.workspaceId;
    const taskId = active?.taskId;
    const runId = m2Identity.runId;
    const requestToken = graphLoadGateRef.current.begin(
      `${workspaceId ?? ''}\u0000${taskId ?? ''}\u0000${runId ?? ''}`,
    );
    const runtime = window.syncThink?.runtime;
    if (!runtime?.getRunGraph || !workspaceId || !taskId || !runId) {
      if (graphLoadGateRef.current.isCurrent(requestToken)) setRunGraph(null);
      return;
    }
    setGraphBusy(true);
    setGraphError(null);
    try {
      const graph = await runtime.getRunGraph({
        workspaceId: workspaceId as never,
        taskId: taskId as never,
        runId: runId as never,
      });
      if (!graphLoadGateRef.current.isCurrent(requestToken)) return;
      setRunGraph(graph);
    } catch (error) {
      if (!graphLoadGateRef.current.isCurrent(requestToken)) return;
      const message = error instanceof Error ? error.message : '执行图加载失败';
      setGraphError(message || '执行图加载失败');
    } finally {
      if (graphLoadGateRef.current.isCurrent(requestToken)) setGraphBusy(false);
    }
  }, [active?.workspaceId, active?.taskId, m2Identity.runId]);

  const navigateToApprovalRunStep = useCallback(
    async (input: { workspaceId?: string; taskId?: string; runId: string; stepId?: string }) => {
      const runtime = window.syncThink?.runtime;
      const workspaceId = input.workspaceId ?? active?.workspaceId;
      const taskId = input.taskId ?? active?.taskId;
      const requestToken = graphLoadGateRef.current.begin(
        `${workspaceId ?? ''}\u0000${taskId ?? ''}\u0000${input.runId}`,
      );
      if (!runtime?.getRunGraph || !workspaceId || !taskId) {
        setGraphError('无法读取审批项对应的执行图。');
        return;
      }
      setGraphBusy(true);
      setGraphError(null);
      try {
        const graph = await runtime.getRunGraph({
          workspaceId: workspaceId as never,
          taskId: taskId as never,
          runId: input.runId as never,
        });
        if (!graphLoadGateRef.current.isCurrent(requestToken)) return;
        setRunGraph(graph);
        setSelectedGraphStepId(input.stepId ?? null);
        setRightRailTab('graph');
      } catch (error) {
        if (!graphLoadGateRef.current.isCurrent(requestToken)) return;
        const message = error instanceof Error ? error.message : '审批执行图加载失败';
        setGraphError(message || '审批执行图加载失败');
        setRightRailTab('graph');
      } finally {
        if (graphLoadGateRef.current.isCurrent(requestToken)) setGraphBusy(false);
      }
    },
    [active?.workspaceId, active?.taskId],
  );

  const mutateOrchestrationRun = async (action: 'pause' | 'resume' | 'cancel') => {
    const runtime = window.syncThink?.runtime;
    if (!runtime || !active || !runGraph) return;
    const method =
      action === 'pause'
        ? runtime.pauseOrchestrationRun
        : action === 'resume'
          ? runtime.resumeOrchestrationRun
          : runtime.cancelOrchestrationRun;
    if (!method) return;
    setGraphBusy(true);
    setGraphError(null);
    const targetTaskId = active.taskId;
    try {
      const result = await method({
        workspaceId: active.workspaceId as never,
        taskId: active.taskId as never,
        runId: runGraph.run.id,
        expectedTaskVersion: resolveExpectedTaskVersion(active.taskVersion, projection.taskVersion),
      });
      if (activeTaskIdRef.current !== targetTaskId) return;
      setRunGraph(result);
      syncTaskVersion(targetTaskId, result.taskVersion);
    } catch (error) {
      const message = error instanceof Error ? error.message : `Run ${action} 失败`;
      setGraphError(message || `Run ${action} 失败`);
    } finally {
      setGraphBusy(false);
    }
  };

  const loadArtifacts = useCallback(async () => {
    const workspaceId = active?.workspaceId;
    const taskId = active?.taskId;
    const runId = m2Identity.runId;
    const requestToken = artifactLoadGateRef.current.begin(
      `${workspaceId ?? ''}\u0000${taskId ?? ''}\u0000${runId ?? ''}`,
    );
    const runtime = window.syncThink?.runtime;
    if (
      !runtime?.listArtifacts ||
      !runtime.listArtifactMergeConflicts ||
      !workspaceId ||
      !taskId ||
      !runId
    ) {
      if (artifactLoadGateRef.current.isCurrent(requestToken)) {
        setArtifactItems([]);
        setArtifactConflicts([]);
        setSelectedArtifactId(null);
      }
      return;
    }
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      const scope = {
        workspaceId: workspaceId as never,
        taskId: taskId as never,
        runId: runId as never,
      };
      const [result, conflictResult] = await Promise.all([
        runtime.listArtifacts({ ...scope, limit: 8 }),
        runtime.listArtifactMergeConflicts(scope),
      ]);
      if (!artifactLoadGateRef.current.isCurrent(requestToken)) return;
      setArtifactItems(result.artifacts);
      setArtifactConflicts(conflictResult.conflicts);
      setSelectedArtifactId((current) =>
        result.artifacts.some((item) => String(item.artifact.id) === current)
          ? current
          : String(result.artifacts[0]?.artifact.id ?? '') || null,
      );
    } catch (error) {
      if (!artifactLoadGateRef.current.isCurrent(requestToken)) return;
      const message = error instanceof Error ? error.message : '产物版本加载失败';
      setArtifactError(message || '产物版本加载失败');
    } finally {
      if (artifactLoadGateRef.current.isCurrent(requestToken)) setArtifactBusy(false);
    }
  }, [active?.workspaceId, active?.taskId, m2Identity.runId]);

  const compareArtifacts = async (leftVersionId: string, rightVersionId: string) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.compareArtifactVersions || !active || !m2Identity.runId) return;
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      const result = await runtime.compareArtifactVersions({
        workspaceId: active.workspaceId as never,
        taskId: active.taskId as never,
        runId: m2Identity.runId as never,
        leftVersionId: leftVersionId as never,
        rightVersionId: rightVersionId as never,
      });
      setArtifactComparison({
        leftVersionId: String(result.leftVersionId),
        rightVersionId: String(result.rightVersionId),
        comparison: result.comparison,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '产物比较失败';
      setArtifactError(message || '产物比较失败');
    } finally {
      setArtifactBusy(false);
    }
  };

  const selectArtifact = async (artifactId: string, artifactVersionId: string) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.selectArtifactVersion || !active || !m2Identity.runId) return;
    setArtifactBusy(true);
    setArtifactError(null);
    const targetTaskId = active.taskId;
    try {
      const result = await runtime.selectArtifactVersion({
        workspaceId: active.workspaceId as never,
        taskId: active.taskId as never,
        runId: m2Identity.runId as never,
        artifactId: artifactId as never,
        artifactVersionId: artifactVersionId as never,
        operationId: ulid(),
        expectedTaskVersion: resolveExpectedTaskVersion(active.taskVersion, projection.taskVersion),
      });
      if (activeTaskIdRef.current !== targetTaskId) return;
      syncTaskVersion(targetTaskId, result.taskVersion);
      await loadArtifacts();
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择产物版本失败';
      setArtifactError(message || '选择产物版本失败');
    } finally {
      setArtifactBusy(false);
    }
  };

  const mergeArtifacts = async (
    artifactId: string,
    leftVersionId: string,
    rightVersionId: string,
    mergeStepId: string,
  ) => {
    const runtime = window.syncThink?.runtime;
    const item = artifactItems.find((candidate) => String(candidate.artifact.id) === artifactId);
    const left = item?.versions.find((version) => String(version.id) === leftVersionId);
    const right = item?.versions.find((version) => String(version.id) === rightVersionId);
    const mergeStep = runGraph?.steps.find(
      (step) =>
        String(step.id) === mergeStepId &&
        step.kind === 'merge' &&
        step.state === 'ready' &&
        Boolean(left && step.dependsOn.map(String).includes(String(left.sourceStepId))) &&
        Boolean(right && step.dependsOn.map(String).includes(String(right.sourceStepId))),
    );
    if (
      !runtime?.mergeArtifactVersions ||
      !active ||
      !m2Identity.runId ||
      !item ||
      !left ||
      !right ||
      !mergeStep
    ) {
      setArtifactError('合并需要一个依赖左右分支且处于就绪状态的合并步骤。');
      return;
    }
    let baseVersionId: string;
    try {
      baseVersionId = findNearestCommonArtifactAncestor(
        item.versions.map((version) => ({
          id: String(version.id),
          parentVersionIds: version.parentVersionIds.map(String),
        })),
        leftVersionId,
        rightVersionId,
      );
    } catch (error) {
      setArtifactError(error instanceof Error ? error.message : '分支没有共同祖先。');
      return;
    }
    if (baseVersionId === leftVersionId || baseVersionId === rightVersionId) {
      setArtifactError('最近共同祖先与分支端点重合，不能创建三方合并。');
      return;
    }
    setArtifactBusy(true);
    setArtifactError(null);
    const targetTaskId = active.taskId;
    try {
      const result = await runtime.mergeArtifactVersions({
        workspaceId: active.workspaceId as never,
        taskId: active.taskId as never,
        runId: m2Identity.runId as never,
        artifactId: artifactId as never,
        baseVersionId: baseVersionId as never,
        leftVersionId: leftVersionId as never,
        rightVersionId: rightVersionId as never,
        sourceStepId: mergeStepId as never,
        operationId: ulid(),
        expectedTaskVersion: resolveExpectedTaskVersion(active.taskVersion, projection.taskVersion),
      });
      if (activeTaskIdRef.current !== targetTaskId) return;
      syncTaskVersion(targetTaskId, result.taskVersion);
      await Promise.all([loadArtifacts(), loadRunGraph()]);
      if (result.status === 'conflict') setRightRailTab('artifacts');
    } catch (error) {
      const message = error instanceof Error ? error.message : '合并产物版本失败';
      setArtifactError(message || '合并产物版本失败');
    } finally {
      setArtifactBusy(false);
    }
  };

  const resolveArtifactConflict = async (
    conflictId: string,
    strategy: ArtifactMergeConflictResolutionStrategy,
    content?: string,
  ) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.resolveArtifactMergeConflict || !active || !m2Identity.runId) {
      setArtifactError('当前没有可处理该冲突的目标 Run。');
      return;
    }
    setArtifactBusy(true);
    setArtifactError(null);
    const targetTaskId = active.taskId;
    try {
      const result = await runtime.resolveArtifactMergeConflict({
        workspaceId: active.workspaceId as never,
        taskId: active.taskId as never,
        runId: m2Identity.runId as never,
        conflictId,
        strategy,
        ...(strategy === 'manual' ? { content } : {}),
        operationId: ulid(),
        expectedTaskVersion: resolveExpectedTaskVersion(active.taskVersion, projection.taskVersion),
      });
      if (activeTaskIdRef.current !== targetTaskId) return;
      syncTaskVersion(targetTaskId, result.taskVersion);
      await Promise.all([loadArtifacts(), loadRunGraph()]);
      setRightRailTab('artifacts');
    } catch (error) {
      const message = error instanceof Error ? error.message : '解决产物合并冲突失败';
      setArtifactError(message || '解决产物合并冲突失败');
    } finally {
      setArtifactBusy(false);
    }
  };

  const decideApprovalItem = async (input: ApprovalDecideInput) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.decideApproval) {
      setApprovalError('当前环境未连接 Runtime，无法审批');
      return;
    }
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      const result = await runtime.decideApproval({
        id: input.id as never,
        decision: input.decision,
        decidedBy: input.decidedBy,
        delegateAgentVersionId: input.delegateAgentVersionId as never,
        decisionNote: input.decisionNote,
      });
      const allow = (
        result as { skillAllowlist?: { bound?: boolean; reason?: string; skillVersionId?: string } }
      ).skillAllowlist;
      const allowNote =
        allow?.bound === true
          ? ` · 已写入 Skill 白名单 · ${(allow.skillVersionId ?? '').slice(0, 8)}`
          : allow?.reason
            ? ` · ${allow.reason}`
            : '';
      const mcpCall = (
        result as {
          mcpToolCall?: {
            executed?: boolean;
            refuseReason?: string;
            toolName?: string;
            result?: {
              ok?: boolean;
              jsonRpcOk?: boolean;
              preview?: string;
              toolResultText?: string;
              elapsedMs?: number;
            };
          };
        }
      ).mcpToolCall;
      let mcpNote = '';
      if (mcpCall) {
        if (mcpCall.executed && mcpCall.result) {
          const preview = mcpCall.result.toolResultText || mcpCall.result.preview || '';
          mcpNote =
            ' · 真工具已执行 · ' +
            (mcpCall.toolName || '') +
            ' · ' +
            (mcpCall.result.ok ? 'ok' : 'fail') +
            (mcpCall.result.jsonRpcOk ? ' · jsonrpc' : '') +
            (mcpCall.result.elapsedMs ? ' · ' + mcpCall.result.elapsedMs + 'ms' : '') +
            (preview ? ' · ' + String(preview).slice(0, 60) : '');
          setMcpStatus(
            '真工具 · 批准后执行 · ' +
              (mcpCall.toolName || '') +
              ' · ' +
              (mcpCall.result.ok ? 'ok' : 'fail') +
              (mcpCall.result.jsonRpcOk ? ' · jsonrpc' : '') +
              (preview ? ' · preview: ' + String(preview).slice(0, 80) : ''),
          );
        } else if (mcpCall.refuseReason) {
          mcpNote = ' · 真工具未执行 · ' + mcpCall.refuseReason;
          setMcpStatus('真工具 · 批准后未执行 · ' + mcpCall.refuseReason);
        }
      }
      setApprovalStatus(
        result.item.state === 'approved'
          ? `已批准 · ${result.item.action} · ${result.item.id.slice(0, 8)}${allowNote}${mcpNote}`
          : `已拒绝 · ${result.item.action} · ${result.item.id.slice(0, 8)}${allowNote}`,
      );
      await loadApprovals();
      if (result.item.kind === 'memory') {
        await loadMemory();
      }
      if (result.item.kind === 'skill-permission' || allow?.bound) {
        await loadAgent();
        await loadSkills();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '审批决策失败';
      setApprovalError(message || '审批决策失败');
    } finally {
      setApprovalBusy(false);
    }
  };

  const probeProviderCapabilities = async (providerId: string, modelId?: string) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.probeCapabilities) {
      setProviderError('当前环境未连接 Runtime，无法探测能力');
      return;
    }
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus('正在本地启发式探测能力建议…');
    try {
      const result = await runtime.probeCapabilities({
        providerId: providerId as never,
        ...(modelId ? { modelId: modelId as never } : {}),
      });
      const sample = result.suggestions
        .slice(0, 3)
        .map((item) => {
          const tags = item.capabilities.join('+') || '—';
          return item.providerModelId + '[' + tags + ']';
        })
        .join(' · ');
      setProviderStatus(
        result.suggestions.length > 0
          ? '能力建议 · ' +
              result.suggestions.length +
              ' 模型 · 启发式 · 待确认' +
              (sample ? ' · ' + sample : '')
          : '能力探测完成 · 无模型可建议',
      );
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : '能力探测失败';
      setProviderError(message || '能力探测失败');
      setProviderStatus(null);
    } finally {
      setProviderBusy(false);
    }
  };

  const confirmProviderCapabilities = async (
    modelId: string,
    capabilities: string[],
    confirmed = true,
  ) => {
    const runtime = window.syncThink?.runtime;
    if (!runtime?.confirmCapabilities) {
      setProviderError('当前环境未连接 Runtime，无法确认能力');
      return;
    }
    setProviderBusy(true);
    setProviderError(null);
    setProviderStatus(null);
    try {
      const result = await runtime.confirmCapabilities({
        modelId: modelId as never,
        capabilities: capabilities as never,
        confirmed,
      });
      const tags = result.model.capabilities.join(', ') || '—';
      const label = result.model.displayName || result.model.providerModelId;
      setProviderStatus(
        confirmed
          ? '能力已确认 · ' + label + ' · ' + tags
          : '能力已更新（未确认）· ' + label + ' · ' + tags,
      );
      await loadProviders();
    } catch (error) {
      const message = error instanceof Error ? error.message : '确认能力失败';
      setProviderError(message || '确认能力失败');
    } finally {
      setProviderBusy(false);
    }
  };

  const eventRefreshHandlersRef = useRef({
    loadProviders,
    loadAgent,
    loadSkills,
    loadMcpServers,
    loadApprovals,
    loadMemory,
  });
  eventRefreshHandlersRef.current = {
    loadProviders,
    loadAgent,
    loadSkills,
    loadMcpServers,
    loadApprovals,
    loadMemory,
  };

  useEffect(() => {
    const runtime = window.syncThink?.runtime;
    if (!runtime) return;
    const removeListener = runtime.onEvent((event) => {
      dispatchRuntimeView({ type: 'event-received', event, threadId: threadIdRef.current });
      if (isM2RefreshEvent(event)) {
        if (m2RefreshTimerRef.current !== null) {
          window.clearTimeout(m2RefreshTimerRef.current);
        }
        m2RefreshTimerRef.current = window.setTimeout(() => {
          m2RefreshTimerRef.current = null;
          setM2RefreshNonce((nonce) => nonce + 1);
        }, 75);
      }
      if (
        event.type === 'provider.created' ||
        event.type === 'provider.models_discovered' ||
        event.type === 'provider.capabilities_probed' ||
        event.type === 'provider.capabilities_confirmed'
      ) {
        void eventRefreshHandlersRef.current.loadProviders();
      }
      if (
        event.type === 'agent.binding_updated' ||
        event.type === 'agent.created' ||
        event.type === 'agent.version-created'
      ) {
        void eventRefreshHandlersRef.current.loadAgent();
      }
      if (event.type === 'skill.imported') {
        void eventRefreshHandlersRef.current.loadSkills();
      }
      if (event.type === 'mcp.registered') {
        void eventRefreshHandlersRef.current.loadMcpServers();
      }
      if (event.type === 'mcp.spawn_probed') {
        void eventRefreshHandlersRef.current.loadMcpServers();
      }
      if (event.type === 'mcp.tool_requested') {
        void eventRefreshHandlersRef.current.loadApprovals();
      }
      if (event.type === 'mcp.tool_called' || event.type === 'mcp.tool_refused') {
        void eventRefreshHandlersRef.current.loadMcpServers();
      }
      if (event.type === 'mcp.tools_refreshed') {
        void eventRefreshHandlersRef.current.loadMcpServers();
      }
      if (
        event.type === 'memory.change.proposed' ||
        event.type === 'memory.change.decided' ||
        event.type === 'memory.change.rolled_back' ||
        event.type === 'diagnostics.appended' ||
        event.type === 'run.completed' ||
        event.type === 'run.failed'
      ) {
        void eventRefreshHandlersRef.current.loadMemory();
      }
      if (event.type === 'memory.change.proposed' || event.type === 'memory.change.decided') {
        void eventRefreshHandlersRef.current.loadApprovals();
      }
      if (event.type === 'approval.requested' || event.type === 'approval.decided') {
        void eventRefreshHandlersRef.current.loadMemory();
      }
    });
    return () => {
      removeListener();
      if (m2RefreshTimerRef.current !== null) {
        window.clearTimeout(m2RefreshTimerRef.current);
        m2RefreshTimerRef.current = null;
      }
    };
    // Event subscription is mount-stable; reconnect does not rebind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const runtime = window.syncThink?.runtime;
    if (!runtime) return;
    const cancelConnection = startRuntimeConnection({
      connect: () => runtime.connect(),
      onConnected: (result) => {
        dispatchRuntimeView({ type: 'connect-succeeded', result, threadId: threadIdRef.current });
        void loadWorkspaceCatalog(null);
        void loadProviders();
        void loadAgent();
        void loadSkills();
        void loadMcpServers();
        void loadMemory();
      },
      onFailed: (error) => {
        dispatchRuntimeView({ type: 'connect-failed', error });
      },
    });
    connectCancelRef.current = cancelConnection;
    return () => {
      cancelConnection();
      if (connectCancelRef.current === cancelConnection) {
        connectCancelRef.current = null;
      }
    };
    // reconnectNonce re-runs connect only; event listener is separate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnectNonce]);

  // Re-bind event projection when active thread changes after open.
  useEffect(() => {
    // threadId is read inside projection/send; listener already uses state via closure on mount.
    // No extra subscription needed — events are global; projection filters by threadId.
  }, [threadId]);

  useEffect(() => {
    if (runtimeView.connectionState === 'online') {
      void loadMemory();
      void loadApprovals();
      void loadPolicies();
    }
  }, [active?.workspaceId, loadMemory, loadApprovals, loadPolicies, runtimeView.connectionState]);

  useEffect(() => {
    if (runtimeView.connectionState !== 'online') return;
    void loadPlanRevisions();
  }, [loadPlanRevisions, runtimeView.connectionState]);

  useEffect(() => {
    if (runtimeView.connectionState !== 'online') return;
    void loadRunGraph();
    void loadArtifacts();
  }, [loadRunGraph, loadArtifacts, runtimeView.connectionState]);

  useEffect(() => {
    if (m2RefreshNonce === 0 || runtimeView.connectionState !== 'online') return;
    void Promise.all([
      loadPlanRevisions(),
      loadRunGraph(),
      loadArtifacts(),
      loadApprovals(),
      loadPolicies(),
    ]);
  }, [
    m2RefreshNonce,
    loadPlanRevisions,
    loadRunGraph,
    loadArtifacts,
    loadApprovals,
    loadPolicies,
    runtimeView.connectionState,
  ]);

  const reconnectRuntime = useCallback(() => {
    if (!window.syncThink?.runtime) return;
    // Cancel any in-flight auto-retry and start a fresh connect cycle.
    connectCancelRef.current?.();
    connectCancelRef.current = null;
    dispatchRuntimeView({ type: 'reconnect-requested' });
    setReconnectNonce((n) => n + 1);
  }, []);

  const openTask = async (task: WorkspaceNavTask) => {
    setLeftDrawerOpen(false);
    const requestToken = openTaskLoadGateRef.current.begin(
      `${task.workspaceId}\u0000${task.taskId}`,
    );
    const runtime = window.syncThink?.runtime;
    const workspace = workspaces.find((item) => item.workspaceId === task.workspaceId);
    if (!workspace) return;

    if (!runtime?.openTask) {
      if (!openTaskLoadGateRef.current.isCurrent(requestToken)) return;
      applySelection({
        taskId: task.taskId,
        workspaceId: task.workspaceId,
        threadId: task.threadId,
        title: task.title,
        goal: task.goal,
        folderPath: workspace.folderPath,
        workspaceName: workspace.name,
        taskVersion: task.taskVersion,
        status: task.status,
        participationMode: task.participationMode ?? 'conversation',
      });
      return;
    }

    try {
      const response = await runtime.openTask({ taskId: task.taskId as never });
      if (!openTaskLoadGateRef.current.isCurrent(requestToken)) return;
      const opened = response.task;
      setTasksByWorkspace((prev) => upsertTaskInMap(prev, opened));
      applySelection({
        taskId: opened.taskId,
        workspaceId: opened.workspaceId,
        threadId: opened.threadId,
        title: opened.title,
        goal: opened.goal,
        folderPath: workspace.folderPath,
        workspaceName: workspace.name,
        taskVersion: opened.taskVersion,
        status: opened.status,
        participationMode: opened.participationMode,
      });
    } catch {
      if (!openTaskLoadGateRef.current.isCurrent(requestToken)) return;
      setWorkspaceError('打开任务失败');
    }
  };

  const changeParticipationMode = async (mode: 'conversation' | 'collaboration' | 'automatic') => {
    if (!active || modeBusy || mode === active.participationMode) return;
    const runtime = window.syncThink?.runtime;
    if (!runtime?.setParticipationMode) {
      setModeError('当前环境未连接 Runtime，无法切换参与模式');
      return;
    }
    setModeBusy(true);
    setModeError(null);
    setAutomaticRecovery(null);
    try {
      const response = await runtime.setParticipationMode({
        taskId: active.taskId as never,
        mode,
        expectedTaskVersion: resolveExpectedTaskVersion(active.taskVersion, projection.taskVersion),
      });
      const updated = response.task;
      setTasksByWorkspace((current) => upsertTaskInMap(current, updated));
      applySelection({
        ...active,
        title: updated.title,
        goal: updated.goal,
        taskVersion: updated.taskVersion,
        status: updated.status,
        participationMode: updated.participationMode,
      });
      setAutomaticRecovery(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      let recovery =
        mode === 'automatic'
          ? resolveAutomaticModeRecovery({
              hasApprovedPlan: automaticModeReadiness.approvedPlan,
              hasPolicy: automaticModeReadiness.applicablePolicy,
            })
          : null;
      if (!recovery && mode === 'automatic' && /approved plan|计划/i.test(message)) {
        recovery = resolveAutomaticModeRecovery({
          hasApprovedPlan: false,
          hasPolicy: true,
        });
      }
      if (!recovery && mode === 'automatic' && /policy|策略/i.test(message)) {
        recovery = resolveAutomaticModeRecovery({
          hasApprovedPlan: true,
          hasPolicy: false,
        });
      }
      setAutomaticRecovery(recovery);
      setModeError(
        mode === 'automatic'
          ? message || '自动模式需要已批准计划和适用策略。'
          : '模式切换失败；任务版本可能已更新，请重新打开任务后再试。',
      );
    } finally {
      setModeBusy(false);
    }
  };

  const recoverAutomaticPlan = async () => {
    if (!active) return;
    if (active.participationMode !== 'collaboration') {
      await changeParticipationMode('collaboration');
    }
    if (planRevisions.length === 0) {
      await createDefaultPlan();
    }
    window.setTimeout(() => {
      const target = document.querySelector('[data-testid="plan-editor"]') as HTMLElement | null;
      if (!target) return;
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
  };

  const createWorkspace = async () => {
    const runtime = window.syncThink?.runtime;
    let folderPath: string | null = null;
    if (runtime?.pickFolder) {
      const picked = await runtime.pickFolder();
      if (picked.canceled || !picked.path) return;
      folderPath = picked.path;
    } else if (typeof window !== 'undefined') {
      folderPath = window.prompt('本地文件夹绝对路径', 'D:/projects/SYNC-THINK');
    }
    if (!folderPath || !folderPath.trim()) return;
    const defaultName = folderPath.split(/[/\\]/).filter(Boolean).at(-1) ?? 'Workspace';
    const name = window.prompt('工作区名称', defaultName) ?? '';
    if (!name.trim()) return;

    if (!runtime?.createWorkspace) {
      const now = new Date().toISOString();
      const preview: WorkspaceSummary = {
        workspaceId: `preview-ws-${Date.now()}` as never,
        folderPath: folderPath.trim(),
        name: name.trim(),
        createdAt: now,
        updatedAt: now,
      };
      setWorkspaces((prev) => [...prev, preview]);
      setTasksByWorkspace((prev) => new Map(prev).set(preview.workspaceId, []));
      return;
    }

    try {
      await runtime.createWorkspace({
        folderPath: folderPath.trim(),
        name: name.trim(),
      });
      await loadWorkspaceCatalog(active?.taskId ?? null);
    } catch {
      setWorkspaceError('创建工作区失败（检查路径 allowlist）');
    }
  };

  const createTask = async (workspaceId: string, options?: { parentTaskId?: string }) => {
    const runtime = window.syncThink?.runtime;
    const parentTaskId = options?.parentTaskId;
    const defaultTitle = parentTaskId ? '子任务' : '新任务';
    const title = window.prompt(
      parentTaskId ? '子任务标题（将显式引用父任务上下文）' : '任务标题',
      defaultTitle,
    );
    if (!title || !title.trim()) return;
    const goal = window.prompt('任务目标', title.trim()) ?? title.trim();
    if (!goal.trim()) return;

    if (!runtime?.createTask) {
      const now = new Date().toISOString();
      const previewTask: TaskSummary = {
        taskId: `preview-task-${Date.now()}` as never,
        workspaceId: workspaceId as never,
        parentTaskId: parentTaskId as TaskSummary['parentTaskId'],
        title: title.trim(),
        goal: goal.trim(),
        status: 'active',
        participationMode: 'conversation',
        taskVersion: 0,
        threadId: `thread-preview-${Date.now()}` as never,
        createdAt: now,
        updatedAt: now,
      };
      setTasksByWorkspace((prev) => upsertTaskInMap(prev, previewTask));
      const workspace = workspaces.find((item) => item.workspaceId === workspaceId);
      if (workspace) {
        applySelection({
          taskId: previewTask.taskId,
          workspaceId: previewTask.workspaceId,
          threadId: previewTask.threadId,
          title: previewTask.title,
          goal: previewTask.goal,
          folderPath: workspace.folderPath,
          workspaceName: workspace.name,
          taskVersion: 0,
          status: 'active',
          participationMode: 'conversation',
        });
      }
      return;
    }

    try {
      const created = await runtime.createTask({
        workspaceId: workspaceId as never,
        title: title.trim(),
        goal: goal.trim(),
        parentTaskId: parentTaskId as TaskSummary['parentTaskId'],
      });
      if (runtime.openTask) {
        await runtime.openTask({ taskId: created.taskId });
      }
      await loadWorkspaceCatalog(created.taskId);
    } catch {
      setWorkspaceError(parentTaskId ? '创建子任务失败' : '创建任务失败');
    }
  };

  const sendMessage = async (text: string, options?: ComposeSendOptions) => {
    if (sendPending || !canSendRuntimeMessage(runtimeView.connectionState)) return false;
    const runtime = window.syncThink?.runtime;
    if (!runtime) {
      setPreviewMessages((messages) => [...messages, text]);
      return true;
    }
    setSendPending(true);
    setSendError(null);
    try {
      const response = await runtime.appendMessage({
        threadId: threadId as never,
        expectedTaskVersion: resolveExpectedTaskVersion(
          active?.taskVersion,
          runtimeView.taskVersion,
        ),
        role: 'user',
        text,
        ...(options?.modelId ? { modelId: options.modelId as never } : {}),
      });
      dispatchRuntimeView({ type: 'append-succeeded', taskVersion: response.taskVersion });
      if (active) {
        setActive({ ...active, taskVersion: response.taskVersion });
      }
      return true;
    } catch (error) {
      const failure = classifyAppendMessageFailure(error);
      setSendError(failure.message);
      if (failure.connectionLost) {
        dispatchRuntimeView({
          type: 'connect-failed',
          error: { code: 'runtime.unavailable', retryable: true },
        });
      } else if (failure.versionMismatch && active) {
        await loadWorkspaceCatalog(active.taskId);
      }
      return false;
    } finally {
      setSendPending(false);
    }
  };

  const cancelStream = async () => {
    if (cancelPending || projection.stream.state !== 'streaming' || !projection.stream.runId)
      return;
    const runtime = window.syncThink?.runtime;
    if (!runtime?.cancelRun) return;
    setCancelPending(true);
    try {
      await runtime.cancelRun({ runId: projection.stream.runId as never });
    } catch {
      // Event stream remains source of truth; ignore bridge failure for UX.
    } finally {
      setCancelPending(false);
    }
  };

  const navWorkspaces = useMemo(
    () =>
      workspaces.map((workspace) => ({
        workspaceId: workspace.workspaceId,
        folderPath: workspace.folderPath,
        name: workspace.name,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      })),
    [workspaces],
  );

  const navTasks = useMemo(() => {
    const map = new Map<string, WorkspaceNavTask[]>();
    for (const [workspaceId, tasks] of tasksByWorkspace) {
      map.set(workspaceId, tasks.map(toNavTask));
    }
    return map;
  }, [tasksByWorkspace]);

  const lastOpenedId = useMemo(() => {
    const all = [...tasksByWorkspace.values()].flat().map(toNavTask);
    return pickLastOpenedTaskId(all);
  }, [tasksByWorkspace]);

  const flashInstrument = useCallback((selector: string) => {
    const parts = selector
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    let el: HTMLElement | null = null;
    for (const part of parts) {
      const found = document.querySelector(part);
      if (found instanceof HTMLElement) {
        el = found;
        break;
      }
    }
    if (!el) return;
    // Reveal the validation workbench before scrolling to a nested target.
    const inM1Workspace = Boolean(el.closest('[data-testid="m1-obs-layout"]'));
    if (inM1Workspace) {
      setM1ObsWorkspaceOpen(true);
    }
    // Soft #60: auto-expand secondary observatory when flashing folded boards
    const tid = el.getAttribute('data-testid') || '';
    const sel = selector || '';
    if (
      (tid && isM1ObsSecondaryTestId(tid)) ||
      /m1-session|m1-exit-evidence|m1-exit-chip|m1-evidence-bundle|m1-dogfood|m1-soft-regression|m1-handtest|m1-known-limits|m1-open-doc/.test(
        sel,
      )
    ) {
      setM1ObsSecondaryOpen(true);
    }
    window.setTimeout(
      () => {
        el!.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        el!.setAttribute('data-nav-flash', '1');
        window.setTimeout(() => el!.removeAttribute('data-nav-flash'), 1400);
      },
      inM1Workspace ? 40 : 0,
    );
  }, []);

  const navigateToInstrument = useCallback(
    (target: M1SessionJumpTarget | 'agents' | 'settings' | 'compose') => {
      // Diagnostics uses 'agents'; session chips use 'agent'
      if ((target as string) === 'compose') {
        // Soft focus compose input; never auto-send.
        window.setTimeout(() => {
          const el = document.querySelector(
            '[data-testid="compose-input"], .st-compose textarea, .st-compose [contenteditable="true"], .st-demo-compose-wrap textarea',
          ) as HTMLElement | null;
          if (el) {
            el.focus();
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          flashInstrument(
            '[data-testid="compose-session-meta"], .st-demo-compose-wrap, .st-compose',
          );
        }, 40);
        return;
      }
      const normalized: M1SessionJumpTarget | 'settings' =
        (target as string) === 'agents' ? 'agent' : (target as M1SessionJumpTarget | 'settings');

      if (normalized === 'none') return;

      if (normalized === 'manifest' || normalized === 'trace') {
        if (traceCollapsed) {
          setTraceCollapsed(false);
          writeTraceCollapsedPreference(false);
        }
        // Defer flash until rail expands
        window.setTimeout(() => {
          if (normalized === 'manifest') {
            flashInstrument(
              '[data-testid="manifest-panel"], .st-demo-trace__manifest, .st-manifest',
            );
          } else {
            flashInstrument('[data-testid="trace-list-wrap"], .st-demo-trace, .st-trace');
          }
        }, 80);
        return;
      }

      if (normalized === 'theme') {
        flashInstrument(
          '[data-testid="conversation-layout-switch"], .st-demo-theme-switch, .st-demo-header-tools',
        );
        return;
      }

      const map: Record<string, string> = {
        workspaces: '.st-demo-nav-stack__workspaces',
        providers: '.st-demo-nav-stack__providers',
        agent: '.st-demo-nav-stack__agent',
        memory: '.st-demo-nav-stack__memory',
        approvals: '.st-demo-nav-stack__approval',
        settings: '.st-demo-nav-stack__providers',
      };
      const inst = leftInstrumentFromJump(normalized);
      if (inst) {
        setLeftInstrument(inst);
        setLeftDrawerOpen(true);
      }
      const sel = map[normalized];
      if (sel) {
        window.setTimeout(() => flashInstrument(sel), inst ? 80 : 0);
      }
    },
    [flashInstrument, traceCollapsed],
  );

  const navigateFromDiagnostics = useCallback(
    (target: 'providers' | 'approvals' | 'agents' | 'settings' | 'memory') => {
      navigateToInstrument(target);
    },
    [navigateToInstrument],
  );

  const handleSessionChipJump = useCallback(
    (target: M1SessionJumpTarget) => {
      if (!isM1SessionChipJumpable(target)) return;
      navigateToInstrument(target);
    },
    [navigateToInstrument],
  );

  const handleHandtestItemJump = useCallback(
    (target: M1SessionJumpTarget) => {
      if (!isM1HandtestItemJumpable(target)) return;
      navigateToInstrument(target);
    },
    [navigateToInstrument],
  );

  const openM1EvidenceDoc = useCallback(
    async (
      id: 'handtest' | 'dogfood' | 'dogfood-today' | 'dogfood-template' | 'dogfood-day',
      opts?: { alsoJump?: M1SessionJumpTarget; date?: string },
    ) => {
      const runtime = window.syncThink?.runtime;
      const openDocId = id === 'dogfood-day' && opts?.date ? `dogfood-day:${opts.date}` : id;
      if (!runtime?.openM1Doc) {
        setM1OpenDocFeedback({
          level: 'error',
          message: '当前壳未暴露 openM1Doc（需 desktop IPC）',
          dataOk: '0',
          dataCreated: '0',
          openDocId,
          basename: null,
        });
        if (opts?.alsoJump && isM1NextActionJumpable(opts.alsoJump)) {
          navigateToInstrument(opts.alsoJump);
        }
        setExitEvidenceTick((n) => n + 1);
        return;
      }
      try {
        const res = await runtime.openM1Doc(
          id,
          id === 'dogfood-day' ? { date: opts?.date } : undefined,
        );
        const fb = formatM1OpenDocFeedback({
          id: openDocId,
          ok: Boolean(res?.ok),
          error: res?.error ?? null,
          path: res?.path ?? null,
          created: Boolean(res?.created),
        });
        setM1OpenDocFeedback({
          ...fb,
          openDocId,
        });
      } catch (err) {
        const fb = formatM1OpenDocFeedback({
          id: openDocId,
          ok: false,
          error: err instanceof Error ? err.message : 'open-failed',
          path: null,
          created: false,
        });
        setM1OpenDocFeedback({ ...fb, openDocId });
      }
      if (opts?.alsoJump && isM1NextActionJumpable(opts.alsoJump)) {
        navigateToInstrument(opts.alsoJump);
      }
      setExitEvidenceTick((n) => n + 1);
    },
    [navigateToInstrument],
  );

  const handleM1HandtestDocDiffRow = useCallback(
    (row: M1HandtestDocDiffRow) => {
      if (!isM1HandtestDocDiffCtaActionable(row.ctaKind)) return;
      const plan = planM1HandtestDocDiffCta(row.ctaKind);
      if (plan.openHandtest) {
        const alsoJump =
          plan.jumpPanel && isM1HandtestItemJumpable(row.jumpTarget) ? row.jumpTarget : undefined;
        void openM1EvidenceDoc('handtest');
        if (alsoJump) {
          handleHandtestItemJump(alsoJump);
        }
        // After open, also flash the matching handtest list item for observability
        window.setTimeout(() => {
          flashInstrument(
            `[data-testid="m1-handtest-item-${row.id}"], [data-testid="m1-handtest-jump-${row.id}"]`,
          );
        }, 120);
        return;
      }
      if (plan.jumpPanel && isM1HandtestItemJumpable(row.jumpTarget)) {
        handleHandtestItemJump(row.jumpTarget);
        window.setTimeout(() => {
          flashInstrument(
            `[data-testid="m1-handtest-item-${row.id}"], [data-testid="m1-handtest-jump-${row.id}"]`,
          );
        }, 80);
      }
    },
    [openM1EvidenceDoc, handleHandtestItemJump, flashInstrument],
  );

  const handleM1HandtestDocDiffPrimary = useCallback(() => {
    void openM1EvidenceDoc('handtest', { alsoJump: 'providers' });
    window.setTimeout(() => {
      flashInstrument('[data-testid="m1-handtest-doc-diff"], .st-demo-m1-docdiff');
    }, 80);
  }, [openM1EvidenceDoc, flashInstrument]);

  const handleM1ExitChip = useCallback(
    (chipId: string) => {
      const action = resolveM1ExitChipAction(chipId);
      if (action.kind === 'open-doc') {
        void openM1EvidenceDoc(action.openDoc, {
          alsoJump: chipId === 'handtest' ? 'providers' : undefined,
        });
        return;
      }
      if (action.kind === 'refresh') {
        setM1OpenDocFeedback({
          level: 'ok',
          message: action.hint,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'refresh',
          basename: null,
        });
        setExitEvidenceTick((n) => n + 1);
      }
    },
    [openM1EvidenceDoc],
  );

  const openM1DogfoodDay = useCallback(
    (date: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        setM1OpenDocFeedback({
          level: 'error',
          message: '日期非法（需 YYYY-MM-DD）',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'dogfood-day',
          basename: null,
        });
        return;
      }
      void openM1EvidenceDoc('dogfood-day', { date });
    },
    [openM1EvidenceDoc],
  );

  const copyM1HandtestPaste = useCallback(async () => {
    const paste = formatM1HandtestPaste({
      items: m1HandtestChecklist.items,
      sections: m1HandtestSectionBoard.sections,
      sectionSummary: m1HandtestSectionBoard.summary,
      docChecked: m1HandtestChecklist.docChecked,
      docTotal: m1HandtestChecklist.docTotal,
      livePass: m1HandtestChecklist.livePass,
      liveTotal: m1HandtestChecklist.liveTotal,
      externalPending: m1HandtestChecklist.externalPending,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(paste.markdown);
        setM1OpenDocFeedback({
          level: 'ok',
          message: paste.summary,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'handtest-paste',
          basename: null,
        });
      } else {
        setM1OpenDocFeedback({
          level: 'error',
          message: '剪贴板不可用，无法复制手测进度粘贴稿',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'handtest-paste',
          basename: null,
        });
      }
    } catch (err) {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制手测进度失败：' + (err instanceof Error ? err.message : 'clipboard-error'),
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'handtest-paste',
        basename: null,
      });
    }
  }, [
    m1HandtestChecklist.items,
    m1HandtestChecklist.docChecked,
    m1HandtestChecklist.docTotal,
    m1HandtestChecklist.livePass,
    m1HandtestChecklist.liveTotal,
    m1HandtestChecklist.externalPending,
    m1HandtestSectionBoard.sections,
    m1HandtestSectionBoard.summary,
    m1ExitEvidence.dualAutomatedOk,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
  ]);

  const copyM1HandtestDocDiff = useCallback(async () => {
    const paste = formatM1HandtestDocDiffPaste(m1HandtestDocDiff);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(paste);
        setM1OpenDocFeedback({
          level: 'ok',
          message: '已复制文档↔本机差异 · ' + m1HandtestDocDiff.summary + ' · 不关 M1',
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'handtest-doc-diff',
          basename: null,
        });
      } else {
        setM1OpenDocFeedback({
          level: 'error',
          message: '剪贴板不可用，无法复制文档↔本机差异',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'handtest-doc-diff',
          basename: null,
        });
      }
    } catch {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制文档↔本机差异失败',
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'handtest-doc-diff',
        basename: null,
      });
    }
  }, [m1HandtestDocDiff]);

  const copyM1SoftSnapshot = useCallback(async () => {
    const pendingLabels = m1HandtestChecklist.items
      .filter((it) => it.status !== 'pass')
      .map((it) => it.label);
    const snap = formatM1SoftSnapshot({
      connectionState: runtimeView.connectionState,
      hasActiveTask: Boolean(active),
      taskTitle: active?.title ?? null,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      agentFallbackCount: Array.isArray(agentBinding?.fallbackModelIds)
        ? agentBinding.fallbackModelIds.length
        : 0,
      sessionLevel: m1SessionReadiness.level,
      sessionSummary: m1SessionReadiness.summary ?? m1SessionReadiness.note ?? null,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestSoftLiveAllPass: m1HandtestChecklist.softLiveAllPass,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      pendingHandtestLabels: pendingLabels,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      nextKind: m1NextAction.kind,
      nextTitle: m1NextAction.title,
      nextCtaAction: m1NextAction.ctaAction,
      distinctMessageModelCount,
      manifestCount: manifestInspectViews.length,
      hasTraceEvents: projection.trace.length > 0,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(snap.markdown);
        setM1OpenDocFeedback({
          level: 'ok',
          message: snap.summary,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'soft-snapshot',
          basename: null,
        });
      } else {
        setM1OpenDocFeedback({
          level: 'error',
          message: '剪贴板不可用，无法复制 soft 快照',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'soft-snapshot',
          basename: null,
        });
      }
    } catch {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制 soft 快照失败（权限或环境限制）',
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'soft-snapshot',
        basename: null,
      });
    }
  }, [
    m1HandtestChecklist,
    runtimeView.connectionState,
    active,
    m1SessionReadiness,
    agentBinding,
    m1ExitEvidence,
    m1NextAction,
    distinctMessageModelCount,
    manifestInspectViews.length,
    projection.trace.length,
  ]);

  const m1SoftRegression = useMemo((): M1SoftRegressionMatrix => {
    return formatM1SoftRegressionMatrix({
      connectionState: runtimeView.connectionState,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestSoftLiveAllPass: m1HandtestChecklist.softLiveAllPass,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dogfoodDraftDays: m1ExitEvidence.dogfoodDraftDays,
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      agentFallbackCount: Array.isArray(agentBinding?.fallbackModelIds)
        ? agentBinding.fallbackModelIds.length
        : 0,
      sessionLevel: m1SessionReadiness.level,
      exitLevel: m1ExitEvidence.level,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      distinctMessageModelCount,
      hasTraceEvents: projection.trace.length > 0,
      manifestCount: manifestInspectViews.length,
      streamFailureRecoveryReady: true,
      softCraftRound: 65,
    });
  }, [
    runtimeView.connectionState,
    m1ExitEvidence,
    m1HandtestChecklist,
    m1SessionReadiness,
    agentBinding,
    distinctMessageModelCount,
    projection.trace.length,
    manifestInspectViews.length,
  ]);

  const m1EvidenceBundlePreview = useMemo(() => {
    return projectM1EvidenceBundlePreview({
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      externalGaps: m1SoftRegression.externalGaps,
      handGaps: m1SoftRegression.handGaps,
      autoPass: m1SoftRegression.autoPass,
      autoTotal: m1SoftRegression.autoTotal,
      hasDogfoodDraft: true,
      hasExitPath: true,
      hasDocDiff: true,
      hasDogfoodFill: true,
      hasExternalFocus: true,
    });
  }, [
    m1HandtestChecklist.docChecked,
    m1HandtestChecklist.docTotal,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
    m1ExitEvidence.hardGatesMet,
    m1ExitEvidence.level,
    m1SoftRegression.externalGaps,
    m1SoftRegression.handGaps,
    m1SoftRegression.autoPass,
    m1SoftRegression.autoTotal,
  ]);

  const m1ExitPath = useMemo((): M1ExitPathBoard => {
    return projectM1ExitPath({
      connectionOnline: runtimeView.connectionState === 'online',
      hasActiveTask: Boolean(active),
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      liveAheadCount: m1HandtestDocDiff.liveAhead,
      docAheadCount: m1HandtestDocDiff.docAhead,
      externalFocusId: m1ExternalFocus.focus?.id ?? null,
      externalFocusLabel: m1ExternalFocus.focus?.label ?? null,
      externalFocusSection: m1ExternalFocus.focus?.sectionLabel ?? null,
      externalFocusJumpTarget: m1ExternalFocus.focus?.jumpTarget ?? null,
      externalFocusJumpable: Boolean(m1ExternalFocus.focus?.jumpable),
      externalFocusPending: m1ExternalFocus.externalPending,
      dogfoodFillLevel: m1DogfoodFillBoard.level,
      dogfoodDraftDays: m1DogfoodFillBoard.draftDays,
      dogfoodScaffoldDays: m1DogfoodFillBoard.scaffoldDays,
      dogfoodMissingCount: m1DogfoodFillBoard.missingSlots.length,
      dogfoodFillPrimaryAction: m1DogfoodFillBoard.primaryCta.action,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      handtestItems: m1HandtestChecklist.items,
      softCraftRound: 65,
    });
  }, [
    runtimeView.connectionState,
    active,
    m1SessionReadiness.providersOk,
    m1SessionReadiness.modelsOk,
    m1SessionReadiness.providerCount,
    m1SessionReadiness.modelCount,
    m1SessionReadiness.secretCount,
    agentBinding?.defaultModelId,
    m1HandtestChecklist.docChecked,
    m1HandtestChecklist.docTotal,
    m1HandtestChecklist.livePass,
    m1HandtestChecklist.liveTotal,
    m1HandtestChecklist.externalPending,
    m1HandtestChecklist.items,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
    m1ExitEvidence.dogfoodFileCount,
    m1HandtestDocDiff.liveAhead,
    m1HandtestDocDiff.docAhead,
    m1DogfoodFillBoard.level,
    m1DogfoodFillBoard.draftDays,
    m1DogfoodFillBoard.scaffoldDays,
    m1DogfoodFillBoard.missingSlots.length,
    m1DogfoodFillBoard.primaryCta.action,
    m1ExternalFocus.focus?.id,
    m1ExternalFocus.focus?.label,
    m1ExternalFocus.focus?.sectionLabel,
    m1ExternalFocus.focus?.jumpTarget,
    m1ExternalFocus.focus?.jumpable,
    m1ExternalFocus.externalPending,
    m1ExitEvidence.dualAutomatedOk,
    m1ExitEvidence.hardGatesMet,
    m1ExitEvidence.level,
  ]);

  const m1SoftRegressionFilteredRows = useMemo(
    () => filterM1SoftRegressionRows(m1SoftRegression.rows, regressionListFilter),
    [m1SoftRegression.rows, regressionListFilter],
  );

  const m1SoftRegressionFilterCounts = useMemo(
    () => ({
      all: countM1SoftRegressionFilter(m1SoftRegression.rows, 'all'),
      gaps: countM1SoftRegressionFilter(m1SoftRegression.rows, 'gaps'),
      external: countM1SoftRegressionFilter(m1SoftRegression.rows, 'external'),
      'auto-fail': countM1SoftRegressionFilter(m1SoftRegression.rows, 'auto-fail'),
    }),
    [m1SoftRegression.rows],
  );

  const copyM1SoftRegression = useCallback(async () => {
    const matrix = m1SoftRegression;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(matrix.markdown);
        setM1OpenDocFeedback({
          level: 'ok',
          message: matrix.summary,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'soft-regression',
          basename: null,
        });
      } else {
        setM1OpenDocFeedback({
          level: 'error',
          message: '剪贴板不可用，无法复制 soft 回归矩阵',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'soft-regression',
          basename: null,
        });
      }
    } catch {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制 soft 回归矩阵失败（权限或环境限制）',
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'soft-regression',
        basename: null,
      });
    }
  }, [m1SoftRegression]);

  const handleM1SoftRegressionRow = useCallback(
    (rowId: string) => {
      const action = resolveM1SoftRegressionRowAction(rowId);
      if (action.kind === 'open-handtest') {
        void openM1EvidenceDoc('handtest', { alsoJump: 'providers' });
        return;
      }
      if (action.kind === 'open-dogfood') {
        void openM1EvidenceDoc('dogfood-today');
        return;
      }
      if (action.kind === 'jump-providers') {
        navigateToInstrument('providers');
        return;
      }
      if (action.kind === 'jump-agent') {
        navigateToInstrument('agent');
        return;
      }
      if (action.kind === 'jump-trace') {
        navigateToInstrument('trace');
        return;
      }
      if (action.kind === 'reconnect') {
        reconnectRuntime();
        setM1OpenDocFeedback({
          level: 'ok',
          message: action.hint,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'regression-reconnect',
          basename: null,
        });
        return;
      }
      if (action.kind === 'copy-matrix') {
        void copyM1SoftRegression();
      }
    },
    [openM1EvidenceDoc, navigateToInstrument, reconnectRuntime, copyM1SoftRegression],
  );

  const copyM1DogfoodDraft = useCallback(async () => {
    const externalLabels = m1HandtestChecklist.items
      .filter((it) => it.gate === 'external' && it.status !== 'pass')
      .map((it) => it.label);
    const draft = formatM1DogfoodDayDraft({
      // prefer local calendar day via formatter default when omitted
      connectionState: runtimeView.connectionState,
      hasActiveTask: Boolean(active),
      taskTitle: active?.title ?? null,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      agentFallbackCount: Array.isArray(agentBinding?.fallbackModelIds)
        ? agentBinding.fallbackModelIds.length
        : 0,
      sessionLevel: m1SessionReadiness.level,
      sessionSummary: m1SessionReadiness.summary ?? m1SessionReadiness.note ?? null,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      externalPendingLabels: externalLabels,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      nextKind: m1NextAction.kind,
      nextTitle: m1NextAction.title,
      distinctMessageModelCount,
      manifestCount: manifestInspectViews.length,
      hasTraceEvents: projection.trace.length > 0,
      softCraftRound: 65,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(draft.markdown);
        setM1OpenDocFeedback({
          level: 'ok',
          message: draft.summary,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'dogfood-draft',
          basename: draft.date + '.md',
        });
      } else {
        setM1OpenDocFeedback({
          level: 'error',
          message: '剪贴板不可用，无法复制 dogfood 草稿',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'dogfood-draft',
          basename: null,
        });
      }
    } catch (err) {
      setM1OpenDocFeedback({
        level: 'error',
        message:
          '复制 dogfood 草稿失败：' + (err instanceof Error ? err.message : 'clipboard-error'),
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'dogfood-draft',
        basename: null,
      });
    }
  }, [
    runtimeView.connectionState,
    active,
    m1SessionReadiness.providerCount,
    m1SessionReadiness.modelCount,
    m1SessionReadiness.secretCount,
    m1SessionReadiness.providersOk,
    m1SessionReadiness.modelsOk,
    m1SessionReadiness.level,
    m1SessionReadiness.summary,
    m1SessionReadiness.note,
    agentBinding?.defaultModelId,
    agentBinding?.fallbackModelIds,
    m1HandtestChecklist.items,
    m1HandtestChecklist.livePass,
    m1HandtestChecklist.liveTotal,
    m1HandtestChecklist.docChecked,
    m1HandtestChecklist.docTotal,
    m1HandtestChecklist.externalPending,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
    m1ExitEvidence.dogfoodFileCount,
    m1ExitEvidence.dualAutomatedOk,
    m1ExitEvidence.hardGatesMet,
    m1ExitEvidence.level,
    m1NextAction.kind,
    m1NextAction.title,
    distinctMessageModelCount,
    manifestInspectViews.length,
    projection.trace.length,
  ]);
  const handleM1DogfoodFillPrimary = useCallback(() => {
    const cta = m1DogfoodFillBoard.primaryCta;
    if (cta.action === 'none') return;
    if (cta.action === 'copy-draft') {
      void copyM1DogfoodDraft();
      return;
    }
    if (cta.action === 'open-today') {
      void openM1EvidenceDoc('dogfood-today');
      window.setTimeout(() => {
        flashInstrument('[data-testid="m1-dogfood-fill"], .st-demo-m1-dogfood-fill');
      }, 80);
      return;
    }
    // open-oldest-scaffold → open target day file
    if (cta.targetDate) {
      openM1DogfoodDay(cta.targetDate);
      window.setTimeout(() => {
        flashInstrument(
          `[data-testid="m1-dogfood-fill-row-${cta.targetDate}"], [data-testid="m1-dogfood-fill"]`,
        );
      }, 80);
    }
  }, [
    m1DogfoodFillBoard.primaryCta,
    copyM1DogfoodDraft,
    openM1EvidenceDoc,
    openM1DogfoodDay,
    flashInstrument,
  ]);

  const handleM1DogfoodFillRow = useCallback(
    (row: M1DogfoodFillDayRow) => {
      if (row.ctaAction === 'none') return;
      if (row.ctaAction === 'copy-draft') {
        void copyM1DogfoodDraft();
        return;
      }
      if (row.ctaAction === 'open-today') {
        void openM1EvidenceDoc('dogfood-today');
      } else {
        openM1DogfoodDay(row.date);
      }
      window.setTimeout(() => {
        flashInstrument(
          `[data-testid="m1-dogfood-fill-row-${row.date}"], [data-testid="m1-dogfood-day-${row.date}"]`,
        );
      }, 80);
    },
    [copyM1DogfoodDraft, openM1EvidenceDoc, openM1DogfoodDay, flashInstrument],
  );

  const copyM1DogfoodFillBoard = useCallback(async () => {
    const paste = formatM1DogfoodFillBoardPaste(m1DogfoodFillBoard, {
      softCraftRound: 65,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(paste);
        setM1OpenDocFeedback({
          level: 'ok',
          message:
            '已复制 dogfood 多日补填板 · ' +
            m1DogfoodFillBoard.summary +
            ' · 草稿不计有效日 · 不关 M1',
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'dogfood-fill-paste',
          basename: null,
        });
        return;
      }
      setM1OpenDocFeedback({
        level: 'warn',
        message: '剪贴板不可用 · 请手动复制补填板',
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'dogfood-fill-paste',
        basename: null,
      });
    } catch (err) {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制补填板失败 · ' + (err instanceof Error ? err.message : 'clipboard-error'),
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'dogfood-fill-paste',
        basename: null,
      });
    }
  }, [m1DogfoodFillBoard]);

  const copyM1ExternalFocusRunSheet = useCallback(async () => {
    const sheet = formatM1ExternalFocusRunSheet(m1ExternalFocus, {
      softCraftRound: 65,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sheet.markdown);
        setM1OpenDocFeedback({
          level: 'ok',
          message: sheet.summary + ' · 不关 M1',
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'external-focus-runsheet',
          basename: null,
        });
        window.setTimeout(() => {
          flashInstrument('[data-testid="m1-external-focus"], .st-demo-m1-extfocus');
        }, 60);
        return;
      }
      setM1OpenDocFeedback({
        level: 'warn',
        message: '剪贴板不可用 · 请手动复制外网运行单',
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'external-focus-runsheet',
        basename: null,
      });
    } catch (err) {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制外网运行单失败 · ' + (err instanceof Error ? err.message : 'clipboard-error'),
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'external-focus-runsheet',
        basename: null,
      });
    }
  }, [
    m1ExternalFocus,
    m1ExitEvidence.dualAutomatedOk,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
    flashInstrument,
  ]);

  const handleM1ExternalFocusCta = useCallback(
    (action: M1ExternalFocusCtaAction) => {
      if (!isM1ExternalFocusCtaActionable(action)) return;
      if (action === 'copy-runsheet') {
        void copyM1ExternalFocusRunSheet();
        return;
      }
      if (action === 'open-handtest') {
        void openM1EvidenceDoc('handtest', {
          alsoJump: m1ExternalFocus.focus?.jumpable
            ? m1ExternalFocus.focus.jumpTarget
            : 'providers',
        });
        window.setTimeout(() => {
          const focusId = m1ExternalFocus.focus?.id;
          if (focusId) {
            flashInstrument(
              '[data-testid="m1-handtest-item-' +
                focusId +
                '"], [data-testid="m1-handtest-jump-' +
                focusId +
                '"], [data-testid="m1-external-focus"]',
            );
          } else {
            flashInstrument(
              '[data-testid="m1-external-focus"], .st-demo-m1-extfocus, [data-testid="m1-handtest-checklist"]',
            );
          }
        }, 100);
        return;
      }
      if (action === 'jump-item') {
        const focus = m1ExternalFocus.focus;
        if (focus?.jumpable) {
          handleHandtestItemJump(focus.jumpTarget);
          window.setTimeout(() => {
            flashInstrument(
              '[data-testid="m1-handtest-item-' +
                focus.id +
                '"], [data-testid="m1-handtest-jump-' +
                focus.id +
                '"], [data-testid="m1-external-focus"]',
            );
          }, 80);
        } else {
          void openM1EvidenceDoc('handtest');
        }
        return;
      }
      if (action === 'filter-external') {
        if (m1ExternalFocus.level === 'soft-first') {
          setHandtestListFilter('gaps');
        } else {
          setHandtestListFilter('external');
        }
        window.setTimeout(() => {
          const focusId = m1ExternalFocus.focus?.id;
          flashInstrument(
            focusId
              ? '[data-testid="m1-handtest-item-' +
                  focusId +
                  '"], [data-testid="m1-handtest-list"], [data-testid="m1-external-focus"]'
              : '[data-testid="m1-handtest-list"], [data-testid="m1-handtest-filters"], [data-testid="m1-external-focus"]',
          );
        }, 60);
      }
    },
    [
      m1ExternalFocus,
      copyM1ExternalFocusRunSheet,
      openM1EvidenceDoc,
      handleHandtestItemJump,
      flashInstrument,
    ],
  );

  const copyM1EvidenceBundle = useCallback(async () => {
    const externalLabels = m1HandtestChecklist.items
      .filter((it) => it.gate === 'external' && it.status !== 'pass')
      .map((it) => it.label);
    const snap = formatM1SoftSnapshot({
      connectionState: runtimeView.connectionState,
      hasActiveTask: Boolean(active),
      taskTitle: active?.title ?? null,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      agentFallbackCount: Array.isArray(agentBinding?.fallbackModelIds)
        ? agentBinding.fallbackModelIds.length
        : 0,
      sessionLevel: m1SessionReadiness.level,
      sessionSummary: m1SessionReadiness.summary ?? m1SessionReadiness.note ?? null,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestSoftLiveAllPass: m1HandtestChecklist.softLiveAllPass,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      pendingHandtestLabels: externalLabels,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      nextKind: m1NextAction.kind,
      nextTitle: m1NextAction.title,
      nextCtaAction: m1NextAction.ctaAction,
      distinctMessageModelCount,
      manifestCount: manifestInspectViews.length,
      hasTraceEvents: projection.trace.length > 0,
    });
    const paste = formatM1HandtestPaste({
      items: m1HandtestChecklist.items,
      sections: m1HandtestSectionBoard.sections,
      sectionSummary: m1HandtestSectionBoard.summary,
      docChecked: m1HandtestChecklist.docChecked,
      docTotal: m1HandtestChecklist.docTotal,
      livePass: m1HandtestChecklist.livePass,
      liveTotal: m1HandtestChecklist.liveTotal,
      externalPending: m1HandtestChecklist.externalPending,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
    });
    const matrix = m1SoftRegression;
    const draft = formatM1DogfoodDayDraft({
      connectionState: runtimeView.connectionState,
      hasActiveTask: Boolean(active),
      taskTitle: active?.title ?? null,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      agentFallbackCount: Array.isArray(agentBinding?.fallbackModelIds)
        ? agentBinding.fallbackModelIds.length
        : 0,
      sessionLevel: m1SessionReadiness.level,
      sessionSummary: m1SessionReadiness.summary ?? m1SessionReadiness.note ?? null,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      externalPendingLabels: externalLabels,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      nextKind: m1NextAction.kind,
      nextTitle: m1NextAction.title,
      distinctMessageModelCount,
      manifestCount: manifestInspectViews.length,
      hasTraceEvents: projection.trace.length > 0,
      softCraftRound: 65,
    });
    const exitPathPaste = formatM1ExitPathPaste({
      connectionOnline: runtimeView.connectionState === 'online',
      hasActiveTask: Boolean(active),
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      handtestItems: m1HandtestChecklist.items,
      liveAheadCount: m1HandtestDocDiff.liveAhead,
      docAheadCount: m1HandtestDocDiff.docAhead,
      dogfoodFillLevel: m1DogfoodFillBoard.level,
      dogfoodDraftDays: m1DogfoodFillBoard.draftDays,
      dogfoodScaffoldDays: m1DogfoodFillBoard.scaffoldDays,
      dogfoodMissingCount: m1DogfoodFillBoard.missingSlots.length,
      dogfoodFillPrimaryAction: m1DogfoodFillBoard.primaryCta.action,
      externalFocusId: m1ExternalFocus.focus?.id ?? null,
      externalFocusLabel: m1ExternalFocus.focus?.label ?? null,
      externalFocusSection: m1ExternalFocus.focus?.sectionLabel ?? null,
      externalFocusJumpTarget: m1ExternalFocus.focus?.jumpTarget ?? null,
      externalFocusJumpable: Boolean(m1ExternalFocus.focus?.jumpable),
      externalFocusPending: m1ExternalFocus.externalPending,
      softCraftRound: 65,
    });
    const pack = formatM1EvidenceBundle({
      softCraftRound: 65,
      softSnapshotMarkdown: snap.markdown,
      handtestPasteMarkdown: paste.markdown,
      softRegressionMarkdown: matrix.markdown,
      dogfoodDraftMarkdown: draft.markdown,
      exitPathMarkdown: exitPathPaste.markdown,
      docDiffMarkdown: formatM1HandtestDocDiffPaste(m1HandtestDocDiff),
      externalFocusMarkdown: formatM1ExternalFocusRunSheet(m1ExternalFocus, {
        softCraftRound: 65,
      }).markdown,
      dogfoodFillMarkdown: formatM1DogfoodFillBoardPaste(m1DogfoodFillBoard, {
        softCraftRound: 65,
      }),
      nextKind: m1NextAction.kind,
      nextTitle: m1NextAction.title,
      nextBody: m1NextAction.body,
      nextCtaLabel: m1NextAction.ctaLabel,
      nextCtaAction: m1NextAction.ctaAction,
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      exitLevel: m1ExitEvidence.level,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      externalGaps: matrix.externalGaps,
      handGaps: matrix.handGaps,
      autoPass: matrix.autoPass,
      autoTotal: matrix.autoTotal,
      connectionState: runtimeView.connectionState,
      sessionLevel: m1SessionReadiness.level,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pack.markdown);
        setM1OpenDocFeedback({
          level: 'ok',
          message: pack.summary,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'evidence-bundle',
          basename: null,
        });
      } else {
        setM1OpenDocFeedback({
          level: 'error',
          message: '剪贴板不可用，无法复制 M1 证据包',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'evidence-bundle',
          basename: null,
        });
      }
    } catch (err) {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制 M1 证据包失败：' + (err instanceof Error ? err.message : 'clipboard-error'),
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'evidence-bundle',
        basename: null,
      });
    }
  }, [
    runtimeView.connectionState,
    active,
    m1SessionReadiness.providerCount,
    m1SessionReadiness.modelCount,
    m1SessionReadiness.secretCount,
    m1SessionReadiness.providersOk,
    m1SessionReadiness.modelsOk,
    m1SessionReadiness.level,
    m1SessionReadiness.summary,
    m1SessionReadiness.note,
    agentBinding?.defaultModelId,
    agentBinding?.fallbackModelIds,
    m1HandtestChecklist.items,
    m1HandtestChecklist.livePass,
    m1HandtestChecklist.liveTotal,
    m1HandtestChecklist.softLiveAllPass,
    m1HandtestChecklist.docChecked,
    m1HandtestChecklist.docTotal,
    m1HandtestDocDiff,
    m1DogfoodFillBoard,
    m1HandtestChecklist.externalPending,
    m1HandtestSectionBoard.sections,
    m1HandtestSectionBoard.summary,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
    m1ExitEvidence.dogfoodFileCount,
    m1ExitEvidence.dualAutomatedOk,
    m1ExitEvidence.hardGatesMet,
    m1ExitEvidence.level,
    m1NextAction.kind,
    m1NextAction.title,
    m1NextAction.body,
    m1NextAction.ctaLabel,
    m1NextAction.ctaAction,
    m1SoftRegression,
    distinctMessageModelCount,
    manifestInspectViews.length,
    projection.trace.length,
    m1ExternalFocus,
  ]);

  const copyM1ExitPath = useCallback(async () => {
    const paste = formatM1ExitPathPaste({
      connectionOnline: runtimeView.connectionState === 'online',
      hasActiveTask: Boolean(active),
      providersReadySoft: m1SessionReadiness.providersOk && m1SessionReadiness.modelsOk,
      providerCount: m1SessionReadiness.providerCount,
      modelCount: m1SessionReadiness.modelCount,
      secretCount: m1SessionReadiness.secretCount,
      agentDefaultSet: Boolean(agentBinding?.defaultModelId),
      handtestDocChecked: m1HandtestChecklist.docChecked,
      handtestDocTotal: m1HandtestChecklist.docTotal,
      handtestLivePass: m1HandtestChecklist.livePass,
      handtestLiveTotal: m1HandtestChecklist.liveTotal,
      handtestExternalPending: m1HandtestChecklist.externalPending,
      dogfoodRealDays: m1ExitEvidence.dogfoodRealDays,
      dogfoodRequired: m1ExitEvidence.dogfoodRequired,
      dogfoodFileCount: m1ExitEvidence.dogfoodFileCount,
      dualAutomatedOk: m1ExitEvidence.dualAutomatedOk,
      hardGatesMet: m1ExitEvidence.hardGatesMet,
      exitLevel: m1ExitEvidence.level,
      handtestItems: m1HandtestChecklist.items,
      liveAheadCount: m1HandtestDocDiff.liveAhead,
      docAheadCount: m1HandtestDocDiff.docAhead,
      dogfoodFillLevel: m1DogfoodFillBoard.level,
      dogfoodDraftDays: m1DogfoodFillBoard.draftDays,
      dogfoodScaffoldDays: m1DogfoodFillBoard.scaffoldDays,
      dogfoodMissingCount: m1DogfoodFillBoard.missingSlots.length,
      dogfoodFillPrimaryAction: m1DogfoodFillBoard.primaryCta.action,
      externalFocusId: m1ExternalFocus.focus?.id ?? null,
      externalFocusLabel: m1ExternalFocus.focus?.label ?? null,
      externalFocusSection: m1ExternalFocus.focus?.sectionLabel ?? null,
      externalFocusJumpTarget: m1ExternalFocus.focus?.jumpTarget ?? null,
      externalFocusJumpable: Boolean(m1ExternalFocus.focus?.jumpable),
      externalFocusPending: m1ExternalFocus.externalPending,
      softCraftRound: 65,
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(paste.markdown);
        setM1OpenDocFeedback({
          level: 'ok',
          message: paste.summary,
          dataOk: '1',
          dataCreated: '0',
          openDocId: 'exit-path',
          basename: null,
        });
      } else {
        setM1OpenDocFeedback({
          level: 'error',
          message: '剪贴板不可用，无法复制退出路径',
          dataOk: '0',
          dataCreated: '0',
          openDocId: 'exit-path',
          basename: null,
        });
      }
    } catch (err) {
      setM1OpenDocFeedback({
        level: 'error',
        message: '复制退出路径失败：' + (err instanceof Error ? err.message : 'clipboard-error'),
        dataOk: '0',
        dataCreated: '0',
        openDocId: 'exit-path',
        basename: null,
      });
    }
  }, [
    runtimeView.connectionState,
    active,
    m1SessionReadiness.providersOk,
    m1SessionReadiness.modelsOk,
    m1SessionReadiness.providerCount,
    m1SessionReadiness.modelCount,
    m1SessionReadiness.secretCount,
    agentBinding?.defaultModelId,
    m1HandtestChecklist.docChecked,
    m1HandtestChecklist.docTotal,
    m1HandtestChecklist.livePass,
    m1HandtestChecklist.liveTotal,
    m1HandtestChecklist.externalPending,
    m1HandtestChecklist.items,
    m1ExitEvidence.dogfoodRealDays,
    m1ExitEvidence.dogfoodRequired,
    m1ExitEvidence.dogfoodFileCount,
    m1ExitEvidence.dualAutomatedOk,
    m1ExitEvidence.hardGatesMet,
    m1ExitEvidence.level,
    m1DogfoodFillBoard,
    m1HandtestDocDiff,
    m1ExternalFocus,
  ]);

  const handleM1ExitPathStep = useCallback(
    (action: M1ExitPathCtaAction) => {
      if (action === 'open-handtest') {
        void openM1EvidenceDoc('handtest', { alsoJump: 'providers' });
        return;
      }
      if (action === 'open-dogfood') {
        void openM1EvidenceDoc('dogfood-today');
        return;
      }
      if (action === 'copy-dogfood-draft') {
        void copyM1DogfoodDraft();
        return;
      }
      if (action === 'copy-dogfood-fill') {
        void copyM1DogfoodFillBoard();
        window.setTimeout(() => {
          flashInstrument('[data-testid="m1-dogfood-fill"], .st-demo-m1-dogfood-fill');
        }, 80);
        return;
      }
      if (action === 'open-dogfood-fill') {
        // Prefer primary fill behavior: open today if empty, else open day / flash board
        const primary = m1DogfoodFillBoard.primaryCta;
        if (primary.action === 'open-today' || !primary.targetDate) {
          void openM1EvidenceDoc('dogfood-today');
        } else if (primary.action === 'copy-draft') {
          void copyM1DogfoodDraft();
        } else if (primary.targetDate) {
          openM1DogfoodDay(primary.targetDate);
        } else {
          void openM1EvidenceDoc('dogfood-today');
        }
        window.setTimeout(() => {
          flashInstrument(
            '[data-testid="m1-dogfood-fill"], .st-demo-m1-dogfood-fill, [data-testid="m1-exit-path-step-dogfood-fill-assist"]',
          );
        }, 100);
        return;
      }
      if (
        action === 'focus-external' ||
        action === 'jump-external-item' ||
        action === 'copy-external-runsheet'
      ) {
        if (action === 'copy-external-runsheet') {
          void copyM1ExternalFocusRunSheet();
          window.setTimeout(() => {
            flashInstrument(
              '[data-testid="m1-external-focus"], .st-demo-m1-extfocus, [data-testid="m1-exit-path-step-external-focus-assist"]',
            );
          }, 80);
          return;
        }
        if (action === 'jump-external-item') {
          const focus = m1ExternalFocus.focus;
          if (focus?.jumpable) {
            handleHandtestItemJump(focus.jumpTarget);
            window.setTimeout(() => {
              flashInstrument(
                '[data-testid="m1-handtest-item-' +
                  focus.id +
                  '"], [data-testid="m1-external-focus"], [data-testid="m1-exit-path-step-external-focus-assist"]',
              );
            }, 80);
          } else {
            handleM1ExternalFocusCta('open-handtest');
          }
          return;
        }
        handleM1ExternalFocusCta('filter-external');
        window.setTimeout(() => {
          flashInstrument(
            '[data-testid="m1-external-focus"], .st-demo-m1-extfocus, [data-testid="m1-exit-path-step-external-focus-assist"]',
          );
        }, 80);
        return;
      }
      if (action === 'copy-evidence-bundle') {
        void copyM1EvidenceBundle();
        return;
      }
      if (action === 'copy-handtest-paste') {
        void copyM1HandtestPaste();
        return;
      }
      if (action === 'jump-providers') {
        navigateToInstrument('providers');
        return;
      }
      if (action === 'jump-agent') {
        navigateToInstrument('agent');
        return;
      }
      if (action === 'jump-compose') {
        navigateToInstrument('compose');
      }
    },
    [
      openM1EvidenceDoc,
      copyM1DogfoodDraft,
      copyM1DogfoodFillBoard,
      openM1DogfoodDay,
      flashInstrument,
      m1DogfoodFillBoard.primaryCta,
      copyM1EvidenceBundle,
      copyM1HandtestPaste,
      navigateToInstrument,
      copyM1ExternalFocusRunSheet,
      m1ExternalFocus,
      handleHandtestItemJump,
      handleM1ExternalFocusCta,
    ],
  );

  const handleM1HardgateCta = useCallback(
    (action: M1HardgateCtaAction) => {
      if (!isM1HardgateCtaActionable(action)) return;
      if (action === 'open-handtest') {
        void openM1EvidenceDoc('handtest', { alsoJump: 'providers' });
        flashInstrument('[data-testid="m1-hardgate-strip"], [data-testid="m1-handtest-checklist"]');
        return;
      }
      if (action === 'open-dogfood-today') {
        void openM1EvidenceDoc('dogfood-today');
        flashInstrument('[data-testid="m1-hardgate-strip"], [data-testid="m1-dogfood-fill"]');
        return;
      }
      if (action === 'focus-external') {
        handleM1ExternalFocusCta('filter-external');
        flashInstrument('[data-testid="m1-external-focus"], [data-testid="m1-hardgate-strip"]');
        return;
      }
      if (action === 'open-dogfood-fill') {
        setM1ObsSecondaryOpen(true);
        flashInstrument('[data-testid="m1-dogfood-fill"], [data-testid="m1-hardgate-strip"]');
        void openM1EvidenceDoc('dogfood-today');
        return;
      }
      if (action === 'expand-secondary') {
        setM1ObsSecondaryOpen(true);
        flashInstrument('[data-testid="m1-exit-evidence"], [data-testid="m1-obs-secondary"]');
        return;
      }
      if (action === 'refresh-evidence') {
        setExitEvidenceTick((n) => n + 1);
        flashInstrument('[data-testid="m1-hardgate-strip"], [data-testid="m1-exit-evidence"]');
        return;
      }
      if (action === 'copy-exit-path') {
        void copyM1ExitPath();
        flashInstrument('[data-testid="m1-exit-path"], [data-testid="m1-hardgate-strip"]');
      }
    },
    [openM1EvidenceDoc, flashInstrument, handleM1ExternalFocusCta, copyM1ExitPath],
  );

  const handleM1NextAction = useCallback(() => {
    const action = m1NextAction.ctaAction;
    if (action === 'reconnect') {
      reconnectRuntime();
      return;
    }
    if (isM1NextDogfoodFillAction(action)) {
      if (action === 'copy-dogfood-fill') {
        void copyM1DogfoodFillBoard();
        window.setTimeout(() => {
          flashInstrument(
            '[data-testid="m1-dogfood-fill"], .st-demo-m1-dogfood-fill, [data-testid="m1-next-action"]',
          );
        }, 80);
        return;
      }
      const primary = m1DogfoodFillBoard.primaryCta;
      if (primary.action === 'open-today' || !primary.targetDate) {
        void openM1EvidenceDoc('dogfood-today');
      } else if (primary.action === 'copy-draft') {
        void copyM1DogfoodDraft();
      } else if (primary.targetDate) {
        openM1DogfoodDay(primary.targetDate);
      } else {
        void openM1EvidenceDoc('dogfood-today');
      }
      window.setTimeout(() => {
        flashInstrument(
          '[data-testid="m1-dogfood-fill"], .st-demo-m1-dogfood-fill, [data-testid="m1-next-action"]',
        );
      }, 100);
      return;
    }
    if (isM1NextExternalFocusAction(action)) {
      if (action === 'copy-external-runsheet') {
        void copyM1ExternalFocusRunSheet();
        window.setTimeout(() => {
          flashInstrument(
            '[data-testid="m1-external-focus"], .st-demo-m1-extfocus, [data-testid="m1-next-action"]',
          );
        }, 80);
        return;
      }
      if (action === 'jump-external-item') {
        const focus = m1ExternalFocus.focus;
        if (focus?.jumpable) {
          handleHandtestItemJump(focus.jumpTarget);
          window.setTimeout(() => {
            flashInstrument(
              '[data-testid="m1-handtest-item-' +
                focus.id +
                '"], [data-testid="m1-external-focus"], [data-testid="m1-next-action"]',
            );
          }, 80);
        } else {
          handleM1ExternalFocusCta('open-handtest');
        }
        return;
      }
      handleM1ExternalFocusCta('filter-external');
      window.setTimeout(() => {
        flashInstrument(
          '[data-testid="m1-external-focus"], .st-demo-m1-extfocus, [data-testid="m1-next-action"]',
        );
      }, 80);
      return;
    }
    if (isM1NextOpenDocAction(action)) {
      const id =
        m1NextAction.openDoc ?? (action === 'open-handtest' ? 'handtest' : 'dogfood-today');
      void openM1EvidenceDoc(id, {
        alsoJump: isM1NextActionJumpable(m1NextAction.jumpTarget)
          ? m1NextAction.jumpTarget
          : undefined,
      });
      return;
    }
    if (action === 'jump' && isM1NextActionJumpable(m1NextAction.jumpTarget)) {
      navigateToInstrument(m1NextAction.jumpTarget);
      return;
    }
    // refresh / discuss / idle
    setM1OpenDocFeedback({
      level: 'ok',
      message: '已刷新退出证据计数',
      dataOk: '1',
      dataCreated: '0',
      openDocId: 'refresh',
      basename: null,
    });
    setExitEvidenceTick((n) => n + 1);
  }, [
    m1NextAction.ctaAction,
    m1NextAction.openDoc,
    m1NextAction.jumpTarget,
    openM1EvidenceDoc,
    navigateToInstrument,
    reconnectRuntime,
    copyM1DogfoodFillBoard,
    copyM1DogfoodDraft,
    openM1DogfoodDay,
    flashInstrument,
    m1DogfoodFillBoard.primaryCta,
    copyM1ExternalFocusRunSheet,
    m1ExternalFocus,
    handleHandtestItemJump,
    handleM1ExternalFocusCta,
  ]);

  const handleStreamFailureCta = useCallback(() => {
    const action = conversationStreamReadiness.failureCtaAction as ConversationFailureCtaAction;
    if (!action || action === 'none') return;
    if (action === 'reconnect') {
      reconnectRuntime();
      return;
    }
    if (action === 'jump-providers') {
      navigateToInstrument('providers');
      return;
    }
    if (action === 'jump-agent') {
      navigateToInstrument('agent');
      return;
    }
    if (action === 'jump-memory') {
      navigateToInstrument('memory');
      return;
    }
    if (action === 'jump-trace') {
      navigateToInstrument('trace');
      return;
    }
    if (action === 'retry-compose') {
      // Soft: focus compose input; do not auto-resend (side-effect safety).
      window.setTimeout(() => {
        const el = document.querySelector(
          '[data-testid="compose-input"], .st-compose textarea, .st-compose [contenteditable="true"], .st-demo-compose-wrap textarea',
        ) as HTMLElement | null;
        if (el) {
          el.focus();
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        flashInstrument('[data-testid="compose-session-meta"], .st-demo-compose-wrap, .st-compose');
      }, 40);
    }
  }, [conversationStreamReadiness.failureCtaAction, reconnectRuntime, navigateToInstrument]);

  const taskTitle = active?.title ?? '选择或创建一个任务';
  const folderPath = active?.folderPath ?? '本地工作区';
  const taskStatus = active?.status ?? 'idle';
  const executionGraphView = useMemo(
    () =>
      runGraph
        ? projectM2ExecutionGraph(
            runGraph,
            runtimeView.eventHistory,
            artifactItems,
            agentVersionById,
          )
        : null,
    [runGraph, runtimeView.eventHistory, artifactItems, agentVersionById],
  );
  const selectedArtifactItem = useMemo(
    () =>
      artifactItems.find((item) => String(item.artifact.id) === selectedArtifactId) ??
      artifactItems[0] ??
      null,
    [artifactItems, selectedArtifactId],
  );
  const artifactVersionsView: ArtifactVersionsView | null = useMemo(
    () =>
      selectedArtifactItem
        ? {
            id: String(selectedArtifactItem.artifact.id),
            name: selectedArtifactItem.artifact.name,
            selectedVersionId: selectedArtifactItem.selectedVersionId
              ? String(selectedArtifactItem.selectedVersionId)
              : undefined,
            versions: selectedArtifactItem.versions.map((version) => ({
              id: String(version.id),
              artifactId: String(version.artifactId),
              version: version.version,
              sourceStepId: String(version.sourceStepId),
              status: version.status,
              contentHash: version.contentHash,
              mimeType: version.mimeType,
              parentVersionIds: version.parentVersionIds.map(String),
              createdAt: version.createdAt,
            })),
          }
        : null,
    [selectedArtifactItem],
  );
  const artifactMergeSteps: ArtifactMergeStepView[] = useMemo(
    () =>
      runGraph?.steps
        .filter((step) => step.kind === 'merge' && step.state === 'ready')
        .map((step) => ({
          id: String(step.id),
          title: step.title,
          dependsOn: step.dependsOn.map(String),
        })) ?? [],
    [runGraph],
  );
  const artifactConflictViews: ArtifactMergeConflictView[] = useMemo(
    () =>
      artifactConflicts.map(({ conflict, resolution }) => ({
        id: conflict.id,
        artifactId: String(conflict.artifactId),
        baseVersionId: String(conflict.baseVersionId),
        leftVersionId: String(conflict.leftVersionId),
        rightVersionId: String(conflict.rightVersionId),
        sourceStepId: conflict.sourceStepId ? String(conflict.sourceStepId) : undefined,
        createdAt: conflict.createdAt,
        resolution: resolution
          ? {
              strategy: resolution.strategy,
              resolutionVersionId: String(resolution.resolutionVersionId),
            }
          : undefined,
      })),
    [artifactConflicts],
  );
  const activeLeftTool = leftToolMeta[leftInstrument];
  const ActiveLeftToolIcon = activeLeftTool.icon;
  const activeLeftToolItem = leftInstrumentSwitch.items.find((item) => item.id === leftInstrument);
  const defaultModelOption = composeModels.find(
    (option) => option.modelId === agentBinding?.defaultModelId,
  );
  const selectedModelOption = safeSelectedModelId
    ? composeModels.find((option) => option.modelId === safeSelectedModelId)
    : undefined;
  const activeModelLabel =
    selectedModelOption?.label ??
    defaultModelOption?.label ??
    (agentBinding?.defaultModelId ? agentDefaultModelLabel : '尚未配置');
  const beginnerWorkspace = projectBeginnerWorkspace({
    hasActiveTask: Boolean(active),
    connectionState: runtimeView.connectionState,
    agentReady: Boolean(agentBinding?.defaultModelId && composeModels.length > 0),
    streaming: isStreaming,
    messageCount: projection.messages.length,
    artifactCount: artifactItems.length,
    approvalCount: approvalPendingCount,
  });
  const showConversationAlert =
    projection.messages.length + previewMessages.length > 0 &&
    (runtimeView.connectionState !== 'online' ||
      conversationStreamReadiness.failed ||
      conversationStreamReadiness.paused);

  const handleBeginnerAction = () => {
    if (beginnerWorkspace.action === 'reconnect') {
      reconnectRuntime();
      return;
    }
    if (beginnerWorkspace.action === 'agent') {
      navigateToInstrument('agent');
      return;
    }
    if (beginnerWorkspace.action === 'approvals') {
      setRightRailTab('approvals');
      return;
    }
    if (beginnerWorkspace.action === 'artifacts') {
      setRightRailTab('artifacts');
      return;
    }
    if (beginnerWorkspace.action === 'tasks') {
      dismissLeftDrawer(false);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[data-testid="workspace-nav"]')?.focus();
      }, 0);
      return;
    }
    if (beginnerWorkspace.action === 'compose') {
      window.setTimeout(() => {
        document.querySelector<HTMLTextAreaElement>('.st-compose__input')?.focus();
      }, 0);
    }
  };

  return (
    <AppShell
      theme={theme}
      hideReadiness
      traceTitle={rightRailTab === 'overview' ? '任务进度' : '执行详情'}
      traceAriaLabel="任务与执行详情"
      traceCollapsed={traceCollapsed}
      onTraceCollapsedChange={(collapsed) => {
        setTraceCollapsed(collapsed);
        writeTraceCollapsedPreference(collapsed);
      }}
      leftNav={
        <div className="st-demo-nav-stack">
          <header className="st-product-brand">
            <span className="st-product-brand__mark" aria-hidden="true">
              ST
            </span>
            <span className="st-product-brand__copy">
              <strong>SYNC-THINK</strong>
              <small>智能体工作台</small>
            </span>
          </header>
          <nav
            className="st-product-nav"
            data-testid="product-navigation"
            role="tablist"
            aria-label="主导航"
          >
            <button
              type="button"
              role="tab"
              className="st-product-nav__item"
              data-testid="product-nav-tasks"
              data-active={leftDrawerOpen ? '0' : '1'}
              aria-selected={!leftDrawerOpen}
              onClick={() => dismissLeftDrawer(false)}
            >
              <ListTodo aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>任务</span>
            </button>
            {leftPrimaryToolOrder.map((instrumentId) => {
              const item = leftInstrumentSwitch.items.find(
                (candidate) => candidate.id === instrumentId,
              );
              if (!item) return null;
              const ToolIcon = leftToolMeta[instrumentId].icon;
              const toolLabel = leftToolMeta[instrumentId].label;
              const pressed = leftDrawerOpen && leftInstrument === instrumentId;
              return (
                <button
                  key={instrumentId}
                  ref={(node) => {
                    leftToolButtonRefs.current[instrumentId] = node;
                  }}
                  type="button"
                  role="tab"
                  className="st-product-nav__item"
                  data-testid={item.testId}
                  data-id={instrumentId}
                  data-active={pressed ? '1' : '0'}
                  aria-selected={pressed}
                  onClick={() => {
                    const next = resolveLeftInstrumentDrawer(
                      { active: leftInstrument, open: leftDrawerOpen },
                      instrumentId,
                    );
                    setLeftInstrument(next.active);
                    setLeftDrawerOpen(next.open);
                  }}
                >
                  <ToolIcon aria-hidden="true" size={16} strokeWidth={1.8} />
                  <span>{toolLabel}</span>
                  {item.badge ? (
                    <em
                      className="st-product-nav__badge"
                      data-testid={`left-inst-badge-${instrumentId}`}
                    >
                      {item.badge}
                    </em>
                  ) : null}
                </button>
              );
            })}
          </nav>
          {navWorkspaces.length > 0 ? (
            <button
              type="button"
              className="st-product-new-task"
              onClick={() => {
                const workspaceId = active?.workspaceId ?? navWorkspaces[0]?.workspaceId;
                if (workspaceId) void createTask(workspaceId);
              }}
            >
              <Plus aria-hidden="true" size={15} strokeWidth={1.9} />
              新建任务
            </button>
          ) : null}
          <div className="st-demo-nav-stack__workspaces" data-instrument="workspaces">
            <WorkspaceNav
              hideReadiness
              hideFooter
              hideBrand
              sectionLabel="我的任务"
              searchPlaceholder="搜索任务…"
              createWorkspaceLabel="添加项目文件夹"
              workspaces={navWorkspaces}
              tasksByWorkspace={navTasks}
              activeTaskId={active?.taskId ?? null}
              query={navQuery}
              onQueryChange={setNavQuery}
              onSelectTask={(task) => void openTask(task)}
              onCreateWorkspace={() => void createWorkspace()}
              onCreateTask={(workspaceId) => void createTask(workspaceId)}
              onCreateChildTask={(workspaceId, parentTaskId) =>
                void createTask(workspaceId, { parentTaskId })
              }
              connectionState={runtimeView.connectionState}
              loading={workspaceLoading}
              footerDetail={
                workspaceError ? workspaceError : connectionDetail(runtimeView.connectionState)
              }
            />
          </div>
          <div
            className="st-demo-nav-stack__switch"
            data-testid="left-instrument-switch"
            data-active={leftInstrumentSwitch.active}
            data-open={leftDrawerOpen ? '1' : '0'}
            data-soft-craft={leftInstrumentSwitch.softCraftRound}
            data-claims-closed="0"
            role="navigation"
            aria-label="辅助导航"
          >
            {(() => {
              const item = leftInstrumentSwitch.items.find(
                (candidate) => candidate.id === 'memory',
              );
              const pressed = leftDrawerOpen && leftInstrument === 'memory';
              return (
                <button
                  ref={(node) => {
                    leftToolButtonRefs.current.memory = node;
                  }}
                  type="button"
                  className="st-product-nav__item st-product-nav__item--secondary"
                  data-testid={item?.testId ?? 'left-inst-memory'}
                  data-active={pressed ? '1' : '0'}
                  aria-pressed={pressed}
                  onClick={() => {
                    const next = resolveLeftInstrumentDrawer(
                      { active: leftInstrument, open: leftDrawerOpen },
                      'memory',
                    );
                    setLeftInstrument(next.active);
                    setLeftDrawerOpen(next.open);
                  }}
                >
                  <BrainCircuit aria-hidden="true" size={16} strokeWidth={1.8} />
                  <span>记忆</span>
                  {item?.badge ? <em className="st-product-nav__badge">{item.badge}</em> : null}
                </button>
              );
            })()}
          </div>
          <div
            className="st-demo-nav-stack__runtime"
            data-testid="left-runtime-status"
            data-state={runtimeView.connectionState}
            title={connectionDetail(runtimeView.connectionState)}
          >
            <span className="st-demo-nav-stack__runtime-dot" aria-hidden="true" />
            <span>Runtime {connectionDetail(runtimeView.connectionState).split(' · ')[0]}</span>
          </div>
          {leftDrawerOpen ? (
            <>
              <button
                type="button"
                className="st-demo-nav-stack__drawer-backdrop"
                data-testid="left-tool-drawer-backdrop"
                aria-label="关闭工具抽屉"
                tabIndex={-1}
                onClick={() => dismissLeftDrawer(false)}
              />
              <section
                className="st-demo-nav-stack__drawer"
                data-testid="left-tool-drawer"
                data-instrument={leftInstrument}
                role="dialog"
                aria-modal="true"
                aria-labelledby="left-tool-drawer-title"
              >
                <header className="st-demo-nav-stack__drawer-header">
                  <ActiveLeftToolIcon aria-hidden="true" size={17} strokeWidth={1.8} />
                  <strong id="left-tool-drawer-title">{activeLeftTool.label}</strong>
                  {activeLeftToolItem?.badge ? (
                    <span className="st-demo-nav-stack__drawer-badge">
                      {activeLeftToolItem.badge}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="st-demo-nav-stack__drawer-close"
                    aria-label="关闭工具抽屉"
                    title="关闭"
                    onClick={() => dismissLeftDrawer(true)}
                  >
                    <X aria-hidden="true" size={17} strokeWidth={1.8} />
                  </button>
                </header>
                <div className="st-demo-nav-stack__drawer-body">
                  <div
                    className="st-demo-nav-stack__providers"
                    data-instrument="providers"
                    data-active={leftInstrument === 'providers' ? '1' : '0'}
                    hidden={leftInstrument !== 'providers'}
                  >
                    <ProvidersPanel
                      providers={providers}
                      loading={providerLoading}
                      busy={providerBusy}
                      error={providerError}
                      statusNote={providerStatus}
                      onCreate={(input) => void createProvider(input)}
                      onUpdate={(input) => void updateProvider(input)}
                      onPreviewCcSwitchImport={() => previewCcSwitchImport()}
                      onImportCcSwitch={(sourceIds) => void importCcSwitch(sourceIds)}
                      onDiscover={(providerId) => void discoverProviderModels(providerId)}
                      onAddModel={(providerId, providerModelId, displayName) =>
                        void addProviderModel(providerId, providerModelId, displayName)
                      }
                      onProbeCapabilities={(providerId, modelId) =>
                        void probeProviderCapabilities(providerId, modelId)
                      }
                      onConfirmCapabilities={(modelId, capabilities, confirmed) =>
                        void confirmProviderCapabilities(modelId, capabilities, confirmed)
                      }
                    />
                  </div>
                  <div
                    className="st-demo-nav-stack__agent"
                    data-instrument="agent"
                    data-active={leftInstrument === 'agent' ? '1' : '0'}
                    hidden={leftInstrument !== 'agent'}
                  >
                    <AgentWorkspace
                      agents={agents}
                      selectedAgentId={selectedAgentId}
                      binding={agentBinding}
                      definition={agentDefinition}
                      versions={agentVersions}
                      allAgentVersions={allAgentVersions.map((version) => ({
                        agentVersionId: String(version.agentVersionId),
                        agentId: String(version.agentId),
                        agentName: version.name,
                        version: version.version,
                        reviewerCapable:
                          version.reviewBehavior.role === 'reviewer' ||
                          version.reviewBehavior.role === 'executor-reviewer',
                        title: version.name,
                      }))}
                      models={agentModels}
                      credentials={agentCredentials}
                      skills={skills}
                      skillBusy={skillBusy}
                      skillError={skillError}
                      skillStatusNote={skillStatus}
                      mcpServers={mcpServers}
                      mcpBusy={mcpBusy}
                      mcpProbeBusy={mcpProbeBusy}
                      mcpError={mcpError}
                      mcpStatusNote={mcpStatus}
                      loading={agentLoading}
                      busy={agentBusy}
                      error={agentError}
                      statusNote={agentStatus}
                      onSelectAgent={selectAgent}
                      onCreateAgent={() => void createAgent()}
                      onSaveDefinition={(input) => void saveAgentDefinition(input)}
                      onSave={(input) => void saveAgentBinding(input)}
                      onImportSkill={(md) => void importSkill(md)}
                      onRegisterMcp={(input) => void registerMcp(input)}
                      onProbeMcpPolicy={(input) => void probeMcpPolicy(input)}
                      onRequestMcpTool={(input) => void requestMcpTool(input)}
                      mcpRequestBusy={mcpRequestBusy}
                      onProbeMcpSpawn={(input) => void probeMcpSpawn(input)}
                      onCallMcpTool={(input) => void callMcpTool(input)}
                      onRefreshMcpTools={(input) => void refreshMcpTools(input)}
                      mcpCallBusy={mcpCallBusy}
                      mcpRefreshBusy={mcpRefreshBusy}
                      mcpSpawnBusy={mcpSpawnBusy}
                    />
                  </div>
                  <div
                    className="st-demo-nav-stack__memory"
                    data-instrument="memory"
                    data-active={leftInstrument === 'memory' ? '1' : '0'}
                    hidden={leftInstrument !== 'memory'}
                  >
                    <MemoryDiagnosticsPanel
                      entries={memoryEntries}
                      changes={memoryChanges}
                      diagnostics={diagnostics}
                      loading={memoryLoading}
                      busy={memoryBusy}
                      error={memoryError}
                      statusNote={memoryStatus}
                      onDecide={(input) => void decideMemoryChange(input)}
                      onRollback={(input) => void rollbackMemoryChange(input)}
                      onRefresh={() => void loadMemory()}
                      onNavigate={navigateFromDiagnostics}
                    />
                  </div>
                  <div
                    className="st-demo-nav-stack__approval"
                    data-instrument="approvals"
                    data-active={leftInstrument === 'approvals' ? '1' : '0'}
                    hidden={leftInstrument !== 'approvals'}
                  >
                    <ApprovalCenterPanel
                      items={approvalItems}
                      policies={approvalPolicies}
                      delegateAgentVersions={delegateAgentVersions}
                      defaultPolicyScope={
                        active ? { scopeType: 'task', scopeId: active.taskId } : undefined
                      }
                      pendingCount={approvalPendingCount}
                      humanOnlyActions={approvalHumanOnlyActions}
                      modes={approvalModes}
                      loading={approvalLoading}
                      busy={approvalBusy}
                      error={approvalError}
                      statusNote={approvalStatus}
                      onRefresh={() => void loadApprovals()}
                      onDecide={(input) => void decideApprovalItem(input)}
                      onSavePolicy={(input) => void saveApprovalPolicy(input)}
                      onNavigateToRunStep={(input) => void navigateToApprovalRunStep(input)}
                    />
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </div>
      }
      contextRail={
        <div className="st-demo-context">
          <header className="st-demo-task-header">
            <div className="st-demo-task-heading">
              <span className="st-demo-path" title={folderPath}>
                {active ? `${active.workspaceName} / 任务` : '任务'}
              </span>
              <div className="st-demo-task-heading__title">
                <h1>{taskTitle}</h1>
                <span className="st-demo-status" data-status={taskStatus}>
                  <span aria-hidden="true" /> {taskStatusLabel(taskStatus)}
                  {lastOpenedId && active?.taskId === lastOpenedId ? ' · 已恢复' : ''}
                </span>
              </div>
              <div className="st-task-runtime-summary">
                <button
                  type="button"
                  className="st-task-runtime-summary__agent"
                  data-testid="task-agent-summary"
                  onClick={() => navigateToInstrument('agent')}
                  title="打开智能体"
                >
                  <span
                    className="st-task-runtime-summary__avatar"
                    style={{
                      ['--st-agent-identity-color' as string]:
                        fallbackConversationAgentIdentity.color,
                    }}
                  >
                    <Bot aria-hidden="true" size={14} strokeWidth={1.9} />
                  </span>
                  <span>
                    <small>负责智能体</small>
                    <strong>{fallbackConversationAgentIdentity.name}</strong>
                  </span>
                </button>
                <button
                  type="button"
                  className="st-task-runtime-summary__model"
                  data-testid="task-model-summary"
                  onClick={() => navigateToInstrument('agent')}
                  title={activeModelLabel}
                >
                  <span className="st-task-runtime-summary__model-mark" aria-hidden="true" />
                  <span>
                    <small>运行模型</small>
                    <strong>{activeModelLabel}</strong>
                  </span>
                </button>
              </div>
            </div>
            <div className="st-demo-header-tools">
              <div className="st-demo-mode" aria-busy={modeBusy}>
                <ModeSwitch
                  hideReadiness
                  value={active?.participationMode ?? 'conversation'}
                  approvedPlan={automaticModeReadiness.approvedPlan}
                  applicablePolicy={automaticModeReadiness.applicablePolicy}
                  onChange={(mode) => void changeParticipationMode(mode)}
                />
                {modeError ? (
                  <p className="st-demo-mode__error" role="alert">
                    {modeError}
                  </p>
                ) : null}
                {visibleAutomaticRecovery?.kind === 'plan' ? (
                  <button
                    type="button"
                    data-testid="automatic-plan-cta"
                    disabled={modeBusy || planBusy}
                    onClick={() => void recoverAutomaticPlan()}
                  >
                    切到协作并准备计划
                  </button>
                ) : null}
                {visibleAutomaticRecovery?.kind === 'policy' ? (
                  <button
                    type="button"
                    data-testid="automatic-policy-cta"
                    onClick={() => setRightRailTab('approvals')}
                  >
                    打开审批策略
                  </button>
                ) : null}
              </div>
              <div
                className="st-demo-theme-switch st-demo-layout-switch"
                role="group"
                aria-label="对话布局"
                data-testid="conversation-layout-switch"
              >
                {conversationLayoutOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      title={option.label}
                      aria-pressed={conversationLayout === option.value}
                      data-selected={conversationLayout === option.value}
                      data-layout-option={option.value}
                      onClick={() => {
                        setConversationLayout(option.value);
                        writeConversationLayoutPreference(option.value);
                      }}
                    >
                      <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                    </button>
                  );
                })}
              </div>
              <div className="st-demo-theme-switch" role="group" aria-label="主题">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      title={option.label}
                      aria-pressed={theme === option.value}
                      data-selected={theme === option.value}
                      onClick={() => {
                        setTheme(option.value);
                        writeThemePreference(option.value as ThemePreference);
                      }}
                    >
                      <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                    </button>
                  );
                })}
              </div>
            </div>
          </header>
          <div
            className="st-beginner-next-step"
            data-testid="beginner-next-step"
            data-state={beginnerWorkspace.state}
          >
            <span className="st-beginner-next-step__icon" aria-hidden="true">
              <ArrowRight size={15} strokeWidth={2} />
            </span>
            <span className="st-beginner-next-step__copy">
              <strong>下一步</strong>
              <span>{beginnerWorkspace.nextAction}</span>
            </span>
            {beginnerWorkspace.actionLabel ? (
              <button type="button" onClick={handleBeginnerAction}>
                {beginnerWorkspace.actionLabel}
                <ArrowRight aria-hidden="true" size={13} strokeWidth={1.9} />
              </button>
            ) : (
              <span className="st-beginner-next-step__status">{beginnerWorkspace.statusLabel}</span>
            )}
          </div>
          {SHOW_M1_VALIDATION_WORKBENCH ? (
            <details
              className="st-demo-m1-obs"
              data-testid="m1-obs-layout"
              data-soft-craft={m1ObsLayout.softCraftRound}
              data-primary={m1ObsLayout.primaryOrder.join(',')}
              data-workspace-open={m1ObsWorkspaceOpen ? '1' : '0'}
              data-secondary-open={m1ObsSecondaryOpen ? '1' : '0'}
              data-claims-closed="0"
              aria-label="M1 观测布局"
              open={m1ObsWorkspaceOpen}
              onToggle={(event) => {
                setM1ObsWorkspaceOpen(event.currentTarget.open);
              }}
            >
              <summary className="st-demo-m1-obs__summary" data-testid="m1-obs-workspace-summary">
                <span
                  className="st-demo-m1-obs__status"
                  data-level={m1HardgateStrip.level}
                  aria-hidden="true"
                />
                <strong>{m1ObsLayout.workspaceLabel}</strong>
                <span className="st-demo-m1-obs__counts">
                  外网手测 {m1HardgateStrip.handtest.current}/{m1HardgateStrip.handtest.required}
                  <i aria-hidden="true" />
                  dogfood {m1HardgateStrip.dogfood.current}/{m1HardgateStrip.dogfood.required}
                </span>
                <small>{m1ObsLayout.workspaceHint}</small>
                <span className="st-demo-m1-obs__chevron" aria-hidden="true" />
              </summary>
              <div className="st-demo-m1-obs__body" data-testid="m1-obs-workspace-body">
                <div
                  className="st-demo-m1-rail"
                  data-testid="m1-obs-primary"
                  aria-label="M1 主路径"
                >
                  <div className="st-demo-m1-rail__head">
                    <span className="st-demo-m1-rail__kicker">主路径</span>
                    <strong data-testid="m1-obs-primary-summary">{m1ObsLayout.summary}</strong>
                    <small>soft · 不关 M1</small>
                  </div>
                  <div
                    className="st-demo-m1-hardgate"
                    data-testid="m1-hardgate-strip"
                    data-level={m1HardgateStrip.level}
                    data-hard={m1HardgateStrip.hardGatesMet ? '1' : '0'}
                    data-claims-closed="0"
                    data-soft-craft={m1HardgateStrip.softCraftRound}
                    data-handtest={m1HardgateStrip.handtest.percent}
                    data-dogfood={m1HardgateStrip.dogfood.percent}
                    data-primary-cta={m1HardgateStrip.primaryCta.action}
                    aria-label="M1 硬门槛进度"
                  >
                    <div className="st-demo-m1-hardgate__head">
                      <span className="st-demo-m1-hardgate__kicker">硬门槛</span>
                      <strong data-testid="m1-hardgate-summary">{m1HardgateStrip.summary}</strong>
                      <span
                        className="st-demo-m1-hardgate__level"
                        data-level={m1HardgateStrip.level}
                        data-testid="m1-hardgate-level"
                      >
                        {m1HardgateStrip.level === 'evidence-ready'
                          ? '可讨论'
                          : m1HardgateStrip.level === 'soft-only'
                            ? '仅 soft'
                            : m1HardgateStrip.level === 'partial'
                              ? '进行中'
                              : '未开始'}
                      </span>
                    </div>
                    <div className="st-demo-m1-hardgate__meters" data-testid="m1-hardgate-meters">
                      {m1HardgateStrip.meters.map((meter) => (
                        <div
                          key={meter.id}
                          className="st-demo-m1-hardgate__meter"
                          data-testid={`m1-hardgate-meter-${meter.id}`}
                          data-id={meter.id}
                          data-ok={meter.ok ? '1' : '0'}
                          data-partial={meter.partial ? '1' : '0'}
                          data-percent={meter.percent}
                        >
                          <div className="st-demo-m1-hardgate__meter-top">
                            <span className="st-demo-m1-hardgate__meter-label">{meter.label}</span>
                            <span
                              className="st-demo-m1-hardgate__meter-badge"
                              data-ok={meter.ok ? '1' : '0'}
                            >
                              {meter.badge}
                            </span>
                            <span className="st-demo-m1-hardgate__meter-frac">
                              {meter.current}/{meter.required}
                            </span>
                          </div>
                          <div
                            className="st-demo-m1-hardgate__bar"
                            role="progressbar"
                            aria-valuenow={meter.percent}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={meter.label}
                          >
                            <i
                              style={{ width: `${meter.percent}%` }}
                              data-ok={meter.ok ? '1' : '0'}
                            />
                          </div>
                          <p className="st-demo-m1-hardgate__meter-detail">{meter.detail}</p>
                          <button
                            type="button"
                            className="st-demo-m1-hardgate__meter-cta"
                            data-testid={`m1-hardgate-meter-cta-${meter.id}`}
                            data-action={meter.ctaAction}
                            onClick={() => handleM1HardgateCta(meter.ctaAction)}
                          >
                            {meter.ctaLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="st-demo-m1-hardgate__actions">
                      <button
                        type="button"
                        className="st-demo-m1-hardgate__cta"
                        data-testid="m1-hardgate-primary-cta"
                        data-action={m1HardgateStrip.primaryCta.action}
                        onClick={() => handleM1HardgateCta(m1HardgateStrip.primaryCta.action)}
                      >
                        {m1HardgateStrip.primaryCta.label}
                      </button>
                      {m1HardgateStrip.secondaryCtas.slice(0, 3).map((cta) => (
                        <button
                          key={cta.action}
                          type="button"
                          className="st-demo-m1-hardgate__ghost"
                          data-testid={`m1-hardgate-secondary-${cta.action}`}
                          data-action={cta.action}
                          onClick={() => handleM1HardgateCta(cta.action)}
                        >
                          {cta.label}
                        </button>
                      ))}
                    </div>
                    <p className="st-demo-m1-hardgate__note" data-testid="m1-hardgate-note">
                      {m1HardgateStrip.note}
                    </p>
                  </div>
                  <div
                    className="st-demo-m1-next"
                    data-testid="m1-next-action"
                    data-kind={m1NextAction.kind}
                    data-level={m1NextAction.level}
                    data-gate={m1NextAction.gate}
                    data-cta-action={m1NextAction.ctaAction}
                    data-fill-level={m1DogfoodFillBoard.level}
                    aria-label="M1 下一步行动"
                  >
                    <div className="st-demo-m1-next__head">
                      <span className="st-demo-m1-next__kicker">下一步</span>
                      <strong data-testid="m1-next-title">{m1NextAction.title}</strong>
                      <span
                        className="st-demo-m1-next__gate"
                        data-testid="m1-next-gate"
                        data-gate={m1NextAction.gate}
                      >
                        {m1NextAction.gate === 'hard' ? '硬门槛' : '本机 soft'}
                      </span>
                    </div>
                    <p className="st-demo-m1-next__body" data-testid="m1-next-body">
                      {m1NextAction.body}
                    </p>
                    <div className="st-demo-m1-next__actions">
                      <button
                        type="button"
                        className="st-demo-m1-next__cta"
                        data-testid="m1-next-cta"
                        data-action={m1NextAction.ctaAction}
                        data-jump={m1NextAction.jumpTarget}
                        data-cta-action={m1NextAction.ctaAction}
                        data-open-doc={m1NextAction.openDoc ?? ''}
                        onClick={handleM1NextAction}
                      >
                        {m1NextAction.ctaLabel}
                      </button>
                      <small data-testid="m1-next-priority">P{m1NextAction.priority}</small>
                    </div>
                  </div>
                  <div
                    className="st-demo-m1-extfocus"
                    data-testid="m1-external-focus"
                    data-level={m1ExternalFocus.level}
                    data-pending={m1ExternalFocus.externalPending}
                    data-total={m1ExternalFocus.externalTotal}
                    data-pass={m1ExternalFocus.externalPass}
                    data-soft-gaps={m1ExternalFocus.softLiveGaps}
                    data-focus-id={m1ExternalFocus.focus?.id ?? ''}
                    data-focus-section={m1ExternalFocus.focus?.section ?? ''}
                    data-primary-cta={m1ExternalFocus.primaryCta.action}
                    data-claims-closed="0"
                    data-claims-doc="0"
                    aria-label="下一外网手测项聚焦 · 不关 M1"
                  >
                    <div className="st-demo-m1-extfocus__head">
                      <span className="st-demo-m1-extfocus__kicker">下一外网项</span>
                      <strong data-testid="m1-external-focus-title">{m1ExternalFocus.title}</strong>
                      <span
                        className="st-demo-m1-extfocus__level"
                        data-level={m1ExternalFocus.level}
                        data-testid="m1-external-focus-level"
                      >
                        {m1ExternalFocus.level === 'focus'
                          ? '待证'
                          : m1ExternalFocus.level === 'soft-first'
                            ? '先 soft'
                            : m1ExternalFocus.level === 'clear'
                              ? '队列空'
                              : '空'}
                      </span>
                    </div>
                    <p className="st-demo-m1-extfocus__body" data-testid="m1-external-focus-body">
                      {m1ExternalFocus.body}
                    </p>
                    <div
                      className="st-demo-m1-extfocus__chips"
                      data-testid="m1-external-focus-chips"
                    >
                      <span data-kind="pending">
                        外网待证 {m1ExternalFocus.externalPending}/{m1ExternalFocus.externalTotal}
                      </span>
                      <span data-kind="pass">外网 soft 见过 {m1ExternalFocus.externalPass}</span>
                      <span data-kind="doc">
                        文档 {m1ExternalFocus.docChecked}/{m1ExternalFocus.docTotal}
                      </span>
                      <span data-kind="soft">本机缺口 {m1ExternalFocus.softLiveGaps}</span>
                    </div>
                    {m1ExternalFocus.focus ? (
                      <div
                        className="st-demo-m1-extfocus__focus"
                        data-testid="m1-external-focus-card"
                        data-item={m1ExternalFocus.focus.id}
                        data-section={m1ExternalFocus.focus.section}
                        data-jumpable={m1ExternalFocus.focus.jumpable ? '1' : '0'}
                      >
                        <span className="st-demo-m1-extfocus__sec">
                          {m1ExternalFocus.focus.sectionLabel}
                        </span>
                        <span className="st-demo-m1-extfocus__label">
                          {m1ExternalFocus.focus.label}
                        </span>
                        <span className="st-demo-m1-extfocus__detail">
                          {m1ExternalFocus.focus.detail}
                        </span>
                        <span className="st-demo-m1-extfocus__hint">
                          {m1ExternalFocus.focus.hint}
                        </span>
                      </div>
                    ) : null}
                    {m1ExternalFocus.queue.length > 0 ? (
                      <ul
                        className="st-demo-m1-extfocus__queue"
                        data-testid="m1-external-focus-queue"
                        data-count={m1ExternalFocus.queue.length}
                      >
                        {m1ExternalFocus.queue.map((q) => (
                          <li
                            key={q.id}
                            data-item={q.id}
                            data-section={q.section}
                            data-testid={'m1-external-focus-queue-' + q.id}
                          >
                            <span className="st-demo-m1-extfocus__q-sec">{q.section}</span>
                            <span className="st-demo-m1-extfocus__q-label">{q.label}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div
                      className="st-demo-m1-extfocus__actions"
                      data-testid="m1-external-focus-actions"
                    >
                      {isM1ExternalFocusCtaActionable(m1ExternalFocus.primaryCta.action) ? (
                        <button
                          type="button"
                          className="st-demo-m1-extfocus__primary"
                          data-testid="m1-external-focus-primary"
                          data-action={m1ExternalFocus.primaryCta.action}
                          title={m1ExternalFocus.primaryCta.label}
                          onClick={() =>
                            handleM1ExternalFocusCta(m1ExternalFocus.primaryCta.action)
                          }
                        >
                          {m1ExternalFocus.primaryCta.label}
                        </button>
                      ) : null}
                      {m1ExternalFocus.secondaryCtas.map((cta) => (
                        <button
                          key={cta.action}
                          type="button"
                          className="st-demo-m1-extfocus__secondary"
                          data-testid={'m1-external-focus-cta-' + cta.action}
                          data-action={cta.action}
                          title={cta.label}
                          onClick={() => handleM1ExternalFocusCta(cta.action)}
                        >
                          {cta.label}
                        </button>
                      ))}
                    </div>
                    <p className="st-demo-m1-extfocus__note" data-testid="m1-external-focus-note">
                      {m1ExternalFocus.summary} · 点主按钮跳面板/开文档 · 复制运行单可离线填 ·
                      不自动勾 · 不关 M1
                    </p>
                  </div>
                  <div
                    className="st-demo-m1-path"
                    data-testid="m1-exit-path"
                    data-level={m1ExitPath.level}
                    data-progress={m1ExitPath.progressPercent}
                    data-remaining-hard={m1ExitPath.remainingHardSteps}
                    data-remaining-soft={m1ExitPath.remainingSoftSteps}
                    data-claims-closed="0"
                    data-focus={m1ExitPath.focusStepId ?? ''}
                    aria-label="M1 退出路径"
                  >
                    <div className="st-demo-m1-path__head">
                      <span className="st-demo-m1-path__kicker">退出路径</span>
                      <strong data-testid="m1-exit-path-summary">{m1ExitPath.summary}</strong>
                      <span
                        className="st-demo-m1-path__progress"
                        data-testid="m1-exit-path-progress"
                        data-percent={m1ExitPath.progressPercent}
                        title="本路径只展示证据进度，M1 状态以验证区为准"
                      >
                        {m1ExitPath.progressPercent}%
                      </span>
                      <button
                        type="button"
                        className="st-demo-m1-path__copy"
                        data-testid="m1-exit-path-copy"
                        data-action="copy-exit-path"
                        title="复制有序退出路径（不含密钥 · 不关 M1）"
                        onClick={() => void copyM1ExitPath()}
                      >
                        复制路径
                      </button>
                    </div>
                    <div
                      className="st-demo-m1-path__bar"
                      data-testid="m1-exit-path-bar"
                      aria-hidden="true"
                    >
                      <span
                        className="st-demo-m1-path__bar-fill"
                        style={{ width: m1ExitPath.progressPercent + '%' }}
                      />
                    </div>
                    <ol className="st-demo-m1-path__steps" data-testid="m1-exit-path-steps">
                      {m1ExitPath.steps.map((step) => {
                        const actionable = isM1ExitPathStepActionable(step.ctaAction);
                        const focused = step.id === m1ExitPath.focusStepId;
                        return (
                          <li
                            key={step.id}
                            data-step={step.id}
                            data-kind={step.kind}
                            data-status={step.status}
                            data-gate={step.gate}
                            data-focus={focused ? '1' : '0'}
                            data-testid={`m1-exit-path-step-${step.id}`}
                          >
                            <span className="st-demo-m1-path__order">{step.order}</span>
                            <div className="st-demo-m1-path__main">
                              <span className="st-demo-m1-path__title">{step.title}</span>
                              <span className="st-demo-m1-path__detail">{step.detail}</span>
                            </div>
                            <span className="st-demo-m1-path__status" data-status={step.status}>
                              {step.status === 'done'
                                ? '完成'
                                : step.status === 'doing'
                                  ? '进行中'
                                  : step.status === 'blocked'
                                    ? '阻塞'
                                    : '待做'}
                            </span>
                            {actionable ? (
                              <button
                                type="button"
                                className="st-demo-m1-path__cta"
                                data-testid={`m1-exit-path-cta-${step.id}`}
                                data-action={step.ctaAction}
                                data-focus={focused ? '1' : '0'}
                                title={step.detail}
                                onClick={() => handleM1ExitPathStep(step.ctaAction)}
                              >
                                {step.ctaLabel}
                              </button>
                            ) : (
                              <span className="st-demo-m1-path__cta-na">—</span>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                    <p className="st-demo-m1-path__hint" data-testid="m1-exit-path-hint">
                      有序硬门槛辅助 · 不自动勾手测 · 不写 dogfood · 进度封顶 99% · M2 已完成 ·
                      仍不自动关 M1
                    </p>
                  </div>
                </div>
                <details
                  className="st-demo-m1-more"
                  data-testid="m1-obs-secondary"
                  open={m1ObsSecondaryOpen}
                  onToggle={(e) => {
                    const el = e.currentTarget as HTMLDetailsElement;
                    setM1ObsSecondaryOpen(el.open);
                  }}
                >
                  <summary
                    className="st-demo-m1-more__summary"
                    data-testid="m1-obs-secondary-summary"
                  >
                    <span className="st-demo-m1-more__kicker">更多 soft 观测</span>
                    <strong>{m1ObsLayout.secondarySummary}</strong>
                    <em data-testid="m1-obs-secondary-hint">
                      {m1ObsSecondaryOpen ? '收起' : '展开'}
                    </em>
                  </summary>
                  <div className="st-demo-m1-more__body" data-testid="m1-obs-secondary-body">
                    <div
                      className="st-demo-m1-strip"
                      data-testid="m1-session-readiness"
                      data-level={m1SessionReadiness.level}
                      aria-label="M1 会话就绪"
                    >
                      <div className="st-demo-m1-strip__head">
                        <span className="st-demo-m1-strip__kicker">会话就绪</span>
                        <strong data-testid="m1-session-summary">
                          {m1SessionReadiness.summary}
                        </strong>
                        <small>M1 soft · 非退出证据</small>
                      </div>
                      <ul className="st-demo-m1-strip__chips" data-testid="m1-session-chips">
                        {m1SessionReadiness.chips.map((chip) => {
                          const jumpable = isM1SessionChipJumpable(chip.jumpTarget);
                          return (
                            <li
                              key={chip.id}
                              data-ok={chip.ok}
                              data-jump={chip.jumpTarget}
                              data-jumpable={jumpable ? '1' : '0'}
                              data-testid={`m1-session-chip-${chip.id}`}
                            >
                              {jumpable ? (
                                <button
                                  type="button"
                                  className="st-demo-m1-strip__chip-btn"
                                  title={chip.jumpHint}
                                  aria-label={`${chip.label}：${chip.detail}。${chip.jumpHint}`}
                                  data-testid={`m1-session-chip-jump-${chip.id}`}
                                  onClick={() => handleSessionChipJump(chip.jumpTarget)}
                                >
                                  <span className="st-demo-m1-strip__chip-label">{chip.label}</span>
                                  <span className="st-demo-m1-strip__chip-detail">
                                    {chip.detail}
                                  </span>
                                </button>
                              ) : (
                                <span
                                  className="st-demo-m1-strip__chip-static"
                                  title={chip.jumpHint}
                                  aria-label={`${chip.label}：${chip.detail}`}
                                >
                                  <span className="st-demo-m1-strip__chip-label">{chip.label}</span>
                                  <span className="st-demo-m1-strip__chip-detail">
                                    {chip.detail}
                                  </span>
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="st-demo-m1-strip__note" data-testid="m1-session-note">
                        {m1SessionReadiness.note}
                      </p>
                    </div>
                    <div
                      className="st-demo-m1-exit"
                      data-testid="m1-exit-evidence"
                      data-level={m1ExitEvidence.level}
                      data-hard={m1ExitEvidence.hardGatesMet ? '1' : '0'}
                      aria-label="M1 退出证据进度"
                    >
                      <div className="st-demo-m1-exit__head">
                        <span className="st-demo-m1-exit__kicker">退出证据</span>
                        <strong data-testid="m1-exit-summary">{m1ExitEvidence.summary}</strong>
                        <button
                          type="button"
                          className="st-demo-m1-exit__refresh"
                          data-testid="m1-exit-refresh"
                          title="重新读取手测清单与 dogfood 日记"
                          onClick={() => setExitEvidenceTick((n) => n + 1)}
                        >
                          刷新
                        </button>
                        <button
                          type="button"
                          className="st-demo-m1-exit__copy"
                          data-testid="m1-soft-snapshot-copy"
                          data-action="copy-soft-snapshot"
                          title="复制本机 soft 快照到剪贴板，便于粘贴到手测备注或 dogfood（不含密钥，不能替代外网手测）"
                          onClick={() => void copyM1SoftSnapshot()}
                        >
                          复制 soft 快照
                        </button>
                        <button
                          type="button"
                          className="st-demo-m1-exit__copy"
                          data-testid="m1-dogfood-draft-copy"
                          data-action="copy-dogfood-draft"
                          title="复制今日 dogfood 日记草稿到剪贴板（含 soft 状态 · 非自动写盘 · 不能直接算有效日）"
                          onClick={() => void copyM1DogfoodDraft()}
                        >
                          复制 dogfood 草稿
                        </button>
                        <button
                          type="button"
                          className="st-demo-m1-exit__copy"
                          data-testid="m1-soft-regression-copy"
                          data-action="copy-soft-regression"
                          title="复制 soft 回归矩阵（自动 vs 手测 · 不含密钥 · 不能替代外网手测）"
                          onClick={() => void copyM1SoftRegression()}
                        >
                          复制回归矩阵
                        </button>
                        <button
                          type="button"
                          className="st-demo-m1-exit__copy st-demo-m1-exit__copy--primary"
                          data-testid="m1-evidence-bundle-copy"
                          data-action="copy-evidence-bundle"
                          title="一键复制 soft 证据包：快照 + 手测进度 + 回归 + 退出路径 + 文档差异 + dogfood 草稿 + 下一步（不含密钥 · 不关 M1）"
                          onClick={() => void copyM1EvidenceBundle()}
                        >
                          导出证据包
                        </button>
                        <button
                          type="button"
                          className="st-demo-m1-exit__copy"
                          data-testid="m1-exit-path-copy-head"
                          data-action="copy-exit-path"
                          title="复制 M1 退出路径（有序硬门槛步骤 · 不含密钥）"
                          onClick={() => void copyM1ExitPath()}
                        >
                          复制退出路径
                        </button>
                        <small>硬门槛 · 不自动关 M1</small>
                      </div>
                      <div
                        className="st-demo-m1-bundle"
                        data-testid="m1-evidence-bundle"
                        data-level={m1EvidenceBundlePreview.level}
                        data-claims-closed="0"
                        data-sections={M1_EVIDENCE_BUNDLE_SECTIONS.length}
                        aria-label="M1 soft 证据包导出"
                      >
                        <div className="st-demo-m1-bundle__head">
                          <span className="st-demo-m1-bundle__kicker">证据包</span>
                          <strong data-testid="m1-evidence-bundle-headline">
                            {m1EvidenceBundlePreview.headline}
                          </strong>
                          <button
                            type="button"
                            className="st-demo-m1-bundle__export"
                            data-testid="m1-evidence-bundle-export"
                            data-action="copy-evidence-bundle"
                            title="一键复制完整 soft 证据包到剪贴板"
                            onClick={() => void copyM1EvidenceBundle()}
                          >
                            一键导出
                          </button>
                        </div>
                        <p
                          className="st-demo-m1-bundle__detail"
                          data-testid="m1-evidence-bundle-detail"
                        >
                          {m1EvidenceBundlePreview.detail}
                        </p>
                        <ul className="st-demo-m1-bundle__toc" data-testid="m1-evidence-bundle-toc">
                          {M1_EVIDENCE_BUNDLE_SECTIONS.map((sec) => (
                            <li
                              key={sec.id}
                              data-section={sec.id}
                              data-required={sec.required ? '1' : '0'}
                              data-testid={`m1-evidence-bundle-sec-${sec.id}`}
                            >
                              <span>{sec.title}</span>
                              <em>{sec.required ? '必含' : '可选'}</em>
                            </li>
                          ))}
                        </ul>
                        <p
                          className="st-demo-m1-bundle__hint"
                          data-testid="m1-evidence-bundle-hint"
                        >
                          粘贴辅助 · 不含密钥 · 不自动勾手测 · 不写 dogfood · 不关 M1
                        </p>
                      </div>
                      <ul className="st-demo-m1-exit__chips" data-testid="m1-exit-chips">
                        {m1ExitEvidence.chips.map((chip) => {
                          const actionable = isM1ExitChipActionable(chip.id);
                          const chipAction = resolveM1ExitChipAction(chip.id);
                          const openDoc = chipAction.kind === 'open-doc' ? chipAction.openDoc : '';
                          return (
                            <li
                              key={chip.id}
                              data-ok={chip.ok}
                              data-actionable={actionable ? '1' : '0'}
                              data-chip-action={chipAction.kind}
                              data-open-doc={openDoc}
                              data-testid={`m1-exit-chip-${chip.id}`}
                            >
                              {actionable ? (
                                <button
                                  type="button"
                                  className="st-demo-m1-exit__chip-btn"
                                  data-testid={`m1-exit-chip-btn-${chip.id}`}
                                  title={chipAction.hint}
                                  onClick={() => handleM1ExitChip(chip.id)}
                                >
                                  <span className="st-demo-m1-exit__chip-label">{chip.label}</span>
                                  <span className="st-demo-m1-exit__chip-detail">
                                    {chip.detail}
                                  </span>
                                </button>
                              ) : (
                                <>
                                  <span className="st-demo-m1-exit__chip-label">{chip.label}</span>
                                  <span className="st-demo-m1-exit__chip-detail">
                                    {chip.detail}
                                  </span>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <div
                        className="st-demo-m1-dogfood-fill"
                        data-testid="m1-dogfood-fill"
                        data-level={m1DogfoodFillBoard.level}
                        data-real={m1DogfoodFillBoard.realDays}
                        data-required={m1DogfoodFillBoard.required}
                        data-remaining={m1DogfoodFillBoard.remainingDays}
                        data-draft={m1DogfoodFillBoard.draftDays}
                        data-scaffold={m1DogfoodFillBoard.scaffoldDays}
                        data-missing={m1DogfoodFillBoard.missingSlots.length}
                        data-primary-cta={m1DogfoodFillBoard.primaryCta.action}
                        data-claims-closed="0"
                        data-claims-dogfood-real="0"
                        aria-label="dogfood 多日补填板 · 草稿不计有效日 · 不关 M1"
                      >
                        <div className="st-demo-m1-dogfood-fill__head">
                          <span className="st-demo-m1-dogfood-fill__kicker">dogfood 补填</span>
                          <strong data-testid="m1-dogfood-fill-summary">
                            {m1DogfoodFillBoard.summary}
                          </strong>
                          <span
                            className="st-demo-m1-dogfood-fill__level"
                            data-level={m1DogfoodFillBoard.level}
                            data-testid="m1-dogfood-fill-level"
                          >
                            {m1DogfoodFillBoard.level === 'empty'
                              ? '尚无日记'
                              : m1DogfoodFillBoard.level === 'scaffold-only'
                                ? '仅脚手架'
                                : m1DogfoodFillBoard.level === 'partial'
                                  ? '部分有效'
                                  : m1DogfoodFillBoard.level === 'ready-count'
                                    ? '数字已满'
                                    : m1DogfoodFillBoard.level === 'blocked-fake'
                                      ? '仅草稿'
                                      : m1DogfoodFillBoard.level}
                          </span>
                        </div>
                        <div
                          className="st-demo-m1-dogfood-fill__chips"
                          data-testid="m1-dogfood-fill-chips"
                        >
                          <span data-kind="real">
                            有效 {m1DogfoodFillBoard.realDays}/{m1DogfoodFillBoard.required}
                          </span>
                          <span data-kind="remain">仍差 {m1DogfoodFillBoard.remainingDays}</span>
                          <span data-kind="draft">草稿 {m1DogfoodFillBoard.draftDays}</span>
                          <span data-kind="scaffold">脚手架 {m1DogfoodFillBoard.scaffoldDays}</span>
                          <span data-kind="missing">
                            缺文件 {m1DogfoodFillBoard.missingSlots.length}
                          </span>
                        </div>
                        <div className="st-demo-m1-dogfood-fill__actions">
                          {m1DogfoodFillBoard.primaryCta.action !== 'none' ? (
                            <button
                              type="button"
                              className="st-demo-m1-dogfood-fill__primary"
                              data-testid="m1-dogfood-fill-primary"
                              data-action={m1DogfoodFillBoard.primaryCta.action}
                              data-target={m1DogfoodFillBoard.primaryCta.targetDate ?? ''}
                              title={m1DogfoodFillBoard.primaryCta.label}
                              onClick={() => handleM1DogfoodFillPrimary()}
                            >
                              {m1DogfoodFillBoard.primaryCta.label}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="st-demo-m1-dogfood-fill__primary"
                              data-testid="m1-dogfood-fill-primary"
                              data-action="none"
                              disabled
                              title="有效日门槛已满 · M1 状态见验证区"
                            >
                              {m1DogfoodFillBoard.primaryCta.label || '有效日数字已满'}
                            </button>
                          )}
                          <button
                            type="button"
                            className="st-demo-m1-dogfood-fill__copy"
                            data-testid="m1-dogfood-fill-copy"
                            data-action="copy-fill-board"
                            title="复制多日补填板（不含密钥 · 草稿不计有效日）"
                            onClick={() => void copyM1DogfoodFillBoard()}
                          >
                            复制多日补填
                          </button>
                        </div>
                        {m1DogfoodFillBoard.rows.length > 0 ? (
                          <ul
                            className="st-demo-m1-dogfood-fill__list"
                            data-testid="m1-dogfood-fill-list"
                            data-count={m1DogfoodFillBoard.rows.length}
                          >
                            {m1DogfoodFillBoard.rows.slice(0, 8).map((row) => (
                              <li
                                key={row.date}
                                data-kind={row.kind}
                                data-real={row.countsAsReal ? '1' : '0'}
                                data-cta={row.ctaAction}
                                data-testid={`m1-dogfood-fill-row-${row.date}`}
                                title={`${row.fillHint} · ${row.ctaLabel || ''}`}
                              >
                                {row.ctaAction !== 'none' ? (
                                  <button
                                    type="button"
                                    className="st-demo-m1-dogfood-fill__row-btn"
                                    data-testid={`m1-dogfood-fill-cta-${row.date}`}
                                    data-action={row.ctaAction}
                                    data-kind={row.kind}
                                    onClick={() => handleM1DogfoodFillRow(row)}
                                  >
                                    <span className="st-demo-m1-dogfood-fill__date">
                                      {row.date}
                                    </span>
                                    <span className="st-demo-m1-dogfood-fill__kind">
                                      {row.kind === 'real'
                                        ? '有效'
                                        : row.kind === 'draft'
                                          ? '草稿'
                                          : row.kind === 'missing'
                                            ? '缺文件'
                                            : '脚手架'}
                                    </span>
                                    <span className="st-demo-m1-dogfood-fill__status">
                                      {row.statusLabel}
                                    </span>
                                    <span className="st-demo-m1-dogfood-fill__hint">
                                      {row.fillHint}
                                    </span>
                                    <span className="st-demo-m1-dogfood-fill__cta">
                                      {row.ctaLabel}
                                    </span>
                                  </button>
                                ) : (
                                  <>
                                    <span className="st-demo-m1-dogfood-fill__date">
                                      {row.date}
                                    </span>
                                    <span className="st-demo-m1-dogfood-fill__kind">
                                      {row.kind}
                                    </span>
                                    <span className="st-demo-m1-dogfood-fill__status">
                                      {row.statusLabel}
                                    </span>
                                    <span className="st-demo-m1-dogfood-fill__hint">
                                      {row.fillHint}
                                    </span>
                                  </>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <p
                          className="st-demo-m1-dogfood-fill__note"
                          data-testid="m1-dogfood-fill-note"
                        >
                          点行打开当日日记 · 粘贴草稿 / 脚手架不计有效日 · ≥3 真实天仍是硬门槛 ·
                          不关 M1
                        </p>
                      </div>
                      {m1ExitEvidence.dogfoodDays.length > 0 ? (
                        <ul
                          className="st-demo-m1-dogfood-days"
                          data-testid="m1-dogfood-days"
                          data-count={m1ExitEvidence.dogfoodDays.length}
                          data-draft-count={m1ExitEvidence.dogfoodDraftDays}
                          aria-label="dogfood 按日明细 · 点击打开当日日记 · 草稿不计有效日"
                        >
                          {m1ExitEvidence.dogfoodDays.map((day) => (
                            <li
                              key={day.date}
                              data-kind={day.boardKind || day.kind}
                              data-paste-assist={day.isPasteAssist ? '1' : '0'}
                              data-date={day.date}
                              data-openable="1"
                              data-testid={`m1-dogfood-day-${day.date}`}
                              title={
                                day.reasons && day.reasons.length > 0
                                  ? day.reasons.join(' · ')
                                  : day.statusLabel
                              }
                            >
                              <button
                                type="button"
                                className="st-demo-m1-dogfood-days__btn"
                                data-testid={`m1-dogfood-day-btn-${day.date}`}
                                data-action="open-dogfood-day"
                                data-date={day.date}
                                data-kind={day.boardKind || day.kind}
                                title={`打开 ${day.fileName || day.date + '.md'} · ${
                                  day.reasons?.join(' · ') || day.statusLabel
                                }（不自动勾选 · 草稿不计有效）`}
                                onClick={() => openM1DogfoodDay(day.date)}
                              >
                                <span className="st-demo-m1-dogfood-days__date">{day.date}</span>
                                <span
                                  className="st-demo-m1-dogfood-days__kind"
                                  data-kind={day.boardKind || day.kind}
                                >
                                  {day.boardKind === 'draft' || day.isPasteAssist
                                    ? '草稿'
                                    : day.kind === 'real'
                                      ? '有效'
                                      : '脚手架'}
                                </span>
                                <span className="st-demo-m1-dogfood-days__status">
                                  {day.statusLabel}
                                </span>
                                {day.reasons && day.reasons.length > 0 ? (
                                  <span
                                    className="st-demo-m1-dogfood-days__reasons"
                                    data-testid={`m1-dogfood-day-reasons-${day.date}`}
                                  >
                                    {day.reasons.slice(0, 2).join(' · ')}
                                  </span>
                                ) : null}
                                <span
                                  className="st-demo-m1-dogfood-days__open-hint"
                                  aria-hidden="true"
                                >
                                  打开
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}

                      <div
                        className="st-demo-m1-regression"
                        data-testid="m1-soft-regression"
                        data-auto-pass={m1SoftRegression.autoPass}
                        data-auto-total={m1SoftRegression.autoTotal}
                        data-hand-gaps={m1SoftRegression.handGaps}
                        data-external-gaps={m1SoftRegression.externalGaps}
                        data-filter={regressionListFilter}
                        data-filter-count={m1SoftRegressionFilteredRows.length}
                        data-claims-closed="0"
                        aria-label="M1 soft 回归矩阵 · 自动 vs 手测 · 可筛选可跳转"
                      >
                        <div className="st-demo-m1-regression__head">
                          <span className="st-demo-m1-regression__kicker">soft 回归</span>
                          <strong data-testid="m1-soft-regression-summary">
                            auto {m1SoftRegression.autoPass}/{m1SoftRegression.autoTotal}
                            {' · '}
                            手测缺口 {m1SoftRegression.handGaps}
                            {' · '}
                            外网 {m1SoftRegression.externalGaps}
                          </strong>
                          <button
                            type="button"
                            className="st-demo-m1-exit__copy"
                            data-testid="m1-soft-regression-copy-inline"
                            data-action="copy-soft-regression"
                            title="复制完整 markdown 矩阵"
                            onClick={() => void copyM1SoftRegression()}
                          >
                            复制
                          </button>
                        </div>
                        <div
                          className="st-demo-m1-regression-filters"
                          data-testid="m1-soft-regression-filters"
                          role="toolbar"
                          aria-label="回归矩阵筛选"
                        >
                          {(
                            [
                              { id: 'all' as const, label: '全部' },
                              { id: 'gaps' as const, label: '缺口' },
                              { id: 'external' as const, label: '外网' },
                              { id: 'auto-fail' as const, label: 'auto红' },
                            ] as const
                          ).map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              className="st-demo-m1-regression-filters__btn"
                              data-testid={`m1-soft-regression-filter-${f.id}`}
                              data-filter={f.id}
                              data-active={regressionListFilter === f.id ? '1' : '0'}
                              aria-pressed={regressionListFilter === f.id}
                              onClick={() => setRegressionListFilter(f.id)}
                            >
                              {f.label}
                              <span className="st-demo-m1-regression-filters__count">
                                {m1SoftRegressionFilterCounts[f.id]}
                              </span>
                            </button>
                          ))}
                        </div>
                        <ul
                          className="st-demo-m1-regression__rows"
                          data-testid="m1-soft-regression-rows"
                          data-count={m1SoftRegressionFilteredRows.length}
                          data-filter={regressionListFilter}
                        >
                          {m1SoftRegressionFilteredRows.slice(0, 12).map((row) => {
                            const actionable = isM1SoftRegressionRowActionable(row.id);
                            const rowAction = resolveM1SoftRegressionRowAction(row.id);
                            return (
                              <li
                                key={row.id}
                                data-id={row.id}
                                data-area={row.area}
                                data-auto={row.auto}
                                data-hand={row.hand}
                                data-action={rowAction.kind}
                                data-testid={`m1-soft-regression-row-${row.id}`}
                                title={row.note + (rowAction.hint ? ' · ' + rowAction.hint : '')}
                              >
                                {actionable ? (
                                  <button
                                    type="button"
                                    className="st-demo-m1-regression__row-btn"
                                    data-testid={`m1-soft-regression-row-btn-${row.id}`}
                                    data-action={rowAction.kind}
                                    title={rowAction.ctaLabel + ' · ' + rowAction.hint}
                                    onClick={() => handleM1SoftRegressionRow(row.id)}
                                  >
                                    <span className="st-demo-m1-regression__label">
                                      {row.label}
                                    </span>
                                    <span
                                      className="st-demo-m1-regression__cell"
                                      data-side="auto"
                                      data-cell={row.auto}
                                    >
                                      {row.auto}
                                    </span>
                                    <span
                                      className="st-demo-m1-regression__cell"
                                      data-side="hand"
                                      data-cell={row.hand}
                                    >
                                      {row.hand}
                                    </span>
                                    <span className="st-demo-m1-regression__cta">
                                      {rowAction.ctaLabel}
                                    </span>
                                  </button>
                                ) : (
                                  <>
                                    <span className="st-demo-m1-regression__label">
                                      {row.label}
                                    </span>
                                    <span
                                      className="st-demo-m1-regression__cell"
                                      data-side="auto"
                                      data-cell={row.auto}
                                    >
                                      {row.auto}
                                    </span>
                                    <span
                                      className="st-demo-m1-regression__cell"
                                      data-side="hand"
                                      data-cell={row.hand}
                                    >
                                      {row.hand}
                                    </span>
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        <p
                          className="st-demo-m1-regression__hint"
                          data-testid="m1-soft-regression-hint"
                        >
                          {m1ExitEvidence.hardGatesMet
                            ? `筛选看缺口 · 外网手测 ${m1ExitEvidence.handtestChecked}/${m1ExitEvidence.handtestTotal} · dogfood ${m1ExitEvidence.dogfoodRealDays}/${m1ExitEvidence.dogfoodRequired} · M1 已完成`
                            : m1ExitEvidence.handtestOk
                              ? `筛选看缺口 · 外网手测 ${m1ExitEvidence.handtestChecked}/${m1ExitEvidence.handtestTotal} 已完成 · dogfood ${m1ExitEvidence.dogfoodRealDays}/${m1ExitEvidence.dogfoodRequired}`
                              : '筛选看缺口 · 点行跳转/打开文档 · 自动绿不替代外网手测与 dogfood'}
                        </p>
                      </div>
                      <p className="st-demo-m1-exit__note" data-testid="m1-exit-note">
                        {m1ExitEvidence.note}
                        {m1ExitEvidence.loadNote ? ` · ${m1ExitEvidence.loadNote}` : ''}
                      </p>
                      {m1OpenDocFeedback ? (
                        <p
                          className="st-demo-m1-open-feedback"
                          data-testid="m1-open-doc-feedback"
                          data-level={m1OpenDocFeedback.level}
                          data-ok={m1OpenDocFeedback.dataOk}
                          data-created={m1OpenDocFeedback.dataCreated}
                          data-open-doc={m1OpenDocFeedback.openDocId}
                          data-basename={m1OpenDocFeedback.basename ?? ''}
                          role="status"
                        >
                          {m1OpenDocFeedback.message}
                        </p>
                      ) : null}
                    </div>
                    <div
                      className="st-demo-m1-handtest"
                      data-testid="m1-handtest-checklist"
                      data-level={m1HandtestChecklist.level}
                      aria-label="M1 手测清单对照"
                    >
                      <div className="st-demo-m1-handtest__head">
                        <span className="st-demo-m1-handtest__kicker">手测对照</span>
                        <strong data-testid="m1-handtest-summary">
                          {m1HandtestChecklist.summary}
                        </strong>
                        <small>
                          本机 {m1HandtestChecklist.livePass}/{m1HandtestChecklist.liveTotal} · 文档{' '}
                          {m1HandtestChecklist.docChecked}/{m1HandtestChecklist.docTotal || '—'}
                        </small>
                        <div className="st-demo-m1-handtest__opens" data-testid="m1-handtest-opens">
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open"
                            data-testid="m1-handtest-open-doc"
                            data-open-doc="handtest"
                            title="打开 14-external-gateway-handtest.md"
                            onClick={() =>
                              void openM1EvidenceDoc('handtest', { alsoJump: 'providers' })
                            }
                          >
                            打开手测文档
                          </button>
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open"
                            data-testid="m1-handtest-open-dogfood"
                            data-open-doc="dogfood-today"
                            title="打开或创建今日 dogfood 日记"
                            onClick={() => void openM1EvidenceDoc('dogfood-today')}
                          >
                            今日 dogfood
                          </button>
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open"
                            data-testid="m1-handtest-copy-snapshot"
                            data-action="copy-soft-snapshot"
                            title="复制本机 soft 快照（不含密钥）"
                            onClick={() => void copyM1SoftSnapshot()}
                          >
                            复制 soft 快照
                          </button>
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open"
                            data-testid="m1-handtest-copy-paste"
                            data-action="copy-handtest-paste"
                            title="复制手测进度粘贴稿（按分区 · 非文档勾选 · 不含密钥）"
                            onClick={() => void copyM1HandtestPaste()}
                          >
                            复制手测进度
                          </button>
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open"
                            data-testid="m1-handtest-copy-doc-diff"
                            data-action="copy-handtest-doc-diff"
                            title="复制文档↔本机差异（soft · 不关 M1 · 不含密钥）"
                            onClick={() => void copyM1HandtestDocDiff()}
                          >
                            复制文档差异
                          </button>
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open"
                            data-testid="m1-handtest-copy-dogfood-draft"
                            data-action="copy-dogfood-draft"
                            title="复制 dogfood 日记草稿（非自动写盘）"
                            onClick={() => void copyM1DogfoodDraft()}
                          >
                            dogfood 草稿
                          </button>
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open"
                            data-testid="m1-handtest-copy-regression"
                            data-action="copy-soft-regression"
                            title="复制 soft 回归矩阵（自动 vs 手测 · 非退出证据）"
                            onClick={() => void copyM1SoftRegression()}
                          >
                            回归矩阵
                          </button>
                          <button
                            type="button"
                            className="st-demo-m1-handtest__open st-demo-m1-handtest__open--primary"
                            data-testid="m1-handtest-copy-evidence-bundle"
                            data-action="copy-evidence-bundle"
                            title="一键导出 soft 证据包（不含密钥 · 不关 M1）"
                            onClick={() => void copyM1EvidenceBundle()}
                          >
                            证据包
                          </button>
                        </div>
                      </div>
                      <div
                        className="st-demo-m1-docdiff"
                        data-testid="m1-handtest-doc-diff"
                        data-level={m1HandtestDocDiff.level}
                        data-live-ahead={m1HandtestDocDiff.liveAhead}
                        data-doc-ahead={m1HandtestDocDiff.docAhead}
                        data-external-gap={m1HandtestDocDiff.externalGap}
                        data-primary-cta={m1HandtestDocDiff.primaryCta.kind}
                        data-claims-closed="0"
                        aria-label="文档与本机手测差异"
                      >
                        <div className="st-demo-m1-docdiff__head">
                          <span className="st-demo-m1-docdiff__kicker">文档 ↔ 本机</span>
                          <strong data-testid="m1-handtest-doc-diff-summary">
                            {m1HandtestDocDiff.summary}
                          </strong>
                          <span
                            className="st-demo-m1-docdiff__level"
                            data-level={m1HandtestDocDiff.level}
                          >
                            {m1HandtestDocDiff.level === 'quiet'
                              ? '对齐安静'
                              : m1HandtestDocDiff.level === 'critical'
                                ? '需复核'
                                : m1HandtestDocDiff.level === 'empty'
                                  ? '无数据'
                                  : '有差异'}
                          </span>
                        </div>
                        <div
                          className="st-demo-m1-docdiff__chips"
                          data-testid="m1-handtest-doc-diff-chips"
                        >
                          <span data-kind="live-ahead" title="本机已绿但文档未勾">
                            本机领先 {m1HandtestDocDiff.liveAhead}
                          </span>
                          <span data-kind="doc-ahead" title="文档已勾但本机未绿">
                            文档领先 {m1HandtestDocDiff.docAhead}
                          </span>
                          <span data-kind="external" title="需外网真实路径">
                            外网待证 {m1HandtestDocDiff.externalGap}
                          </span>
                          <span data-kind="aligned" title="本机与文档均已勾">
                            对齐已勾 {m1HandtestDocDiff.alignedPass}
                          </span>
                        </div>
                        {m1HandtestDocDiff.primaryCta.kind !== 'none' ? (
                          <button
                            type="button"
                            className="st-demo-m1-docdiff__primary"
                            data-testid="m1-handtest-doc-diff-primary"
                            data-live-ahead={m1HandtestDocDiff.primaryCta.liveAhead}
                            title={m1HandtestDocDiff.primaryCta.label}
                            onClick={() => handleM1HandtestDocDiffPrimary()}
                          >
                            {m1HandtestDocDiff.primaryCta.label}
                          </button>
                        ) : null}
                        {m1HandtestDocDiffAttention.length > 0 ? (
                          <ul
                            className="st-demo-m1-docdiff__list"
                            data-testid="m1-handtest-doc-diff-list"
                            data-count={m1HandtestDocDiffAttention.length}
                          >
                            {m1HandtestDocDiffAttention.slice(0, 8).map((row) => {
                              const actionable = isM1HandtestDocDiffCtaActionable(row.ctaKind);
                              return (
                                <li
                                  key={row.id}
                                  data-kind={row.kind}
                                  data-cta={row.ctaKind}
                                  data-jumpable={row.jumpable ? '1' : '0'}
                                  data-testid={`m1-handtest-doc-diff-row-${row.id}`}
                                  title={`${row.hint} · ${row.ctaLabel || ''}`}
                                >
                                  {actionable ? (
                                    <button
                                      type="button"
                                      className="st-demo-m1-docdiff__row-btn"
                                      data-testid={`m1-handtest-doc-diff-cta-${row.id}`}
                                      data-action={row.ctaKind}
                                      data-kind={row.kind}
                                      onClick={() => handleM1HandtestDocDiffRow(row)}
                                    >
                                      <span className="st-demo-m1-docdiff__kind">
                                        {row.kind === 'live-ahead'
                                          ? '本机领先'
                                          : row.kind === 'doc-ahead'
                                            ? '文档领先'
                                            : row.kind === 'external-gap'
                                              ? '外网待证'
                                              : '未映射'}
                                      </span>
                                      <span className="st-demo-m1-docdiff__label">{row.label}</span>
                                      <span className="st-demo-m1-docdiff__hint">{row.hint}</span>
                                      <span className="st-demo-m1-docdiff__cta">
                                        {row.ctaLabel}
                                      </span>
                                    </button>
                                  ) : (
                                    <>
                                      <span className="st-demo-m1-docdiff__kind">
                                        {row.kind === 'live-ahead'
                                          ? '本机领先'
                                          : row.kind === 'doc-ahead'
                                            ? '文档领先'
                                            : row.kind === 'external-gap'
                                              ? '外网待证'
                                              : '未映射'}
                                      </span>
                                      <span className="st-demo-m1-docdiff__label">{row.label}</span>
                                      <span className="st-demo-m1-docdiff__hint">{row.hint}</span>
                                    </>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p
                            className="st-demo-m1-docdiff__empty"
                            data-testid="m1-handtest-doc-diff-empty"
                          >
                            {m1ExitEvidence.hardGatesMet
                              ? `暂无待关注差异 · 外网 ${m1ExitEvidence.handtestChecked}/${m1ExitEvidence.handtestTotal}、dogfood ${m1ExitEvidence.dogfoodRealDays}/${m1ExitEvidence.dogfoodRequired} 已完成`
                              : m1ExitEvidence.handtestOk
                                ? `暂无待关注差异 · 外网手测 ${m1ExitEvidence.handtestChecked}/${m1ExitEvidence.handtestTotal} 已完成，dogfood ${m1ExitEvidence.dogfoodRealDays}/${m1ExitEvidence.dogfoodRequired}`
                                : '暂无待关注差异 · 对齐结果仍须人手确认'}
                          </p>
                        )}
                        <p className="st-demo-m1-docdiff__note">
                          可点差异行 · 打开文档 / 跳转面板 · 不自动勾 · 不改变 M1 状态
                        </p>
                      </div>
                      <ul
                        className="st-demo-m1-handtest-sections"
                        data-testid="m1-handtest-sections"
                        data-count={m1HandtestSectionBoard.sections.length}
                        aria-label="手测分区进度"
                      >
                        {m1HandtestSectionBoard.sections.map((sec) => {
                          const focus = sec.focusItemId
                            ? m1HandtestChecklist.items.find((it) => it.id === sec.focusItemId)
                            : null;
                          const jumpable = focus
                            ? isM1HandtestItemJumpable(focus.jumpTarget)
                            : false;
                          return (
                            <li
                              key={sec.id}
                              data-section={sec.id}
                              data-level={sec.level}
                              data-testid={`m1-handtest-section-${sec.id}`}
                            >
                              {jumpable && focus ? (
                                <button
                                  type="button"
                                  className="st-demo-m1-handtest-sections__btn"
                                  data-testid={`m1-handtest-section-btn-${sec.id}`}
                                  data-action="jump-handtest-section"
                                  title={`${sec.label} · ${sec.detail}`}
                                  onClick={() => handleHandtestItemJump(focus.jumpTarget)}
                                >
                                  <span className="st-demo-m1-handtest-sections__label">
                                    {sec.label}
                                  </span>
                                  <span className="st-demo-m1-handtest-sections__score">
                                    {sec.pass}/{sec.total}
                                  </span>
                                  <span className="st-demo-m1-handtest-sections__detail">
                                    {sec.detail}
                                  </span>
                                </button>
                              ) : (
                                <div
                                  className="st-demo-m1-handtest-sections__static"
                                  data-testid={`m1-handtest-section-static-${sec.id}`}
                                  title={sec.detail}
                                >
                                  <span className="st-demo-m1-handtest-sections__label">
                                    {sec.label}
                                  </span>
                                  <span className="st-demo-m1-handtest-sections__score">
                                    {sec.pass}/{sec.total}
                                  </span>
                                  <span className="st-demo-m1-handtest-sections__detail">
                                    {sec.detail}
                                  </span>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <p
                        className="st-demo-m1-handtest-sections__summary"
                        data-testid="m1-handtest-sections-summary"
                      >
                        {m1HandtestSectionBoard.summary}
                      </p>
                      <div
                        className="st-demo-m1-handtest-filters"
                        data-testid="m1-handtest-filters"
                        data-filter={handtestListFilter}
                        role="group"
                        aria-label="手测项筛选"
                      >
                        {(
                          [
                            { id: 'all' as const, label: '全部' },
                            { id: 'gaps' as const, label: '缺口' },
                            { id: 'external' as const, label: '外网' },
                          ] as const
                        ).map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            className="st-demo-m1-handtest-filters__btn"
                            data-testid={`m1-handtest-filter-${f.id}`}
                            data-active={handtestListFilter === f.id ? '1' : '0'}
                            data-filter={f.id}
                            aria-pressed={handtestListFilter === f.id}
                            onClick={() => setHandtestListFilter(f.id)}
                          >
                            {f.label}
                            <span className="st-demo-m1-handtest-filters__count">
                              {m1HandtestFilterCounts[f.id]}
                            </span>
                          </button>
                        ))}
                      </div>
                      <ul
                        className="st-demo-m1-handtest__list"
                        data-testid="m1-handtest-list"
                        data-filter={handtestListFilter}
                        data-count={m1HandtestFilteredItems.length}
                      >
                        {m1HandtestFilteredItems.map((item) => {
                          const jumpable = isM1HandtestItemJumpable(item.jumpTarget);
                          const docEntry = m1HandtestDocMapById.get(item.id);
                          const docChecked =
                            docEntry && docEntry.docChecked != null
                              ? docEntry.docChecked
                                ? '1'
                                : '0'
                              : '';
                          const docBadge =
                            docEntry && docEntry.docChecked != null
                              ? docEntry.docChecked
                                ? '文档✓'
                                : '文档□'
                              : '文档—';
                          return (
                            <li
                              key={item.id}
                              data-status={item.status}
                              data-gate={item.gate}
                              data-jump={item.jumpTarget}
                              data-jumpable={jumpable ? '1' : '0'}
                              data-doc-checked={docChecked}
                              data-testid={`m1-handtest-item-${item.id}`}
                              title={`${item.jumpHint || item.hint} · ${item.detail}${
                                docEntry?.docLabel ? ' · 文档: ' + docEntry.docLabel : ''
                              }`}
                            >
                              {jumpable ? (
                                <button
                                  type="button"
                                  className="st-demo-m1-handtest__jump"
                                  data-testid={`m1-handtest-jump-${item.id}`}
                                  onClick={() => handleHandtestItemJump(item.jumpTarget)}
                                >
                                  <span className="st-demo-m1-handtest__mark" aria-hidden="true">
                                    {item.status === 'pass'
                                      ? '✓'
                                      : item.status === 'fail'
                                        ? '!'
                                        : '·'}
                                  </span>
                                  <span className="st-demo-m1-handtest__label">{item.label}</span>
                                  <span className="st-demo-m1-handtest__gate">
                                    {item.gate === 'external' ? '外网' : '本机'}
                                  </span>
                                  <span
                                    className="st-demo-m1-handtest__doc"
                                    data-testid={`m1-handtest-doc-${item.id}`}
                                    data-doc-checked={docChecked}
                                  >
                                    {docBadge}
                                  </span>
                                  <span className="st-demo-m1-handtest__detail">{item.detail}</span>
                                </button>
                              ) : (
                                <>
                                  <span className="st-demo-m1-handtest__mark" aria-hidden="true">
                                    {item.status === 'pass'
                                      ? '✓'
                                      : item.status === 'fail'
                                        ? '!'
                                        : '·'}
                                  </span>
                                  <span className="st-demo-m1-handtest__label">{item.label}</span>
                                  <span className="st-demo-m1-handtest__gate">
                                    {item.gate === 'external' ? '外网' : '本机'}
                                  </span>
                                  <span
                                    className="st-demo-m1-handtest__doc"
                                    data-testid={`m1-handtest-doc-${item.id}`}
                                    data-doc-checked={docChecked}
                                  >
                                    {docBadge}
                                  </span>
                                  <span className="st-demo-m1-handtest__detail">{item.detail}</span>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <details
                        className="st-demo-m1-handtest__limits"
                        data-testid="m1-known-limits"
                      >
                        <summary>当前里程碑状态（以验证区为准）</summary>
                        <ul>
                          {m1CurrentMilestoneCopy.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                          <li>
                            API Key 只进安全存储；界面与日志应仅见遮罩，勿把真实密钥写进仓库。
                          </li>
                        </ul>
                      </details>
                      <p className="st-demo-m1-handtest__note" data-testid="m1-handtest-note">
                        {m1HandtestChecklist.note}
                      </p>
                    </div>
                  </div>
                </details>
              </div>
            </details>
          ) : null}
        </div>
      }
      conversation={
        <div
          className="st-demo-thread st-thread"
          data-layout={conversationLayout}
          data-testid="conversation-thread"
        >
          {showConversationAlert ? (
            <div
              className="st-conversation-alert"
              role="status"
              data-testid="conversation-stream-readiness"
              data-level={conversationStreamReadiness.level}
              data-connection={runtimeView.connectionState}
              aria-label="对话状态"
            >
              <span className="st-conversation-alert__dot" aria-hidden="true" />
              <span className="st-conversation-alert__copy">
                <strong data-testid="conversation-stream-title">
                  {conversationStreamReadiness.title}
                </strong>
                <small data-testid="conversation-stream-subtitle">
                  {conversationStreamReadiness.failure?.recovery ?? beginnerWorkspace.nextAction}
                </small>
              </span>
              {conversationStreamReadiness.showReconnectCta ? (
                <button
                  type="button"
                  data-testid="conversation-runtime-reconnect-cta"
                  disabled={runtimeView.connectionState === 'connecting'}
                  onClick={() => reconnectRuntime()}
                >
                  <RefreshCw aria-hidden="true" size={13} strokeWidth={2} />
                  {conversationStreamReadiness.reconnectCtaLabel}
                </button>
              ) : conversationStreamReadiness.showFailureCta ? (
                <button
                  type="button"
                  data-testid="conversation-stream-failure-cta"
                  data-action={conversationStreamReadiness.failureCtaAction}
                  onClick={() => handleStreamFailureCta()}
                >
                  {conversationStreamReadiness.failureCtaLabel}
                </button>
              ) : null}
            </div>
          ) : null}

          {active && active.participationMode !== 'conversation' ? (
            <div className="st-m2-plan-flow" data-testid="m2-plan-flow">
              {planRevision ? (
                <PlanRevisionPanel
                  revision={planRevision}
                  revisions={planRevisions}
                  busy={planBusy}
                  error={planError}
                  onRevise={
                    active.participationMode === 'collaboration'
                      ? (input) => void reviseCurrentPlan(input)
                      : undefined
                  }
                  onApprove={
                    active.participationMode === 'collaboration'
                      ? (input) => void approveCurrentPlan(input)
                      : undefined
                  }
                  onSelectRevision={(revision) => {
                    const selected = planRevisions.find((item) => item.revision === revision);
                    if (selected) setPlanRevision(selected);
                  }}
                />
              ) : (
                <section className="st-m2-plan-empty" aria-label="执行计划">
                  <div>
                    <strong>尚无执行计划</strong>
                    <p>从当前任务目标创建草稿，然后补充 Agent 分工、依赖和模型覆盖。</p>
                  </div>
                  <button
                    type="button"
                    hidden={active.participationMode !== 'collaboration'}
                    disabled={
                      active.participationMode !== 'collaboration' ||
                      planBusy ||
                      !agentBinding?.agentVersionId
                    }
                    onClick={() => void createDefaultPlan()}
                  >
                    <GitBranch aria-hidden="true" size={14} strokeWidth={1.9} />
                    创建计划草稿
                  </button>
                  {planError ? <p role="alert">{planError}</p> : null}
                </section>
              )}
            </div>
          ) : null}

          {projection.messages.length === 0 && previewMessages.length === 0 ? (
            <div
              className="st-beginner-empty"
              data-testid="conversation-empty"
              data-connection={runtimeView.connectionState}
              data-has-task={active ? 'true' : 'false'}
              data-state={beginnerWorkspace.state}
            >
              <span className="st-beginner-empty__mark" aria-hidden="true">
                <Bot size={18} strokeWidth={1.7} />
              </span>
              <h2 data-testid="conversation-empty-title">
                {!active
                  ? '从一个任务开始'
                  : !agentBinding?.defaultModelId
                    ? '为任务选好智能体'
                    : runtimeView.connectionState !== 'online'
                      ? '连接恢复后即可继续'
                      : '告诉智能体要做什么'}
              </h2>
              <p data-testid="conversation-empty-hint">{beginnerWorkspace.nextAction}</p>
              <ol className="st-beginner-empty__steps" data-testid="conversation-empty-steps">
                {beginnerWorkspace.steps.map((step, index) => (
                  <li key={step.id} data-state={step.state}>
                    <span aria-hidden="true">
                      {step.state === 'complete' ? (
                        <Check size={12} strokeWidth={2.2} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                  </li>
                ))}
              </ol>
              {beginnerWorkspace.actionLabel ? (
                <button type="button" onClick={handleBeginnerAction}>
                  {beginnerWorkspace.actionLabel}
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={1.9} />
                </button>
              ) : null}
            </div>
          ) : null}

          {projection.messages.map((message) => {
            const agentIdentity =
              conversationAgentIdentityByMessageId.get(message.id) ??
              fallbackConversationAgentIdentity;
            return (
              <MessageBubble
                key={message.id}
                role={message.role === 'system' ? 'system' : message.role}
                layout={conversationLayout}
                streaming={Boolean(message.streaming)}
                agentLabel={agentIdentity.name}
                agentIcon={agentIdentity.icon}
                agentColor={agentIdentity.color}
                onAgentActivate={() => {
                  if (
                    agentIdentity.agentId &&
                    agentIdentity.agentId !== selectedAgentIdRef.current
                  ) {
                    selectAgent(agentIdentity.agentId);
                  }
                  navigateToInstrument('agent');
                }}
              >
                {message.text || (message.streaming ? '…' : '')}
              </MessageBubble>
            );
          })}

          {previewMessages.map((text, index) => (
            <MessageBubble key={`preview-${index}`} role="user" layout={conversationLayout}>
              {text}
            </MessageBubble>
          ))}
        </div>
      }

      trace={
        <div className="st-demo-trace" data-tab={rightRailTab}>
          {rightRailTab === 'overview' ? (
            <div
              className="st-task-overview"
              data-testid="right-rail-overview"
              data-state={beginnerWorkspace.state}
            >
              <header className="st-task-overview__status">
                <span className="st-task-overview__status-dot" aria-hidden="true" />
                <span>
                  <strong>{beginnerWorkspace.statusLabel}</strong>
                  <small>{beginnerWorkspace.statusDetail}</small>
                </span>
              </header>

              <section className="st-task-overview__next" aria-labelledby="task-overview-next">
                <span id="task-overview-next">下一步</span>
                <p>{beginnerWorkspace.nextAction}</p>
                {beginnerWorkspace.actionLabel ? (
                  <button type="button" onClick={handleBeginnerAction}>
                    {beginnerWorkspace.actionLabel}
                    <ArrowRight aria-hidden="true" size={13} strokeWidth={1.9} />
                  </button>
                ) : null}
              </section>

              <ol className="st-task-overview__steps" aria-label="任务进度">
                {beginnerWorkspace.steps.map((step) => (
                  <li key={step.id} data-state={step.state}>
                    <span className="st-task-overview__step-mark" aria-hidden="true">
                      {step.state === 'complete' ? (
                        <Check size={12} strokeWidth={2.2} />
                      ) : (
                        <Circle size={10} strokeWidth={2} />
                      )}
                    </span>
                    <span>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                  </li>
                ))}
              </ol>

              <section className="st-task-overview__agent" aria-labelledby="task-owner-label">
                <span id="task-owner-label">当前由谁处理</span>
                <button type="button" onClick={() => navigateToInstrument('agent')}>
                  <span
                    className="st-task-overview__avatar"
                    style={{
                      ['--st-agent-identity-color' as string]:
                        fallbackConversationAgentIdentity.color,
                    }}
                  >
                    <Bot aria-hidden="true" size={15} strokeWidth={1.9} />
                  </span>
                  <span>
                    <strong>{fallbackConversationAgentIdentity.name}</strong>
                    <small title={activeModelLabel}>{activeModelLabel}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
                </button>
              </section>

              {approvalPendingCount > 0 ? (
                <button
                  type="button"
                  className="st-task-overview__approval"
                  onClick={() => setRightRailTab('approvals')}
                >
                  <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />
                  <span>
                    <strong>{approvalPendingCount} 项等待确认</strong>
                    <small>查看后决定是否继续</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
                </button>
              ) : null}

              <section
                className="st-task-overview__artifacts"
                aria-labelledby="task-artifacts-label"
              >
                <header>
                  <span id="task-artifacts-label">产物</span>
                  {artifactItems.length > 0 ? <small>{artifactItems.length}</small> : null}
                </header>
                {artifactItems.length > 0 ? (
                  <ul>
                    {artifactItems.slice(0, 3).map((item) => {
                      const latestVersion = item.versions[item.versions.length - 1];
                      return (
                        <li key={String(item.artifact.id)}>
                          <PackageCheck aria-hidden="true" size={15} strokeWidth={1.7} />
                          <span>
                            <strong>{item.artifact.name}</strong>
                            <small>
                              {latestVersion ? `版本 ${latestVersion.version}` : '等待生成版本'}
                            </small>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>智能体生成的文件和版本会出现在这里。</p>
                )}
                {artifactItems.length > 0 ? (
                  <button type="button" onClick={() => setRightRailTab('artifacts')}>
                    查看全部产物
                    <ArrowRight aria-hidden="true" size={13} strokeWidth={1.8} />
                  </button>
                ) : null}
              </section>

              <button
                type="button"
                className="st-task-overview__details"
                data-testid="right-rail-open-details"
                onClick={() => setRightRailTab('trace')}
              >
                <Activity aria-hidden="true" size={14} strokeWidth={1.8} />
                执行详情
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="st-execution-details__back"
                onClick={() => setRightRailTab('overview')}
              >
                <ChevronLeft aria-hidden="true" size={14} strokeWidth={1.9} />
                返回任务进度
              </button>
              <nav className="st-m2-rail-tabs" role="tablist" aria-label="执行详情">
                {(
                  [
                    ['trace', '轨迹', Activity],
                    ['graph', '执行图', GitBranch],
                    ['approvals', '审批', ShieldCheck],
                    ['artifacts', '产物', Files],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={rightRailTab === id}
                    data-selected={rightRailTab === id ? '1' : '0'}
                    data-testid={`right-rail-tab-${id}`}
                    onClick={() => setRightRailTab(id)}
                  >
                    <Icon aria-hidden="true" size={13} strokeWidth={1.9} />
                    {label}
                    {id === 'approvals' && approvalPendingCount > 0 ? (
                      <span>{approvalPendingCount}</span>
                    ) : null}
                    {id === 'artifacts' && artifactItems.length > 0 ? (
                      <span>{artifactItems.length}</span>
                    ) : null}
                  </button>
                ))}
              </nav>
              <div className="st-demo-run-summary">
                <span
                  className="st-demo-run-summary__pulse"
                  aria-hidden="true"
                  data-state={projection.stream.state}
                />
                <span>
                  <strong data-testid="run-summary-state">
                    Run ·{' '}
                    {conversationStreamReadiness.checks.find((c) => c.id === 'stream')?.detail ??
                      projection.stream.state}
                  </strong>
                  <small>
                    {isStreaming
                      ? projection.stream.notice
                        ? projection.stream.notice
                        : projection.stream.modelId
                          ? `streaming · ${projection.stream.modelId}`
                          : 'streaming'
                      : projection.stream.state === 'paused'
                        ? (projection.stream.errorSummary ?? 'paused')
                        : projection.stream.notice
                          ? projection.stream.notice
                          : active
                            ? active.title
                            : '无活动任务'}
                  </small>
                </span>
                <span className="st-demo-run-summary__count">
                  {projection.trace.length}
                  {manifestInspectViews.length > 0 ? ` · M${manifestInspectViews.length}` : ''}
                  {peekStatus ? ` · ${peekStatus}` : ''}
                </span>
              </div>
            </>
          )}
          {rightRailTab === 'trace' ? (
            <div className="st-m2-rail-panel" role="tabpanel" data-testid="right-rail-trace">
              <div className="st-demo-trace__manifest" data-instrument="manifest">
                <ManifestPanel
                  hideReadiness
                  manifests={manifestInspectViews}
                  selectedId={selectedManifestId}
                  onSelect={handleManifestSelect}
                  onPeek={() => void peekContextNow()}
                  peekBusy={peekBusy}
                  peekLabel={peekBusy ? '预览中…' : '预览上下文'}
                  onExcludeSource={(id) => void amendExcludeSource(id)}
                  onClearAmendments={() => void clearContextAmendments()}
                  amendBusy={amendBusy}
                  activeExcludeSourceIds={activeExcludeSourceIds}
                  amendStatus={amendStatus}
                />
              </div>
              <TraceList
                hideReadiness
                selectedId={selectedTraceId}
                onSelectItem={handleTraceSelect}
                hasActiveTask={Boolean(active)}
                streaming={isStreaming}
                items={projection.trace}
                emptyState={
                  isStreaming
                    ? '轨迹写入中…'
                    : active
                      ? '尚无轨迹 · 发送消息后会出现模型调用与恢复事件'
                      : '尚无轨迹 · 先打开任务再发送消息'
                }
              />
            </div>
          ) : null}
          {rightRailTab === 'graph' ? (
            <div className="st-m2-rail-panel" role="tabpanel" data-testid="right-rail-graph">
              {graphError ? (
                <p className="st-m2-rail-error" role="alert">
                  {graphError}
                </p>
              ) : null}
              {executionGraphView ? (
                <ExecutionGraphPanel
                  graph={executionGraphView}
                  selectedStepId={selectedGraphStepId}
                  busy={graphBusy}
                  onPause={() => void mutateOrchestrationRun('pause')}
                  onResume={() => void mutateOrchestrationRun('resume')}
                  onCancel={() => void mutateOrchestrationRun('cancel')}
                />
              ) : (
                <div className="st-m2-rail-empty">
                  <GitBranch aria-hidden="true" size={20} strokeWidth={1.6} />
                  <strong>尚无执行图</strong>
                  <p>在协作模式批准计划后，这里显示并行步骤、依赖、Agent 与重试状态。</p>
                </div>
              )}
            </div>
          ) : null}
          {rightRailTab === 'approvals' ? (
            <div className="st-m2-rail-panel" role="tabpanel" data-testid="right-rail-approvals">
              <ApprovalCenterPanel
                items={approvalItems}
                policies={approvalPolicies}
                delegateAgentVersions={delegateAgentVersions}
                defaultPolicyScope={
                  active ? { scopeType: 'task', scopeId: active.taskId } : undefined
                }
                pendingCount={approvalPendingCount}
                humanOnlyActions={approvalHumanOnlyActions}
                modes={approvalModes}
                loading={approvalLoading}
                busy={approvalBusy}
                error={approvalError}
                statusNote={approvalStatus}
                onRefresh={() => {
                  void loadApprovals();
                  void loadPolicies();
                }}
                onDecide={(input) => void decideApprovalItem(input)}
                onSavePolicy={(input) => void saveApprovalPolicy(input)}
                onNavigateToRunStep={(input) => void navigateToApprovalRunStep(input)}
              />
            </div>
          ) : null}
          {rightRailTab === 'artifacts' ? (
            <div className="st-m2-rail-panel" role="tabpanel" data-testid="right-rail-artifacts">
              {artifactError ? (
                <p className="st-m2-rail-error" role="alert">
                  {artifactError}
                </p>
              ) : null}
              {artifactItems.length > 1 ? (
                <label className="st-m2-artifact-picker">
                  <span>产物</span>
                  <select
                    value={String(selectedArtifactItem?.artifact.id ?? '')}
                    onChange={(event) => {
                      setSelectedArtifactId(event.target.value);
                      setArtifactComparison(null);
                    }}
                  >
                    {artifactItems.map((item) => (
                      <option key={String(item.artifact.id)} value={String(item.artifact.id)}>
                        {item.artifact.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {artifactVersionsView ? (
                <ArtifactVersionsPanel
                  artifact={artifactVersionsView}
                  comparison={artifactComparison}
                  mergeSteps={artifactMergeSteps}
                  conflicts={artifactConflictViews}
                  busy={artifactBusy}
                  onCompare={(left, right) => void compareArtifacts(left, right)}
                  onSelect={(artifactId, versionId) => void selectArtifact(artifactId, versionId)}
                  onMerge={(artifactId, left, right, mergeStepId) =>
                    void mergeArtifacts(artifactId, left, right, mergeStepId)
                  }
                  onResolveConflict={(conflictId, strategy, content) =>
                    void resolveArtifactConflict(conflictId, strategy, content)
                  }
                />
              ) : (
                <div className="st-m2-rail-empty">
                  <Files aria-hidden="true" size={20} strokeWidth={1.6} />
                  <strong>尚无产物版本</strong>
                  <p>步骤写入候选产物后，这里保留全部版本并支持比较、选择与合并。</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      }
      compose={
        <div className="st-demo-compose-wrap">
          {sendError ? (
            <p className="st-demo-compose-error" role="alert" data-testid="compose-send-error">
              {sendError}
            </p>
          ) : null}
          <Compose
            mode={active?.participationMode ?? 'conversation'}
            placeholder={
              active
                ? `给 ${fallbackConversationAgentIdentity.name} 发送消息…`
                : '先选择任务再发送…'
            }
            disabled={
              sendPending ||
              !active ||
              isStreaming ||
              !canSendRuntimeMessage(runtimeView.connectionState)
            }
            streaming={isStreaming}
            cancelDisabled={cancelPending}
            models={composeModels}
            selectedModelId={safeSelectedModelId}
            onModelChange={setSelectedModelId}
            defaultModelLabel={agentDefaultModelLabel}
            connectionState={runtimeView.connectionState}
            hasActiveTask={Boolean(active)}
            agentDefaultSet={Boolean(agentBinding?.defaultModelId)}
            onReconnect={reconnectRuntime}
            onConfigureModel={() => navigateToInstrument('agent')}
            onCancel={() => void cancelStream()}
            onSend={sendMessage}
          />
        </div>
      }
    />
  );
}

const root = document.getElementById('sync-think-root');
if (!root) throw new Error('Missing #sync-think-root');

createRoot(root).render(
  <StrictMode>
    <DesktopShell />
  </StrictMode>,
);
