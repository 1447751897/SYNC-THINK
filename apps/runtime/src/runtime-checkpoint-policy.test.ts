import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RUNTIME_CHECKPOINT_EVENT_INTERVAL,
  shouldCreateRuntimeCheckpoint,
} from './runtime-checkpoint-policy.js';

describe('runtime checkpoint policy', () => {
  it('does not checkpoint before the durable event interval is reached', () => {
    expect(
      shouldCreateRuntimeCheckpoint({
        lastCheckpointEventSequence: 0,
        projectedLastEventSequence: DEFAULT_RUNTIME_CHECKPOINT_EVENT_INTERVAL - 1,
        eventTypes: ['message.appended'],
      }),
    ).toBe(false);
  });

  it('checkpoints when the durable event interval is reached', () => {
    expect(
      shouldCreateRuntimeCheckpoint({
        lastCheckpointEventSequence: 0,
        projectedLastEventSequence: DEFAULT_RUNTIME_CHECKPOINT_EVENT_INTERVAL,
        eventTypes: ['provider.usage'],
      }),
    ).toBe(true);
  });

  it.each(['run.completed', 'run.failed', 'run.cancelled', 'run.paused'])(
    'always checkpoints the terminal boundary %s',
    (eventType) => {
      expect(
        shouldCreateRuntimeCheckpoint({
          lastCheckpointEventSequence: 120,
          projectedLastEventSequence: 121,
          eventTypes: [eventType],
        }),
      ).toBe(true);
    },
  );

  it('does not force a checkpoint for fallback/context observability events', () => {
    expect(
      shouldCreateRuntimeCheckpoint({
        lastCheckpointEventSequence: 120,
        projectedLastEventSequence: 122,
        eventTypes: ['run.fallback.selected', 'context.packet.built'],
      }),
    ).toBe(false);
  });

  it('continues cadence from the last restored checkpoint sequence', () => {
    expect(
      shouldCreateRuntimeCheckpoint({
        lastCheckpointEventSequence: 1_000,
        projectedLastEventSequence: 1_127,
        eventTypes: ['message.appended'],
      }),
    ).toBe(false);
    expect(
      shouldCreateRuntimeCheckpoint({
        lastCheckpointEventSequence: 1_000,
        projectedLastEventSequence: 1_128,
        eventTypes: ['message.appended'],
      }),
    ).toBe(true);
  });
});
