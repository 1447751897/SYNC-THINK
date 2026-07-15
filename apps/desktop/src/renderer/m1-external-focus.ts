/**
 * Handtest "next external item" focus strip — hard-gate assist for M1.
 * Surfaces the first pending external checklist item (canonical order) with
 * one-click open handtest / jump panel / copy run-sheet / filter-to-external.
 * Soft only: never auto-checks docs, never closes M1, never includes secrets.
 *
 * #58 soft craft.
 */

import type { M1SessionJumpTarget } from './m1-session-readiness.js';
import {
  isM1HandtestItemJumpable,
  resolveM1HandtestItemJump,
  type M1HandtestChecklistItem,
  type M1HandtestGate,
  type M1HandtestStatus,
} from './m1-handtest-checklist.js';
import type { M1HandtestSectionId } from './m1-handtest-section-board.js';
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export type M1ExternalFocusLevel = 'clear' | 'focus' | 'soft-first' | 'empty';

export type M1ExternalFocusCtaAction =
  'open-handtest' | 'jump-item' | 'copy-runsheet' | 'filter-external' | 'none';

export interface M1ExternalFocusItemInput {
  id: string;
  section: M1HandtestSectionId | string;
  label: string;
  gate: M1HandtestGate | string;
  status: M1HandtestStatus | string;
  detail?: string;
  hint?: string;
  jumpTarget?: M1SessionJumpTarget | string;
  jumpHint?: string;
}

export interface M1ExternalFocusSectionInput {
  id: M1HandtestSectionId | string;
  label: string;
  externalPending?: number;
  pass?: number;
  total?: number;
  level?: string;
  focusItemId?: string | null;
}

export interface M1ExternalFocusInput {
  items?: readonly M1ExternalFocusItemInput[] | null;
  sections?: readonly M1ExternalFocusSectionInput[] | null;
  handtestDocChecked?: number;
  handtestDocTotal?: number;
  softCraftRound?: number | null;
  dogfoodRealDays?: number;
  dogfoodRequired?: number;
}

export interface M1ExternalFocusQueuedItem {
  id: string;
  section: string;
  sectionLabel: string;
  label: string;
  detail: string;
  hint: string;
  jumpTarget: M1SessionJumpTarget;
  jumpHint: string;
  jumpable: boolean;
  orderIndex: number;
}

export interface M1ExternalFocusBoard {
  /** First external non-pass item in canonical checklist order, or null. */
  focus: M1ExternalFocusQueuedItem | null;
  /** Remaining external non-pass after focus (up to 3 for chips). */
  queue: M1ExternalFocusQueuedItem[];
  externalPending: number;
  externalTotal: number;
  externalPass: number;
  softLiveGaps: number;
  docChecked: number;
  docTotal: number;
  level: M1ExternalFocusLevel;
  summary: string;
  title: string;
  body: string;
  primaryCta: {
    action: M1ExternalFocusCtaAction;
    label: string;
  };
  secondaryCtas: Array<{
    action: M1ExternalFocusCtaAction;
    label: string;
  }>;
  /** Always false. */
  claimsM1Closed: false;
  /** Always false — never claims doc checkboxes. */
  claimsDocChecked: false;
}

const SECTION_LABEL: Record<string, string> = {
  pre: '前置',
  A: 'A · Providers',
  B: 'B · 多模型对话',
  C: 'C · 绑定/Fallback',
  D: 'D · 安全与恢复',
};

function sectionLabel(id: string): string {
  return SECTION_LABEL[id] ?? id;
}

function asJump(target: string | undefined): M1SessionJumpTarget {
  const t = String(target || 'none').trim();
  if (
    t === 'providers' ||
    t === 'agent' ||
    t === 'trace' ||
    t === 'manifest' ||
    t === 'workspaces' ||
    t === 'memory' ||
    t === 'approvals' ||
    t === 'theme' ||
    t === 'none'
  ) {
    return t as M1SessionJumpTarget;
  }
  // compose is handled in navigateToInstrument but not on M1SessionJumpTarget
  return 'none';
}

