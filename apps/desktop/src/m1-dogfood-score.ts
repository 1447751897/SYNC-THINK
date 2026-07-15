/**
 * Pure dogfood diary scoring — shared by main loader and renderer board.
 * Soft only: never closes M1. Must refuse paste-assist drafts as "real".
 */
export type DogfoodDayKind = 'real' | 'scaffold';

export interface DogfoodScoreResult {
  isScaffold: boolean;
  filledSignals: number;
  pendingCount: number;
  checkedCount: number;
  totalBoxes: number;
  /** True when markdown looks like auto-generated paste assist. */
  isPasteAssist: boolean;
  /** Short Chinese reasons for UI (scaffold side or real-enough side). */
  reasons: string[];
  /** One-line status for day board. */
  statusHint: string;
}

/** Count `- [x]` / `- [ ]` style task boxes in markdown. */
export function countMarkdownTaskBoxes(md: string): {
  checked: number;
  total: number;
} {
  const lines = md.split(/\r?\n/);
  let checked = 0;
  let total = 0;
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+/);
    if (!m) continue;
    total += 1;
    if (m[1] === 'x' || m[1] === 'X') checked += 1;
  }
  return { checked, total };
}

/** Count human-pending placeholders (待填 / 待你确认 / 待确认). */
export function countDogfoodPendingMarkers(text: string): number {
  if (!text) return 0;
  // Each occurrence counts once; cover draft paste wording.
  const a = text.match(/待填/g) ?? [];
  const b = text.match(/待你确认/g) ?? [];
  // Avoid double-count: strip 待你确认 before counting bare 待确认.
  const withoutNi = text.replace(/待你确认/g, '');
  const c2 = withoutNi.match(/待确认/g) ?? [];
  return a.length + b.length + c2.length;
}

export function looksLikeDogfoodPasteAssist(text: string): boolean {
  if (!text) return false;
  if (/复制 dogfood 草稿|粘贴辅助|formatM1DogfoodDayDraft|claimsDogfoodReal/i.test(text)) {
    return true;
  }
  if (/不能\*?仅凭本草稿|本草稿不自动写盘|由桌面「复制 dogfood 草稿」/.test(text)) {
    return true;
  }
  if (/soft craft 轮次备注|自动化 \/ soft 对照（粘贴生成/.test(text)) {
    return true;
  }
  // High density of 待你确认 without human fill is paste-assist shaped.
  const confirm = (text.match(/待你确认/g) ?? []).length;
  if (confirm >= 4 && /M1 仍 open/.test(text)) return true;
  return false;
}

/**
 * Heuristic score: scaffold / paste-assist must NOT count as real dogfood day.
 * Real day: few pending markers, some concrete filled signals, not paste-assist banner.
 */
export function scoreDogfoodDiary(md: string): DogfoodScoreResult {
  const text = md ?? '';
  const explicitlyNotCounted =
    /尚未计入\s*(?:dogfood\s*)?(?:3\s*天)?门槛|(?:本日|当天)(?:暂时?|仍)?不计入\s*dogfood\s*天数/i.test(
      text,
    );
  const pendingCount = countDogfoodPendingMarkers(text);
  const boxes = countMarkdownTaskBoxes(text);
  const checkedCount = boxes.checked;
  const totalBoxes = boxes.total;
  const isPasteAssist = looksLikeDogfoodPasteAssist(text);
  const hasScaffoldBanner =
    /脚手架|待你填写|不等于.*已完成 dogfood|待填/.test(text) ||
    isPasteAssist ||
    pendingCount >= 3;

  const hasConcreteSignal =
    /\b(是|否|成功|失败|已连接|openai|anthropic|已打开)\b/i.test(text) ||
    checkedCount >= 2;

  const filledSignals =
    checkedCount +
    (hasConcreteSignal ? 1 : 0) +
    (pendingCount === 0 ? 2 : pendingCount <= 2 ? 1 : 0) -
    (isPasteAssist ? 3 : 0);

  const reasons: string[] = [];
  if (explicitlyNotCounted) reasons.push('明确未计入');
  if (isPasteAssist) reasons.push('粘贴草稿特征');
  if (/脚手架|待你填写|不等于.*已完成 dogfood/.test(text)) {
    reasons.push('脚手架横幅');
  }
  if (pendingCount >= 3) reasons.push(`待确认 ${pendingCount}`);
  else if (pendingCount > 0) reasons.push(`待确认 ${pendingCount}`);
  if (checkedCount > 0) reasons.push(`勾选 ${checkedCount}/${totalBoxes || checkedCount}`);

  // Scaffold rules (any true → not real)
  let isScaffold = explicitlyNotCounted;
  if (!isScaffold && isPasteAssist) {
    isScaffold = true;
    reasons.push('不计有效日');
  } else if (!isScaffold && hasScaffoldBanner && pendingCount >= 3) {
    isScaffold = true;
  } else if (!isScaffold && pendingCount >= 6 && checkedCount === 0) {
    isScaffold = true;
  } else if (!isScaffold && pendingCount >= 4 && filledSignals < 4) {
    // Human half-filled but still mostly placeholders
    isScaffold = true;
    reasons.push('填充不足');
  } else if (
    !isScaffold &&
    pendingCount >= 3 &&
    checkedCount < 2 &&
    !hasConcreteSignal
  ) {
    isScaffold = true;
  }

  // Real needs: not scaffold path, limited pending, some substance
  if (!isScaffold) {
    if (pendingCount >= 3) {
      isScaffold = true;
      reasons.push('待确认过多');
    } else if (filledSignals <= 0 && checkedCount === 0) {
      isScaffold = true;
      reasons.push('无实质填写');
    }
  }

  if (!isScaffold && reasons.length === 0) {
    reasons.push('有效日记信号');
  }

  const statusHint = isScaffold
    ? isPasteAssist
      ? `草稿 · 待改 ${pendingCount}`
      : pendingCount > 0
        ? `脚手架 · 待 ${pendingCount}`
        : '脚手架'
    : pendingCount > 0
      ? `有效 · 勾 ${checkedCount} · 待 ${pendingCount}`
      : `有效 · 勾 ${checkedCount}`;

  return {
    isScaffold,
    filledSignals: Math.max(0, filledSignals),
    pendingCount,
    checkedCount,
    totalBoxes,
    isPasteAssist,
    reasons: reasons.slice(0, 4),
    statusHint,
  };
}
