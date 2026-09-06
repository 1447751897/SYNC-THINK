import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteEventCheckpointStore } from './runtime-state-store.js';
import type { Message, MessageId, ThreadId } from '@sync-think/shared';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import {
  MAX_MESSAGE_BLOCKS_JSON_BYTES,
  MessageStoreError,
  SqliteMessageStore,
  validateMessageBlocks,
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
  it('locates only a unique original user request in the exact thread and run', async () => {
    const { store, raw, close } = await openStore();
    try {
      const runId = 'approval-source-run' as never;
      store.append({ ...message(1), runId });
      store.append({ ...message(2), runId });
      store.append({ ...message(3), runId: 'later-run' as never });
      expect(store.findRunUserMessageId(threadA, runId)).toBe(message(1).id);
      expect(store.findRunUserMessageId(threadB, runId)).toBeUndefined();
      expect(store.findRunUserMessageId(threadA, 'missing-run' as never)).toBeUndefined();
      const plan = raw
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id FROM message WHERE run_id = ? AND thread_id = ? AND role = 'user' LIMIT 2",
        )
        .all(runId, threadA) as Array<{ detail: string }>;
      expect(plan.map((row) => row.detail).join(' ')).toContain('message_run_idx');
      store.append({ ...message(5), runId });
      expect(store.findRunUserMessageId(threadA, runId)).toBeUndefined();
    } finally {
      close();
    }
  });

  it('reads a bounded navigation directory without returning message bodies', async () => {
    const { store, close } = await openStore();
    try {
      for (let sequence = 1; sequence <= 6; sequence += 1) store.append(message(sequence));
      store.append(message(7, threadB));
      store.updateBlocks(message(4).id, [
        { type: 'reasoning', reasoningText: 'private reasoning' },
        { type: 'text', text: '历史摘要'.repeat(12_000) },
        { type: 'tool-result', payload: { secret: 'not part of navigation' } },
      ]);
      const latest = store.listNavigation(threadA, { limit: 3 });
      expect(latest.entries.map((entry) => entry.sequence)).toEqual([4, 5, 6]);
      expect(latest).toMatchObject({ hasMore: true, nextCursor: 4 });
      expect([...latest.entries[0].text]).toHaveLength(240);
      expect(JSON.stringify(latest)).not.toMatch(
        /private reasoning|not part of navigation|blocks|payload/,
      );
      expect(Buffer.byteLength(JSON.stringify(latest))).toBeLessThan(3_000);
      const oldest = store.listNavigation(threadA, { beforeSequence: latest.nextCursor, limit: 3 });
      expect(oldest.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
      expect(oldest.hasMore).toBe(false);
      store.updateBlocks(message(4).id, [{ type: 'text', text: 'updated preview' }]);
      expect(
        store.listNavigation(threadA).entries.find((entry) => entry.id === message(4).id)?.text,
      ).toBe('updated preview');
    } finally {
      close();
    }
  });

  it('loads an anchor-centered page without walking intermediate history', async () => {
    const { store, close } = await openStore();
    try {
      for (let sequence = 1; sequence <= 200; sequence += 1) store.append(message(sequence));
      store.append(message(1, threadB));
      const middle = store.listMessages(threadA, { aroundMessageId: message(30).id, limit: 5 });
      expect(middle.messages.map((entry) => entry.sequence)).toEqual([28, 29, 30, 31, 32]);
      expect(middle).toMatchObject({ hasMore: true, nextCursor: 28 });
      expect(
        store
          .listMessages(threadA, { aroundMessageId: message(1).id, limit: 5 })
          .messages.map((entry) => entry.sequence),
      ).toEqual([1, 2, 3, 4, 5]);
      expect(
        store
          .listMessages(threadA, { aroundMessageId: message(200).id, limit: 5 })
          .messages.map((entry) => entry.sequence),
      ).toEqual([196, 197, 198, 199, 200]);
      expect(
        store
          .listMessages(threadA, { aroundMessageId: message(30).id, limit: 1 })
          .messages.map((entry) => entry.sequence),
      ).toEqual([30]);
      expect(() =>
        store.listMessages(threadA, { aroundMessageId: message(1, threadB).id }),
      ).toThrow('message.not_found');
      expect(() =>
        store.listMessages(threadA, { aroundMessageId: message(30).id, beforeSequence: 10 }),
      ).toThrow('message.invalid_input');
    } finally {
      close();
    }
  });

  it('keeps bounded legacy terminal metadata so unloaded turns retain their visual chronology', async () => {
    const { store, close } = await openStore();
    try {
      store.append({
        ...message(2),
        blocks: [
          {
            type: 'error',
            text: 'stopped',
            payload: {
              terminalState: 'cancelled',
              legacyBackfill: true,
              privateDetails: 'not a preview',
            },
          },
        ],
      });
      expect(store.listNavigation(threadA).entries[0]).toMatchObject({
        terminalState: 'cancelled',
        legacyTerminalBackfill: true,
        text: 'stopped',
      });
      expect(JSON.stringify(store.listNavigation(threadA))).not.toContain('privateDetails');
    } finally {
      close();
    }
  });

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
      expect(store.append({ ...input, blocks: [{ type: 'text', text: 'message 1' }] })).toEqual(
        input,
      );
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
      expect(store.updateBlocks(first.id, withImage.blocks)).toEqual(withImage);
      expect(() =>
        store.updateBlocks('missing' as MessageId, [{ type: 'text', text: 'x' }]),
      ).toThrow(/does not exist/);
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
      expect(() => store.listMessages(threadA, { beforeSequence: -1 })).toThrow(/beforeSequence/);
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

describe('message block preflight', () => {
  it('includes skill metadata and JSON escaping in the existing byte budget', () => {
    const blocks: Message['blocks'] = [
      {
        type: 'text',
        text: '汉'.repeat(80_000),
        payload: {
          skillVersionIds: ['skill-version'],
          skills: [{ skillVersionId: 'skill-version', name: '\u0000'.repeat(4000) }],
        },
      },
    ];
    expect(Buffer.byteLength(JSON.stringify(blocks))).toBeGreaterThan(
      MAX_MESSAGE_BLOCKS_JSON_BYTES,
    );
    expect(() => validateMessageBlocks(blocks)).toThrow('blocks_json exceeds');
  });

  it('does not mutate valid user text or compatibility payloads', () => {
    const blocks: Message['blocks'] = [
      { type: 'text', text: '原样保存🙂\n', payload: { skillVersionIds: ['skill'] } },
    ];
    const original = JSON.stringify(blocks);
    expect(validateMessageBlocks(blocks)).toBeUndefined();
    expect(JSON.stringify(blocks)).toBe(original);
  });
});

function legacyRequestEvents(
  input: {
    threadId?: string;
    contextRunId?: string;
    packetId?: string;
    text?: string;
    messageId?: string;
    interleaved?: boolean;
    suffix?: string;
  } = {},
) {
  const runId = 'legacy-approval-run';
  const suffix = input.suffix ?? '';
  const draft = (
    id: string,
    type: string,
    payload: Record<string, unknown>,
    eventRunId?: string,
  ) => ({
    id: id + suffix,
    workspaceId: 'legacy-workspace',
    category: 'message',
    type,
    ...(eventRunId ? { runId: eventRunId } : {}),
    occurredAt: '2026-09-06T07:00:00Z',
    payload,
  });
  return [
    draft('legacy-append', 'message.appended', {
      threadId: threadA,
      role: 'user',
      messageId: input.messageId ?? message(1).id,
      text: input.text ?? 'message 1',
    }),
    draft(
      'legacy-context',
      'context.packet.built',
      { threadId: input.threadId ?? threadA, packetId: input.packetId ?? 'legacy-packet' },
      input.contextRunId ?? runId,
    ),
    ...(input.interleaved ? [draft('interleaved', 'noise', {})] : []),
    draft(
      'legacy-start',
      'run.started',
      {
        threadId: threadA,
        packetId: 'legacy-packet',
        run: { threadId: threadA, userText: 'message 1' },
      },
      runId,
    ),
  ];
}

describe('legacy approval request correlation', () => {
  it('resolves the canonical atomic append/context/start boundary without changing old rows', async () => {
    const { store, raw, close } = await openStore();
    const prepare = vi.spyOn(raw, 'prepare');
    try {
      store.append(message(1));
      new SqliteEventCheckpointStore(raw).commitTransition({
        events: legacyRequestEvents() as never,
      });
      expect(store.findRunUserMessageId(threadA, 'legacy-approval-run' as never)).toBe(
        message(1).id,
      );
      expect(store.getMessage(message(1).id)?.runId).toBeUndefined();
      const query = prepare.mock.calls
        .map(([sql]) => String(sql))
        .find((sql) => sql.includes('context.packet.built'));
      expect(query).toBeTruthy();
      const plan = raw
        .prepare('EXPLAIN QUERY PLAN ' + query)
        .all({ runId: 'legacy-approval-run', threadId: threadA }) as Array<{ detail: string }>;
      expect(plan.some((row) => row.detail.includes('event_ws_seq_idx'))).toBe(true);
      expect(plan.some((row) => row.detail.startsWith('SCAN '))).toBe(false);
    } finally {
      prepare.mockRestore();
      close();
    }
  });

  it.each([
    { name: 'another thread in the context', input: { threadId: threadB } },
    { name: 'another context run', input: { contextRunId: 'other-run' } },
    { name: 'another context packet', input: { packetId: 'other-packet' } },
    { name: 'different original input', input: { text: 'other input' } },
    { name: 'missing source message', input: { messageId: 'missing-message' } },
    { name: 'a non-atomic event boundary', input: { interleaved: true } },
  ])('rejects $name instead of guessing the previous user message', async ({ input }) => {
    const { store, raw, close } = await openStore();
    try {
      store.append(message(1));
      new SqliteEventCheckpointStore(raw).commitTransition({
        events: legacyRequestEvents(input) as never,
      });
      expect(store.findRunUserMessageId(threadA, 'legacy-approval-run' as never)).toBeUndefined();
    } finally {
      close();
    }
  });

  it('rejects contradictory row ownership and ambiguous start boundaries', async () => {
    const { store, raw, close } = await openStore();
    try {
      store.append({ ...message(1), runId: 'other-run' as never });
      const events = new SqliteEventCheckpointStore(raw);
      events.commitTransition({ events: legacyRequestEvents() as never });
      expect(store.findRunUserMessageId(threadA, 'legacy-approval-run' as never)).toBeUndefined();
      raw.prepare('UPDATE message SET run_id = NULL WHERE id = ?').run(message(1).id);
      events.commitTransition({ events: legacyRequestEvents({ suffix: '-duplicate' }) as never });
      expect(store.findRunUserMessageId(threadA, 'legacy-approval-run' as never)).toBeUndefined();
    } finally {
      close();
    }
  });
});
