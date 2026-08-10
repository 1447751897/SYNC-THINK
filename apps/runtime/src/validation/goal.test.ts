import { describe, expect, it } from 'vitest';
import { parseGoalSetPayload, parseGoalClearPayload, GOAL_CONDITION_MAX_LENGTH } from './goal.js';
import { parseGoalEvaluatorOutput } from '../runtime.js';

describe('parseGoalSetPayload', () => {
  it('accepts a valid condition', () => {
    expect(parseGoalSetPayload({ conversationId: 'conv-1', condition: ' 所有测试通过 ' })).toEqual({
      conversationId: 'conv-1',
      condition: '所有测试通过',
    });
  });

  it('rejects missing/empty/oversized conditions', () => {
    expect(parseGoalSetPayload({ conversationId: 'conv-1' })).toBeUndefined();
    expect(parseGoalSetPayload({ conversationId: 'conv-1', condition: '   ' })).toBeUndefined();
    expect(
      parseGoalSetPayload({ conversationId: 'conv-1', condition: 'x'.repeat(GOAL_CONDITION_MAX_LENGTH + 1) }),
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
    expect(parseGoalClearPayload({ conversationId: 'conv-1' })).toEqual({ conversationId: 'conv-1' });
  });
  it('rejects missing id', () => {
    expect(parseGoalClearPayload({})).toBeUndefined();
  });
});

describe('parseGoalEvaluatorOutput', () => {
  it('extracts JSON answers', () => {
    expect(parseGoalEvaluatorOutput('{"met": true, "reason": "测试全部通过"}')).toEqual({
      met: true,
      reason: '测试全部通过',
    });
    expect(parseGoalEvaluatorOutput('前缀 {"met": false, "reason": "还有失败用例"}')).toEqual({
      met: false,
      reason: '还有失败用例',
    });
  });

  it('falls back to keyword matching', () => {
    expect(parseGoalEvaluatorOutput('yes，条件已满足')).toMatchObject({ met: true });
    expect(parseGoalEvaluatorOutput('尚未完成，继续')).toMatchObject({ met: false });
    expect(parseGoalEvaluatorOutput('')).toBeUndefined();
  });
});
