import { describe, expect, it, vi } from 'vitest';
import type { Event, KernelEvent, RunId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { projectRunProcess } from './run-process-view.js';

/** Exercise the real persistence boundary, not a test-only snapshot mapper. */
function replay(events: KernelEvent[]) {
  const recorded: Event[] = [];
  const host = Object.assign(Object.create(Runtime.prototype), {
    demoRuns: new Map([
      ['run', { runId: 'run', threadId: 'thread', assistantTimeline: [], kernelToolEvents: [] }],
    ]),
    flushLegacyAssistantText: vi.fn(),
    pushKernelTimelineSnapshot: vi.fn(),
    kernelToolProgressRegistry: { completeTool: vi.fn() },
    resolveEventWorkspaceId: () => 'workspace',
    resolveEventTaskId: () => 'task',
    persistProjectedEvent: (draft: Event) => {
      const event = { ...draft, sequence: recorded.length + 1 };
      recorded.push(event);
      return event;
    },
    publishEvent: vi.fn(),
  });
  for (const event of events) {
    if (event.type === 'tool-call' || event.type === 'tool-result')
      host.persistKernelToolEvent(
        'run',
        'thread',
        event.type === 'tool-call' ? 'tool.requested' : 'tool.completed',
        event,
      );
  }
  return { recorded, view: projectRunProcess('run' as RunId, recorded) };
}

const args = JSON.stringify({
  file_path: 'fixture.ts',
  old_string: '1',
  new_string: '2',
  replace_all: false,
});
const result = {
  filePath: 'fixture.ts',
  originalFile: '// header\nconst count = 1;\n',
  oldString: '1',
  newString: '2',
  replaceAll: false,
  userModified: false,
};

describe('native editing event persistence', () => {
  it('persists full Claude snapshots using the completed input, including a preceding partial input', () => {
    const { recorded, view } = replay([
      { type: 'tool-call', toolId: 'edit', name: 'Edit', argsJson: '{}', partial: true },
      { type: 'tool-call', toolId: 'edit', name: 'Edit', argsJson: args, partial: false },
      {
        type: 'tool-result',
        toolId: 'edit',
        output: 'File updated successfully.',
        isError: false,
        structuredOutput: result,
      },
    ]);
    expect(recorded).toHaveLength(3);
    expect(recorded[2].payload).toMatchObject({
      previousContent: result.originalFile,
      writtenContent: '// header\nconst count = 2;\n',
    });
    expect(view.fileChanges[0]).toMatchObject({
      path: 'fixture.ts',
      toolCallId: 'edit',
      previousContent: result.originalFile,
      content: '// header\nconst count = 2;\n',
    });
    expect(view.fileChanges[0].contentKind).toBeUndefined();
  });
  it('does not turn a failed edit with structured diagnostic data into a successful change', () => {
    const { recorded, view } = replay([
      { type: 'tool-call', toolId: 'edit', name: 'Edit', argsJson: args, partial: false },
      {
        type: 'tool-result',
        toolId: 'edit',
        output: 'Edit rejected',
        isError: true,
        structuredOutput: result,
      },
    ]);
    expect(recorded[1].payload.writtenContent).toBeUndefined();
    expect(view.fileChanges).toEqual([]);
  });
  it('keeps native Codex file_change paths and patches distinct from commands', () => {
    const changes = [{ path: 'fixture.ts', kind: 'update', diff: '@@ -1 +1 @@\n-old\n+new\n' }];
    const { view } = replay([
      {
        type: 'tool-call',
        toolId: 'patch',
        name: 'file_change',
        argsJson: JSON.stringify({ changes }),
        partial: false,
      },
      {
        type: 'tool-result',
        toolId: 'patch',
        output: JSON.stringify({ ok: true, status: 'completed', changes }),
        isError: false,
      },
    ]);
    expect(view.steps[0]).toMatchObject({ toolName: 'file_change', kind: 'write', status: 'done' });
    expect(view.fileChanges[0]).toMatchObject({
      path: 'fixture.ts',
      toolCallId: 'patch',
      preview: changes[0].diff,
    });
  });
});
