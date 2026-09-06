import { describe, expect, it } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import { encodeFrame, MAX_FRAME_BYTES } from '@sync-think/protocol';
import { projectRunProcess } from './run-process-view.js';

function events(content: string, previousContent: string, count = 1): Event[] {
  return Array.from({ length: count }, (_, index) => [
    {
      id: 'request-' + index,
      sequence: index * 2,
      type: 'tool.requested',
      payload: {
        toolCallId: 'call-' + index,
        toolName: 'write_file',
        argumentsJson: JSON.stringify({ path: 'file-' + index + '.txt', content }),
      },
    },
    {
      id: 'complete-' + index,
      sequence: index * 2 + 1,
      type: 'tool.completed',
      payload: {
        toolCallId: 'call-' + index,
        toolName: 'write_file',
        previousContent,
        result: { ok: true },
      },
    },
  ])
    .flat()
    .map((event) => ({
      ...event,
      workspaceId: 'workspace',
      taskId: 'task',
      runId: 'run',
      category: 'tool',
      occurredAt: '2026-09-05T16:00:00Z',
    })) as unknown as Event[];
}

describe('file change display source references', () => {
  it('budgets JSON-escaped contents and process step previews across many files', () => {
    const process = projectRunProcess(
      'run' as RunId,
      events('\u0001'.repeat(66000), '\u0002'.repeat(66000), 40),
    );
    expect(
      encodeFrame({
        id: 'escaped',
        kind: 'response',
        type: 'conversation.getRunProcess',
        payload: { process },
      }).length,
    ).toBeLessThan(MAX_FRAME_BYTES / 2);
  });
  it('keeps a megabyte edit deliverable while preserving exact before and after sources', () => {
    const original = events('x'.repeat(1200000), 'y'.repeat(1100000));
    const process = projectRunProcess('run' as RunId, original);
    const change = process.fileChanges[0];
    expect(change.content).toBeUndefined();
    expect(change.previousContent).toBeUndefined();
    expect(change.contentRef?.reference).toEqual({
      source: 'event',
      id: 'request-0',
      path: ['argumentsJson', 'content'],
    });
    expect(change.previousContentRef?.reference).toEqual({
      source: 'event',
      id: 'complete-0',
      path: ['previousContent'],
    });
    expect(
      encodeFrame({
        id: 'probe',
        kind: 'response',
        type: 'conversation.getRunProcess',
        payload: { process },
      }).length,
    ).toBeLessThan(MAX_FRAME_BYTES / 4);
    expect(JSON.parse(original[0].payload.argumentsJson as string).content.length).toBe(1200000);
  });

  it('keeps many file previews bounded as well as their full source fields', () => {
    const process = projectRunProcess(
      'run' as RunId,
      events('new'.repeat(22000), 'old'.repeat(22000), 40),
    );
    expect(process.fileChanges).toHaveLength(40);
    expect(() =>
      encodeFrame({
        id: 'probe',
        kind: 'response',
        type: 'conversation.getRunProcess',
        payload: { process },
      }),
    ).not.toThrow();
    expect(
      process.fileChanges.every((change) => change.contentRef && change.previousContentRef),
    ).toBe(true);
  });

  it('retains known empty before and after snapshots rather than reporting them as missing', () => {
    expect(projectRunProcess('run' as RunId, events('', '')).fileChanges[0]).toMatchObject({
      content: '',
      previousContent: '',
    });
  });
});
