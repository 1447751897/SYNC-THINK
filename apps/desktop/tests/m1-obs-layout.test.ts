import { describe, expect, it } from 'vitest';
import {
  M1_OBS_BOARDS,
  M1_OBS_SOFT_CRAFT_ROUND,
  projectM1ObsLayout,
  isM1ObsPrimary,
  isM1ObsSecondary,
  isM1ObsSecondaryTestId,
  m1ObsPrimarySelectors,
  m1ObsSecondarySelectors,
  getM1ObsBoard,
} from '../src/renderer/m1-obs-layout.js';

describe('projectM1ObsLayout', () => {
  it('puts next → external-focus → exit-path as primary in that order', () => {
    const layout = projectM1ObsLayout();
    expect(layout.claimsM1Closed).toBe(false);
    expect(layout.softCraftRound).toBe(M1_OBS_SOFT_CRAFT_ROUND);
    expect(layout.primaryOrder).toEqual([
      'next-action',
      'external-focus',
      'exit-path',
    ]);
    expect(layout.primary).toHaveLength(3);
    expect(layout.primary.every((b) => b.defaultExpanded)).toBe(true);
    expect(layout.primary.every((b) => b.tier === 'primary')).toBe(true);
  });

  it('folds secondary boards by default and keeps hard-gate boards listed', () => {
    const layout = projectM1ObsLayout();
    expect(layout.workspaceDefaultOpen).toBe(false);
    expect(layout.workspaceLabel).toBe('M1 验证');
    expect(layout.workspaceHint).toMatch(/按需展开/);
    expect(layout.secondary.length).toBeGreaterThanOrEqual(6);
    expect(layout.secondary.every((b) => b.defaultExpanded === false)).toBe(
      true,
    );
    expect(layout.secondaryOrder).toContain('session-readiness');
    expect(layout.secondaryOrder).toContain('exit-evidence');
    expect(layout.secondaryOrder).toContain('handtest-checklist');
    expect(layout.secondaryOrder).toContain('dogfood-fill');
    expect(layout.secondaryOrder).toContain('soft-regression');
    expect(layout.summary).toMatch(/主路径/);
    expect(layout.secondarySummary).toMatch(/更多 soft 观测/);
  });

  it('allows softCraftRound override', () => {
    const layout = projectM1ObsLayout({ softCraftRound: 99 });
    expect(layout.softCraftRound).toBe(99);
  });

  it('canonical board table covers primary + secondary without duplicate ids', () => {
    const ids = M1_OBS_BOARDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('next-action');
    expect(ids).toContain('external-focus');
    expect(ids).toContain('exit-path');
  });
});

describe('obs layout helpers', () => {
  it('classifies primary vs secondary', () => {
    expect(isM1ObsPrimary('next-action')).toBe(true);
    expect(isM1ObsPrimary('session-readiness')).toBe(false);
    expect(isM1ObsSecondary('handtest-checklist')).toBe(true);
    expect(isM1ObsSecondary('exit-path')).toBe(false);
  });

  it('resolves board defs and selectors', () => {
    expect(getM1ObsBoard('external-focus')?.testId).toBe('m1-external-focus');
    expect(m1ObsPrimarySelectors().join(' ')).toMatch(/m1-next-action/);
    expect(m1ObsPrimarySelectors().join(' ')).toMatch(/m1-external-focus/);
    expect(m1ObsSecondarySelectors().join(' ')).toMatch(/m1-handtest-checklist/);
  });

  it('detects secondary test ids for accordion auto-expand', () => {
    expect(isM1ObsSecondaryTestId('m1-session-readiness')).toBe(true);
    expect(isM1ObsSecondaryTestId('m1-dogfood-fill-row-2026-07-11')).toBe(true);
    expect(isM1ObsSecondaryTestId('m1-next-action')).toBe(false);
    expect(isM1ObsSecondaryTestId('m1-external-focus')).toBe(false);
    expect(isM1ObsSecondaryTestId('m1-exit-path-step-x')).toBe(false);
  });
});
