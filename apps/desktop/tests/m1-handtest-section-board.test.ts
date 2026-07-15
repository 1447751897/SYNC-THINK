import { describe, expect, it } from 'vitest';
import { projectM1HandtestChecklist } from '../src/renderer/m1-handtest-checklist.js';
import { projectM1HandtestSectionBoard } from '../src/renderer/m1-handtest-section-board.js';

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

describe('projectM1HandtestSectionBoard', () => {
  it('groups 5 sections with scores when soft-ready', () => {
    const checklist = baseLive();
    const board = projectM1HandtestSectionBoard(checklist.items);
    expect(board.sections).toHaveLength(5);
    expect(board.sections.map((s) => s.id)).toEqual(['pre', 'A', 'B', 'C', 'D']);
    const pre = board.sections.find((s) => s.id === 'pre')!;
    expect(pre.pass).toBe(pre.total);
    expect(pre.level).toBe('soft-ok');
    const b = board.sections.find((s) => s.id === 'B')!;
    // multi-model external pending likely
    expect(b.total).toBeGreaterThan(0);
    expect(board.externalPending).toBeGreaterThan(0);
    expect(board.summary).toMatch(/外网|soft|分区/);
  });

  it('marks empty/partial when runtime offline', () => {
    const checklist = baseLive({
      connectionOnline: false,
      hasActiveTask: false,
      providerCount: 0,
      modelCount: 0,
      secretCount: 0,
      providersReadySoft: false,
      composeStructurallyReady: false,
      hasTraceEvents: false,
      manifestCount: 0,
      agentDefaultSet: false,
      knownLimitsVisible: false,
    });
    const board = projectM1HandtestSectionBoard(checklist.items);
    const pre = board.sections.find((s) => s.id === 'pre')!;
    expect(pre.fail).toBeGreaterThan(0);
    expect(pre.level === 'empty' || pre.level === 'partial').toBe(true);
    expect(board.summary).toMatch(/缺口|推进|外网/);
  });

  it('returns empty board for empty items', () => {
    const board = projectM1HandtestSectionBoard([]);
    expect(board.sections).toHaveLength(5);
    expect(board.livePass).toBe(0);
    expect(board.sections.every((s) => s.total === 0)).toBe(true);
  });
});
