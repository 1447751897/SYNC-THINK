import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteDesktopStore } from './desktop-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore(): Promise<{
  path: string;
  store: SqliteDesktopStore;
  close(): void;
}> {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-desktop-store-'));
  tempDirs.push(root);
  const path = join(root, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  return {
    path,
    store: new SqliteDesktopStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

const commandInput = {
  id: 'desktop-command-1',
  idempotencyKey: 'desktop:run-1:tool-1',
  workspaceId: 'workspace-1',
  runId: 'run-1',
  ownerId: 'thread-1',
  toolName: 'desktop_invoke_element',
  action: 'invoke-element',
  targetIdentity: 'pid=42;hwnd=0x1234;element=3',
  sanitizedArgs: {
    target: {
      window: { processId: 42, nativeWindowHandle: '0x1234' },
      snapshotRevision: 'snapshot-1',
      accessibilityRevision: 'accessibility-1',
      elementIndex: 3,
    },
  },
  now: '2026-07-31T00:00:00.000Z',
} as const;

describe('SqliteDesktopStore', () => {
  it('persists a reserved command and reads it after reopening the database', async () => {
    const fixture = await openStore();
    const reserved = fixture.store.reserveCommand(commandInput);
    fixture.close();

    const reopened = await openDatabaseAsync({ path: fixture.path });
    try {
      expect(new SqliteDesktopStore(reopened.raw).getCommand(reserved.id)).toEqual({
        ...reserved,
        created: undefined,
      });
    } finally {
      reopened.raw.close();
    }
  });

  it('replays the same idempotency reservation and rejects different input', async () => {
    const fixture = await openStore();
    try {
      const first = fixture.store.reserveCommand(commandInput);
      const replay = fixture.store.reserveCommand(commandInput);
      expect(first.created).toBe(true);
      expect(replay.created).toBe(false);
      expect(replay.id).toBe(first.id);

      expect(() =>
        fixture.store.reserveCommand({
          ...commandInput,
          action: 'focus-element',
        }),
      ).toThrow('desktop.command_idempotency_mismatch');
    } finally {
      fixture.close();
    }
  });

  it('lists only waiting commands with stable ordering and strict filters', async () => {
    const fixture = await openStore();
    try {
      const first = fixture.store.reserveCommand(commandInput);
      const second = fixture.store.reserveCommand({
        ...commandInput,
        id: 'desktop-command-2',
        idempotencyKey: 'desktop:run-1:tool-2',
        now: '2026-07-31T00:00:01.000Z',
      });
      fixture.store.reserveCommand({
        ...commandInput,
        id: 'desktop-command-3',
        idempotencyKey: 'desktop:run-2:tool-3',
        runId: 'run-2',
        now: '2026-07-31T00:00:02.000Z',
      });
      fixture.store.markWaitingUser(first.id, undefined, '2026-07-31T00:00:03.000Z');
      fixture.store.markWaitingUser(second.id, undefined, '2026-07-31T00:00:04.000Z');

      expect(fixture.store.listWaitingCommands().map((command) => command.id)).toEqual([
        second.id,
        first.id,
      ]);
      expect(
        fixture.store
          .listWaitingCommands({ workspaceId: 'workspace-1', runId: 'run-1' })
          .map((command) => command.id),
      ).toEqual([second.id, first.id]);
      expect(fixture.store.listWaitingCommands({ runId: 'run-2' })).toEqual([]);
      expect(() => fixture.store.listWaitingCommands({ workspaceId: 'bad id' })).toThrow(
        'desktop.workspace_id_invalid',
      );
      expect(() => fixture.store.listWaitingCommands({ runId: '' })).toThrow(
        'desktop.run_id_invalid',
      );
    } finally {
      fixture.close();
    }
  });

  it('continues a waiting command exactly once with an updated-at fence', async () => {
    const fixture = await openStore();
    try {
      const command = fixture.store.reserveCommand(commandInput);
      const waiting = fixture.store.markWaitingUser(
        command.id,
        undefined,
        '2026-07-31T00:00:01.000Z',
      );
      const continued = fixture.store.continueWaitingCommand({
        id: command.id,
        expectedUpdatedAt: waiting.updatedAt,
        now: '2026-07-31T00:00:02.000Z',
      });
      expect(continued).toMatchObject({
        state: 'completed',
        replayed: false,
        result: {
          output: {
            ok: true,
            commandId: command.id,
            resolution: 'user-confirmed',
            sourceUpdatedAt: waiting.updatedAt,
          },
        },
      });
      expect(
        fixture.store.continueWaitingCommand({
          id: command.id,
          expectedUpdatedAt: waiting.updatedAt,
        }).replayed,
      ).toBe(true);
      expect(fixture.store.listWaitingCommands()).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it('cancels a waiting command exactly once and rejects a stale decision', async () => {
    const fixture = await openStore();
    try {
      const command = fixture.store.reserveCommand(commandInput);
      const waiting = fixture.store.markWaitingUser(
        command.id,
        undefined,
        '2026-07-31T00:00:01.000Z',
      );
      expect(() =>
        fixture.store.cancelWaitingCommand({
          id: command.id,
          expectedUpdatedAt: '2026-07-31T00:00:00.000Z',
        }),
      ).toThrow('desktop.command_conflict');

      const cancelled = fixture.store.cancelWaitingCommand({
        id: command.id,
        expectedUpdatedAt: waiting.updatedAt,
        now: '2026-07-31T00:00:02.000Z',
      });
      expect(cancelled).toMatchObject({
        state: 'failed',
        replayed: false,
        errorCode: 'desktop.command-cancelled',
        failureClass: 'acceptance',
      });
      expect(
        fixture.store.cancelWaitingCommand({
          id: command.id,
          expectedUpdatedAt: waiting.updatedAt,
        }).replayed,
      ).toBe(true);
      expect(fixture.store.listWaitingCommands()).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it('recovers unknown running commands into waiting_user without replaying them', async () => {
    const fixture = await openStore();
    try {
      const command = fixture.store.reserveCommand(commandInput);
      fixture.store.markApproved(command.id, '2026-07-31T00:00:01.000Z');
      fixture.store.markRunning(command.id, '2026-07-31T00:00:02.000Z');

      expect(fixture.store.recoverUnknownInFlight('2026-07-31T00:00:03.000Z')).toBe(1);
      expect(fixture.store.getCommand(command.id)).toMatchObject({
        state: 'waiting_user',
        errorCode: 'desktop.command-inspection-required',
        updatedAt: '2026-07-31T00:00:03.000Z',
      });
      expect(fixture.store.recoverUnknownInFlight('2026-07-31T00:00:04.000Z')).toBe(0);
    } finally {
      fixture.close();
    }
  });
});
