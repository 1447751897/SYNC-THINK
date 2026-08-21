import type { ExternalEventEnvelope, ExternalEventRecord } from '@sync-think/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { createPipeServer } from '../src/pipe/server.js';
import { daemonPipePath } from '../src/daemon/yield.js';
import {
  dispatchExternalEventToRuntime,
  getExternalEventStatusFromDaemon,
  sendExternalEventCompletionToDaemon,
  sendExternalEventHeartbeatToDaemon,
  submitExternalEventToDaemon,
} from '../src/daemon/external-event-client.js';

const installId = `external-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const secret = 'external-client-secret';
const servers: Array<ReturnType<typeof createPipeServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.destroyConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
});

const envelope: ExternalEventEnvelope = {
  id: 'evt-1',
  dedupeKey: 'github:delivery-1',
  source: { kind: 'git', name: 'github' },
  instruction: 'review push',
  target: { kind: 'model', modelId: 'model-1' },
  skillVersionIds: [],
};

const record: ExternalEventRecord = {
  ...envelope,
  state: 'leased',
  attemptCount: 1,
  leaseOwner: 'daemon-1',
  leaseToken: 'lease-1',
  leaseExpiresAt: '2026-08-21T00:01:00.000Z',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:01.000Z',
};

function options() {
  return {
    installId,
    helloSecret: secret,
    appVersion: 'test',
    handshakeTimeoutMs: 500,
    timeoutMs: 1_000,
  };
}

async function listen(
  path: string,
  onFrame: (socket: import('node:net').Socket, frame: Frame) => void,
): Promise<void> {
  const server = createPipeServer(
    {
      expectedInstallId: installId,
      expectedSecret: secret,
      allowNoToken: false,
      onReady: () => {},
      onClientHello: () => {},
      onClientGone: () => {},
      onFrame,
    },
    installId,
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
}

describe('external event pipe client', () => {
  it('submits to daemon and receives the durable dedupe result', async () => {
    await listen(daemonPipePath(installId), (socket, frame) => {
      if (frame.type !== 'external.event.submit') return;
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: { accepted: true, eventId: 'evt-1', created: true, state: 'pending' },
        }),
      );
    });

    await expect(submitExternalEventToDaemon(options(), envelope)).resolves.toEqual({
      ok: true,
      accepted: true,
      eventId: 'evt-1',
      created: true,
      state: 'pending',
    });
  });

  it('dispatches a leased event to Runtime and receives its run id', async () => {
    await listen(pipePathPortable(installId), (socket, frame) => {
      if (frame.type !== 'external.event.dispatch') return;
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: 'external.event.ack',
          payload: {
            eventId: 'evt-1',
            leaseToken: 'lease-1',
            accepted: true,
            runId: 'run-1',
          },
        }),
      );
    });

    await expect(dispatchExternalEventToRuntime(options(), record)).resolves.toEqual({
      ok: true,
      accepted: true,
      runId: 'run-1',
    });
  });

  it('queries the durable event state from daemon', async () => {
    await listen(daemonPipePath(installId), (socket, frame) => {
      if (frame.type !== 'external.event.status') return;
      socket.write(
        encodeFrame({
          id: frame.id,
          kind: 'response',
          type: frame.type,
          payload: { event: { ...record, state: 'completed', resultStatus: 'success' } },
        }),
      );
    });

    await expect(getExternalEventStatusFromDaemon(options(), { eventId: 'evt-1' })).resolves.toMatchObject({
      ok: true,
      event: { id: 'evt-1', state: 'completed', resultStatus: 'success' },
    });
  });

  it('flushes heartbeat and completion frames back to daemon', async () => {
    const received: Frame[] = [];
    await listen(daemonPipePath(installId), (_socket, frame) => received.push(frame));

    await expect(
      sendExternalEventHeartbeatToDaemon(options(), {
        eventId: 'evt-1',
        leaseToken: 'lease-1',
        runId: 'run-1',
      }),
    ).resolves.toBe(true);
    await expect(
      sendExternalEventCompletionToDaemon(options(), {
        eventId: 'evt-1',
        leaseToken: 'lease-1',
        runId: 'run-1',
        status: 'success',
      }),
    ).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(received.map((frame) => frame.type)).toEqual([
      'external.event.heartbeat',
      'external.event.complete',
    ]);
  });
});
