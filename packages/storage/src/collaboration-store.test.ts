import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { openDatabaseAsync, type BetterSQLite3Raw } from './connection.js';
import { SqliteCollaborationStore } from './collaboration-store.js';
import { MIGRATIONS, runMigrations } from './scripts/migrate.js';

const databases: BetterSQLite3Raw[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const raw of databases.splice(0)) if (raw.open) raw.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function connect(path: string) {
  const { raw } = await openDatabaseAsync({ path });
  databases.push(raw);
  return { store: new SqliteCollaborationStore(raw), raw };
}

async function openStore() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-collaboration-'));
  directories.push(directory);
  const path = join(directory, 'store.db');
  await runMigrations(path);
  return { ...(await connect(path)), path };
}

function snapshot(id = 'conversation-a', workspaceId = 'workspace-a'): CollaborationSnapshot {
  return {
    conversation: {
      id,
      workspaceId,
      kind: 'group',
      title: '协作测试',
      coordinatorMemberId: 'agent-a',
      policy: {
        allowPeerDirect: true,
        maxConcurrent: 3,
        maxMessageHops: 6,
        maxAutoMessages: 12,
        taskTimeoutSeconds: 7200,
        statusTimeoutSeconds: 120,
      },
      createdAt: '2026-09-20T00:00:00.000Z',
    },
    members: [
      { id: 'user', kind: 'user', name: '用户', avatar: '', role: 'owner', active: true },
      {
        id: 'agent-a',
        kind: 'agent',
        agentId: 'catalog-agent-a',
        name: '分析员',
        avatar: '=',
        role: 'coordinator',
        active: true,
      },
    ],
    messages: [
      {
        id: 'message-1',
        conversationId: id,
        senderMemberId: 'user',
        recipientMemberIds: ['agent-a'],
        mentions: [{ memberId: 'agent-a', label: '分析员' }],
        kind: 'chat',
        blocks: [{ type: 'text', text: '检查当前修改' }],
        expectsResponse: true,
        correlationId: 'correlation-1',
        hopCount: 0,
        sequence: 1,
        createdAt: '2026-09-20T00:00:01.000Z',
      },
    ],
    deliveries: [
      {
        id: 'delivery-1',
        messageId: 'message-1',
        recipientMemberId: 'agent-a',
        status: 'processing',
        attemptId: 'attempt-1',
      },
    ],
    tasks: [
      {
        id: 'task-1',
        rootTaskId: 'task-1',
        originMessageId: 'message-1',
        assigneeMemberId: 'agent-a',
        title: '检查当前修改',
        instructions: '检查当前修改',
        expectedOutput: '问题清单',
        dependsOnTaskIds: [],
        contextRefs: ['message-1'],
        resourceClaims: [{ key: 'workspace:a', mode: 'read' }],
        returnTo: { conversationId: id, replyToMessageId: 'message-1' },
        timeoutSeconds: 300,
        currentAttemptId: 'attempt-1',
        kind: 'task',
        createdAt: '2026-09-20T00:00:01.000Z',
      },
    ],
    attempts: [
      {
        id: 'attempt-1',
        taskId: 'task-1',
        number: 1,
        status: 'running',
        runId: 'run-1',
        startedAt: '2026-09-20T00:00:01.000Z',
        updatedAt: '2026-09-20T00:00:02.000Z',
        contextSequence: 1,
        output: '正在检查',
        resourceClaims: [{ key: 'workspace:a', mode: 'read' }],
        tools: [{ id: 'tool-1', name: 'git_diff', arguments: '{}', status: 'running' }],
        checklist: [{ id: 'check-1', text: '检查差异', status: 'in_progress' }],
        agentSnapshot: { name: '分析员', modelId: 'model-1' },
      },
    ],
    revision: 0,
    receipts: { 'send:request-1': 'message-1' },
  };
}