function toQueued(it: M1ExternalFocusItemInput, orderIndex: number): M1ExternalFocusQueuedItem {
  const resolved = resolveM1HandtestItemJump(it.id);
  const jumpTarget = asJump((it.jumpTarget as string | undefined) ?? resolved.target);
  const jumpHint = String(it.jumpHint || '').trim() || resolved.hint || '本项无面板跳转';
  return {
    id: it.id,
    section: String(it.section || ''),
    sectionLabel: sectionLabel(String(it.section || '')),
    label: String(it.label || it.id),
    detail: String(it.detail || '').trim() || '—',
    hint: String(it.hint || '').trim() || '按手测文档真实外网验证后勾选',
    jumpTarget,
    jumpHint,
    jumpable: isM1HandtestItemJumpable(jumpTarget),
    orderIndex,
  };
}

/**
 * Pure: project "next external handtest item" focus strip.
 * Order = checklist array order (canonical 18 items).
 */
export function projectM1ExternalFocus(input: M1ExternalFocusInput): M1ExternalFocusBoard {
  const items = Array.isArray(input.items) ? [...input.items] : [];
  const docTotal = Math.max(0, (input.handtestDocTotal ?? 0) | 0 || 18);
  const docChecked = Math.max(0, Math.min(docTotal || 999, (input.handtestDocChecked ?? 0) | 0));
  const docComplete = docTotal > 0 && docChecked >= docTotal;
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const dogfoodRealDays = Math.max(0, (input.dogfoodRealDays ?? 0) | 0);
  const dogfoodComplete = dogfoodRealDays >= dogfoodRequired;

  const externalAll = items.filter((it) => it.gate === 'external');
  const externalTotal = externalAll.length;
  const externalPass = externalAll.filter((it) => it.status === 'pass').length;
  const pendingExternal = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.gate === 'external' && it.status !== 'pass');

  const softLiveGaps = items.filter((it) => it.gate === 'live' && it.status !== 'pass').length;

  const queued = pendingExternal.map(({ it, idx }) => toQueued(it, idx));
  const focus = queued.length > 0 ? queued[0]! : null;
  const queue = queued.slice(1, 4);
  const externalPending = queued.length;

  let level: M1ExternalFocusLevel;
  if (items.length === 0) level = 'empty';
  else if (externalPending === 0 && softLiveGaps === 0) level = 'clear';
  else if (externalPending === 0 && softLiveGaps > 0) level = 'soft-first';
  else level = 'focus';

  let title: string;
  let body: string;
  let summary: string;

  if (level === 'empty') {
    title = '外网手测聚焦';
    body = '尚无手测对照项 · 刷新退出证据后重试';
    summary = '无手测项';
  } else if (level === 'clear') {
    if (docComplete) {
      title = dogfoodComplete ? 'M1 验收已完成' : '外网手测已完成';
      body = dogfoodComplete
        ? `外网手测文档 ${docChecked}/${docTotal} 与 dogfood ${dogfoodRealDays}/${dogfoodRequired} 均已满足；M1 已完成。`
        : `外网手测文档 ${docChecked}/${docTotal} 已完成；M1 等待真实 dogfood ${dogfoodRealDays}/${dogfoodRequired}，不再有外网待证项。`;
      summary = dogfoodComplete
        ? `M1 已完成 · 外网 ${docChecked}/${docTotal} · dogfood ${dogfoodRealDays}/${dogfoodRequired}`
        : `外网手测 ${docChecked}/${docTotal} 已完成 · dogfood ${dogfoodRealDays}/${dogfoodRequired}`;
    } else {
      title = '外网 soft 队列已空';
      body =
        '本机对照中外网项已无待证（' +
        externalPass +
        '/' +
        externalTotal +
        '）。文档勾选 ' +
        docChecked +
        '/' +
        docTotal +
        ` 仍须人手；关 M1 仍要文档 18/18 + dogfood ≥${dogfoodRequired} 天。`;
      summary =
        '外网对照 ' + externalPass + '/' + externalTotal + ' · 文档 ' + docChecked + '/' + docTotal;
    }
  } else if (level === 'soft-first') {
    title = '先补本机 soft · 再做外网';
    body =
      '外网队列暂无待证项，但本机 live 仍有 ' +
      softLiveGaps +
      ' 项缺口。先点手测对照补 soft，再开外网路径。';
    summary = '本机缺口 ' + softLiveGaps + ' · 外网待证 0 · 文档 ' + docChecked + '/' + docTotal;
  } else {
    // focus
    title = '下一外网项 · ' + (focus?.sectionLabel ?? '') + ' · ' + (focus?.label ?? '');
    body =
      (focus?.hint ?? '') +
      ' · ' +
      (focus?.detail ?? '') +
      ' · 仍有 ' +
      externalPending +
      ' 项外网待证 · 文档 ' +
      docChecked +
      '/' +
      docTotal +
      ' · 不自动勾选';
    summary =
      '外网待证 ' +
      externalPending +
      '/' +
      externalTotal +
      ' · 焦点 ' +
      (focus?.id ?? '—') +
      ' · 文档 ' +
      docChecked +
      '/' +
      docTotal;
  }

  // Primary CTA
  let primaryCta: M1ExternalFocusBoard['primaryCta'] = {
    action: 'none',
    label: '—',
  };
  const secondaryCtas: M1ExternalFocusBoard['secondaryCtas'] = [];

  if (level === 'focus' && focus) {
    if (focus.jumpable) {
      primaryCta = {
        action: 'jump-item',
        label: '跳到相关面板',
      };
      secondaryCtas.push({
        action: 'open-handtest',
        label: '打开手测文档',
      });
    } else {
      primaryCta = {
        action: 'open-handtest',
        label: '打开手测文档',
      };
    }
    secondaryCtas.push({
      action: 'copy-runsheet',
      label: '复制外网运行单',
    });
    secondaryCtas.push({
      action: 'filter-external',
      label: '只看外网项',
    });
  } else if (level === 'soft-first') {
    primaryCta = {
      action: 'filter-external',
      label: '看手测缺口',
    };
    secondaryCtas.push({
      action: 'open-handtest',
      label: '打开手测文档',
    });
  } else if (level === 'clear') {
    if (!docComplete) {
      primaryCta = {
        action: 'open-handtest',
        label: '打开手测文档复核',
      };
      secondaryCtas.push({
        action: 'copy-runsheet',
        label: '复制外网运行单',
      });
    }
  } else {
    primaryCta = {
      action: 'open-handtest',
      label: '打开手测文档',
    };
  }

  // Section external chips optional context in summary already covered

  return {
    focus,
    queue,
    externalPending,
    externalTotal,
    externalPass,
    softLiveGaps,
    docChecked,
    docTotal,
    level,
    summary,
    title,
    body,
    primaryCta,
    secondaryCtas,
    claimsM1Closed: false,
    claimsDocChecked: false,
  };
}

