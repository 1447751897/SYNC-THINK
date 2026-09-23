import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteMessageStore,
  SqliteDelegatedRunStore,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import type { Event, MessageId, RunId, ThreadId } from '@sync-think/shared';
import { DelegationService } from './delegation-service.js';
import { reconcileDelegatedRecord } from './delegation-event.js';

it('retries a failed parent card write without losing completed siblings after reopening SQLite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-delegation-card-retry-'));
  const path = join(dir, 'history.db');
  await runMigrations(path);
  let db = await openDatabaseAsync({ path });
  try {
    const threadId = 'thread' as ThreadId;
    const parentRunId = 'parent' as RunId;
    const parentMessageId = 'asst-parent' as MessageId;
    db.raw.prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task', 'now');
    const messages = new SqliteMessageStore(db.raw);
    const service = new DelegationService(messages);
    service.upsert({
      childRunId: 'A' as RunId, parentRunId, agentId: 'reviewer', name: 'Reviewer',
      avatar: '🔎', kind: 'existing', status: 'completed', result: 'First report', toolEvents: [],
    });
    // The terminal frame may precede a successful parent-message write.
    service.releaseParent(parentRunId);
    messages.append({
      id: parentMessageId, threadId, role: 'assistant', sequence: 1, createdAt: 'now',
      blocks: [{ type: 'text', text: 'Parent answer', payload: { custom: 'retained' } }],
    });
    db.raw.exec(`CREATE TRIGGER fail_card_write BEFORE UPDATE OF blocks_json ON message
      BEGIN SELECT RAISE(ABORT, 'injected card write failure'); END;`);
    expect(() => service.releaseParent(parentRunId)).toThrow('injected card write failure');
    expect(messages.getMessage(parentMessageId)?.blocks).toEqual([
      { type: 'text', text: 'Parent answer', payload: { custom: 'retained' } },
    ]);
    service.upsert({
      childRunId: 'B' as RunId, parentRunId, agentId: 'reviewer', name: 'Reviewer',
      avatar: '🔎', kind: 'existing', status: 'cancelled', toolEvents: [],
    });
    db.raw.exec('DROP TRIGGER fail_card_write');
    service.releaseParent(parentRunId);
    const written = messages.getMessage(parentMessageId);
    service.releaseParent(parentRunId);
    expect(messages.getMessage(parentMessageId)).toEqual(written);
    db.raw.close();
    db = await openDatabaseAsync({ path });
    const restored = new DelegationService(new SqliteMessageStore(db.raw));
    expect(restored.listByParent(parentRunId)).toMatchObject([
      { childRunId: 'A', status: 'completed', result: 'First report' },
      { childRunId: 'B', status: 'cancelled' },
    ]);
    expect(restored.query(threadId, {})).toMatchObject({ total: 2 });
    expect(new SqliteMessageStore(db.raw).getMessage(parentMessageId)?.blocks[0])
      .toMatchObject({ text: 'Parent answer', payload: { custom: 'retained' } });
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('durably repairs a legacy event/projection gap so the next read needs no replay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-delegation-repair-'));
  const path = join(dir, 'history.db');
  await runMigrations(path);
  let db = await openDatabaseAsync({ path });
  try {
    db.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run('thread', 'task', 'now');
    const repository = new SqliteDelegatedRunStore(db.raw);
    const running = {
      childRunId: 'child',
      parentRunId: 'parent',
      threadId: 'thread',
      agentId: 'reviewer',
      name: 'Reviewer',
      status: 'running' as const,
      toolCount: 5,
      sequence: 0,
      updatedAt: 'before',
    };
    repository.upsert(running);
    const events = new SqliteEventCheckpointStore(db.raw);
    events.commitTransition({
      events: [
        {
          id: 'terminal' as Event['id'],
          runId: 'child' as RunId,
          workspaceId: 'workspace' as Event['workspaceId'],
          category: 'run',
          type: 'run.cancelled',
          occurredAt: 'now',
          payload: { threadId: 'thread' },
        },
      ],
    });
    const service = new DelegationService(undefined, repository, (record) =>
      reconcileDelegatedRecord(record, events.listEventsByRun(record.childRunId as RunId), false),
    );
    expect(service.query('thread', { childRunId: 'child' })).toMatchObject({ status: 'cancelled' });
    db.raw.close();
    db = await openDatabaseAsync({ path });
    const restored = new DelegationService(undefined, new SqliteDelegatedRunStore(db.raw));
    expect(restored.query('thread', { childRunId: 'child' })).toMatchObject({
      status: 'cancelled',
      sequence: 1,
      toolCount: 5,
    });
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('finds older delegated tasks beyond the message page and restores canonical cancellation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-delegation-history-'));
  const path = join(dir, 'history.db');
  await runMigrations(path);
  let db = await openDatabaseAsync({ path });
  try {
    const threadId = 'thread' as ThreadId;
    db.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task', '2026-09-19T00:00:00Z');
    const messages = new SqliteMessageStore(db.raw);
    for (let sequence = 1; sequence <= 120; sequence++) {
      messages.append({
        id: `message-${sequence}` as MessageId,
        threadId,
        role: 'assistant',
        sequence,
        createdAt: '2026-09-19T00:00:00Z',
        blocks: [
          {
            type: 'text',
            text: 'Conversation',
            ...(sequence === 1
              ? {
                  payload: {
                    delegatedAgents: [
                      {
                        childRunId: 'child',
                        parentRunId: 'parent',
                        agentId: 'reviewer',
                        name: 'Reviewer',
                        avatar: '=',
                        kind: 'existing',
                        status: 'running',
                        toolEvents: [
                          { toolName: 'read_file' },
                          { toolName: '…另有 15 项工具调用未返回', omitted: true },
                        ],
                      },
                    ],
                  },
                }
              : {}),
          },
        ],
      });
    }
    expect(new DelegationService(messages).query(threadId, { childRunId: 'child' })).toMatchObject({
      status: 'running',
      toolCount: 16,
    });
    const repository = new SqliteDelegatedRunStore(db.raw);
    repository.upsert({
      childRunId: 'child',
      parentRunId: 'parent',
      threadId,
      agentId: 'reviewer',
      name: 'Reviewer',
      status: 'cancelled',
      toolCount: 17,
      sequence: 200,
      updatedAt: '2026-09-19T00:01:00Z',
    });
    db.raw.close();
    db = await openDatabaseAsync({ path });
    const service = new DelegationService(
      new SqliteMessageStore(db.raw),
      new SqliteDelegatedRunStore(db.raw),
    );
    expect(service.query(threadId, { childRunId: 'child' })).toMatchObject({
      status: 'cancelled',
      toolCount: 17,
    });
    expect(service.query('other-thread', { childRunId: 'child' })).toMatchObject({ ok: false });
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
