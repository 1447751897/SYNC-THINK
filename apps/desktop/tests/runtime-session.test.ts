import { describe, expect, it, vi } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  RuntimeSession,
  type RuntimeSessionClient,
} from '../src/main/runtime-session.js';
import type { RuntimeHealth } from '../src/runtime-bridge-contract.js';

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
  private listener: ((event: Event) => void) | undefined;
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
    };
  }

  async connect(): Promise<void> {
    this.connectCount++;
  }

  subscribeEvents(afterCursor: number, listener: (event: Event) => void) {
    expect(afterCursor).toBe(0);
    this.subscribeCount++;
    this.listener = listener;
    return this.replayFinished;
  }

  async request<T>(type: string, payload: unknown): Promise<T> {
    expect(type).toBe('runtime.healthcheck');
    expect(payload).toEqual({});
    this.requestCount++;
    return this.health as T;
  }

  emit(event: Event): void {
    this.listener?.(event);
  }

  completeReplay(): void {
    this.finishReplay?.(async () => {});
  }
}

describe('desktop main RuntimeSession', () => {
  it('waits for replay catch-up and returns a sorted snapshot from one global subscription', async () => {
    const client = new FakeRuntimeClient();
    const forwarded: number[] = [];
    const session = new RuntimeSession(client, (event) => forwarded.push(event.sequence));

    let firstSettled = false;
    const firstConnect = session.connect().then((result) => {
      firstSettled = true;
      return result;
    });
    const concurrentConnect = session.connect();

    await expect.poll(() => client.subscribeCount).toBe(1);
    client.emit(eventAt(2));
    client.emit(eventAt(1));
    client.emit(eventAt(2));
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    client.completeReplay();
    const [first, concurrent] = await Promise.all([firstConnect, concurrentConnect]);

    expect(first.snapshot.map((event) => event.sequence)).toEqual([1, 2]);
    expect(concurrent.snapshot.map((event) => event.sequence)).toEqual([1, 2]);
    expect(first.health).toEqual(client.health);
    expect(forwarded).toEqual([2, 1]);
    expect(client.subscribeCount).toBe(1);

    client.emit(eventAt(3));
    const reconnectedRenderer = await session.connect();
    expect(reconnectedRenderer.snapshot.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(client.subscribeCount).toBe(1);
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
      const connecting = session.connect();
      await expect.poll(() => client.subscribeCount).toBe(1);

      expect(() => client.emit(eventAt(1))).not.toThrow();
      expect(() => client.emit(eventAt(2))).not.toThrow();
      client.completeReplay();

      const connected = await connecting;
      expect(connected.snapshot.map((event) => event.sequence)).toEqual([1, 2]);
      expect(forwarded).toEqual([2]);
      expect(client.subscribeCount).toBe(1);

      const reloaded = await session.connect();
      expect(reloaded.snapshot.map((event) => event.sequence)).toEqual([1, 2]);
      expect(client.subscribeCount).toBe(1);
      expect(warning).toHaveBeenCalledWith('[desktop] runtime event forwarding failed');
    } finally {
      warning.mockRestore();
    }
  });

  it('removes Runtime health messages before returning data to the Renderer', async () => {
    const client = new FakeRuntimeClient({
      ok: false,
      error: { code: 'runtime.no_pid', message: 'raw Runtime detail' },
    });
    const session = new RuntimeSession(client, () => undefined);
    const connecting = session.connect();
    await expect.poll(() => client.subscribeCount).toBe(1);
    client.completeReplay();

    await expect(connecting).resolves.toEqual({
      health: { ok: false, error: { code: 'runtime.no_pid' } },
      snapshot: [],
    });
  });

  it('scrubs secrets from live and replayed events before they enter Renderer state', async () => {
    const client = new FakeRuntimeClient();
    const forwarded: Event[] = [];
    const session = new RuntimeSession(client, (event) => forwarded.push(event));
    const original = {
      ...eventAt(1),
      payload: {
        apiKey: 'sk-ant-live-secret-123456789',
        credentialRefId: 'credential-safe-ref',
        hasSecret: true,
        tokenCount: 42,
        tokensIn: 7,
        tokensOut: 9,
        authToken: 'auth-secret-token-123456',
        session_token: 'session-secret-token-123456',
        privateKey: 'private-key-secret-123456',
        secretValue: 'opaque-secret-value-123456',
        nested: {
          authorization: 'Bearer runtime-secret-token-123456',
          message: 'request failed: api_key=sk-provider-secret-123456',
          values: [
            'safe',
            'Bearer nested-secret-token-123456',
            'session_token=session-text-secret-123456',
            '-----BEGIN PRIVATE KEY-----\nprivate-text-secret-123456\n-----END PRIVATE KEY-----',
          ],
        },
      },
    } satisfies Event;

    const connecting = session.connect();
    await expect.poll(() => client.subscribeCount).toBe(1);
    client.emit(original);
    client.completeReplay();

    const connected = await connecting;
    expect(JSON.stringify(connected.snapshot)).not.toContain('live-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('runtime-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('provider-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('nested-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('auth-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('session-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('private-key-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('opaque-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('session-text-secret');
    expect(JSON.stringify(connected.snapshot)).not.toContain('private-text-secret');
    expect(JSON.stringify(forwarded)).toBe(JSON.stringify(connected.snapshot));
    expect(connected.snapshot[0]?.payload).toMatchObject({
      apiKey: '[REDACTED]',
      credentialRefId: 'credential-safe-ref',
      hasSecret: true,
      tokenCount: 42,
      tokensIn: 7,
      tokensOut: 9,
      authToken: '[REDACTED]',
      session_token: '[REDACTED]',
      privateKey: '[REDACTED]',
      secretValue: '[REDACTED]',
      nested: {
        authorization: '[REDACTED]',
        message: 'request failed: api_key=[REDACTED]',
        values: ['safe', 'Bearer [REDACTED]', 'session_token=[REDACTED]', '[REDACTED]'],
      },
    });
    expect(original.payload.apiKey).toBe('sk-ant-live-secret-123456789');
  });
});
