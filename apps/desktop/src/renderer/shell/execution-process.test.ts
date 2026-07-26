import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  formatCompactRunMetrics,
  formatTokenUsage,
  projectExecutionProcess,
} from './execution-process.js';
import { formatExecutionStepTitle } from './ExecutionProcessBlock.js';

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

  it('includes read/write file paths directly in visible step titles', () => {
    expect(
      formatExecutionStepTitle({
        id: 'read-title',
        label: 'Read · src/config.ts',
        verb: 'Read',
        zh: '读取文件',
        toolName: 'read_file',
        kind: 'read',
        status: 'done',
        path: 'src/config.ts',
      }),
    ).toBe('读取文件 · src/config.ts');
    expect(
      formatExecutionStepTitle({
        id: 'write-title',
        label: 'Edit · docs/roadmap.md',
        verb: 'Edit',
        zh: '写入文件',
        toolName: 'write_file',
        kind: 'write',
        status: 'done',
        path: 'docs/roadmap.md',
        count: 2,
      }),
    ).toBe('写入文件 · docs/roadmap.md ×2');
  });

  it('projects read_file path and content directly into the step', () => {
    const events = [
      event({
        id: 'e_read_1' as Event['id'],
        sequence: 1,
        type: 'tool.requested',
        runId: 'run_read' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_read',
          toolName: 'read_file',
          toolCall: {
            id: 'call_read',
            name: 'read_file',
            argumentsJson: JSON.stringify({ path: 'src/reader.ts' }),
          },
        },
      }),
      event({
        id: 'e_read_2' as Event['id'],
        sequence: 2,
        type: 'tool.completed',
        runId: 'run_read' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_read',
          toolName: 'read_file',
          result: JSON.stringify({ content: 'export const ready = true;\n' }),
        },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_read' });
    expect(view.steps[0]).toEqual(
      expect.objectContaining({
        path: 'src/reader.ts',
        kind: 'read',
        status: 'done',
        preview: 'export const ready = true;\n',
      }),
    );
  });

  it('projects edit_file as a file change using new_string preview', () => {
    const events = [
      event({
        id: 'e_edit' as Event['id'],
        sequence: 1,
        type: 'tool.completed',
        runId: 'run_edit' as Event['runId'],
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_edit',
          toolName: 'edit_file',
          arguments: { path: 'src/a.ts', old_string: 'old', new_string: 'new value' },
          result: JSON.stringify({ ok: true }),
        },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_edit' });
    expect(view.steps[0]).toEqual(
      expect.objectContaining({ path: 'src/a.ts', kind: 'write', zh: '编辑文件' }),
    );
    expect(view.fileChanges[0]).toEqual(
      expect.objectContaining({ path: 'src/a.ts', action: 'edited', preview: 'new value' }),
    );
  });

  it('strictly isolates events without the requested run id', () => {
    const events = [
      event({
        id: 'e_unscoped' as Event['id'],
        sequence: 1,
        type: 'tool.completed',
        payload: {
          threadId: 'th_1',
          toolCallId: 'call_unscoped',
          toolName: 'read_file',
          arguments: { path: 'wrong.ts' },
          result: JSON.stringify({ content: 'wrong' }),
        },
      }),
      event({
        id: 'e_scoped' as Event['id'],
        sequence: 2,
        type: 'tool.completed',
        payload: {
          run: { runId: 'run_target' },
          threadId: 'th_1',
          toolCallId: 'call_scoped',
          toolName: 'read_file',
          arguments: { path: 'right.ts' },
          result: JSON.stringify({ content: 'right' }),
        },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_target' });
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]?.path).toBe('right.ts');
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
    expect(formatTokenUsage(view.tokensIn, view.tokensOut)).toContain('200');
    expect(formatTokenUsage(view.tokensIn, view.tokensOut)).toContain('in 120');
  });

  it('captures duration and model from run lifecycle + usage', () => {
    const events = [
      event({
        id: 'e_start' as Event['id'],
        sequence: 1,
        type: 'run.started',
        runId: 'run_meta' as Event['runId'],
        category: 'run',
        occurredAt: '2026-07-25T10:00:00.000Z',
        payload: {
          threadId: 'th_1',
          modelId: 'model_internal',
          providerModelId: 'gpt-5.5',
        },
      }),
      event({
        id: 'e_usage' as Event['id'],
        sequence: 2,
        type: 'provider.usage',
        runId: 'run_meta' as Event['runId'],
        category: 'provider',
        occurredAt: '2026-07-25T10:00:51.000Z',
        payload: {
          tokensIn: 600_000,
          tokensOut: 47_900,
          modelId: 'model_internal',
          run: { threadId: 'th_1', providerModelId: 'gpt-5.5' },
        },
      }),
      event({
        id: 'e_done' as Event['id'],
        sequence: 3,
        type: 'run.completed',
        runId: 'run_meta' as Event['runId'],
        category: 'run',
        occurredAt: '2026-07-25T10:00:51.000Z',
        payload: {
          threadId: 'th_1',
          providerModelId: 'gpt-5.5',
          modelId: 'model_internal',
        },
      }),
    ];
    const view = projectExecutionProcess(events, { runId: 'run_meta', threadId: 'th_1' });
    expect(view.durationMs).toBe(51_000);
    expect(view.providerModelId).toBe('gpt-5.5');
    expect(view.tokensIn).toBe(600_000);
    expect(view.tokensOut).toBe(47_900);
    expect(
      formatCompactRunMetrics({
        durationMs: view.durationMs,
        tokensIn: view.tokensIn,
        tokensOut: view.tokensOut,
      }),
    ).toBe('51s · 647.9k');
  });
});
