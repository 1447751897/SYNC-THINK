import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Gavel,
  Link2,
  Radar,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';

export type ApprovalModeView = 'request' | 'delegate' | 'full' | 'custom';
export type ApprovalKindView =
  | 'plan'
  | 'tool'
  | 'memory'
  | 'export'
  | 'skill-permission'
  | 'mcp-permission'
  | 'human-only'
  | 'other';
export type ApprovalStateView = 'pending' | 'approved' | 'rejected';

export interface ApprovalItemView {
  id: string;
  workspaceId?: string;
  taskId?: string;
  kind: ApprovalKindView;
  action: string;
  summary: string;
  humanOnly: boolean;
  humanOnlyAction?: string;
  mode: ApprovalModeView;
  gate: string;
  state: ApprovalStateView;
  decidedBy?: string;
  delegateAgentVersionId?: string;
  decisionNote?: string;
  runId?: string;
  stepId?: string;
  createdAt: string;
  decidedAt?: string;
}

export function resolveApprovalDecisionActor(
  item: Pick<ApprovalItemView, 'gate' | 'humanOnly'>,
): 'human' | 'delegate' {
  return !item.humanOnly && item.gate === 'require-delegate' ? 'delegate' : 'human';
}

export interface ApprovalEvaluateDemoInput {
  mode: ApprovalModeView;
  action: string;
  kind?: ApprovalKindView;
  insideExplicitPolicy?: boolean;
  humanOnly?: boolean;
}

export interface ApprovalEnqueueDemoInput {
  mode: ApprovalModeView;
  action: string;
  kind: ApprovalKindView;
  summary?: string;
  insideExplicitPolicy?: boolean;
}

export interface ApprovalDecideInput {
  id: string;
  decision: 'approved' | 'rejected';
  decidedBy: 'human' | 'delegate';
  delegateAgentVersionId?: string;
  decisionNote?: string;
}

export type ApprovalPolicyScopeType =
  'user' | 'workspace' | 'project' | 'task' | 'agent' | 'workflow' | 'run';

export interface ApprovalPolicyRuleView {
  action: string;
  approvalMode: ApprovalModeView;
  delegateAgentVersionId?: string;
}

export interface ApprovalPolicyView {
  id: string;
  policyId: string;
  version: number;
  scopeType: ApprovalPolicyScopeType;
  scopeId: string;
  approvalMode: ApprovalModeView;
  rules: readonly ApprovalPolicyRuleView[];
  createdAt: string;
}

export interface ApprovalPolicySaveInput {
  policyId?: string;
  scopeType: ApprovalPolicyScopeType;
  scopeId: string;
  approvalMode: ApprovalModeView;
  rules: ApprovalPolicyRuleView[];
}

export interface ApprovalCenterPanelProps {
  items: readonly ApprovalItemView[];
  pendingCount?: number;
  humanOnlyActions?: readonly string[];
  modes?: readonly ApprovalModeView[];
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  statusNote?: string | null;
  /** Product mode hides diagnostic enqueue/probe controls. Defaults to true. */
  productMode?: boolean;
  policies?: readonly ApprovalPolicyView[];
  delegateAgentVersions?: readonly {
    id: string;
    agentId: string;
    agentName: string;
    version: number;
  }[];
  defaultPolicyScope?: {
    scopeType: ApprovalPolicyScopeType;
    scopeId: string;
  };
  defaultPolicyMode?: ApprovalModeView;
  onRefresh?: () => void | Promise<void>;
  onDecide?: (input: ApprovalDecideInput) => void | Promise<void>;
  onSavePolicy?: (input: ApprovalPolicySaveInput) => void | Promise<void>;
  onNavigateToRunStep?: (input: {
    workspaceId?: string;
    taskId?: string;
    runId: string;
    stepId?: string;
  }) => void;
  onEvaluateDemo?: (input: ApprovalEvaluateDemoInput) => void | Promise<void>;
  onEnqueueDemo?: (input: ApprovalEnqueueDemoInput) => void | Promise<void>;
}

const MODE_LABEL: Record<ApprovalModeView, string> = {
  request: '请求批准',
  delegate: '替我审批',
  full: '完全访问',
  custom: '自定义',
};

const POLICY_SCOPE_LABEL: Record<ApprovalPolicyScopeType, string> = {
  user: '用户',
  workspace: '项目',
  project: '项目',
  task: '任务',
  agent: '智能体',
  workflow: '工作流',
  run: 'Run',
};

const KIND_LABEL: Record<ApprovalKindView, string> = {
  plan: '计划',
  tool: '工具',
  memory: '记忆',
  export: '导出',
  'skill-permission': 'Skill 权限',
  'mcp-permission': 'MCP 权限',
  'human-only': '敏感操作',
  other: '其他',
};

