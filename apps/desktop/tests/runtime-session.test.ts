import { describe, expect, it, vi } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  RuntimeSession,
  type RuntimeActivityCursorStore,
  type RuntimeSessionClient,
} from '../src/main/runtime-session.js';
import type {
  CommandType,
  ConversationTransientFrame,
  ConversationTransientSnapshot,
  EventReplayCursor,
} from '@sync-think/protocol';
import type { RuntimeHealth } from '../src/runtime-bridge-contract.js';
import { RuntimeResponseError } from '../src/main/runtime-client.js';

function eventAt(sequence: number): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-desktop' as Event['workspaceId'],
    category: 'system',
    type: `system.event-${sequence}`,
    sequence,
    occurredAt: '2026-07-11T08:00:00.000Z',
    payload: {},
  };
}

class FakeRuntimeClient implements RuntimeSessionClient {
  readonly health: RuntimeHealth;
  connectCount = 0;
  subscribeCount = 0;
  requestCount = 0;
  readonly subscribeFailures: Error[] = [];
  readonly subscribedAfterCursors: EventReplayCursor[] = [];
  subscribedAfterCursor: EventReplayCursor | undefined;
  subscribedCategories: readonly string[] | undefined;
  private listener: ((event: Event) => void) | undefined;
  private cursorListener: ((cursor: EventReplayCursor) => void) | undefined;
  private finishReplay: ((unsubscribe: () => Promise<void>) => void) | undefined;
  private readonly replayFinished = new Promise<() => Promise<void>>((resolve) => {
    this.finishReplay = resolve;
  });

  constructor(health?: RuntimeHealth) {
    this.health = health ?? {
      ok: true,
      runtimePid: 1234,
      uptimeMs: 50,
      protocolVersion: 2,
      features: [],
      inFlightRuns: 0,
      inFlightRunIds: [],
      eventSequence: 0,
    };
  }

  async connect(): Promise<void> {
    this.connectCount++;
  }

  subscribeEvents(
    afterCursor: EventReplayCursor,
    listener: (event: Event) => void,
    categories?: readonly string[],
    cursorListener?: (cursor: EventReplayCursor) => void,
  ) {
    this.subscribedAfterCursor = afterCursor;
    this.subscribedAfterCursors.push(afterCursor);
    this.subscribedCategories = categories;
    this.subscribeCount++;
    const failure = this.subscribeFailures.shift();
    if (failure) return Promise.reject(failure);
    this.listener = listener;
    this.cursorListener = cursorListener;
    return this.replayFinished;
  }

  private transientListener: ((frame: ConversationTransientFrame) => void) | undefined;
  private transientSnapshotListener:
    | ((latestStreamSequence: number, snapshot: ConversationTransientSnapshot | undefined) => void)
    | undefined;
  transientUnsubscribeCount = 0;

  async subscribeConversationTransientStream(
    _threadId: string,
    _afterStreamSequence: number,
    listener: (frame: ConversationTransientFrame) => void,
    snapshotListener?: (
      latestStreamSequence: number,
      snapshot: ConversationTransientSnapshot | undefined,
    ) => void,
  ): Promise<() => Promise<void>> {
    this.transientListener = listener;
    this.transientSnapshotListener = snapshotListener;
    return async () => {
      this.transientUnsubscribeCount++;
      this.transientListener = undefined;
      this.transientSnapshotListener = undefined;
    };
  }

  emitTransient(frame: ConversationTransientFrame): void {
    this.transientListener?.(frame);
  }

  resetTransient(latestStreamSequence: number, snapshot?: ConversationTransientSnapshot): void {
    this.transientSnapshotListener?.(latestStreamSequence, snapshot);
  }
  async request<T>(type: CommandType, payload: unknown): Promise<T> {
    expect(type).toBe('runtime.healthcheck');
    expect(payload).toEqual({});
    this.requestCount++;
    return this.health as T;
  }

  emit(event: Event): void {
    this.listener?.(event);
    this.cursorListener?.({ sequence: event.sequence, eventId: String(event.id) });
  }

  advanceCursor(cursor: EventReplayCursor): void {
    this.cursorListener?.(cursor);
  }

  completeReplay(): void {
    this.finishReplay?.(async () => {});
  }
}

