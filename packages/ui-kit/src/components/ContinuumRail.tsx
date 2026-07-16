import { useMemo, type ReactNode } from 'react';
import { Link2 } from 'lucide-react';

// Continuum Rail — the signature element (§15.3 / §0.1). The Context Continuum
// surfaces as a horizontal evidence time-band summing what's been written so far
// to durable task context. Every entry lights up when written into Continuum.
// Soft observability strip summarizes kinds present + bound/empty state.

export type ContinuumKind = 'decision' | 'memory' | 'artifact' | 'review' | 'context-transfer';

export interface ContinuumRailEntry {
  id: string;
  /** Short kind label — drives filter chips / accent. */
  kind: ContinuumKind;
  /** Plain product label for structural entries that are not durable evidence yet. */
  categoryLabel?: string;
  label: string;
}

export type ContinuumReadinessLevel = 'empty' | 'scaffold' | 'bound' | 'live' | 'streaming';

export interface ContinuumReadiness {
  level: ContinuumReadinessLevel;
  badge: string;
  total: number;
  kindCount: number;
  decisionCount: number;
  memoryCount: number;
  artifactCount: number;
  reviewCount: number;
  transferCount: number;
  lastLabel: string | null;
  lastKind: ContinuumKind | null;
  hasEntries: boolean;
  hasDecision: boolean;
  hasMemory: boolean;
  hasTransfer: boolean;
  hasArtifact: boolean;
  hasReview: boolean;
  note: string;
}

export interface ContinuumRailProps {
  entries: ContinuumRailEntry[];
  /** Active entry highlight – e.g. the entry the user just selected in the inspector. */
  activeId?: string;
  onSelect?: (entryId: string) => void;
  /** Optional children rendered at the trailing edge for inline actions. */
  children?: ReactNode;
  /** Empty-rail hint when no continuum evidence yet. */
  emptyState?: ReactNode;
  /** Soft observability: task open / folder bound. */
  hasActiveTask?: boolean;
  /** Soft observability: stream in progress. */
  streaming?: boolean;
  /**
   * When true, current entries are IA scaffolding (folder/task/thread)
   * rather than durable Continuum evidence writes. Affects badge only.
   */
  scaffoldOnly?: boolean;
  /** Hide the readiness strip (tests / dense embeds). */
  hideReadiness?: boolean;
}

const CONTINUUM_KIND_LABEL: Record<ContinuumKind, string> = {
  decision: '决策',
  memory: '记忆',
  artifact: '产物',
  review: '评审',
  'context-transfer': '上下文',
};

function kindLabel(kind: ContinuumKind): string {
  return CONTINUUM_KIND_LABEL[kind] ?? kind;
}

/** Pure projector for tests + UI — §15.3 / §0.1 continuum observability. */
export function projectContinuumReadiness(
  entries: ContinuumRailEntry[],
  options?: { hasActiveTask?: boolean; streaming?: boolean; scaffoldOnly?: boolean },
): ContinuumReadiness {
  const total = entries.length;
  const counts: Partial<Record<ContinuumKind, number>> = {};
  for (const e of entries) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  }
  const decisionCount = counts.decision ?? 0;
  const memoryCount = counts.memory ?? 0;
  const artifactCount = counts.artifact ?? 0;
  const reviewCount = counts.review ?? 0;
  const transferCount = counts['context-transfer'] ?? 0;
  const kindCount = Object.keys(counts).length;
  const last = total > 0 ? entries[total - 1] : null;
  const streaming = Boolean(options?.streaming);
  const hasActiveTask = options?.hasActiveTask;
  const scaffoldOnly = Boolean(options?.scaffoldOnly);
  const hasEntries = total > 0;
  const hasDecision = decisionCount > 0;
  const hasMemory = memoryCount > 0;
  const hasTransfer = transferCount > 0;
  const hasArtifact = artifactCount > 0;
  const hasReview = reviewCount > 0;
  const durableEvidence =
    hasArtifact ||
    hasReview ||
    (hasEntries && !scaffoldOnly && (hasDecision || hasMemory || hasTransfer));

  let level: ContinuumReadinessLevel = 'empty';
  if (streaming) level = 'streaming';
  else if (durableEvidence && !scaffoldOnly) level = 'live';
  else if (hasActiveTask && hasEntries) level = scaffoldOnly ? 'scaffold' : 'bound';
  else if (hasEntries) level = scaffoldOnly ? 'scaffold' : 'bound';
  else level = 'empty';

  const badge =
    level === 'streaming'
      ? '流式中'
      : level === 'live'
        ? '有证据'
        : level === 'bound'
          ? '已绑定'
          : level === 'scaffold'
            ? '结构位'
            : hasActiveTask === false
              ? '等待任务'
              : '静默';

  const notes: string[] = [];
  if (streaming) notes.push('流式进行中 · 决策/记忆写入后会出现在连续体');
  else if (!hasEntries) {
    if (hasActiveTask === false)
      notes.push('创建项目并打开任务后，可按需绑定本地文件夹');
    else notes.push('发送消息或写入记忆后，连续体将点亮决策/记忆/产物');
  } else if (scaffoldOnly)
    notes.push('当前为任务结构位（文件夹/任务/线程）· 对话与记忆写入后会出现持久证据');
  else if (level === 'live') notes.push('连续体已有持久证据 · 点击条目可对齐检查');
  else notes.push('连续体已绑定任务上下文 · 跨线程无需重述');

  return {
    level,
    badge,
    total,
    kindCount,
    decisionCount,
    memoryCount,
    artifactCount,
    reviewCount,
    transferCount,
    lastLabel: last?.label ?? null,
    lastKind: last?.kind ?? null,
    hasEntries,
    hasDecision,
    hasMemory,
    hasTransfer,
    hasArtifact,
    hasReview,
    note: notes.join(' · '),
  };
}

