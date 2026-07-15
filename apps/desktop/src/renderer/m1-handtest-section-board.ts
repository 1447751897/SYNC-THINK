/**
 * Handtest section progress board — soft assist for hard-gate handtest.
 * Never auto-checks docs; never closes M1.
 */
import type { M1HandtestChecklistItem } from './m1-handtest-checklist.js';

export type M1HandtestSectionId = 'pre' | 'A' | 'B' | 'C' | 'D';

export interface M1HandtestSectionBoardItem {
  id: M1HandtestSectionId;
  label: string;
  pass: number;
  total: number;
  pending: number;
  fail: number;
  externalPending: number;
  /** Aggregate: empty | partial | soft-ok | external-gap */
  level: 'empty' | 'partial' | 'soft-ok' | 'external-gap';
  detail: string;
  /** Prefer jump to first non-pass jumpable item, else providers. */
  focusItemId: string | null;
}

export interface M1HandtestSectionBoard {
  sections: M1HandtestSectionBoardItem[];
  livePass: number;
  liveTotal: number;
  externalPending: number;
  summary: string;
}

const SECTION_ORDER: readonly M1HandtestSectionId[] = [
  'pre',
  'A',
  'B',
  'C',
  'D',
] as const;

const SECTION_LABEL: Record<M1HandtestSectionId, string> = {
  pre: '前置',
  A: 'A · Providers',
  B: 'B · 多模型对话',
  C: 'C · 绑定/Fallback',
  D: 'D · 安全与恢复',
};

function sectionLevel(input: {
  pass: number;
  total: number;
  fail: number;
  externalPending: number;
}): M1HandtestSectionBoardItem['level'] {
  if (input.total === 0) return 'empty';
  if (input.pass === input.total) return 'soft-ok';
  if (input.pass === 0 && input.fail === 0 && input.externalPending > 0) {
    return 'external-gap';
  }
  if (input.pass === 0) return 'empty';
  if (input.externalPending > 0 && input.fail === 0) return 'external-gap';
  return 'partial';
}

/**
 * Pure: group handtest checklist items into section progress chips.
 */
export function projectM1HandtestSectionBoard(
  items: readonly M1HandtestChecklistItem[],
): M1HandtestSectionBoard {
  const list = Array.isArray(items) ? items : [];
  const sections: M1HandtestSectionBoardItem[] = SECTION_ORDER.map((id) => {
    const group = list.filter((it) => it.section === id);
    let pass = 0;
    let fail = 0;
    let pending = 0;
    let externalPending = 0;
    let focusItemId: string | null = null;
    for (const it of group) {
      if (it.status === 'pass') pass += 1;
      else if (it.status === 'fail') {
        fail += 1;
        if (!focusItemId) focusItemId = it.id;
      } else {
        pending += 1;
        if (it.gate === 'external') externalPending += 1;
        if (!focusItemId) focusItemId = it.id;
      }
    }
    const total = group.length;
    const level = sectionLevel({ pass, total, fail, externalPending });
    let detail: string;
    if (total === 0) detail = '无项';
    else if (pass === total) detail = '本机 soft 全满';
    else if (externalPending > 0 && fail === 0) {
      detail = `本机 ${pass}/${total} · 外网待证 ${externalPending}`;
    } else if (fail > 0) {
      detail = `未过 ${fail} · 通过 ${pass}/${total}`;
    } else {
      detail = `${pass}/${total}`;
    }
    return {
      id,
      label: SECTION_LABEL[id],
      pass,
      total,
      pending,
      fail,
      externalPending,
      level,
      detail,
      focusItemId,
    };
  });

  const livePass = list.filter(
    (it) => it.gate === 'live' && it.status === 'pass',
  ).length;
  const liveTotal = list.filter((it) => it.gate === 'live').length;
  const externalPending = list.filter(
    (it) => it.gate === 'external' && it.status !== 'pass',
  ).length;

  const softGaps = sections.filter(
    (s) => s.fail > 0 || (s.level === 'empty' && s.total > 0),
  ).length;
  const summary =
    externalPending > 0 && softGaps === 0
      ? `本机分区 soft 可 · 仍有 ${externalPending} 项外网待证`
      : softGaps > 0
        ? `${softGaps} 个分区仍有本机缺口 · 外网待证 ${externalPending}`
        : livePass === liveTotal && liveTotal > 0
          ? '各分区本机 soft 已满 · 硬门槛仍靠文档勾选'
          : '手测分区推进中';

  return {
    sections,
    livePass,
    liveTotal,
    externalPending,
    summary,
  };
}
