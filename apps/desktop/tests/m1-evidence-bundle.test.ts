import { describe, expect, it } from 'vitest';
import {
  formatM1EvidenceBundle,
  evidenceBundleLooksSecretFree,
  projectM1EvidenceBundlePreview,
  M1_EVIDENCE_BUNDLE_SECTIONS,
} from '../src/renderer/m1-evidence-bundle.js';

const base = {
  generatedAt: '2026-07-12T12:00:00Z',
  softCraftRound: 49,
  softSnapshotMarkdown:
    '# SYNC-THINK M1 soft 快照（粘贴辅助 · 非退出证据）\n\n- Providers：2\n- 手测文档勾选：0/18\n',
  handtestPasteMarkdown: '# 手测进度粘贴稿\n\n- [ ] 外网项 A\n- [ ] 外网项 B\n',
  softRegressionMarkdown:
    '# SYNC-THINK M1 soft 回归矩阵\n\n| 项 | auto | hand |\n|---|---|---|\n| dual | pass | external |\n',
  dogfoodDraftMarkdown:
    '# Dogfood · 2026-07-12\n\n> 粘贴辅助\n\n- [ ] 外网真实网关路径：待你确认\n',
  exitPathMarkdown:
    '# SYNC-THINK M1 退出路径（soft 辅助 · 非退出证据）\n\n- 进度：12%（封顶 99）\n- claimsM1Closed=false\n',
  docDiffMarkdown:
    '# 文档↔本机差异（soft · 不关 M1）\n\n- 本机领先 1 · 文档领先 0\n- claimsM1Closed: false\n',
  dogfoodFillMarkdown:
    '# dogfood 多日补填板（soft · 不关 M1 · 草稿不计有效日）\n\n- dogfood 有效 0/3 · 仍差 3 天\n- claimsM1Closed: false · claimsDogfoodReal: false\n',
  externalFocusMarkdown: '# 外网聚焦运行单\n\n- 焦点：b-multi-model\n- 待证：4\n',
  nextKind: 'external-handtest',
  nextTitle: '下一步：外网网关 UI 手测',
  nextBody: '打开手测清单，用真实密钥完成未勾项',
  nextCtaLabel: '打开手测文档',
  nextCtaAction: 'open-handtest',
  handtestDocChecked: 0,
  handtestDocTotal: 18,
  dogfoodRealDays: 0,
  dogfoodRequired: 3,
  exitLevel: 'soft-only',
  hardGatesMet: false,
  dualAutomatedOk: true,
  externalGaps: 5,
  handGaps: 7,
  autoPass: 8,
  autoTotal: 10,
  connectionState: 'online',
  sessionLevel: 'ready',
};

