/**
 * Doc vs live handtest mismatch board (hard-gate observability assist).
 * Pure projection only: never writes the handtest doc, never closes M1.
 *
 * Use case: user may have live green chips but forgot to tick 14-…handtest.md,
 * or ticked doc boxes without the live state matching - surface the gap.
 *
 * #53: each attention row resolves a CTA (open handtest / jump panel).
 */

import type { M1HandtestStatus, M1HandtestGate } from './m1-handtest-checklist.js';
import { resolveM1HandtestItemJump, isM1HandtestItemJumpable } from './m1-handtest-checklist.js';
import type { M1SessionJumpTarget } from './m1-session-readiness.js';
import { M1_DOGFOOD_REQUIRED_DAYS } from './m1-dogfood-policy.js';

export type M1HandtestDocDiffKind =
  'aligned-pass' | 'aligned-pending' | 'live-ahead' | 'doc-ahead' | 'external-gap' | 'unknown';

/** Soft CTA for attention rows - never auto-checks, never closes M1. */
export type M1HandtestDocDiffCtaKind =
  'open-handtest' | 'jump-panel' | 'open-handtest-and-jump' | 'none';

export interface M1HandtestDocDiffItemInput {
  id: string;
  label: string;
  section: string;
  status: M1HandtestStatus;
  gate: M1HandtestGate;
  /** From parse map: true/false when mapped, null when doc missing. */
  docChecked: boolean | null;
}

export interface M1HandtestDocDiffRow {
  id: string;
  label: string;
  section: string;
  gate: M1HandtestGate;
  liveStatus: M1HandtestStatus;
  docChecked: boolean | null;
  kind: M1HandtestDocDiffKind;
  /** Short Chinese action hint. */
  hint: string;
  /** #53 soft CTA */
  ctaKind: M1HandtestDocDiffCtaKind;
  ctaLabel: string;
  jumpTarget: M1SessionJumpTarget;
  jumpable: boolean;
}

export interface M1HandtestDocDiffBoard {
  rows: M1HandtestDocDiffRow[];
  total: number;
  alignedPass: number;
  alignedPending: number;
  liveAhead: number;
  docAhead: number;
  externalGap: number;
  unknown: number;
  /** empty | quiet | attention | critical - UI strip level */
  level: 'empty' | 'quiet' | 'attention' | 'critical';
  summary: string;
  /** Always false - mismatch board is not M1 close evidence. */
  claimsM1Closed: false;
  /** #53: preferred bulk CTA when live-ahead > 0 */
  primaryCta: {
    kind: M1HandtestDocDiffCtaKind;
    label: string;
    liveAhead: number;
  };
}

function resolveRowCta(
  kind: M1HandtestDocDiffKind,
  itemId: string,
): {
  ctaKind: M1HandtestDocDiffCtaKind;
  ctaLabel: string;
  jumpTarget: M1SessionJumpTarget;
  jumpable: boolean;
} {
  const jump = resolveM1HandtestItemJump(itemId);
  const jumpable = isM1HandtestItemJumpable(jump.target);

  if (kind === 'live-ahead') {
    return {
      ctaKind: jumpable ? 'open-handtest-and-jump' : 'open-handtest',
      ctaLabel: jumpable ? '打开文档并跳转' : '打开手测文档',
      jumpTarget: jump.target,
      jumpable,
    };
  }
  if (kind === 'doc-ahead') {
    return {
      ctaKind: jumpable ? 'jump-panel' : 'open-handtest',
      ctaLabel: jumpable ? '跳转复核本机' : '打开手测文档',
      jumpTarget: jump.target,
      jumpable,
    };
  }
  if (kind === 'external-gap') {
    return {
      ctaKind: jumpable ? 'open-handtest-and-jump' : 'open-handtest',
      ctaLabel: jumpable ? '打开文档并跳转' : '打开手测文档',
      jumpTarget: jump.target,
      jumpable,
    };
  }
  if (kind === 'unknown') {
    return {
      ctaKind: 'open-handtest',
      ctaLabel: '打开手测文档',
      jumpTarget: jump.target,
      jumpable,
    };
  }
  return {
    ctaKind: 'none',
    ctaLabel: '',
    jumpTarget: jump.target,
    jumpable,
  };
}

