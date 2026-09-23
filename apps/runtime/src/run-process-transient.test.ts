import { describe, expect, it } from 'vitest';
import {
  decodeFrames,
  type ConversationTransientFrame,
  type ConversationTransientSnapshot,
  type Frame,
} from '@sync-think/protocol';
import type { AgentId, Event, EventId, RunId, ThreadId, WorkspaceId } from '@sync-think/shared';
import { Runtime, type RuntimeStateStore } from './runtime.js';
import { createDemoRun, type DemoRunState } from './demo-run.js';
import type { DelegationService } from './delegation-service.js';

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
  it.each([false, true])(
    'broadcasts a late child card while preserving a newer snapshot: %s',
    (newer) => {
      const parentRunId = 'parent' as RunId;
      const childRunId = 'child' as RunId;
      const threadId = 'thread-child' as ThreadId;
      const runtime = new Runtime({
        installId: `delegated-projection-${newer}`,
        allowNoToken: true,
      });
      const internal = runtime as unknown as {
        demoRuns: Map<string, DemoRunState>;
        delegationService: DelegationService;
        conversationTransientSubscriptions: {
          register(streamId: string, subscription: unknown): void;
        };
        conversationTransientState: {
          getSnapshot(threadId: string): ConversationTransientSnapshot | undefined;
          setSnapshot(threadId: string, snapshot: ConversationTransientSnapshot): void;
        };
        publishTransientProjection(event: Event): void;
      };
      const parent = createDemoRun(parentRunId, threadId, 'Review');
      parent.assistantTimeline = [
        {
          id: 'delegate',
          sequence: 1,
          kind: 'tool',
          name: 'agent_run',
          toolCallId: 'delegate',
          status: 'running',
          argumentsJson: '{"task":"Review"}',
        },
      ];
      const child = createDemoRun(childRunId, threadId, 'Review');
      child.delegationParentRunId = parentRunId;
      child.globalAgentId = 'reviewer' as AgentId;
      child.globalAgentName = '代码审查员';
      child.assistantText = 'Final report';
      internal.demoRuns.set(parentRunId, parent);
      internal.demoRuns.set(childRunId, child);
      const snapshot: ConversationTransientSnapshot = {
        threadId,
        runId: newer ? ('newer' as RunId) : parentRunId,
        streamSequence: 0,
        text: 'Existing answer',
        updatedAt: 'before',
      };
      internal.conversationTransientState.setSnapshot(threadId, snapshot);
      const writes: Buffer[] = [];
      internal.conversationTransientSubscriptions.register('stream-child', {
        socket: {
          destroyed: false,
          write(data: Buffer) {
            writes.push(Buffer.from(data));
            return true;
          },
        },
        threadId,
        liveCursor: 0,
      });
      const event: Event = {
        id: 'child-final' as EventId,
        runId: childRunId,
        workspaceId: 'workspace' as WorkspaceId,
        category: 'run',
        type: 'run.completed',
        sequence: 10,
        occurredAt: '2026-09-19T00:00:00Z',
        payload: { threadId },
      };
      internal.publishTransientProjection(event);
      const frames = decodeFrames(Buffer.concat(writes)).frames;
      expect(frames).toHaveLength(1);
      const frame = (frames[0]!.payload as { frame: ConversationTransientFrame }).frame;
      expect(frame).toMatchObject({
        runId: parentRunId,
        kind: 'process',
        delegatedAgent: {
          childRunId,
          parentToolCallId: 'delegate',
          avatar: '代码',
          status: 'completed',
          result: 'Final report',
        },
      });
      expect(internal.delegationService.getState(childRunId)).toMatchObject({
        status: 'completed',
      });
      if (newer) {
        expect(internal.conversationTransientState.getSnapshot(threadId)).toBe(snapshot);
      } else {
        expect(internal.conversationTransientState.getSnapshot(threadId)).toMatchObject({
          runId: parentRunId,
          text: 'Existing answer',
          streamSequence: frame.streamSequence,
          delegatedAgents: [{ childRunId, status: 'completed' }],
        });
      }
      // Late progress uses canonical terminal state instead of resurrecting the card.
      writes.length = 0;
      internal.publishTransientProjection({ ...event, type: 'message.delta', sequence: 11 });
      const late = (
        decodeFrames(Buffer.concat(writes)).frames[0]!.payload as {
          frame: ConversationTransientFrame;
        }
      ).frame;
      expect(late.delegatedAgent).toMatchObject({ status: 'completed', result: 'Final report' });
      if (newer) expect(internal.conversationTransientState.getSnapshot(threadId)).toBe(snapshot);
    },
  );

  it('publishes the failed tool projection immediately when its approval expires', () => {
    const runId = 'run-expired-live' as RunId;
    const base = {
      workspaceId: 'workspace-live' as WorkspaceId,
      runId,
      category: 'tool' as const,
      occurredAt: '2026-09-06T08:00:00Z',
    };
    const events: Event[] = [
      {
        ...base,
        id: 'request' as EventId,
        sequence: 1,
        type: 'tool.requested',
        payload: {
          threadId: 'thread-live',
          toolCallId: 'actual',
          toolName: 'write_file',
          arguments: { path: 'never-written.txt' },
        },
      },
      {
        ...base,
        id: 'approval' as EventId,
        sequence: 2,
        type: 'tool.approval_requested',
        payload: {
          threadId: 'thread-live',
          toolCallId: 'actual',
          toolName: 'write_file',
          approvalId: 'approval',
        },
      },
      {
        ...base,
        id: 'expired' as EventId,
        sequence: 3,
        type: 'tool.approval_decided',
        payload: {
          threadId: 'thread-live',
          approvalId: 'approval',
          decision: 'deny',
          reason: 'stale-approval',
        },
      },
    ];
    const runtime = new Runtime({
      installId: 'expired-process-transient',
      allowNoToken: true,
      stateStore: createStore(events),
    });
    const writes: Buffer[] = [];
    const internal = runtime as unknown as {
      conversationTransientSubscriptions: {
        register(streamId: string, subscription: unknown): void;
      };
      publishTransientProjection(event: Event): void;
    };
    internal.conversationTransientSubscriptions.register('stream', {
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
    internal.publishTransientProjection(events[2]!);
    const frames = decodeFrames(Buffer.concat(writes)).frames;
    const frame = (frames[0]?.payload as { frame: ConversationTransientFrame }).frame;
    expect(frame.kind).toBe('process');
    expect(frame.process?.fileChanges).toEqual([]);
    expect(frame.process?.steps[0]).toMatchObject({
      id: 'actual',
      status: 'error',
      error: '审批已失效，此工具未获批准',
    });
    expect(frame.process?.running).toBe(false);
  });

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
      conversationTransientSubscriptions: {
        register(
          streamId: string,
          subscription: {
            socket: { destroyed: boolean; write(data: Buffer): boolean };
            threadId: string;
            liveCursor: number;
          },
        ): void;
      };
      conversationTransientState: {
        getSnapshot(threadId: string): { text?: string; process?: unknown } | undefined;
      };
      updateTransientTextSnapshot(input: {
        threadId: string;
        runId: RunId;
        streamSequence: number;
        text: string;
        updatedAt: string;
      }): void;
      publishTransientProjection(event: Event): void;
    };
    internal.conversationTransientSubscriptions.register('stream-live', {
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
    expect(transient.process?.fileChanges[0]?.content).toBeUndefined();
    expect(transient.process?.fileChanges[0]?.contentRef).toMatchObject({
      utf16Length: 20_000,
      reference: { source: 'event', id: event.id, path: ['arguments', 'content'] },
    });
    expect((event.payload.arguments as { content: string }).content).toBe('x'.repeat(20_000));
    expect(internal.conversationTransientState.getSnapshot('thread-live')?.process).toEqual(
      transient.process,
    );

    internal.updateTransientTextSnapshot({
      threadId: 'thread-live',
      runId,
      streamSequence: 2,
      text: 'answer',
      updatedAt: '2026-07-27T00:00:01.000Z',
    });
    expect(internal.conversationTransientState.getSnapshot('thread-live')).toMatchObject({
      text: 'answer',
      process: transient.process,
    });
  });
});
