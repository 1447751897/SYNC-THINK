import { describe, expect, it } from 'vitest';
import { createDemoProviderRequest, createDemoRun, projectAdapterEvent } from './demo-run.js';

describe('demo-run reasoning', () => {
  it('forwards reasoningEffort into provider request', () => {
    const run = createDemoRun('run-1' as never, 'thread-1', 'hello', {
      reasoningEffort: 'medium',
    });
    const req = createDemoProviderRequest(run);
    expect(req.reasoningEffort).toBe('medium');
  });

  it('projects reasoning-delta without mixing into assistantText', () => {
    const run = createDemoRun('run-1' as never, 'thread-1', 'hello');
    const step1 = projectAdapterEvent(run, {
      type: 'reasoning-delta',
      text: '先分析问题。',
    });
    expect(step1.type).toBe('message.reasoning_delta');
    expect(step1.payload.textDelta).toBe('先分析问题。');
    expect(step1.nextRun?.reasoningText).toBe('先分析问题。');
    expect(step1.nextRun?.assistantText).toBe('');

    const step2 = projectAdapterEvent(step1.nextRun!, {
      type: 'text-delta',
      text: '结论如下。',
    });
    expect(step2.type).toBe('message.delta');
    expect(step2.nextRun?.assistantText).toBe('结论如下。');
    expect(step2.nextRun?.reasoningText).toBe('先分析问题。');

    const done = projectAdapterEvent(step2.nextRun!, { type: 'finished', reason: 'stop' });
    expect(done.type).toBe('run.completed');
    expect(done.payload.assistantText).toBe('结论如下。');
    expect(done.payload.reasoningText).toBe('先分析问题。');
  });

  it('keeps staged image refs instead of durable base64 blobs', () => {
    const run = createDemoRun('run-image' as never, 'thread-image', 'describe', {
      images: [
        {
          name: 'screen.png',
          mimeType: 'image/png',
          stagingPath: 'D:/staging/screen.png',
        },
      ],
    });
    const projected = projectAdapterEvent(run, { type: 'text-delta', text: 'ok' });
    expect(projected.nextRun?.images).toEqual([
      {
        name: 'screen.png',
        mimeType: 'image/png',
        stagingPath: 'D:/staging/screen.png',
      },
    ]);
    expect(JSON.stringify(projected.payload)).not.toContain('data:image/');
  });
});
