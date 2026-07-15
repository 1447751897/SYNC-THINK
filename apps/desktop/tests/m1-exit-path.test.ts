import { describe, expect, it } from 'vitest';
import {
  projectM1ExitPath,
  formatM1ExitPathPaste,
  isM1ExitPathStepActionable,
  exitPathLooksSecretFree,
} from '../src/renderer/m1-exit-path.js';

const base = {
  connectionOnline: true,
  hasActiveTask: true,
  providersReadySoft: true,
  providerCount: 2,
  modelCount: 3,
  secretCount: 2,
  agentDefaultSet: true,
  handtestDocChecked: 0,
  handtestDocTotal: 18,
  handtestLivePass: 12,
  handtestLiveTotal: 14,
  handtestExternalPending: 4,
  dogfoodRealDays: 0,
  dogfoodRequired: 3,
  dogfoodFileCount: 1,
  dualAutomatedOk: true,
  hardGatesMet: false,
  exitLevel: 'soft-only',
  softCraftRound: 48,
  handtestItems: [
    {
      id: 'b-multi-model',
      label: '同任务切换 ≥3 模型各发一轮',
      gate: 'external' as const,
      status: 'pending' as const,
    },
    {
      id: 'c-fallback-fail',
      label: '主模型失败走 Fallback',
      gate: 'external' as const,
      status: 'pending' as const,
    },
    {
      id: 'pre-runtime',
      label: 'Runtime 已连接',
      gate: 'live' as const,
      status: 'pass' as const,
    },
  ],
};

describe('projectM1ExitPath', () => {
  it('lists hard gaps and never claims closed', () => {
    const r = projectM1ExitPath(base);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.level).toBe('hard-gap');
    expect(r.progressPercent).toBeLessThan(100);
    expect(r.remainingHardSteps).toBeGreaterThan(0);
    expect(r.steps.some((s) => s.id === 'ext-b-multi-model')).toBe(true);
    expect(r.steps.some((s) => s.id === 'doc-handtest')).toBe(true);
    expect(r.steps.filter((s) => s.kind === 'dogfood-day').length).toBe(3);
    expect(r.steps.some((s) => s.id === 'discuss-exit')).toBe(true);
    expect(r.focusStepId).toBeTruthy();
    expect(r.summary).toMatch(/硬门槛|手测|dogfood/);
  });

  it('surfaces soft setup when providers incomplete', () => {
    const r = projectM1ExitPath({
      ...base,
      providerCount: 1,
      modelCount: 1,
      secretCount: 0,
      providersReadySoft: false,
    });
    expect(r.level).toBe('setup');
    expect(r.steps.some((s) => s.id === 'soft-providers')).toBe(true);
    expect(r.remainingSoftSteps).toBeGreaterThan(0);
  });

  it('blocks when offline', () => {
    const r = projectM1ExitPath({ ...base, connectionOnline: false });
    expect(r.level).toBe('blocked');
    expect(r.steps.some((s) => s.id === 'soft-runtime' && s.status === 'blocked')).toBe(
      true,
    );
  });

  it('ready-discuss when hard gates met but still not closed', () => {
    const r = projectM1ExitPath({
      ...base,
      handtestDocChecked: 18,
      dogfoodRealDays: 3,
      hardGatesMet: true,
      handtestExternalPending: 0,
      handtestItems: [
        {
          id: 'b-multi-model',
          label: '同任务切换 ≥3 模型各发一轮',
          gate: 'external',
          status: 'pass',
        },
      ],
      exitLevel: 'evidence-ready',
    });
    expect(r.level).toBe('ready-discuss');
    expect(r.claimsM1Closed).toBe(false);
    expect(r.progressPercent).toBeLessThanOrEqual(99);
    expect(r.steps.find((s) => s.id === 'doc-handtest')?.status).toBe('done');
    expect(r.steps.find((s) => s.id === 'dogfood-complete')?.status).toBe('done');
  });

  it('surfaces doc-live-ahead when liveAheadCount > 0', () => {
    const r = projectM1ExitPath({
      ...base,
      liveAheadCount: 3,
      docAheadCount: 1,
    });
    const step = r.steps.find((s) => s.id === 'doc-live-ahead');
    expect(step).toBeTruthy();
    expect(step?.title).toMatch(/本机领先/);
    expect(step?.ctaAction).toBe('open-handtest');
    expect(r.claimsM1Closed).toBe(false);
  });

  it('surfaces dogfood-fill-assist when still short', () => {
    const r = projectM1ExitPath({
      ...base,
      dogfoodRealDays: 0,
      dogfoodRequired: 3,
      dogfoodFillLevel: 'scaffold-only',
      dogfoodDraftDays: 0,
      dogfoodScaffoldDays: 1,
      dogfoodMissingCount: 2,
      dogfoodFillPrimaryAction: 'open-oldest-scaffold',
    });
    const step = r.steps.find((s) => s.id === 'dogfood-fill-assist');
    expect(step).toBeTruthy();
    expect(step?.title).toMatch(/仍差 3/);
    expect(step?.detail).toMatch(/脚手架|不计有效日/);
    expect(step?.ctaAction).toBe('open-dogfood-fill');
    expect(step?.gate).toBe('hard');
    expect(step?.kind).toBe('dogfood-fill');
    expect(r.claimsM1Closed).toBe(false);
  });

  it('dogfood-fill-assist uses copy fill when primary is copy-draft', () => {
    const r = projectM1ExitPath({
      ...base,
      dogfoodRealDays: 1,
      dogfoodRequired: 3,
      dogfoodFillLevel: 'partial',
      dogfoodFillPrimaryAction: 'copy-draft',
    });
    const step = r.steps.find((s) => s.id === 'dogfood-fill-assist');
    expect(step?.ctaAction).toBe('copy-dogfood-fill');
    expect(step?.ctaLabel).toMatch(/补填/);
  });

  it('omits dogfood-fill-assist when real days full', () => {
    const r = projectM1ExitPath({
      ...base,
      dogfoodRealDays: 3,
      dogfoodRequired: 3,
      dogfoodFillLevel: 'ready-count',
    });
    expect(r.steps.some((s) => s.id === 'dogfood-fill-assist')).toBe(false);
    expect(r.steps.some((s) => s.id === 'dogfood-complete')).toBe(true);
  });


  it('surfaces external-focus-assist before external items when focus set', () => {
    const r = projectM1ExitPath({
      ...base,
      externalFocusId: 'b-multi-model',
      externalFocusLabel: '同任务切换 ≥3 模型各发一轮',
      externalFocusSection: 'B · 多模型对话',
      externalFocusJumpTarget: 'compose',
      externalFocusJumpable: true,
      externalFocusPending: 2,
    });
    const step = r.steps.find((s) => s.id === 'external-focus-assist');
    expect(step).toBeTruthy();
    expect(step?.kind).toBe('external-focus');
    expect(step?.gate).toBe('hard');
    expect(step?.ctaAction).toBe('jump-external-item');
    expect(step?.handtestItemId).toBe('b-multi-model');
    expect(step?.title).toMatch(/下一外网项|多模型|≥3/);
    const focusIdx = r.steps.findIndex((s) => s.id === 'external-focus-assist');
    const itemIdx = r.steps.findIndex((s) => s.id === 'ext-b-multi-model');
    expect(focusIdx).toBeGreaterThanOrEqual(0);
    expect(itemIdx).toBeGreaterThan(focusIdx);
    expect(r.claimsM1Closed).toBe(false);
  });

  it('external-focus-assist uses focus-external when not jumpable', () => {
    const r = projectM1ExitPath({
      ...base,
      externalFocusId: 'c-fallback-fail',
      externalFocusLabel: '主模型失败走 Fallback',
      externalFocusJumpable: false,
      externalFocusPending: 1,
    });
    const step = r.steps.find((s) => s.id === 'external-focus-assist');
    expect(step?.ctaAction).toBe('focus-external');
    expect(step?.ctaLabel).toMatch(/外网聚焦/);
  });

  it('omits external-focus-assist without focus id', () => {
    const r = projectM1ExitPath(base);
    expect(r.steps.some((s) => s.id === 'external-focus-assist')).toBe(false);
  });

  it('marks CTA actionable', () => {
    expect(isM1ExitPathStepActionable('open-handtest')).toBe(true);
    expect(isM1ExitPathStepActionable('open-dogfood-fill')).toBe(true);
    expect(isM1ExitPathStepActionable('copy-dogfood-fill')).toBe(true);
    expect(isM1ExitPathStepActionable('focus-external')).toBe(true);
    expect(isM1ExitPathStepActionable('jump-external-item')).toBe(true);
    expect(isM1ExitPathStepActionable('copy-external-runsheet')).toBe(true);
    expect(isM1ExitPathStepActionable('none')).toBe(false);
  });
});

