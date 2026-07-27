import { describe, expect, it } from 'vitest';
import {
  createDemoProviderRequest,
  createDemoRun,
  projectAdapterEvent,
  serializeDemoRuns,
} from './demo-run.js';

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

  it('never includes image data or the full run snapshot in durable delta payloads', () => {
    const run = createDemoRun('run-image' as never, 'thread-image', 'describe', {
      images: [
        {
          name: 'screen.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
        },
      ],
    });
    const projected = projectAdapterEvent(run, { type: 'text-delta', text: 'ok' });

    expect(projected.nextRun?.images?.[0]?.dataUrl).toContain('data:image/');
    expect(projected.payload).not.toHaveProperty('run');
    expect(JSON.stringify(projected.payload)).not.toContain('data:image/');
    expect(JSON.stringify(serializeDemoRuns(new Map([[run.runId, run]])))).not.toContain(
      'data:image/',
    );
  });

  it('keeps 1000 delta payload bytes linear instead of repeating growing run snapshots', () => {
    let run = createDemoRun('run-long' as never, 'thread-long', 'stream');
    let durablePayloadBytes = 0;
    const delta = '0123456789';

    for (let index = 0; index < 1_000; index++) {
      const projected = projectAdapterEvent(run, {
        type: index % 2 === 0 ? 'text-delta' : 'reasoning-delta',
        text: delta,
      });
      durablePayloadBytes += Buffer.byteLength(JSON.stringify(projected.payload));
      expect(projected.payload).not.toHaveProperty('run');
      run = projected.nextRun!;
    }

    expect(run.assistantText.length + run.reasoningText.length).toBe(10_000);
    expect(durablePayloadBytes).toBeLessThan(250_000);
  });
});
