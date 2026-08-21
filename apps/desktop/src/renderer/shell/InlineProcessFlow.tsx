/**
 * DeepSeek Harness-style ordered assistant execution flow.
 * Every provider event stays on its own lightweight row; tool calls are never
 * grouped, and details expand in place without replacing the timeline.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleAlert,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  ListTodo,
  LoaderCircle,
  PencilLine,
  Plug,
  RotateCw,
  Search,
  SquareTerminal,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type {
  CommentaryTimelineSegment,
  ExecutionProcessStep,
  TaskPlanView,
} from '@sync-think/protocol';
import type { InlineProcessItem } from './ChatView.js';
import { useAutoDisclosure } from './auto-disclosure.js';
import { MarkdownContent } from './MarkdownContent.js';
import { buildExecutionTimeline } from './ExecutionTimeline.js';
import {
  activityFingerprint,
  deriveCurrentActivity,
  deriveStallState,
  formatElapsedZh,
  friendlyToolName,
  toolVisualKind,
  toolInputSummary,
  toolStatusOf,
  type ProcessToolVisualKind,
} from './process-activity.js';

function latestLine(text: string): string {
  return (
    text
      .split('\n')
      .filter((part) => part.trim())
      .at(-1)
      ?.trim() ?? ''
  );
}

/**
 * 折叠行是纯文本节点，Markdown 标记不会被渲染，只会原样显示成
 * `**分析字段匹配**` 这种噪声。这里只做**展示用**的标记剥离，不改原文
 * （展开体仍走 MarkdownContent 完整渲染）。
 */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}[-*+]\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** 整行加粗或 ATX 标题 —— Codex 思考块惯用的小标题形态。 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  return /^\*\*[^*]+\*\*$/.test(trimmed) || /^__[^_]+__$/.test(trimmed);
}

/**
 * 把一段思考拆成「折叠行标题」与「展开体正文」。
 *
 * 当首行本身就是小标题时，正文剔除该行——否则折叠行和展开体首行完全重复，
 * 展开后看起来像是同一句被说了两遍。首行不是标题时保留全文，折叠行只作预览。
 */
function splitReasoning(text: string): { title: string; body: string } {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.trim());
  if (index < 0) return { title: '', body: '' };
  const head = lines[index] ?? '';
  const title = stripInlineMarkdown(head);
  if (!isHeadingLine(head)) return { title, body: text };
  const body = lines
    .slice(index + 1)
    .join('\n')
    .replace(/^\n+/, '');
  return { title, body: body.trim() ? body : '' };
}

function elapsedLabel(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
}

/**
 * 运行中工具的自增耗时。`elapsedLabel` 要求终态边界，运行中拿不到，
 * 于是「在跑还是卡住」这个最需要时间的阶段反而完全没有时间显示。
 * `now` 来自面板层唯一的那个秒级时钟（不是每行各自的 interval），
 * 这样 running → completed 原位翻转时不会重挂载行（§12.17.17）。
 */
function runningElapsedLabel(startedAt: string | undefined, now: number): string | undefined {
  if (!startedAt) return undefined;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || now < started) return undefined;
  const elapsed = now - started;
  if (elapsed < 1000) return undefined;
  return elapsed < 60_000 ? `${Math.floor(elapsed / 1000)}s` : formatElapsedZh(elapsed);
}

function totalElapsedLabel(input: {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  streaming?: boolean;
  now: number;
}): string | undefined {
  const startedAt = Date.parse(input.startedAt ?? '');
  const completedAt = Date.parse(input.completedAt ?? '');
  const elapsedMs =
    Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt
      ? completedAt - startedAt
      : input.streaming && Number.isFinite(startedAt) && input.now >= startedAt
        ? input.now - startedAt
        : typeof input.durationMs === 'number' &&
            Number.isFinite(input.durationMs) &&
            input.durationMs >= 0
          ? input.durationMs
          : undefined;
  if (elapsedMs === undefined) return undefined;
  return formatElapsedZh(elapsedMs);
}

