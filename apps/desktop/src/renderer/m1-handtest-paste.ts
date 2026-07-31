/**
 * Handtest progress paste + list filter — hard-gate assist.
 * Soft only: never auto-checks docs, never closes M1, never includes secrets.
 */
import type {
  M1HandtestChecklistItem,
  M1HandtestGate,
  M1HandtestStatus,
} from './m1-handtest-checklist.js';
import type { M1HandtestSectionBoard } from './m1-handtest-section-board.js';
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export type M1HandtestListFilter = 'all' | 'gaps' | 'external';

export interface M1HandtestPasteInput {
  generatedAt?: string;
  items: readonly M1HandtestChecklistItem[];
  sections?: M1HandtestSectionBoard['sections'];
  sectionSummary?: string | null;
  docChecked: number;
  docTotal: number;
  livePass: number;
  liveTotal: number;
  externalPending: number;
  dualAutomatedOk?: boolean;
  dogfoodRealDays?: number;
  dogfoodRequired?: number;
}

export interface M1HandtestPaste {
  markdown: string;
  summary: string;
  charCount: number;
  pendingExternalCount: number;
  gapCount: number;
  /** Always false — paste is assist only. */
  claimsM1Closed: false;
  claimsDocChecked: false;
}

const SECTION_ORDER = ['pre', 'A', 'B', 'C', 'D'] as const;
const SECTION_TITLE: Record<(typeof SECTION_ORDER)[number], string> = {
  pre: '前置',
  A: 'A. Providers 导入与发现',
  B: 'B. 同任务多模型对话',
  C: 'C. 绑定与 Fallback',
  D: 'D. 安全与恢复',
};

function statusMark(status: M1HandtestStatus, gate: M1HandtestGate): string {
  if (status === 'pass') return '[x]';
  if (gate === 'external') return '[ ]';
  if (status === 'fail') return '[ ]';
  return '[ ]';
}

function statusNote(item: M1HandtestChecklistItem): string {
  const gate = item.gate === 'external' ? '外网' : '本机 soft';
  const st = item.status === 'pass' ? '通过' : item.status === 'fail' ? '未过' : '待证';
  return `（${gate} · ${st} · ${item.detail})`;
}

/**
 * Pure: filter handtest rows for observability UI.
 * - all: everything
 * - gaps: non-pass (fail + pending)
 * - external: external gate only (whether pass or not — focus hard path)
 */
export function filterM1HandtestItems(
  items: readonly M1HandtestChecklistItem[],
  mode: M1HandtestListFilter,
): M1HandtestChecklistItem[] {
  const list = Array.isArray(items) ? [...items] : [];
  if (mode === 'all') return list;
  if (mode === 'external') return list.filter((it) => it.gate === 'external');
  // gaps
  return list.filter((it) => it.status !== 'pass');
}

export function countM1HandtestFilter(
  items: readonly M1HandtestChecklistItem[],
  mode: M1HandtestListFilter,
): number {
  return filterM1HandtestItems(items, mode).length;
}

/**
 * Build paste-ready handtest progress markdown for dogfood / handtest notes.
 * Soft pass uses [x] as "本机 soft 见通过" — NOT a claim that 14-...md is checked.
 */
