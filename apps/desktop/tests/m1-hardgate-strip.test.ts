import { describe, expect, it } from 'vitest';
import {
  projectM1HardgateStrip,
  formatM1HardgateStripPaste,
  isM1HardgateCtaActionable,
  M1_HARDGATE_SOFT_CRAFT_ROUND,
} from '../src/renderer/m1-hardgate-strip.js';

describe('projectM1HardgateStrip', () => {
  it('starts empty when no handtest and no dogfood', () => {
    const s = projectM1HardgateStrip({
      handtestChecked: 0,
      handtestTotal: 18,
      dogfoodRealDays: 0,
      dogfoodFileCount: 0,
      dualAutomatedOk: false,
    });
    expect(s.claimsM1Closed).toBe(false);
    expect(s.hardGatesMet).toBe(false);
    expect(s.level).toBe('empty');
    expect(s.handtest.percent).toBe(0);
    expect(s.dogfood.percent).toBe(0);
    expect(s.primaryCta.action).toMatch(/handtest|external|focus/);
    expect(s.softCraftRound).toBe(M1_HARDGATE_SOFT_CRAFT_ROUND);
  });

  it('marks soft-only when dual green but hard gates empty', () => {
    const s = projectM1HardgateStrip({
      handtestChecked: 0,
      handtestTotal: 18,
      dogfoodRealDays: 0,
      dualAutomatedOk: true,
    });
    expect(s.level).toBe('soft-only');
    expect(s.dualAutomatedOk).toBe(true);
    expect(s.note).toMatch(/dual/);
  });

  it('partial handtest progress and prefers open-handtest / focus-external', () => {
    const s = projectM1HardgateStrip({
      handtestChecked: 3,
      handtestTotal: 18,
      dogfoodRealDays: 0,
      dualAutomatedOk: true,
      externalPending: 5,
    });
    expect(s.level).toBe('soft-only');
    expect(s.handtest.partial).toBe(true);
    expect(s.handtest.percent).toBe(17); // 3/18 ~ 16.6 -> 17
    expect(s.primaryCta.action).toBe('focus-external');
    expect(s.externalPending).toBe(5);
  });

  it('dogfood partial when scaffold files exist but real days 0', () => {
    const s = projectM1HardgateStrip({
      handtestChecked: 0,
      handtestTotal: 18,
      dogfoodRealDays: 0,
      dogfoodFileCount: 2,
      dualAutomatedOk: true,
    });
    expect(s.dogfood.partial).toBe(true);
    expect(s.dogfood.badge).toMatch(/草稿|未开始|仅/);
    expect(s.dogfood.detail).toMatch(/脚手架|草稿|有效/);
  });

  it('evidence-ready when both hard gates met — still claimsM1Closed false', () => {
    const s = projectM1HardgateStrip({
      handtestChecked: 18,
      handtestTotal: 18,
      dogfoodRealDays: 3,
      dogfoodRequired: 3,
      dualAutomatedOk: true,
      hardGatesMet: true,
    });
    expect(s.level).toBe('evidence-ready');
    expect(s.hardGatesMet).toBe(true);
    expect(s.claimsM1Closed).toBe(false);
    expect(s.handtest.ok).toBe(true);
    expect(s.dogfood.ok).toBe(true);
    expect(s.summary).toMatch(/M1 已完成/);
  });

  it('when handtest complete but dogfood incomplete, primary points dogfood', () => {
    const s = projectM1HardgateStrip({
      handtestChecked: 18,
      handtestTotal: 18,
      dogfoodRealDays: 1,
      dogfoodRequired: 3,
      dogfoodFileCount: 2,
    });
    expect(s.handtest.ok).toBe(true);
    expect(s.dogfood.ok).toBe(false);
    expect(s.primaryCta.action).toMatch(/dogfood/);
  });

  it('format paste is secret-free and includes both meters', () => {
    const s = projectM1HardgateStrip({
      handtestChecked: 2,
      handtestTotal: 18,
      dogfoodRealDays: 1,
      dogfoodRequired: 3,
      softCraftRound: 61,
    });
    const paste = formatM1HardgateStripPaste(s);
    expect(paste).toMatch(/硬门槛/);
    expect(paste).toMatch(/2\/18/);
    expect(paste).toMatch(/1\/3/);
    expect(paste).toMatch(/claimsM1Closed: false/);
    expect(paste).not.toMatch(/sk-|api[_-]?key|Bearer\s/i);
  });

  it('all CTA actions are actionable', () => {
    for (const a of [
      'open-handtest',
      'open-dogfood-today',
      'focus-external',
      'open-dogfood-fill',
      'expand-secondary',
      'refresh-evidence',
      'copy-exit-path',
    ] as const) {
      expect(isM1HardgateCtaActionable(a)).toBe(true);
    }
  });
});
