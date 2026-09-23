import type { RunState, StepState } from './types/enums.js';

/** Domain policy only. Persistence owns the transaction and event append. */
export function resolveOrchestrationCompletion(input: {
  state: RunState;
  stepStates: readonly StepState[];
  hasUnresolvedGate: boolean;
}): 'completed' | 'failed' | undefined {
  if (input.state === 'paused') return undefined;
  if (
    !input.hasUnresolvedGate &&
    input.stepStates.every((state) => state === 'completed' || state === 'skipped')
  ) {
    return 'completed';
  }
  if (
    input.stepStates.includes('failed') &&
    input.stepStates.every(
      (state) => state !== 'running' && state !== 'ready' && state !== 'awaitingApproval',
    )
  )
    return 'failed';
  return undefined;
}
