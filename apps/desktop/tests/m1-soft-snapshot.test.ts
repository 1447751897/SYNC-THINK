import { describe, expect, it } from 'vitest';
import {
  formatM1SoftSnapshot,
  softSnapshotLooksSecretFree,
} from '../src/renderer/m1-soft-snapshot.js';

const base = {
  generatedAt: '2026-07-12T00:00:00Z',
  connectionState: 'online',
  hasActiveTask: true,
  taskTitle: '演示任务',
  providerCount: 2,
  modelCount: 3,
  secretCount: 2,
  providersReadySoft: true,
  agentDefaultSet: true,
  agentFallbackCount: 1,
  sessionLevel: 'ready',
  sessionSummary: '会话 soft 就绪',
  handtestLivePass: 12,
  handtestLiveTotal: 14,
  handtestSoftLiveAllPass: false,
  handtestExternalPending: 4,
  handtestDocChecked: 0,
  handtestDocTotal: 18,
  pendingHandtestLabels: ['同任务切换 ≥3 模型各发一轮', '主模型失败走 Fallback'],
  dogfoodRealDays: 0,
  dogfoodRequired: 3,
  dogfoodFileCount: 1,
  dualAutomatedOk: true,
  hardGatesMet: false,
  exitLevel: 'soft-only',
  nextKind: 'external-handtest',
  nextTitle: '下一步：外网网关 UI 手测',
  nextCtaAction: 'open-handtest',
  distinctMessageModelCount: 1,
  manifestCount: 2,
  hasTraceEvents: true,
};

describe('formatM1SoftSnapshot', () => {
  it('builds markdown with counts and hard-gate reminder', () => {
    const r = formatM1SoftSnapshot(base);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.charCount).toBeGreaterThan(100);
    expect(r.markdown).toMatch(/soft 快照/);
    expect(r.markdown).toMatch(/Provider/);
    expect(r.markdown).toMatch(/0\/18|0\/18/);
    expect(r.markdown).toMatch(/dogfood/);
    expect(r.markdown).toMatch(/不能.*替代|非退出证据/);
    expect(r.markdown).toMatch(/外网网关 UI 手测|external-handtest/);
    expect(r.markdown).toMatch(/同任务切换/);
    expect(r.summary).toMatch(/已复制/);
  });

  it('never claims M1 closed even when hard gates met in input', () => {
    const r = formatM1SoftSnapshot({
      ...base,
      handtestDocChecked: 18,
      dogfoodRealDays: 3,
      hardGatesMet: true,
      exitLevel: 'evidence-ready',
    });
    expect(r.claimsM1Closed).toBe(false);
    expect(r.markdown).toMatch(/open|仍应视为|人工/i);
  });

  it('omits empty pending section', () => {
    const r = formatM1SoftSnapshot({ ...base, pendingHandtestLabels: [] });
    expect(r.markdown).not.toMatch(/仍待关注/);
  });

  it('reports dogfood-only after the handtest document reaches 18/18', () => {
    const r = formatM1SoftSnapshot({
      ...base,
      handtestDocChecked: 18,
      handtestExternalPending: 0,
      pendingHandtestLabels: [],
      dogfoodRealDays: 1,
      nextKind: 'write-dogfood',
      nextTitle: '继续补 dogfood',
    });
    expect(r.markdown).toMatch(/手测.*18\/18.*完成|外网.*已完成/);
    expect(r.markdown).not.toMatch(/用真实外网密钥完成未勾项/);
  });

  it('softSnapshotLooksSecretFree rejects key-like strings', () => {
    expect(softSnapshotLooksSecretFree(formatM1SoftSnapshot(base).markdown)).toBe(
      true,
    );
    expect(
      softSnapshotLooksSecretFree('token sk-abcdefghijklmnopqrstuvwxyz1234'),
    ).toBe(false);
  });
});
