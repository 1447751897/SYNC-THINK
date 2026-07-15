/**
 * Format a paste-ready M1 soft snapshot for handtest / dogfood notes.
 * Soft assist only — never auto-checks docs, never includes secrets.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';
export interface M1SoftSnapshotInput {
  generatedAt?: string;
  connectionState: string;
  hasActiveTask: boolean;
  taskTitle?: string | null;
  providerCount: number;
  modelCount: number;
  secretCount: number;
  /** Soft multi-model gate. */
  providersReadySoft: boolean;
  agentDefaultSet: boolean;
  agentFallbackCount: number;
  sessionLevel: string;
  sessionSummary?: string | null;
  handtestLivePass: number;
  handtestLiveTotal: number;
  handtestSoftLiveAllPass: boolean;
  handtestExternalPending: number;
  handtestDocChecked: number;
  handtestDocTotal: number;
  /** Pending handtest item labels (soft hint only). */
  pendingHandtestLabels?: readonly string[];
  dogfoodRealDays: number;
  dogfoodRequired: number;
  dogfoodFileCount: number;
  dualAutomatedOk: boolean;
  hardGatesMet: boolean;
  exitLevel: string;
  nextKind?: string | null;
  nextTitle?: string | null;
  nextCtaAction?: string | null;
  /** Distinct models seen in current task messages (soft). */
  distinctMessageModelCount?: number;
  manifestCount?: number;
  hasTraceEvents?: boolean;
}

export interface M1SoftSnapshot {
  /** Full markdown for clipboard. */
  markdown: string;
  /** One-line summary for feedback strip. */
  summary: string;
  /** Character length of markdown. */
  charCount: number;
  /** Never true for auto-close; always false here. */
  claimsM1Closed: false;
}

function yn(v: boolean): string {
  return v ? '是' : '否';
}

function clampLabels(labels: readonly string[] | undefined, max = 8): string[] {
  if (!labels || labels.length === 0) return [];
  return labels
    .slice(0, max)
    .map((s) => String(s).trim())
    .filter(Boolean);
}

/**
 * Build paste-ready snapshot. Callers must never pass API keys / baseURL secrets.
 */
export function formatM1SoftSnapshot(input: M1SoftSnapshotInput): M1SoftSnapshot {
  const at = input.generatedAt?.trim() || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const handtestDocTotal = Math.max(1, input.handtestDocTotal | 0 || 18);
  const handtestDocChecked = Math.max(0, input.handtestDocChecked | 0);
  const handtestComplete = handtestDocChecked >= handtestDocTotal;
  const pending = clampLabels(input.pendingHandtestLabels);
  const nextLine =
    input.nextTitle && input.nextKind
      ? `- 下一步：${input.nextTitle}（${input.nextKind}${
          input.nextCtaAction ? ' · ' + input.nextCtaAction : ''
        }）`
      : input.nextTitle
        ? `- 下一步：${input.nextTitle}`
        : '- 下一步：—';

  const lines: string[] = [
    '# SYNC-THINK M1 soft 快照（粘贴辅助 · 非退出证据）',
    '',
    handtestComplete
      ? `> 外网手测文档 ${handtestDocChecked}/${handtestDocTotal} 已完成；本快照只对照当前 soft 状态。`
      : '> 本机 soft 状态导出，**不能**替代外网手测勾选或 dogfood 真实日记。',
    input.hardGatesMet
      ? '> **不含** API Key / 明文密钥。M1 退出证据已齐，当前状态见验证区。'
      : handtestComplete
        ? `> **不含** API Key / 明文密钥。M1 仅等待真实 dogfood ≥${dogfoodRequired} 天。`
        : `> **不含** API Key / 明文密钥。关 M1 仍需：手测文档 18/18 + dogfood ≥${dogfoodRequired} 天。`,
    '',
    `- 生成时间：${at}`,
    `- Runtime：${input.connectionState}`,
    `- 当前任务：${input.hasActiveTask ? input.taskTitle?.trim() || '已打开' : '无'}`,
    `- 会话 soft：${input.sessionLevel}${input.sessionSummary ? ' · ' + input.sessionSummary : ''}`,
    `- Providers：${input.providerCount} · 模型：${input.modelCount} · 已写密钥(计数)：${input.secretCount}`,
    `- 多模型 soft 门槛：${yn(input.providersReadySoft)}`,
    `- Agent 默认模型：${yn(input.agentDefaultSet)} · Fallback 数：${input.agentFallbackCount | 0}`,
    `- Manifest 条数：${input.manifestCount ?? '—'} · 轨迹事件：${
      input.hasTraceEvents == null ? '—' : yn(Boolean(input.hasTraceEvents))
    } · 本任务消息模型种类：${input.distinctMessageModelCount ?? '—'}`,
    `- 手测对照 本机可核：${input.handtestLivePass}/${input.handtestLiveTotal} · soft 全满：${yn(
      input.handtestSoftLiveAllPass,
    )} · 外网待证项：${input.handtestExternalPending}`,
    `- 手测文档勾选：${input.handtestDocChecked}/${input.handtestDocTotal || 18}`,
    `- dogfood：有效 ${input.dogfoodRealDays}/${dogfoodRequired} 天 · 文件 ${
      input.dogfoodFileCount
    }`,
    `- 本地 dual 自动化：${yn(Boolean(input.dualAutomatedOk))}`,
    `- 退出证据 level：${input.exitLevel} · 硬门槛齐：${yn(
      Boolean(input.hardGatesMet),
    )} · 本快照不改变 M1 里程碑状态`,
    nextLine,
  ];

  if (pending.length > 0) {
    lines.push('', '## 本机/外网仍待关注（标签）');
    for (const label of pending) {
      lines.push(`- [ ] ${label}`);
    }
  }

  lines.push(
    '',
    '## 建议你接下来',
    handtestComplete
      ? `1. 外网手测 ${handtestDocChecked}/${handtestDocTotal} 已完成，无需重复验收`
      : '1. 打开手测清单，用真实外网密钥完成未勾项（密钥勿入库）',
    `2. 真实使用后写 dogfood 日记，凑满 ≥${dogfoodRequired} 天`,
    handtestComplete
      ? '3. 本快照可贴到 dogfood「自动化侧本日状态」作对照，但不能把草稿算成真实日期'
      : '3. 把本快照可贴到 dogfood「自动化侧本日状态」作对照，但不要假装已外网手测',
    '',
  );

  const markdown = lines.join('\n');
  const summary = `已复制 soft 快照 ${markdown.length} 字 · 手测文档 ${
    input.handtestDocChecked
  }/${input.handtestDocTotal || 18} · dogfood ${input.dogfoodRealDays}/${dogfoodRequired}`;

  return {
    markdown,
    summary,
    charCount: markdown.length,
    claimsM1Closed: false,
  };
}

/** True if text looks like it might contain an API key pattern (guardrail for tests/callers). */
export function softSnapshotLooksSecretFree(text: string): boolean {
  if (!text) return true;
  // sk-… / Bearer long tokens / anthropic-ish
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}
