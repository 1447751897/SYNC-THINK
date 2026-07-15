import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqlitePolicyStore } from './policy-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-policy-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStore(dbPath = makeDbPath()) {
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    store: new SqlitePolicyStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqlitePolicyStore', () => {
  it('inserts immutable versions and keeps exact history readable', async () => {
    const { store, close } = await openStore();
    try {
      const first = store.save({
        policyId: 'policy-workspace',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'full',
        rules: [{ action: 'shell.exec', approvalMode: 'full' }],
        now: '2026-07-13T03:00:00.000Z',
      });
      const second = store.save({
        policyId: first.policyId,
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'request',
        rules: [{ action: 'shell.exec', approvalMode: 'request' }],
        now: '2026-07-13T03:01:00.000Z',
      });

      expect(first).toMatchObject({ version: 1, approvalMode: 'full' });
      expect(second).toMatchObject({ version: 2, approvalMode: 'request' });
      expect(second.id).not.toBe(first.id);
      expect(store.getVersion(first.id)).toEqual(first);
      expect(store.getPolicyVersion(first.policyId, 1)).toEqual(first);
      expect(store.listVersions(first.policyId)).toEqual([first, second]);
    } finally {
      close();
    }
  });

  it('lists only the latest versions for the requested scopes', async () => {
    const { store, close } = await openStore();
    try {
      store.save({
        policyId: 'policy-workspace',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'full',
        rules: [],
        now: '2026-07-13T04:00:00.000Z',
      });
      store.save({
        policyId: 'policy-workspace',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'request',
        rules: [],
        now: '2026-07-13T04:01:00.000Z',
      });
      store.save({
        policyId: 'policy-task',
        scopeType: 'task',
        scopeId: 'task-1',
        approvalMode: 'delegate',
        rules: [],
        now: '2026-07-13T04:02:00.000Z',
      });
      store.save({
        policyId: 'policy-other-agent',
        scopeType: 'agent',
        scopeId: 'agent-2',
        approvalMode: 'request',
        rules: [],
        now: '2026-07-13T04:03:00.000Z',
      });

      const applicable = store.listApplicable([
        { scopeType: 'workspace', scopeId: 'workspace-1' },
        { scopeType: 'task', scopeId: 'task-1' },
        { scopeType: 'agent', scopeId: 'agent-1' },
      ]);

      expect(applicable.map(({ policyId, version }) => [policyId, version])).toEqual([
        ['policy-workspace', 2],
        ['policy-task', 1],
      ]);
    } finally {
      close();
    }
  });

  it('retains policy history after reopening the database', async () => {
    const dbPath = makeDbPath();
    const first = await openStore(dbPath);
    try {
      first.store.save({
        policyId: 'policy-persisted',
        scopeType: 'run',
        scopeId: 'run-1',
        approvalMode: 'custom',
        rules: [{ action: 'browser.navigate', approvalMode: 'full' }],
        now: '2026-07-13T05:00:00.000Z',
      });
    } finally {
      first.close();
    }

    const reopened = await openStore(dbPath);
    try {
      expect(reopened.store.listVersions('policy-persisted')).toMatchObject([
        {
          policyId: 'policy-persisted',
          version: 1,
          scopeType: 'run',
          scopeId: 'run-1',
          approvalMode: 'custom',
        },
      ]);
    } finally {
      reopened.close();
    }
  });

  it('versions an exact delegate AgentVersion in policy rules', async () => {
    const { store, close } = await openStore();
    try {
      const saved = store.save({
        policyId: 'policy-delegate',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        approvalMode: 'full',
        rules: [
          {
            action: 'shell.exec',
            approvalMode: 'delegate',
            delegateAgentVersionId: 'agent-version-approval-1' as never,
          },
        ],
      });

      expect(saved.rules).toEqual([
        {
          action: 'shell.exec',
          approvalMode: 'delegate',
          delegateAgentVersionId: 'agent-version-approval-1',
        },
      ]);
      expect(store.getVersion(saved.id)?.rules).toEqual(saved.rules);
    } finally {
      close();
    }
  });
});
