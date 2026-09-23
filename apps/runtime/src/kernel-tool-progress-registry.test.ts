import { describe, expect, it } from 'vitest';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import { KernelToolProgressRegistry } from './kernel-tool-progress-registry.js';

const runningTool = (toolCallId: string): Extract<AssistantTurnSegment, { kind: 'tool' }> => ({
  id: `segment-${toolCallId}`,
  sequence: 1,
  kind: 'tool',
  toolCallId,
  name: 'command_execution',
  status: 'running',
});

describe('KernelToolProgressRegistry', () => {
  it('keeps the latest non-empty line and accumulates UTF-8 bytes', () => {
    const registry = new KernelToolProgressRegistry();

    expect(registry.append('run-1', 'tool-1', 'first\n second \n', '2026-09-20T01:00:00Z')).toEqual(
      {
        line: 'second',
        bytes: Buffer.byteLength('first\n second \n', 'utf8'),
        at: '2026-09-20T01:00:00Z',
      },
    );
    expect(registry.append('run-1', 'tool-1', '\n中文\n', '2026-09-20T01:00:01Z')).toEqual({
      line: '中文',
      bytes: Buffer.byteLength('first\n second \n\n中文\n', 'utf8'),
      at: '2026-09-20T01:00:01Z',
    });
  });

  it('retains the previous line when a chunk contains only whitespace', () => {
    const registry = new KernelToolProgressRegistry();
    registry.append('run-1', 'tool-1', 'visible', '2026-09-20T01:00:00Z');

    expect(registry.append('run-1', 'tool-1', '\r\n ', '2026-09-20T01:00:01Z').line).toBe(
      'visible',
    );
  });

  it('projects progress only onto matching running tool rows without mutating input', () => {
    const registry = new KernelToolProgressRegistry();
    const timeline: AssistantTurnSegment[] = [
      runningTool('tool-1'),
      { ...runningTool('tool-2'), status: 'completed' },
      {
        id: 'text-1',
        sequence: 2,
        kind: 'text',
        phase: 'commentary',
        text: 'working',
        status: 'completed',
      },
    ];
    registry.append('run-1', 'tool-1', 'latest', '2026-09-20T01:00:00Z');

    const projected = registry.projectTimeline('run-1', timeline);

    expect(projected?.[0]).toMatchObject({
      progressLine: 'latest',
      progressBytes: 6,
      progressAt: '2026-09-20T01:00:00Z',
    });
    expect(projected?.[1]).not.toHaveProperty('progressLine');
    expect(projected?.[2]).not.toHaveProperty('progressLine');
    expect(projected).not.toBe(timeline);
    expect(projected?.[0]).not.toBe(timeline[0]);
    expect(timeline[0]).not.toHaveProperty('progressLine');
  });

  it('cleans one tool or the whole run independently', () => {
    const registry = new KernelToolProgressRegistry();
    registry.append('run-1', 'tool-1', 'one', '2026-09-20T01:00:00Z');
    registry.append('run-1', 'tool-2', 'two', '2026-09-20T01:00:00Z');

    expect(registry.completeTool('run-1', 'tool-1')).toBe(true);
    expect(
      registry.projectTimeline('run-1', [runningTool('tool-1'), runningTool('tool-2')]),
    ).toEqual([
      runningTool('tool-1'),
      expect.objectContaining({ toolCallId: 'tool-2', progressLine: 'two' }),
    ]);
    expect(registry.deleteRun('run-1')).toBe(true);
    expect(registry.projectTimeline('run-1', [runningTool('tool-2')])).toEqual([
      runningTool('tool-2'),
    ]);
  });

  it('returns undefined for an absent or empty timeline', () => {
    const registry = new KernelToolProgressRegistry();

    expect(registry.projectTimeline('run-1', undefined)).toBeUndefined();
    expect(registry.projectTimeline('run-1', [])).toBeUndefined();
  });
});
