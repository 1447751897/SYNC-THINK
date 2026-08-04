import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore } from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { createDemoRun, serializeDemoRuns } from '../src/demo-run.js';
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

    const provider = new CountingProvider();
    const runtime = new Runtime({
      installId: `run-expiry-${Date.now()}`,
      allowNoToken: true,
      workspaceId,
      checkpointRunId,
      stateStore: store,
      demoProvider: provider,
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
    } finally {
      await runtime.stop();
      connection.raw.close();
    }
  });
});
