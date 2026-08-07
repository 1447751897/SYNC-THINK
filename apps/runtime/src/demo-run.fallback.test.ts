import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  MODEL_RETRY_MAX,
  parseDemoRuns,
  retryDelayForModel,
  serializeDemoRuns,
  shouldRetrySameModel,
} from './demo-run.js';

describe('same-model in-place retry policy', () => {
  it('retries transient failures up to MODEL_RETRY_MAX when nothing was emitted', () => {
    expect(
      shouldRetrySameModel({ failureClass: 'transient', retryCount: 0, hasOutput: false }),
    ).toBe(true);
    expect(
      shouldRetrySameModel({ failureClass: 'timeout', retryCount: 3, hasOutput: false }),
    ).toBe(true);
    // Budget exhausted → hand over to the fallback chain.
    expect(
      shouldRetrySameModel({
        failureClass: 'transient',
        retryCount: MODEL_RETRY_MAX,
        hasOutput: false,
      }),
    ).toBe(false);
  });

  it('never retries once output has started (partial output must not be duplicated)', () => {
    expect(
      shouldRetrySameModel({ failureClass: 'transient', retryCount: 0, hasOutput: true }),
    ).toBe(false);
  });

  it('does not retry non-retryable classes (auth / protocol / unknown)', () => {
    for (const failureClass of ['auth', 'protocol', 'unknown', 'acceptance'] as const) {
      expect(
        shouldRetrySameModel({ failureClass, retryCount: 0, hasOutput: false }),
      ).toBe(false);
    }
  });

  it('backs off exponentially and caps at 8s', () => {
    expect(retryDelayForModel(0)).toBe(500);
    expect(retryDelayForModel(1)).toBe(1_000);
    expect(retryDelayForModel(2)).toBe(2_000);
    expect(retryDelayForModel(3)).toBe(4_000);
    expect(retryDelayForModel(4)).toBe(8_000);
    expect(retryDelayForModel(9)).toBe(8_000);
  });
});

describe('DemoRun durable fallback attempt fence', () => {
  it('starts with the initially selected model and preserves ordered attempts', () => {
    const run = createDemoRun('run-fallback-fence' as never, 'thread-1', 'hello', {
      modelId: 'model-a',
      providerModelId: 'provider-model-a',
    });
    expect(run.attemptedModelIds).toEqual(['model-a']);

    const rebound = {
      ...run,
      modelId: 'model-b',
      providerModelId: 'provider-model-b',
      attemptedModelIds: ['model-a', 'model-b'],
    };
    const restored = parseDemoRuns(
      serializeDemoRuns(new Map([[rebound.runId, rebound]])),
    )[0]!;

    expect(restored.attemptedModelIds).toEqual(['model-a', 'model-b']);
  });

  it('initializes legacy checkpoints from the currently bound model', () => {
    const run = createDemoRun('run-legacy-fence' as never, 'thread-1', 'hello', {
      modelId: 'model-current',
    });
    const legacy = { ...serializeDemoRuns(new Map([[run.runId, run]]))[0]! } as Partial<
      typeof run
    >;
    delete legacy.attemptedModelIds;

    const restored = parseDemoRuns([legacy])[0]!;

    expect(restored.attemptedModelIds).toEqual(['model-current']);
  });

  it('persists the same-model retry budget across checkpoints', () => {
    const run = createDemoRun('run-retry-budget' as never, 'thread-1', 'hello', {
      modelId: 'model-a',
      providerModelId: 'provider-model-a',
    });
    const withRetries = { ...run, retryCount: 3 };
    const restored = parseDemoRuns(
      serializeDemoRuns(new Map([[run.runId, withRetries]])),
    )[0]!;

    expect(restored.retryCount).toBe(3);
  });
});
