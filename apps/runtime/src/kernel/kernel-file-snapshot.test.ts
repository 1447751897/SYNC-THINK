import { describe, expect, it } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import { encodeFrame, MAX_FRAME_BYTES } from '@sync-think/protocol';
import { kernelFileSnapshot } from './kernel-file-snapshot.js';
import { projectRunProcess } from '../run-process-view.js';
import { projectEventContent } from '../deferred-content-projection.js';

const input = JSON.stringify({
  file_path: 'D:/work/file.ts',
  old_string: 'count = 1',
  new_string: 'count = 2',
});
const result = {
  filePath: 'D:\\work\\file.ts',
  originalFile: '// heading\r\nconst count = 1;\r\n// trailing\r\n',
  oldString: 'count = 1',
  newString: 'count = 2',
  replaceAll: false,
  userModified: false,
};
function projected(snapshot: Record<string, unknown>, args = input) {
  const events = [
    {
      id: 'request',
      sequence: 1,
      type: 'tool.requested',
      payload: { toolCallId: 'edit', toolName: 'Edit', argumentsJson: args },
    },
    {
      id: 'complete',
      sequence: 2,
      type: 'tool.completed',
      payload: {
        toolCallId: 'edit',
        toolName: 'Edit',
        argumentsJson: args,
        result: 'File updated successfully',
        ...snapshot,
      },
    },
  ].map((e) => ({
    ...e,
    runId: 'run',
    category: 'tool',
    workspaceId: 'w',
    taskId: 't',
    occurredAt: '2026-09-24T00:00:00Z',
  })) as unknown as Event[];
  return { events, process: projectRunProcess('run' as RunId, events) };
}

describe('native kernel file snapshots', () => {
  it('preserves unchanged context and CRLF from a native Edit result through the process projection', () => {
    const snapshot = kernelFileSnapshot('Edit', input, result);
    expect(snapshot).toEqual({
      previousContent: result.originalFile,
      writtenContent: result.originalFile.replace('count = 1', 'count = 2'),
    });
    const { process } = projected(snapshot);
    expect(process.fileChanges[0]).toMatchObject({
      toolCallId: 'edit',
      previousContent: result.originalFile,
      content: snapshot.writtenContent,
    });
    expect(process.fileChanges[0].contentKind).toBeUndefined();
  });
  it('handles replace-all and literal replacement characters without JS replacement expansion', () => {
    const snapshot = kernelFileSnapshot('Edit', input, {
      ...result,
      originalFile: 'x x',
      oldString: 'x',
      newString: '$&',
      replaceAll: true,
    });
    expect(snapshot.writtenContent).toBe('$& $&');
  });
  it('keeps only the known original for ambiguous, missing, or manually modified replacements', () => {
    for (const override of [
      { originalFile: 'count = 1; count = 1' },
      { oldString: 'not found' },
      { oldString: '' },
      { userModified: true },
    ]) {
      const value = { ...result, ...override };
      expect(kernelFileSnapshot('Edit', input, value)).toEqual({
        previousContent: value.originalFile,
      });
    }
    expect(kernelFileSnapshot('Edit', input, { ...result, originalFile: null })).toEqual({});
  });
  it('does not attach a different file or non-file tool result as a snapshot', () => {
    expect(kernelFileSnapshot('Bash', input, result)).toEqual({});
    expect(kernelFileSnapshot('Edit', '{bad json', result)).toEqual({});
    expect(kernelFileSnapshot('Edit', input, { ...result, filePath: 'D:/other/file.ts' })).toEqual(
      {},
    );
  });
  it('preserves real empty and newly created Write snapshots', () => {
    expect(
      kernelFileSnapshot('Write', input, {
        filePath: 'D:/work/file.ts',
        type: 'create',
        originalFile: null,
        content: '',
      }),
    ).toEqual({ previousContent: '', writtenContent: '', fileCreated: true });
    expect(
      kernelFileSnapshot('Write', input, {
        filePath: 'D:/work/file.ts',
        type: 'update',
        originalFile: '',
        content: 'new',
      }),
    ).toEqual({ previousContent: '', writtenContent: 'new' });
  });
  it('keeps large native snapshots readable by exact event references without oversized IPC frames', () => {
    const previousContent = 'header\n' + 'a'.repeat(1200000) + '\nend';
    const snapshot = kernelFileSnapshot('Edit', input, {
      ...result,
      originalFile: previousContent,
      oldString: 'header',
      newString: 'updated',
    });
    const { process, events } = projected(snapshot);
    expect(process.fileChanges[0].previousContentRef?.reference).toEqual({
      source: 'event',
      id: 'complete',
      path: ['previousContent'],
    });
    expect(process.fileChanges[0].contentRef?.reference).toEqual({
      source: 'event',
      id: 'complete',
      path: ['writtenContent'],
    });
    expect(process.fileChanges[0].contentKind).toBeUndefined();
    expect(
      encodeFrame({
        id: 'probe',
        kind: 'response',
        type: 'conversation.getRunProcess',
        payload: { process },
      }).length,
    ).toBeLessThan(MAX_FRAME_BYTES / 4);
    events[1].payload.structuredResult = { originalFile: previousContent };
    expect(JSON.stringify(projectEventContent(events[1])).length).toBeLessThan(50000);
  });
});
