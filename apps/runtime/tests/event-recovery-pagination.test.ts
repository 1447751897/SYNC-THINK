import { describe, expect, it } from 'vitest';
import { MAX_FRAME_BYTES } from '@sync-think/protocol';
import type { Frame } from '@sync-think/protocol';
import type { Checkpoint, Event, EventCategory, WorkspaceId } from '@sync-think/shared';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';

function eventAt(sequence: number): Event {
  return {
    id: `event-${String(sequence).padStart(6, '0')}` as never,
    workspaceId: 'workspace-s3' as WorkspaceId,
    category: 'run' as EventCategory,
    type: 'run.observed',
    sequence,
    occurredAt: '2026-07-27T00:00:00.000Z',
    payload: { sequence },
  };
}

function pagedStore(events: Event[], checkpoint?: Checkpoint) {
  const pageCalls: Array<{
    afterSequence: number;
    afterId?: string;
    throughSequence: number;
    throughId?: string;
    limit: number;
  }> = [];
  let listAllCalls = 0;
  const store: RuntimeStateStore = {
    commitTransition(input) {
      return {
        events: input.events.map((event, index) => ({
          ...event,
          sequence: events.length + index + 1,
        })) as [Event, ...Event[]],
      };
    },
    listEvents() {
      throw new Error('workspace-wide restore must not be used');
    },
    listAllEvents() {
      listAllCalls++;
      throw new Error('full global restore must not be used');
    },
    getLatestEventSequence() {
      return events.reduce((latest, event) => Math.max(latest, event.sequence), 0);
    },
    getLatestEventCursor() {
      const latest = [...events]
        .sort((left, right) =>
          left.sequence === right.sequence
            ? String(left.id).localeCompare(String(right.id))
            : left.sequence - right.sequence,
        )
        .at(-1);
      return latest
        ? { sequence: latest.sequence, eventId: String(latest.id) }
        : { sequence: 0, eventId: '' };
    },
    listEventPage(input) {
      pageCalls.push({ ...input });
      return events
        .filter((event) => {
          const id = String(event.id);
          const after =
            event.sequence > input.afterSequence ||
            (input.afterId !== undefined &&
              event.sequence === input.afterSequence &&
              id.localeCompare(input.afterId) > 0);
          const through =
            event.sequence < input.throughSequence ||
            (event.sequence === input.throughSequence &&
              (input.throughId === undefined || id.localeCompare(input.throughId) <= 0));
          return after && through;
        })
        .sort((left, right) =>
          left.sequence === right.sequence
            ? String(left.id).localeCompare(String(right.id))
            : left.sequence - right.sequence,
        )
        .slice(0, input.limit);
    },
    loadLatestCheckpoint() {
      return checkpoint;
    },
  };
  return {
    store,
    pageCalls,
    get listAllCalls() {
      return listAllCalls;
    },
  };
}

