import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteBrowserStore,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import type { BrowserHostLike } from '@sync-think/workers';
import { createDemoRun, serializeDemoRuns } from '../src/demo-run.js';
import { RuntimeBrowserProfileService } from '../src/browser/runtime-browser-profile-service.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class CountingProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  calls = 0;

  async *call(_request: ProviderCallRequest) {
    this.calls += 1;
    yield { type: 'finished' as const, reason: 'stop' as const };
  }
}

describe('demo Run cold-start recovery expiry', () => {
  it('pauses an expired restored Run without issuing another Provider call', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-run-expiry-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const workspaceId = 'workspace-run-expiry' as WorkspaceId;
    const checkpointRunId = 'runtime-run-expiry' as RunId;
    const runId = 'restored-expired-run' as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const browserStore = new SqliteBrowserStore(connection.raw);
    const browserHost: BrowserHostLike = {
      acquireLease: async () => {
        throw new Error('unexpected Browser lease acquisition');
      },
      inspectLease: async () => {
        throw new Error('unexpected Browser lease inspection');
      },
      execute: async () => {
        throw new Error('unexpected Browser execution');
      },
      releaseLease: async () => undefined,
      shutdown: async () => undefined,
      hasActiveProfileLeases: () => false,
    };
    const run = createDemoRun(runId, 'thread-expired', 'old request');
    const oldTime = '2026-07-31T06:40:49.686Z';

    store.commitTransition({
      events: [
        {
          id: 'event-expired-run-started' as never,
          workspaceId,
          runId,
          category: 'run',
          type: 'run.started',
          occurredAt: oldTime,
          payload: { threadId: run.threadId, run: serializeDemoRuns(new Map([[runId, run]]))[0] },
        },
      ],
      checkpoint: {
        id: 'checkpoint-expired-run' as never,
        runId: checkpointRunId,
        state: {
          threadVersions: [],
          demoRuns: serializeDemoRuns(new Map([[runId, run]])),
        },
        createdAt: oldTime,
      },
    });
    const browserCommand = browserStore.reserveCommand({
      id: 'browser-command-expired-run',
      idempotencyKey: 'browser:restored-expired-run:call-1',
      workspaceId,
      runId,
      ownerId: run.threadId,
      profileId: 'default',
      toolName: 'browser_open',
      action: 'navigate',
      targetOrigin: 'https://example.test',
      sanitizedArgs: { url: 'https://example.test/' },
      now: oldTime,
    });
    browserStore.markApproved(browserCommand.id, oldTime);
    browserStore.markRunning(browserCommand.id, oldTime);
    expect(
      new RuntimeBrowserProfileService({ store: browserStore, host: browserHost })
        .listProfiles()
        .find((profile) => profile.id === 'default'),
    ).toMatchObject({ inUse: true });

    const provider = new CountingProvider();
    const runtime = new Runtime({
      installId: `run-expiry-${Date.now()}`,
      allowNoToken: true,
      workspaceId,
      checkpointRunId,
      stateStore: store,
      demoProvider: provider,
      browserStore,
      browserHost,
    });

    try {
      await runtime.start();
      await new Promise((resolve) => setTimeout(resolve, 25));
      const events = store.listEventsByRun(runId);
      expect(provider.calls).toBe(0);
      expect(events.at(-1)).toMatchObject({
        type: 'run.paused',
        payload: { reason: 'recovery_expired', failureClass: 'unknown' },
      });
      expect(browserStore.getCommand(browserCommand.id)).toMatchObject({
        state: 'failed',
        errorCode: 'browser.command-recovery-expired',
        failureClass: 'acceptance',
      });
      expect(
        new RuntimeBrowserProfileService({ store: browserStore, host: browserHost })
          .listProfiles()
          .find((profile) => profile.id === 'default'),
      ).toMatchObject({ inUse: false });
    } finally {
      await runtime.stop();
      connection.raw.close();
    }
  });
});
