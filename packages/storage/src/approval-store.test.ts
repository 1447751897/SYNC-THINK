import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteApprovalStore } from './approval-store.js';
import type { WorkspaceId } from '@sync-think/shared';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-approval-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqliteApprovalStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteApprovalStore (§13 Approval Center)', () => {
  it('enqueues pending approval and lists it', async () => {
    const { store, close } = await openStore();
    try {
      const ws = 'ws_test' as WorkspaceId;
      const rec = store.enqueue({
        workspaceId: ws,
        action: 'shell.exec',
        kind: 'tool',
        summary: 'Run npm test',
        mode: 'request',
        gate: 'require-human',
      });
      expect(rec.state).toBe('pending');
      expect(rec.action).toBe('shell.exec');
      const listed = store.list({ workspaceId: ws, state: 'pending' });
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(rec.id);
      expect(store.countPending(ws)).toBe(1);
    } finally {
      close();
    }
  });

  it('human decides approve / reject', async () => {
    const { store, close } = await openStore();
    try {
      const ws = 'ws_h' as WorkspaceId;
      const a = store.enqueue({
        workspaceId: ws,
        action: 'payment-or-purchase',
        kind: 'human-only',
        humanOnly: true,
        humanOnlyAction: 'payment-or-purchase',
        mode: 'full',
        gate: 'require-human',
      });
      expect(a.humanOnly).toBe(true);
      const approved = store.decide({ id: a.id, decision: 'approved', decidedBy: 'human' });
      expect(approved.state).toBe('approved');
      expect(approved.decidedBy).toBe('human');
      expect(() =>
        store.decide({ id: a.id, decision: 'rejected', decidedBy: 'human' }),
      ).toThrow(/already_decided/);
    } finally {
      close();
    }
  });

  it('refuses non-human decision on human-only', async () => {
    const { store, close } = await openStore();
    try {
      const ws = 'ws_ho' as WorkspaceId;
      const a = store.enqueue({
        workspaceId: ws,
        action: 'irreversible-deletion',
        kind: 'human-only',
        humanOnly: true,
        humanOnlyAction: 'irreversible-deletion',
      });
      expect(() =>
        store.decide({ id: a.id, decision: 'approved', decidedBy: 'auto' }),
      ).toThrow(/human_only_requires_human/);
      expect(() =>
        store.decide({ id: a.id, decision: 'approved', decidedBy: 'delegate' }),
      ).toThrow(/human_only_requires_human/);
    } finally {
      close();
    }
  });

  it('filters humanOnly and state', async () => {
    const { store, close } = await openStore();
    try {
      const ws = 'ws_f' as WorkspaceId;
      store.enqueue({
        workspaceId: ws,
        action: 'tool.a',
        kind: 'tool',
        humanOnly: false,
      });
      store.enqueue({
        workspaceId: ws,
        action: 'export-sensitive-data-outside-boundary',
        kind: 'human-only',
        humanOnly: true,
        humanOnlyAction: 'export-sensitive-data-outside-boundary',
      });
      expect(store.list({ workspaceId: ws, humanOnly: true })).toHaveLength(1);
      expect(store.list({ workspaceId: ws, humanOnly: false })).toHaveLength(1);
    } finally {
      close();
    }
  });
});
