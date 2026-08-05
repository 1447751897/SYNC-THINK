import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { openDatabaseAsync, runMigrations, SqliteBrowserStore } from '@sync-think/storage';
import type { BrowserHostLike, BrowserRecordingMutation } from '@sync-think/workers';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolveConnect, reject) => {
    socket.once('connect', resolveConnect);
    socket.once('error', reject);
  });
  return socket;
}

function createFrameInbox(socket: Socket) {
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (!waiter) continue;
      waiters.delete(frame.id);
      waiter(frame);
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolveResponse) =>
        waiters.set(frame.id, resolveResponse),
      );
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

describe('Runtime Browser recording commands', () => {
  it('routes durable start, snapshot, mutation, and stop without exposing lease identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-recording-runtime-'));
    tempDirs.push(root);
    const databasePath = join(root, 'sync-think.db');
    await runMigrations(databasePath);
    const connection = await openDatabaseAsync({ path: databasePath });
    const browserStore = new SqliteBrowserStore(connection.raw);
    let emitMutation: ((mutation: BrowserRecordingMutation) => void | Promise<void>) | undefined;
    const host: BrowserHostLike = {
      acquireLease: vi.fn(async ({ profileId, ownerId }) => ({
        leaseId: 'lease-runtime-recording',
        pageId: 'page-runtime-recording',
        profileId,
        ownerId,
      })),
      inspectLease: vi.fn(async () => {
        throw new Error('not used');
      }),
      execute: vi.fn(async () => {
        throw new Error('not used');
      }),
      startRecording: vi.fn(async (input) => {
        emitMutation = input.onMutation;
      }),
      stopRecording: vi.fn(async () => undefined),
      releaseLease: vi.fn(async () => undefined),
      closeProfileSession: vi.fn(async () => undefined),
      hasActiveProfileLeases: vi.fn(() => false),
      shutdown: vi.fn(async () => undefined),
    };
    const installId = `browser-recording-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true, browserStore, browserHost: host });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    let sequence = 0;
    const request = (type: Frame['type'], payload: unknown) =>
      inbox.send({
        id: `browser-recording-request-${++sequence}`,
        kind: 'request',
        type,
        payload,
      });
    try {
      await request('__hello', {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: 'browser-recording-runtime',
        features: ['browser.recording'],
      });

      const started = await request('browser.recording.start', {
        profileId: 'default',
        expectedProfileRevision: 1,
        startUrl: 'https://example.test/start?token=secret',
      });
      expect(started.error).toBeUndefined();
      const recording = (started.payload as { recording: { id: string } }).recording;
      expect(JSON.stringify(started.payload)).not.toContain('lease-runtime-recording');
      expect(started.payload).toMatchObject({
        recording: {
          profileId: 'default',
          status: 'recording',
          startUrl: 'https://example.test/start',
        },
      });

      await emitMutation?.({
        type: 'append',
        step: {
          kind: 'fill',
          locator: { strategy: 'id', value: 'password' },
          value: { kind: 'secret' },
        },
      });
      const snapshot = await request('browser.recording.get', {
        recordingId: recording.id,
        afterSequence: 0,
        limit: 200,
      });
      expect(snapshot.error).toBeUndefined();
      expect(snapshot.payload).toMatchObject({
        recording: { stepCount: 1 },
        steps: [{ sequence: 1, step: { kind: 'fill', value: { kind: 'secret' } } }],
      });
      expect(JSON.stringify(snapshot.payload)).not.toContain('password-value');

      const stopped = await request('browser.recording.stop', { recordingId: recording.id });
      expect(stopped.payload).toMatchObject({
        recording: { status: 'stopped', stopReason: 'user', stepCount: 1 },
      });
      expect(host.releaseLease).toHaveBeenCalledWith('lease-runtime-recording', {
        closePage: true,
      });

      const listed = await request('browser.recording.list', { profileId: 'default' });
      expect(listed.payload).toMatchObject({
        recordings: [{ id: recording.id, status: 'stopped' }],
      });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
