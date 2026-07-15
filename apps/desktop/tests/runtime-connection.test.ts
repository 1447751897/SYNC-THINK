import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import type {
  RuntimeConnectOutcome,
  RuntimeConnectResult,
} from '../src/runtime-bridge-contract.js';
import {
  startRuntimeConnection,
  type RuntimeRetryScheduler,
} from '../src/renderer/runtime-connection.js';
import {
  canSendRuntimeMessage,
  createInitialRuntimeViewState,
  runtimeViewReducer,
} from '../src/renderer/runtime-view-state.js';

function eventAt(sequence: number, payload: Record<string, unknown> = {}): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-desktop' as Event['workspaceId'],
    category: 'message',
    type: 'message.appended',
    sequence,
    occurredAt: '2026-07-11T08:00:00.000Z',
    payload,
  };
}

function connectResult(snapshot: readonly Event[] = []): RuntimeConnectResult {
  return {
    health: {
      ok: true,
      runtimePid: 1234,
      uptimeMs: 50,
      protocolVersion: 2,
      features: [],
      inFlightRuns: 0,
    },
    snapshot,
  };
}

class ManualScheduler implements RuntimeRetryScheduler {
  private nextId = 1;
  private readonly tasks = new Map<number, () => void>();
  readonly delays: number[] = [];

  schedule(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.delays.push(delayMs);
    this.tasks.set(id, callback);
    return id;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  runNext(): void {
    const next = this.tasks.entries().next().value as [number, () => void] | undefined;
    if (!next) return;
    this.tasks.delete(next[0]);
    next[1]();
  }

  get pendingCount(): number {
    return this.tasks.size;
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Renderer Runtime connection controller', () => {
  it('retries a transient first failure and publishes the successful snapshot', async () => {
    const scheduler = new ManualScheduler();
    const result = connectResult([eventAt(1)]);
    const outcomes: RuntimeConnectOutcome[] = [
      { ok: false, error: { code: 'runtime.unavailable', retryable: true } },
      { ok: true, result },
    ];
    let attempts = 0;
    const connected: RuntimeConnectResult[] = [];
    const failed: unknown[] = [];

    startRuntimeConnection({
      connect: async () => outcomes[attempts++]!,
      retryDelaysMs: [25, 50],
      scheduler,
      onConnected: (value) => connected.push(value),
      onFailed: (error) => failed.push(error),
    });

    await flushAsyncWork();
    expect(attempts).toBe(1);
    expect(scheduler.delays).toEqual([25]);
    expect(scheduler.pendingCount).toBe(1);

    scheduler.runNext();
    await flushAsyncWork();
    expect(attempts).toBe(2);
    expect(connected).toEqual([result]);
    expect(failed).toEqual([]);
  });

  it('does not retry a non-retryable connection failure', async () => {
    const scheduler = new ManualScheduler();
    let attempts = 0;
    const failed: unknown[] = [];

    startRuntimeConnection({
      connect: async () => {
        attempts++;
        return {
          ok: false,
          error: { code: 'runtime.authentication-failed', retryable: false },
        };
      },
      retryDelaysMs: [25, 50],
      scheduler,
      onConnected: () => undefined,
      onFailed: (error) => failed.push(error),
    });

    await flushAsyncWork();
    expect(attempts).toBe(1);
    expect(scheduler.pendingCount).toBe(0);
    expect(failed).toEqual([
      { code: 'runtime.authentication-failed', retryable: false },
    ]);
  });

  it('cancels a scheduled retry and suppresses later updates', async () => {
    const scheduler = new ManualScheduler();
    let attempts = 0;
    const connected: RuntimeConnectResult[] = [];
    const failed: unknown[] = [];
    const cancel = startRuntimeConnection({
      connect: async () => {
        attempts++;
        return { ok: false, error: { code: 'runtime.unavailable', retryable: true } };
      },
      retryDelaysMs: [25],
      scheduler,
      onConnected: (value) => connected.push(value),
      onFailed: (error) => failed.push(error),
    });

    await flushAsyncWork();
    expect(scheduler.pendingCount).toBe(1);
    cancel();
    expect(scheduler.pendingCount).toBe(0);
    scheduler.runNext();
    await flushAsyncWork();

    expect(attempts).toBe(1);
    expect(connected).toEqual([]);
    expect(failed).toEqual([]);
  });
});

describe('Renderer Runtime hydration state', () => {
  it('keeps Compose gated until snapshot and taskVersion are hydrated atomically', () => {
    const threadId = 'thread-desktop-main';
    const initial = createInitialRuntimeViewState(true);
    expect(initial.connectionState).toBe('connecting');
    expect(canSendRuntimeMessage(initial.connectionState)).toBe(false);

    const withLive = runtimeViewReducer(initial, {
      type: 'event-received',
      event: eventAt(1, { threadId, role: 'user', text: 'live', taskVersion: 1 }),
      threadId,
    });
    expect(withLive.taskVersion).toBe(1);
    expect(withLive.connectionState).toBe('connecting');
    expect(canSendRuntimeMessage(withLive.connectionState)).toBe(false);

    const hydrated = runtimeViewReducer(withLive, {
      type: 'connect-succeeded',
      result: connectResult([
        eventAt(2, { threadId, role: 'user', text: 'snapshot', taskVersion: 2 }),
      ]),
      threadId,
    });
    expect(hydrated.eventHistory.map((event) => event.sequence)).toEqual([1, 2]);
    expect(hydrated.taskVersion).toBe(2);
    expect(hydrated.connectionState).toBe('online');
    expect(canSendRuntimeMessage(hydrated.connectionState)).toBe(true);

    const offline = runtimeViewReducer(hydrated, { type: 'connect-failed' });
    expect(canSendRuntimeMessage(offline.connectionState)).toBe(false);
    expect(canSendRuntimeMessage(createInitialRuntimeViewState(false).connectionState)).toBe(true);
  });
});


describe('Renderer Runtime reconnect state', () => {
  it('records lastConnectFailure and clears it after reconnect success', () => {
    const threadId = 'thread-desktop-main';
    let state = createInitialRuntimeViewState(true);
    state = runtimeViewReducer(state, {
      type: 'connect-failed',
      error: { code: 'runtime.unavailable', retryable: true },
    });
    expect(state.connectionState).toBe('offline');
    expect(state.lastConnectFailure).toEqual({
      code: 'runtime.unavailable',
      retryable: true,
    });

    state = runtimeViewReducer(state, { type: 'reconnect-requested' });
    expect(state.connectionState).toBe('connecting');
    expect(state.lastConnectFailure?.code).toBe('runtime.unavailable');

    state = runtimeViewReducer(state, {
      type: 'connect-succeeded',
      result: {
        health: {
          ok: true,
          runtimePid: 1,
          uptimeMs: 1,
          protocolVersion: 2,
          features: [],
          inFlightRuns: 0,
        },
        snapshot: [],
      },
      threadId,
    });
    expect(state.connectionState).toBe('online');
    expect(state.lastConnectFailure).toBeNull();
  });
});