function ThinkRow({
  item,
  streaming,
  open,
  onToggle,
}: {
  item: Extract<InlineProcessItem, { kind: 'reasoning' }>;
  streaming?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const isStreaming = item.status === 'streaming' || (item.status === undefined && streaming);
  const split = useMemo(() => splitReasoning(item.text), [item.text]);
  // 流式期间跟随最新一行（进度感），完成后固定为该段思考的标题。
  const summary =
    (isStreaming ? stripInlineMarkdown(latestLine(item.text)) : split.title) || '正在思考…';
  const body = isStreaming ? item.text : split.body;
  return (
    <div
      className={`shell-inline-process__think${open ? ' is-open' : ''}`}
      data-testid="inline-process-reasoning"
    >
      <button
        type="button"
        className="shell-inline-process__think-toggle"
        data-testid="think-row-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Brain size={13} aria-hidden="true" />
        <span className="shell-inline-process__think-label">Think</span>
        <span className="shell-inline-process__think-summary" data-testid="think-row-summary">
          {summary}
        </span>
        {isStreaming ? (
          <LoaderCircle size={12} className="shell-inline-process__spin" aria-hidden="true" />
        ) : (
          <ChevronDown
            size={13}
            className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
            aria-hidden="true"
          />
        )}
      </button>
      {open && body ? (
        <div className="shell-inline-process__think-body" data-testid="think-row-body">
          <MarkdownContent text={body} streaming={false} />
        </div>
      ) : null}
    </div>
  );
}

function ToolStatusIcon({ status }: { status: 'running' | 'completed' | 'failed' }) {
  // 打勾 / 打叉成对：状态只靠图标表达，不再重复「完成 / 失败」文字。
  if (status === 'failed') return <X size={13} aria-hidden="true" />;
  if (status === 'running') {
    return <LoaderCircle size={13} className="shell-inline-process__spin" aria-hidden="true" />;
  }
  return <Check size={13} aria-hidden="true" />;
}

function ToolKindIcon({ kind }: { kind: ProcessToolVisualKind }) {
  if (kind === 'read') return <FileCode2 size={13} />;
  if (kind === 'write') return <PencilLine size={13} />;
  if (kind === 'list') return <FolderOpen size={13} />;
  if (kind === 'command') return <SquareTerminal size={13} />;
  if (kind === 'git') return <GitBranch size={13} />;
  if (kind === 'browser') return <Globe size={13} />;
  if (kind === 'search') return <Search size={13} />;
  if (kind === 'mcp') return <Plug size={13} />;
  return <Wrench size={13} />;
}

const TOOL_STATUS_TEXT: Readonly<Record<'running' | 'completed' | 'failed', string>> = {
  running: '运行中',
  completed: '完成',
  failed: '失败',
};

function structuredFields(text: string): ReadonlyArray<readonly [string, unknown]> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed as Record<string, unknown>);
    return entries.length > 0 ? entries : undefined;
  } catch {
    return undefined;
  }
}

