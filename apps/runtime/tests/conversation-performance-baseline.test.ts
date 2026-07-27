import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  projectAdapterEvent,
  serializeDemoRuns,
} from '../src/demo-run.js';

describe('conversation performance baseline', () => {
  it('keeps 1000 durable delta payloads linear and free of full run snapshots', () => {
    let run = createDemoRun('run-performance-baseline' as never, 'thread-performance', 'stream');
    let durablePayloadBytes = 0;
    const delta = '0123456789';

    for (let index = 0; index < 1_000; index++) {
      const projected = projectAdapterEvent(run, {
        type: index % 2 === 0 ? 'text-delta' : 'reasoning-delta',
        text: delta,
      });

      const serializedPayload = JSON.stringify(projected.payload);
      durablePayloadBytes += Buffer.byteLength(serializedPayload);
      expect(projected.payload).not.toHaveProperty('run');
      expect(serializedPayload).not.toContain('data:image/');
      run = projected.nextRun!;
    }

    expect(run.assistantText.length + run.reasoningText.length).toBe(10_000);
    expect(durablePayloadBytes).toBeLessThan(250_000);
  });

  it('keeps image data out of durable events and checkpoints', () => {
    const run = createDemoRun('run-image-baseline' as never, 'thread-image', 'describe image', {
      images: [
        {
          name: 'screen.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
          stagingPath: 'D:/staging/screen.png',
        },
      ],
    });

    const projected = projectAdapterEvent(run, { type: 'text-delta', text: 'ok' });
    const durableEventPayload = JSON.stringify(projected.payload);
    const checkpointPayload = JSON.stringify(serializeDemoRuns(new Map([[run.runId, run]])));

    expect(projected.nextRun?.images?.[0]?.dataUrl).toContain('data:image/');
    expect(durableEventPayload).not.toContain('data:image/');
    expect(checkpointPayload).not.toContain('data:image/');
    expect(checkpointPayload).toContain('D:/staging/screen.png');
  });
});
