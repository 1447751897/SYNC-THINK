/**
 * BoardUI Agent Limits public-preview layout, independently implemented with
 * Runtime/kernel counters. Missing quota or bucket metrics are never demo data.
 */
import { useId, useLayoutEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ContextStatusSection } from '@sync-think/protocol';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo } from './brand-icons.js';

const BUCKETS = [
  ['messages', '消息历史', 'var(--limits-messages)'],
  ['tools', '工具定义', 'var(--limits-tools)'],
  ['system', '系统指令', 'var(--limits-system)'],
  ['project', '项目上下文', 'var(--limits-skills)'],
  ['summary', '已保存摘要', 'var(--limits-memory)'],
  ['agent', '智能体 / 小队', 'var(--limits-agents)'],
] as const;
const limitsClass = (name: string) => 'shell-agent-limits__' + name;
const clean = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
export function formatAgentLimitTokens(n: number): string {
  const v = clean(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1)}k`;
  return String(Math.round(v));
}
const exact = (n: number) => `${Math.round(clean(n)).toLocaleString('en-US')} Token`;
function shortTime(value?: string): string {
  const d = new Date(value ?? '');
  if (!Number.isFinite(d.getTime())) return '尚未发生';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function Row(p: { l: string; v: ReactNode; id?: string; t?: string }) {
  return (
    <div className="shell-ctx-tooltip__row">
      <span>{p.l}</span>
      <strong data-testid={p.id} title={p.t}>
        {p.v}
      </strong>
    </div>
  );
}
function Bucket(p: {
  id?: string;
  label: string;
  tokens: number;
  percent: string;
  color?: string;
  tone?: 'muted' | 'free';
  reported?: boolean;
}) {
  return (
    <div className={limitsClass('bucket')} data-testid={p.id}>
      <span
        className={`shell-agent-limits__dot${p.tone ? ' shell-agent-limits__dot--' + p.tone : ''}`}
        style={p.color ? { background: p.color } : undefined}
        aria-hidden="true"
      />
      <span className={limitsClass('bucket-label')}>{p.label}</span>
      <strong title={p.reported === false ? undefined : exact(p.tokens)}>
        {p.reported === false ? '未上报' : formatAgentLimitTokens(p.tokens)}
      </strong>
      <span className={limitsClass('bucket-percent')}>{p.percent}</span>
    </div>
  );
}
export interface AgentLimitsQuota {
  id: string;
  label: string;
  used: number;
  limit: number;
  unit?: 'tokens' | 'requests';
  resetLabel?: string;
}
export interface AgentLimitsCardProps {
  used: number;
  limit: number;
  modelContextWindow?: number;
  contextWindowEstimated?: boolean;
  contextWindowSource?: 'configured' | 'kernel-capped' | 'estimated' | 'kernel-reported';
  usageRatio?: number;
  compactThreshold?: number;
  budget?: import('@sync-think/protocol').ConversationGetContextStatusResponse['budget'];
  measurement?: import('@sync-think/protocol').ConversationGetContextStatusResponse['measurement'];
  compactedAt?: string;
  kernelSelfManaged?: boolean;
  kernelLabel?: string;
  kernelId?: string;
  sections?: ContextStatusSection[];
  occupancySections?: Array<{ name: string; tokens: number }>;
  sessionDurationMs?: number;
  sessionTokens?: number;
  /** Only actual provider-account quota counters. Undefined means not connected. */
  quotas?: readonly AgentLimitsQuota[];
}
function bucketColor(name: string): string {
  const n = name.toLowerCase();
  if (/mcp/.test(n)) return 'var(--limits-mcp)';
  if (/skill/.test(n)) return BUCKETS[3][2];
  if (/message/.test(n)) return BUCKETS[0][2];
  if (/tool/.test(n)) return BUCKETS[1][2];
  if (/system|prompt/.test(n)) return BUCKETS[2][2];
  if (/memor/.test(n)) return BUCKETS[4][2];
  if (/agent/.test(n)) return BUCKETS[5][2];
  return 'var(--color-text-faint)';
}

/** Keep outgoing content only for its height transition, and remove it from
 * keyboard/accessibility navigation immediately when it is closing. */
function LimitsDisclosure(props: { id: string; open: boolean; children: ReactNode }) {
  const [present, setPresent] = useState(props.open);
  useLayoutEffect(() => {
    if (props.open) {
      setPresent(true);
      return;
    }
    if (!present) return;
    if (
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.hasAttribute('data-reduced-motion')
    ) {
      setPresent(false);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(timer);
  }, [props.open, present]);
  return (
    <div
      id={props.id}
      className={limitsClass('disclosure')}
      data-open={props.open}
      aria-hidden={!props.open}
      {...(props.open ? {} : { inert: '' })}
    >
      <div className={limitsClass('disclosure-clip')}>{present ? props.children : null}</div>
    </div>
  );
}

export function AgentLimitsCard(props: AgentLimitsCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [details, setDetails] = useState(false);
  const contentId = useId();
  const used = clean(props.used),
    limit = clean(props.limit);
  const ratio = Number.isFinite(props.usageRatio)
    ? clean(props.usageRatio!)
    : limit > 0
      ? used / limit
      : 0;
  const pct = Math.round(ratio * 100);
  const threshold = clean(props.compactThreshold ?? 0.85) || 0.85;
  const thrTokens = Math.round(limit * Math.min(1, threshold));
  const thrPct = Math.round(Math.min(1, threshold) * 100);
  const reached = thrTokens > 0 && used >= thrTokens;
  const selfManaged = props.kernelSelfManaged === true;
  const reported = Boolean(props.occupancySections?.length);
  const logo = props.kernelId ? resolveKernelBrandLogo(props.kernelId) : undefined;
  const rows = reported
    ? props.occupancySections!.map((s, index) => ({
        label: s.name,
        tokens: clean(s.tokens),
        id: `context-occupancy-${s.name}`,
        key: `kernel-${index}`,
        color: bucketColor(s.name),
      }))
    : selfManaged
      ? []
      : BUCKETS.flatMap(([type, label, color]) =>
          (props.sections ?? [])
            .filter((s) => s.type === type)
            .map((s) => ({
              label,
              tokens: clean(s.tokens),
              id: `context-section-${type}`,
              key: type,
              color,
            })),
        );
  const sum = rows.reduce((n, s) => n + s.tokens, 0);
  const unclassified = Math.max(0, used - sum);
  const remaining = Math.max(0, limit - used);
  // Kernel category snapshots can differ from the latest overall usage counter.
  // Keep actual values; do not rescale or pass off an estimated partition as exact.
  const consistent = sum <= used;
  const fraction = (n: number) => (limit > 0 ? `${((n / limit) * 100).toFixed(1)}%` : '—');
  const segmentWidth = (n: number) => (limit > 0 ? (n / Math.max(limit, used)) * 100 : 0);
  const state =
    ratio >= 1 ? 'exhausted' : ratio >= 0.9 || (!selfManaged && reached) ? 'warning' : 'healthy';
  const limitSource = props.contextWindowEstimated
    ? ['context-limit-estimated', '估算']
    : props.contextWindowSource === 'kernel-reported'
      ? ['context-limit-kernel-reported', '内核窗口']
      : props.contextWindowSource === 'kernel-capped'
        ? ['context-limit-kernel-capped', '受内核限制']
        : undefined;
  return (
    <div className="shell-agent-limits" data-testid="agent-limits-card" data-state={state}>
      <button
        type="button"
        className={limitsClass('heading')}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((v) => !v)}
        data-testid="agent-limits-breakdown-toggle"
      >
        <span>当前上下文窗口</span>
        <span className={limitsClass('headline')}>
          <strong data-testid="context-used-value" title={exact(used)}>
            {formatAgentLimitTokens(used)}
          </strong>
          <span> / {limit > 0 ? formatAgentLimitTokens(limit) : '未上报'}</span>
          <span className={limitsClass('percent')}> ({limit > 0 ? `${pct}%` : '—'})</span>
        </span>
        <ChevronDown size={13} aria-hidden="true" data-open={expanded} />
      </button>
      <div
        className={limitsClass('segments')}
        role="progressbar"
        aria-label="当前对话上下文容量"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${exact(used)} / ${limit > 0 ? exact(limit) : '容量未上报'}`}
      >
        {consistent && rows.length
          ? rows
              .filter((s) => s.tokens > 0)
              .map((s) => (
                <span
                  key={s.key}
                  title={`${s.label} · ${exact(s.tokens)}`}
                  style={{
                    width: `${segmentWidth(s.tokens)}%`,
                    background: s.color,
                  }}
                />
              ))
          : null}
        {unclassified > 0 || !consistent ? (
          <span
            title="未分类占用"
            style={{
              width: `${segmentWidth(consistent ? unclassified : used)}%`,
              background: 'var(--limits-messages)',
            }}
          />
        ) : null}
      </div>
      <LimitsDisclosure id={contentId} open={expanded}>
        <div className={limitsClass('breakdown')}>
          {rows.length > 0 ? (
            <div
              className={limitsClass('sr-label')}
              data-testid={reported ? 'context-occupancy-categories' : undefined}
            >
              {reported ? '内核上下文构成' : '当前对话上下文构成'}
            </div>
          ) : null}
          {rows.map((s) => (
            <Bucket
              key={s.key}
              id={s.id}
              label={s.label}
              tokens={s.tokens}
              color={s.color}
              percent={fraction(s.tokens)}
            />
          ))}
          {unclassified > 0 ? (
            <Bucket
              id="context-unclassified"
              label={rows.length ? '未分类占用' : '上下文占用（明细未上报）'}
              tokens={unclassified}
              tone="muted"
              percent={fraction(unclassified)}
            />
          ) : null}
          {!consistent ? <p className={limitsClass('note')}>内核明细待同步，以总量为准。</p> : null}
          <Bucket
            id="context-free-space"
            label="窗口剩余"
            tokens={remaining}
            tone="free"
            percent={fraction(remaining)}
            reported={limit > 0}
          />
          <button
            type="button"
            className={limitsClass('group-toggle')}
            aria-expanded={details}
            aria-controls={`${contentId}-details`}
            onClick={() => setDetails((v) => !v)}
          >
            <ChevronRight
              size={12}
              className={limitsClass('chevron')}
              data-open={details}
              aria-hidden="true"
            />
            <span>窗口与压缩详情</span>
            {props.kernelLabel ? (
              <span
                className={`shell-ctx-tooltip__kernel${logo ? ' shell-ctx-tooltip__kernel--logo' : ''}`}
                data-testid="context-kernel-label"
                title={`当前内核：${props.kernelLabel}`}
              >
                {logo ? <BrandLogoMark logo={logo} size={14} /> : props.kernelLabel}
              </span>
            ) : null}
          </button>
          <LimitsDisclosure id={`${contentId}-details`} open={details}>
            <div className={limitsClass('details')}>
              <p className={limitsClass('note')}>
                {props.measurement?.source === 'provider-calibrated'
                  ? '实际输入校准，增量估算'
                  : '请求估算，非累计计费用量'}
              </p>
              <Row
                l="容量上限"
                v={
                  <>
                    {limit > 0 ? formatAgentLimitTokens(limit) : '尚未上报'}
                    {limitSource ? (
                      <span className="shell-ctx-tooltip__pct" data-testid={limitSource[0]}>
                        {' '}
                        · {limitSource[1]}
                      </span>
                    ) : null}
                  </>
                }
                t={exact(limit)}
              />
              {props.modelContextWindow === undefined ? null : (
                <Row
                  l="模型配置"
                  id="context-model-default"
                  v={formatAgentLimitTokens(props.modelContextWindow)}
                  t={exact(props.modelContextWindow)}
                />
              )}
              {selfManaged ? (
                <p className={limitsClass('note')} data-testid="context-kernel-self-managed">
                  上下文压缩由 {props.kernelLabel || '当前'} 内核自行管理
                </p>
              ) : (
                <>
                  {props.budget
                    ? (
                        [
                          ['输出预留', props.budget.reservedOutputTokens],
                          ['安全余量', props.budget.safetyMarginTokens],
                          ['固定输入成本', props.budget.fixedInputTokens],
                          ['可用历史预算', props.budget.availableHistoryTokens],
                        ] satisfies [string, number][]
                      ).map(([label, tokens]) => (
                        <Row
                          key={label}
                          l={label}
                          v={formatAgentLimitTokens(tokens)}
                          t={exact(tokens)}
                        />
                      ))
                    : null}
                  <Row l="自动压缩" v={`${formatAgentLimitTokens(thrTokens)} · ${thrPct}%`} />
                  <Row
                    l="距离压缩"
                    id="context-compact-distance"
                    v={reached ? '已达阈值' : formatAgentLimitTokens(Math.max(0, thrTokens - used))}
                  />
                  <Row l="最近压缩" id="context-compacted-at" v={shortTime(props.compactedAt)} />
                  <p className={limitsClass('note')}>请求前先整理，必要时摘要</p>
                </>
              )}
            </div>
          </LimitsDisclosure>
        </div>
      </LimitsDisclosure>
      {state !== 'healthy' ? (
        <p className={limitsClass('notice')} role="status">
          {ratio >= 1 ? '当前上下文已超出窗口容量' : '当前上下文接近压缩或容量阈值'}
        </p>
      ) : null}
      <div className={limitsClass('divider')} />
      <div className={limitsClass('section-title')}>
        <span>套餐额度</span>
        {!props.quotas?.length ? <span data-testid="agent-limits-unreported">尚未接入</span> : null}
      </div>
      {(props.quotas ?? []).map((q) => {
        const quotaUsed = clean(q.used),
          quotaLimit = clean(q.limit);
        const qr = quotaLimit > 0 ? quotaUsed / quotaLimit : 0;
        const fmt =
          q.unit === 'requests' ? (n: number) => String(Math.round(n)) : formatAgentLimitTokens;
        return (
          <div key={q.id} className={limitsClass('quota')} data-testid={`agent-limit-${q.id}`}>
            <div className={limitsClass('quota-row')}>
              <span>{q.label}</span>
              <span className={limitsClass('quota-reset')}>{q.resetLabel}</span>
              <strong>{quotaLimit > 0 ? `${Math.round(qr * 100)}%` : '—'}</strong>
            </div>
            <div
              className={limitsClass('quota-bar')}
              role="meter"
              aria-label={q.label}
              aria-valuemin={0}
              aria-valuemax={quotaLimit}
              aria-valuenow={Math.min(quotaUsed, quotaLimit)}
              aria-valuetext={`${fmt(quotaUsed)} / ${quotaLimit > 0 ? fmt(quotaLimit) : '未上报'}`}
            >
              <div
                className={limitsClass('quota-bar-fill')}
                style={{ width: `${Math.min(1, qr) * 100}%` }}
                data-state={qr >= 1 ? 'exhausted' : qr >= 0.8 ? 'warning' : 'healthy'}
              />
            </div>
          </div>
        );
      })}
      <Row
        l="累计 Token 消耗"
        id="context-session-tokens"
        t={props.sessionTokens === undefined ? undefined : exact(props.sessionTokens)}
        v={
          props.sessionTokens === undefined
            ? '尚未上报'
            : formatAgentLimitTokens(props.sessionTokens)
        }
      />
      {clean(props.sessionDurationMs ?? 0) > 0 ? (
        <Row l="会话时长" v={`${Math.max(1, Math.round(props.sessionDurationMs! / 60000))} 分钟`} />
      ) : null}
    </div>
  );
}
