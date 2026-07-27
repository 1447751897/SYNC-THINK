import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type ConversationGetRunProcessResponse,
  type Frame,
} from '@sync-think/protocol';
import type { EventId, RunId, WorkspaceId } from '@sync-think/shared';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore } from '@sync-think/storage';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function frameReader(socket: Socket): (frame: Frame) => Promise<Frame> {
  let pending = Buffer.alloc(0);
  const waiters: Array<(frame: Frame) => void> = [];
  const queued: Frame[] = [];
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queued.push(frame);
    }
  });
  return (frame) => {
    const response = queued.length
      ? Promise.resolve(queued.shift()!)
      : new Promise<Frame>((resolve) => waiters.push(resolve));
    socket.write(encodeFrame(frame));
    return response;
  };
}

describe('conversation.getRunProcess persistent command', () => {
  it('returns one run-local projection and an empty view for an unknown run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-run-process-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const workspaceId = 'workspace-run-process' as WorkspaceId;
    const runId = 'run-target' as RunId;
    store.commitTransition({
      events: [
        {
          id: 'event-target' as EventId,
          workspaceId,
          runId,
          category: 'tool',
          type: 'tool.completed',
          occurredAt: '2026-07-27T00:00:00.000Z',
          payload: {
            threadId: 'thread-1',
            toolCallId: 'call-1',
            toolName: 'read_file',
            arguments: { path: 'src/target.ts' },
            result: JSON.stringify({ content: 'target' }),
          },
        },
        {
          id: 'event-other' as EventId,
          workspaceId,
          runId: 'run-other' as RunId,
          category: 'tool',
          type: 'tool.completed',
          occurredAt: '2026-07-27T00:00:01.000Z',
          payload: {
            threadId: 'thread-1',
            toolCallId: 'call-other',
            toolName: 'read_file',
            arguments: { path: 'src/wrong.ts' },
          },
        },
      ],
    });

    const installId = `run-process-${randomBytes(4).toString('hex')}`;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const request = frameReader(socket);
    try {
      const hello = await request({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: ['conversation.getRunProcess'],
        },
      });
      expect(hello.error).toBeUndefined();

      const response = await request({
        id: 'target',
        kind: 'request',
        type: 'conversation.getRunProcess',
        payload: { runId },
      });
      const process = (response.payload as ConversationGetRunProcessResponse).process;
      expect(process.runId).toBe(runId);
      expect(process.steps.map((step) => step.path)).toEqual(['src/target.ts']);

      const missing = await request({
        id: 'missing',
        kind: 'request',
        type: 'conversation.getRunProcess',
        payload: { runId: 'missing-run' },
      });
      expect((missing.payload as ConversationGetRunProcessResponse).process).toMatchObject({
        runId: 'missing-run',
        steps: [],
        fileChanges: [],
      });

      const invalid = await request({
        id: 'invalid',
        kind: 'request',
        type: 'conversation.getRunProcess',
        payload: { runId: '', extra: true },
      });
      expect(invalid.error).toMatchObject({ code: 'protocol.frame_malformed' });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
