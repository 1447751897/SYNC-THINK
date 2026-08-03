export const DEFAULT_RUNTIME_CHECKPOINT_EVENT_INTERVAL = 128;

const TERMINAL_RUNTIME_EVENT_TYPES = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.paused',
]);

export interface RuntimeCheckpointDecisionInput {
  lastCheckpointEventSequence: number;
  projectedLastEventSequence: number;
  eventTypes: readonly string[];
  interval?: number;
}

export function shouldCreateRuntimeCheckpoint(input: RuntimeCheckpointDecisionInput): boolean {
  if (input.eventTypes.some((eventType) => TERMINAL_RUNTIME_EVENT_TYPES.has(eventType))) {
    return true;
  }

  const interval = input.interval ?? DEFAULT_RUNTIME_CHECKPOINT_EVENT_INTERVAL;
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error('Runtime checkpoint interval must be a positive integer');
  }

  return input.projectedLastEventSequence - input.lastCheckpointEventSequence >= interval;
}