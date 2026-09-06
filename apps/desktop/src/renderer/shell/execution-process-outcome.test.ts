import { describe, expect, it } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import { projectExecutionProcess } from './execution-process.js';
const runId = 'run-file-outcome' as RunId;
const threadId = 'thread-file-outcome';
function event(type: string, sequence: number, payload: Record<string, unknown> = {}): Event {
  return {
    id: ('event-outcome-' + sequence) as Event['id'],
    workspaceId: 'workspace-outcome' as Event['workspaceId'],
    runId,
    category: 'tool',
    type,
    sequence,
    occurredAt: new Date(Date.UTC(2026, 8, 6, 8, 0, sequence)).toISOString(),
    payload: { threadId, ...payload },
  } as Event;
}
function request(
  sequence = 1,
  toolCallId = 'write',
  path = 'src/actual.ts',
  name = 'write_file',
): Event {
  return event('tool.requested', sequence, {
    toolCall: {
      id: toolCallId,
      name,
      argumentsJson: JSON.stringify({ path, content: 'new content' }),
    },
  });
}
function complete(sequence = 2, payload: Record<string, unknown> = {}): Event {
  return event('tool.completed', sequence, {
    toolCallId: 'write',
    result: '{"ok":true}',
    ...payload,
  });
}
const project = (events: Event[]) => projectExecutionProcess(events, { runId, threadId });
describe('execution facts in process projections', () => {
  it.each(['Write', 'Edit', 'mcp__native__Write'])(
    'retains successful native %s file changes',
    (name) => {
      const view = project([
        event('tool.requested', 1, {
          toolCall: {
            id: 'write',
            name,
            argumentsJson: JSON.stringify({
              file_path: 'src/native.ts',
              content: 'native content',
            }),
          },
        }),
        complete(2, { result: 'File written successfully', failed: false }),
      ]);
      expect(view.fileChanges).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'src/native.ts' })]),
      );
      expect(view.steps[0]?.status).toBe('done');
    },
  );

  it('keeps a waiting write visible without claiming a file change', () => {
    const view = project([request()]);
    expect(view.fileChanges).toEqual([]);
    expect(view.steps[0]?.status).toBe('running');
  });
  it.each(['run.completed', 'run.failed', 'run.cancelled'])(
    'does not invent tool success at %s',
    (type) => {
      const view = project([request(), event(type, 3)]);
      expect(view.fileChanges).toEqual([]);
      expect(view.running).toBe(false);
      expect(view.steps[0]?.status).toBe('error');
      expect(view.steps[0]?.error).toBeTruthy();
    },
  );
  it.each([
    { result: '{"ok":false,"error":"denied"}' },
    { result: '宿主已拒绝此操作', failed: true },
    { result: '', isError: true },
    { result: '{"isError":true}' },
    { result: '{"status":"declined"}' },
    { result: '{"exitCode":1}' },
    { result: '{"success":false}' },
  ])('honors unsuccessful result metadata %#', (payload) => {
    const view = project([request(), complete(2, payload)]);
    expect(view.fileChanges).toEqual([]);
    expect(view.steps[0]?.status).toBe('error');
  });
  it('retains request metadata only after a nameless successful result', () => {
    const view = project([request(), complete()]);
    expect(view.fileChanges).toEqual([
      expect.objectContaining({
        path: 'src/actual.ts',
        toolCallId: 'write',
        content: 'new content',
      }),
    ]);
    expect(view.steps[0]?.status).toBe('done');
  });
  it('does not turn a read-only path into an edit', () => {
    const view = project([request(1, 'write', 'src/read.ts', 'read_file'), complete()]);
    expect(view.fileChanges).toEqual([]);
  });
  it('preserves successful work when a later write to the same path fails', () => {
    const view = project([
      request(),
      complete(),
      request(3, 'later'),
      complete(4, { toolCallId: 'later', failed: true, result: 'denied' }),
      event('run.failed', 5),
    ]);
    expect(view.fileChanges).toEqual([
      expect.objectContaining({ path: 'src/actual.ts', toolCallId: 'write' }),
    ]);
    expect(view.steps.find((step) => step.id === 'write')?.status).toBe('done');
    expect(view.steps.find((step) => step.id === 'later')?.status).toBe('error');
  });
  it.each(['user-denied', 'stale-approval'])(
    'settles a precisely paired %s approval without a result',
    (reason) => {
      const view = project([
        request(),
        event('tool.approval_requested', 2, {
          approvalId: 'approval',
          toolCallId: 'write',
          toolName: 'write_file',
        }),
        event('tool.approval_decided', 3, { approvalId: 'approval', decision: 'deny', reason }),
      ]);
      expect(view.fileChanges).toEqual([]);
      expect(view.running).toBe(false);
      expect(view.steps[0]?.status).toBe('error');
      expect(view.steps[0]?.error).toContain(reason === 'stale-approval' ? '失效' : '拒绝');
    },
  );
  it('honors legacy denial even when a kernel returned an empty completion', () => {
    const view = project([
      request(),
      event('tool.approval_requested', 2, {
        approvalId: 'approval',
        toolCallId: 'write',
        toolName: 'write_file',
      }),
      event('tool.approval_decided', 3, {
        approvalId: 'approval',
        decision: 'deny',
        reason: 'user-denied',
      }),
      complete(4, { result: '' }),
    ]);
    expect(view.fileChanges).toEqual([]);
    expect(view.steps[0]?.status).toBe('error');
  });
  it('does not let a foreign thread approval close the current tool', () => {
    const view = project([
      request(),
      event('tool.approval_requested', 2, {
        approvalId: 'approval',
        toolCallId: 'write',
        toolName: 'write_file',
      }),
      event('tool.approval_decided', 3, {
        threadId: 'other-thread',
        approvalId: 'approval',
        decision: 'deny',
        reason: 'stale-approval',
      }),
    ]);
    expect(view.running).toBe(true);
  });
  it('does not infer changes from a shell command or a dirty git observation', () => {
    const view = project([
      event('tool.requested', 1, {
        toolCallId: 'shell',
        toolName: 'command_execution',
        arguments: { command: 'echo "*** Add File: not-created.txt"' },
      }),
      complete(2, { toolCallId: 'shell', result: '*** Add File: not-created.txt' }),
      event('tool.completed', 3, { toolCallId: 'old', result: 'file changed' }),
      event('tool.requested', 4, {
        toolCallId: 'git',
        toolName: 'command_execution',
        arguments: { command: 'git status --short -- pre-existing.txt' },
      }),
      complete(5, { toolCallId: 'git', result: ' M pre-existing.txt' }),
    ]);
    expect(view.fileChanges).toEqual([]);
  });
  it('reports a successful native apply_patch with its actual patch input', () => {
    const view = project([
      event('tool.requested', 1, {
        toolCallId: 'patch',
        toolName: 'apply_patch',
        arguments: { patch: '*** Begin Patch\n*** Add File: actual.txt\n+created\n*** End Patch' },
      }),
      complete(2, { toolCallId: 'patch' }),
    ]);
    expect(view.fileChanges).toEqual([
      expect.objectContaining({ path: 'actual.txt', action: 'created' }),
    ]);
  });
  it('does not import another run file outcome', () => {
    const foreign = [
      request(1, 'foreign', 'foreign.txt', 'apply_patch'),
      complete(2, {
        toolCallId: 'foreign',
        toolName: 'apply_patch',
        arguments: { command: '*** Add File: foreign.txt' },
      }),
    ].map((value) => ({ ...value, runId: 'other-run' as RunId }));
    expect(project([...foreign, request(3)]).fileChanges).toEqual([]);
  });
});
