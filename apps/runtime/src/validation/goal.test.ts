import { describe, expect, it } from 'vitest';
import {
  parseGoalSetPayload,
  parseGoalClearPayload,
  parseGoalResumePayload,
  GOAL_CONDITION_MAX_LENGTH,
} from './goal.js';
import {
  formatGoalTurnModelPrompt,
  formatGoalTurnUserMessage,
  parseGoalTurnStatus,
  stripGoalStatus,
} from '../runtime.js';

describe('parseGoalSetPayload', () => {
  it('accepts a valid condition', () => {
    expect(parseGoalSetPayload({ conversationId: 'conv-1', condition: ' 所有测试通过 ' })).toEqual({
      conversationId: 'conv-1',
      condition: '所有测试通过',
    });
  });

  it('preserves the composer route for every automatic goal round', () => {
    expect(
      parseGoalSetPayload({
        conversationId: 'conv-1',
        condition: '完成全部验证',
        modelId: 'model-luna',
        kernelId: 'gpt',
        reasoningEffort: 'high',
        networkEnabled: true,
        maxGoalRounds: 7,
        stopCondition: '所有回归测试通过并有截图证据',
        maxGoalTokens: 25_000,
      }),
    ).toEqual({
      conversationId: 'conv-1',
      condition: '完成全部验证',
      modelId: 'model-luna',
      kernelId: 'gpt',
      reasoningEffort: 'high',
      networkEnabled: true,
      maxGoalRounds: 7,
      stopCondition: '所有回归测试通过并有截图证据',
      maxGoalTokens: 25_000,
    });
  });

  it('rejects missing/empty/oversized conditions', () => {
    expect(parseGoalSetPayload({ conversationId: 'conv-1' })).toBeUndefined();
    expect(parseGoalSetPayload({ conversationId: 'conv-1', condition: '   ' })).toBeUndefined();
    expect(
      parseGoalSetPayload({
        conversationId: 'conv-1',
        condition: 'x'.repeat(GOAL_CONDITION_MAX_LENGTH + 1),
      }),
    ).toBeUndefined();
  });

  it('rejects invalid token budgets and oversized stop conditions', () => {
    expect(
      parseGoalSetPayload({
        conversationId: 'conv-1',
        condition: '完成目标',
        maxGoalRounds: 51,
      }),
    ).toBeUndefined();
    expect(
      parseGoalSetPayload({
        conversationId: 'conv-1',
        condition: '完成目标',
        maxGoalTokens: 9_999,
      }),
    ).toBeUndefined();
    expect(
      parseGoalSetPayload({
        conversationId: 'conv-1',
        condition: '完成目标',
        maxGoalTokens: 10_000.5,
      }),
    ).toBeUndefined();
    expect(
      parseGoalSetPayload({
        conversationId: 'conv-1',
        condition: '完成目标',
        stopCondition: 'x'.repeat(GOAL_CONDITION_MAX_LENGTH + 1),
      }),
    ).toBeUndefined();
  });

  it('rejects missing conversation id and non-object payloads', () => {
    expect(parseGoalSetPayload({ condition: '目标' })).toBeUndefined();
    expect(parseGoalSetPayload(null)).toBeUndefined();
    expect(parseGoalSetPayload('nope')).toBeUndefined();
  });
});

describe('parseGoalClearPayload', () => {
  it('accepts a conversation id', () => {
    expect(parseGoalClearPayload({ conversationId: 'conv-1' })).toEqual({
      conversationId: 'conv-1',
    });
  });
  it('rejects missing id', () => {
    expect(parseGoalClearPayload({})).toBeUndefined();
  });
});

describe('parseGoalResumePayload', () => {
  it('updates an existing goal to the current composer route', () => {
    expect(
      parseGoalResumePayload({
        conversationId: 'conv-1',
        modelId: 'model-luna',
        kernelId: 'gpt',
        reasoningEffort: 'medium',
      }),
    ).toEqual({
      conversationId: 'conv-1',
      modelId: 'model-luna',
      kernelId: 'gpt',
      reasoningEffort: 'medium',
    });
  });
});

describe('work-model Goal status protocol', () => {
  it('uses the last status marker and accepts the Chinese colon', () => {
    expect(
      parseGoalTurnStatus(
        '中间状态 GOAL_STATUS: blocked\n最终状态 GOAL_STATUS：continue',
      ),
    ).toBe('continue');
    expect(parseGoalTurnStatus('已经完成\nGOAL_STATUS: complete')).toBe('complete');
    expect(parseGoalTurnStatus('尚未声明状态')).toBeUndefined();
  });

  it('removes standalone control lines but preserves inline prose', () => {
    expect(stripGoalStatus('可验收结果\nGOAL_STATUS: complete\n')).toBe('可验收结果');
    expect(stripGoalStatus('说明 GOAL_STATUS: continue 的含义')).toBe(
      '说明 GOAL_STATUS: continue 的含义',
    );
  });
});

describe('goal turn visible message', () => {
  const baseGoal = {
    conversationId: 'conv-1',
    condition: '检查项目剩余短板',
    status: 'active' as const,
    startedAt: '2026-08-28T00:00:00.000Z',
    turnCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    maxGoalRounds: 5,
  };

  it('shows the original goal as the first user message and labels later rounds', () => {
    expect(formatGoalTurnUserMessage(baseGoal)).toBe('检查项目剩余短板');
    expect(
      formatGoalTurnUserMessage({
        ...baseGoal,
        roundsStarted: 2,
        lastReason: '还缺少桌面端视觉验证',
      }),
    ).toBe('继续目标（第 3/5 轮）：处理上一轮未完成项：还缺少桌面端视觉验证');
  });

  it('injects the stopping condition and NewMax status contract into every round', () => {
    expect(
      formatGoalTurnModelPrompt({
        ...baseGoal,
        stopCondition: '所有回归测试通过',
        maxGoalTokens: 25_000,
      }),
    ).toContain('停止条件：所有回归测试通过');
    expect(formatGoalTurnModelPrompt(baseGoal)).toContain('GOAL_STATUS: complete');
    expect(formatGoalTurnModelPrompt(baseGoal)).toContain('GOAL_STATUS: continue');
    expect(formatGoalTurnModelPrompt(baseGoal)).toContain('GOAL_STATUS: blocked');
  });
});
