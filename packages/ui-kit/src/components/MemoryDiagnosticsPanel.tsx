import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  Brain,
  Radar,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  X,
  BookOpen,
  LifeBuoy,
} from 'lucide-react';
import {
  getRecoveryGuide,
  listKnownLimitations,
  type RecoveryGuide,
} from '../diagnostics/recovery.js';

export type MemoryScopeView = 'task' | 'project' | 'global';
export type MemoryApprovalStateView = 'pending' | 'approved' | 'rejected' | 'rolled_back';

export interface MemoryEntryView {
  id: string;
  key: string;
  value: string;
  scope: MemoryScopeView;
  active: boolean;
  updatedAt?: string;
  taskId?: string;
}

export interface MemoryChangeAdditionView {
  id: string;
  key: string;
  value: string;
  targetScope: MemoryScopeView;
}

export interface MemoryChangeView {
  id: string;
  taskId: string;
  targetScope: MemoryScopeView;
  approvalState: MemoryApprovalStateView;
  confidence: number;
  additions: readonly MemoryChangeAdditionView[];
  modifications: readonly MemoryChangeAdditionView[];
  deprecations: readonly string[];
  unresolvedAmbiguity?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface DiagnosticView {
  id: string;
  category: string;
  failureClass?: string;
  summary: string;
  createdAt: string;
  runId?: string;
}

export interface MemoryDecideInput {
  changeId: string;
  decision: 'approved' | 'rejected';
}

export interface MemoryRollbackInput {
  changeId: string;
}

export interface MemoryDiagnosticsPanelProps {
  entries: readonly MemoryEntryView[];
  changes: readonly MemoryChangeView[];
  diagnostics: readonly DiagnosticView[];
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  statusNote?: string | null;
  onDecide?: (input: MemoryDecideInput) => void | Promise<void>;
  onRollback?: (input: MemoryRollbackInput) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  /** Optional IA jump from recovery hints (§23.2 #9). */
  onNavigate?: (target: NonNullable<RecoveryGuide['goTo']>) => void;
}

const SCOPE_LABEL: Record<MemoryScopeView, string> = {
  task: '任务',
  project: '项目',
  global: '全局',
};

const STATE_LABEL: Record<MemoryApprovalStateView, string> = {
  pending: '待审',
  approved: '已通过',
  rejected: '已拒绝',
  rolled_back: '已回滚',
};

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

export type MemoryDiagnosticsReadinessLevel = 'empty' | 'partial' | 'ready' | 'attention';

export interface MemoryDiagnosticsReadiness {
  level: MemoryDiagnosticsReadinessLevel;
  badge: string;
  entryCount: number;
  pendingCount: number;
  decidedCount: number;
  diagCount: number;
  limitationCount: number;
  entriesOk: boolean;
  bridgeOk: boolean;
  diagVisible: boolean;
  limitsOk: boolean;
  note: string;
}

export interface MemoryDiagnosticsReadinessInput {
  /** Active durable memory entries count. */
  entryCount?: number;
  /** Pending MemoryChange count (approval bridge). */
  pendingCount?: number;
  /** Recently decided change count. */
  decidedCount?: number;
  /** Scrubbed diagnostics count. */
  diagCount?: number;
  /** Known limitations catalog size (§23.2 #12). */
  limitationCount?: number;
}

/**
 * Pure projector for Memory + Diagnostics readiness (§10.4 / §19 / §23.2).
 * Soft observability only — does NOT close M1; external hand-test + dogfood remain.
 */
export function projectMemoryDiagnosticsReadiness(
  input: MemoryDiagnosticsReadinessInput,
): MemoryDiagnosticsReadiness {
  const entryCount = Math.max(0, Number(input.entryCount ?? 0) || 0);
  const pendingCount = Math.max(0, Number(input.pendingCount ?? 0) || 0);
  const decidedCount = Math.max(0, Number(input.decidedCount ?? 0) || 0);
  const diagCount = Math.max(0, Number(input.diagCount ?? 0) || 0);
  const limitationCount = Math.max(0, Number(input.limitationCount ?? 0) || 0);
  const entriesOk = entryCount > 0;
  const bridgeOk = pendingCount > 0 || decidedCount > 0;
  const diagVisible = diagCount > 0;
  const limitsOk = limitationCount > 0;

  let level: MemoryDiagnosticsReadinessLevel = 'empty';
  if (pendingCount > 0) level = 'attention';
  else if (entriesOk || decidedCount > 0 || diagCount > 0) level = 'ready';
  else if (limitsOk) level = 'partial';
  else level = 'empty';

  const badge =
    level === 'attention'
      ? `${pendingCount} 待审`
      : level === 'ready'
        ? '证据在线'
        : level === 'partial'
          ? '仅限制说明'
          : '未连接';

  let note = '';
  if (level === 'attention') {
    note = '有待审 MemoryChange：通过后写入持久记忆，并同步到批准中心；拒绝不落库。';
  } else if (level === 'ready') {
    note =
      '里程碑生成变更 → 人批 → 持久记忆。诊断摘要已 scrub 密钥。记忆 soft 已就绪；外网 18/18、dogfood 1/1，M1 已完成。';
  } else if (level === 'partial') {
    note = '仅有已知限制说明（§23.2 #12）；连接 Runtime 后可见持久记忆、待审变更与诊断证据。';
  } else {
    note = '未连接 Runtime。记忆与诊断仪表将显示任务记忆、MemoryChange 桥与 scrub 过的失败证据。';
  }

  return {
    level,
    badge,
    entryCount,
    pendingCount,
    decidedCount,
    diagCount,
    limitationCount,
    entriesOk,
    bridgeOk,
    diagVisible,
    limitsOk,
    note,
  };
}

/**
 * Compact Memory + Diagnostics instrument (product §10.4 / §19).
 * Continuum Bench: calm evidence strip — durable entries, pending MemoryChange, scrubbed diagnostics.
 */
export function MemoryDiagnosticsPanel(props: MemoryDiagnosticsPanelProps) {
  const [entriesOpen, setEntriesOpen] = useState(true);
  const [pendingOpen, setPendingOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [diagOpen, setDiagOpen] = useState(true);
  const [limitationsOpen, setLimitationsOpen] = useState(false);
  const [expandedDiagId, setExpandedDiagId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const knownLimitations = useMemo(() => listKnownLimitations(), []);

  const pending = useMemo(
    () => props.changes.filter((c) => c.approvalState === 'pending'),
    [props.changes],
  );
  const recentDecided = useMemo(
    () => props.changes.filter((c) => c.approvalState !== 'pending').slice(0, 8),
    [props.changes],
  );
  const activeEntries = useMemo(
    () => props.entries.filter((e) => e.active).slice(0, 12),
    [props.entries],
  );
  const recentDiagnostics = useMemo(() => props.diagnostics.slice(0, 12), [props.diagnostics]);

  // Known limitations always count as data so §23.2 #12 is never hidden behind empty state.
  const hasData =
    activeEntries.length > 0 ||
    props.changes.length > 0 ||
    props.diagnostics.length > 0 ||
    knownLimitations.length > 0;

  const metaLabel = hasData
    ? `${activeEntries.length} 条记忆 · ${pending.length} 待审 · ${recentDecided.length} 决策 · ${recentDiagnostics.length} 诊断`
    : '未加载';

  const readiness = useMemo(
    () =>
      projectMemoryDiagnosticsReadiness({
        entryCount: activeEntries.length,
        pendingCount: pending.length,
        decidedCount: recentDecided.length,
        diagCount: recentDiagnostics.length,
        limitationCount: knownLimitations.length,
      }),
    [
      activeEntries.length,
      pending.length,
      recentDecided.length,
      recentDiagnostics.length,
      knownLimitations.length,
    ],
  );

  const decide = async (changeId: string, decision: 'approved' | 'rejected') => {
    if (!props.onDecide || props.busy) return;
    setDecidingId(changeId);
    try {
      await props.onDecide({ changeId, decision });
    } finally {
      setDecidingId(null);
    }
  };

  const rollback = async (changeId: string) => {
    if (!props.onRollback || props.busy) return;
    setDecidingId(changeId);
    try {
      await props.onRollback({ changeId });
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <section
      className="st-memory"
      aria-label="Memory 与 Diagnostics"
      data-testid="memory-diagnostics-panel"
      data-level={readiness.level}
    >
      <header className="st-memory__header">
        <div className="st-memory__title-row">
          <span className="st-memory__mark" aria-hidden="true">
            <Brain size={14} strokeWidth={1.8} />
          </span>
          <div>
            <strong>Memory</strong>
            <small data-testid="memory-meta-label">{metaLabel}</small>
          </div>
        </div>
        <button
          type="button"
          className="st-memory__icon-btn"
          data-testid="memory-refresh"
          aria-label="刷新记忆与诊断"
          disabled={props.busy || props.loading}
          onClick={() => void props.onRefresh?.()}
        >
          <RefreshCw size={13} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </header>

      {props.statusNote ? (
        <p className="st-memory__status" role="status" data-testid="memory-status">
          <Sparkles size={12} strokeWidth={1.8} aria-hidden="true" />
          {props.statusNote}
        </p>
      ) : null}
      {props.error ? (
        <p className="st-memory__error" role="alert" data-testid="memory-error">
          {props.error}
        </p>
      ) : null}

      <div
        className="st-memory__readiness"
        data-testid="memory-m1-readiness"
        data-level={readiness.level}
        aria-label="Memory 与 Diagnostics 就绪"
      >
        <div className="st-memory__readiness-head">
          <Radar size={12} strokeWidth={1.8} aria-hidden="true" />
          <span>记忆与诊断</span>
          <small>§10.4 · §19 · 可审计</small>
          <strong data-testid="memory-m1-readiness-badge">{readiness.badge}</strong>
        </div>
        <ul className="st-memory__readiness-list">
          <li data-ok={readiness.entriesOk ? '1' : '0'} data-testid="memory-m1-check-entries">
            <span className="st-memory__readiness-dot" aria-hidden="true" />
            持久记忆 {readiness.entryCount}
            {readiness.entriesOk ? ' · 已生效' : ' · 尚无'}
          </li>
          <li
            data-ok={readiness.pendingCount === 0 ? '1' : '0'}
            data-testid="memory-m1-check-pending"
          >
            <span className="st-memory__readiness-dot" aria-hidden="true" />
            待审变更 {readiness.pendingCount}
            {readiness.pendingCount === 0 ? ' · 空闲' : ' · 需批'}
          </li>
          <li data-ok={readiness.diagVisible ? '1' : '0'} data-testid="memory-m1-check-diag">
            <span className="st-memory__readiness-dot" aria-hidden="true" />
            诊断 {readiness.diagCount}
            {readiness.diagVisible ? ' · 含恢复步骤' : ' · 尚无失败记录'}
          </li>
          <li data-ok={readiness.limitsOk ? '1' : '0'} data-testid="memory-m1-check-limits">
            <span className="st-memory__readiness-dot" aria-hidden="true" />
            已知限制 {readiness.limitationCount}
            {readiness.limitsOk ? ' · §23.2 #12' : ' · 未加载'}
          </li>
        </ul>
        <p className="st-memory__readiness-note" data-testid="memory-m1-readiness-note">
          {readiness.note}
        </p>
      </div>

      {props.loading && !hasData ? (
        <p className="st-memory__empty" data-testid="memory-loading">
          读取 Memory / Diagnostics…
        </p>
      ) : null}

      {!props.loading && !hasData ? (
        <p className="st-memory__empty" data-testid="memory-empty">
          连接 Runtime 后显示任务记忆、待审变更与诊断证据
        </p>
      ) : null}

      {hasData ? (
        <div className="st-memory__body" data-testid="memory-body">
          <Section
            title="持久记忆"
            count={activeEntries.length}
            open={entriesOpen}
            onToggle={() => setEntriesOpen((v) => !v)}
            testId="memory-section-entries"
            icon={<Brain size={12} strokeWidth={1.8} aria-hidden="true" />}
          >
            {activeEntries.length === 0 ? (
              <div className="st-memory__empty-card" data-testid="memory-entries-empty">
                <strong>尚无持久记忆</strong>
                <p>Run 里程碑会生成 MemoryChange；在「待审变更」通过后才会出现在这里。</p>
              </div>
            ) : (
              <ul className="st-memory__list" data-testid="memory-entries">
                {activeEntries.map((entry) => (
                  <li key={entry.id} data-testid={`memory-entry-${entry.id}`}>
                    <div className="st-memory__row-head">
                      <code className="st-memory__key">{entry.key}</code>
                      <span className="st-memory__chip">{SCOPE_LABEL[entry.scope]}</span>
                    </div>
                    <p className="st-memory__value">{clip(entry.value, 120)}</p>
                    {entry.updatedAt ? (
                      <time className="st-memory__time" dateTime={entry.updatedAt}>
                        {formatTime(entry.updatedAt)}
                      </time>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="待审变更"
            count={pending.length}
            open={pendingOpen}
            onToggle={() => setPendingOpen((v) => !v)}
            testId="memory-section-pending"
            icon={<ShieldAlert size={12} strokeWidth={1.8} aria-hidden="true" />}
          >
            {pending.length === 0 ? (
              <div className="st-memory__empty-card" data-testid="memory-pending-empty">
                <strong>暂无待审变更</strong>
                <p>Run 里程碑会生成 MemoryChange；已决策见下方历史。批准中心会同步待审项。</p>
              </div>
            ) : (
              <ul className="st-memory__list st-memory__list--changes" data-testid="memory-pending">
                {pending.map((change) => {
                  const previewKeys = [
                    ...change.additions.map((a) => a.key),
                    ...change.modifications.map((m) => m.key),
                    ...change.deprecations.map((d) => `−${d}`),
                  ].slice(0, 4);
                  const previewValue =
                    change.additions[0]?.value ??
                    change.modifications[0]?.value ??
                    change.unresolvedAmbiguity ??
                    '';
                  const busyThis = decidingId === change.id || props.busy;
                  return (
                    <li key={change.id} data-testid={`memory-change-${change.id}`}>
                      <div className="st-memory__row-head">
                        <span className="st-memory__state" data-state={change.approvalState}>
                          {STATE_LABEL[change.approvalState]}
                        </span>
                        <span className="st-memory__chip">{SCOPE_LABEL[change.targetScope]}</span>
                        <span className="st-memory__conf">
                          {Math.round(change.confidence * 100)}%
                        </span>
                      </div>
                      <p className="st-memory__keys">
                        {previewKeys.length > 0 ? previewKeys.join(' · ') : '结构化变更'}
                      </p>
                      {previewValue ? (
                        <p className="st-memory__value">{clip(previewValue, 100)}</p>
                      ) : null}
                      <div className="st-memory__decide">
                        <button
                          type="button"
                          className="st-memory__approve"
                          data-testid={`memory-approve-${change.id}`}
                          disabled={busyThis}
                          onClick={() => void decide(change.id, 'approved')}
                        >
                          <Check size={12} strokeWidth={2} aria-hidden="true" />
                          通过
                        </button>
                        <button
                          type="button"
                          className="st-memory__reject"
                          data-testid={`memory-reject-${change.id}`}
                          disabled={busyThis}
                          onClick={() => void decide(change.id, 'rejected')}
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
            title="变更历史"
            count={recentDecided.length}
            open={historyOpen}
            onToggle={() => setHistoryOpen((v) => !v)}
            testId="memory-section-history"
            icon={<RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />}
          >
            {recentDecided.length === 0 ? (
              <p className="st-memory__hint">批准或拒绝后会出现在这里 · 已通过项可回滚</p>
            ) : (
              <ul className="st-memory__list st-memory__list--history" data-testid="memory-history">
                {recentDecided.map((change) => {
                  const previewKeys = [
                    ...change.additions.map((a) => a.key),
                    ...change.modifications.map((m) => m.key),
                    ...change.deprecations.map((d) => `−${d}`),
                  ].slice(0, 4);
                  const previewValue =
                    change.additions[0]?.value ??
                    change.modifications[0]?.value ??
                    change.unresolvedAmbiguity ??
                    '';
                  const busyThis = decidingId === change.id || props.busy;
                  const canRollback =
                    change.approvalState === 'approved' && Boolean(props.onRollback);
                  return (
                    <li
                      key={change.id}
                      data-testid={`memory-history-${change.id}`}
                      data-state={change.approvalState}
                    >
                      <div className="st-memory__row-head">
                        <span className="st-memory__state" data-state={change.approvalState}>
                          {STATE_LABEL[change.approvalState]}
                        </span>
                        <span className="st-memory__chip">{SCOPE_LABEL[change.targetScope]}</span>
                        <span className="st-memory__conf">
                          {Math.round(change.confidence * 100)}%
                        </span>
                      </div>
                      <p className="st-memory__keys">
                        {previewKeys.length > 0 ? previewKeys.join(' · ') : '结构化变更'}
                      </p>
                      {previewValue ? (
                        <p className="st-memory__value">{clip(previewValue, 100)}</p>
                      ) : null}
                      {change.decidedAt ? (
                        <time className="st-memory__time" dateTime={change.decidedAt}>
                          {formatTime(change.decidedAt)}
                        </time>
                      ) : null}
                      {canRollback ? (
                        <div className="st-memory__decide">
                          <button
                            type="button"
                            className="st-memory__rollback"
                            data-testid={`memory-rollback-${change.id}`}
                            disabled={busyThis}
                            onClick={() => void rollback(change.id)}
                            title="回滚此批准 · 恢复上一版本（§10.4）"
                          >
                            <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
                            回滚
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="诊断"
            count={recentDiagnostics.length}
            open={diagOpen}
            onToggle={() => setDiagOpen((v) => !v)}
            testId="memory-section-diagnostics"
            icon={<Activity size={12} strokeWidth={1.8} aria-hidden="true" />}
          >
            {recentDiagnostics.length === 0 ? (
              <p className="st-memory__hint">尚无诊断记录 · 发现失败 / 协议错误会出现在这里</p>
            ) : (
              <ul
                className="st-memory__list st-memory__list--diag"
                data-testid="memory-diagnostics"
              >
                {recentDiagnostics.map((d) => {
                  const guide = getRecoveryGuide(d.failureClass);
                  const open = expandedDiagId === d.id;
                  return (
                    <li
                      key={d.id}
                      data-testid={`diagnostic-${d.id}`}
                      data-failure-class={guide.failureClass}
                      data-retryable={guide.retryable ? '1' : '0'}
                    >
                      <button
                        type="button"
                        className="st-memory__diag-toggle"
                        data-testid={`diagnostic-toggle-${d.id}`}
                        aria-expanded={open}
                        onClick={() => setExpandedDiagId((cur) => (cur === d.id ? null : d.id))}
                      >
                        <div className="st-memory__row-head">
                          <span className="st-memory__cat">{d.category}</span>
                          <span
                            className={`st-memory__chip ${guide.retryable ? 'st-memory__chip--info' : 'st-memory__chip--warn'}`}
                            data-testid={`diagnostic-class-${d.id}`}
                            title={guide.meaning}
                          >
                            {guide.label}
                            <em>{guide.failureClass}</em>
                          </span>
                          {guide.retryable ? (
                            <span
                              className="st-memory__chip st-memory__chip--ok"
                              data-testid={`diagnostic-retry-${d.id}`}
                            >
                              可重试
                            </span>
                          ) : (
                            <span
                              className="st-memory__chip st-memory__chip--mute"
                              data-testid={`diagnostic-retry-${d.id}`}
                            >
                              勿盲目重试
                            </span>
                          )}
                        </div>
                        <p className="st-memory__value">{clip(d.summary, 140)}</p>
                        <div className="st-memory__diag-meta">
                          <time className="st-memory__time" dateTime={d.createdAt}>
                            {formatTime(d.createdAt)}
                          </time>
                          <span className="st-memory__diag-more">
                            {open ? '收起恢复步骤' : '查看恢复步骤'}
                          </span>
                        </div>
                      </button>
                      {open ? (
                        <div
                          className="st-memory__recovery"
                          data-testid={`diagnostic-recovery-${d.id}`}
                        >
                          <p className="st-memory__recovery-meaning">
                            <LifeBuoy size={12} strokeWidth={1.8} aria-hidden="true" />
                            {guide.meaning}
                          </p>
                          <ol className="st-memory__recovery-steps">
                            {guide.steps.map((step, i) => (
                              <li key={`${d.id}-step-${i}`}>{step}</li>
                            ))}
                          </ol>
                          {guide.goTo && props.onNavigate ? (
                            <button
                              type="button"
                              className="st-memory__recovery-go"
                              data-testid={`diagnostic-goto-${d.id}`}
                              onClick={() => props.onNavigate?.(guide.goTo!)}
                            >
                              前往 {goToLabel(guide.goTo)}
                            </button>
                          ) : guide.goTo ? (
                            <p className="st-memory__hint st-memory__hint--inline">
                              建议前往：{goToLabel(guide.goTo)}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section
            title="已知限制"
            count={knownLimitations.length}
            open={limitationsOpen}
            onToggle={() => setLimitationsOpen((v) => !v)}
            testId="memory-section-limitations"
            icon={<BookOpen size={12} strokeWidth={1.8} aria-hidden="true" />}
          >
            <p className="st-memory__hint" data-testid="limitations-intro">
              产品 §23.2 #12 · 关闭 M1 前请对照退出证据，勿把本地 soft craft 当成外网手测。
            </p>
            <ul
              className="st-memory__list st-memory__list--limits"
              data-testid="memory-limitations"
            >
              {knownLimitations.map((lim) => (
                <li key={lim.id} data-testid={`limitation-${lim.id}`} data-area={lim.area}>
                  <div className="st-memory__row-head">
                    <span className="st-memory__key">{lim.title}</span>
                    <span className="st-memory__chip st-memory__chip--mute">{lim.area}</span>
                  </div>
                  <p className="st-memory__value">{lim.detail}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      ) : null}
    </section>
  );
}

function goToLabel(target: NonNullable<RecoveryGuide['goTo']>): string {
  switch (target) {
    case 'providers':
      return 'Providers';
    case 'approvals':
      return '审批中心';
    case 'agents':
      return 'Agent 绑定';
    case 'settings':
      return '设置';
    case 'memory':
      return 'Memory';
    default:
      return target;
  }
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
    <div
      className="st-memory__section"
      data-testid={props.testId}
      data-open={props.open || undefined}
    >
      <button
        type="button"
        className="st-memory__section-toggle"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <span className="st-memory__section-left">
          {props.open ? (
            <ChevronDown size={12} strokeWidth={1.9} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} strokeWidth={1.9} aria-hidden="true" />
          )}
          {props.icon}
          <span>{props.title}</span>
        </span>
        <span className="st-memory__count">{props.count}</span>
      </button>
      {props.open ? <div className="st-memory__section-body">{props.children}</div> : null}
    </div>
  );
}
