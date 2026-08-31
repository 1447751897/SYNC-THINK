import { describe, expect, it } from 'vitest';
import { parseComposerPlanActSetting, resolveComposerModelSelection } from './composer-plan-model.js';

describe('composer plan model selection', () => {
  it('parses the full runtime plan-act contract including reasoning', () => {
    expect(
      parseComposerPlanActSetting({
        enabled: true,
        planModelId: 'planner',
        actModelId: 'actor',
        planReasoningEffort: 'high',
        actReasoningEffort: 'low',
      }),
    ).toEqual({
      enabled: true,
      planModelId: 'planner',
      actModelId: 'actor',
      planReasoningEffort: 'high',
      actReasoningEffort: 'low',
    });
  });

  it('routes the visible composer model only while Plan is active', () => {
    const setting = parseComposerPlanActSetting({
      enabled: true,
      planModelId: 'planner',
      planReasoningEffort: 'max',
    });
    expect(
      resolveComposerModelSelection({
        planMode: true,
        setting,
        currentModelId: 'chat',
        currentReasoningEffort: 'auto',
      }),
    ).toEqual({ modelId: 'planner', reasoningEffort: 'max', routed: true });
    expect(
      resolveComposerModelSelection({
        planMode: false,
        setting,
        currentModelId: 'chat',
        currentReasoningEffort: 'auto',
      }),
    ).toEqual({ modelId: 'chat', reasoningEffort: 'auto', routed: false });
  });
});