describe('S3 durable event recovery', () => {
  it('restores only checkpoint-following pages and bounds Runtime event memory', () => {
    const events = Array.from({ length: 5_000 }, (_, index) => eventAt(index + 1));
    const checkpoint: Checkpoint = {
      id: 'checkpoint-s3',
      runId: 'runtime-s3-checkpoint' as never,
      lastEventSequence: 3_000,
      state: { threadVersions: [], demoRuns: [] },
      createdAt: '2026-07-27T00:00:00.000Z',
    };
    const fixture = pagedStore(events, checkpoint);
    const runtime = new Runtime({
      installId: 's3-checkpoint',
      allowNoToken: true,
      stateStore: fixture.store,
      checkpointRunId: checkpoint.runId,
    });

    expect(fixture.listAllCalls).toBe(0);
    expect(fixture.pageCalls[0]).toEqual({
      afterSequence: 3_000,
      throughSequence: 5_000,
      throughId: 'event-005000',
      limit: 1_000,
    });
    expect(runtime.createCheckpoint()).toMatchObject({ eventSequence: 5_000 });
    expect(runtime.createCheckpoint().events).toHaveLength(2_000);
    expect(runtime.createCheckpoint().events[0]?.sequence).toBe(3_001);
  });

  it('builds replay pages from the durable cursor store, not the recent memory window', () => {
    const events = Array.from({ length: 5_000 }, (_, index) => eventAt(index + 1));
    const fixture = pagedStore(events);
    const runtime = new Runtime({
      installId: 's3-replay',
      allowNoToken: true,
      stateStore: fixture.store,
    });
    fixture.pageCalls.length = 0;

    const internal = runtime as unknown as {
      buildReplayPage(
        frame: Frame,
        streamId: string,
        subscription: {
          socket: object;
          phase: 'catching-up';
          highWatermark: { sequence: number; eventId: string };
          replayCursor: { sequence: number; eventId: string };
          liveCursor: { sequence: number; eventId: string };
        },
        startingSequence: number,
      ):
        | {
            payload: { replayedEvents: Event[]; nextCursor: number; nextEventId?: string };
          }
        | undefined;
    };
    const page = internal.buildReplayPage(
      {
        id: 'subscribe-s3',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0 },
      },
      'stream-s3',
      {
        socket: {},
        phase: 'catching-up',
        highWatermark: { sequence: 5_000, eventId: 'event-005000' },
        replayCursor: { sequence: 0, eventId: '' },
        liveCursor: { sequence: 5_000, eventId: 'event-005000' },
      },
      1,
    );

    expect(fixture.pageCalls).toEqual([
      {
        afterSequence: 0,
        throughSequence: 5_000,
        throughId: 'event-005000',
        limit: 256,
      },
    ]);
    expect(page?.payload.replayedEvents[0]?.sequence).toBe(1);
    expect(page?.payload.nextCursor).toBeGreaterThan(0);
  });

  it('hydrates durable chat approvals through bounded pages instead of a full global read', () => {
    const approval: Event = {
      ...eventAt(2),
      category: 'approval',
      type: 'tool.approval_requested',
      payload: {
        approvalId: 'approval-paged-1',
        threadId: 'thread-paged-approvals',
        runId: 'run-paged-approvals',
        toolCallId: 'tool-call-paged-1',
        toolName: 'file_write',
        arguments: {},
        title: 'file_write',
        detail: 'approval',
        allowedScopes: ['once'],
      },
    };
    const events = [
      eventAt(1),
      approval,
      ...Array.from({ length: 2_100 }, (_, index) => eventAt(index + 3)),
    ];
    const fixture = pagedStore(events);
    const runtime = new Runtime({
      installId: 's3-approval-hydration',
      allowNoToken: true,
      stateStore: fixture.store,
    });

    const internal = runtime as unknown as {
      durableChatToolApprovalStates(): Map<string, { requested: Event; decided?: Event }>;
    };
    const states = internal.durableChatToolApprovalStates();

    expect(states.get('approval-paged-1')?.requested.id).toBe(approval.id);
    expect(fixture.listAllCalls).toBe(0);
    expect(fixture.pageCalls.length).toBeGreaterThan(2);
  });

  it('skips an oversized first replay event and continues with later events', () => {
    const oversized: Event = {
      ...eventAt(1),
      payload: { data: 'x'.repeat(MAX_FRAME_BYTES) },
    };
    const fixture = pagedStore([oversized, eventAt(2)]);
    const runtime = new Runtime({
      installId: 's3-oversized-replay',
      allowNoToken: true,
      stateStore: fixture.store,
    });
    const internal = runtime as unknown as {
      buildReplayPage(
        frame: Frame,
        streamId: string,
        subscription: {
          socket: object;
          phase: 'catching-up';
          highWatermark: { sequence: number; eventId: string };
          replayCursor: { sequence: number; eventId: string };
          liveCursor: { sequence: number; eventId: string };
        },
      ):
        | {
            payload: {
              replayedEvents: Event[];
              nextCursor: number;
              nextEventId?: string;
              replayComplete: boolean;
            };
          }
        | undefined;
    };

    const page = internal.buildReplayPage(
      {
        id: 'oversized-page',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0, afterEventId: '' },
      },
      'stream-oversized',
      {
        socket: {},
        phase: 'catching-up',
        highWatermark: { sequence: 2, eventId: 'event-000002' },
        replayCursor: { sequence: 0, eventId: '' },
        liveCursor: { sequence: 2, eventId: 'event-000002' },
      },
    );

    expect(page?.payload.replayedEvents.map((event) => event.sequence)).toEqual([2]);
    expect(page?.payload.nextCursor).toBe(2);
    expect(page?.payload.nextEventId).toBe('event-000002');
    expect(page?.payload.replayComplete).toBe(true);
  });

  it('skips an oversized event after earlier events in the same page', () => {
    const oversized: Event = {
      ...eventAt(2),
      payload: { data: 'x'.repeat(MAX_FRAME_BYTES) },
    };
    const fixture = pagedStore([eventAt(1), oversized, eventAt(3)]);
    const runtime = new Runtime({
      installId: 's3-oversized-after-normal-replay',
      allowNoToken: true,
      stateStore: fixture.store,
    });
    const internal = runtime as unknown as {
      buildReplayPage(
        frame: Frame,
        streamId: string,
        subscription: {
          socket: object;
          phase: 'catching-up';
          highWatermark: { sequence: number; eventId: string };
          replayCursor: { sequence: number; eventId: string };
          liveCursor: { sequence: number; eventId: string };
        },
      ):
        | {
            payload: {
              replayedEvents: Event[];
              nextCursor: number;
              nextEventId?: string;
              replayComplete: boolean;
            };
          }
        | undefined;
    };

    const page = internal.buildReplayPage(
      {
        id: 'oversized-after-normal-page',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0, afterEventId: '' },
      },
      'stream-oversized-after-normal',
      {
        socket: {},
        phase: 'catching-up',
        highWatermark: { sequence: 3, eventId: 'event-000003' },
        replayCursor: { sequence: 0, eventId: '' },
        liveCursor: { sequence: 3, eventId: 'event-000003' },
      },
    );

    expect(page?.payload.replayedEvents.map((event) => event.sequence)).toEqual([1, 3]);
    expect(page?.payload.nextCursor).toBe(3);
    expect(page?.payload.nextEventId).toBe('event-000003');
    expect(page?.payload.replayComplete).toBe(true);
  });

  it('splits duplicate legacy sequences across strictly bounded replay pages', () => {
    const events = Array.from({ length: 66 }, (_, index): Event => ({
      ...eventAt(7),
      id: `event-duplicate-${String(index + 1).padStart(3, '0')}` as never,
    }));
    const fixture = pagedStore(events);
    const runtime = new Runtime({
      installId: 's3-duplicate-replay',
      allowNoToken: true,
      stateStore: fixture.store,
    });
    fixture.pageCalls.length = 0;
    const internal = runtime as unknown as {
      buildReplayPage(
        frame: Frame,
        streamId: string,
        subscription: {
          socket: object;
          phase: 'catching-up';
          highWatermark: { sequence: number; eventId: string };
          replayCursor: { sequence: number; eventId: string };
          liveCursor: { sequence: number; eventId: string };
        },
      ):
        | {
            payload: {
              replayedEvents: Event[];
              nextCursor: number;
              nextEventId?: string;
              replayComplete: boolean;
            };
          }
        | undefined;
    };
    const highWatermark = { sequence: 7, eventId: 'event-duplicate-066' };
    const first = internal.buildReplayPage(
      {
        id: 'duplicate-page-1',
        kind: 'request',
        type: 'runtime.subscribeEvents',
        payload: { afterCursor: 0, afterEventId: '' },
      },
      'stream-duplicate',
      {
        socket: {},
        phase: 'catching-up',
        highWatermark,
        replayCursor: { sequence: 0, eventId: '' },
        liveCursor: highWatermark,
      },
    );
    expect(first?.payload.replayedEvents).toHaveLength(64);
    expect(first?.payload.nextCursor).toBe(7);
    expect(first?.payload.nextEventId).toBe('event-duplicate-064');
    expect(first?.payload.replayComplete).toBe(false);

    const second = internal.buildReplayPage(
      {
        id: 'duplicate-page-2',
        kind: 'request',
        type: 'runtime.continueEventReplay',
        payload: {
          streamId: 'stream-duplicate',
          afterCursor: 7,
          afterEventId: 'event-duplicate-064',
        },
      },
      'stream-duplicate',
      {
        socket: {},
        phase: 'catching-up',
        highWatermark,
        replayCursor: { sequence: 7, eventId: 'event-duplicate-064' },
        liveCursor: highWatermark,
      },
    );
    expect(second?.payload.replayedEvents.map((event) => event.id)).toEqual([
      'event-duplicate-065',
      'event-duplicate-066',
    ]);
    expect(second?.payload.nextEventId).toBe('event-duplicate-066');
    expect(second?.payload.replayComplete).toBe(true);
  });
});
