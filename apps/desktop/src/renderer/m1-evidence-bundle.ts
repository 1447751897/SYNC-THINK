/**
 * M1 evidence pack (one-click export) — soft assist only.
 * Composes soft snapshot + handtest paste + regression matrix + next action
 * (+ optional dogfood draft) into one markdown clipboard payload.
 *
 * Never auto-checks handtest, never writes dogfood, never closes M1,
 * never includes secrets.
 */
import { resolveM1DogfoodRequiredDays } from './m1-dogfood-policy.js';

export interface M1EvidenceBundleInput {
  generatedAt?: string;
  softCraftRound?: number | null;
  /** Pre-formatted sections from existing soft helpers (caller responsibility). */
  softSnapshotMarkdown: string;
  handtestPasteMarkdown: string;
  softRegressionMarkdown: string;
  /** Optional dogfood day draft body. */
  dogfoodDraftMarkdown?: string | null;
  /** Optional ordered exit path paste body (#48). */
  exitPathMarkdown?: string | null;
  /** Optional doc↔live mismatch paste body (#51/#52). */
  docDiffMarkdown?: string | null;
  /** Optional multi-day dogfood fill board paste (#54/#55). */
  dogfoodFillMarkdown?: string | null;
  /** Optional external focus run sheet paste (#58/#59). */
  externalFocusMarkdown?: string | null;
  nextKind?: string | null;
  nextTitle?: string | null;
  nextBody?: string | null;
  nextCtaLabel?: string | null;
  nextCtaAction?: string | null;
  handtestDocChecked: number;
  handtestDocTotal: number;
  dogfoodRealDays: number;
  dogfoodRequired?: number;
  exitLevel: string;
  hardGatesMet: boolean;
  dualAutomatedOk: boolean;
  externalGaps?: number;
  handGaps?: number;
  autoPass?: number;
  autoTotal?: number;
  connectionState?: string | null;
  sessionLevel?: string | null;
}

export interface M1EvidenceBundle {
  markdown: string;
  summary: string;
  charCount: number;
  /** How many major sections were included. */
  sectionCount: number;
  included: {
    softSnapshot: boolean;
    handtestPaste: boolean;
    softRegression: boolean;
    dogfoodDraft: boolean;
    exitPath: boolean;
    docDiff: boolean;
    dogfoodFill: boolean;
    externalFocus: boolean;
    nextAction: boolean;
  };
  /** Always false — pack is assist only. */
  claimsM1Closed: false;
  claimsDocChecked: false;
  claimsDogfoodReal: false;
}

export interface M1EvidenceBundleSectionMeta {
  id:
    | 'cover'
    | 'next'
    | 'exit-path'
    | 'doc-diff'
    | 'dogfood-fill'
    | 'external-focus'
    | 'soft-snapshot'
    | 'handtest-paste'
    | 'soft-regression'
    | 'dogfood-draft'
    | 'footer';
  title: string;
  required: boolean;
}

/** Fixed pack table of contents for UI observability. */
export const M1_EVIDENCE_BUNDLE_SECTIONS: readonly M1EvidenceBundleSectionMeta[] = [
  { id: 'cover', title: '封面与硬门槛提醒', required: true },
  { id: 'next', title: '下一步', required: true },
  { id: 'exit-path', title: '退出路径', required: false },
  { id: 'doc-diff', title: '文档↔本机差异', required: false },
  { id: 'dogfood-fill', title: 'dogfood 多日补填', required: false },
  { id: 'external-focus', title: '外网聚焦运行单', required: false },
  { id: 'soft-snapshot', title: 'soft 快照', required: true },
  { id: 'handtest-paste', title: '手测进度粘贴稿', required: true },
  { id: 'soft-regression', title: 'soft 回归矩阵', required: true },
  { id: 'dogfood-draft', title: 'dogfood 日记草稿', required: false },
  { id: 'footer', title: '边界与当前状态', required: true },
] as const;

function yn(v: boolean): string {
  return v ? '是' : '否';
}

function stripOuterHeading(md: string): string {
  const text = String(md || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) return '';
  // Drop a single leading H1 so the pack can re-title sections.
  const lines = text.split('\n');
  if (lines[0] && lines[0].startsWith('#')) {
    lines.shift();
    while (lines[0] === '') lines.shift();
  }
  return lines.join('\n').trim();
}

function nonEmpty(md: string | null | undefined): boolean {
  return Boolean(md && String(md).trim().length > 0);
}