describe('desktop main RuntimeSession', () => {
  it('resumes the lightweight activity stream from a persisted cursor and saves progress', async () => {
    const client = new FakeRuntimeClient();
    const saved: EventReplayCursor[] = [];
    const cursorStore: RuntimeActivityCursorStore = {
      load: () => ({ sequence: 41, eventId: 'event-41' }),
      save: (cursor) => saved.push(cursor),
    };
    const session = new RuntimeSession(client, () => {}, cursorStore);

    await session.connect();
    await expect.poll(() => client.subscribeCount).toBe(1);
    expect(client.subscribedAfterCursor).toEqual({ sequence: 41, eventId: 'event-41' });
    expect(client.subscribedCategories).toEqual(['message', 'run', 'approval']);

    client.advanceCursor({ sequence: 57, eventId: 'event-57' });
    expect(saved).toEqual([{ sequence: 57, eventId: 'event-57' }]);
    client.completeReplay();
  });

  it('resets an ahead persisted cursor and retries activity replay from zero', async () => {
    const client = new FakeRuntimeClient();
    client.subscribeFailures.push(
      new RuntimeResponseError(
        'protocol.unexpected_request',
        'Subscription cursor is ahead of the Runtime',
      ),
    );
    const resets: number[] = [];
    const cursorStore: RuntimeActivityCursorStore = {
      load: () => ({ sequence: 33_907, eventId: 'event-from-rolled-back-runtime' }),
      save: () => undefined,
      reset: () => resets.push(1),
    };
    const session = new RuntimeSession(client, () => {}, cursorStore);

    await session.connect();
    await expect.poll(() => client.subscribeCount).toBe(2);
    expect(client.subscribedAfterCursors).toEqual([
      { sequence: 33_907, eventId: 'event-from-rolled-back-runtime' },
      { sequence: 0, eventId: '' },
    ]);
    expect(resets).toEqual([1]);
    client.completeReplay();
  });

  it('returns quickly without waiting for full event replay catch-up', async () => {
    const client = new FakeRuntimeClient();
    const forwarded: number[] = [];
    const session = new RuntimeSession(client, (event) => forwarded.push(event.sequence));

    // connect() must not block on completeReplay — that made cold start wait
    // for the entire durable event log before listConversations could run.
    const first = await session.connect();
    const concurrent = await session.connect();

    expect(client.subscribeCount).toBe(1);
    expect(client.requestCount).toBe(2);
    expect(first.health).toEqual(client.health);
    expect(concurrent.health).toEqual(client.health);
    // Snapshot may still be empty while catch-up is in flight.
    expect(first.snapshot).toEqual([]);

    client.emit(eventAt(2));
    client.emit(eventAt(1));
    client.emit(eventAt(2));
    await Promise.resolve();
    expect(forwarded).toEqual([2, 1]);

    client.completeReplay();
    await Promise.resolve();

    // Subsequent connect returns whatever has already been buffered.
    const reconnectedRenderer = await session.connect();
    expect(reconnectedRenderer.snapshot.map((event) => event.sequence)).toEqual([1, 2]);
    expect(client.subscribeCount).toBe(1);

    client.emit(eventAt(3));
    const afterLive = await session.connect();
    expect(afterLive.snapshot.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('bounds a large sequential replay without replacing the history array per event', async () => {
    const client = new FakeRuntimeClient();
    const session = new RuntimeSession(client, () => {});
    await session.connect();
    await expect.poll(() => client.subscribeCount).toBe(1);

    const internal = session as unknown as { eventHistory: Event[] };
    const initialHistory = internal.eventHistory;
    for (let sequence = 1; sequence <= 10_000; sequence++) client.emit(eventAt(sequence));

    expect(internal.eventHistory).toBe(initialHistory);
    expect(internal.eventHistory).toHaveLength(2_048);
    expect(internal.eventHistory[0]?.sequence).toBe(7_953);
    expect(internal.eventHistory[2_047]?.sequence).toBe(10_000);
    client.completeReplay();
  });

  it('owns renderer transient subscriptions by sender and subscription id', async () => {
    const client = new FakeRuntimeClient();
    const session = new RuntimeSession(client, () => {});
    const received: number[] = [];
    const resets: number[] = [];

    await session.subscribeConversationTransientStream({
      senderId: 7,
      subscriptionId: 'chat-a',
      threadId: 'thread-a',
      afterStreamSequence: 2,
      listener: (frame) => received.push(frame.streamSequence),
      snapshotListener: (latest) => resets.push(latest),
    });
    client.emitTransient({
      threadId: 'thread-a' as ConversationTransientFrame['threadId'],
      runId: 'run-a' as ConversationTransientFrame['runId'],
      streamSequence: 3,
      kind: 'text',
      textDelta: 'hello',
      occurredAt: '2026-07-27T00:00:00.000Z',
    });
    client.resetTransient(3);
    expect(received).toEqual([3]);
    expect(resets).toEqual([3]);

    // Replacing the same renderer key first releases its prior Runtime stream.
    await session.subscribeConversationTransientStream({
      senderId: 7,
      subscriptionId: 'chat-a',
      threadId: 'thread-b',
      listener: () => {},
    });
    expect(client.transientUnsubscribeCount).toBe(1);
    await session.unsubscribeConversationTransientStreamsForSender(7);
    expect(client.transientUnsubscribeCount).toBe(2);
  });

  it('isolates renderer forwarding failures without closing the global subscription', async () => {
    const client = new FakeRuntimeClient();
    const forwarded: number[] = [];
    let firstForward = true;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = new RuntimeSession(client, (event) => {
      if (firstForward) {
        firstForward = false;
        throw new Error('webContents.send failed');
      }
      forwarded.push(event.sequence);
    });

    try {
      await session.connect();
      await expect.poll(() => client.subscribeCount).toBe(1);
      client.emit(eventAt(1));
      client.emit(eventAt(2));
      expect(warning).toHaveBeenCalled();
      expect(forwarded).toEqual([2]);
      client.completeReplay();
    } finally {
      warning.mockRestore();
    }
  });
});
