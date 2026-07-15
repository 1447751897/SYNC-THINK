import { describe, expect, it } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';
import { Runtime } from '../../runtime/src/runtime.js';
import { RuntimePipeClient } from '../src/main/runtime-client.js';

async function waitFor(predicate: () => boolean, timeoutMs: number = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

function eventAt(sequence: number): Event {
  return {
    id: `event-${sequence}` as Event['id'],
    workspaceId: 'workspace-page-test' as Event['workspaceId'],
    category: 'message',
    type: 'message.appended',
    sequence,
    occurredAt: new Date().toISOString(),
    payload: { text: `event ${sequence}` },
  };
}

describe('RuntimePipeClient', () => {
  it('does not carry a partial frame into a new manual connection', async () => {
    const installId = `desktop-client-partial-reconnect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let connectionCount = 0;
    let partialSent = false;
    const server = createServer((socket) => {
      connectionCount++;
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type !== '__hello') continue;
          if (connectionCount === 1) {
            const response = encodeFrame({
              id: frame.id,
              kind: 'response',
              type: '__hello',
              payload: { ok: true },
            });
            socket.write(response.subarray(0, 2));
            partialSent = true;
          } else {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });

    try {
      const firstConnect = client.connect();
      expect(await waitFor(() => partialSent)).toBe(true);
      client.disconnect();
      await expect(firstConnect).rejects.toThrow('Runtime connection closed');
      await expect(client.connect()).resolves.toBeUndefined();
      expect(connectionCount).toBe(2);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects a malformed handshake frame and destroys the candidate socket', async () => {
    const installId = `desktop-client-malformed-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let candidateClosed = false;
    const server = createServer((socket) => {
      socket.once('close', () => {
        candidateClosed = true;
      });
      socket.once('data', () => {
        const malformed = Buffer.alloc(5);
        malformed.writeUInt32BE(1, 0);
        malformed.write('{', 4, 'utf8');
        socket.write(malformed);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      helloSecret: 'install-secret',
      requestTimeoutMs: 100,
    });

    try {
      await expect(client.connect()).rejects.toThrow('Runtime authentication failed');
      expect(await waitFor(() => candidateClosed)).toBe(true);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not trust an unauthenticated Runtime error message', async () => {
    const installId = `desktop-client-untrusted-error-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const server = createServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type !== '__hello') continue;
          socket.write(
            encodeFrame({
              id: frame.id,
              kind: 'response',
              type: '__hello',
              payload: {},
              error: {
                code: 'protocol.unexpected_request' as never,
                message: 'attacker-controlled error text',
              },
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      helloSecret: 'install-secret',
    });

    try {
      await expect(client.connect()).rejects.toThrow('Runtime authentication failed');
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects a fake Runtime that cannot prove possession of the install secret', async () => {
    const installId = `desktop-client-fake-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const server = createServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      helloSecret: 'install-secret',
    });

    try {
      await expect(client.connect()).rejects.toThrow('Runtime authentication failed');
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('destroys an unauthenticated socket after the hello request times out', async () => {
    const installId = `desktop-client-hello-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let connectionCount = 0;
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      connectionCount++;
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      requestTimeoutMs: 25,
    });

    try {
      await expect(client.connect()).rejects.toThrow('Runtime request timed out: __hello');
      await expect(client.connect()).rejects.toThrow('Runtime request timed out: __hello');
      expect(connectionCount).toBe(2);
    } finally {
      client.disconnect();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('waits for the hello handshake before concurrent requests are sent', async () => {
    const installId = `desktop-client-race-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });

    try {
      const connecting = client.connect();
      const health = client.request('runtime.healthcheck', {});

      await expect(connecting).resolves.toBeUndefined();
      await expect(health).resolves.toMatchObject({ ok: true, protocolVersion: 2 });
    } finally {
      client.disconnect();
      await runtime.stop();
    }
  });

  it('handshakes, sends commands, and receives subscribed Runtime events', async () => {
    const installId = `desktop-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });
    const events: Event[] = [];

    try {
      await client.connect();
      const health = await client.request('runtime.healthcheck', {});
      expect(health).toMatchObject({ ok: true, protocolVersion: 2 });

      const unsubscribe = await client.subscribeEvents(0, (event) => events.push(event));
      const append = await client.request('task.appendMessage', {
        threadId: 'thread-desktop-client',
        expectedTaskVersion: 0,
        role: 'user',
        text: 'from Electron main',
      });
      expect(append).toMatchObject({ taskVersion: 1 });
      expect(await waitFor(() => events.some((event) => event.type === 'message.appended'))).toBe(
        true,
      );
      expect(events.find((event) => event.type === 'message.appended')).toMatchObject({
        sequence: 1,
        payload: { text: 'from Electron main' },
      });
      await unsubscribe();
    } finally {
      client.disconnect();
      await runtime.stop();
    }
  });

  it('delivers durable events newer than the initial subscription cursor', async () => {
    const installId = `desktop-client-replay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });
    const events: Event[] = [];

    try {
      await client.request('task.appendMessage', {
        threadId: 'thread-desktop-replay',
        expectedTaskVersion: 0,
        role: 'user',
        text: 'before initial subscription',
      });

      await client.subscribeEvents(0, (event) => events.push(event));

      expect(events).toMatchObject([
        {
          sequence: 1,
          type: 'message.appended',
          payload: { text: 'before initial subscription' },
        },
      ]);
    } finally {
      client.disconnect();
      await runtime.stop();
    }
  });

  it('does not drop a live event bundled with the subscription response', async () => {
    const installId = `desktop-client-bundled-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const event = {
      id: 'event-bundled',
      workspaceId: 'workspace-bundled',
      category: 'message',
      type: 'message.appended',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      payload: { text: 'bundled live event' },
    } as Event;
    const server = createServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents') {
            const response: Frame = {
              id: frame.id,
              kind: 'response',
              type: 'runtime.subscribeEvents',
              payload: {
                streamId: 'stream-bundled',
                startingSequence: 1,
                replayedEvents: [],
                nextCursor: 0,
                highWatermark: 0,
                replayComplete: true,
              },
            };
            const liveEvent: Frame = {
              id: 'stream-bundled',
              kind: 'event',
              type: 'runtime.event',
              payload: { streamId: 'stream-bundled', event },
            };
            socket.write(Buffer.concat([encodeFrame(response), encodeFrame(liveEvent)]));
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });
    const events: Event[] = [];

    try {
      await client.subscribeEvents(0, (received) => events.push(received));
      expect(events).toEqual([event]);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('buffers bundled live events until every replay page is committed', async () => {
    const installId = `desktop-client-paged-replay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const makeEvent = (sequence: number) =>
      ({
        id: `event-paged-${sequence}`,
        workspaceId: 'workspace-paged',
        category: 'message',
        type: 'message.appended',
        sequence,
        occurredAt: new Date().toISOString(),
        payload: { text: `event ${sequence}` },
      }) as Event;
    let continuationCount = 0;
    const server = createServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents') {
            const response: Frame = {
              id: frame.id,
              kind: 'response',
              type: 'runtime.subscribeEvents',
              payload: {
                streamId: 'stream-paged',
                startingSequence: 1,
                replayedEvents: [makeEvent(1), makeEvent(2)],
                nextCursor: 2,
                highWatermark: 4,
                replayComplete: false,
              },
            };
            const live: Frame = {
              id: 'stream-paged',
              kind: 'event',
              type: 'runtime.event',
              payload: { streamId: 'stream-paged', event: makeEvent(5) },
            };
            socket.write(Buffer.concat([encodeFrame(response), encodeFrame(live)]));
          }
          if (frame.type === 'runtime.continueEventReplay') {
            continuationCount++;
            expect(frame.payload).toMatchObject({
              streamId: 'stream-paged',
              afterCursor: 2,
            });
            const response: Frame = {
              id: frame.id,
              kind: 'response',
              type: 'runtime.continueEventReplay',
              payload: {
                streamId: 'stream-paged',
                replayedEvents: [makeEvent(3), makeEvent(4)],
                nextCursor: 4,
                highWatermark: 4,
                replayComplete: true,
              },
            };
            const duplicateLive: Frame = {
              id: 'stream-paged',
              kind: 'event',
              type: 'runtime.event',
              payload: { streamId: 'stream-paged', event: makeEvent(5) },
            };
            socket.write(Buffer.concat([encodeFrame(response), encodeFrame(duplicateLive)]));
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });
    const sequences: number[] = [];

    try {
      await client.subscribeEvents(0, (event) => sequences.push(event.sequence));
      expect(continuationCount).toBe(1);
      expect(sequences).toEqual([1, 2, 3, 4, 5]);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('buffers live from the first response package until every replay page is committed', async () => {
    const installId = `desktop-client-paged-replay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const received: number[] = [];
    const receivedBeforeContinuation: number[][] = [];
    const continuationCursors: number[] = [];
    const server = createServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents') {
            const firstPage: Frame = {
              id: frame.id,
              kind: 'response',
              type: 'runtime.subscribeEvents',
              payload: {
                streamId: 'stream-paged',
                startingSequence: 1,
                replayedEvents: [eventAt(1)],
                nextCursor: 1,
                highWatermark: 3,
                replayComplete: false,
              },
            };
            const liveEvent: Frame = {
              id: 'stream-paged',
              kind: 'event',
              type: 'runtime.event',
              payload: { streamId: 'stream-paged', event: eventAt(4) },
            };
            socket.write(Buffer.concat([encodeFrame(firstPage), encodeFrame(liveEvent)]));
          }
          if (frame.type === 'runtime.continueEventReplay') {
            const payload = frame.payload as { afterCursor: number };
            continuationCursors.push(payload.afterCursor);
            receivedBeforeContinuation.push([...received]);
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: 'runtime.continueEventReplay',
                payload: {
                  streamId: 'stream-paged',
                  replayedEvents: [eventAt(2), eventAt(3)],
                  nextCursor: 3,
                  highWatermark: 3,
                  replayComplete: true,
                },
              }),
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });

    try {
      await client.subscribeEvents(0, (event) => received.push(event.sequence));
      expect(continuationCursors).toEqual([1]);
      expect(receivedBeforeContinuation).toEqual([[1]]);
      expect(received).toEqual([1, 2, 3, 4]);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reconnects paged replay from the last committed cursor and preserves categories', async () => {
    const installId = `desktop-client-paged-reconnect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const subscriptionPayloads: Array<{ afterCursor: number; categories?: string[] }> = [];
    let connectionCount = 0;
    const server = createServer((socket) => {
      connectionCount++;
      const connectionNumber = connectionCount;
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents') {
            subscriptionPayloads.push(
              frame.payload as { afterCursor: number; categories?: string[] },
            );
            const response: Frame =
              connectionNumber === 1
                ? {
                    id: frame.id,
                    kind: 'response',
                    type: 'runtime.subscribeEvents',
                    payload: {
                      streamId: 'stream-paged-first',
                      startingSequence: 1,
                      replayedEvents: [eventAt(1)],
                      nextCursor: 1,
                      highWatermark: 3,
                      replayComplete: false,
                    },
                  }
                : {
                    id: frame.id,
                    kind: 'response',
                    type: 'runtime.subscribeEvents',
                    payload: {
                      streamId: 'stream-paged-restored',
                      startingSequence: 2,
                      replayedEvents: [eventAt(2), eventAt(3)],
                      nextCursor: 3,
                      highWatermark: 3,
                      replayComplete: true,
                    },
                  };
            if (connectionNumber === 1) {
              const live: Frame = {
                id: 'stream-paged-first',
                kind: 'event',
                type: 'runtime.event',
                payload: { streamId: 'stream-paged-first', event: eventAt(4) },
              };
              socket.write(Buffer.concat([encodeFrame(response), encodeFrame(live)]));
            } else {
              const live: Frame = {
                id: 'stream-paged-restored',
                kind: 'event',
                type: 'runtime.event',
                payload: { streamId: 'stream-paged-restored', event: eventAt(4) },
              };
              socket.write(Buffer.concat([encodeFrame(response), encodeFrame(live)]));
            }
          }
          if (frame.type === 'runtime.continueEventReplay' && connectionNumber === 1) {
            expect(frame.payload).toMatchObject({
              streamId: 'stream-paged-first',
              afterCursor: 1,
            });
            socket.destroy();
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      reconnectDelayMs: 10,
    });
    const received: number[] = [];

    try {
      await expect(
        client.subscribeEvents(0, (event) => received.push(event.sequence), ['message']),
      ).resolves.toBeTypeOf('function');
      expect(subscriptionPayloads).toEqual([
        { afterCursor: 0, categories: ['message'] },
        { afterCursor: 1, categories: ['message'] },
      ]);
      expect(received).toEqual([1, 2, 3, 4]);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps reconnecting when a paged subscription restore disconnects again', async () => {
    const installId = `desktop-client-paged-double-reconnect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const subscriptionPayloads: Array<{ afterCursor: number; categories?: string[] }> = [];
    let connectionCount = 0;
    const server = createServer((socket) => {
      connectionCount++;
      const connectionNumber = connectionCount;
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents') {
            subscriptionPayloads.push(
              frame.payload as { afterCursor: number; categories?: string[] },
            );
            if (connectionNumber === 1) {
              socket.write(
                encodeFrame({
                  id: frame.id,
                  kind: 'response',
                  type: 'runtime.subscribeEvents',
                  payload: {
                    streamId: 'stream-double-first',
                    startingSequence: 1,
                    replayedEvents: [eventAt(1)],
                    nextCursor: 1,
                    highWatermark: 1,
                    replayComplete: true,
                  },
                }),
              );
            } else if (connectionNumber === 2) {
              socket.write(
                encodeFrame({
                  id: frame.id,
                  kind: 'response',
                  type: 'runtime.subscribeEvents',
                  payload: {
                    streamId: 'stream-double-second',
                    startingSequence: 2,
                    replayedEvents: [eventAt(2)],
                    nextCursor: 2,
                    highWatermark: 4,
                    replayComplete: false,
                  },
                }),
              );
            } else {
              const response: Frame = {
                id: frame.id,
                kind: 'response',
                type: 'runtime.subscribeEvents',
                payload: {
                  streamId: 'stream-double-third',
                  startingSequence: 3,
                  replayedEvents: [eventAt(3), eventAt(4)],
                  nextCursor: 4,
                  highWatermark: 4,
                  replayComplete: true,
                },
              };
              const live: Frame = {
                id: 'stream-double-third',
                kind: 'event',
                type: 'runtime.event',
                payload: { streamId: 'stream-double-third', event: eventAt(5) },
              };
              socket.write(Buffer.concat([encodeFrame(response), encodeFrame(live)]));
            }
          }
          if (frame.type === 'runtime.continueEventReplay' && connectionNumber === 2) {
            expect(frame.payload).toMatchObject({
              streamId: 'stream-double-second',
              afterCursor: 2,
            });
            socket.destroy();
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      reconnectDelayMs: 10,
    });
    const received: number[] = [];

    try {
      await client.subscribeEvents(0, (event) => received.push(event.sequence), ['message']);
      const firstTransport = (client as unknown as { socket: Socket | null }).socket;
      firstTransport?.destroy();

      expect(await waitFor(() => received.includes(5), 1_500)).toBe(true);
      expect(subscriptionPayloads).toEqual([
        { afterCursor: 0, categories: ['message'] },
        { afterCursor: 1, categories: ['message'] },
        { afterCursor: 2, categories: ['message'] },
      ]);
      expect(received).toEqual([1, 2, 3, 4, 5]);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not revive a subscription cancelled while its restore response is pending', async () => {
    const installId = `desktop-client-cancel-restore-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let connectionCount = 0;
    let delayedSocket: Socket | null = null;
    let delayedRequest: Frame | null = null;
    const unsubscribedStreams: string[] = [];
    const server = createServer((socket) => {
      connectionCount++;
      const connectionNumber = connectionCount;
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents' && connectionNumber === 1) {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: 'runtime.subscribeEvents',
                payload: {
                  streamId: 'stream-cancel-initial',
                  startingSequence: 1,
                  replayedEvents: [eventAt(1)],
                  nextCursor: 1,
                  highWatermark: 1,
                  replayComplete: true,
                },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents' && connectionNumber === 2) {
            delayedSocket = socket;
            delayedRequest = frame;
          }
          if (frame.type === 'runtime.unsubscribeEvents') {
            const payload = frame.payload as { streamId: string };
            unsubscribedStreams.push(payload.streamId);
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: 'runtime.unsubscribeEvents',
                payload,
              }),
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      reconnectDelayMs: 10,
    });
    const received: number[] = [];

    try {
      const unsubscribe = await client.subscribeEvents(0, (event) => received.push(event.sequence));
      const firstTransport = (client as unknown as { socket: Socket | null }).socket;
      firstTransport?.destroy();
      expect(await waitFor(() => delayedRequest !== null)).toBe(true);

      await unsubscribe();
      const responseRequest = delayedRequest!;
      delayedSocket!.write(
        encodeFrame({
          id: responseRequest.id,
          kind: 'response',
          type: 'runtime.subscribeEvents',
          payload: {
            streamId: 'stream-cancelled-restore',
            startingSequence: 2,
            replayedEvents: [eventAt(2)],
            nextCursor: 2,
            highWatermark: 2,
            replayComplete: true,
          },
        }),
      );

      expect(await waitFor(() => unsubscribedStreams.length === 1)).toBe(true);
      expect(unsubscribedStreams).toEqual(['stream-cancelled-restore']);
      expect(received).toEqual([1]);
      expect((client as unknown as { subscriptions: Set<unknown> }).subscriptions.size).toBe(0);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('cleans up a subscription when its replay listener throws', async () => {
    const installId = `desktop-client-replay-listener-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });

    try {
      await client.request('task.appendMessage', {
        threadId: 'thread-replay-listener',
        expectedTaskVersion: 0,
        role: 'user',
        text: 'durable replay',
      });
      await expect(
        client.subscribeEvents(0, () => {
          throw new Error('listener failed');
        }),
      ).rejects.toThrow('listener failed');
      expect(
        (client as unknown as { subscriptions: Set<unknown> }).subscriptions.size,
      ).toBe(0);
      expect(
        await waitFor(
          () => (runtime as unknown as { subscriptions: Map<string, unknown> }).subscriptions.size === 0,
        ),
      ).toBe(true);
      await expect(client.request('runtime.healthcheck', {})).resolves.toMatchObject({ ok: true });
    } finally {
      client.disconnect();
      await runtime.stop();
    }
  });

  it('isolates a throwing live listener from other subscriptions', async () => {
    const installId = `desktop-client-live-listener-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });
    const received: Event[] = [];

    try {
      await client.subscribeEvents(0, () => {
        throw new Error('listener failed');
      });
      const unsubscribeHealthy = await client.subscribeEvents(0, (event) => received.push(event));
      await client.request('task.appendMessage', {
        threadId: 'thread-live-listener',
        expectedTaskVersion: 0,
        role: 'user',
        text: 'live event',
      });

      expect(await waitFor(() => received.length === 1)).toBe(true);
      expect(
        (client as unknown as { subscriptions: Set<unknown> }).subscriptions.size,
      ).toBe(1);
      await expect(client.request('runtime.healthcheck', {})).resolves.toMatchObject({ ok: true });
      await unsubscribeHealthy();
    } finally {
      client.disconnect();
      await runtime.stop();
    }
  });

  it('ignores a subscribe response that arrives after its request timed out', async () => {
    const installId = `desktop-client-late-subscribe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const unsubscribedStreams: string[] = [];
    const server = createServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        const decoded = decodeFrames(Buffer.concat([pending, chunk]));
        pending = decoded.remaining;
        for (const frame of decoded.frames) {
          if (frame.type === '__hello') {
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
          if (frame.type === 'runtime.subscribeEvents') {
            setTimeout(() => {
              if (socket.destroyed) return;
              socket.write(
                encodeFrame({
                  id: frame.id,
                  kind: 'response',
                  type: 'runtime.subscribeEvents',
                  payload: {
                    streamId: 'stream-late',
                    startingSequence: 1,
                    replayedEvents: [],
                    nextCursor: 0,
                    highWatermark: 0,
                    replayComplete: true,
                  },
                }),
              );
            }, 50);
          }
          if (frame.type === 'runtime.unsubscribeEvents') {
            const payload = frame.payload as { streamId: string };
            unsubscribedStreams.push(payload.streamId);
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: 'runtime.unsubscribeEvents',
                payload,
              }),
            );
          }
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePathPortable(installId), resolve);
    });
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      requestTimeoutMs: 20,
    });

    try {
      await expect(client.subscribeEvents(0, () => {})).rejects.toThrow(
        'Runtime request timed out: runtime.subscribeEvents',
      );
      await new Promise((resolve) => setTimeout(resolve, 70));
      expect(
        (client as unknown as { pendingStreamEvents: Map<string, Event[]> }).pendingStreamEvents
          .size,
      ).toBe(0);
      expect(unsubscribedStreams).toEqual(['stream-late']);
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('restores an event subscription after a transient transport disconnect', async () => {
    const installId = `desktop-client-reconnect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const client = new RuntimePipeClient({ installId, appVersion: '0.0.1' });
    const events: Event[] = [];

    try {
      await client.subscribeEvents(0, (event) => events.push(event));
      await client.request('task.appendMessage', {
        threadId: 'thread-desktop-reconnect',
        expectedTaskVersion: 0,
        role: 'user',
        text: 'before disconnect',
      });
      expect(await waitFor(() => events.length === 1)).toBe(true);

      const transport = (client as unknown as { socket: Socket | null }).socket;
      transport?.destroy();
      expect(await waitFor(() => transport?.destroyed === true)).toBe(true);

      await client.request('runtime.healthcheck', {});
      await client.request('task.appendMessage', {
        threadId: 'thread-desktop-reconnect',
        expectedTaskVersion: 1,
        role: 'user',
        text: 'after reconnect',
      });

      expect(
        await waitFor(() => events.some((event) => event.payload.text === 'after reconnect')),
      ).toBe(true);
    } finally {
      client.disconnect();
      await runtime.stop();
    }
  });

  it('automatically reconnects an active subscription without another command', async () => {
    const installId = `desktop-client-auto-reconnect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true });
    await runtime.start();
    const subscriber = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      reconnectDelayMs: 10,
    });
    const producer = new RuntimePipeClient({ installId, appVersion: '0.0.1' });
    const events: Event[] = [];

    try {
      await subscriber.subscribeEvents(0, (event) => events.push(event));
      const droppedTransport = (subscriber as unknown as { socket: Socket | null }).socket;
      droppedTransport?.destroy();

      expect(
        await waitFor(() => {
          const current = (subscriber as unknown as { socket: Socket | null }).socket;
          return Boolean(current && current !== droppedTransport && !current.destroyed);
        }),
      ).toBe(true);

      await producer.request('task.appendMessage', {
        threadId: 'thread-desktop-auto-reconnect',
        expectedTaskVersion: 0,
        role: 'user',
        text: 'published after automatic reconnect',
      });

      expect(
        await waitFor(() =>
          events.some((event) => event.payload.text === 'published after automatic reconnect'),
        ),
      ).toBe(true);
    } finally {
      subscriber.disconnect();
      producer.disconnect();
      await runtime.stop();
    }
  });

  it('does not automatically retry after Runtime authentication fails', async () => {
    const installId = `desktop-client-auth-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secret = 'install-secret';
    const runtime = new Runtime({ installId, helloSecret: secret });
    await runtime.start();
    const client = new RuntimePipeClient({
      installId,
      appVersion: '0.0.1',
      helloSecret: secret,
      reconnectDelayMs: 10,
    });
    let fakeConnectionCount = 0;
    let fakeServer: ReturnType<typeof createServer> | undefined;

    try {
      await client.subscribeEvents(0, () => {});
      await runtime.stop();

      fakeServer = createServer((socket) => {
        fakeConnectionCount++;
        let pending = Buffer.alloc(0);
        socket.on('data', (chunk: Buffer) => {
          const decoded = decodeFrames(Buffer.concat([pending, chunk]));
          pending = decoded.remaining;
          for (const frame of decoded.frames) {
            if (frame.type !== '__hello') continue;
            socket.write(
              encodeFrame({
                id: frame.id,
                kind: 'response',
                type: '__hello',
                payload: { ok: true },
              }),
            );
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        fakeServer!.once('error', reject);
        fakeServer!.listen(pipePathPortable(installId), resolve);
      });

      expect(await waitFor(() => fakeConnectionCount === 1)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(fakeConnectionCount).toBe(1);
    } finally {
      client.disconnect();
      await runtime.stop();
      if (fakeServer) {
        await new Promise<void>((resolve) => fakeServer!.close(() => resolve()));
      }
    }
  });
});