/**
 * Session-level external handtest run sheet for offline fill.
 * Soft assist only — never claims doc checked / M1 closed.
 */
export function formatM1ExternalFocusRunSheet(
  board: M1ExternalFocusBoard,
  opts?: {
    softCraftRound?: number | null;
    dualAutomatedOk?: boolean;
    dogfoodRealDays?: number;
    dogfoodRequired?: number;
  },
): {
  markdown: string;
  summary: string;
  charCount: number;
  claimsM1Closed: false;
  claimsDocChecked: false;
} {
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dogfoodRequired = resolveM1DogfoodRequiredDays(opts?.dogfoodRequired);
  const dogfoodReal = Math.max(0, (opts?.dogfoodRealDays ?? 0) | 0);
  const lines: string[] = [
    '# SYNC-THINK M1 外网手测运行单（soft · 不关 M1）',
    '',
    '> 本页是**下一外网项**聚焦导出，帮助你按序做外网手测。',
    '> **不能**替代 `14-external-gateway-handtest.md` 人手勾选；不含 API Key。',
    '> 关 M1 仍需：文档 18/18 + dogfood ≥3 真实天 + 人工决策。',
    '',
    '- 生成时间：' + at,
    '- soft craft 轮次：' + (opts?.softCraftRound != null ? String(opts.softCraftRound) : '—'),
    '- ' + board.summary,
    '- level: ' + board.level,
    '- 文档勾选（真源）：' + board.docChecked + '/' + board.docTotal,
    '- dogfood：有效 ' + dogfoodReal + '/' + dogfoodRequired + ' 天',
    '- 本地 dual：' + (opts?.dualAutomatedOk ? '是' : '否/未确认'),
    '- claimsM1Closed: false · claimsDocChecked: false',
    '',
  ];

  if (board.focus) {
    lines.push('## 当前焦点（下一外网项）');
    lines.push('- 分区：' + board.focus.sectionLabel + '（' + board.focus.section + '）');
    lines.push('- 项：' + board.focus.label + ' · id=`' + board.focus.id + '`');
    lines.push('- 状态：' + board.focus.detail);
    lines.push('- 怎么做：' + board.focus.hint);
    lines.push(
      '- 面板：' +
        board.focus.jumpTarget +
        (board.focus.jumpable ? '' : '（无跳转）') +
        ' · ' +
        board.focus.jumpHint,
    );
    lines.push('- 勾选后：在 `14-external-gateway-handtest.md` 对应行改 `[x]`（密钥勿入库）');
    lines.push('');
  } else {
    lines.push('## 当前焦点');
    lines.push('- （本机对照中无外网待证项）');
    lines.push('');
  }

  if (board.queue.length > 0) {
    lines.push('## 后续外网队列');
    for (const q of board.queue) {
      lines.push('- [' + q.section + '] ' + q.label + ' · ' + q.detail + ' · ' + q.hint);
    }
    lines.push('');
  }

  lines.push('## 建议步骤');
  lines.push('1. 打开手测文档，只勾**你真实做过**的外网路径');
  if (board.focus) {
    lines.push('2. 先完成焦点项：' + board.focus.label + '（' + board.focus.sectionLabel + '）');
  } else {
    lines.push('2. 若本机 soft 仍有缺口，先补 live 项再回头外网');
  }
  lines.push('3. 外网项做完一项勾一项；勿批量假勾');
  lines.push('4. dogfood 仍差天数时写真实日记（脚手架/草稿不计）');
  lines.push('');
  lines.push('> 本运行单只导出证据，不自动改变 M1 里程碑状态。');

  const markdown = lines.join('\n');
  const summary = board.focus
    ? '已复制外网运行单 · 焦点 ' +
      board.focus.id +
      ' · 外网待证 ' +
      board.externalPending +
      ' · 文档 ' +
      board.docChecked +
      '/' +
      board.docTotal
    : '已复制外网运行单 · 外网待证 ' +
      board.externalPending +
      ' · 文档 ' +
      board.docChecked +
      '/' +
      board.docTotal;

  return {
    markdown,
    summary,
    charCount: markdown.length,
    claimsM1Closed: false,
    claimsDocChecked: false,
  };
}

export function externalFocusLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}

/** Whether a focus CTA is actionable. */
export function isM1ExternalFocusCtaActionable(action: M1ExternalFocusCtaAction): boolean {
  return action !== 'none';
}

/**
 * Accept real checklist items from projectM1HandtestChecklist.
 * Thin adapter so UI can pass checklist.items directly.
 */
export function projectM1ExternalFocusFromChecklist(
  items: readonly M1HandtestChecklistItem[],
  opts?: {
    handtestDocChecked?: number;
    handtestDocTotal?: number;
    softCraftRound?: number | null;
    sections?: readonly M1ExternalFocusSectionInput[] | null;
    dogfoodRealDays?: number;
    dogfoodRequired?: number;
  },
): M1ExternalFocusBoard {
  return projectM1ExternalFocus({
    items,
    sections: opts?.sections,
    handtestDocChecked: opts?.handtestDocChecked,
    handtestDocTotal: opts?.handtestDocTotal,
    softCraftRound: opts?.softCraftRound,
    dogfoodRealDays: opts?.dogfoodRealDays,
    dogfoodRequired: opts?.dogfoodRequired,
  });
}
