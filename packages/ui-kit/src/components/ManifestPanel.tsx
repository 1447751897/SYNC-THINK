import { useMemo, useState, type ReactNode } from 'react';
import {
  Ban,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Layers,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  X,
  Radar,
} from 'lucide-react';

export interface ManifestSourceItem {
  id: string;
  kind: string;
  tokenEstimate?: number;
}

export interface ManifestSummaryItem {
  sourceId: string;
  summary: string;
}

export interface ManifestTruncationItem {
  sourceId: string;
  reason: string;
  beforeTokens?: number;
  afterTokens?: number;
}

export interface ManifestInspectView {
  id: string;
  packetId: string;
  proofHash?: string;
  runId?: string;
  modelId?: string;
  providerModelId?: string;
  resolutionSource?: string;
  credentialResolutionSource?: string;
  credentialRefId?: string;
  agentVersionId?: string;
  /** Immutable AgentVersion.version number when known (§10.3). */
  agentVersion?: number;
  skillVersionIds?: readonly string[];
  /** Agent MCP server allowlist ids used when packet was built (§9.3). */
  mcpServerIds?: readonly string[];
  policyId?: string;
  fallbackIndex?: number;
  tokenEstimate?: number;
  includedSourceIds?: readonly string[];
  excludedSourceIds?: readonly string[];
  included?: readonly ManifestSourceItem[];
  excluded?: readonly ManifestSourceItem[];
  summaries?: readonly ManifestSummaryItem[];
  truncations?: readonly ManifestTruncationItem[];
  crossTaskRefs?: readonly string[];
  evidenceRefsForMemory?: readonly string[];
  occurredAt?: string;
}

