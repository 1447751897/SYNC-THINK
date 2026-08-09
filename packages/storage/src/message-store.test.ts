import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message, MessageId, ThreadId } from '@sync-think/shared';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import {
  MAX_MESSAGE_BLOCKS_JSON_BYTES,
  MessageStoreError,
  SqliteMessageStore,
} from './message-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];
const threadA = 'thread-message-a' as ThreadId;
const threadB = 'thread-message-b' as ThreadId;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-message-store-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(threadA, 'task-message-a', '2026-07-27T00:00:00.000Z');
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(threadB, 'task-message-b', '2026-07-27T00:00:00.000Z');
  return {
    raw: connection.raw,
    store: new SqliteMessageStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

function message(sequence: number, threadId: ThreadId = threadA): Message {
  return {
    id: `message-${threadId}-${sequence}` as MessageId,
    threadId,
    role: sequence % 2 === 0 ? 'assistant' : 'user',
    blocks: [{ type: 'text', text: `message ${sequence}` }],
    sequence,
    createdAt: `2026-07-27T00:00:${String(sequence).padStart(2, '0')}.000Z`,
  };
}

function explainMessagePage(raw: BetterSQLite3Raw, threadId: ThreadId, beforeSequence: number) {
  return raw
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM message
       WHERE thread_id = ? AND sequence < ?
       ORDER BY sequence DESC
       LIMIT ?`,
    )
    .all(threadId, beforeSequence, 51) as Array<{ detail: string }>;
}

describe('SqliteMessageStore', () => {
  it('paginates one thread newest-first in SQL and returns ascending exclusive pages', async () => {
    const { raw, store, close } = await openStore();
    try {
      for (let sequence = 1; sequence <= 105; sequence += 1) {
        store.appendMessage(message(sequence));
      }
      store.appendMessage(message(105, threadB));

      const latest = store.listMessages(threadA);
      expect(latest.messages.map((item) => item.sequence)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 56),
      );
      expect(latest).toMatchObject({ hasMore: true, nextCursor: 56 });

      const middle = store.listMessages(threadA, { beforeSequence: latest.nextCursor, limit: 50 });
      expect(middle.messages.map((item) => item.sequence)).toEqual(
        Array.from({ length: 50 }, (_, index) => index + 6),
      );
      expect(middle).toMatchObject({ hasMore: true, nextCursor: 6 });

      const oldest = store.listMessages(threadA, { beforeSequence: middle.nextCursor, limit: 50 });
      expect(oldest.messages.map((item) => item.sequence)).toEqual([1, 2, 3, 4, 5]);
      expect(oldest).toEqual({ messages: oldest.messages, hasMore: false });
      expect(store.listMessages(threadB).messages.map((item) => item.sequence)).toEqual([105]);

      const plan = explainMessagePage(raw, threadA, 56);
      expect(plan.some((row) => row.detail.includes('message_thread_sequence_uidx'))).toBe(true);
    } finally {
      close();
    }
  });

  it('round-trips image storageRef blocks and retrieves a message by branded id', async () => {
    const { store, close } = await openStore();
    try {
      const input: Message = {
        ...message(1),
        blocks: [
          { type: 'text', text: 'see image' },
          {
            type: 'image',
            payload: {
              id: 'image-1',
              name: 'screen.png',
              mimeType: 'image/png',
              storageRef: 'conversation-images/screen.png',
            },
          },
        ],
      };
      expect(store.createFinalMessage(input)).toEqual(input);
      expect(store.getMessage(input.id)).toEqual(input);
      expect(store.getMessage('missing-message' as MessageId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it('round-trips reasoning blocks and rejects non-string reasoningText', async () => {
    const { store, close } = await openStore();
    try {
      const input: Message = {
        ...message(1),
        blocks: [{ type: 'reasoning', reasoningText: 'inspect the durable handoff' }],
      };
      expect(store.createFinalMessage(input)).toEqual(input);
      expect(store.getMessage(input.id)).toEqual(input);

      expect(() =>
        store.append({
          ...message(2),
          blocks: [
            {
              type: 'reasoning',
              reasoningText: 42 as unknown as string,
            },
          ],
        }),
      ).toThrow(/reasoningText must be a string/);
    } finally {
      close();
    }
  });

  it('round-trips commentary blocks with ordered timeline segments', async () => {
    const { store, close } = await openStore();
    try {
      const input: Message = {
        ...message(1),
        blocks: [
          {
            type: 'commentary',
            text: '先检查项目结构，再运行相关测试。',
            payload: {
              commentarySegments: [
                {
                  id: 'commentary-1',
                  text: '先检查项目结构。',
                  startedAt: '2026-08-08T01:02:03.000Z',
                  completedAt: '2026-08-08T01:02:04.000Z',
                  afterSequence: 12,
                },
                {
                  id: 'commentary-2',
                  text: '再运行相关测试。',
                  startedAt: '2026-08-08T01:02:05.000Z',
                  afterSequence: 15,
                },
              ],
            },
          },
          { type: 'text', text: '检查完成。' },
        ],
      };

      expect(store.createFinalMessage(input)).toEqual(input);
      expect(store.getMessage(input.id)).toEqual(input);
    } finally {
      close();
    }
  });

  it('makes identical message-id retries idempotent and rejects changed content or sequence reuse', async () => {
    const { raw, store, close } = await openStore();
    try {
      const input = message(1);
      expect(store.append(input)).toEqual(input);
      expect(store.append({ ...input, blocks: [{ type: 'text', text: 'message 1' }] })).toEqual(input);
      expect(raw.prepare('SELECT COUNT(*) AS count FROM message').get()).toEqual({ count: 1 });

      expect(() =>
        store.append({ ...input, blocks: [{ type: 'text', text: 'changed' }] }),
      ).toThrowError(MessageStoreError);
      expect(() => store.append({ ...message(1), id: 'different-id' as MessageId })).toThrow(
        /message\.conflict/,
      );
    } finally {
      close();
    }
  });

  it('allocates nextSequence and updates image blocks after the final text message exists', async () => {
    const { store, close } = await openStore();
    try {
      expect(store.nextSequence(threadA)).toBe(0);
      const first = store.append(message(0));
      expect(store.nextSequence(threadA)).toBe(1);
      store.append(message(1));
      expect(store.nextSequence(threadA)).toBe(2);

      const withImage = store.updateBlocks(first.id, [
        { type: 'text', text: 'message 0' },
        {
          type: 'image',
          payload: {
            id: 'img-1',
            name: 'a.png',
            mimeType: 'image/png',
            storageRef: 'a.png',
          },
        },
      ]);
      expect(withImage.blocks).toEqual([
        { type: 'text', text: 'message 0' },
        {
          type: 'image',
          payload: {
            id: 'img-1',
            name: 'a.png',
            mimeType: 'image/png',
            storageRef: 'a.png',
          },
        },
      ]);
      expect(store.getMessage(first.id)).toEqual(withImage);
      // Same blocks → idempotent.
      expect(
        store.updateBlocks(first.id, withImage.blocks),
      ).toEqual(withImage);
      expect(() => store.updateBlocks('missing' as MessageId, [{ type: 'text', text: 'x' }])).toThrow(
        /does not exist/,
      );
    } finally {
      close();
    }
  });

  it('rejects base64 images, oversized blocks, invalid roles and pagination limits', async () => {
    const { store, close } = await openStore();
    try {
      expect(() =>
        store.append({
          ...message(1),
          blocks: [{ type: 'image', payload: { source: 'data:image/png;base64,AAAA' } }],
        }),
      ).toThrow(/storageRef instead of data:image\//);
      expect(() =>
        store.append({
          ...message(2),
          blocks: [{ type: 'text', text: 'x'.repeat(MAX_MESSAGE_BLOCKS_JSON_BYTES) }],
        }),
      ).toThrow(/blocks_json exceeds/);
      expect(() => store.append({ ...message(3), role: 'invalid' as Message['role'] })).toThrow(
        /unsupported role/,
      );
      expect(() => store.listMessages(threadA, { limit: 0 })).toThrow(/between 1 and 100/);
      expect(() => store.listMessages(threadA, { limit: 101 })).toThrow(/between 1 and 100/);
      expect(() => store.listMessages(threadA, { beforeSequence: -1 })).toThrow(
        /beforeSequence/,
      );
    } finally {
      close();
    }
  });

  it('rejects a message for a thread that does not exist', async () => {
    const { store, close } = await openStore();
    try {
      expect(() => store.append(message(1, 'missing-thread' as ThreadId))).toThrow(
        /message\.thread_not_found/,
      );
    } finally {
      close();
    }
  });
});
