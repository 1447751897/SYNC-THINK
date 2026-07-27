import { describe, expect, it } from 'vitest';
import { decodeFrames, type ConversationTransientFrame, type Frame } from '@sync-think/protocol';
import type { Event, EventId, RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime, type RuntimeStateStore } from './runtime.js';

function createStore(events: Event[]): RuntimeStateStore {
  return {
    commitTransition() {
      throw new Error('not used');
    },
    listEvents() {
      return events;
    },
    listEventsByRun(runId) {
      return events.filter((event) => event.runId === runId);
    },
    loadLatestCheckpoint() {
      return undefined;
    },
  };
}

describe('run process transient projection', () => {
  it('publishes one already-projected process frame and stores it in the active snapshot', () => {
    const runId = 'run-live' as RunId;
    const event: Event = {
      id: 'event-live' as EventId,
      workspaceId: 'workspace-live' as WorkspaceId,
      runId,
      category: 'tool',
      type: 'tool.completed',
      sequence: 1,
      occurredAt: '2026-07-27T00:00:00.000Z',
      payload: {
        threadId: 'thread-live',
        toolCallId: 'call-live',
        toolName: 'write_file',
        arguments: { path: 'src/live.ts', content: 'x'.repeat(20_000) },
        result: JSON.stringify({ ok: true }),
      },
    };
    const runtime = new Runtime({
      installId: 'run-process-transient',
      allowNoToken: true,
      stateStore: createStore([event]),
    });
    const writes: Buffer[] = [];
    const internal = runtime as unknown as {
      transientSubscriptions: Map<string, {
        socket: { destroyed: boolean; write(data: Buffer): boolean };
        threadId: string;
        liveCursor: number;
      }>;
      transientSnapshotByThread: Map<string, { text?: string; process?: unknown }>;
      updateTransientTextSnapshot(input: {
        threadId: string;
        runId: RunId;
        streamSequence: number;
        text: string;
        updatedAt: string;
      }): void;
      publishTransientProjection(event: Event): void;
    };
    internal.transientSubscriptions.set('stream-live', {
      socket: {
        destroyed: false,
        write(data: Buffer) {
          writes.push(Buffer.from(data));
          return true;
        },
      },
      threadId: 'thread-live',
      liveCursor: 0,
    });

    internal.publishTransientProjection(event);

    const frames = decodeFrames(Buffer.concat(writes)).frames as Frame[];
    const transient = (frames[0]?.payload as { frame: ConversationTransientFrame }).frame;
    expect(transient.kind).toBe('process');
    expect(transient.process?.runId).toBe(runId);
    expect(transient.process?.steps[0]?.label).toContain('src/live.ts');
    expect(transient.process?.fileChanges[0]?.preview?.length).toBeLessThan(20_000);
    expect(internal.transientSnapshotByThread.get('thread-live')?.process).toEqual(
      transient.process,
    );

    internal.updateTransientTextSnapshot({
      threadId: 'thread-live',
      runId,
      streamSequence: 2,
      text: 'answer',
      updatedAt: '2026-07-27T00:00:01.000Z',
    });
    expect(internal.transientSnapshotByThread.get('thread-live')).toMatchObject({
      text: 'answer',
      process: transient.process,
    });
  });
});
