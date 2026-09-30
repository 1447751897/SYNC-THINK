import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelId, TaskId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { SqliteConversationStore } from './conversation-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-conversation-'));
  tempDirs.push(dir);
  const path = join(dir, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  return {
    raw: connection.raw,
    store: new SqliteConversationStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteConversationStore context window override', () => {
  it('persists a conversation override and clears it back to the model default', async () => {
    const { store, close } = await openStore();
    try {
      const conversation = store.create({
        target: { track: 'model', modelId: 'model-gpt' as ModelId },
        now: '2026-08-23T00:00:00.000Z',
      });

      expect(conversation.contextWindowOverride).toBeUndefined();

      const updated = store.setContextWindowOverride(
        conversation.id,
        256_000,
        '2026-08-23T00:01:00.000Z',
      );
      expect(updated.contextWindowOverride).toBe(256_000);
      expect(store.get(conversation.id)?.contextWindowOverride).toBe(256_000);

      const cleared = store.setContextWindowOverride(
        conversation.id,
        null,
        '2026-08-23T00:02:00.000Z',
      );
      expect(cleared.contextWindowOverride).toBeUndefined();
      expect(store.get(conversation.id)?.contextWindowOverride).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe('SqliteConversationStore catalog pagination', () => {
  it('pages the complete pinned-first order without duplicates', async () => {
    const { store, close } = await openStore();
    try {
      const created = Array.from({ length: 6 }, (_, index) =>
        store.create({
          target: { track: 'model', modelId: 'model-gpt' as ModelId },
          title: `conversation-${index}`,
          now: `2026-08-23T00:0${index}:00.000Z`,
        }),
      );
      store.setPinned(created[1]!.id, true, '2026-08-23T01:00:00.000Z');
      store.setPinned(created[3]!.id, true, '2026-08-23T02:00:00.000Z');

      const expected = store.list({ track: 'model' }).map((item) => item.id);
      const actual: string[] = [];
      let cursor: string | undefined;
      do {
        const page = store.listPage({ track: 'model', limit: 2, cursor });
        actual.push(...page.conversations.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor);

      expect(actual).toEqual(expected);
      expect(new Set(actual).size).toBe(expected.length);
    } finally {
      close();
    }
  });

  it('rejects malformed cursors and out-of-range page sizes', async () => {
    const { store, close } = await openStore();
    try {
      expect(() => store.listPage({ cursor: 'not-json' })).toThrow(
        'invalid conversation page cursor',
      );
      expect(() => store.listPage({ limit: 0 })).toThrow('conversation page limit');
      expect(() => store.listPage({ limit: 201 })).toThrow('conversation page limit');
    } finally {
      close();
    }
  });
});

describe('conversation sidebar previews', () => {
  it('returns bounded latest human-visible content, isolated by conversation, without tools or reasoning', async () => {
    const { store, raw, close } = await openStore();
    try {
      const a = store.create({ target: { track: 'model', modelId: 'm' as ModelId } });
      const b = store.create({ target: { track: 'model', modelId: 'm' as ModelId } });
      store.bindTask(a.id, 'task-preview' as TaskId);
      raw
        .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
        .run('thread-preview', 'task-preview', '2026-09-24');
      const insert = raw.prepare(
        'INSERT INTO message (id, thread_id, role, sequence, blocks_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      insert.run(
        'm1',
        'thread-preview',
        'user',
        1,
        JSON.stringify([{ type: 'text', text: '旧消息' }]),
        '2026-09-24',
      );
      insert.run(
        'm2',
        'thread-preview',
        'assistant',
        2,
        JSON.stringify([
          { type: 'reasoning', text: 'hidden reasoning' },
          { type: 'text', text: '新的\n  消息 ' + '好'.repeat(250) },
          { type: 'tool-call', text: 'hidden tool' },
        ]),
        '2026-09-24',
      );
      insert.run(
        'm3',
        'thread-preview',
        'tool',
        3,
        JSON.stringify([{ type: 'text', text: 'tool payload' }]),
        '2026-09-24',
      );
      store.touchLastMessage(b.id); // Even a recency timestamp is not evidence of a message.
      expect(store.listChatPresence([a.id, b.id])).toEqual(new Set([a.id]));
      expect(store.listChatPresence([])).toEqual(new Set());
      const previews = store.listMessagePreviews([a.id, b.id]);
      expect(previews.get(a.id)).toMatch(/^新的 消息 /);
      expect(previews.get(a.id)!.length).toBeLessThanOrEqual(160);
      expect(previews.get(a.id)).not.toMatch(/hidden|tool|旧消息/);
      expect(previews.has(b.id)).toBe(false);
      expect(store.listMessagePreviews([]).size).toBe(0);
      insert.run(
        'm4',
        'thread-preview',
        'user',
        4,
        JSON.stringify([{ type: 'image', storageRef: 'image-secret' }]),
        '2026-09-24',
      );
      expect(store.listMessagePreviews([a.id]).get(a.id)).toBe('[图片]');
      insert.run('m5', 'thread-preview', 'assistant', 5, JSON.stringify([{ type: 'reasoning', text: 'private' }]), '2026-09-24');
      expect(store.listMessagePreviews([a.id]).has(a.id)).toBe(false);
      expect(store.listMessagePreviews(Array(105).fill(a.id)).size).toBe(0);
    } finally {
      close();
    }
  });
});


it('distinguishes empty prepared collaborations from durable chat records', async () => {
  const { store, raw, close } = await openStore();
  try {
    const conversation = store.create({ target: { track: 'model', modelId: 'm' as ModelId }, collaborationKind: 'group' });
    store.bindTask(conversation.id, 'prepared' as TaskId);
    store.touchLastMessage(conversation.id);
    expect(store.listChatPresence([conversation.id]).size).toBe(0);
    raw.prepare('INSERT INTO collaboration_conversation (id, workspace_id, kind, title, payload_json, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(conversation.id, 'w', 'group', 'Chat', '{}', 0, '2026-09-29');
    raw.prepare('INSERT INTO collaboration_message (conversation_id, id, sequence, position, kind, sender_member_id, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(conversation.id, 'm', 1, 0, 'system', 'system', '2026-09-29', JSON.stringify({ kind: 'system' }));
    expect(store.listChatPresence([conversation.id]).size).toBe(0);
    raw.prepare('UPDATE collaboration_message SET kind = ?, payload_json = ? WHERE id = ?').run('chat', JSON.stringify({ kind: 'chat' }), 'm');
    expect(store.listChatPresence([conversation.id])).toEqual(new Set([conversation.id]));
  } finally { close(); }
});