function classify(item: M1HandtestDocDiffItemInput): M1HandtestDocDiffRow {
  const doc = item.docChecked;
  const livePass = item.status === 'pass';
  const liveFail = item.status === 'fail';

  let kind: M1HandtestDocDiffKind;
  let hint: string;

  if (doc === null) {
    kind = 'unknown';
    hint = '文档未映射到本项 · 检查 14-…handtest 是否可读';
  } else if (item.gate === 'external' && !livePass && !doc) {
    kind = 'external-gap';
    hint = '需外网真实路径 · 本机 soft 不能代勾';
  } else if (livePass && doc) {
    kind = 'aligned-pass';
    hint = '本机与文档一致（已勾）';
  } else if (!livePass && !doc && !liveFail) {
    if (item.gate === 'external') {
      kind = 'external-gap';
      hint = '外网待证 · 完成后请勾文档';
    } else {
      kind = 'aligned-pending';
      hint = '本机与文档均未完成';
    }
  } else if (livePass && !doc) {
    kind = 'live-ahead';
    hint = '本机已绿 · 请在 14-…handtest.md 勾选对应项';
  } else if (!livePass && doc) {
    kind = 'doc-ahead';
    hint = '文档已勾 · 本机状态未绿（复核或刷新）';
  } else if (liveFail && !doc) {
    kind = 'aligned-pending';
    hint = '本机失败且文档未勾 · 先修本机';
  } else if (liveFail && doc) {
    kind = 'doc-ahead';
    hint = '文档已勾但本机失败 · 请复核文档是否过早勾选';
  } else {
    kind = 'aligned-pending';
    hint = '待对齐';
  }

  const cta = resolveRowCta(kind, item.id);

  return {
    id: item.id,
    label: item.label,
    section: item.section,
    gate: item.gate,
    liveStatus: item.status,
    docChecked: doc,
    kind,
    hint,
    ctaKind: cta.ctaKind,
    ctaLabel: cta.ctaLabel,
    jumpTarget: cta.jumpTarget,
    jumpable: cta.jumpable,
  };
}

/**
 * Project doc↔live mismatch board. Never claims M1 closed.
 */
export function projectM1HandtestDocDiff(
  items: readonly M1HandtestDocDiffItemInput[],
): M1HandtestDocDiffBoard {
  const list = Array.isArray(items) ? items : [];
  const rows = list.map(classify);
  let alignedPass = 0;
  let alignedPending = 0;
  let liveAhead = 0;
  let docAhead = 0;
  let externalGap = 0;
  let unknown = 0;
  for (const r of rows) {
    switch (r.kind) {
      case 'aligned-pass':
        alignedPass += 1;
        break;
      case 'aligned-pending':
        alignedPending += 1;
        break;
      case 'live-ahead':
        liveAhead += 1;
        break;
      case 'doc-ahead':
        docAhead += 1;
        break;
      case 'external-gap':
        externalGap += 1;
        break;
      default:
        unknown += 1;
    }
  }
  const total = rows.length;
  const mismatch = liveAhead + docAhead + unknown;
  let level: M1HandtestDocDiffBoard['level'] = 'empty';
  if (total === 0) level = 'empty';
  else if (mismatch === 0 && externalGap === 0) level = 'quiet';
  else if (liveAhead > 0 || docAhead > 0) level = 'attention';
  else if (externalGap > 0) level = 'attention';
  else level = 'quiet';
  if (docAhead >= 3 || (liveAhead >= 5 && docAhead >= 1)) level = 'critical';

  const summaryParts = [
    '文档↔本机 ' + total + ' 项',
    '对齐已勾 ' + alignedPass,
    '本机领先待勾 ' + liveAhead,
    '文档领先 ' + docAhead,
    '外网待证 ' + externalGap,
  ];
  if (unknown > 0) summaryParts.push('未映射 ' + unknown);

  const primaryCta =
    liveAhead > 0
      ? {
          kind: 'open-handtest' as const,
          label: '勾本机领先 · 打开手测文档',
          liveAhead,
        }
      : docAhead > 0
        ? {
            kind: 'open-handtest' as const,
            label: '复核文档领先 · 打开手测文档',
            liveAhead: 0,
          }
        : externalGap > 0
          ? {
              kind: 'open-handtest' as const,
              label: '外网待证 · 打开手测文档',
              liveAhead: 0,
            }
          : {
              kind: 'none' as const,
              label: '',
              liveAhead: 0,
            };

  return {
    rows,
    total,
    alignedPass,
    alignedPending,
    liveAhead,
    docAhead,
    externalGap,
    unknown,
    level,
    summary: summaryParts.join(' · '),
    claimsM1Closed: false,
    primaryCta,
  };
}

