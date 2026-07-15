import { describe, expect, it } from 'vitest';
import {
  dogfoodDraftLooksSecretFree,
  formatM1DogfoodDayDraft,
} from '../src/renderer/m1-dogfood-draft.js';

const base = {
  date: '2026-07-12',
  generatedAt: '2026-07-12T00:00:00Z',
  connectionState: 'online',
  hasActiveTask: true,
  taskTitle: 'demo-task',
  providerCount: 2,
  modelCount: 3,
  secretCount: 1,
  providersReadySoft: true,
  agentDefaultSet: true,
  agentFallbackCount: 1,
  sessionLevel: 'ready',
  sessionSummary: '会话 soft 就绪',
  handtestLivePass: 12,
  handtestLiveTotal: 14,
  handtestDocChecked: 0,
  handtestDocTotal: 18,
  handtestExternalPending: 4,
  externalPendingLabels: ['同任务切换 ≥3 模型各发一轮', '主模型失败走 Fallback'],
  dogfoodRealDays: 0,
  dogfoodRequired: 3,
  dogfoodFileCount: 1,
  dualAutomatedOk: true,
  hardGatesMet: false,
  exitLevel: 'soft-only',
  nextKind: 'external-handtest',
  nextTitle: '下一步：外网网关 UI 手测',
  distinctMessageModelCount: 1,
  manifestCount: 1,
  hasTraceEvents: true,
  softCraftRound: 42,
};

describe('formatM1DogfoodDayDraft', () => {
  it('builds dated draft without claiming real dogfood or M1 closed', () => {
    const r = formatM1DogfoodDayDraft(base);
    expect(r.date).toBe('2026-07-12');
    expect(r.claimsM1Closed).toBe(false);
    expect(r.claimsDogfoodReal).toBe(false);
    expect(r.markdown).toMatch(/Dogfood · 2026-07-12/);
    expect(r.markdown).toMatch(/粘贴辅助|待你确认/);
    expect(r.markdown).toMatch(/不改变里程碑状态|不改变 M1 状态/);
    expect(r.markdown).toMatch(/M2 已完成/);
    expect(r.markdown).not.toMatch(/勿启动 M2/);
    expect(r.markdown).toMatch(/外网待证项/);
    expect(r.markdown).toMatch(/demo-task/);
    expect(r.summary).toMatch(/已复制 dogfood 草稿/);
    expect(dogfoodDraftLooksSecretFree(r.markdown)).toBe(true);
  });

  it('defaults date when missing', () => {
    const r = formatM1DogfoodDayDraft({ ...base, date: undefined });
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never claims real day even when hard gates input true', () => {
    const r = formatM1DogfoodDayDraft({
      ...base,
      hardGatesMet: true,
      dogfoodRealDays: 3,
      handtestDocChecked: 18,
    });
    expect(r.claimsDogfoodReal).toBe(false);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.markdown).toMatch(/仍 open|不能|待你确认/);
  });

  it('does not ask to repeat completed external handtests', () => {
    const r = formatM1DogfoodDayDraft({
      ...base,
      handtestDocChecked: 18,
      handtestDocTotal: 18,
      handtestExternalPending: 0,
      externalPendingLabels: [],
      dogfoodRealDays: 1,
    });
    expect(r.markdown).toMatch(/外网手测.*18\/18.*完成|手测文档.*18\/18/);
    expect(r.markdown).not.toMatch(/外网仍需|外网真实网关路径：待你确认|外网待证项/);
  });

  it('rejects secret-like text in guard', () => {
    expect(dogfoodDraftLooksSecretFree('key sk-abcdefghijklmnopqrstuvwxyz1234')).toBe(false);
  });
});
