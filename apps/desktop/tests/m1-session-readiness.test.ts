import { describe, expect, it } from 'vitest';
import {
  projectM1SessionReadiness,
  resolveM1SessionChipJump,
  isM1SessionChipJumpable,
} from '../src/renderer/m1-session-readiness.js';

describe('projectM1SessionReadiness (M1 session strip)', () => {
  it('reports empty when nothing is ready', () => {
    const r = projectM1SessionReadiness({
      connectionState: 'offline',
      providers: [],
      manifestCount: 0,
      theme: 'dark',
      traceCollapsed: false,
      hasActiveTask: false,
    });
    expect(r.level).toBe('empty');
    expect(r.summary).toMatch(/等待/);
    expect(r.chips.find((c) => c.id === 'providers')?.detail).toBe('0/2');
    expect(r.chips.find((c) => c.id === 'models')?.detail).toBe('0/3');
    expect(r.chips.find((c) => c.id === 'runtime')?.ok).toBe('0');
    expect(r.chips.find((c) => c.id === 'agent')?.ok).toBe('0');
    expect(r.chips.find((c) => c.id === 'approval')?.detail).toMatch(/空闲/);
    expect(r.chips.find((c) => c.id === 'memory')?.detail).toMatch(/尚无证据/);
  });

  it('reports partial when only one provider is configured', () => {
    const r = projectM1SessionReadiness({
      connectionState: 'online',
      providers: [
        {
          providerId: 'p1',
          protocol: 'openai-chat',
          models: [{}, {}],
          credentials: [{ hasSecret: true }],
        },
      ],
      manifestCount: 0,
      theme: 'light',
      traceCollapsed: true,
      hasActiveTask: true,
      agentDefaultModelId: 'm1',
      approvalPendingCount: 0,
    });
    expect(r.level).toBe('partial');
    expect(r.providersOk).toBe(false);
    expect(r.modelsOk).toBe(false);
    expect(r.chips.find((c) => c.id === 'providers')?.ok).toBe('partial');
    expect(r.chips.find((c) => c.id === 'trace-theme')?.detail).toMatch(/轨迹收起|浅色/);
    expect(r.chips.find((c) => c.id === 'agent')?.ok).toBe('partial');
  });

  it('reports ready soft when dual providers, three models, agent default, approvals idle', () => {
    const r = projectM1SessionReadiness({
      connectionState: 'online',
      providers: [
        {
          providerId: 'p1',
          protocol: 'openai-chat',
          models: [{}],
          credentials: [{ hasSecret: true }],
        },
        {
          providerId: 'p2',
          protocol: 'anthropic-messages',
          models: [{}, {}],
          credentials: [{ hasSecret: true }],
        },
      ],
      manifestCount: 2,
      theme: 'dark',
      traceCollapsed: false,
      hasActiveTask: true,
      agentDefaultModelId: 'm1',
      agentFallbackCount: 1,
      agentSkillBound: 1,
      agentMcpBound: 0,
      approvalPendingCount: 0,
    });
    expect(r.level).toBe('ready');
    expect(r.providersOk).toBe(true);
    expect(r.modelsOk).toBe(true);
    expect(r.manifestOk).toBe(true);
    expect(r.agentOk).toBe(true);
    expect(r.approvalOk).toBe(true);
    expect(r.memoryOk).toBe(true);
    expect(r.summary).toMatch(/soft 就绪/);
    expect(r.note).toMatch(/验证区|dogfood/);
    expect(r.note).not.toMatch(/仍需.*外网/);
    expect(r.chips.find((c) => c.id === 'manifest')?.detail).toMatch(/2 次/);
    expect(r.chips.find((c) => c.id === 'agent')?.detail).toMatch(/F1\/S1|已绑/);
    expect(r.chips.find((c) => c.id === 'approval')?.detail).toMatch(/空闲/);
    expect(r.protocolCount).toBe(2);
  });

  it('exposes agent + approval chips and stays partial when agent model missing or approvals pending', () => {
    const missingAgent = projectM1SessionReadiness({
      connectionState: 'online',
      providers: [
        {
          providerId: 'p1',
          protocol: 'openai-chat',
          models: [{}],
          credentials: [{ hasSecret: true }],
        },
        {
          providerId: 'p2',
          protocol: 'anthropic-messages',
          models: [{}, {}],
          credentials: [{ hasSecret: true }],
        },
      ],
      manifestCount: 1,
      theme: 'dark',
      traceCollapsed: false,
      hasActiveTask: true,
      agentDefaultModelId: null,
      approvalPendingCount: 0,
    });
    expect(missingAgent.level).toBe('partial');
    expect(missingAgent.agentOk).toBe(false);
    expect(missingAgent.chips.find((c) => c.id === 'agent')?.ok).toBe('0');
    expect(missingAgent.summary).toMatch(/Agent|默认模型/);

    const pending = projectM1SessionReadiness({
      connectionState: 'online',
      providers: [
        {
          providerId: 'p1',
          protocol: 'openai-chat',
          models: [{}],
          credentials: [{ hasSecret: true }],
        },
        {
          providerId: 'p2',
          protocol: 'anthropic-messages',
          models: [{}, {}],
          credentials: [{ hasSecret: true }],
        },
      ],
      manifestCount: 1,
      theme: 'dark',
      traceCollapsed: false,
      hasActiveTask: true,
      agentDefaultModelId: 'm1',
      agentFallbackCount: 0,
      approvalPendingCount: 2,
    });
    expect(pending.level).toBe('partial');
    expect(pending.approvalOk).toBe(false);
    expect(pending.chips.find((c) => c.id === 'approval')?.detail).toMatch(/待审 2/);
    expect(pending.summary).toMatch(/待审 2/);
    expect(pending.note).toMatch(/批准中心|待审/);
  });

  it('exposes memory chip and blocks ready when MemoryChange pending', () => {
    const base = {
      connectionState: 'online' as const,
      providers: [
        {
          providerId: 'p1',
          protocol: 'openai-chat',
          models: [{}],
          credentials: [{ hasSecret: true }],
        },
        {
          providerId: 'p2',
          protocol: 'anthropic-messages',
          models: [{}, {}],
          credentials: [{ hasSecret: true }],
        },
      ],
      manifestCount: 1,
      theme: 'dark',
      traceCollapsed: false,
      hasActiveTask: true,
      agentDefaultModelId: 'm1',
      agentFallbackCount: 1,
      approvalPendingCount: 0,
    };

    const withEvidence = projectM1SessionReadiness({
      ...base,
      memoryEntryCount: 2,
      memoryPendingCount: 0,
      memoryDiagCount: 1,
    });
    expect(withEvidence.level).toBe('ready');
    expect(withEvidence.memoryOk).toBe(true);
    expect(withEvidence.chips.find((c) => c.id === 'memory')?.detail).toMatch(/2 条|诊1/);
    expect(withEvidence.chips.find((c) => c.id === 'memory')?.ok).toBe('1');

    const pendingMem = projectM1SessionReadiness({
      ...base,
      memoryEntryCount: 2,
      memoryPendingCount: 3,
      memoryDiagCount: 0,
    });
    expect(pendingMem.level).toBe('partial');
    expect(pendingMem.memoryOk).toBe(false);
    expect(pendingMem.chips.find((c) => c.id === 'memory')?.detail).toMatch(/待审 3/);
    expect(pendingMem.summary).toMatch(/Memory 待审 3/);
    expect(pendingMem.note).toMatch(/Memory|待审|持久记忆/);
  });
});


