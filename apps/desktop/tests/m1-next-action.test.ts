import { describe, expect, it } from 'vitest';
import {
  isM1NextActionJumpable,
  isM1NextOpenDocAction,
  isM1NextDogfoodFillAction,
  isM1NextExternalFocusAction,
  projectM1NextAction,
} from '../src/renderer/m1-next-action.js';

const base = {
  connectionOnline: true,
  hasActiveTask: true,
  providerCount: 2,
  modelCount: 3,
  secretCount: 2,
  providersReadySoft: true,
  agentDefaultSet: true,
  sessionLevel: 'ready' as const,
  handtestLivePass: 14,
  handtestLiveTotal: 14,
  handtestSoftLiveAllPass: true,
  handtestExternalPending: 4,
  handtestDocChecked: 0,
  handtestDocTotal: 18,
  dogfoodRealDays: 0,
  dogfoodRequired: 3,
  dogfoodFileCount: 1,
  dualAutomatedOk: true,
  hardGatesMet: false,
  exitLevel: 'soft-only',
};

describe('projectM1NextAction', () => {
  it('asks to reconnect runtime when offline', () => {
    const r = projectM1NextAction({ ...base, connectionOnline: false });
    expect(r.kind).toBe('connect-runtime');
    expect(r.level).toBe('blocked');
    expect(r.ctaAction).toBe('reconnect');
    expect(r.ctaLabel).toMatch(/重新连接/);
    expect(r.jumpTarget).toBe('workspaces');
    expect(isM1NextActionJumpable(r.jumpTarget)).toBe(true);
  });

  it('asks to open task when none active', () => {
    const r = projectM1NextAction({ ...base, hasActiveTask: false });
    expect(r.kind).toBe('open-task');
    expect(r.ctaAction).toBe('jump');
    expect(r.jumpTarget).toBe('workspaces');
  });

  it('asks to configure providers when under multi-model gate', () => {
    const r = projectM1NextAction({
      ...base,
      providerCount: 1,
      modelCount: 1,
      secretCount: 0,
      providersReadySoft: false,
      handtestSoftLiveAllPass: false,
      handtestLivePass: 2,
    });
    expect(r.kind).toBe('configure-providers');
    expect(r.body).toMatch(/Provider|模型|密钥/);
    expect(r.jumpTarget).toBe('providers');
    expect(r.ctaAction).toBe('jump');
  });

  it('asks to bind agent when default missing', () => {
    const r = projectM1NextAction({
      ...base,
      agentDefaultSet: false,
      handtestSoftLiveAllPass: false,
    });
    expect(r.kind).toBe('bind-agent');
    expect(r.jumpTarget).toBe('agent');
  });

  it('opens handtest doc when soft live full and doc empty', () => {
    const r = projectM1NextAction(base);
    expect(r.kind).toBe('external-handtest');
    expect(r.gate).toBe('hard');
    expect(r.level).toBe('evidence');
    expect(r.title).toMatch(/外网/);
    expect(r.ctaAction).toBe('open-handtest');
    expect(r.openDoc).toBe('handtest');
    expect(r.ctaLabel).toMatch(/手测清单/);
    expect(isM1NextOpenDocAction(r.ctaAction)).toBe(true);
  });

  it('continues handtest with open-handtest when doc partially checked', () => {
    const r = projectM1NextAction({ ...base, handtestDocChecked: 5 });
    expect(r.kind).toBe('external-handtest');
    expect(r.ctaAction).toBe('open-handtest');
    expect(r.title).toMatch(/继续/);
  });

  it('opens dogfood when handtest doc full but days short', () => {
    const r = projectM1NextAction({
      ...base,
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      dogfoodRealDays: 1,
    });
    expect(r.kind).toBe('write-dogfood');
    expect(r.gate).toBe('hard');
    expect(r.ctaAction).toBe('open-dogfood');
    expect(r.openDoc).toBe('dogfood-today');
    expect(r.body).toMatch(/dogfood|日记/);
  });

  it('discuss exit only when hard gates met', () => {
    const r = projectM1NextAction({
      ...base,
      hardGatesMet: true,
      handtestDocChecked: 18,
      dogfoodRealDays: 3,
    });
    expect(r.kind).toBe('discuss-exit');
    expect(r.level).toBe('ready-discuss');
    expect(r.ctaAction).toBe('refresh');
    expect(isM1NextActionJumpable(r.jumpTarget)).toBe(false);
  });

  it('nudge soft path when not fully live', () => {
    const r = projectM1NextAction({
      ...base,
      handtestSoftLiveAllPass: false,
      handtestLivePass: 6,
      sessionLevel: 'partial',
      providersReadySoft: true,
    });
    expect(r.kind).toBe('send-multi-model');
    expect(r.ctaAction).toBe('refresh');
  });


  it('uses open-dogfood-fill when primary is open-oldest-scaffold', () => {
    const r = projectM1NextAction({
      ...base,
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      dogfoodRealDays: 0,
      dogfoodFillLevel: 'scaffold-only',
      dogfoodScaffoldDays: 1,
      dogfoodMissingCount: 2,
      dogfoodFillPrimaryAction: 'open-oldest-scaffold',
    });
    expect(r.kind).toBe('write-dogfood');
    expect(r.ctaAction).toBe('open-dogfood-fill');
    expect(r.ctaLabel).toMatch(/补填/);
    expect(r.title).toMatch(/脚手架|仍差/);
    expect(r.body).toMatch(/不计|脚手架/);
    expect(isM1NextDogfoodFillAction(r.ctaAction)).toBe(true);
  });

  it('uses copy-dogfood-fill when primary is copy-draft', () => {
    const r = projectM1NextAction({
      ...base,
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      dogfoodRealDays: 1,
      dogfoodFillLevel: 'partial',
      dogfoodDraftDays: 1,
      dogfoodFillPrimaryAction: 'copy-draft',
    });
    expect(r.kind).toBe('write-dogfood');
    expect(r.ctaAction).toBe('copy-dogfood-fill');
    expect(r.ctaLabel).toMatch(/多日补填|复制/);
    expect(isM1NextDogfoodFillAction(r.ctaAction)).toBe(true);
  });

  it('keeps open-dogfood when primary is open-today', () => {
    const r = projectM1NextAction({
      ...base,
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      dogfoodRealDays: 0,
      dogfoodFillLevel: 'empty',
      dogfoodFillPrimaryAction: 'open-today',
    });
    expect(r.kind).toBe('write-dogfood');
    expect(r.ctaAction).toBe('open-dogfood');
    expect(r.openDoc).toBe('dogfood-today');
    expect(isM1NextDogfoodFillAction(r.ctaAction)).toBe(false);
  });


  it('uses jump-external-item when soft full and focus jumpable', () => {
    const r = projectM1NextAction({
      ...base,
      externalFocusId: 'b-multi-model',
      externalFocusLabel: '同任务切换 ≥3 模型各发一轮',
      externalFocusSection: 'B · 多模型对话',
      externalFocusJumpTarget: 'compose',
      externalFocusJumpable: true,
      externalFocusPending: 4,
    });
    expect(r.kind).toBe('external-handtest');
    expect(r.ctaAction).toBe('jump-external-item');
    expect(r.title).toMatch(/下一外网项|多模型|≥3/);
    expect(r.body).toMatch(/b-multi-model|外网待证|不自动勾/);
    expect(r.jumpTarget).toBe('compose');
    expect(isM1NextExternalFocusAction(r.ctaAction)).toBe(true);
    expect(isM1NextOpenDocAction(r.ctaAction)).toBe(false);
  });

  it('uses focus-external when focus present but not jumpable', () => {
    const r = projectM1NextAction({
      ...base,
      externalFocusId: 'c-fallback-fail',
      externalFocusLabel: '主模型失败走 Fallback',
      externalFocusSection: 'C · 绑定/Fallback',
      externalFocusJumpTarget: 'none',
      externalFocusJumpable: false,
      externalFocusPending: 2,
    });
    expect(r.kind).toBe('external-handtest');
    expect(r.ctaAction).toBe('focus-external');
    expect(r.ctaLabel).toMatch(/外网聚焦/);
    expect(r.body).toMatch(/c-fallback-fail/);
    expect(isM1NextExternalFocusAction(r.ctaAction)).toBe(true);
  });

  it('external focus helper only for focus actions', () => {
    expect(isM1NextExternalFocusAction('focus-external')).toBe(true);
    expect(isM1NextExternalFocusAction('jump-external-item')).toBe(true);
    expect(isM1NextExternalFocusAction('copy-external-runsheet')).toBe(true);
    expect(isM1NextExternalFocusAction('open-handtest')).toBe(false);
    expect(isM1NextExternalFocusAction('open-dogfood-fill')).toBe(false);
  });

  it('fill helper only for fill actions', () => {
    expect(isM1NextDogfoodFillAction('open-dogfood-fill')).toBe(true);
    expect(isM1NextDogfoodFillAction('copy-dogfood-fill')).toBe(true);
    expect(isM1NextDogfoodFillAction('open-dogfood')).toBe(false);
    expect(isM1NextDogfoodFillAction('open-handtest')).toBe(false);
  });

  it('open-doc helper only for handtest/dogfood actions', () => {
    expect(isM1NextOpenDocAction('open-handtest')).toBe(true);
    expect(isM1NextOpenDocAction('open-dogfood')).toBe(true);
    expect(isM1NextOpenDocAction('reconnect')).toBe(false);
    expect(isM1NextOpenDocAction('jump')).toBe(false);
  });
});