const STATE_LABEL: Record<ApprovalStateView, string> = {
  pending: '待审',
  approved: '已通过',
  rejected: '已拒绝',
};

const HUMAN_ONLY_FALLBACK = [
  'access-or-create-secret',
  'payment-or-purchase',
  'public-publishing',
  'send-external-message-as-user',
  'change-identity-or-permission-policy',
  'irreversible-deletion',
  'export-sensitive-data-outside-boundary',
] as const;

const HUMAN_ONLY_SHORT: Record<string, string> = {
  'access-or-create-secret': '密钥',
  'payment-or-purchase': '支付',
  'public-publishing': '发布',
  'send-external-message-as-user': '外发',
  'change-identity-or-permission-policy': '策略',
  'irreversible-deletion': '删除',
  'export-sensitive-data-outside-boundary': '越界导出',
};

export type ApprovalGateReadinessLevel = 'empty' | 'partial' | 'ready' | 'attention';

export interface ApprovalGateReadiness {
  level: ApprovalGateReadinessLevel;
  badge: string;
  countLabel: string;
  humanOnlyCount: number;
  pendingCount: number;
  historyCount: number;
  bridgeKinds: number;
  humanOnlyOk: boolean;
  hasMemoryBridge: boolean;
  hasSkillBridge: boolean;
  hasMcpBridge: boolean;
  hasTool: boolean;
  note: string;
}

export interface ApprovalGateReadinessItemLike {
  kind: string;
  state: string;
}

export interface ApprovalGateReadinessInput {
  items?: readonly ApprovalGateReadinessItemLike[] | null;
  /** Override pending count when Runtime reports separately. */
  pendingCount?: number;
  humanOnlyActions?: readonly string[] | null;
  /** Fallback list when host omits human-only policy (defaults to built-in 7). */
  humanOnlyFallback?: readonly string[] | null;
}

/**
 * Pure projector for Approval Center gate readiness (design §13).
 * Soft observability only — does NOT close M1; external hand-test + dogfood remain.
 */
export function projectApprovalGateReadiness(
  input: ApprovalGateReadinessInput,
): ApprovalGateReadiness {
  // Prefer non-empty host list → non-empty fallback → explicit empty arrays → built-in 7.
  // Explicit [] on both actions and fallback yields humanOnlyOk=false (testable empty/partial).
  let humanOnlyActions: readonly string[];
  if (input.humanOnlyActions != null && input.humanOnlyActions.length > 0) {
    humanOnlyActions = input.humanOnlyActions;
  } else if (input.humanOnlyFallback != null && input.humanOnlyFallback.length > 0) {
    humanOnlyActions = input.humanOnlyFallback;
  } else if (input.humanOnlyActions != null) {
    humanOnlyActions = input.humanOnlyActions;
  } else if (input.humanOnlyFallback != null) {
    humanOnlyActions = input.humanOnlyFallback;
  } else {
    humanOnlyActions = HUMAN_ONLY_FALLBACK;
  }
  const items = input.items ?? [];
  const pendingFromItems = items.filter((i) => i.state === 'pending').length;
  const pendingCount =
    input.pendingCount !== undefined && input.pendingCount !== null
      ? Math.max(0, Number(input.pendingCount) || 0)
      : pendingFromItems;
  const historyCount = items.filter((i) => i.state !== 'pending').length;
  const kindSet = new Set(items.map((i) => i.kind));
  const hasMemoryBridge = kindSet.has('memory');
  const hasSkillBridge = kindSet.has('skill-permission');
  const hasMcpBridge = kindSet.has('mcp-permission');
  const hasTool =
    kindSet.has('tool') || kindSet.has('plan') || kindSet.has('export') || kindSet.has('other');
  const humanOnlyCount = humanOnlyActions.length;
  const humanOnlyOk = humanOnlyCount >= 1;
  const bridgeKinds = [hasMemoryBridge, hasSkillBridge, hasMcpBridge, hasTool].filter(
    Boolean,
  ).length;

  let level: ApprovalGateReadinessLevel = 'partial';
  if (pendingCount > 0) level = 'attention';
  else if (humanOnlyOk) level = 'ready';
  else if (items.length === 0) level = 'empty';
  else level = 'partial';

  const badge =
    level === 'attention'
      ? `${pendingCount} 待审`
      : level === 'ready'
        ? '闸门空闲'
        : level === 'empty'
          ? '尚未观测'
          : '进行中';

  const countLabel =
    pendingCount > 0
      ? `${pendingCount} 待审 · ${historyCount} 已决`
      : historyCount > 0
        ? `队列空闲 · ${historyCount} 已决`
        : '队列空闲';

  let note = '';
  if (level === 'attention') {
    note = '有待审项：通过 / 拒绝会写回 Runtime，并与 Memory / Skill / MCP 桥双向同步。';
  } else if (level === 'ready') {
    note = '请求批准、替我审批和自定义模式会按策略入队；完全访问直接执行并保留审计记录。';
  } else if (level === 'empty') {
    note =
      '尚无敏感操作分类与队列记录。连接 Runtime 后加载策略；演示入队可验证 Memory / Skill / MCP 桥。';
  } else {
    note = '队列已有记录，但敏感操作分类尚未完整加载。';
  }

  return {
    level,
    badge,
    countLabel,
    humanOnlyCount,
    pendingCount,
    historyCount,
    bridgeKinds,
    humanOnlyOk,
    hasMemoryBridge,
    hasSkillBridge,
    hasMcpBridge,
    hasTool,
    note,
  };
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    return d.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function clip(text: string, max = 96): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function Section(props: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  testId: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="st-approval__section" data-testid={props.testId}>
      <button
        type="button"
        className="st-approval__section-toggle"
        onClick={props.onToggle}
        aria-expanded={props.open}
        data-testid={`${props.testId}-toggle`}
      >
        <span className="st-approval__section-left">
          {props.open ? (
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
          )}
          {props.icon}
          <span>{props.title}</span>
          <span className="st-approval__count">{props.count}</span>
        </span>
      </button>
      {props.open ? <div className="st-approval__section-body">{props.children}</div> : null}
    </section>
  );
}