describe('formatM1EvidenceBundle', () => {
  it('composes sections and never claims closed / real dogfood', () => {
    const r = formatM1EvidenceBundle(base);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.claimsDocChecked).toBe(false);
    expect(r.claimsDogfoodReal).toBe(false);
    expect(r.charCount).toBeGreaterThan(200);
    expect(r.sectionCount).toBe(11);
    expect(r.included.softSnapshot).toBe(true);
    expect(r.included.handtestPaste).toBe(true);
    expect(r.included.softRegression).toBe(true);
    expect(r.included.dogfoodDraft).toBe(true);
    expect(r.included.exitPath).toBe(true);
    expect(r.included.docDiff).toBe(true);
    expect(r.included.dogfoodFill).toBe(true);
    expect(r.included.externalFocus).toBe(true);
    expect(r.included.nextAction).toBe(true);
    expect(r.markdown).toMatch(/证据包/);
    expect(r.markdown).toMatch(/soft 快照/);
    expect(r.markdown).toMatch(/手测进度粘贴稿/);
    expect(r.markdown).toMatch(/soft 回归矩阵/);
    expect(r.markdown).toMatch(/dogfood 日记草稿/);
    expect(r.markdown).toMatch(/退出路径/);
    expect(r.markdown).toMatch(/文档↔本机差异/);
    expect(r.markdown).toMatch(/dogfood 多日补填/);
    expect(r.summary).toMatch(/含差异/);
    expect(r.summary).toMatch(/含补填/);
    expect(r.markdown).toMatch(/外网网关 UI 手测|external-handtest/);
    expect(r.markdown).toMatch(/仍 open|claimsM1Closed=false/);
    expect(r.markdown).toMatch(/M2 已完成/);
    expect(r.markdown).not.toMatch(/勿启动 M2/);
    expect(r.markdown).toMatch(/soft craft 轮次：49/);
    expect(r.markdown).toMatch(/0\/18/);
    // leading H1 of child sections stripped so pack owns titles
    expect(r.markdown).not.toMatch(/# SYNC-THINK M1 soft 快照（粘贴辅助/);
    expect(r.summary).toMatch(/已复制 M1 证据包/);
    expect(r.summary).toMatch(/仍不关 M1/);
  });

  it('works without dogfood draft', () => {
    const r = formatM1EvidenceBundle({
      ...base,
      dogfoodDraftMarkdown: null,
    });
    expect(r.included.dogfoodDraft).toBe(false);
    expect(r.included.exitPath).toBe(true);
    expect(r.included.docDiff).toBe(true);
    expect(r.included.dogfoodFill).toBe(true);
    expect(r.sectionCount).toBe(10);
    expect(r.markdown).toMatch(/本轮未附|可无草稿|无草稿|未附/);
    expect(r.markdown).not.toMatch(/## dogfood 日记草稿/);
    expect(r.markdown).toMatch(/## 退出路径/);
    expect(r.summary).toMatch(/无草稿/);
    expect(r.summary).toMatch(/含路径/);
  });

  it('works without exit path', () => {
    const r = formatM1EvidenceBundle({
      ...base,
      exitPathMarkdown: null,
    });
    expect(r.included.exitPath).toBe(false);
    expect(r.included.docDiff).toBe(true);
    expect(r.included.dogfoodFill).toBe(true);
    expect(r.sectionCount).toBe(10);
    expect(r.markdown).not.toMatch(/## 退出路径/);
    expect(r.summary).toMatch(/无路径/);
    expect(r.summary).toMatch(/含差异/);
  });

  it('works without doc diff', () => {
    const r = formatM1EvidenceBundle({
      ...base,
      docDiffMarkdown: null,
    });
    expect(r.included.docDiff).toBe(false);
    expect(r.included.dogfoodFill).toBe(true);
    expect(r.sectionCount).toBe(10);
    expect(r.markdown).not.toMatch(/## 文档↔本机差异/);
    expect(r.summary).toMatch(/无差异/);
  });

  it('works without external focus', () => {
    const r = formatM1EvidenceBundle({
      ...base,
      externalFocusMarkdown: null,
    });
    expect(r.included.externalFocus).toBe(false);
    expect(r.markdown).not.toMatch(/## 外网聚焦运行单/);
    expect(r.summary).toMatch(/无外网聚焦/);
    expect(r.claimsM1Closed).toBe(false);
  });

  it('works without dogfood fill', () => {
    const r = formatM1EvidenceBundle({
      ...base,
      dogfoodFillMarkdown: null,
    });
    expect(r.included.dogfoodFill).toBe(false);
    expect(r.sectionCount).toBe(10);
    expect(r.markdown).not.toMatch(/## dogfood 多日补填/);
    expect(r.summary).toMatch(/无补填/);
  });

  it('never claims M1 closed when hard gates look met', () => {
    const r = formatM1EvidenceBundle({
      ...base,
      handtestDocChecked: 18,
      dogfoodRealDays: 3,
      hardGatesMet: true,
      exitLevel: 'evidence-ready',
    });
    expect(r.claimsM1Closed).toBe(false);
    expect(r.claimsDogfoodReal).toBe(false);
    expect(r.markdown).toMatch(/不改变 M1 状态|M1 状态以验证区为准/);
    expect(r.markdown).toMatch(/手测文档 18\/18 与 dogfood 3\/3 已满足/);
    expect(r.markdown).not.toMatch(/勿启动 M2|仍需：手测文档 18\/18/);
  });

  it('handles empty child sections gracefully', () => {
    const r = formatM1EvidenceBundle({
      ...base,
      softSnapshotMarkdown: '   ',
      handtestPasteMarkdown: '',
      softRegressionMarkdown: '',
      dogfoodDraftMarkdown: undefined,
      nextKind: null,
      nextTitle: null,
    });
    expect(r.included.softSnapshot).toBe(false);
    expect(r.included.handtestPaste).toBe(false);
    expect(r.included.softRegression).toBe(false);
    expect(r.included.nextAction).toBe(false);
    expect(r.markdown).toMatch(/_（空）_/);
    expect(r.claimsM1Closed).toBe(false);
  });

  it('evidenceBundleLooksSecretFree rejects key-like strings', () => {
    expect(evidenceBundleLooksSecretFree(formatM1EvidenceBundle(base).markdown)).toBe(true);
    expect(evidenceBundleLooksSecretFree('token sk-abcdefghijklmnopqrstuvwxyz1234')).toBe(false);
    expect(
      evidenceBundleLooksSecretFree('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123'),
    ).toBe(false);
  });
});

describe('projectM1EvidenceBundlePreview', () => {
  it('levels gap / soft / ready-discuss', () => {
    const gap = projectM1EvidenceBundlePreview({
      handtestDocChecked: 0,
      handtestDocTotal: 18,
      dogfoodRealDays: 0,
      dogfoodRequired: 3,
      hardGatesMet: false,
      exitLevel: 'soft-only',
      externalGaps: 4,
      autoPass: 6,
      autoTotal: 10,
    });
    expect(gap.level).toBe('gap');
    expect(gap.headline).toMatch(/证据包|外网/);
    expect(gap.detail).toMatch(/0\/18/);

    const soft = projectM1EvidenceBundlePreview({
      handtestDocChecked: 3,
      handtestDocTotal: 18,
      dogfoodRealDays: 1,
      dogfoodRequired: 3,
      hardGatesMet: false,
      exitLevel: 'soft-only',
      hasDogfoodDraft: true,
      hasDocDiff: true,
    });
    expect(soft.level).toBe('soft');
    expect(soft.detail).toMatch(/含差异|可附差异/);

    const dogfoodOnly = projectM1EvidenceBundlePreview({
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      dogfoodRealDays: 1,
      dogfoodRequired: 3,
      hardGatesMet: false,
      exitLevel: 'partial',
    });
    expect(dogfoodOnly.headline).toMatch(/外网.*18\/18.*完成|仍缺 dogfood/);
    expect(dogfoodOnly.headline).not.toMatch(/外网手测.*仍缺/);

    const ready = projectM1EvidenceBundlePreview({
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      dogfoodRealDays: 3,
      dogfoodRequired: 3,
      hardGatesMet: true,
      exitLevel: 'evidence-ready',
    });
    expect(ready.level).toBe('ready-discuss');
    expect(ready.headline).toMatch(/M1 状态见验证区/);
  });
});

describe('M1_EVIDENCE_BUNDLE_SECTIONS', () => {
  it('lists fixed toc with required flags', () => {
    expect(M1_EVIDENCE_BUNDLE_SECTIONS.length).toBeGreaterThanOrEqual(7);
    expect(M1_EVIDENCE_BUNDLE_SECTIONS.some((s) => s.id === 'soft-snapshot')).toBe(true);
    expect(M1_EVIDENCE_BUNDLE_SECTIONS.some((s) => s.id === 'doc-diff')).toBe(true);
    expect(M1_EVIDENCE_BUNDLE_SECTIONS.some((s) => s.id === 'dogfood-fill')).toBe(true);
    expect(M1_EVIDENCE_BUNDLE_SECTIONS.find((s) => s.id === 'dogfood-draft')?.required).toBe(false);
    expect(M1_EVIDENCE_BUNDLE_SECTIONS.find((s) => s.id === 'doc-diff')?.required).toBe(false);
    expect(M1_EVIDENCE_BUNDLE_SECTIONS.find((s) => s.id === 'dogfood-fill')?.required).toBe(false);
  });
});