function structuredValueText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolPayload({
  text,
  testId,
  failed = false,
}: {
  text: string;
  testId: string;
  failed?: boolean;
}) {
  const fields = structuredFields(text);
  if (!fields) {
    return (
      <pre
        className={`shell-inline-process__tool-code${failed ? ' is-failed' : ''}`}
        data-testid={testId}
      >
        {text}
      </pre>
    );
  }
  return (
    <dl
      className={`shell-inline-process__structured${failed ? ' is-failed' : ''}`}
      data-testid={testId}
    >
      {fields.map(([key, value]) => {
        const nested = value !== null && typeof value === 'object';
        return (
          <div className="shell-inline-process__structured-row" key={key}>
            <dt>{key}</dt>
            <dd className={nested ? 'is-nested' : undefined}>{structuredValueText(value)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function ToolRow({
  item,
  now,
  open,
  onToggle,
}: {
  item: Extract<InlineProcessItem, { kind: 'tool' }>;
  /** 面板层的秒级时钟；仅运行中的行会用到。 */
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const status = toolStatusOf(item);
  const summary = toolInputSummary(item);
  const elapsed = elapsedLabel(item.startedAt, item.completedAt);
  const liveElapsed = status === 'running' ? runningElapsedLabel(item.startedAt, now) : undefined;
  const rowElapsed = status === 'running' ? liveElapsed : elapsed;
  const displayName = item.displayName?.trim() || friendlyToolName(item.name);
  const visualKind = toolVisualKind(item.name);
  const statusText = TOOL_STATUS_TEXT[status];
  const progressLine = status === 'running' ? item.progressLine?.trim() : undefined;
  return (
    <div
      className={`shell-inline-process__tool is-${status}`}
      data-testid="inline-process-tool"
      data-failed={status === 'failed' ? 'true' : 'false'}
    >
      <button
        type="button"
        className="shell-inline-process__tool-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span
          className="shell-inline-process__tool-icon"
          data-testid="process-tool-kind"
          data-kind={visualKind}
          aria-hidden="true"
        >
          <ToolKindIcon kind={visualKind} />
        </span>
        <span className="shell-inline-process__tool-name">{displayName}</span>
        {summary ? <span className="shell-inline-process__tool-summary">{summary}</span> : null}
        {rowElapsed ? (
          <span
            className="shell-inline-process__tool-elapsed"
            data-testid="inline-process-tool-elapsed"
          >
            {rowElapsed}
          </span>
        ) : null}
        <span
          className="shell-inline-process__tool-status"
          data-testid="inline-process-tool-status"
          data-status={status}
          title={statusText}
          aria-label={statusText}
        >
          <ToolStatusIcon status={status} />
        </span>
        <ChevronDown
          size={13}
          className={`shell-inline-process__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {progressLine ? (
        <div
          className="shell-inline-process__tool-progress"
          data-testid="inline-process-tool-progress"
        >
          {progressLine}
        </div>
      ) : null}
      {open ? (
        <div className="shell-inline-process__tool-body">
          <div className="shell-inline-process__detail-row">
            <span>原始工具</span>
            <code>{item.name}</code>
          </div>
          {elapsed ?? liveElapsed ? (
            <div className="shell-inline-process__detail-row">
              <span>耗时</span>
              <code>{elapsed ?? liveElapsed}</code>
            </div>
          ) : null}
          {item.argumentsJson ? (
            <div className="shell-inline-process__detail-block">
              <span>参数</span>
              <ToolPayload
                text={item.argumentsJson}
                testId="inline-process-tool-arguments"
              />
            </div>
          ) : null}
          {item.result !== undefined ? (
            <div className="shell-inline-process__detail-block">
              <span>{status === 'failed' ? '错误' : '输出'}</span>
              <ToolPayload
                text={item.result}
                testId="inline-process-tool-result"
                failed={status === 'failed'}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusRow({ item }: { item: Extract<InlineProcessItem, { kind: 'status' }> }) {
  const failed =
    item.statusType === 'connection' &&
    /失败|断开|error|failed/i.test(`${item.label} ${item.detail ?? ''}`);
  return (
    <div
      className={`shell-inline-process__status${failed ? ' is-failed' : ''}`}
      data-testid="inline-process-status"
      role="status"
    >
      {item.statusType === 'retry' || item.statusType === 'model_switch' ? (
        <RotateCw size={12} aria-hidden="true" />
      ) : failed ? (
        <CircleAlert size={12} aria-hidden="true" />
      ) : (
        <Check size={12} aria-hidden="true" />
      )}
      <span>{item.label}</span>
      {item.detail ? (
        <span className="shell-inline-process__status-detail">{item.detail}</span>
      ) : null}
    </div>
  );
}

function ProcessItemView({
  item,
  streaming,
  now,
  open,
  onToggle,
}: {
  item: InlineProcessItem;
  streaming?: boolean;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (item.kind === 'reasoning') {
    return <ThinkRow item={item} streaming={streaming} open={open} onToggle={onToggle} />;
  }
  if (item.kind === 'tool') {
    return <ToolRow item={item} now={now} open={open} onToggle={onToggle} />;
  }
  if (item.kind === 'status') return <StatusRow item={item} />;
  return (
    <div
      className="shell-inline-process__markdown"
      data-testid={item.kind === 'commentary' ? 'inline-process-commentary' : 'inline-process-text'}
    >
      <MarkdownContent text={item.text} streaming={false} />
    </div>
  );
}

function processItemKey(item: InlineProcessItem, index: number): string {
  if (item.kind === 'tool' && item.toolCallId) return `tool-${item.toolCallId}`;
  if (item.id) return item.id;
  if (item.sequence !== undefined) return `${item.kind}-${item.sequence}`;
  return `${item.kind}-${index}`;
}

function TurnPlanSection({ plan }: { plan: TaskPlanView }) {
  if (plan.items.length === 0) return null;
  return (
    <section className="shell-process-plan" data-testid="process-turn-plan">
      <div className="shell-process-plan__header">
        <ListTodo size={13} aria-hidden="true" />
        <span className="shell-process-plan__title">本轮计划</span>
        <span className="shell-process-plan__progress">
          {plan.completed}/{plan.total}
        </span>
      </div>
      <ol className="shell-process-plan__list">
        {plan.items.map((item, index) => (
          <li
            key={`${index}-${item.title}`}
            className="shell-process-plan__item"
            data-status={item.status}
          >
            <span className="shell-process-plan__status" aria-label={item.status}>
              {item.status === 'completed' ? (
                <Check size={12} aria-hidden="true" />
              ) : item.status === 'in_progress' ? (
                <LoaderCircle
                  size={12}
                  className="shell-inline-process__spin"
                  aria-hidden="true"
                />
              ) : (
                <Circle size={10} aria-hidden="true" />
              )}
            </span>
            <span className="shell-process-plan__item-title">{item.title}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export const InlineProcessFlow = memo(function InlineProcessFlow({
  items,
  steps,
  commentarySegments,
  streaming,
  answerStarted = false,
  runId,
  startedAt,
  completedAt,
  durationMs,
  defaultOpen = false,
  turnPlan,
  agentTaskContent,
  supplementalContent,
}: {
  items: readonly InlineProcessItem[];
  steps?: readonly ExecutionProcessStep[];
  commentarySegments?: readonly CommentaryTimelineSegment[];
  streaming?: boolean;
  answerStarted?: boolean;
  runId?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  /** Deterministic fixture override; production follows the run phase. */
  defaultOpen?: boolean;
  /** Model-authored checklist for this turn. */
  turnPlan?: TaskPlanView;
  /** Reserved for real delegated task projections; omitted when no tasks exist. */
  agentTaskContent?: ReactNode;
  supplementalContent?: ReactNode;
}) {
  const orderedItems = useMemo<readonly InlineProcessItem[]>(() => {
    if (items.some((item) => item.kind === 'tool' || item.kind === 'status')) return items;
    if (!steps?.length && !commentarySegments?.length) return items;
    const merged: InlineProcessItem[] = [];
    for (const item of buildExecutionTimeline({ steps, commentarySegments })) {
      if (item.type === 'commentary') {
        if (item.text.trim()) merged.push({ kind: 'commentary', text: item.text });
        continue;
      }
      for (const step of item.steps) {
        merged.push({
          kind: 'tool',
          name: step.toolName ?? step.label ?? '工具',
          argumentsJson: step.command ?? step.url ?? step.path ?? '',
          result: step.preview ?? step.error ?? '',
          status: step.status === 'error' ? 'failed' : step.completedAt ? 'completed' : 'running',
          ...(step.status === 'error' ? { failed: true } : {}),
          ...(step.startedAt ? { startedAt: step.startedAt } : {}),
          ...(step.completedAt ? { completedAt: step.completedAt } : {}),
        });
      }
    }
    return [...items.filter((item) => item.kind !== 'commentary'), ...merged];
  }, [items, steps, commentarySegments]);

  const { open, toggle } = useAutoDisclosure({
    autoOpen: defaultOpen || Boolean(streaming && !answerStarted),
    resetKey: runId,
  });
  const [expandedItemKeys, setExpandedItemKeys] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setExpandedItemKeys(new Set());
  }, [runId]);
  const toggleItem = useCallback((itemKey: string) => {
    setExpandedItemKeys((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  }, []);
  const expandableItemKeys = useMemo(
    () =>
      orderedItems.flatMap((item, index) =>
        item.kind === 'reasoning' || item.kind === 'tool'
          ? [processItemKey(item, index)]
          : [],
      ),
    [orderedItems],
  );
  const [clockNow, setClockNow] = useState(() => Date.now());
  // 面板层唯一的秒级时钟，驱动总耗时、每行运行耗时和停滞分级。运行中就必须
  // 走（不能再要求 startedAt）——工具行的耗时只依赖各自的 startedAt。
  const ticking = Boolean(streaming) && !completedAt;
  useEffect(() => {
    if (!ticking) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  const totalElapsed = totalElapsedLabel({
    startedAt,
    completedAt,
    durationMs,
    streaming,
    now: clockNow,
  });

  const activity = useMemo(
    () => deriveCurrentActivity(orderedItems, { streaming }),
    [orderedItems, streaming],
  );

  // 最后一次可见进展。指纹变化即刷新，用来把「工具在跑」和「什么都没来」
  // 区分开——前者慢是正常的，后者才可疑。
  const fingerprint = useMemo(() => activityFingerprint(orderedItems), [orderedItems]);
  const lastProgressRef = useRef({ fingerprint, at: Date.now() });
  if (lastProgressRef.current.fingerprint !== fingerprint) {
    lastProgressRef.current = { fingerprint, at: Date.now() };
  }
  useEffect(() => {
    // 新 Run 重新起算，避免上一轮的停滞判定顺延过来。
    lastProgressRef.current = { fingerprint: '', at: Date.now() };
  }, [runId]);
  const stall = deriveStallState({
    ...(activity ? { activity } : {}),
    lastProgressAt: lastProgressRef.current.at,
    now: clockNow,
  });
  const activityIdle = activity ? formatElapsedZh(stall.idleMs) : undefined;

  const hasTurnPlan = Boolean(turnPlan?.items.length);
  if (orderedItems.length === 0 && !hasTurnPlan && !agentTaskContent && !supplementalContent) {
    return null;
  }
  return (
    <section
      className={`shell-process-panel${open ? ' is-open' : ''}`}
      data-testid="process-panel"
      data-streaming={streaming ? '1' : '0'}
    >
      <button
        type="button"
        className="shell-process-panel__toggle"
        data-testid="process-panel-toggle"
        aria-expanded={open}
        onClick={toggle}
      >
        {streaming && !answerStarted ? (
          <LoaderCircle size={13} className="shell-inline-process__spin" aria-hidden="true" />
        ) : (
          <Brain size={13} aria-hidden="true" />
        )}
        <span className="shell-process-panel__title">执行过程</span>
        {/* 折叠态也必须能回答「现在在做什么」——这是本行存在的唯一理由。 */}
        {activity ? (
          <span
            className="shell-process-panel__activity"
            data-testid="process-panel-activity"
            data-kind={activity.kind}
            data-stall={stall.level}
          >
            <span className="shell-process-panel__activity-label">{activity.label}</span>
            {stall.level !== 'active' ? (
              <span className="shell-process-panel__activity-idle">
                {stall.hint ? `${stall.hint} · ${activityIdle}` : activityIdle}
              </span>
            ) : null}
          </span>
        ) : null}
        {orderedItems.length > 0 ? (
          <span className="shell-process-panel__meta">{orderedItems.length} 项</span>
        ) : null}
        {totalElapsed ? (
          <span className="shell-process-panel__elapsed">· {totalElapsed}</span>
        ) : null}
        <ChevronDown
          size={14}
          className={`shell-process-panel__chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="shell-process-panel__body" data-testid="process-panel-body">
          {turnPlan ? <TurnPlanSection plan={turnPlan} /> : null}
          {agentTaskContent ? (
            <section className="shell-process-agent-tasks" data-testid="process-agent-tasks">
              <div className="shell-process-agent-tasks__header">
                <Users size={13} aria-hidden="true" />
                <span>智能体任务</span>
              </div>
              <div className="shell-process-agent-tasks__body">{agentTaskContent}</div>
            </section>
          ) : null}
          {expandableItemKeys.length > 0 ? (
            <div className="shell-process-panel__toolbar" aria-label="过程详情控制">
              <button
                type="button"
                className="shell-process-panel__toolbar-button"
                onClick={() => setExpandedItemKeys(new Set(expandableItemKeys))}
              >
                <ChevronsUpDown size={12} aria-hidden="true" />
                <span>全部展开</span>
              </button>
              <button
                type="button"
                className="shell-process-panel__toolbar-button"
                onClick={() => setExpandedItemKeys(new Set())}
              >
                <ChevronsDownUp size={12} aria-hidden="true" />
                <span>全部收起</span>
              </button>
            </div>
          ) : null}
          {orderedItems.length > 0 ? (
            <div className="shell-inline-process" data-testid="inline-process-flow">
              {orderedItems.map((item, index) => {
                // Stable key first (toolCallId / id / sequence) so status
                // updates reuse the row instead of remounting it.
                const itemKey = processItemKey(item, index);
                return (
                  <div
                    key={itemKey}
                    className="shell-inline-process__entry"
                    data-testid="process-entry"
                  >
                    <span
                      className="shell-inline-process__entry-index"
                      data-testid="process-entry-index"
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="shell-inline-process__entry-content">
                      <ProcessItemView
                        item={item}
                        streaming={streaming}
                        now={clockNow}
                        open={expandedItemKeys.has(itemKey)}
                        onToggle={() => toggleItem(itemKey)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
          {/* §活动指示器：执行过程最下方常驻 sync-thinking 脉冲——思考/工具执行
              期间持续闪烁，明确「还在执行中」；开始输出最终回答后隐藏。 */}
          {streaming && !answerStarted ? (
            <div
              className="shell-process-panel__thinking"
              data-testid="process-thinking"
              role="status"
            >
              <span className="shell-process-panel__thinking-dot" aria-hidden="true" />
              sync-thinking
            </div>
          ) : null}
          {supplementalContent ? (
            <div className="shell-process-panel__supplemental">{supplementalContent}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
