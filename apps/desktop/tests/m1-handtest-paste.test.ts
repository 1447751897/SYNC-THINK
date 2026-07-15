import { describe, expect, it } from 'vitest';
import { projectM1HandtestChecklist } from '../src/renderer/m1-handtest-checklist.js';
import { projectM1HandtestSectionBoard } from '../src/renderer/m1-handtest-section-board.js';
import {
  countM1HandtestFilter,
  filterM1HandtestItems,
  formatM1HandtestPaste,
  handtestPasteLooksSecretFree,
} from '../src/renderer/m1-handtest-paste.js';

function checklist(overrides: Partial<Parameters<typeof projectM1HandtestChecklist>[0]> = {}) {
  return projectM1HandtestChecklist({
    connectionOnline: true,
    hasActiveTask: true,
    providerCount: 2,
    modelCount: 3,
    secretCount: 1,
    providersReadySoft: true,
    composeStructurallyReady: true,
    hasTraceEvents: true,
    manifestCount: 1,
    agentDefaultSet: true,
    agentFallbackCount: 1,
    distinctMessageModelCount: 1,
    dualAutomatedOk: true,
    knownLimitsVisible: true,
    docChecked: 0,
    docTotal: 18,
    ...overrides,
  });
}

describe('filterM1HandtestItems', () => {
  it('filters all / gaps / external', () => {
    const c = checklist();
    const all = filterM1HandtestItems(c.items, 'all');
    const gaps = filterM1HandtestItems(c.items, 'gaps');
    const ext = filterM1HandtestItems(c.items, 'external');
    expect(all.length).toBe(c.items.length);
    expect(gaps.every((it) => it.status !== 'pass')).toBe(true);
    expect(ext.every((it) => it.gate === 'external')).toBe(true);
    expect(ext.length).toBeGreaterThan(0);
    expect(countM1HandtestFilter(c.items, 'external')).toBe(ext.length);
  });
});

describe('formatM1HandtestPaste', () => {
  it('builds sectioned markdown without claiming M1 closed or doc checked', () => {
    const c = checklist();
    const board = projectM1HandtestSectionBoard(c.items);
    const r = formatM1HandtestPaste({
      generatedAt: '2026-07-12T00:00:00Z',
      items: c.items,
      sections: board.sections,
      sectionSummary: board.summary,
      docChecked: c.docChecked,
      docTotal: c.docTotal,
      livePass: c.livePass,
      liveTotal: c.liveTotal,
      externalPending: c.externalPending,
      dualAutomatedOk: true,
      dogfoodRealDays: 0,
      dogfoodRequired: 3,
    });
    expect(r.claimsM1Closed).toBe(false);
    expect(r.claimsDocChecked).toBe(false);
    expect(r.markdown).toMatch(/手测进度粘贴稿/);
    expect(r.markdown).toMatch(/不能.*替代|非文档勾选/);
    expect(r.markdown).toMatch(/不自动改变 M1/);
    expect(r.markdown).toMatch(/## 前置/);
    expect(r.markdown).toMatch(/## A\. Providers/);
    expect(r.markdown).toMatch(/分区摘要/);
    expect(r.pendingExternalCount).toBeGreaterThan(0);
    expect(r.summary).toMatch(/已复制手测进度/);
    expect(handtestPasteLooksSecretFree(r.markdown)).toBe(true);
  });

  it('still false claims when soft full + doc 18', () => {
    const c = checklist({
      distinctMessageModelCount: 3,
      docChecked: 18,
    });
    const r = formatM1HandtestPaste({
      items: c.items,
      docChecked: 18,
      docTotal: 18,
      livePass: c.livePass,
      liveTotal: c.liveTotal,
      externalPending: c.externalPending,
      dogfoodRealDays: 3,
    });
    expect(r.claimsM1Closed).toBe(false);
    expect(r.claimsDocChecked).toBe(false);
    expect(r.markdown).toMatch(/仍 open|不能.*替代/);
    expect(r.markdown).toMatch(/外网手测.*18\/18.*完成|文档 18\/18.*完成/);
    expect(r.markdown).not.toMatch(/外网项仍需|打开手测文档，只勾/);
  });

  it('handtestPasteLooksSecretFree rejects key-like strings', () => {
    expect(handtestPasteLooksSecretFree('sk-abcdefghijklmnopqrstuvwxyz1234')).toBe(false);
  });
});