describe('formatM1ExitPathPaste', () => {
  it('includes external-focus-assist in paste when focus set', () => {
    const r = formatM1ExitPathPaste({
      ...base,
      externalFocusId: 'b-multi-model',
      externalFocusLabel: '同任务切换 ≥3 模型各发一轮',
      externalFocusSection: 'B',
      externalFocusJumpable: true,
      externalFocusPending: 2,
      softCraftRound: 59,
    });
    expect(r.markdown).toMatch(/下一外网项|b-multi-model|多模型/);
    expect(r.claimsM1Closed).toBe(false);
  });

    it('includes dogfood-fill-assist in paste when short', () => {
    const r = formatM1ExitPathPaste({
      ...base,
      dogfoodRealDays: 0,
      dogfoodRequired: 3,
      dogfoodFillLevel: 'scaffold-only',
      dogfoodDraftDays: 0,
      dogfoodScaffoldDays: 1,
      dogfoodMissingCount: 2,
      dogfoodFillPrimaryAction: 'open-oldest-scaffold',
      softCraftRound: 56,
    });
    expect(r.markdown).toMatch(/补填 dogfood 仍差/);
    expect(r.markdown).toMatch(/打开补填板|写今日 dogfood/);
    expect(r.claimsM1Closed).toBe(false);
  });

it('formats markdown path without claiming closed or secrets', () => {
    const r = formatM1ExitPathPaste(base);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.markdown).toMatch(/退出路径/);
    expect(r.markdown).toMatch(/手测文档/);
    expect(r.markdown).toMatch(/dogfood/);
    expect(r.markdown).toMatch(/仍 open|claimsM1Closed=false/);
    expect(r.markdown).toMatch(/M2 已完成/);
    expect(r.markdown).not.toMatch(/勿启动 M2/);
    expect(r.summary).toMatch(/仍不关 M1/);
    expect(exitPathLooksSecretFree(r.markdown)).toBe(true);
    expect(
      exitPathLooksSecretFree('leak sk-abcdefghijklmnopqrstuvwxyz1234'),
    ).toBe(false);
  });
});
