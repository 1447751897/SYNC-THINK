import { expect, it } from 'vitest';
import { resolveOrchestrationCompletion } from './orchestration-completion.js';

it.each([
  ['running', ['completed', 'skipped'], false, 'completed'],
  ['reviewing', ['completed'], true, undefined],
  ['paused', ['completed'], false, undefined],
  ['paused', ['failed'], false, undefined],
  ['running', ['failed', 'pending'], false, 'failed'],
  ['running', ['failed', 'running'], false, undefined],
  ['running', ['failed', 'ready'], false, undefined],
  ['running', ['failed', 'awaitingApproval'], false, undefined],
  ['running', ['pending'], false, undefined],
] as const)(
  'preserves the completion rule for %s / %j / gate=%s',
  (state, steps, gate, expected) => {
    expect(
      resolveOrchestrationCompletion({ state, stepStates: steps, hasUnresolvedGate: gate }),
    ).toBe(expected);
  },
);