export interface ManifestPanelProps {
  manifests: readonly ManifestInspectView[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  emptyState?: ReactNode;
  /** Read-only context.packet.peek — no model run. */
  onPeek?: () => void;
  peekBusy?: boolean;
  peekLabel?: string;
  onExcludeSource?: (sourceId: string) => void;
  onClearAmendments?: () => void;
  amendBusy?: boolean;
  activeExcludeSourceIds?: readonly string[];
  amendStatus?: string | null;
  /** Hide the readiness strip (tests / dense embeds). */
  hideReadiness?: boolean;
}

export type ManifestReadinessLevel = 'empty' | 'partial' | 'inspectable' | 'amended';

export interface ManifestReadiness {
  level: ManifestReadinessLevel;
  badge: string;
  callCount: number;
  hasSelection: boolean;
  hasProof: boolean;
  hasResolution: boolean;
  hasLadderHit: boolean;
  includedCount: number;
  excludedCount: number;
  skillCount: number;
  toolSchemaCount: number;
  hasSkill: boolean;
  hasToolSchema: boolean;
  hasCrossTask: boolean;
  hasMemoryEvidence: boolean;
  hasAmends: boolean;
  canPeek: boolean;
  resolutionLabel: string | null;
  note: string;
}

/** Pure projector for tests + UI — §6/§10 inspectable Manifest observability. */
export function projectManifestReadiness(input: {
  manifests: readonly ManifestInspectView[];
  selectedId?: string | null;
  activeExcludeSourceIds?: readonly string[];
  canPeek?: boolean;
}): ManifestReadiness {
  const callCount = input.manifests.length;
  const selected =
    callCount === 0
      ? null
      : input.selectedId
        ? (input.manifests.find((m) => m.id === input.selectedId) ?? null)
        : (input.manifests[input.manifests.length - 1] ?? null);
  const hasSelection = Boolean(selected);
  const hasProof = Boolean(selected?.proofHash);
  const hasResolution = Boolean(selected?.resolutionSource);
  const hasLadderHit =
    selected?.resolutionSource === 'runOverride' ||
    selected?.resolutionSource === 'workflowBinding' ||
    selected?.resolutionSource === 'agentDefault' ||
    selected?.resolutionSource === 'globalDefault';
  const includedCount =
    selected?.included?.length ?? selected?.includedSourceIds?.length ?? 0;
  const excludedCount =
    selected?.excluded?.length ?? selected?.excludedSourceIds?.length ?? 0;
  const skillCount =
    selected?.skillVersionIds?.length ??
    (selected?.included ?? []).filter((s) => s.kind === 'skill-definition').length;
  const toolSchemaCount = (selected?.included ?? []).filter((x) => x.kind === 'tool-schema').length;
  const hasSkill = skillCount > 0;
  const hasToolSchema = toolSchemaCount > 0 || (selected?.mcpServerIds?.length ?? 0) > 0;
  const hasCrossTask = (selected?.crossTaskRefs?.length ?? 0) > 0;
  const hasMemoryEvidence = (selected?.evidenceRefsForMemory?.length ?? 0) > 0;
  const hasAmends = (input.activeExcludeSourceIds?.length ?? 0) > 0;
  const canPeek = Boolean(input.canPeek);
  const resolutionLabel = selected?.resolutionSource ?? null;

  let level: ManifestReadinessLevel = 'empty';
  if (callCount === 0) level = 'empty';
  else if (hasAmends) level = 'amended';
  else if (hasSelection && hasProof && (hasResolution || includedCount > 0)) level = 'inspectable';
  else if (hasSelection || callCount > 0) level = 'partial';

  const badge =
    level === 'amended'
      ? '已修订'
      : level === 'inspectable'
        ? '可检查'
        : level === 'partial'
          ? '部分'
          : canPeek
            ? '可预览'
            : '静默';

  const notes: string[] = [];
  if (callCount === 0) {
    notes.push(
      canPeek
        ? '尚无调用记录 · 可先「预览上下文」检查将入包的源'
        : '发送消息后这里会出现可检查的 Context Manifest',
    );
  } else if (hasAmends) {
    notes.push('本地修订生效中 · 下次预览/Run 会按排除源重建 Packet');
  } else if (level === 'inspectable') {
    notes.push('点选调用可核对绑定阶梯 · 入包/排除 · proof · Skill/工具');
  } else {
    notes.push('已有调用 · 选择条目查看 proof 与来源分解');
  }

  return {
    level,
    badge,
    callCount,
    hasSelection,
    hasProof,
    hasResolution,
    hasLadderHit,
    includedCount,
    excludedCount,
    skillCount,
    toolSchemaCount,
    hasSkill,
    hasToolSchema,
    hasCrossTask,
    hasMemoryEvidence,
    hasAmends,
    canPeek,
    resolutionLabel,
    note: notes.join(' · '),
  };
}


const SOURCE_KIND_LABEL: Record<string, string> = {
  'task-goal': '任务目标',
  'task-status': '任务状态',
  constraint: '约束',
  'acceptance-criteria': '验收标准',
  decision: '决策',
  'project-memory': '项目记忆',
  'agent-instructions': 'Agent 指令',
  'output-contract': '输出契约',
  'skill-definition': 'Skill',
  'tool-schema': '工具 Schema',
  'message-excerpt': '消息摘录',
  'file-excerpt': '文件摘录',
  'artifact-version': '产物版本',
  'review-evidence': '评审证据',
  'unresolved-issue': '未决问题',
  'cross-task-ref': '跨任务引用',
  unknown: '来源',
};

const RESOLUTION_LABEL: Record<string, string> = {
  runOverride: '本轮覆盖',
  workflowBinding: '工作流绑定',
  agentDefault: 'Agent 默认',
  agentFallback: 'Fallback',
};

/** Credential resolution labels (§6 / inspectable Manifest). */
const CREDENTIAL_RESOLUTION_LABEL: Record<string, string> = {
  pinned: '固定密钥',
  group: '凭证组',
  providerDefault: 'Provider 主密钥',
  unassigned: '未指定',
};

function kindLabel(kind: string): string {
  return SOURCE_KIND_LABEL[kind] ?? kind;
}

const PROTECTED_MANIFEST_KINDS = new Set([
  'task-goal',
  'acceptance-criteria',
  'decision',
  'constraint',
]);

function isProtectedManifestKind(kind: string): boolean {
  return PROTECTED_MANIFEST_KINDS.has(kind);
}

function resolutionLabel(source?: string): string {
  if (!source) return '—';
  return RESOLUTION_LABEL[source] ?? source;
}

function credentialResolutionLabel(source?: string): string {
  if (!source) return '';
  return CREDENTIAL_RESOLUTION_LABEL[source] ?? source;
}

/** Map resolutionSource → ladder rank (1..4) for active highlight. */
function resolutionRank(source?: string): number | null {
  switch (source) {
    case 'runOverride':
      return 1;
    case 'workflowBinding':
      return 2;
    case 'agentDefault':
      return 3;
    case 'agentFallback':
      return 4;
    default:
      return null;
  }
}

function shortHash(hash?: string): string {
  if (!hash) return '—';
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

function formatTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return iso.slice(0, 16);
  }
}