/** Rows that need user attention (not quiet aligned). */
export function listM1HandtestDocDiffAttention(
  board: M1HandtestDocDiffBoard,
): M1HandtestDocDiffRow[] {
  return board.rows.filter(
    (r) =>
      r.kind === 'live-ahead' ||
      r.kind === 'doc-ahead' ||
      r.kind === 'unknown' ||
      r.kind === 'external-gap',
  );
}

/** Filter attention by kind chip. */
export type M1HandtestDocDiffAttentionFilter = 'all' | 'live-ahead' | 'doc-ahead' | 'external-gap';

export function filterM1HandtestDocDiffAttention(
  rows: readonly M1HandtestDocDiffRow[],
  mode: M1HandtestDocDiffAttentionFilter,
): M1HandtestDocDiffRow[] {
  const list = Array.isArray(rows) ? [...rows] : [];
  if (mode === 'all') return list;
  return list.filter((r) => r.kind === mode);
}

export function isM1HandtestDocDiffCtaActionable(kind: M1HandtestDocDiffCtaKind): boolean {
  return kind !== 'none';
}

/**
 * Pure: whether CTA should open handtest markdown and/or jump panel.
 */
export function planM1HandtestDocDiffCta(kind: M1HandtestDocDiffCtaKind): {
  openHandtest: boolean;
  jumpPanel: boolean;
} {
  switch (kind) {
    case 'open-handtest':
      return { openHandtest: true, jumpPanel: false };
    case 'jump-panel':
      return { openHandtest: false, jumpPanel: true };
    case 'open-handtest-and-jump':
      return { openHandtest: true, jumpPanel: true };
    default:
      return { openHandtest: false, jumpPanel: false };
  }
}

/** Paste block for evidence / dogfood notes (secret-free). */
export function formatM1HandtestDocDiffPaste(board: M1HandtestDocDiffBoard): string {
  const lines = [
    '## 文档↔本机差异（soft · 不关 M1）',
    '',
    '- ' + board.summary,
    '- level: ' + board.level,
    '- claimsM1Closed: false',
    '',
  ];
  const attn = listM1HandtestDocDiffAttention(board);
  const allRowsDocumented =
    board.rows.length > 0 && board.rows.every((row) => row.docChecked === true);
  if (attn.length === 0) {
    lines.push(
      allRowsDocumented
        ? '- 无待办差异（文档与本机已对齐）'
        : '- 无待办差异（对齐结果仍须人手确认）',
    );
  } else {
    lines.push('### 待关注');
    for (const r of attn) {
      const doc = r.docChecked === null ? '-' : r.docChecked ? '文档✓' : '文档□';
      lines.push(
        '- [' +
          r.kind +
          '] ' +
          r.id +
          ' · ' +
          r.label +
          ' · live=' +
          r.liveStatus +
          ' · ' +
          doc +
          ' · CTA=' +
          (r.ctaLabel || '-') +
          ' · ' +
          r.hint,
      );
    }
  }
  if (board.primaryCta && board.primaryCta.kind !== 'none') {
    lines.push('');
    lines.push('- 主行动：' + board.primaryCta.label);
  }
  lines.push('');
  lines.push(
    allRowsDocumented
      ? `> 外网手测文档已对齐；dogfood 门槛为 ≥${M1_DOGFOOD_REQUIRED_DAYS} 天，M1 状态见验证区。`
      : `> 本机 soft 不能替代外网手测勾选与 dogfood ≥${M1_DOGFOOD_REQUIRED_DAYS} 天。`,
  );
  return lines.join('\n');
}

export function handtestDocDiffLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_.-]{20,}/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{12,}/i.test(text)) return false;
  return true;
}
