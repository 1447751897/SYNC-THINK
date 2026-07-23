import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import { formatTokenUsage, projectExecutionProcess } from './execution-process.js';

function event(
  partial: Partial<Event> & Pick<Event, 'id' | 'type' | 'sequence' | 'payload'>,
): Event {
  return {
    workspaceId: 'ws_1' as Event['workspaceId'],
    category: 'tool',
    occurredAt: '2026-07-23T00:00:00.000Z',
    ...partial,
  } as Event;
}

describe('projectExecutionProcess', () => {
  it('merges requested/completed tool calls into one detailed step', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'tool.requested',
        runId: 'run_1' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_1',
          toolName: 'list_files',
          arguments: { path: '.' },
        },
      }),
      event({
        id: 'e2' as Event['id'],
        sequence: 2,
        type: 'tool.completed',
        runId: 'run_1' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_1',
          toolName: 'list_files',
          result: JSON.stringify({
            entries: ['package.json', 'apps', 'docs'],
            count: 3,
          }),
        },
      }),
    ];
    const view = projectExecutionProcess(events, { threadId: 'th_1', runId: 'run_1' });
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]?.label).toContain('List');
    expect(view.steps[0]?.status).toBe('done');
    expect(view.steps[0]?.preview).toContain('package.json');
    expect(view.running).toBe(false);
  });

  it('collects write_file into fileChanges and uses Edit label', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'tool.completed',
        runId: 'run_1' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_w',
          toolName: 'write_file',
          arguments: { path: 'src/a.ts', content: 'export const a = 1;\n' },
          result: JSON.stringify({ created: true, bytes: 18 }),
        },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_1' });
    expect(view.steps[0]?.label).toMatch(/^Edit ·/);
    expect(view.fileChanges).toEqual([
      expect.objectContaining({
        path: 'src/a.ts',
        action: 'created',
        preview: 'export const a = 1;\n',
      }),
    ]);
  });

  it('keeps write_file body from requested args when completed only has status', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'tool.requested',
        runId: 'run_1' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_w2',
          toolName: 'write_file',
          arguments: {
            path: 'notes/hello.md',
            content: '# Hello\n\nworld\n',
          },
        },
      }),
      event({
        id: 'e2' as Event['id'],
        sequence: 2,
        type: 'tool.completed',
        runId: 'run_1' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_w2',
          toolName: 'write_file',
          result: JSON.stringify({ created: true, bytes: 14 }),
        },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_1' });
    expect(view.fileChanges[0]).toEqual(
      expect.objectContaining({
        path: 'notes/hello.md',
        action: 'created',
        preview: '# Hello\n\nworld\n',
      }),
    );
    expect(view.steps[0]?.preview).toContain('# Hello');
  });

  it('merges adjacent identical labels into ×N', () => {
    const events = [1, 2, 3].map((n) =>
      event({
        id: `e${n}` as Event['id'],
        sequence: n,
        type: 'tool.completed',
        runId: 'run_1' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: `call_${n}`,
          toolName: 'list_files',
          arguments: { path: '.' },
          result: JSON.stringify({ entries: ['a'], count: 1 }),
        },
      }),
    );
    const view = projectExecutionProcess(events, { runId: 'run_1' });
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]?.label).toMatch(/×3$/);
  });

  it('keeps failed steps visible with error detail', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'tool.failed',
        runId: 'run_1' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_err',
          toolName: 'run_command',
          arguments: { command: 'pnpm test' },
          errorMessage: 'exit 1',
        },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_1' });
    expect(view.steps[0]?.status).toBe('error');
    expect(view.steps[0]?.label).toMatch(/^Bash ·/);
    expect(view.steps[0]?.error).toContain('exit 1');
    expect(view.errorCount).toBe(1);
  });

  it('captures provider.usage tokens for the run/thread', () => {
    const events = [
      event({
        id: 'e1' as Event['id'],
        sequence: 1,
        type: 'provider.usage',
        runId: 'run_1' as Event['runId'],
        category: 'provider',
        payload: { threadId: 'th_1', tokensIn: 120, tokensOut: 80 },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_1' });
    expect(view.tokensIn).toBe(120);
    expect(view.tokensOut).toBe(80);
    expect(formatTokenUsage(view.tokensIn, view.tokensOut)).toContain('200 tokens');
  });
});
