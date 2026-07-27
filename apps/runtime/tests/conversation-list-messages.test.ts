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
import type { Message, MessageId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';

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

describe('conversation.listMessages persistent command', () => {
  it('returns latest 50, exclusive older pages, and conversation-isolated messages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-list-messages-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const seed = await openDatabaseAsync({ path: dbPath });
    const workspaces = new SqliteWorkspaceStore(seed.raw);
    const conversations = new SqliteConversationStore(seed.raw);
    const messages = new SqliteMessageStore(seed.raw);
    const workspace = workspaces.createWorkspace({ name: 'Message query test' });
    const taskA = workspaces.createTask({ workspaceId: workspace.id, title: 'A', goal: 'A' });
    const conversationA = conversations.create({
      id: 'conv-a' as never,
      target: { track: 'model', modelId: 'model-a' as never },
    });
    conversations.bindTask(conversationA.id, taskA.taskId);
    for (let sequence = 0; sequence < 105; sequence += 1) {
      messages.append({
        id: `message-a-${sequence}` as MessageId,
        threadId: taskA.threadId,
        role: sequence % 2 === 0 ? 'user' : 'assistant',
        sequence,
        blocks: [{ type: 'text', text: `A ${sequence}` }],
        createdAt: new Date(sequence * 1000).toISOString(),
      });
    }
    const taskB = workspaces.createTask({ workspaceId: workspace.id, title: 'B', goal: 'B' });
    const conversationB = conversations.create({
      id: 'conv-b' as never,
      target: { track: 'model', modelId: 'model-b' as never },
    });
    conversations.bindTask(conversationB.id, taskB.taskId);
    messages.append({
      id: 'message-b-0' as MessageId,
      threadId: taskB.threadId,
      role: 'user',
      sequence: 0,
      blocks: [{ type: 'text', text: 'B only' }],
      createdAt: new Date(0).toISOString(),
    });
    seed.raw.close();

    const installId = `list-msg-${randomBytes(4).toString('hex')}`;
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

      const latest = await request({
        id: 'latest',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversationA.id },
      });
      expect(latest.error).toBeUndefined();
      const latestPage = latest.payload as ConversationListMessagesResponse;
      expect(latestPage.messages).toHaveLength(50);
      expect(latestPage.messages.map((message: Message) => message.sequence)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 55),
      );
      expect(latestPage).toMatchObject({ hasMore: true, nextCursor: 55 });

      const older = await request({
        id: 'older',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversationA.id, beforeSequence: 55, limit: 10 },
      });
      expect(
        (older.payload as ConversationListMessagesResponse).messages.map(
          (message: Message) => message.sequence,
        ),
      ).toEqual([45, 46, 47, 48, 49, 50, 51, 52, 53, 54]);

      const isolated = await request({
        id: 'isolated',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversationB.id },
      });
      expect(
        (isolated.payload as ConversationListMessagesResponse).messages.map(
          (message: Message) => message.id,
        ),
      ).toEqual(['message-b-0']);

      const invalid = await request({
        id: 'invalid',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversationA.id, limit: 101 },
      });
      expect(invalid.error).toMatchObject({ code: 'protocol.frame_malformed' });
    } finally {
      socket.destroy();
      await session.close();
    }
  }, 30_000);
});
