/**
 * Dogfood day draft paste — hard-gate assist for real diary writing.
 * Soft only: never writes dogfood files, never auto-checks, never closes M1, never includes secrets.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export interface M1DogfoodDayDraftInput {
  /** YYYY-MM-DD preferred */
  date?: string;
  generatedAt?: string;
  connectionState: string;
  hasActiveTask: boolean;
  taskTitle?: string | null;
  providerCount: number;
  modelCount: number;
  secretCount: number;
  providersReadySoft: boolean;
  agentDefaultSet: boolean;
  agentFallbackCount: number;
  sessionLevel: string;
  sessionSummary?: string | null;
  handtestLivePass: number;
  handtestLiveTotal: number;
  handtestDocChecked: number;
  handtestDocTotal: number;
  handtestExternalPending: number;
  /** Optional short labels of external pending items */
  externalPendingLabels?: readonly string[];
  dogfoodRealDays: number;
  dogfoodRequired: number;
  dogfoodFileCount: number;
  dualAutomatedOk: boolean;
  hardGatesMet: boolean;
  exitLevel: string;
  nextKind?: string | null;
  nextTitle?: string | null;
  distinctMessageModelCount?: number;
  manifestCount?: number;
  hasTraceEvents?: boolean;
  /** Soft craft round number for automation note (optional). */
  softCraftRound?: number | null;
}

export interface M1DogfoodDayDraft {
  markdown: string;
  summary: string;
  charCount: number;
  date: string;
  /** Always false. */
  claimsM1Closed: false;
  /** Always false — draft is not a real filled day. */
  claimsDogfoodReal: false;
}

function yn(v: boolean): string {
  return v ? '是' : '否';
}

function todayLocalIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function clampLabels(labels: readonly string[] | undefined, max = 6): string[] {
  if (!labels || labels.length === 0) return [];
  return labels
    .slice(0, max)
    .map((s) => String(s).trim())
    .filter(Boolean);
}

/**
 * Build a paste-ready dogfood diary draft for the given day.
 * Filled fields use soft observables; "待你确认" marks still require human fill.
 * Does NOT score as a real dogfood day by itself (still has scaffold banners / 待你确认).
 */