describe('M1 session chip jump map (cross-panel soft)', () => {
  it('maps each known chip to a stable jump target + Chinese hint', () => {
    const expected: Record<string, string> = {
      runtime: 'none',
      task: 'workspaces',
      providers: 'providers',
      models: 'providers',
      manifest: 'manifest',
      'trace-theme': 'trace',
      agent: 'agent',
      approval: 'approvals',
      memory: 'memory',
    };
    for (const [id, target] of Object.entries(expected)) {
      const j = resolveM1SessionChipJump(id);
      expect(j.target).toBe(target);
      expect(j.hint.length).toBeGreaterThan(4);
    }
    expect(resolveM1SessionChipJump('unknown-x').target).toBe('none');
    expect(isM1SessionChipJumpable('none')).toBe(false);
    expect(isM1SessionChipJumpable('providers')).toBe(true);
    expect(isM1SessionChipJumpable('manifest')).toBe(true);
  });

  it('attaches jumpTarget/jumpHint on every projected chip', () => {
    const r = projectM1SessionReadiness({
      connectionState: 'online',
      providers: [
        {
          providerId: 'p1',
          protocol: 'openai-chat',
          models: [{}],
          credentials: [{ hasSecret: true }],
        },
        {
          providerId: 'p2',
          protocol: 'anthropic-messages',
          models: [{}, {}],
          credentials: [{ hasSecret: true }],
        },
      ],
      manifestCount: 1,
      theme: 'dark',
      traceCollapsed: true,
      hasActiveTask: true,
      agentDefaultModelId: 'm1',
      approvalPendingCount: 0,
    });
    expect(r.chips.length).toBe(9);
    for (const chip of r.chips) {
      expect(chip.jumpTarget).toBeTruthy();
      expect(chip.jumpHint.length).toBeGreaterThan(0);
      const resolved = resolveM1SessionChipJump(chip.id);
      expect(chip.jumpTarget).toBe(resolved.target);
      expect(chip.jumpHint).toBe(resolved.hint);
    }
    expect(r.chips.find((c) => c.id === 'providers')?.jumpTarget).toBe('providers');
    expect(r.chips.find((c) => c.id === 'models')?.jumpTarget).toBe('providers');
    expect(r.chips.find((c) => c.id === 'runtime')?.jumpTarget).toBe('none');
    expect(r.chips.find((c) => c.id === 'trace-theme')?.jumpTarget).toBe('trace');
  });
});
