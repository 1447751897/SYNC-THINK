import { describe, expect, it } from 'vitest';
import {
  parsePlanActSetting,
  resolvePlanActRouteForContext,
  resolvePlanActRouting,
  type PlanActSettingValue,
} from '../src/plan-act.js';

describe('parsePlanActSetting', () => {
  it('returns an empty object for null / non-object input', () => {
    expect(parsePlanActSetting(undefined)).toEqual({});
    expect(parsePlanActSetting(null)).toEqual({});
    expect(parsePlanActSetting('plan')).toEqual({});
  });

  it('normalizes the full shape', () => {
    expect(
      parsePlanActSetting({
        enabled: true,
        planModelId: 'model-a',
        actModelId: 'model-b',
        planReasoningEffort: 'high',
        actReasoningEffort: 'auto',
      }),
    ).toEqual({
      enabled: true,
      planModelId: 'model-a',
      actModelId: 'model-b',
      planReasoningEffort: 'high',
      actReasoningEffort: 'auto',
    });
  });

  it('coerces non-string ids / efforts to null', () => {
    const parsed = parsePlanActSetting({
      enabled: 1,
      planModelId: 42,
      actModelId: '',
      planReasoningEffort: null,
      actReasoningEffort: ' medium ',
    });
    expect(parsed.enabled).toBe(false);
    expect(parsed.planModelId).toBeNull();
    expect(parsed.actModelId).toBeNull();
    expect(parsed.actReasoningEffort).toBe(' medium ');
  });
});

describe('resolvePlanActRouting', () => {
  const full: PlanActSettingValue = {
    enabled: true,
    planModelId: 'planner-1',
    actModelId: 'executor-1',
    planReasoningEffort: 'high',
    actReasoningEffort: 'low',
  };

  it('does nothing when the setting is disabled', () => {
    expect(resolvePlanActRouting({ ...full, enabled: false }, true)).toEqual({
      applied: false,
      role: null,
    });
  });

  it('routes the planning model + effort in planning mode', () => {
    expect(resolvePlanActRouting(full, true)).toEqual({
      applied: true,
      role: 'plan',
      modelId: 'planner-1',
      reasoningEffort: 'high',
    });
  });

  it('routes the execution model + effort in execute mode', () => {
    expect(resolvePlanActRouting(full, false)).toEqual({
      applied: true,
      role: 'act',
      modelId: 'executor-1',
      reasoningEffort: 'low',
    });
  });

  it('falls back to no-op when the role model is missing', () => {
    expect(resolvePlanActRouting({ ...full, planModelId: '' }, true)).toEqual({
      applied: false,
      role: null,
    });
    expect(resolvePlanActRouting({ ...full, actModelId: null }, false)).toEqual({
      applied: false,
      role: null,
    });
  });

  it('omits effort when not configured for the role', () => {
    const route = resolvePlanActRouting(
      { enabled: true, planModelId: 'planner-1', actModelId: 'executor-1' },
      true,
    );
    expect(route).toEqual({ applied: true, role: 'plan', modelId: 'planner-1' });
    expect(route.reasoningEffort).toBeUndefined();
  });

  it('trims model ids before applying', () => {
    const route = resolvePlanActRouting({ enabled: true, planModelId: '  planner-1  ' }, true);
    expect(route.modelId).toBe('planner-1');
  });
});

describe('resolvePlanActRouteForContext', () => {
  const full: PlanActSettingValue = {
    enabled: true,
    planModelId: 'planner-1',
    actModelId: 'executor-1',
    planReasoningEffort: 'high',
    actReasoningEffort: 'low',
  };

  it('routes the planning model in planning mode (even with planExecuting)', () => {
    expect(
      resolvePlanActRouteForContext(full, { planningMode: true, planExecuting: true }),
    ).toEqual({ applied: true, role: 'plan', modelId: 'planner-1', reasoningEffort: 'high' });
  });

  it('routes the execution model only when planExecuting is set', () => {
    expect(
      resolvePlanActRouteForContext(full, { planningMode: false, planExecuting: true }),
    ).toEqual({ applied: true, role: 'act', modelId: 'executor-1', reasoningEffort: 'low' });
  });

  it('does not route ordinary execute-mode messages (manual override wins)', () => {
    expect(
      resolvePlanActRouteForContext(full, { planningMode: false, planExecuting: false }),
    ).toEqual({ applied: false, role: null });
  });

  it('respects disabled / unconfigured settings in every context', () => {
    expect(
      resolvePlanActRouteForContext(
        { enabled: false, planModelId: 'planner-1', actModelId: 'executor-1' },
        { planningMode: true, planExecuting: true },
      ),
    ).toEqual({ applied: false, role: null });
    expect(
      resolvePlanActRouteForContext(
        { enabled: true, planModelId: null, actModelId: null },
        { planningMode: false, planExecuting: true },
      ),
    ).toEqual({ applied: false, role: null });
  });
});
