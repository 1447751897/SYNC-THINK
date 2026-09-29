import { describe, expect, it } from 'vitest';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import {
  KernelToolProgressRegistry,
  MAX_TOOL_PROGRESS_BYTES,
  MAX_TOOL_PROGRESS_LINES,
  withoutKernelToolProgress,
} from './kernel-tool-progress-registry.js';

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
        output: 'first\n second \n',
        truncated: false,
        bytes: Buffer.byteLength('first\n second \n', 'utf8'),
        at: '2026-09-20T01:00:00Z',
      },
    );
    expect(registry.append('run-1', 'tool-1', '\n中文\n', '2026-09-20T01:00:01Z')).toEqual({
      line: '中文',
      output: 'first\n second \n\n中文\n',
      truncated: false,
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

it('joins split lines and bounds UTF-8 tails without corrupting multibyte characters', () => {
  const registry = new KernelToolProgressRegistry();
  registry.append('r', 't', 'hello wor', '1');
  expect(registry.append('r', 't', 'ld\n', '2')).toMatchObject({
    line: 'hello world',
    output: 'hello world\n',
  });
  const text = '🦊中文'.repeat(10_000) + '\nlast line';
  const progress = registry.append('r', 't', text, '3');
  expect(Buffer.byteLength(progress.output)).toBeLessThanOrEqual(MAX_TOOL_PROGRESS_BYTES);
  expect(progress.output).not.toContain('�');
  expect(progress.output.endsWith('last line')).toBe(true);
  expect(progress.truncated).toBe(true);
  expect(progress.bytes).toBe(Buffer.byteLength('hello world\n' + text));
  const manyLines = registry.append(
    'r',
    't',
    '\n' + Array.from({ length: 600 }, (_, i) => 'line-' + i).join('\n'),
    '4',
  );
  expect(manyLines.output.split('\n')).toHaveLength(MAX_TOOL_PROGRESS_LINES);
  expect(manyLines.output.endsWith('line-599')).toBe(true);
});

it('isolates identical tool IDs across runs and excludes progress from durable records', () => {
  const registry = new KernelToolProgressRegistry();
  registry.append('a', 'tool', 'one', '1');
  registry.append('b', 'tool', 'two', '2');
  const projected = registry.projectTimeline('a', [runningTool('tool')])![0]!;
  expect(projected).toMatchObject({ progressOutput: 'one' });
  expect(registry.projectTimeline('b', [runningTool('tool')])![0]).toMatchObject({
    progressOutput: 'two',
  });
  expect(withoutKernelToolProgress(projected)).toEqual(runningTool('tool'));
  expect(projected).toHaveProperty('progressOutput', 'one');
  registry.deleteRun('a');
  expect(registry.projectTimeline('a', [runningTool('tool')])).toEqual([runningTool('tool')]);
});

it('labels adapter truncation and keeps reminder text out of stdout', () => {
  const registry = new KernelToolProgressRegistry();
  registry.append('r', 't', 'tail', '1', { truncated: true, outputBytes: 100_000 });
  expect(registry.append('r', 't', '仍在执行', '2', { isNotice: true })).toMatchObject({
    line: '仍在执行',
    output: 'tail',
    bytes: 100_000,
    truncated: true,
  });
});