export function formatM1HandtestPaste(input: M1HandtestPasteInput): M1HandtestPaste {
  const at = input.generatedAt?.trim() || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const items = Array.isArray(input.items) ? input.items : [];
  const docTotal = Math.max(0, input.docTotal | 0);
  const docChecked = Math.max(0, input.docChecked | 0);
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const dogfoodRealDays = Math.max(0, input.dogfoodRealDays ?? 0);
  const handtestComplete = docTotal > 0 && docChecked >= docTotal;
  const dogfoodComplete = dogfoodRealDays >= dogfoodRequired;

  const gapCount = items.filter((it) => it.status !== 'pass').length;
  const pendingExternalCount = items.filter(
    (it) => it.gate === 'external' && it.status !== 'pass',
  ).length;

  const lines: string[] = [
    '# SYNC-THINK M1 手测进度粘贴稿（辅助 · 非文档勾选）',
    '',
    '> 本机 soft 对照导出，**不能**替代 `14-external-gateway-handtest.md` 人手勾选。',
    handtestComplete
      ? `> 外网手测文档 ${docChecked}/${docTotal} 已完成；无需重复勾选。`
      : '> `[x]` 仅表示本机 soft 已见通过；外网项仍需你真实验证后勾文档。',
    handtestComplete
      ? `> **不含** API Key。M1 ${dogfoodComplete ? '硬门槛数字已齐，等待人工决策' : `仅等待 dogfood ${dogfoodRealDays}/${dogfoodRequired} 与人工决策`}。`
      : `> **不含** API Key。关 M1 仍需：文档 18/18 + dogfood ≥${dogfoodRequired} 天 + 人工决策。`,
    '',
    `- 生成时间：${at}`,
    `- 本机可核：${input.livePass}/${input.liveTotal} · 外网待证：${input.externalPending} · 缺口合计：${gapCount}`,
    `- 手测文档勾选（真源）：${docChecked}/${docTotal || 18}`,
    `- dogfood：有效 ${dogfoodRealDays}/${dogfoodRequired} 天`,
    `- 本地 dual 自动化：${input.dualAutomatedOk ? '是' : '否/未确认'}`,
    `- 本粘贴稿不自动改变 M1 里程碑状态`,
    '',
  ];

  if (input.sections && input.sections.length > 0) {
    lines.push('## 分区摘要');
    for (const sec of input.sections) {
      lines.push(`- ${sec.label}：${sec.pass}/${sec.total} · ${sec.detail}`);
    }
    if (input.sectionSummary) {
      lines.push(`- 总览：${input.sectionSummary}`);
    }
    lines.push('');
  }

  for (const secId of SECTION_ORDER) {
    const group = items.filter((it) => it.section === secId);
    if (group.length === 0) continue;
    lines.push(`## ${SECTION_TITLE[secId]}`);
    for (const it of group) {
      lines.push(`- ${statusMark(it.status, it.gate)} ${it.label} ${statusNote(it)}`);
    }
    lines.push('');
  }

  lines.push('## 建议你接下来（硬门槛）');
  if (handtestComplete) {
    lines.push(`1. 外网手测 ${docChecked}/${docTotal} 已完成，无需重复验收`);
    if (dogfoodComplete) {
      lines.push('2. dogfood 日期已齐；复核证据后人工决定是否关闭 M1');
    } else {
      lines.push(`2. 继续真实 dogfood，当前 ${dogfoodRealDays}/${dogfoodRequired}`);
      lines.push('3. 去掉脚手架中的「待填」，记录具体 Provider/模型结果后才算有效日');
    }
  } else {
    lines.push(
      '1. 打开手测文档，只勾**你真实做过**的外网路径（密钥勿入库）',
      '2. 本粘贴稿可贴到 dogfood「今日主要干了啥 / 自动化侧状态」作对照',
      '3. 把脚手架日记改成有效日：去掉大量「待填」，写具体 Provider/模型结果',
      `4. 凑满 dogfood ≥${dogfoodRequired} 天后再讨论关 M1`,
    );
  }
  lines.push('');

  const markdown = lines.join('\n');
  const summary = `已复制手测进度粘贴稿 · 本机 ${input.livePass}/${input.liveTotal} · 外网待证 ${pendingExternalCount} · 文档 ${docChecked}/${docTotal || 18}（非退出证据）`;

  return {
    markdown,
    summary,
    charCount: markdown.length,
    pendingExternalCount,
    gapCount,
    claimsM1Closed: false,
    claimsDocChecked: false,
  };
}

/** Heuristic secret scrub for paste safety tests. */
export function handtestPasteLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/sk-[A-Za-z0-9]{16,}/.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{12,}/i.test(text)) return false;
  if (/Bearer\s+[A-Za-z0-9_.-]{16,}/i.test(text)) return false;
  return true;
}
