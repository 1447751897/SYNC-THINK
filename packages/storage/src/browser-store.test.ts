import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteBrowserStore } from './browser-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore(): Promise<{
  store: SqliteBrowserStore;
  close(): void;
}> {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-store-'));
  tempDirs.push(root);
  const path = join(root, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  return {
    store: new SqliteBrowserStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

function reserveCompletedBrowserCommand(store: SqliteBrowserStore) {
  const command = store.reserveCommand({
    id: 'browser-command-open',
    idempotencyKey: 'browser:run-1:step-1:open',
    workspaceId: 'workspace-1',
    runId: 'run-1',
    ownerId: 'step:step-1:agent-version-1',
    profileId: 'default',
    toolName: 'browser_open',
    action: 'navigate',
    targetOrigin: 'https://example.test',
    sanitizedArgs: { url: 'https://example.test/login' },
    now: '2026-07-31T00:00:00.000Z',
  });
  store.markApproved(command.id, '2026-07-31T00:00:01.000Z');
  store.markRunning(command.id, '2026-07-31T00:00:02.000Z');
  return store.completeCommand(
    command.id,
    { ok: true, url: 'https://example.test/login' },
    { leaseId: 'lease-1', pageId: 'page-1' },
    '2026-07-31T00:00:03.000Z',
  );
}

describe('SqliteBrowserStore durable human handoff', () => {
  it('finds the latest completed Page lease for the exact Run owner and Profile', async () => {
    const fixture = await openStore();
    try {
      const completed = reserveCompletedBrowserCommand(fixture.store);

      expect(
        fixture.store.getLastCompletedCommand({
          workspaceId: 'workspace-1',
          runId: 'run-1',
          ownerId: 'step:step-1:agent-version-1',
          profileId: 'default',
        }),
      ).toEqual(completed);
      expect(
        fixture.store.getLastCompletedCommand({
          workspaceId: 'workspace-1',
          runId: 'run-other',
          ownerId: 'step:step-1:agent-version-1',
          profileId: 'default',
        }),
      ).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  it('persists a waiting handoff with lease identity and lists it after reopening', async () => {
    const fixture = await openStore();
    const rawPath = fixture.store;
    try {
      reserveCompletedBrowserCommand(fixture.store);
      const handoff = fixture.store.reserveCommand({
        id: 'browser-command-handoff',
        idempotencyKey: 'browser:run-1:step-1:handoff',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'step:step-1:agent-version-1',
        profileId: 'default',
        leaseId: 'lease-1',
        pageId: 'page-1',
        toolName: 'browser_handoff',
        action: 'handoff',
        targetOrigin: 'https://example.test',
        sanitizedArgs: {
          reason: 'login',
          requestedOutcome: 'Complete sign-in and return to the dashboard.',
          onCancel: 'keep-open',
          stepId: 'step-1',
          agentVersionId: 'agent-version-1',
        },
        now: '2026-07-31T00:00:04.000Z',
      });

      const waiting = fixture.store.markHandoffWaiting(
        handoff.id,
        { leaseId: 'lease-1', pageId: 'page-1' },
        '2026-07-31T00:00:05.000Z',
      );
      expect(waiting).toMatchObject({
        state: 'waiting_user',
        leaseId: 'lease-1',
        pageId: 'page-1',
        errorCode: 'browser.handoff-required',
      });
      expect(
        fixture.store.listWaitingHandoffs({ workspaceId: 'workspace-1', runId: 'run-1' }),
      ).toEqual([waiting]);
      expect(
        fixture.store.listWaitingHandoffs({ workspaceId: 'workspace-1', runId: 'run-other' }),
      ).toEqual([]);
      expect(rawPath).toBe(fixture.store);
    } finally {
      fixture.close();
    }
  });

  it('replays the same handoff transition but rejects lease identity replacement', async () => {
    const fixture = await openStore();
    try {
      const handoff = fixture.store.reserveCommand({
        id: 'browser-command-handoff-replay',
        idempotencyKey: 'browser:run-1:step-1:handoff-replay',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'step:step-1:agent-version-1',
        profileId: 'default',
        leaseId: 'lease-1',
        pageId: 'page-1',
        toolName: 'browser_handoff',
        action: 'handoff',
        targetOrigin: 'https://example.test',
        sanitizedArgs: { reason: 'manual', requestedOutcome: 'Confirm completion.', onCancel: 'close-page' },
      });
      const first = fixture.store.markHandoffWaiting(handoff.id, {
        leaseId: 'lease-1',
        pageId: 'page-1',
      });
      expect(
        fixture.store.markHandoffWaiting(handoff.id, {
          leaseId: 'lease-1',
          pageId: 'page-1',
        }),
      ).toEqual(first);
      expect(() =>
        fixture.store.markHandoffWaiting(handoff.id, {
          leaseId: 'lease-other',
          pageId: 'page-1',
        }),
      ).toThrow('browser.handoff_lease_mismatch');
    } finally {
      fixture.close();
    }
  });
});
