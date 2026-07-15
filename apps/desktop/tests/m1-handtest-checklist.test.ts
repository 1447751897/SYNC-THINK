import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isM1HandtestItemJumpable,
  M1_HANDTEST_ITEMS,
  projectM1CurrentMilestoneCopy,
  projectM1HandtestChecklist,
  resolveM1HandtestItemJump,
} from '../src/renderer/m1-handtest-checklist.js';

describe('M1_HANDTEST_ITEMS', () => {
  it('has 18 items matching handtest doc structure', () => {
    expect(M1_HANDTEST_ITEMS.length).toBe(18);
    expect(M1_HANDTEST_ITEMS.filter((i) => i.gate === 'live').length).toBeGreaterThan(10);
    expect(M1_HANDTEST_ITEMS.filter((i) => i.gate === 'external').length).toBeGreaterThan(2);
  });
});

describe('projectM1HandtestChecklist', () => {
  const empty = {
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
    agentFallbackCount: 0,
    distinctMessageModelCount: 0,
    dualAutomatedOk: false,
    knownLimitsVisible: false,
    docChecked: 0,
    docTotal: 18,
  };

  it('starts empty-ish with zero live pass', () => {
    const r = projectM1HandtestChecklist(empty);
    expect(r.livePass).toBe(0);
    expect(r.level).toBe('empty');
    expect(r.items).toHaveLength(18);
    expect(r.summary).toMatch(/未起步/);
  });

  it('marks live pre/A items when soft multi-provider ready', () => {
    const r = projectM1HandtestChecklist({
      ...empty,
      connectionOnline: true,
      hasActiveTask: true,
      providerCount: 2,
      modelCount: 3,
      secretCount: 2,
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
    });
    expect(r.livePass).toBe(r.liveTotal);
    expect(r.softLiveAllPass).toBe(true);
    expect(r.level).toBe('soft-live');
    expect(r.externalPending).toBeGreaterThan(0);
    expect(r.items.find((i) => i.id === 'pre-runtime')?.status).toBe('pass');
    expect(r.items.find((i) => i.id === 'c-fallback-fail')?.gate).toBe('external');
    expect(r.items.find((i) => i.id === 'c-fallback-fail')?.status).toBe('pending');
    expect(r.note).toMatch(/不会自动勾|外网/);
  });

  it('fails secret item when providers exist without secrets', () => {
    const r = projectM1HandtestChecklist({
      ...empty,
      connectionOnline: true,
      providerCount: 1,
      secretCount: 0,
      modelCount: 0,
    });
    expect(r.items.find((i) => i.id === 'a-provider-a')?.status).toBe('fail');
    expect(r.items.find((i) => i.id === 'a-provider-a')?.detail).toMatch(/密钥/);
  });

  it('soft-passes multi-model external item when ≥3 distinct models seen', () => {
    const r = projectM1HandtestChecklist({
      ...empty,
      connectionOnline: true,
      hasActiveTask: true,
      providerCount: 2,
      modelCount: 3,
      secretCount: 1,
      providersReadySoft: true,
      composeStructurallyReady: true,
      hasTraceEvents: true,
      manifestCount: 2,
      agentDefaultSet: true,
      agentFallbackCount: 0,
      distinctMessageModelCount: 3,
      dualAutomatedOk: true,
      knownLimitsVisible: true,
      docChecked: 2,
      docTotal: 18,
    });
    expect(r.items.find((i) => i.id === 'b-multi-model')?.status).toBe('pass');
    expect(r.items.find((i) => i.id === 'b-multi-model')?.detail).toMatch(/外网仍需手勾|soft/);
  });

  it('marks M1 evidence ready when handtest is 18/18 and one real dogfood day exists', () => {
    const r = projectM1HandtestChecklist({
      ...empty,
      connectionOnline: true,
      hasActiveTask: true,
      providerCount: 2,
      modelCount: 3,
      secretCount: 2,
      providersReadySoft: true,
      composeStructurallyReady: true,
      hasTraceEvents: true,
      manifestCount: 3,
      agentDefaultSet: true,
      agentFallbackCount: 1,
      distinctMessageModelCount: 3,
      dualAutomatedOk: true,
      knownLimitsVisible: true,
      docChecked: 18,
      docTotal: 18,
      dogfoodRealDays: 1,
    });
    expect(r.level).toBe('evidence-ready');
    expect(r.externalPending).toBe(0);
    expect(r.summary).toMatch(/手测 18\/18.*完成|外网.*完成/);
    expect(r.note).toMatch(/dogfood 1\/1.*满足|M1.*完成/);
    expect(r.note).not.toMatch(/仍需.*外网|外网项.*待证/);
  });
});

