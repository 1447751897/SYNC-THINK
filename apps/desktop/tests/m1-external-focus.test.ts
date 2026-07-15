import { describe, expect, it } from 'vitest';
import { projectM1HandtestChecklist } from '../src/renderer/m1-handtest-checklist.js';
import {
  projectM1ExternalFocus,
  projectM1ExternalFocusFromChecklist,
  formatM1ExternalFocusRunSheet,
  externalFocusLooksSecretFree,
  isM1ExternalFocusCtaActionable,
} from '../src/renderer/m1-external-focus.js';

function baseLive(overrides: Partial<Parameters<typeof projectM1HandtestChecklist>[0]> = {}) {
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

describe('projectM1ExternalFocus', () => {
  it('focuses first external pending in checklist order when soft-ready', () => {
    const checklist = baseLive();
    const board = projectM1ExternalFocusFromChecklist(checklist.items, {
      handtestDocChecked: 0,
      handtestDocTotal: 18,
      softCraftRound: 58,
    });
    expect(board.claimsM1Closed).toBe(false);
    expect(board.claimsDocChecked).toBe(false);
    expect(board.level).toBe('focus');
    expect(board.externalPending).toBeGreaterThan(0);
    expect(board.focus).not.toBeNull();
    // Canonical first external is b-multi-model (B section)
    expect(board.focus!.id).toBe('b-multi-model');
    expect(board.focus!.section).toBe('B');
    expect(board.title).toMatch(/下一外网项|b-multi-model|多模型/);
    expect(board.primaryCta.action).toBe('jump-item');
    expect(board.secondaryCtas.some((c) => c.action === 'open-handtest')).toBe(true);
    expect(board.secondaryCtas.some((c) => c.action === 'copy-runsheet')).toBe(true);
    expect(board.secondaryCtas.some((c) => c.action === 'filter-external')).toBe(true);
    expect(board.summary).toMatch(/外网待证/);
  });

  it('queues subsequent external items after focus', () => {
    const checklist = baseLive();
    const board = projectM1ExternalFocusFromChecklist(checklist.items, {
      handtestDocChecked: 2,
      handtestDocTotal: 18,
    });
    expect(board.focus!.id).toBe('b-multi-model');
    // remaining external: c-fallback-fail, c-pause-policy, d-restart (and maybe b if multi soft pass no)
    expect(board.queue.length).toBeGreaterThan(0);
    expect(board.queue[0]!.id).not.toBe(board.focus!.id);
    expect(board.queue.every((q) => q.id !== board.focus!.id)).toBe(true);
  });

  it('soft-first when no external pending but live gaps', () => {
    // Mark all external as pass via raw project — empty external by filtering input
    const board = projectM1ExternalFocus({
      handtestDocChecked: 0,
      handtestDocTotal: 18,
      items: [
        {
          id: 'pre-runtime',
          section: 'pre',
          label: 'Runtime',
          gate: 'live',
          status: 'fail',
          detail: 'offline',
        },
        {
          id: 'b-multi-model',
          section: 'B',
          label: '多模型',
          gate: 'external',
          status: 'pass',
          detail: 'ok',
        },
      ],
    });
    expect(board.level).toBe('soft-first');
    expect(board.focus).toBeNull();
    expect(board.externalPending).toBe(0);
    expect(board.softLiveGaps).toBe(1);
    expect(board.primaryCta.action).toBe('filter-external');
  });

  it('clear when nothing pending', () => {
    const board = projectM1ExternalFocus({
      handtestDocChecked: 10,
      handtestDocTotal: 18,
      items: [
        {
          id: 'pre-runtime',
          section: 'pre',
          label: 'Runtime',
          gate: 'live',
          status: 'pass',
        },
        {
          id: 'b-multi-model',
          section: 'B',
          label: '多模型',
          gate: 'external',
          status: 'pass',
        },
      ],
    });
    expect(board.level).toBe('clear');
    expect(board.externalPending).toBe(0);
    expect(board.softLiveGaps).toBe(0);
    expect(board.primaryCta.action).toBe('open-handtest');
    expect(board.claimsM1Closed).toBe(false);
  });

  it('reports dogfood-only when the handtest document is complete', () => {
    const checklist = baseLive({
      docChecked: 18,
      docTotal: 18,
      dogfoodRealDays: 1,
    });
    const board = projectM1ExternalFocusFromChecklist(checklist.items, {
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      dogfoodRealDays: 1,
      dogfoodRequired: 1,
    });
    expect(board.level).toBe('clear');
    expect(board.body).toMatch(/18\/18.*dogfood 1\/1.*M1 已完成/);
    expect(board.body).not.toMatch(/仍须人手|仍要文档/);
    expect(board.primaryCta.action).toBe('none');
  });

  it('empty items board', () => {
    const board = projectM1ExternalFocus({ items: [] });
    expect(board.level).toBe('empty');
    expect(board.focus).toBeNull();
    expect(board.primaryCta.action).toBe('open-handtest');
  });

  it('non-jumpable external prefers open-handtest primary', () => {
    const board = projectM1ExternalFocus({
      items: [
        {
          id: 'd-restart',
          section: 'D',
          label: '重启后对话仍在',
          gate: 'external',
          status: 'pending',
          detail: '需你重启',
          hint: '重启应用后确认',
          jumpTarget: 'none',
        },
      ],
    });
    expect(board.level).toBe('focus');
    expect(board.focus!.id).toBe('d-restart');
    expect(board.focus!.jumpable).toBe(false);
    expect(board.primaryCta.action).toBe('open-handtest');
  });
});

describe('formatM1ExternalFocusRunSheet', () => {
  it('builds markdown with focus + claims flags', () => {
    const checklist = baseLive();
    const board = projectM1ExternalFocusFromChecklist(checklist.items, {
      handtestDocChecked: 1,
      handtestDocTotal: 18,
    });
    const sheet = formatM1ExternalFocusRunSheet(board, {
      softCraftRound: 58,
      dualAutomatedOk: true,
      dogfoodRealDays: 0,
      dogfoodRequired: 3,
    });
    expect(sheet.claimsM1Closed).toBe(false);
    expect(sheet.claimsDocChecked).toBe(false);
    expect(sheet.markdown).toMatch(/外网手测运行单/);
    expect(sheet.markdown).toMatch(/b-multi-model|多模型/);
    expect(sheet.markdown).toMatch(/claimsM1Closed: false/);
    expect(sheet.markdown).toMatch(/soft craft 轮次：58/);
    expect(sheet.markdown).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(externalFocusLooksSecretFree(sheet.markdown)).toBe(true);
    expect(sheet.summary).toMatch(/外网运行单|焦点/);
    expect(sheet.charCount).toBeGreaterThan(100);
  });

  it('secret scrub rejects sk- keys', () => {
    expect(externalFocusLooksSecretFree('ok text')).toBe(true);
    expect(externalFocusLooksSecretFree('key sk-abcdefghijklmnopqrstuvwxyz1234')).toBe(false);
  });
});

describe('isM1ExternalFocusCtaActionable', () => {
  it('none is not actionable', () => {
    expect(isM1ExternalFocusCtaActionable('none')).toBe(false);
    expect(isM1ExternalFocusCtaActionable('open-handtest')).toBe(true);
    expect(isM1ExternalFocusCtaActionable('jump-item')).toBe(true);
    expect(isM1ExternalFocusCtaActionable('copy-runsheet')).toBe(true);
    expect(isM1ExternalFocusCtaActionable('filter-external')).toBe(true);
  });
});
