/**
 * 上下文用量与额度卡片 —— composer 上下文 hover 面板的卡片内容。
 *
 * 信息结构参考 BoardUI 的 "Agent Limits Card"（窗口用量条 + 可展开的 token 明细 +
 * 额度与重置时间）。那个组件属于付费 Pro、源码不公开（其开源仓库全量检索无任何实现
 * 文件），所以这里没有复制它的代码，只按同样的信息结构，用 SYNC-THINK 自己的数据模型
 * 与设计变量独立实现。
 *
 * 纯展示版：未传 `quotas` 时使用占位额度并显示「示例数据」徽标；传入 `quotas` 即消失。
 * 契约：原 hover 面板的全部 context-* testid 与文案在此保留。
 *
 * 体积约束：shell 有 totalJsBytes 预算，本卡片必须保持紧凑——行结构统一走 Row，
 * 两套构成明细合并成一次 map，时间戳用手写格式化而非 Intl 选项。
 */
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ContextStatusSection, ContextStatusSectionType } from '@sync-think/protocol';
import { BrandLogoMark } from './BrandLogoMark.js';
import { resolveKernelBrandLogo } from './brand-icons.js';

const LABELS: Record<ContextStatusSectionType, string> = {
  system: '系统指令',
  agent: '智能体 / 小队',
  project: '项目上下文',
  summary: '已保存摘要',
  messages: '消息历史',
  tools: '工具定义',
};

export function formatAgentLimitTokens(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, n) : 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1)}k`;
  return String(v);
}

const exact = (n: number) => `${Math.max(0, Math.round(n)).toLocaleString('en-US')} Token`;

function shortTime(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shortDuration(ms: number): string | null {
  if (!(ms > 0)) return null;
  const m = Math.round(ms / 60000);
  return m < 1 ? '<1 分钟' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分钟`;
}

/** 面板里的一行「标签 / 数值」；统一走这里，避免十几处重复的 JSX 结构。 */
function Row(p: {
  l: string;
  v: ReactNode;
  id?: string;
  t?: string;
  muted?: boolean;
  /** testid 落在行容器上（构成明细行需要，测试会读整行的标签+数值）。 */
  rowId?: boolean;
}): ReactNode {
  return (
    <div
      className={`shell-ctx-tooltip__row${p.muted ? ' shell-ctx-tooltip__row--muted' : ''}`}
      data-testid={p.rowId ? p.id : undefined}
    >
      <span>{p.l}</span>
      <strong data-testid={p.rowId ? undefined : p.id} title={p.t}>
        {p.v}
      </strong>
    </div>
  );
}

/** 一条额度（如「5 小时用量」）与它的重置时间。 */
export interface AgentLimitsQuota {
  id: string;
  label: string;
  used: number;
  limit: number;
  unit?: 'tokens' | 'requests';
  resetLabel?: string;
}

/** 纯展示版的占位额度；宿主传入 `quotas` 后即被替换。 */
export const PLACEHOLDER_AGENT_LIMITS_QUOTAS: readonly AgentLimitsQuota[] = [
  { id: 'h5', label: '5 小时用量', used: 1_240_000, limit: 2_000_000, resetLabel: '2 小时 14 分后重置' },
  { id: 'week', label: '每周用量', used: 8_600_000, limit: 20_000_000, resetLabel: '3 天 6 小时后重置' },
];

export interface AgentLimitsCardProps {
  /** 当前上下文占用（输入侧 tokens）。 */
  used: number;
  /** 当前上下文窗口上限。 */
  limit: number;
  modelContextWindow?: number;
  contextWindowEstimated?: boolean;
  contextWindowSource?: 'configured' | 'kernel-capped' | 'estimated' | 'kernel-reported';
  /** Runtime 计算的占用比；可超过 1。 */
  usageRatio?: number;
  compactThreshold?: number;
  compactedAt?: string;
  /** 上下文压缩由外部内核自管时为真。 */
  kernelSelfManaged?: boolean;
  kernelLabel?: string;
  kernelId?: string;
  sections?: ContextStatusSection[];
  /** 内核上报的上下文构成。 */
  occupancySections?: Array<{ name: string; tokens: number }>;
  sessionDurationMs?: number;
  sessionTokens?: number;
  /** 额度列表；缺省使用占位数据并显示「示例数据」徽标。 */
  quotas?: readonly AgentLimitsQuota[];
}

