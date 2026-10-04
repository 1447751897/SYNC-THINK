import { describe, expect, it } from 'vitest';
import { createDemoRun, parseDemoRuns, projectAdapterEvent, serializeDemoRun } from './demo-run.js';
import type { RunId } from '@sync-think/shared';
import {
  decideNativeTaskContinuation,
  isProgressBoundedNativeTask,
  recoverRejectedOutputReserve,
  type NativeTaskContinuationState,
} from './native-task-continuation.js';
const input = {
  reason: 'length' as const,
  progress: '',
  currentOutputTokens: 8192,
  contextWindow: 128000,
};
describe('native task continuation policy', () => {
  it('treats a raw truncated completion as unfinished, never success', () => {
    expect(
      projectAdapterEvent(createDemoRun('run-limit' as RunId, 'thread-limit', 'deliver'), {
        type: 'finished',
        reason: 'length',
      }),
    ).toMatchObject({
      type: 'run.failed',
      terminal: true,
      payload: { failureClass: 'output_limit' },
    });
  });
  it('has no total-round limit while each round produces new output', () => {
    let previous: NativeTaskContinuationState | undefined;
    for (let n = 0; n < 50; n++) {
      const result = decideNativeTaskContinuation({
        ...input,
        previous,
        progress: 'new section ' + n,
      });
      expect(result.blocked).toBe(false);
      previous = result.state;
    }
    expect(previous!.rounds).toBe(50);
  });
  it('bounds consecutive empty or duplicate continuation attempts', () => {
    let result = decideNativeTaskContinuation({ ...input, progress: 'same text' });
    for (let n = 0; n < 3; n++)
      result = decideNativeTaskContinuation({
        ...input,
        progress: 'same text',
        previous: result.state,
      });
    expect(result.blocked).toBe(true);
    expect(result.message).toContain('没有新增进展');
  });
  it('raises the per-request reserve without exceeding model or context limits', () => {
    expect(decideNativeTaskContinuation(input).state.outputTokens).toBe(16384);
    expect(
      decideNativeTaskContinuation({ ...input, modelMaxOutputTokens: 9000 }).state.outputTokens,
    ).toBe(9000);
    expect(
      decideNativeTaskContinuation({ ...input, contextWindow: 16000 }).state.outputTokens,
    ).toBe(4000);
  });
  it('roundtrips continuation and no-progress state in a durable run checkpoint', () => {
    const state = decideNativeTaskContinuation(input).state;
    const run = {
      ...createDemoRun('run-checkpoint' as RunId, 'thread-checkpoint', 'deliver'),
      nativeTaskContinuation: state,
    };
    expect(parseDemoRuns([serializeDemoRun(run)])[0]!.nativeTaskContinuation).toEqual(state);
  });
});

it('falls back once when a gateway rejects an increased output reserve, not on unrelated failures', () => {
  const state = decideNativeTaskContinuation(input).state;
  expect(recoverRejectedOutputReserve(state, 'Invalid max_tokens: maximum is 8192')).toMatchObject({
    outputTokens: 8192,
    outputIncreaseRejected: true,
  });
  const recovered = recoverRejectedOutputReserve(state, 'max_tokens too large')!;
  expect(recoverRejectedOutputReserve(recovered, 'max_tokens too large')).toBeUndefined();
  expect(recoverRejectedOutputReserve(state, 'authentication failed')).toBeUndefined();
});


describe('native continuation eligibility', () => {
  it.each([
    [{ delegated: false, explicitlyBudgeted: false, collaborationScoped: false, scheduled: false }, true],
    [{ delegated: false, explicitlyBudgeted: false, collaborationScoped: false, scheduled: true }, true],
    [{ delegated: false, explicitlyBudgeted: false, collaborationScoped: true, scheduled: true }, true],
    [{ delegated: false, explicitlyBudgeted: false, collaborationScoped: true, scheduled: false }, false],
    [{ delegated: true, explicitlyBudgeted: false, collaborationScoped: false, scheduled: true }, false],
    [{ delegated: false, explicitlyBudgeted: true, collaborationScoped: false, scheduled: true }, false],
    [{ delegated: false, explicitlyBudgeted: true, collaborationScoped: false, scheduled: false }, false],
  ])('respects explicit task boundaries: %j', (scope, expected) => {
    expect(isProgressBoundedNativeTask(scope)).toBe(expected);
  });
});


it('does not count surrounding whitespace on a repeated answer as new continuation progress', () => {
  let result = decideNativeTaskContinuation({ ...input, progress: 'same pending work' });
  for (let n = 0; n < 3; n++) result = decideNativeTaskContinuation({ ...input, previous: result.state, progress: '\n same pending work ' + ' '.repeat(n) });
  expect(result.blocked).toBe(true);
  expect(result.state.stagnantRounds).toBe(3);
});