/** Approval Center skeleton (design section 13 / 15.1 item 8). */
export function ApprovalCenterPanel(props: ApprovalCenterPanelProps) {
  const productMode = props.productMode !== false;
  const [pendingOpen, setPendingOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [historyVisibleCount, setHistoryVisibleCount] = useState(10);
  const [humanOpen, setHumanOpen] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState<ApprovalModeView>('request');
  const [demoAction, setDemoAction] = useState('shell.exec');
  const [demoHumanOnly, setDemoHumanOnly] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [decisionDelegateVersions, setDecisionDelegateVersions] = useState<Record<string, string>>(
    {},
  );
  const [policyScopeType, setPolicyScopeType] = useState<ApprovalPolicyScopeType>(
    props.defaultPolicyScope?.scopeType ?? 'workspace',
  );
  const [policyScopeId, setPolicyScopeId] = useState(props.defaultPolicyScope?.scopeId ?? '');
  const [policyMode, setPolicyMode] = useState<ApprovalModeView>(
    props.defaultPolicyMode ?? 'request',
  );
  const [policyRuleAction, setPolicyRuleAction] = useState('');
  const [policyRuleMode, setPolicyRuleMode] = useState<ApprovalModeView>('request');
  const [policyRuleDelegateId, setPolicyRuleDelegateId] = useState('');
  const [policyRuleTail, setPolicyRuleTail] = useState<ApprovalPolicyRuleView[]>([]);

  const policyHistory = useMemo(
    () => [...(props.policies ?? [])].sort((left, right) => right.version - left.version),
    [props.policies],
  );
  const latestScopedPolicy = policyHistory.find(
    (policy) => policy.scopeType === policyScopeType && policy.scopeId === policyScopeId,
  );

  useEffect(() => {
    if (!props.defaultPolicyScope) return;
    setPolicyScopeType(props.defaultPolicyScope.scopeType);
    setPolicyScopeId(props.defaultPolicyScope.scopeId);
  }, [props.defaultPolicyScope?.scopeId, props.defaultPolicyScope?.scopeType]);

  useEffect(() => {
    if (!latestScopedPolicy) {
      setPolicyMode(props.defaultPolicyMode ?? 'request');
      setPolicyRuleAction('');
      setPolicyRuleMode('request');
      setPolicyRuleDelegateId('');
      setPolicyRuleTail([]);
      return;
    }
    setPolicyMode(latestScopedPolicy.approvalMode);
    const rule = latestScopedPolicy.rules[0];
    setPolicyRuleAction(rule?.action ?? '');
    setPolicyRuleMode(rule?.approvalMode ?? 'request');
    setPolicyRuleDelegateId(rule?.delegateAgentVersionId ?? '');
    setPolicyRuleTail(latestScopedPolicy.rules.slice(1).map((item) => ({ ...item })));
  }, [latestScopedPolicy?.id, props.defaultPolicyMode]);

  const humanOnlyActions = props.humanOnlyActions?.length
    ? props.humanOnlyActions
    : HUMAN_ONLY_FALLBACK;

  const pending = useMemo(() => props.items.filter((i) => i.state === 'pending'), [props.items]);
  const allHistory = useMemo(() => props.items.filter((i) => i.state !== 'pending'), [props.items]);
  const history = allHistory.slice(0, historyVisibleCount);
  const firstHistoryId = allHistory[0]?.id;
  useEffect(() => setHistoryVisibleCount(10), [firstHistoryId]);
  const pendingCount = props.pendingCount ?? pending.length;

  const readiness = useMemo(
    () =>
      projectApprovalGateReadiness({
        items: props.items,
        pendingCount,
        humanOnlyActions: props.humanOnlyActions,
        humanOnlyFallback: HUMAN_ONLY_FALLBACK,
      }),
    [props.items, pendingCount, props.humanOnlyActions],
  );

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    if (!props.onDecide) return;
    const item = props.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const decidedBy = resolveApprovalDecisionActor(item);
    const delegateAgentVersionId =
      decidedBy === 'delegate'
        ? (decisionDelegateVersions[id] ?? item?.delegateAgentVersionId ?? '').trim()
        : '';
    if (decidedBy === 'delegate' && !delegateAgentVersionId) return;
    const decisionNote = decisionNotes[id]?.trim();
    setDecidingId(id);
    try {
      await props.onDecide({
        id,
        decision,
        decidedBy,
        ...(delegateAgentVersionId ? { delegateAgentVersionId } : {}),
        ...(decisionNote ? { decisionNote } : {}),
      });
    } finally {
      setDecidingId(null);
    }
  };

  const runEvaluate = async () => {
    if (!props.onEvaluateDemo) return;
    await props.onEvaluateDemo({
      mode: demoMode,
      action: demoHumanOnly ? 'payment-or-purchase' : demoAction,
      kind: demoHumanOnly ? 'human-only' : 'tool',
      insideExplicitPolicy: demoMode === 'full' || demoMode === 'custom',
      humanOnly: demoHumanOnly,
    });
  };

  const runEnqueue = async () => {
    if (!props.onEnqueueDemo) return;
    await props.onEnqueueDemo({
      mode: demoMode,
      action: demoHumanOnly ? 'irreversible-deletion' : demoAction,
      kind: demoHumanOnly ? 'human-only' : 'tool',
      summary: demoHumanOnly ? '演示：不可逆删除（敏感操作）' : `演示工具 · ${demoAction}`,
      insideExplicitPolicy: demoMode === 'full' || demoMode === 'custom',
    });
  };

  const savePolicy = async () => {
    if (!props.onSavePolicy || !policyScopeId.trim()) return;
    const action = policyRuleAction.trim();
    await props.onSavePolicy({
      ...(latestScopedPolicy ? { policyId: latestScopedPolicy.policyId } : {}),
      scopeType: policyScopeType,
      scopeId: policyScopeId.trim(),
      approvalMode: policyMode,
      rules: [
        ...(action
          ? [
              {
                action,
                approvalMode: policyRuleMode,
                ...(policyRuleMode === 'delegate' && policyRuleDelegateId
                  ? { delegateAgentVersionId: policyRuleDelegateId }
                  : {}),
              },
            ]
          : []),
        ...policyRuleTail.map((rule) => ({ ...rule })),
      ],
    });
  };

  return (
    <div className="st-approval" data-testid="approval-center-panel" data-level={readiness.level}>
      <header className="st-approval__header">
        <div className="st-approval__title-row">
          <span className="st-approval__mark" aria-hidden="true">
            <Gavel size={14} strokeWidth={1.9} />
          </span>
          <div>
            <strong>批准中心</strong>
            <small data-testid="approval-meta-label">{readiness.countLabel} · §13</small>
          </div>
          <button
            type="button"
            className="st-approval__icon-btn"
            data-testid="approval-refresh"
            disabled={props.loading || props.busy}
            onClick={() => void props.onRefresh?.()}
            title="刷新批准队列"
            aria-label="刷新批准队列"
          >
            <RefreshCw size={14} strokeWidth={1.9} />
          </button>
        </div>
        {props.statusNote ? (
          <p className="st-approval__status" data-testid="approval-status">
            {props.statusNote}
          </p>
        ) : null}
        {props.error ? (
          <p className="st-approval__error" data-testid="approval-error" role="alert">
            {props.error}
          </p>
        ) : null}
      </header>

      <div
        className="st-approval__readiness"
        data-testid="approval-gate-readiness"
        data-level={readiness.level}
        aria-label="批准闸门就绪（§13）"
      >
        <div className="st-approval__readiness-head">
          <Radar size={12} strokeWidth={1.8} aria-hidden="true" />
          <span>批准闸门</span>
          <small>§13 · 四种操作权限</small>
          <strong data-testid="approval-gate-readiness-badge">{readiness.badge}</strong>
        </div>
        <ul className="st-approval__readiness-list">
          <li data-ok={readiness.humanOnlyOk ? '1' : '0'} data-testid="approval-gate-check-human">
            <span className="st-approval__readiness-dot" aria-hidden="true" />
            敏感操作 {readiness.humanOnlyCount} 类
            {readiness.humanOnlyOk ? ' · 已加载' : ' · 未加载'}
          </li>
          <li
            data-ok={readiness.pendingCount === 0 ? '1' : '0'}
            data-testid="approval-gate-check-pending"
          >
            <span className="st-approval__readiness-dot" aria-hidden="true" />
            待审 {readiness.pendingCount}
            {readiness.pendingCount === 0 ? ' · 空闲' : ' · 需处理'}
          </li>
          <li
            data-ok={readiness.historyCount > 0 ? '1' : '0'}
            data-testid="approval-gate-check-history"
          >
            <span className="st-approval__readiness-dot" aria-hidden="true" />
            已决 {readiness.historyCount}
            {readiness.historyCount > 0 ? ' · 可回看' : ' · 尚无'}
          </li>
          <li
            data-ok={readiness.bridgeKinds > 0 ? '1' : '0'}
            data-testid="approval-gate-check-bridge"
          >
            <span className="st-approval__readiness-dot" aria-hidden="true" />
            桥接种类 {readiness.bridgeKinds}
            {readiness.bridgeKinds > 0
              ? ' · ' +
                [
                  readiness.hasMemoryBridge ? '记忆' : null,
                  readiness.hasSkillBridge ? 'Skill' : null,
                  readiness.hasMcpBridge ? 'MCP' : null,
                  readiness.hasTool ? '工具' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : ' · 演示入队可观测'}
          </li>
        </ul>
        <p className="st-approval__readiness-note" data-testid="approval-gate-readiness-note">
          {readiness.note}
        </p>
      </div>

      <div className="st-approval__body">
        <Section
          title="敏感操作"
          count={humanOnlyActions.length}
          open={humanOpen}
          onToggle={() => setHumanOpen((v) => !v)}
          testId="approval-section-human-only"
          icon={<ShieldAlert size={12} strokeWidth={1.8} aria-hidden="true" />}
        >
          <p className="st-approval__hint">完全访问自动执行；其他模式按当前策略处理</p>
          <div className="st-approval__chips" data-testid="approval-human-only-chips">
            {humanOnlyActions.map((action) => (
              <span
                key={action}
                className="st-approval__chip st-approval__chip--human"
                data-testid={`approval-human-chip-${action}`}
                title={action}
              >
                {HUMAN_ONLY_SHORT[action] ?? action}
              </span>
            ))}
          </div>
        </Section>

        {!productMode ? (
          <Section
            title="探测策略"
            count={4}
            open
            onToggle={() => undefined}
            testId="approval-section-probe"
            icon={<Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />}
          >
            <div className="st-approval__probe" data-testid="approval-probe">
              <label className="st-approval__field">
                <span>模式</span>
                <select
                  data-testid="approval-demo-mode"
                  value={demoMode}
                  onChange={(e) => setDemoMode(e.target.value as ApprovalModeView)}
                  disabled={props.busy}
                >
                  {(props.modes ?? (['request', 'delegate', 'full', 'custom'] as const)).map(
                    (m) => (
                      <option key={m} value={m}>
                        {MODE_LABEL[m]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="st-approval__field">
                <span>动作</span>
                <input
                  data-testid="approval-demo-action"
                  value={demoAction}
                  onChange={(e) => setDemoAction(e.target.value)}
                  disabled={props.busy || demoHumanOnly}
                  placeholder="shell.exec"
                />
              </label>
              <label className="st-approval__check">
                <input
                  type="checkbox"
                  data-testid="approval-demo-human-only"
                  checked={demoHumanOnly}
                  onChange={(e) => setDemoHumanOnly(e.target.checked)}
                  disabled={props.busy}
                />
                <span>敏感操作样例</span>
              </label>
              <div className="st-approval__probe-actions">
                <button
                  type="button"
                  className="st-approval__btn st-approval__btn--ghost"
                  data-testid="approval-demo-evaluate"
                  disabled={props.busy || !props.onEvaluateDemo}
                  onClick={() => void runEvaluate()}
                >
                  <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
                  评估
                </button>
                <button
                  type="button"
                  className="st-approval__btn"
                  data-testid="approval-demo-enqueue"
                  disabled={props.busy || !props.onEnqueueDemo}
                  onClick={() => void runEnqueue()}
                >
                  入队演示
                </button>
              </div>
            </div>
          </Section>
        ) : null}

        {productMode ? (
          <Section
            title="作用域策略"
            count={policyHistory.length}
            open
            onToggle={() => undefined}
            testId="approval-section-policy"
            icon={<ShieldCheck size={12} strokeWidth={1.8} aria-hidden="true" />}
          >
            <div className="st-approval__policy" data-testid="approval-policy-editor">
              <label className="st-approval__field">
                <span>作用域</span>
                <select
                  aria-label="策略作用域"
                  value={policyScopeType}
                  disabled={props.busy}
                  onChange={(event) =>
                    setPolicyScopeType(event.target.value as ApprovalPolicyScopeType)
                  }
                >
                  {(Object.keys(POLICY_SCOPE_LABEL) as ApprovalPolicyScopeType[]).map((scope) => (
                    <option key={scope} value={scope}>
                      {POLICY_SCOPE_LABEL[scope]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="st-approval__field st-approval__field--wide">
                <span>作用域 ID</span>
                <input
                  aria-label="策略作用域 ID"
                  value={policyScopeId}
                  disabled={props.busy}
                  onChange={(event) => setPolicyScopeId(event.target.value)}
                />
              </label>
              <label className="st-approval__field">
                <span>默认批准模式</span>
                <select
                  aria-label="策略审批模式"
                  value={policyMode}
                  disabled={props.busy}
                  onChange={(event) => setPolicyMode(event.target.value as ApprovalModeView)}
                >
                  {(props.modes ?? (['request', 'delegate', 'full', 'custom'] as const)).map(
                    (mode) => (
                      <option key={mode} value={mode}>
                        {MODE_LABEL[mode]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="st-approval__field">
                <span>动作覆盖（可选）</span>
                <input
                  aria-label="策略动作覆盖"
                  data-testid="approval-policy-rule-action"
                  value={policyRuleAction}
                  placeholder="例如 shell.exec"
                  disabled={props.busy}
                  onChange={(event) => setPolicyRuleAction(event.target.value)}
                />
              </label>
              <label className="st-approval__field">
                <span>动作批准模式</span>
                <select
                  aria-label="动作审批模式"
                  data-testid="approval-policy-rule-mode"
                  value={policyRuleMode}
                  disabled={props.busy || !policyRuleAction.trim()}
                  onChange={(event) => setPolicyRuleMode(event.target.value as ApprovalModeView)}
                >
                  {(props.modes ?? (['request', 'delegate', 'full', 'custom'] as const)).map(
                    (mode) => (
                      <option key={mode} value={mode}>
                        {MODE_LABEL[mode]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="st-approval__field st-approval__field--wide">
                <span>委托 Agent 版本</span>
                <select
                  aria-label="委托 Agent 版本"
                  data-testid="approval-policy-rule-delegate"
                  value={policyRuleDelegateId}
                  disabled={props.busy || !policyRuleAction.trim() || policyRuleMode !== 'delegate'}
                  onChange={(event) => setPolicyRuleDelegateId(event.target.value)}
                >
                  <option value="">选择 exact AgentVersion</option>
                  {(props.delegateAgentVersions ?? []).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.agentName} · v{agent.version} · {agent.id}
                    </option>
                  ))}
                </select>
              </label>
              {policyRuleTail.length > 0 ? (
                <p
                  className="st-approval__hint st-approval__policy-preserved"
                  data-testid="approval-policy-preserved-rules"
                  title={policyRuleTail.map((rule) => rule.action).join(', ')}
                >
                  其余 {policyRuleTail.length} 条动作规则保持不变
                </p>
              ) : null}
              <button
                type="button"
                className="st-approval__btn st-approval__policy-save"
                data-testid="approval-policy-save"
                disabled={
                  props.busy ||
                  !props.onSavePolicy ||
                  !policyScopeId.trim() ||
                  (Boolean(policyRuleAction.trim()) &&
                    policyRuleMode === 'delegate' &&
                    !policyRuleDelegateId)
                }
                onClick={() => void savePolicy()}
              >
                <Save size={12} strokeWidth={2} aria-hidden="true" />
                保存策略新版本
              </button>
            </div>
            {policyHistory.length > 0 ? (
              <ol className="st-approval__policy-history" aria-label="策略版本历史">
                {policyHistory.map((policy) => (
                  <li key={policy.id} data-testid={`approval-policy-${policy.id}`}>
                    <strong>
                      v{policy.version} · {POLICY_SCOPE_LABEL[policy.scopeType]}
                    </strong>
                    <span>{policy.scopeId}</span>
                    <small>
                      {MODE_LABEL[policy.approvalMode]} · {formatTime(policy.createdAt)}
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="st-approval__hint">尚无策略版本。保存后历史版本保持只读。</p>
            )}
          </Section>
        ) : null}

        <Section
          title="待审"
          count={pending.length}
          open={pendingOpen}
          onToggle={() => setPendingOpen((v) => !v)}
          testId="approval-section-pending"
          icon={<Gavel size={12} strokeWidth={1.8} aria-hidden="true" />}
        >
          {props.loading && pending.length === 0 ? (
            <p className="st-approval__hint">加载中…</p>
          ) : pending.length === 0 ? (
            <div className="st-approval__empty-card" data-testid="approval-pending-empty">
              <strong>暂无待审</strong>
              <p>
                队列空闲时策略仍在工作：敏感操作分类已就绪。
                {productMode
                  ? '触发计划、工具、Memory、Skill 或 MCP 敏感动作后会在这里出现。'
                  : '用上方「入队演示」或触发 Memory / Skill / MCP 敏感动作可观测入队。'}
              </p>
            </div>
          ) : (
            <ul className="st-approval__list" data-testid="approval-pending-list">
              {pending.map((item) => {
                const busyThis = decidingId === item.id || props.busy;
                const decisionActor = resolveApprovalDecisionActor(item);
                const selectedDelegateVersion =
                  decisionDelegateVersions[item.id] ?? item.delegateAgentVersionId ?? '';
                const delegateVersions = item.delegateAgentVersionId
                  ? (props.delegateAgentVersions ?? []).filter(
                      (version) => version.id === item.delegateAgentVersionId,
                    )
                  : (props.delegateAgentVersions ?? []);
                const configuredDelegateMissing =
                  Boolean(item.delegateAgentVersionId) &&
                  !delegateVersions.some((version) => version.id === item.delegateAgentVersionId);
                const delegateSelectionMissing =
                  decisionActor === 'delegate' &&
                  (selectedDelegateVersion.length === 0 || configuredDelegateMissing);
                return (
                  <li
                    key={item.id}
                    data-testid={`approval-pending-${item.id}`}
                    data-human-only={item.humanOnly ? 'true' : 'false'}
                  >
                    <div className="st-approval__row-head">
                      <span className="st-approval__state" data-state={item.state}>
                        {STATE_LABEL[item.state]}
                      </span>
                      <span className="st-approval__chip">{KIND_LABEL[item.kind]}</span>
                      {item.humanOnly ? (
                        <span className="st-approval__chip st-approval__chip--warn">
                          需本人确认
                        </span>
                      ) : null}
                      <span className="st-approval__mode">{MODE_LABEL[item.mode]}</span>
                    </div>
                    <p className="st-approval__action">{item.action}</p>
                    <p className="st-approval__summary">{clip(item.summary || item.action)}</p>
                    {item.runId ? (
                      <button
                        type="button"
                        className="st-approval__deep-link"
                        data-testid={`approval-deep-link-${item.id}`}
                        aria-label={`打开 Run ${item.runId}${item.stepId ? ` Step ${item.stepId}` : ''}`}
                        disabled={!props.onNavigateToRunStep}
                        onClick={() =>
                          props.onNavigateToRunStep?.({
                            ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
                            ...(item.taskId ? { taskId: item.taskId } : {}),
                            runId: item.runId!,
                            ...(item.stepId ? { stepId: item.stepId } : {}),
                          })
                        }
                      >
                        <Link2 size={11} strokeWidth={2} aria-hidden="true" />
                        Run {item.runId}
                        {item.stepId ? ` · Step ${item.stepId}` : ''}
                      </button>
                    ) : null}
                    <time className="st-approval__time" dateTime={item.createdAt}>
                      {formatTime(item.createdAt)}
                    </time>
                    <div className="st-approval__decision-fields">
                      <label className="st-approval__field">
                        <span>决策者</span>
                        <select
                          aria-label={`决策者 ${item.id}`}
                          data-testid={`approval-decision-actor-${item.id}`}
                          value={decisionActor}
                          disabled
                        >
                          {decisionActor === 'delegate' ? (
                            <option value="delegate">委托 Agent</option>
                          ) : (
                            <option value="human">真人</option>
                          )}
                        </select>
                      </label>
                      {decisionActor === 'delegate' ? (
                        <label className="st-approval__field">
                          <span>委托版本</span>
                          <select
                            aria-label={`委托版本 ${item.id}`}
                            data-testid={`approval-delegate-version-${item.id}`}
                            value={selectedDelegateVersion}
                            disabled={busyThis}
                            onChange={(event) =>
                              setDecisionDelegateVersions((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="">选择 exact AgentVersion</option>
                            {configuredDelegateMissing && item.delegateAgentVersionId ? (
                              <option value={item.delegateAgentVersionId} disabled>
                                exact 不可用 · {item.delegateAgentVersionId}
                              </option>
                            ) : null}
                            {delegateVersions.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                {agent.agentName} · v{agent.version} · {agent.id}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <label className="st-approval__field st-approval__field--wide">
                        <span>审批说明</span>
                        <textarea
                          aria-label={`审批说明 ${item.id}`}
                          rows={2}
                          maxLength={2000}
                          value={decisionNotes[item.id] ?? ''}
                          disabled={busyThis}
                          onChange={(event) =>
                            setDecisionNotes((current) => ({
                              ...current,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="st-approval__decide">
                      <button
                        type="button"
                        className="st-approval__approve"
                        data-testid={`approval-approve-${item.id}`}
                        disabled={busyThis || !props.onDecide || delegateSelectionMissing}
                        onClick={() => void decide(item.id, 'approved')}
                      >
                        <Check size={12} strokeWidth={2} aria-hidden="true" />
                        通过
                      </button>
                      <button
                        type="button"
                        className="st-approval__reject"
                        data-testid={`approval-reject-${item.id}`}
                        disabled={busyThis || !props.onDecide || delegateSelectionMissing}
                        onClick={() => void decide(item.id, 'rejected')}
                      >
                        <X size={12} strokeWidth={2} aria-hidden="true" />
                        拒绝
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="已决"
          count={allHistory.length}
          open={historyOpen}
          onToggle={() => setHistoryOpen((v) => !v)}
          testId="approval-section-history"
          icon={<ShieldCheck size={12} strokeWidth={1.8} aria-hidden="true" />}
        >
          {history.length === 0 ? (
            <p className="st-approval__hint">通过或拒绝后会出现在这里</p>
          ) : (
            <ul
              className="st-approval__list st-approval__list--history"
              data-testid="approval-history"
            >
              {history.map((item) => (
                <li
                  key={item.id}
                  data-testid={`approval-history-${item.id}`}
                  data-state={item.state}
                >
                  <div className="st-approval__row-head">
                    <span className="st-approval__state" data-state={item.state}>
                      {STATE_LABEL[item.state]}
                    </span>
                    <span className="st-approval__chip">{KIND_LABEL[item.kind]}</span>
                    {item.humanOnly ? (
                      <span className="st-approval__chip st-approval__chip--warn">需本人确认</span>
                    ) : null}
                  </div>
                  <p className="st-approval__action">{item.action}</p>
                  <p className="st-approval__summary">{clip(item.summary || item.action)}</p>
                  {item.decidedBy === 'delegate' && item.delegateAgentVersionId ? (
                    <p
                      className="st-approval__summary"
                      data-testid={`approval-history-delegate-${item.id}`}
                    >
                      委托{' '}
                      {(() => {
                        const delegate = props.delegateAgentVersions?.find(
                          (version) => version.id === item.delegateAgentVersionId,
                        );
                        return delegate
                          ? `${delegate.agentName} · v${delegate.version} · ${delegate.id}`
                          : item.delegateAgentVersionId;
                      })()}
                    </p>
                  ) : null}
                  {item.runId ? (
                    <button
                      type="button"
                      className="st-approval__deep-link"
                      data-testid={`approval-deep-link-${item.id}`}
                      aria-label={`打开 Run ${item.runId}${item.stepId ? ` Step ${item.stepId}` : ''}`}
                      disabled={!props.onNavigateToRunStep}
                      onClick={() =>
                        props.onNavigateToRunStep?.({
                          ...(item.workspaceId ? { workspaceId: item.workspaceId } : {}),
                          ...(item.taskId ? { taskId: item.taskId } : {}),
                          runId: item.runId!,
                          ...(item.stepId ? { stepId: item.stepId } : {}),
                        })
                      }
                    >
                      <Link2 size={11} strokeWidth={2} aria-hidden="true" />
                      Run {item.runId}
                      {item.stepId ? ` · Step ${item.stepId}` : ''}
                    </button>
                  ) : null}
                  {item.decisionNote ? (
                    <blockquote className="st-approval__decision-note">
                      {item.decisionNote}
                    </blockquote>
                  ) : null}
                  {item.decidedAt ? (
                    <time className="st-approval__time" dateTime={item.decidedAt}>
                      {formatTime(item.decidedAt)}
                      {item.decidedBy ? ` · ${item.decidedBy}` : ''}
                    </time>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {history.length < allHistory.length ? (
            <button
              type="button"
              className="st-approval__btn st-approval__btn--ghost st-approval__load-more"
              onClick={() =>
                setHistoryVisibleCount((count) => Math.min(allHistory.length, count + 10))
              }
              aria-label={`加载更多已决记录（还有 ${allHistory.length - history.length} 条）`}
            >
              加载更多已决记录 · {allHistory.length - history.length}
            </button>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