export function AgentLimitsCard(props: AgentLimitsCardProps) {
  const [open, setOpen] = useState(true);
  const logo = props.kernelId ? resolveKernelBrandLogo(props.kernelId) : undefined;
  const quotaList = props.quotas ?? PLACEHOLDER_AGENT_LIMITS_QUOTAS;
  const threshold =
    props.compactThreshold && props.compactThreshold > 0
      ? Math.min(1, props.compactThreshold)
      : 0.7;
  const ratio =
    props.usageRatio !== undefined && Number.isFinite(props.usageRatio)
      ? Math.max(0, props.usageRatio)
      : props.limit > 0
        ? Math.max(0, props.used / props.limit)
        : 0;
  const pct = Math.round(ratio * 100);
  const thrPct = Math.round(threshold * 100);
  const thrTokens = props.limit > 0 ? Math.round(props.limit * threshold) : 0;
  const reached = thrTokens > 0 && props.used >= thrTokens;
  const usedLabel = formatAgentLimitTokens(props.used);
  const selfManaged = props.kernelSelfManaged === true;
  const color =
    ratio >= 0.9
      ? 'var(--color-error)'
      : !selfManaged && ratio >= threshold
        ? 'var(--color-warning)'
        : 'var(--color-accent)';

  // 两套构成明细（宿主估算 / 内核上报）合并成一次渲染。
  const beds: Array<[string, number, string]> =
    props.occupancySections && props.occupancySections.length > 0
      ? props.occupancySections
          .filter((s) => s.tokens > 0)
          .map((s) => [s.name, s.tokens, `context-occupancy-${s.name}`])
      : selfManaged
        ? []
        : (props.sections ?? []).map((s) => [LABELS[s.type], s.tokens, `context-section-${s.type}`]);
  const sessions = shortDuration(props.sessionDurationMs ?? 0);

  return (
    <div className="shell-agent-limits" data-testid="agent-limits-card">
      <div className="shell-ctx-tooltip__header">
        <div>
          <div className="shell-ctx-tooltip__title-row">
            <div className="shell-ctx-tooltip__title">当前上下文窗口</div>
            {props.kernelLabel ? (
              <span
                className={`shell-ctx-tooltip__kernel${logo ? ' shell-ctx-tooltip__kernel--logo' : ''}`}
                data-testid="context-kernel-label"
                title={`当前内核：${props.kernelLabel}`}
              >
                {logo ? <BrandLogoMark logo={logo} size={14} /> : props.kernelLabel}
              </span>
            ) : null}
          </div>
          <div className="shell-ctx-tooltip__subtitle">当前模型实际可见的完整上下文窗口</div>
        </div>
        <strong className="shell-ctx-tooltip__headline">
          {usedLabel}
          <span> / {formatAgentLimitTokens(props.limit)}</span>
        </strong>
      </div>

      <div
        className="shell-ctx-tooltip__bar"
        role="progressbar"
        aria-label="当前对话上下文容量"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, props.limit)}
        aria-valuenow={Math.max(0, Math.min(props.used, props.limit || props.used))}
      >
        <div
          className="shell-ctx-tooltip__bar-fill"
          style={{ width: `${Math.min(1, ratio) * 100}%`, background: color }}
        />
        {selfManaged ? null : (
          <span
            className="shell-ctx-tooltip__bar-threshold"
            style={{ left: `${thrPct}%` }}
            title={`自动压缩阈值：${thrPct}%`}
            aria-hidden="true"
          />
        )}
      </div>

      <div
        className="shell-ctx-tooltip__status"
        data-testid={selfManaged ? 'context-kernel-self-managed' : undefined}
        data-state={reached ? 'threshold' : 'healthy'}
      >
        <span aria-hidden="true" />
        {selfManaged
          ? `上下文压缩由 ${props.kernelLabel || '当前'} 内核自行管理`
          : reached
            ? '已达到阈值，发送下一条消息前会自动压缩'
            : `达到 ${thrPct}% 时，在发送下一条消息前自动压缩`}
      </div>

      <div className="shell-agent-limits__divider" aria-hidden="true" />
      <Row
        l="当前占用"
        id="context-used-value"
        t={exact(props.used)}
        v={
          <>
            {usedLabel}
            <span className="shell-ctx-tooltip__pct"> · {pct}%</span>
          </>
        }
      />
      <Row
        l="容量上限"
        t={exact(props.limit)}
        v={
          <>
            {formatAgentLimitTokens(props.limit)}
            {props.contextWindowEstimated ? (
              <span className="shell-ctx-tooltip__pct" data-testid="context-limit-estimated">
                {' '}
                · 估算
              </span>
            ) : props.contextWindowSource === 'kernel-reported' ? (
              <span className="shell-ctx-tooltip__pct" data-testid="context-limit-kernel-reported">
                {' '}
                · 内核窗口
              </span>
            ) : props.contextWindowSource === 'kernel-capped' ? (
              <span className="shell-ctx-tooltip__pct" data-testid="context-limit-kernel-capped">
                {' '}
                · 受内核限制
              </span>
            ) : null}
          </>
        }
      />
      {props.modelContextWindow === undefined ? null : (
        <Row
          l="模型配置"
          id="context-model-default"
          t={exact(props.modelContextWindow)}
          v={formatAgentLimitTokens(props.modelContextWindow)}
        />
      )}
      <Row
        l="窗口剩余"
        t={exact(Math.max(0, props.limit - props.used))}
        v={formatAgentLimitTokens(Math.max(0, props.limit - props.used))}
      />
      {selfManaged ? null : (
        <div className="shell-agent-limits__group-body">
          <Row
            l="自动压缩"
            t={exact(thrTokens)}
            v={
              <span>
                {formatAgentLimitTokens(thrTokens)}
                <span className="shell-ctx-tooltip__pct"> · {thrPct}%</span>
              </span>
            }
          />
          <Row
            l="距离压缩"
            id="context-compact-distance"
            t={reached ? '已达到自动压缩阈值' : exact(Math.max(0, thrTokens - props.used))}
            v={
              reached
                ? '已达阈值'
                : formatAgentLimitTokens(Math.max(0, thrTokens - props.used))
            }
          />
          <Row
            l="最近压缩"
            id="context-compacted-at"
            v={shortTime(props.compactedAt) || '尚未发生'}
          />
        </div>
      )}

      {beds.length > 0 ? (
        <>
          <div className="shell-agent-limits__divider" aria-hidden="true" />
          <button
            type="button"
            className="shell-agent-limits__group-toggle"
            data-testid="agent-limits-breakdown-toggle"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight
              size={12}
              aria-hidden="true"
              className="shell-agent-limits__chevron"
              data-open={open ? 'true' : 'false'}
            />
            <span>上下文构成</span>
            <strong>{usedLabel}</strong>
          </button>
          {open ? (
            <div className="shell-agent-limits__group-body">
              <div
                className="shell-ctx-tooltip__title shell-ctx-tooltip__title--section"
                data-testid={props.occupancySections?.length ? 'context-occupancy-categories' : undefined}
              >
                {props.occupancySections?.length ? '内核上下文构成' : '当前对话上下文构成'}
              </div>
              {beds.map(([label, tokens, id]) => (
                <Row
                  key={id}
                  rowId
                  l={label}
                  id={id}
                  t={exact(tokens)}
                  v={formatAgentLimitTokens(tokens)}
                />
              ))}
              <Row
                rowId
                l="构成合计"
                muted
                id={
                  props.occupancySections?.length ? 'context-occupancy-total' : 'context-section-total'
                }
                t={exact(props.used)}
                v={usedLabel}
              />
            </div>
          ) : null}
        </>
      ) : null}

      <div className="shell-agent-limits__divider" aria-hidden="true" />
      <div className="shell-agent-limits__section-title">
        <span>额度与重置</span>
        {props.quotas === undefined ? (
          <span className="shell-agent-limits__placeholder" data-testid="agent-limits-placeholder">
            示例数据
          </span>
        ) : null}
      </div>
      {quotaList.map((q) => {
        const r = q.limit > 0 ? Math.max(0, Math.min(1, q.used / q.limit)) : 0;
        const tokens = (q.unit ?? 'tokens') === 'tokens';
        const ul = tokens ? formatAgentLimitTokens(q.used) : String(q.used);
        const ll = tokens ? formatAgentLimitTokens(q.limit) : String(q.limit);
        return (
          <div key={q.id} className="shell-agent-limits__quota" data-testid={`agent-limit-${q.id}`}>
            <div className="shell-agent-limits__quota-row">
              <span>{q.label}</span>
              <strong title={`${exact(q.used)} / ${exact(q.limit)}`}>
                {ul}
                <span className="shell-ctx-tooltip__pct"> / {ll}</span>
              </strong>
            </div>
            <div
              className="shell-agent-limits__quota-bar"
              role="meter"
              aria-label={`${q.label} 已用 ${Math.round(r * 100)}%`}
              aria-valuemin={0}
              aria-valuemax={q.limit}
              aria-valuenow={Math.min(q.used, q.limit)}
            >
              <div
                className="shell-agent-limits__quota-bar-fill"
                style={{ width: `${r * 100}%` }}
                data-state={r >= 1 ? 'exhausted' : r >= 0.8 ? 'warning' : 'healthy'}
              />
            </div>
            {q.resetLabel ? <div className="shell-agent-limits__quota-reset">{q.resetLabel}</div> : null}
          </div>
        );
      })}

      <div className="shell-agent-limits__divider" aria-hidden="true" />
      <Row
        l="累计 Token 消耗"
        id="context-session-tokens"
        t={props.sessionTokens === undefined ? undefined : exact(props.sessionTokens)}
        v={props.sessionTokens === undefined ? '尚未上报' : formatAgentLimitTokens(props.sessionTokens)}
      />
      {sessions ? <Row l="会话时长" v={sessions} /> : null}
    </div>
  );
}