describe('SqliteCollaborationStore', () => {
  it('restores every entity and receipt after reopening the migrated database', async () => {
    const { store, raw, path } = await openStore();
    const original = snapshot();
    store.save(original);
    raw.close();
    const reopened = await connect(path);
    expect(reopened.store.read(original.conversation.id)).toEqual(original);
    const loaded = reopened.store.read(original.conversation.id)!;
    loaded.attempts[0]!.output = 'local mutation';
    expect(reopened.store.read(original.conversation.id)).toEqual(original);
    expect(reopened.store.read('missing')).toBeUndefined();
  });

  it('rolls back all conversations when an outer immediate transaction fails', async () => {
    const { store } = await openStore();
    store.save(snapshot());
    expect(() =>
      store.transaction(() => {
        const first = store.read('conversation-a')!;
        first.revision++;
        first.conversation.title = '更新';
        store.save(first);
        store.transaction(() => store.save(snapshot('conversation-b')));
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(store.read('conversation-a')).toEqual(snapshot());
    expect(store.read('conversation-b')).toBeUndefined();
  });

  it('supports nested transactions and successful cross-conversation updates', async () => {
    const { store } = await openStore();
    store.transaction(() => {
      store.save(snapshot());
      store.transaction(() => store.save(snapshot('conversation-b')));
      const first = store.read('conversation-a')!;
      first.revision++;
      first.receipts['direct:request-2'] = 'conversation-b';
      store.save(first);
    });
    expect(store.list()).toHaveLength(2);
    expect(store.read('conversation-a')?.receipts['direct:request-2']).toBe('conversation-b');
  });

  it('keeps duplicate requests idempotent and rejects changing or dropping a receipt', async () => {
    const { store, raw } = await openStore();
    const original = snapshot();
    store.save(original);
    store.save(structuredClone(original));
    expect(raw.prepare('SELECT count(*) AS count FROM collaboration_receipt').get()).toEqual({
      count: 1,
    });
    const next = structuredClone(original);
    next.revision++;
    next.receipts['send:request-1'] = 'different-message';
    expect(() => store.save(next)).toThrow('collaboration.receipt_conflict');
    delete next.receipts['send:request-1'];
    expect(() => store.save(next)).toThrow('collaboration.receipt_conflict');
    expect(store.read('conversation-a')).toEqual(original);
  });

  it('isolates conversations and workspace filtering even when local entity IDs match', async () => {
    const { store } = await openStore();
    const first = snapshot();
    const second = snapshot('conversation-b', 'workspace-b');
    second.revision = 1;
    second.messages[0]!.blocks = [{ type: 'text', text: '独立会话' }];
    second.attempts[0]!.output = '独立任务';
    store.save(first);
    store.save(second);
    expect(store.list('workspace-a')).toEqual([first]);
    expect(store.list('workspace-b')).toEqual([second]);
    expect(store.list('missing')).toEqual([]);
    expect(store.read('conversation-a')).toEqual(first);
    const changed = structuredClone(first);
    changed.revision++;
    changed.conversation.workspaceId = 'workspace-b';
    expect(() => store.save(changed)).toThrow('collaboration.workspace_scope_mismatch');
  });

  it('preserves previous attempts when a task is retried', async () => {
    const { store } = await openStore();
    const first = snapshot();
    first.attempts[0]!.status = 'failed';
    first.attempts[0]!.error = {
      code: 'failure',
      category: 'execution',
      message: '失败',
      retryable: true,
      traceId: 'trace-1',
    };
    store.save(first);
    const next = store.read('conversation-a')!;
    next.revision++;
    next.tasks[0]!.currentAttemptId = 'attempt-2';
    next.attempts.push({
      ...structuredClone(next.attempts[0]!),
      id: 'attempt-2',
      number: 2,
      status: 'queued',
      output: '',
      error: undefined,
    });
    store.save(next);
    expect(store.read('conversation-a')!.attempts).toEqual(next.attempts);
    const incomplete = store.read('conversation-a')!;
    incomplete.revision++;
    incomplete.attempts.shift();
    expect(() => store.save(incomplete)).toThrow('collaboration.history_missing');
    expect(store.read('conversation-a')!.attempts[0]).toEqual(first.attempts[0]);
  });

  it('fences stale concurrent writers and rejects skipped revisions', async () => {
    const { store, path } = await openStore();
    const other = (await connect(path)).store;
    store.save(snapshot());
    const first = store.read('conversation-a')!;
    const stale = other.read('conversation-a')!;
    first.revision++;
    first.conversation.title = 'winning change';
    store.save(first);
    stale.revision++;
    stale.conversation.title = 'stale change';
    expect(() => other.save(stale)).toThrow('collaboration.revision_conflict');
    expect(other.read('conversation-a')).toEqual(first);
    const skipped = structuredClone(first);
    skipped.revision += 2;
    expect(() => other.save(skipped)).toThrow('collaboration.revision_conflict');
    other.save(structuredClone(first));
  });

  it('rolls back metadata and entities if an inner write violates message uniqueness', async () => {
    const { store } = await openStore();
    const first = snapshot();
    store.save(first);
    const next = structuredClone(first);
    next.revision++;
    next.conversation.title = 'must roll back';
    next.messages.push({ ...structuredClone(next.messages[0]!), id: 'message-duplicate-sequence' });
    expect(() => store.save(next)).toThrow(/UNIQUE constraint/);
    expect(store.read('conversation-a')).toEqual(first);
    const wrongScope = structuredClone(first);
    wrongScope.revision++;
    wrongScope.messages[0]!.conversationId = 'another';
    expect(() => store.save(wrongScope)).toThrow('collaboration.message_scope_mismatch');
  });

  it('applies collaboration migration once and preserves stored data on migration rerun', async () => {
    const { store, raw, path } = await openStore();
    store.save(snapshot());
    raw.close();
    await runMigrations(path);
    const reopened = await connect(path);
    expect(reopened.store.read('conversation-a')).toEqual(snapshot());
    expect(MIGRATIONS.some((migration) => migration.name === '0059_collaboration_chat')).toBe(true);
    expect(MIGRATIONS.at(-1)?.name).toBe('0063_browser_workflow_workspace');
    expect(
      reopened.raw
        .prepare(
          "SELECT count(*) AS count FROM migration_record WHERE name = '0059_collaboration_chat'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });
});