export function formatM1DogfoodDayDraft(input: M1DogfoodDayDraftInput): M1DogfoodDayDraft {
  const date =
    input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())
      ? input.date.trim()
      : todayLocalIso();
  const at = input.generatedAt?.trim() || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const handtestDocTotal = Math.max(1, input.handtestDocTotal | 0 || 18);
  const handtestDocChecked = Math.max(0, input.handtestDocChecked | 0);
  const handtestComplete = handtestDocChecked >= handtestDocTotal;
  const external = clampLabels(input.externalPendingLabels);
  const softRound =
    input.softCraftRound != null && Number.isFinite(input.softCraftRound)
      ? String(input.softCraftRound)
      : '—';

  const lines: string[] = [
    `# Dogfood · ${date}`,
    '',
    '> 由桌面「复制 dogfood 草稿」生成 · **粘贴辅助**。',
    '> 请改「待你确认」为真实结果后保存到 `docs/development/dogfood/${date}.md`。',
    '> **不能**仅凭本草稿把该日计为有效 dogfood；**不含** API Key；本草稿不改变里程碑状态。',
    '',
    '## 今天主要干了啥',
    `- [${input.connectionState === 'online' ? 'x' : ' '}] 启动桌面端，Runtime：${input.connectionState}`,
    `- [${input.hasActiveTask ? 'x' : ' '}] 打开任务：${
      input.hasActiveTask ? input.taskTitle?.trim() || '已打开' : '未打开 · 待你确认'
    }`,
    `- [${input.providersReadySoft ? 'x' : ' '}] Providers ${input.providerCount}/2 · 模型 ${input.modelCount}/3 · 密钥计数 ${input.secretCount} · soft 多模型门槛：${yn(
      input.providersReadySoft,
    )}`,
    `- [${input.agentDefaultSet ? 'x' : ' '}] Agent 默认模型：${yn(
      input.agentDefaultSet,
    )} · Fallback 数：${input.agentFallbackCount | 0}`,
    `- [${handtestComplete || (input.distinctMessageModelCount ?? 0) >= 3 ? 'x' : ' '}] 同任务多模型消息种类：${
      input.distinctMessageModelCount ?? 0
    }（${handtestComplete ? `外网手测文档 ${handtestDocChecked}/${handtestDocTotal} 已完成` : '外网仍需 Compose 各发一轮 · 待你确认'}）`,
    `- [${input.hasTraceEvents ? 'x' : ' '}] Trace 事件：${yn(
      Boolean(input.hasTraceEvents),
    )} · Manifest 条数：${input.manifestCount ?? 0}`,
    handtestComplete
      ? `- [x] 外网手测文档：${handtestDocChecked}/${handtestDocTotal} 已完成（无需重复验收）`
      : '- [ ] 外网真实网关路径：待你确认（见手测清单）',
    '- [ ] 重启应用后对话仍在：待你确认',
    '',
    '## Provider / 模型',
    `- Provider 数（本机 soft）：${input.providerCount} · 模型数：${input.modelCount}`,
    '- Provider A 名称/协议/可达：待你确认（密钥勿写入本文）',
    '- Provider B 名称/协议/可达：待你确认',
    `- 模型切换是否丢上下文：待你确认（本任务消息模型种类 soft=${
      input.distinctMessageModelCount ?? 0
    }）`,
    '',
    '## Manifest / 权限',
    `- 是否打开 Manifest：${(input.manifestCount ?? 0) > 0 ? '本机 soft 已见条数' : '待你确认'}`,
    '- 是否看到 Skill / 工具 Schema：待你确认',
    '- 是否有审批弹出：待你确认',
    '',
    '## MCP（可选）',
    '- 刷新工具目录：待你确认 / 未测',
    '- 真工具调用：待你确认 / 未测',
    '- 备注：',
    '',
    '## 重启恢复',
    '- 重启后对话是否还在：待你确认',
    '- 是否重复副作用：待你确认',
    '',
    '## 阻塞（必须修才继续）',
    '- ',
    '',
    '## 摩擦（可稍后）',
    '- ',
    '',
    '## 一句话结论',
    '- 今天是否愿意继续当主力工具：待你确认 · 原因：',
    '',
    '## 自动化 / soft 对照（粘贴生成 · 非退出证据）',
    `- 生成时间：${at}`,
    `- 会话 soft：${input.sessionLevel}${input.sessionSummary ? ' · ' + input.sessionSummary : ''}`,
    `- 手测对照 本机 ${input.handtestLivePass}/${input.handtestLiveTotal} · 文档 ${input.handtestDocChecked}/${
      input.handtestDocTotal || 18
    } · 外网待证 ${input.handtestExternalPending}`,
    `- dogfood 当前有效 ${input.dogfoodRealDays}/${dogfoodRequired} · 文件 ${input.dogfoodFileCount}`,
    `- 本地 dual 自动化：${yn(Boolean(input.dualAutomatedOk))}`,
    `- 退出证据 level：${input.exitLevel} · 硬门槛齐：${yn(Boolean(input.hardGatesMet))}`,
    `- 下一步提示：${input.nextTitle || '—'}（${input.nextKind || '—'})`,
    `- soft craft 轮次备注：${softRound}`,
    '- 外网手测清单：docs/development/14-external-gateway-handtest.md',
    '- **M2 已完成 · 本草稿不替代真实 dogfood，也不自动写盘或改变 M1 状态**',
  ];

  if (external.length > 0) {
    lines.push('', '## 外网待证项（soft 标签 · 请人手勾文档）');
    for (const label of external) {
      lines.push(`- [ ] ${label}`);
    }
  }

  lines.push('');

  const markdown = lines.join('\n');
  const summary = `已复制 dogfood 草稿 ${date} · ${markdown.length} 字 · 有效日仍 ${input.dogfoodRealDays}/${dogfoodRequired}（非自动写盘）`;

  return {
    markdown,
    summary,
    charCount: markdown.length,
    date,
    claimsM1Closed: false,
    claimsDogfoodReal: false,
  };
}

export function dogfoodDraftLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}