function clip(text: string, max = 96): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Inspectable Context Manifest panel (product §10.3).
 * Continuum Bench: calm instrument — included/excluded sources, proof, tokens.
 * Selection can come from Trace item click (same id as context.packet.built event).
 */
export function ManifestPanel(props: ManifestPanelProps) {
  const [listOpen, setListOpen] = useState(true);
  const [includedOpen, setIncludedOpen] = useState(true);
  const [excludedOpen, setExcludedOpen] = useState(true);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [crossOpen, setCrossOpen] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState(true);

  const selected = useMemo(() => {
    if (!props.manifests.length) return null;
    if (props.selectedId) {
      return props.manifests.find((m) => m.id === props.selectedId) ?? null;
    }
    return props.manifests[props.manifests.length - 1] ?? null;
  }, [props.manifests, props.selectedId]);

  const included = selected?.included ?? [];
  const excluded = selected?.excluded ?? [];
  const summaries = selected?.summaries ?? [];
  const truncations = selected?.truncations ?? [];
  const crossTaskRefs = selected?.crossTaskRefs ?? [];
  const evidenceRefs = selected?.evidenceRefsForMemory ?? [];
  const hasSelection = Boolean(selected);

  const activeExcludeIds = props.activeExcludeSourceIds ?? [];
  const hasActiveAmends = activeExcludeIds.length > 0;
  const skillDefCount = included.filter((s) => s.kind === 'skill-definition').length;
  const toolSchemaCount = (selected?.included ?? []).filter((x) => x.kind === 'tool-schema').length;

  const readiness = useMemo(
    () =>
      projectManifestReadiness({
        manifests: props.manifests,
        selectedId: props.selectedId,
        activeExcludeSourceIds: props.activeExcludeSourceIds,
        canPeek: Boolean(props.onPeek),
      }),
    [
      props.manifests,
      props.selectedId,
      props.activeExcludeSourceIds,
      props.onPeek,
    ],
  );

  const metaLabel = props.manifests.length
    ? `${props.manifests.length} 次调用 · ${selected ? shortHash(selected.proofHash) : '—'}`
    : '尚无 Manifest';

  return (
    <section
      className="st-manifest"
      aria-label="Context Manifest"
      data-testid="manifest-panel"
      data-level={readiness.level}
      data-call-count={String(readiness.callCount)}
    >
      <header className="st-manifest__header">
        <div className="st-manifest__title-row">
          <span className="st-manifest__mark" aria-hidden="true">
            <FileSearch size={14} strokeWidth={1.8} />
          </span>
          <div>
            <strong>Manifest</strong>
            <small data-testid="manifest-meta-label">{metaLabel}</small>
          </div>
        </div>
        <div className="st-manifest__actions">
          {props.onPeek ? (
            <button
              type="button"
              className="st-manifest__peek-btn"
              data-testid="manifest-peek"
              aria-label="预览当前上下文 Packet"
              disabled={Boolean(props.peekBusy)}
              onClick={() => props.onPeek?.()}
            >
              <ScanSearch size={13} strokeWidth={1.9} aria-hidden="true" />
              <span>{props.peekBusy ? '预览中…' : props.peekLabel ?? '预览上下文'}</span>
            </button>
          ) : null}
          {props.onClearAmendments && hasActiveAmends ? (
            <button
              type="button"
              className="st-manifest__amend-clear-btn"
              data-testid="manifest-clear-amends"
              aria-label="清除上下文修订，恢复自动选择"
              disabled={Boolean(props.amendBusy)}
              onClick={() => props.onClearAmendments?.()}
            >
              <RotateCcw size={12} strokeWidth={1.9} aria-hidden="true" />
              <span>恢复自动</span>
            </button>
          ) : null}
          {props.selectedId ? (
            <button
              type="button"
              className="st-manifest__icon-btn"
              data-testid="manifest-clear-selection"
              aria-label="清除选中，显示最近一次"
              onClick={() => props.onSelect?.(null)}
            >
              <X size={13} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      {props.amendStatus || hasActiveAmends ? (
        <div className="st-manifest__amend-bar" data-testid="manifest-amend-bar">
          <span className="st-manifest__amend-pill" data-testid="manifest-amend-count">
            修订 {activeExcludeIds.length}
          </span>
          <span className="st-manifest__amend-msg" data-testid="manifest-amend-status">
            {props.amendStatus ??
              (hasActiveAmends
                ? '已强制排除部分来源 · 下次预览/Run 生效'
                : '')}
          </span>
        </div>
      ) : null}


      {props.hideReadiness ? null : (
        <div
          className="st-manifest__readiness"
          data-testid="manifest-readiness"
          data-level={readiness.level}
          aria-label="Manifest 可检查就绪"
        >
          <div className="st-manifest__readiness-head">
            <Radar size={12} strokeWidth={1.8} aria-hidden="true" />
            <span>Manifest 可检查</span>
            <small>§6 · §10</small>
            <strong data-testid="manifest-readiness-badge">{readiness.badge}</strong>
          </div>
          <ul className="st-manifest__readiness-list">
            <li data-ok={readiness.callCount > 0 ? '1' : '0'} data-testid="manifest-check-calls">
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              调用 {readiness.callCount}
              {readiness.callCount > 0 ? ' · 有记录' : ' · 尚无'}
            </li>
            <li data-ok={readiness.hasSelection ? '1' : '0'} data-testid="manifest-check-selected">
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              选中 {readiness.hasSelection ? '当前条目' : '—'}
            </li>
            <li data-ok={readiness.hasResolution ? '1' : '0'} data-testid="manifest-check-resolution">
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              绑定阶梯 {readiness.hasResolution ? (readiness.hasLadderHit ? '命中' : '有来源') : '—'}
            </li>
            <li data-ok={readiness.hasProof ? '1' : '0'} data-testid="manifest-check-proof">
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              Proof {readiness.hasProof ? '可核' : '无'}
            </li>
            <li data-ok={readiness.includedCount > 0 ? '1' : '0'} data-testid="manifest-check-included">
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              入包 {readiness.includedCount}
              {readiness.excludedCount > 0 ? ` · 排除 ${readiness.excludedCount}` : ''}
            </li>
            <li
              data-ok={readiness.hasSkill || readiness.hasToolSchema ? '1' : '0'}
              data-testid="manifest-check-skill-tool"
            >
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              Skill/工具 {readiness.skillCount}/{readiness.toolSchemaCount}
            </li>
            <li
              data-ok={readiness.hasCrossTask || readiness.hasMemoryEvidence ? '1' : '0'}
              data-testid="manifest-check-cross-evidence"
            >
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              跨任务·证据 {readiness.hasCrossTask || readiness.hasMemoryEvidence ? '有' : '无'}
            </li>
            <li
              data-ok={readiness.canPeek || readiness.hasAmends ? '1' : '0'}
              data-testid="manifest-check-peek-amends"
            >
              <span className="st-manifest__readiness-dot" aria-hidden="true" />
              {readiness.hasAmends ? '修订中' : readiness.canPeek ? '可预览' : '预览未接'}
            </li>
          </ul>
          <p className="st-manifest__readiness-note" data-testid="manifest-readiness-note">
            {readiness.note}
          </p>
        </div>
      )}

      {props.manifests.length === 0 ? (
        <p className="st-manifest__empty" data-testid="manifest-empty">
          {props.emptyState ?? (
            <>
              每次模型调用会在此留下可检查的 Context Manifest（绑定来源 / 入包源 / proof）。
              {props.onPeek ? (
                <span className="st-manifest__empty-hint" data-testid="manifest-empty-peek-hint">
                  {' '}也可随时「预览上下文」，无需发消息。
                </span>
              ) : null}
            </>
          )}
        </p>
      ) : (
        <div className="st-manifest__body">
          <div className="st-manifest__section">
            <button
              type="button"
              className="st-manifest__section-toggle"
              data-testid="manifest-list-toggle"
              aria-expanded={listOpen}
              onClick={() => setListOpen((v) => !v)}
            >
              <span className="st-manifest__section-left">
                {listOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>调用记录</span>
              </span>
              <span className="st-manifest__count">{props.manifests.length}</span>
            </button>
            {listOpen ? (
              <ul className="st-manifest__list st-manifest__list--calls" data-testid="manifest-call-list">
                {[...props.manifests].reverse().map((m) => {
                  const active = selected?.id === m.id;
                  const label = m.providerModelId ?? m.modelId ?? m.packetId.slice(0, 8);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="st-manifest__call"
                        data-testid={`manifest-call-${m.id}`}
                        data-active={active ? '1' : '0'}
                        aria-pressed={active}
                        onClick={() => props.onSelect?.(active ? null : m.id)}
                      >
                        <span className="st-manifest__call-main">
                          <span className="st-manifest__call-model">{label}</span>
                          <span className="st-manifest__chip">
                            {resolutionLabel(m.resolutionSource)}
                          </span>
                          {typeof m.fallbackIndex === 'number' ? (
                            <span className="st-manifest__chip st-manifest__chip--warn">
                              fb#{m.fallbackIndex}
                            </span>
                          ) : null}
                        </span>
                        <span className="st-manifest__call-meta">
                          {typeof m.tokenEstimate === 'number' ? `~${m.tokenEstimate} tok` : '—'}
                          {m.occurredAt ? ` · ${formatTime(m.occurredAt)}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>

          {hasSelection && selected ? (
            <>
              <div className="st-manifest__proof" data-testid="manifest-proof">
                <div className="st-manifest__proof-row">
                  <ShieldCheck size={12} strokeWidth={1.9} aria-hidden="true" />
                  <span>proof</span>
                  <code data-testid="manifest-proof-hash">{shortHash(selected.proofHash)}</code>
                </div>
                                <div
                  className="st-manifest__resolve-ladder"
                  data-testid="manifest-resolve-ladder"
                  aria-label="本次模型解析来源"
                >
                  <div className="st-manifest__resolve-head">
                    <span className="st-manifest__resolve-kicker">解析</span>
                    <strong data-testid="manifest-resolution-badge">
                      {resolutionLabel(selected.resolutionSource)}
                    </strong>
                    {typeof selected.fallbackIndex === 'number' ? (
                      <span className="st-manifest__chip st-manifest__chip--warn">
                        Fallback #{selected.fallbackIndex + 1}
                      </span>
                    ) : null}
                  </div>
                  <ol className="st-manifest__resolve-steps" aria-label="绑定优先级">
                    {(
                      [
                        { rank: 1, key: 'runOverride', label: '本轮覆盖' },
                        { rank: 2, key: 'workflowBinding', label: '工作流' },
                        { rank: 3, key: 'agentDefault', label: 'Agent 默认' },
                        { rank: 4, key: 'agentFallback', label: 'Fallback' },
                      ] as const
                    ).map((step) => {
                      const active = resolutionRank(selected.resolutionSource) === step.rank;
                      return (
                        <li
                          key={step.key}
                          data-rank={step.rank}
                          data-active={active ? '1' : undefined}
                          data-testid={`manifest-resolve-step-${step.key}`}
                        >
                          <span className="st-manifest__resolve-rank">{step.rank}</span>
                          <span className="st-manifest__resolve-step-label">{step.label}</span>
                          {active &&
                          step.key === 'agentFallback' &&
                          typeof selected.fallbackIndex === 'number' ? (
                            <span className="st-manifest__resolve-step-meta">
                              #{selected.fallbackIndex + 1}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  <span className="st-manifest__resolve-hint">
                    优先级：本轮覆盖 → 工作流 → Agent 默认 → Fallback
                  </span>
                </div>
                <dl className="st-manifest__kv">
                  <div>
                    <dt>Packet</dt>
                    <dd data-testid="manifest-packet-id">{selected.packetId}</dd>
                  </div>
                  <div>
                    <dt>模型</dt>
                    <dd data-testid="manifest-model">
                      {selected.providerModelId ?? selected.modelId ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>绑定来源</dt>
                    <dd data-testid="manifest-resolution">
                      {resolutionLabel(selected.resolutionSource)}
                      {typeof selected.fallbackIndex === 'number'
                        ? ` · 链位 #${selected.fallbackIndex + 1}`
                        : ''}
                    </dd>
                  </div>
                  {(selected.credentialResolutionSource || selected.credentialRefId) && (
                    <div>
                      <dt>凭证</dt>
                      <dd data-testid="manifest-credential-source">
                        {[
                          credentialResolutionLabel(selected.credentialResolutionSource) ||
                            selected.credentialResolutionSource,
                          selected.credentialRefId
                            ? `ref ${selected.credentialRefId.slice(0, 8)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Tokens</dt>
                    <dd data-testid="manifest-tokens">
                      {typeof selected.tokenEstimate === 'number'
                        ? `~${selected.tokenEstimate}`
                        : '—'}
                    </dd>
                  </div>
                  {selected.agentVersionId || selected.agentVersion != null ? (
                    <div>
                      <dt>Agent</dt>
                      <dd data-testid="manifest-agent-version">
                        {[
                          selected.agentVersion != null ? `v${selected.agentVersion}` : null,
                          selected.agentVersionId ? selected.agentVersionId.slice(0, 12) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </dd>
                    </div>
                  ) : null}
                  {(selected.skillVersionIds?.length ?? 0) > 0 || skillDefCount > 0 ? (
                    <div>
                      <dt>Skills</dt>
                      <dd data-testid="manifest-skill-versions">
                        {selected.skillVersionIds?.length ?? 0}
                        {skillDefCount > 0 ? (
                          <span data-testid="manifest-skill-source-count">
                            {' '}
                            · 入包 {skillDefCount}
                          </span>
                        ) : null}
                        {(selected.skillVersionIds?.length ?? 0) > 0 ? (
                          <>
                            {' '}
                            ·{' '}
                            {selected.skillVersionIds!.slice(0, 3).map((id) => id.slice(0, 10)).join(', ')}
                            {selected.skillVersionIds!.length > 3 ? '…' : ''}
                          </>
                        ) : null}
                      </dd>
                    </div>
                  ) : (
                    <div>
                      <dt>Skills</dt>
                      <dd data-testid="manifest-skill-versions">none</dd>
                    </div>
                  )}
                  {(selected.mcpServerIds?.length ?? 0) > 0 || toolSchemaCount > 0 ? (
                    <div>
                      <dt>MCP</dt>
                      <dd data-testid="manifest-mcp-servers">
                        {selected.mcpServerIds?.length ?? 0}
                        {toolSchemaCount > 0 ? (
                          <span data-testid="manifest-mcp-source-count">
                            {' '}
                            · 入包 {toolSchemaCount}
                          </span>
                        ) : null}
                        {(selected.mcpServerIds?.length ?? 0) > 0 ? (
                          <>
                            {' '}
                            ·{' '}
                            {selected.mcpServerIds!.slice(0, 3).map((id) => id.slice(0, 10)).join(', ')}
                            {selected.mcpServerIds!.length > 3 ? '…' : ''}
                          </>
                        ) : null}
                      </dd>
                    </div>
                  ) : (
                    <div>
                      <dt>MCP</dt>
                      <dd data-testid="manifest-mcp-servers">none</dd>
                    </div>
                  )}
                  {selected.policyId ? (
                    <div>
                      <dt>策略</dt>
                      <dd data-testid="manifest-policy-id">{selected.policyId.slice(0, 14)}</dd>
                    </div>
                  ) : (
                    <div>
                      <dt>策略</dt>
                      <dd data-testid="manifest-policy-id">default</dd>
                    </div>
                  )}
                                    {crossTaskRefs.length > 0 ? (
                    <div>
                      <dt>cross-task</dt>
                      <dd data-testid="manifest-cross-task-kv">{crossTaskRefs.length} 条</dd>
                    </div>
                  ) : null}
                  {evidenceRefs.length > 0 ? (
                    <div>
                      <dt>记忆证据</dt>
                      <dd data-testid="manifest-memory-evidence-kv">{evidenceRefs.length} 条</dd>
                    </div>
                  ) : null}
                  {selected.runId ? (
                    <div>
                      <dt>run</dt>
                      <dd>{selected.runId.slice(0, 10)}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="st-manifest__section">
                <button
                  type="button"
                  className="st-manifest__section-toggle"
                  data-testid="manifest-included-toggle"
                  aria-expanded={includedOpen}
                  onClick={() => setIncludedOpen((v) => !v)}
                >
                  <span className="st-manifest__section-left">
                    {includedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Layers size={12} aria-hidden="true" />
                    <span>已纳入</span>
                  </span>
                  <span className="st-manifest__count" data-testid="manifest-included-count">
                    {included.length || selected.includedSourceIds?.length || 0}
                  </span>
                </button>
                {includedOpen ? (
                  <ul className="st-manifest__list" data-testid="manifest-included-list">
                    {(included.length
                      ? included
                      : (selected.includedSourceIds ?? []).map((id) => ({
                          id,
                          kind: 'unknown' as const,
                          tokenEstimate: undefined as number | undefined,
                        }))
                    ).map((src) => (
                      <li key={src.id} data-testid={`manifest-included-${src.id}`}>
                        <div className="st-manifest__row-head">
                          <span className="st-manifest__key">{src.id}</span>
                          <span className="st-manifest__chip">{kindLabel(src.kind)}</span>
                          {typeof src.tokenEstimate === 'number' ? (
                            <span className="st-manifest__conf">~{src.tokenEstimate}</span>
                          ) : null}
                          {!isProtectedManifestKind(String(src.kind)) && props.onExcludeSource ? (
                            <button
                              type="button"
                              className="st-manifest__exclude-btn"
                              data-testid={`manifest-exclude-${src.id}`}
                              aria-label={`排除 ${src.id}`}
                              disabled={Boolean(props.amendBusy)}
                              onClick={() => props.onExcludeSource?.(src.id)}
                            >
                              <Ban size={11} strokeWidth={2} aria-hidden="true" />
                              <span>排除</span>
                            </button>
                          ) : isProtectedManifestKind(String(src.kind)) ? (
                            <span
                              className="st-manifest__chip st-manifest__chip--protected"
                              data-testid={`manifest-protected-${src.id}`}
                            >
                              受保护
                            </span>
                          ) : null}
                        </div>
                      </li>
                    ))}
                    {included.length === 0 &&
                    (!selected.includedSourceIds || selected.includedSourceIds.length === 0) ? (
                      <li className="st-manifest__hint">无纳入来源记录</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>

              <div className="st-manifest__section">
                <button
                  type="button"
                  className="st-manifest__section-toggle"
                  data-testid="manifest-excluded-toggle"
                  aria-expanded={excludedOpen}
                  onClick={() => setExcludedOpen((v) => !v)}
                >
                  <span className="st-manifest__section-left">
                    {excludedOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>已排除</span>
                  </span>
                  <span className="st-manifest__count" data-testid="manifest-excluded-count">
                    {excluded.length || selected.excludedSourceIds?.length || 0}
                  </span>
                </button>
                {excludedOpen ? (
                  <ul className="st-manifest__list" data-testid="manifest-excluded-list">
                    {(excluded.length
                      ? excluded
                      : (selected.excludedSourceIds ?? []).map((id) => ({
                          id,
                          kind: 'unknown' as const,
                          tokenEstimate: undefined as number | undefined,
                        }))
                    ).map((src) => (
                      <li key={src.id} data-testid={`manifest-excluded-${src.id}`}>
                        <div className="st-manifest__row-head">
                          <span className="st-manifest__key">{src.id}</span>
                          <span className="st-manifest__chip">{kindLabel(src.kind)}</span>
                        </div>
                      </li>
                    ))}
                    {excluded.length === 0 &&
                    (!selected.excludedSourceIds || selected.excludedSourceIds.length === 0) ? (
                      <li className="st-manifest__hint">本次无排除来源</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>


              {crossTaskRefs.length > 0 ? (
                <div className="st-manifest__section" data-testid="manifest-cross-task-section">
                  <button
                    type="button"
                    className="st-manifest__section-toggle"
                    data-testid="manifest-cross-task-toggle"
                    aria-expanded={crossOpen}
                    onClick={() => setCrossOpen((v) => !v)}
                  >
                    <span className="st-manifest__section-left">
                      {crossOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>跨任务引用</span>
                    </span>
                    <span className="st-manifest__count" data-testid="manifest-cross-task-count">
                      {crossTaskRefs.length}
                    </span>
                  </button>
                  {crossOpen ? (
                    <ul className="st-manifest__list" data-testid="manifest-cross-task-list">
                      {crossTaskRefs.map((refId: string) => {
                        const summary = summaries.find(
                          (item) =>
                            item.sourceId === `cross-task:${refId}` ||
                            item.sourceId.includes(refId),
                        );
                        return (
                          <li key={refId} data-testid={`manifest-cross-task-${refId}`}>
                            <div className="st-manifest__row-head">
                              <span className="st-manifest__key">{refId}</span>
                              <span className="st-manifest__chip st-manifest__chip--link">
                                显式父任务
                              </span>
                            </div>
                            {summary ? (
                              <p className="st-manifest__value">{clip(summary.summary, 140)}</p>
                            ) : (
                              <p className="st-manifest__value">parentTaskId · 仅显式引用纳入</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {evidenceRefs.length > 0 ? (
                <div className="st-manifest__section" data-testid="manifest-memory-evidence-section">
                  <button
                    type="button"
                    className="st-manifest__section-toggle"
                    onClick={() => setEvidenceOpen((v) => !v)}
                    aria-expanded={evidenceOpen}
                    data-testid="manifest-memory-evidence-toggle"
                  >
                    <span className="st-manifest__section-left">
                      {evidenceOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>记忆证据</span>
                    </span>
                    <span className="st-manifest__count" data-testid="manifest-memory-evidence-count">
                      {evidenceRefs.length}
                    </span>
                  </button>
                  {evidenceOpen ? (
                    <ul className="st-manifest__list" data-testid="manifest-memory-evidence-list">
                      {evidenceRefs.map((refId: string) => {
                        const summary = summaries.find((item) => item.sourceId === refId)?.summary;
                        return (
                          <li
                            key={refId}
                            className="st-manifest__item"
                            data-testid={`manifest-memory-evidence-${refId}`}
                          >
                            <span className="st-manifest__chip st-manifest__chip--link">
                              {clip(refId, 40)}
                            </span>
                            {summary ? (
                              <span className="st-manifest__item-summary">{clip(summary, 80)}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {summaries.length > 0 || truncations.length > 0 ? (
                <div className="st-manifest__section">
                  <button
                    type="button"
                    className="st-manifest__section-toggle"
                    data-testid="manifest-summary-toggle"
                    aria-expanded={summaryOpen}
                    onClick={() => setSummaryOpen((v) => !v)}
                  >
                    <span className="st-manifest__section-left">
                      {summaryOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>摘要 / 截断</span>
                    </span>
                    <span className="st-manifest__count">
                      {summaries.length + truncations.length}
                    </span>
                  </button>
                  {summaryOpen ? (
                    <ul className="st-manifest__list" data-testid="manifest-summary-list">
                      {summaries.map((s) => (
                        <li key={`${s.sourceId}-sum`}>
                          <div className="st-manifest__row-head">
                            <span className="st-manifest__key">{s.sourceId}</span>
                            <span className="st-manifest__chip">摘要</span>
                          </div>
                          <p className="st-manifest__value">{clip(s.summary, 120)}</p>
                        </li>
                      ))}
                      {truncations.map((t) => (
                        <li key={`${t.sourceId}-trunc`}>
                          <div className="st-manifest__row-head">
                            <span className="st-manifest__key">{t.sourceId}</span>
                            <span className="st-manifest__chip st-manifest__chip--warn">
                              截断 · {t.reason}
                            </span>
                          </div>
                          <p className="st-manifest__value">
                            {typeof t.beforeTokens === 'number' || typeof t.afterTokens === 'number'
                              ? `${t.beforeTokens ?? '—'} → ${t.afterTokens ?? '—'} tok`
                              : t.reason}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