/**
 * Pure: assemble one paste-ready evidence pack markdown.
 * Callers must pass already secret-free section bodies.
 */
export function formatM1EvidenceBundle(input: M1EvidenceBundleInput): M1EvidenceBundle {
  const at = input.generatedAt?.trim() || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const docTotal = Math.max(0, input.handtestDocTotal | 0 || 18);
  const docChecked = Math.max(0, input.handtestDocChecked | 0);
  const softRound =
    input.softCraftRound != null && Number.isFinite(input.softCraftRound)
      ? String(input.softCraftRound)
      : '—';

  const snap = stripOuterHeading(input.softSnapshotMarkdown);
  const paste = stripOuterHeading(input.handtestPasteMarkdown);
  const matrix = stripOuterHeading(input.softRegressionMarkdown);
  const draftRaw = input.dogfoodDraftMarkdown ? stripOuterHeading(input.dogfoodDraftMarkdown) : '';
  const pathRaw = input.exitPathMarkdown ? stripOuterHeading(input.exitPathMarkdown) : '';
  const docDiffRaw = input.docDiffMarkdown ? stripOuterHeading(input.docDiffMarkdown) : '';
  const fillRaw = input.dogfoodFillMarkdown ? stripOuterHeading(input.dogfoodFillMarkdown) : '';
  const extFocusRaw = input.externalFocusMarkdown
    ? stripOuterHeading(input.externalFocusMarkdown)
    : '';
  const hasDraft = nonEmpty(draftRaw);
  const hasPath = nonEmpty(pathRaw);
  const hasDocDiff = nonEmpty(docDiffRaw);
  const hasFill = nonEmpty(fillRaw);
  const hasExtFocus = nonEmpty(extFocusRaw);
  const hasNext = Boolean(
    (input.nextTitle && input.nextTitle.trim()) || (input.nextKind && input.nextKind.trim()),
  );

  const included = {
    softSnapshot: nonEmpty(snap),
    handtestPaste: nonEmpty(paste),
    softRegression: nonEmpty(matrix),
    dogfoodDraft: hasDraft,
    exitPath: hasPath,
    docDiff: hasDocDiff,
    dogfoodFill: hasFill,
    externalFocus: hasExtFocus,
    nextAction: hasNext,
  };

  const cover: string[] = [
    '# SYNC-THINK M1 证据包（一键导出 · soft 粘贴辅助 · 非退出证据）',
    '',
    '> 本包把 soft 快照 / 手测进度 / 回归矩阵' +
      (hasDraft ? ' / dogfood 草稿' : '') +
      '合在一起，方便你粘到外网手测备注或 dogfood。',
    '> **不能**替代 `14-external-gateway-handtest.md` 勾选，也**不能**把 dogfood 草稿算成有效日。',
    '> **不含** API Key / Bearer / 明文密钥。本包只导出证据，不改变 M1 状态。',
    '',
    '## 封面',
    '- 生成时间：' + at,
    '- soft craft 轮次：' + softRound,
    '- Runtime：' + (input.connectionState?.trim() || '—'),
    '- 会话 soft：' + (input.sessionLevel?.trim() || '—'),
    '- 手测文档勾选：' + docChecked + '/' + docTotal,
    '- dogfood 有效日：' + (input.dogfoodRealDays | 0) + '/' + dogfoodRequired,
    '- 本地 dual 自动化：' + yn(Boolean(input.dualAutomatedOk)),
    '- 退出证据 level：' + input.exitLevel + ' · 硬门槛齐：' + yn(Boolean(input.hardGatesMet)),
  ];

  if (
    input.autoPass != null ||
    input.autoTotal != null ||
    input.handGaps != null ||
    input.externalGaps != null
  ) {
    cover.push(
      '- 回归矩阵统计：auto 绿 ' +
        (input.autoPass ?? '—') +
        '/' +
        (input.autoTotal ?? '—') +
        ' · 手测/外网缺口行 ' +
        (input.handGaps ?? '—') +
        ' · 外网行 ' +
        (input.externalGaps ?? '—'),
    );
  }

  cover.push(
    '',
    '### 本包包含',
    '- [x] soft 快照' + (included.softSnapshot ? '' : '（空）'),
    '- [x] 手测进度粘贴稿' + (included.handtestPaste ? '' : '（空）'),
    '- [x] soft 回归矩阵' + (included.softRegression ? '' : '（空）'),
    '- [' + (hasDraft ? 'x' : ' ') + '] dogfood 日记草稿' + (hasDraft ? '' : '（本轮未附）'),
    '- [' + (hasPath ? 'x' : ' ') + '] 退出路径' + (hasPath ? '' : '（本轮未附）'),
    '- [' + (hasDocDiff ? 'x' : ' ') + '] 文档↔本机差异' + (hasDocDiff ? '' : '（本轮未附）'),
    '- [' + (hasFill ? 'x' : ' ') + '] dogfood 多日补填' + (hasFill ? '' : '（本轮未附）'),
    '- [' + (hasExtFocus ? 'x' : ' ') + '] 外网聚焦运行单' + (hasExtFocus ? '' : '（本轮未附）'),
    '- [x] 下一步提示',
    '',
  );

  const nextLines: string[] = ['## 下一步（soft 主 CTA · 不自动执行）', ''];
  if (hasNext) {
    nextLines.push(
      '- 标题：' + (input.nextTitle?.trim() || '—'),
      '- kind：' + (input.nextKind?.trim() || '—'),
    );
    if (input.nextCtaLabel?.trim()) {
      nextLines.push('- CTA：' + input.nextCtaLabel.trim());
    }
    if (input.nextCtaAction?.trim()) {
      nextLines.push('- ctaAction：' + input.nextCtaAction.trim());
    }
    if (input.nextBody?.trim()) {
      nextLines.push('- 说明：' + input.nextBody.trim());
    }
  } else {
    nextLines.push('- （无下一步投影 · 刷新退出证据后再导出）');
  }
  nextLines.push('');

  const pathLines: string[] = [];
  if (hasPath) {
    pathLines.push(
      '## 退出路径（有序硬门槛 · 进度封顶 99% · 不关 M1）',
      '',
      pathRaw,
      '',
      '---',
      '',
    );
  }

  const docDiffLines: string[] = [];
  if (hasDocDiff) {
    docDiffLines.push(
      '## 文档↔本机差异（soft · 不关 M1 · 不自动勾）',
      '',
      docDiffRaw,
      '',
      '---',
      '',
    );
  }

  const fillLines: string[] = [];
  if (hasFill) {
    fillLines.push(
      '## dogfood 多日补填（soft · 草稿不计有效日 · 不关 M1）',
      '',
      fillRaw,
      '',
      '---',
      '',
    );
  }

  const extFocusLines: string[] = [];
  if (hasExtFocus) {
    extFocusLines.push(
      '## 外网聚焦运行单（soft · 下一外网项 · 不自动勾 · 不关 M1）',
      '',
      extFocusRaw,
      '',
      '---',
      '',
    );
  }

  const body: string[] = [
    ...cover,
    ...nextLines,
    ...pathLines,
    ...docDiffLines,
    ...fillLines,
    ...extFocusLines,
    '## soft 快照',
    '',
    snap || '_（空）_',
    '',
    '---',
    '',
    '## 手测进度粘贴稿',
    '',
    paste || '_（空）_',
    '',
    '---',
    '',
    '## soft 回归矩阵',
    '',
    matrix || '_（空）_',
    '',
  ];

  if (hasDraft) {
    body.push('---', '', '## dogfood 日记草稿（非自动写盘 · 不计有效日）', '', draftRaw, '');
  }

  body.push(
    '---',
    '',
    '## 边界与当前状态',
    '- 本包 claimsM1Closed=false · 不自动勾手测 · 不写 dogfood 盘',
    Boolean(input.hardGatesMet)
      ? `- 手测文档 ${docChecked}/${docTotal} 与 dogfood ${input.dogfoodRealDays | 0}/${dogfoodRequired} 已满足；M1 状态以验证区为准`
      : docChecked >= docTotal && docTotal > 0
        ? `- 手测文档 ${docChecked}/${docTotal} 已完成；仍需 dogfood 真实日记 ≥${dogfoodRequired} 天`
        : `- 关 M1 仍需：手测文档 ${docChecked}/${docTotal} + dogfood 真实日记 ≥${dogfoodRequired} 天 + 人工决策`,
    '- **M2 已完成**；不替代 M1 的真实 dogfood 日期门槛',
    '- 密钥勿粘贴进本包或仓库',
    '',
  );

  const markdown = body.join('\n');
  // cover, next, snapshot, paste, regression, footer (+ optional path + draft)
  let sectionCount = 6;
  if (hasPath) sectionCount += 1;
  if (hasDocDiff) sectionCount += 1;
  if (hasFill) sectionCount += 1;
  if (hasExtFocus) sectionCount += 1;
  if (hasDraft) sectionCount += 1;

  const summary =
    '已复制 M1 证据包 ' +
    markdown.length +
    ' 字 · 手测 ' +
    docChecked +
    '/' +
    docTotal +
    ' · dogfood ' +
    (input.dogfoodRealDays | 0) +
    '/' +
    dogfoodRequired +
    ' · ' +
    (hasDraft ? '含草稿' : '无草稿') +
    ' · ' +
    (hasPath ? '含路径' : '无路径') +
    ' · ' +
    (hasDocDiff ? '含差异' : '无差异') +
    ' · ' +
    (hasFill ? '含补填' : '无补填') +
    ' · ' +
    (hasExtFocus ? '含外网聚焦' : '无外网聚焦') +
    ' · 仍不关 M1';

  return {
    markdown,
    summary,
    charCount: markdown.length,
    sectionCount,
    included,
    claimsM1Closed: false,
    claimsDocChecked: false,
    claimsDogfoodReal: false,
  };
}

