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
import type { Message } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { FakeProvider } from '@sync-think/adapters';
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

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('waitFor timed out');
}

describe('durable final message writes', () => {
  it('persists user + assistant finals so conversation.listMessages can page them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-final-msg-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);

    const seed = await openDatabaseAsync({ path: dbPath });
    const workspaces = new SqliteWorkspaceStore(seed.raw);
    const conversations = new SqliteConversationStore(seed.raw);
    const workspace = workspaces.createWorkspace({ name: 'Final message test' });
    const task = workspaces.createTask({
      workspaceId: workspace.id,
      title: 'Chat',
      goal: 'Chat',
    });
    const conversation = conversations.create({
      id: 'conv-final' as never,
      target: { track: 'model', modelId: 'model-final' as never },
    });
    conversations.bindTask(conversation.id, task.taskId);
    seed.raw.close();

    const installId = `final-msg-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'key.bin'),
      allowNoToken: true,
      demoProvider: new FakeProvider({ chunksPerWord: 1, tickMs: 1 }),
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
          features: ['task.appendMessage', 'conversation.listMessages', 'message.attachImages'],
        },
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const append = await request({
        id: 'append',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'hello durable store',
        },
      });
      expect(append.error).toBeUndefined();
      const messageId = (append.payload as { messageId: string }).messageId;
      expect(messageId).toBeTruthy();
      expect((append.payload as { streamId?: string }).streamId).toBeTruthy();

      // Attach a durable image ref after the text message is written.
      const attach = await request({
        id: 'attach',
        kind: 'request',
        type: 'message.attachImages',
        payload: {
          threadId: task.threadId,
          messageId,
          images: [
            {
              id: 'img-1',
              name: 'shot.png',
              mimeType: 'image/png',
              storageRef: 'shot.png',
            },
          ],
        },
      });
      expect(attach.error).toBeUndefined();

      await waitFor(async () => {
        const page = await request({
          id: `poll-${Date.now()}`,
          kind: 'request',
          type: 'conversation.listMessages',
          payload: { conversationId: conversation.id },
        });
        const messages = (page.payload as ConversationListMessagesResponse).messages;
        return messages.some((message: Message) => message.role === 'assistant');
      });

      const listed = await request({
        id: 'list',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversation.id },
      });
      expect(listed.error).toBeUndefined();
      const page = listed.payload as ConversationListMessagesResponse;
      expect(page.messages.length).toBeGreaterThanOrEqual(2);
      const user = page.messages.find((message: Message) => message.id === messageId);
      expect(user).toMatchObject({
        role: 'user',
        threadId: task.threadId,
        sequence: 0,
      });
      expect(user?.blocks).toEqual(
        expect.arrayContaining([
          { type: 'text', text: 'hello durable store' },
          {
            type: 'image',
            payload: {
              id: 'img-1',
              name: 'shot.png',
              mimeType: 'image/png',
              storageRef: 'shot.png',
            },
          },
        ]),
      );
      const assistant = page.messages.find((message: Message) => message.role === 'assistant');
      expect(assistant?.blocks.some((block) => block.type === 'text' && block.text)).toBe(true);
      expect(assistant?.sequence).toBeGreaterThan(user!.sequence);

      // Direct store check for runId linkage.
      const db = await openDatabaseAsync({ path: dbPath });
      try {
        const store = new SqliteMessageStore(db.raw);
        const storedAssistant = store.getMessage(assistant!.id);
        expect(storedAssistant?.runId).toBeTruthy();
      } finally {
        db.raw.close();
      }
    } finally {
      socket.destroy();
      await session.close();
    }
  }, 30_000);
});