export function ContinuumRail(props: ContinuumRailProps) {
  const empty = props.entries.length === 0;
  const readiness = useMemo(
    () =>
      projectContinuumReadiness(props.entries, {
        hasActiveTask: props.hasActiveTask,
        streaming: props.streaming,
        scaffoldOnly: props.scaffoldOnly,
      }),
    [props.entries, props.hasActiveTask, props.streaming, props.scaffoldOnly],
  );

  return (
    <div
      className="st-continuum-wrap"
      data-testid="continuum-wrap"
      data-level={readiness.level}
      data-count={String(readiness.total)}
    >
      {props.hideReadiness ? null : (
        <div
          className="st-continuum__readiness"
          data-testid="continuum-readiness"
          data-level={readiness.level}
          aria-label="上下文连续体就绪"
        >
          <div className="st-continuum__readiness-head">
            <Link2 size={12} strokeWidth={1.8} aria-hidden="true" />
            <span>上下文连续体</span>
            <small>§15.3 · 签名条</small>
            <strong data-testid="continuum-readiness-badge">{readiness.badge}</strong>
          </div>
          <ul className="st-continuum__readiness-list">
            <li data-ok={readiness.hasEntries ? '1' : '0'} data-testid="continuum-check-entries">
              <span className="st-continuum__readiness-dot" aria-hidden="true" />
              条目 {readiness.total}
              {readiness.hasEntries ? ` · ${readiness.kindCount} 类` : ' · 尚无'}
            </li>
            <li data-ok={readiness.hasDecision ? '1' : '0'} data-testid="continuum-check-decision">
              <span className="st-continuum__readiness-dot" aria-hidden="true" />
              决策 {readiness.decisionCount}
              {readiness.hasDecision ? ' · 有' : ' · 无'}
            </li>
            <li data-ok={readiness.hasMemory ? '1' : '0'} data-testid="continuum-check-memory">
              <span className="st-continuum__readiness-dot" aria-hidden="true" />
              记忆 {readiness.memoryCount}
              {readiness.hasMemory ? ' · 有' : ' · 无'}
            </li>
            <li data-ok={readiness.hasTransfer ? '1' : '0'} data-testid="continuum-check-transfer">
              <span className="st-continuum__readiness-dot" aria-hidden="true" />
              上下文 {readiness.transferCount}
              {readiness.hasTransfer ? ' · 有' : ' · 无'}
            </li>
            <li
              data-ok={readiness.hasArtifact || readiness.hasReview ? '1' : '0'}
              data-testid="continuum-check-durable"
            >
              <span className="st-continuum__readiness-dot" aria-hidden="true" />
              产物/评审 {readiness.artifactCount + readiness.reviewCount}
            </li>
            <li
              data-ok={
                props.streaming ? '1' : props.hasActiveTask ? '1' : readiness.hasEntries ? '1' : '0'
              }
              data-testid="continuum-check-bind"
              className="st-continuum__readiness-last"
            >
              <span className="st-continuum__readiness-dot" aria-hidden="true" />
              {props.streaming
                ? '流式写入'
                : props.hasActiveTask
                  ? props.scaffoldOnly
                    ? '任务结构位'
                    : '任务已绑定'
                  : readiness.hasEntries
                    ? `最近 · ${readiness.lastKind ? kindLabel(readiness.lastKind) + ' · ' : ''}${
                        readiness.lastLabel && readiness.lastLabel.length > 24
                          ? readiness.lastLabel.slice(0, 24) + '…'
                          : (readiness.lastLabel ?? '—')
                      }`
                    : '等待绑定'}
            </li>
          </ul>
          <p className="st-continuum__readiness-note" data-testid="continuum-readiness-note">
            {readiness.note}
          </p>
        </div>
      )}

      <div className="st-continuum-rail" role="list" aria-label="上下文连续体">
        {empty ? (
          <div className="st-continuum-rail__empty" data-testid="continuum-empty" role="status">
            {props.emptyState ??
              (props.hasActiveTask === false
                ? '尚无连续体 · 添加文件夹并打开任务后会出现结构位'
                : props.streaming
                  ? '连续体等待写入…'
                  : '尚无连续体条目 · 发送消息或写入记忆后会出现决策/记忆轨迹')}
          </div>
        ) : (
          props.entries.map((e) => {
            const category = e.categoryLabel?.trim() || kindLabel(e.kind);
            return (
              <button
                key={e.id}
                type="button"
                role="listitem"
                className="st-continuum-rail__chip"
                data-kind={e.kind}
                data-active={e.id === props.activeId ? 'true' : 'false'}
                data-testid={`continuum-chip-${e.id}`}
                onClick={() => props.onSelect?.(e.id)}
                title={`${category} · ${e.label}`}
              >
                <span
                  className="st-continuum-rail__kind"
                  data-kind={e.kind}
                  data-testid={`continuum-kind-${e.id}`}
                  title={e.kind}
                >
                  {category}
                </span>
                <span className="st-continuum-rail__label">{e.label}</span>
              </button>
            );
          })
        )}
        {props.children}
      </div>
    </div>
  );
}