/** True if text looks free of common API key patterns. */
export function evidenceBundleLooksSecretFree(text: string): boolean {
  if (!text) return true;
  if (/\bsk-[A-Za-z0-9_\-]{16,}\b/.test(text)) return false;
  if (/\bBearer\s+[A-Za-z0-9_\-\.]{20,}\b/i.test(text)) return false;
  if (/api[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{12,}/i.test(text)) return false;
  return true;
}

/**
 * UI-facing short lines for the pack card (observability).
 */
export function projectM1EvidenceBundlePreview(
  input: Pick<
    M1EvidenceBundleInput,
    | 'handtestDocChecked'
    | 'handtestDocTotal'
    | 'dogfoodRealDays'
    | 'dogfoodRequired'
    | 'hardGatesMet'
    | 'exitLevel'
    | 'externalGaps'
    | 'handGaps'
    | 'autoPass'
    | 'autoTotal'
  > & {
    hasDogfoodDraft?: boolean;
    hasExitPath?: boolean;
    hasDocDiff?: boolean;
    hasDogfoodFill?: boolean;
    hasExternalFocus?: boolean;
  },
): {
  headline: string;
  detail: string;
  level: 'gap' | 'soft' | 'ready-discuss';
} {
  const dogfoodRequired = resolveM1DogfoodRequiredDays(input.dogfoodRequired);
  const docTotal = Math.max(0, input.handtestDocTotal | 0 || 18);
  const docChecked = Math.max(0, input.handtestDocChecked | 0);
  const handtestComplete = docTotal > 0 && docChecked >= docTotal;
  const dogfoodComplete = (input.dogfoodRealDays | 0) >= dogfoodRequired;
  const hard = Boolean(input.hardGatesMet) || (handtestComplete && dogfoodComplete);
  const headline = hard
    ? '硬门槛数字齐 · M1 状态见验证区'
    : handtestComplete
      ? `外网手测 ${docChecked}/${docTotal} 已完成 · dogfood ${input.dogfoodRealDays | 0}/${dogfoodRequired}`
      : dogfoodComplete
        ? 'dogfood 日期已齐 · 仍缺外网手测'
        : '一键导出 soft 证据包 · 外网手测/日记仍缺';
  const detail = [
    '手测文档 ' + docChecked + '/' + docTotal,
    'dogfood ' + (input.dogfoodRealDays | 0) + '/' + dogfoodRequired,
    input.autoPass != null ? 'auto ' + input.autoPass + '/' + (input.autoTotal ?? '—') : null,
    input.externalGaps != null ? '外网行 ' + input.externalGaps : null,
    input.hasDogfoodDraft ? '可附草稿' : '可无草稿',
    input.hasExitPath ? '含路径' : '可附路径',
    input.hasDocDiff ? '含差异' : '可附差异',
    input.hasDogfoodFill ? '含补填' : '可附补填',
    input.hasExternalFocus ? '含外网聚焦' : '可附外网聚焦',
    'exit ' + input.exitLevel,
  ]
    .filter(Boolean)
    .join(' · ');
  const level: 'gap' | 'soft' | 'ready-discuss' = hard
    ? 'ready-discuss'
    : docChecked > 0 || (input.dogfoodRealDays | 0) > 0
      ? 'soft'
      : 'gap';
  return { headline, detail, level };
}
