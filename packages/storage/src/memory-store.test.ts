import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabaseAsync, runMigrations } from './index.js';
import { SqliteMemoryStore, scrubDiagnosticText } from './memory-store.js';
import type { TaskId, WorkspaceId } from '@sync-think/shared';

function makeDbPath() {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-memory-'));
  return join(dir, 'sync-think.db');
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqliteMemoryStore(connection.raw),
    close: () => {
      connection.raw.close();
      rmSync(join(dbPath, '..'), { recursive: true, force: true });
    },
  };
}

describe('scrubDiagnosticText', () => {
  it('redacts sk- keys and bearer tokens', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz';
    const scrubbed = scrubDiagnosticText(`auth ${secret} Bearer ${secret}`);
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain('[REDACTED]');
  });
});

describe('SqliteMemoryStore', () => {
  it('proposes pending memory change and approves into durable entries', async () => {
    const { store, close } = await openStore();
    try {
      const change = store.proposeChange({
        workspaceId: 'ws-1' as WorkspaceId,
        taskId: 'task-1' as TaskId,
        targetScope: 'task',
        additions: [{ id: 'e1', key: 'goal', value: 'Ship M1', targetScope: 'task' }],
        evidenceRefs: ['msg-1'],
        confidence: 0.8,
        now: '2026-07-12T03:00:00.000Z',
      });

      expect(change.approvalState).toBe('pending');
      expect(change.additions).toHaveLength(1);
      expect(store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId })).toHaveLength(0);

      const approved = store.decideChange({
        changeId: change.id,
        decision: 'approved',
        now: '2026-07-12T03:01:00.000Z',
      });
      expect(approved.approvalState).toBe('approved');
      expect(approved.decidedAt).toBe('2026-07-12T03:01:00.000Z');

      const entries = store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.key).toBe('goal');
      expect(entries[0]!.value).toBe('Ship M1');
    } finally {
      close();
    }
  });

  it('rejects empty proposals and auto-approves when requested', async () => {
    const { store, close } = await openStore();
    try {
      expect(() =>
        store.proposeChange({
          workspaceId: 'ws-1' as WorkspaceId,
          taskId: 'task-1' as TaskId,
          additions: [],
        }),
      ).toThrow(/additions|modifications|deprecations/);

      const change = store.proposeChange({
        workspaceId: 'ws-1' as WorkspaceId,
        taskId: 'task-1' as TaskId,
        additions: [{ id: 'e2', key: 'decision', value: 'Use SQLite', targetScope: 'project' }],
        targetScope: 'project',
        autoApprove: true,
        now: '2026-07-12T03:02:00.000Z',
      });
      expect(change.approvalState).toBe('approved');
      const entries = store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId });
      expect(entries.some((e) => e.key === 'decision')).toBe(true);
    } finally {
      close();
    }
  });

  it('rejects already-decided changes and supports deprecations', async () => {
    const { store, close } = await openStore();
    try {
      const first = store.proposeChange({
        workspaceId: 'ws-1' as WorkspaceId,
        taskId: 'task-1' as TaskId,
        additions: [{ id: 'e3', key: 'tmp', value: 'old', targetScope: 'task' }],
        autoApprove: true,
      });
      expect(() =>
        store.decideChange({ changeId: first.id, decision: 'rejected' }),
      ).toThrow(/already decided/);

      const dep = store.proposeChange({
        workspaceId: 'ws-1' as WorkspaceId,
        taskId: 'task-1' as TaskId,
        deprecations: ['tmp'],
        autoApprove: true,
      });
      expect(dep.approvalState).toBe('approved');
      const active = store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId });
      expect(active.find((e) => e.key === 'tmp')).toBeUndefined();
    } finally {
      close();
    }
  });


  it('rolls back approved change and restores prior version (§10.4)', async () => {
    const { store, close } = await openStore();
    try {
      const v1 = store.proposeChange({
        workspaceId: 'ws-1' as WorkspaceId,
        taskId: 'task-1' as TaskId,
        additions: [{ id: 'e-v1', key: 'binding-rule', value: 'agent default', targetScope: 'project' }],
        targetScope: 'project',
        autoApprove: true,
        now: '2026-07-12T04:00:00.000Z',
      });
      expect(store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId })[0]!.value).toBe(
        'agent default',
      );

      const v2 = store.proposeChange({
        workspaceId: 'ws-1' as WorkspaceId,
        taskId: 'task-1' as TaskId,
        modifications: [
          { id: 'e-v2', key: 'binding-rule', value: 'run override wins', targetScope: 'project' },
        ],
        targetScope: 'project',
        autoApprove: true,
        now: '2026-07-12T04:01:00.000Z',
      });
      expect(store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId })[0]!.value).toBe(
        'run override wins',
      );

      const rolled = store.rollbackChange({
        changeId: v2.id,
        now: '2026-07-12T04:02:00.000Z',
      });
      expect(rolled.approvalState).toBe('rolled_back');
      const active = store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId });
      expect(active).toHaveLength(1);
      expect(active[0]!.value).toBe('agent default');
      expect(active[0]!.sourceChangeId).toBe(v1.id);

      expect(() => store.rollbackChange({ changeId: v2.id })).toThrow(/approved|rolled_back|Only approved/);
      expect(() => store.rollbackChange({ changeId: v1.id })).not.toThrow();
      // After rolling back v1 as well, key should have no active entry
      expect(
        store.listActiveEntries({ workspaceId: 'ws-1' as WorkspaceId }).find((e) => e.key === 'binding-rule'),
      ).toBeUndefined();
    } finally {
      close();
    }
  });

  it('appends diagnostics with scrubbed secrets and lists recent', async () => {
    const { store, close } = await openStore();
    try {
      const secret = 'sk-live-should-not-persist-123456';
      const rec = store.appendDiagnostic({
        workspaceId: 'ws-1' as WorkspaceId,
        taskId: 'task-1' as TaskId,
        runId: 'run-1' as never,
        category: 'provider',
        failureClass: 'auth',
        summary: `Provider auth failed with ${secret}`,
        detail: {
          message: `Bearer ${secret}`,
          apiKey: secret,
          status: 401,
        },
        now: '2026-07-12T03:03:00.000Z',
      });

      expect(rec.summary).not.toContain(secret);
      expect(JSON.stringify(rec.detail)).not.toContain(secret);
      expect(rec.detail.apiKey).toBe('[REDACTED]');
      expect(rec.failureClass).toBe('auth');

      const listed = store.listDiagnostics({ workspaceId: 'ws-1' as WorkspaceId });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(rec.id);
    } finally {
      close();
    }
  });
});
