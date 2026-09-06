import { describe, expect, it } from 'vitest';
import { encodeFrame, MAX_FRAME_BYTES } from '@sync-think/protocol';
import type { Event, RunId } from '@sync-think/shared';
import { projectRunProcess, projectRunProcessSnapshot } from './run-process-view.js';
import { paginateRunProcess } from './run-process-page.js';

function requests(count: number, commandSize = 0): Event[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    sequence: index + 1,
    workspaceId: 'workspace',
    taskId: 'task',
    runId: 'run',
    category: 'tool',
    type: 'tool.requested',
    occurredAt: '2026-09-05T16:00:00Z',
    payload: {
      toolName: 'run_command',
      toolCallId: `call-${index}`,
      arguments: { command: `echo ${'x'.repeat(commandSize)} ${index}` },
    },
  })) as unknown as Event[];
}

describe('bounded process pages', () => {
  it('keeps long commands bounded while retaining their exact argument source', () => {
    const events = requests(1, 1200000);
    const process = projectRunProcess('run' as RunId, events);
    expect(
      encodeFrame({
        id: 'response',
        kind: 'response',
        type: 'conversation.getRunProcess',
        payload: { process },
      }).length,
    ).toBeLessThan(MAX_FRAME_BYTES / 4);
    expect(process.steps[0].argumentsRef?.reference).toEqual({
      source: 'event',
      id: 'event-0',
      path: ['arguments'],
    });
    expect((events[0].payload.arguments as { command: string }).command.length).toBeGreaterThan(
      1200000,
    );
  });

  it('pages every step in order, retains full totals and validates source versions', () => {
    const events = requests(5000);
    const first = projectRunProcess('run' as RunId, events);
    const snapshot = projectRunProcessSnapshot('run' as RunId, events);
    expect(paginateRunProcess(snapshot)).toEqual(first);
    expect(first.pages?.steps.total).toBe(5000);
    expect(first.steps.length).toBeLessThanOrEqual(40);
    expect(first.latestStep?.id).toBe('call-4999');
    const ids = first.steps.map((step) => step.id);
    let next = first.pages?.steps.nextOffset;
    while (next !== undefined) {
      const page = paginateRunProcess(snapshot, {
        section: 'steps',
        offset: next,
        version: first.pages!.version,
      });
      expect(
        encodeFrame({
          id: 'response',
          kind: 'response',
          type: 'conversation.getRunProcess',
          payload: { process: page },
        }).length,
      ).toBeLessThan(MAX_FRAME_BYTES / 2);
      ids.push(...page.steps.map((step) => step.id));
      next = page.pages?.steps.nextOffset;
    }
    expect(ids).toEqual(Array.from({ length: 5000 }, (_, index) => `call-${index}`));
    expect(() =>
      projectRunProcess('run' as RunId, requests(5001), {
        section: 'steps',
        offset: 40,
        version: first.pages!.version,
      }),
    ).toThrow('history.version-changed');
  }, 20000);
});
