import { mkdtempSync, rmSync, realpathSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodeFrames, MAX_FRAME_BYTES, type Frame } from '@sync-think/protocol';
import type {
  ConversationId,
  Message,
  ModelId,
  TaskId,
  ThreadId,
  WorkspaceId,
} from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { ConversationHistoryReadService } from './conversation-history-read-service.js';
import { Runtime } from './runtime.js';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-navigation-rpc-'));
  const databasePath = join(directory, 'test.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const now = '2026-09-05T00:00:00Z';
  const workspace = workspaceStore.createWorkspace({
    id: 'navigation-workspace' as WorkspaceId,
    name: 'Navigation',
    now,
  });
  const task = workspaceStore.createTask({
    id: 'navigation-task' as TaskId,
    threadId: 'navigation-thread' as ThreadId,
    workspaceId: workspace.id,
    title: 'Navigation',
    goal: 'Navigation',
    now,
  });
  const conversation = conversationStore.create({
    id: 'navigation-conversation' as ConversationId,
    target: { track: 'model', modelId: 'fixture-model' as ModelId },
    workspaceId: workspace.id,
    title: 'Navigation',
    now,
  });
  conversationStore.bindTask(conversation.id, task.taskId, now);
  const empty = conversationStore.create({
    id: 'empty-conversation' as ConversationId,
    target: { track: 'model', modelId: 'fixture-model' as ModelId },
    workspaceId: workspace.id,
    title: 'Empty',
    now,
  });
  const reader = new ConversationHistoryReadService({
    databasePath,
    store: stateStore,
    messageStore,
  });
  const runtime = new Runtime({
    installId: 'navigation-rpc-fixture',
    allowNoToken: true,
    stateStore,
    messageStore,
    conversationStore,
    workspaceStore,
    conversationHistory: reader,
  });
  const writes: Buffer[] = [];
  const received = new Map<string, Frame>();
  const waiting = new Map<string, (frame: Frame) => void>();
  let unread = Buffer.alloc(0);
  let requestId = 0;
  const dispatch = (type: string, payload: unknown) => {
    const id = `request-${++requestId}`;
    (
      runtime as unknown as {
        handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void };
      }
    ).handlers.onFrame(
      {
        write: (data) => {
          writes.push(data);
          const decoded = decodeFrames(Buffer.concat([unread, data]));
          unread = Buffer.from(decoded.remaining);
          for (const response of decoded.frames) {
            received.set(response.id, response);
            waiting.get(response.id)?.(response);
            waiting.delete(response.id);
          }
          return true;
        },
      },
      { id, kind: 'request', type, payload } as Frame,
    );
    return id;
  };
  const response = (id: string): Promise<Frame> => {
    const frame = received.get(id);
    return frame ? Promise.resolve(frame) : new Promise((resolve) => waiting.set(id, resolve));
  };
  const append = (sequence: number, text = `history ${sequence}`, blocks?: Message['blocks']) =>
    messageStore.append({
      id: `message-${sequence}` as Message['id'],
      threadId: task.threadId,
      role: sequence % 2 ? 'assistant' : 'user',
      blocks: blocks ?? [{ type: 'text', text }],
      sequence,
      createdAt: now,
    });
  const close = async () => {
    await runtime.stop();
    await reader.close();
    connection.raw.close();
    if (
      lstatSync(directory).isSymbolicLink() ||
      dirname(realpathSync(directory)) !== realpathSync(tmpdir()) ||
      !basename(directory).startsWith('sync-think-navigation-rpc-')
    )
      throw new Error('Unexpected test directory');
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    append,
    close,
    conversation,
    empty,
    conversationStore,
    workspaceStore,
    reader,
    task,
    workspace,
    writes,
    dispatch,
    response,
  };
}