describe('projectM1CurrentMilestoneCopy', () => {
  it('reports M1 and M2 complete after the one-day dogfood policy is met', () => {
    const copy = projectM1CurrentMilestoneCopy({
      handtestChecked: 18,
      handtestTotal: 18,
      dogfoodRealDays: 1,
      dogfoodRequired: 1,
      m2Complete: true,
    });
    expect(copy).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/外网.*18\/18.*完成/),
        expect.stringMatching(/M2.*完成.*协作.*自动/),
        expect.stringMatching(/CC Switch.*完成/),
        expect.stringMatching(/dogfood 1\/1.*M1.*完成/),
      ]),
    );
    expect(copy.join('\n')).not.toMatch(/当前禁用|勿启动 M2|仍需.*外网/);
  });

  it('does not claim M1 complete when only dogfood is complete', () => {
    const copy = projectM1CurrentMilestoneCopy({
      handtestChecked: 17,
      handtestTotal: 18,
      dogfoodRealDays: 1,
      dogfoodRequired: 1,
      m2Complete: true,
    });
    expect(copy.join('\n')).toMatch(/dogfood 1\/1.*仍缺外网手测/);
    expect(copy.join('\n')).not.toMatch(/M1 已完成/);
  });

  it('is wired into the current renderer instead of stale milestone copy', () => {
    const source = readFileSync(new URL('../src/renderer/index.tsx', import.meta.url), 'utf8');
    expect(source).toContain('projectM1CurrentMilestoneCopy({');
    expect(source).not.toContain('当前禁用');
    expect(source).not.toContain('勿启动 M2');
    expect(source).not.toContain('勿启动');
    expect(source).not.toContain('硬门槛仍要手测');
    expect(source).not.toContain('外网手测与 dogfood 仍须人手完成');
    expect(source).not.toContain('CC Switch 完整导入、安装包、图像流水线生产化不在 M1 范围');
  });
});

describe('resolveM1HandtestItemJump', () => {
  it('maps provider-related items to providers panel', () => {
    expect(resolveM1HandtestItemJump('pre-providers').target).toBe('providers');
    expect(resolveM1HandtestItemJump('a-readiness').target).toBe('providers');
    expect(isM1HandtestItemJumpable(resolveM1HandtestItemJump('a-readiness').target)).toBe(true);
  });

  it('maps trace/manifest/agent and marks compose-only as non-jumpable', () => {
    expect(resolveM1HandtestItemJump('b-trace').target).toBe('trace');
    expect(resolveM1HandtestItemJump('b-manifest').target).toBe('manifest');
    expect(resolveM1HandtestItemJump('c-agent-bind').target).toBe('agent');
    expect(resolveM1HandtestItemJump('b-send-ready').target).toBe('none');
    expect(isM1HandtestItemJumpable('none')).toBe(false);
  });
});

describe('projectM1HandtestChecklist jump fields', () => {
  it('attaches jumpTarget on every item', () => {
    const r = projectM1HandtestChecklist({
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
      agentFallbackCount: 0,
      distinctMessageModelCount: 0,
      dualAutomatedOk: true,
      knownLimitsVisible: true,
      docChecked: 0,
      docTotal: 18,
    });
    expect(r.items.every((i) => typeof i.jumpTarget === 'string')).toBe(true);
    expect(r.items.find((i) => i.id === 'pre-task')?.jumpTarget).toBe('workspaces');
    expect(r.items.find((i) => i.id === 'd-limits')?.jumpTarget).toBe('none');
  });
});
