import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type ConversationListMessagesResponse,
  type Frame,
} from '@sync-think/protocol';
import type { Event, Message, MessageId, RunId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';
import { MESSAGE_STORE_BACKFILL_SETTING_KEY } from '../src/message-store-backfill.js';

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
  const queued: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];
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

describe('runtime message-store backfill on restore', () => {
  it('backfills historical events into message store so listMessages works after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-backfill-rt-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);

    const seed = await openDatabaseAsync({ path: dbPath });
    const workspaces = new SqliteWorkspaceStore(seed.raw);
    const conversations = new SqliteConversationStore(seed.raw);
    const events = new SqliteEventCheckpointStore(seed.raw);
    const workspace = workspaces.createWorkspace({ name: 'Backfill runtime' });
    const task = workspaces.createTask({
      workspaceId: workspace.id,
      title: 'Legacy chat',
      goal: 'Legacy chat',
    });
    const conversation = conversations.create({
      id: 'conv-backfill' as never,
      target: { track: 'model', modelId: 'model-legacy' as never },
    });
    conversations.bindTask(conversation.id, task.taskId);

    // Seed only events — no rows in message table — simulating pre-S1 history.
    events.commitTransition({
      events: [
        {
          id: 'evt-user' as Event['id'],
          workspaceId: workspace.id,
          taskId: task.taskId,
          messageId: 'legacy-user-1' as MessageId,
          category: 'message',
          type: 'message.appended',
          occurredAt: '2026-07-01T00:00:00.000Z',
          payload: {
            threadId: task.threadId,
            role: 'user',
            text: 'legacy question',
            messageId: 'legacy-user-1',
            taskVersion: 1,
          },
        },
        {
          id: 'evt-asst' as Event['id'],
          workspaceId: workspace.id,
          taskId: task.taskId,
          runId: 'legacy-run-1' as RunId,
          category: 'run',
          type: 'run.completed',
          occurredAt: '2026-07-01T00:00:01.000Z',
          payload: {
            threadId: task.threadId,
            assistantText: 'legacy answer',
            modelId: 'model-legacy',
            idempotencyKey: 'legacy-run-1',
          },
        },
        {
          id: 'evt-img' as Event['id'],
          workspaceId: workspace.id,
          taskId: task.taskId,
          messageId: 'legacy-user-1' as MessageId,
          category: 'message',
          type: 'message.images-attached',
          occurredAt: '2026-07-01T00:00:02.000Z',
          payload: {
            threadId: task.threadId,
            messageId: 'legacy-user-1',
            images: [
              {
                id: 'img-legacy',
                name: 'old.png',
                mimeType: 'image/png',
                storageRef: 'old.png',
              },
            ],
          },
        },
      ],
    });
    seed.raw.close();

    const installId = `backfill-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'key.bin'),
      allowNoToken: true,
    });
    await session.runtime.start();
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
          features: ['conversation.listMessages'],
        },
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const listed = await request({
        id: 'list',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversation.id },
      });
      expect(listed.error).toBeUndefined();
      const page = listed.payload as ConversationListMessagesResponse;
      expect(page.messages.map((message: Message) => message.role)).toEqual([
        'user',
        'assistant',
      ]);
      expect(page.messages[0]).toMatchObject({
        id: 'legacy-user-1',
        sequence: 0,
      });
      expect(page.messages[0]?.blocks).toEqual(
        expect.arrayContaining([
          { type: 'text', text: 'legacy question' },
          {
            type: 'image',
            payload: {
              id: 'img-legacy',
              name: 'old.png',
              mimeType: 'image/png',
              storageRef: 'old.png',
            },
          },
        ]),
      );
      expect(page.messages[1]).toMatchObject({
        id: 'asst-legacy-run-1',
        role: 'assistant',
        sequence: 1,
      });
      expect(page.messages[1]?.blocks).toEqual([{ type: 'text', text: 'legacy answer' }]);

      // Progress persisted for resume.
      const db = await openDatabaseAsync({ path: dbPath });
      try {
        const row = db.raw
          .prepare('SELECT value_json FROM app_setting WHERE key = ?')
          .get(MESSAGE_STORE_BACKFILL_SETTING_KEY) as { value_json: string } | undefined;
        expect(row).toBeTruthy();
        const progress = JSON.parse(row!.value_json) as { lastEventSequence: number };
        expect(progress.lastEventSequence).toBeGreaterThanOrEqual(2);
      } finally {
        db.raw.close();
      }
    } finally {
      socket.destroy();
      await session.close();
    }

    // Second start should remain idempotent (no duplicate messages).
    const session2 = await openPersistentRuntime({
      installId: `${installId}-2`,
      dbPath,
      secureStoreKeyPath: join(dir, 'key2.bin'),
      allowNoToken: true,
    });
    await session2.runtime.start();
    const socket2 = await connectRuntime(`${installId}-2`);
    const request2 = frameReader(socket2);
    try {
      await request2({
        id: 'hello2',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId: `${installId}-2`,
          nonce: randomBytes(8).toString('hex'),
          features: ['conversation.listMessages'],
        },
      });
      const listed2 = await request2({
        id: 'list2',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversation.id },
      });
      expect(
        (listed2.payload as ConversationListMessagesResponse).messages.map(
          (message: Message) => message.id,
        ),
      ).toEqual(['legacy-user-1', 'asst-legacy-run-1']);
    } finally {
      socket2.destroy();
      await session2.close();
    }
  }, 30_000);
});