describe('Runtime message navigation RPC', () => {
  it('dispatches readonly directory and anchor pages, preserves empty response types and enforces thread scope', async () => {
    const test = await fixture();
    try {
      for (let sequence = 0; sequence < 120; sequence += 1) test.append(sequence);
      const plan = vi.spyOn(test.reader, 'getTaskPlanState');
      const directory = await test.response(
        test.dispatch('conversation.listNavigation', {
          conversationId: test.conversation.id,
          limit: 3,
        }),
      );
      expect(directory).toMatchObject({
        kind: 'response',
        type: 'conversation.listNavigation',
        payload: {
          entries: [{ sequence: 117 }, { sequence: 118 }, { sequence: 119 }],
          hasMore: true,
          nextCursor: 117,
        },
      });
      const around = await test.response(
        test.dispatch('conversation.listMessages', {
          conversationId: test.conversation.id,
          aroundMessageId: 'message-20',
          limit: 3,
        }),
      );
      expect(around).toMatchObject({
        kind: 'response',
        payload: { messages: [{ sequence: 19 }, { sequence: 20 }, { sequence: 21 }] },
      });
      expect(plan).not.toHaveBeenCalled();
      expect(
        await test.response(
          test.dispatch('conversation.listNavigation', { conversationId: test.empty.id }),
        ),
      ).toMatchObject({
        type: 'conversation.listNavigation',
        payload: { entries: [], hasMore: false },
      });
      expect(
        await test.response(
          test.dispatch('conversation.listNavigation', {
            conversationId: test.conversation.id,
            limit: 501,
          }),
        ),
      ).toMatchObject({ error: { message: expect.stringContaining('Invalid payload') } });
      expect(
        await test.response(
          test.dispatch('conversation.listMessages', {
            conversationId: test.conversation.id,
            aroundMessageId: 'foreign-message',
          }),
        ),
      ).toMatchObject({
        error: { message: expect.stringContaining('anchor is not in this thread') },
      });
    } finally {
      await test.close();
    }
  });

  it.each(['conversation.listNavigation', 'conversation.listMessages'])(
    'rejects stale %s replies after deletion without blocking health dispatch',
    async (type) => {
      const test = await fixture();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const message = test.append(0);
        if (type === 'conversation.listNavigation')
          vi.spyOn(test.reader, 'listMessageNavigation').mockImplementation(async () => {
            await pending;
            return { entries: [], hasMore: false };
          });
        else
          vi.spyOn(test.reader, 'listMessages').mockImplementation(async () => {
            await pending;
            return { messages: [message], hasMore: false };
          });
        const request = test.dispatch(type, {
          conversationId: test.conversation.id,
          ...(type.endsWith('listMessages') ? { aroundMessageId: message.id } : {}),
        });
        expect(await test.response(test.dispatch('runtime.healthcheck', {}))).toMatchObject({
          kind: 'response',
        });
        expect(
          decodeFrames(Buffer.concat(test.writes)).frames.some((frame) => frame.id === request),
        ).toBe(false);
        test.conversationStore.delete(test.conversation.id);
        release();
        expect(await test.response(request)).toMatchObject({
          error: { message: 'Conversation changed while reading history' },
        });
      } finally {
        release();
        await test.close();
      }
    },
  );

  it('shrinks metadata-heavy anchor pages below the protocol frame limit without dropping the target', async () => {
    const test = await fixture();
    try {
      for (let sequence = 0; sequence < 8; sequence += 1)
        test.append(sequence, '', [
          { type: 'plan', payload: { description: 'x'.repeat(200_000) } },
        ]);
      const read = vi.spyOn(test.reader, 'listMessages');
      const result = await test.response(
        test.dispatch('conversation.listMessages', {
          conversationId: test.conversation.id,
          aroundMessageId: 'message-4',
          limit: 50,
        }),
      );
      expect(result.kind).toBe('response');
      expect(
        (result.payload as { messages: Message[] }).messages.some(
          (message) => message.id === 'message-4',
        ),
      ).toBe(true);
      expect(read.mock.calls.length).toBeGreaterThan(1);
      expect(test.writes.every((frame) => frame.byteLength <= MAX_FRAME_BYTES + 4)).toBe(true);
    } finally {
      await test.close();
    }
  });
});

it('keeps every large prose message in an anchor page with source references and no retry shrinking', async () => {
  const test = await fixture();
  try {
    for (let sequence = 0; sequence < 8; sequence += 1) test.append(sequence, 'x'.repeat(200_000));
    const read = vi.spyOn(test.reader, 'listMessages');
    const result = await test.response(
      test.dispatch('conversation.listMessages', {
        conversationId: test.conversation.id,
        aroundMessageId: 'message-4',
        limit: 50,
      }),
    );
    expect(result.kind).toBe('response');
    const messages = (result.payload as { messages: Message[] }).messages;
    expect(messages).toHaveLength(8);
    for (const message of messages)
      expect(message.blocks[0].contentRef).toMatchObject({
        reference: { source: 'message', id: message.id, path: ['blocks', 0, 'text'] },
        utf16Length: 200_000,
      });
    expect(read).toHaveBeenCalledTimes(1);
    expect(test.writes.every((frame) => frame.byteLength <= MAX_FRAME_BYTES + 4)).toBe(true);
  } finally {
    await test.close();
  }
});
