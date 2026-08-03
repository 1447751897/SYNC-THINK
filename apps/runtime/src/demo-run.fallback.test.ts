import { describe, expect, it } from 'vitest';
import { createDemoRun, parseDemoRuns, serializeDemoRuns } from './demo-run.js';

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
});
