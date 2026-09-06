import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore } from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { createDemoRun, type DemoRunState } from '../src/demo-run.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirs.splice(0)) {
    const target = realpathSync(directory);
    if (
      dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() ||
      !basename(target).startsWith('sync-think-kernel-shutdown-')
    ) {
      throw new Error('Unexpected fixture cleanup path');
    }
    rmSync(target, { recursive: true, force: true });
  }
});

interface ShutdownHarness {
  demoRuns: Map<string, DemoRunState>;
  demoRunAborts: Map<string, AbortController>;
  runtimeStopped: boolean;
  executeKernelRun(runId: RunId): Promise<void>;
  executeDemoRun(runId: RunId): Promise<void>;
  executeExternalKernelRun(runId: RunId): Promise<void>;
  maybeStartPendingGoalTurn(threadId: string): void;
  resolveConversationIdForThread(threadId: string): string | undefined;
}

async function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-kernel-shutdown-'));
  tempDirs.push(directory);
  const dbPath = join(directory, 'runtime.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const runtime = new Runtime({
    installId: basename(directory),
    allowNoToken: true,
    stateStore: new SqliteEventCheckpointStore(connection.raw),
    workspaceId: 'shutdown-workspace' as WorkspaceId,
    checkpointRunId: 'runtime-shutdown' as RunId,
  });
  const harness = runtime as unknown as ShutdownHarness;
  return { connection, runtime, harness };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('kernel run shutdown ownership', () => {
  it.each(['native', 'claude-code', 'codex'])(
    'waits for the full $0 run cleanup before SQLite can close',
    async (kernelId) => {
      const fixture = await createFixture();
      const runId = 'shutdown-run' as RunId;
      const cleanupGate = deferred();
      const entered = deferred();
      const controller = new AbortController();
      fixture.harness.demoRuns.set(
        runId,
        createDemoRun(runId, 'shutdown-thread', 'fixture request', { kernelId }),
      );
      const method = kernelId === 'native' ? 'executeDemoRun' : 'executeExternalKernelRun';
      let cleanupRead = false;
      const execute = vi.spyOn(fixture.harness, method).mockImplementation(async () => {
        fixture.harness.demoRunAborts.set(runId, controller);
        entered.resolve();
        await new Promise<void>((resolve) =>
          controller.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
        await cleanupGate.promise;
        fixture.connection.raw.prepare('SELECT 1').get();
        cleanupRead = true;
        fixture.harness.demoRunAborts.delete(runId);
      });
      const execution = fixture.harness.executeKernelRun(runId);
      await entered.promise;
      let stopped = false;
      const stopping = fixture.runtime.stop().then(() => {
        stopped = true;
      });
      try {
        await vi.waitFor(() => expect(controller.signal.aborted).toBe(true));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stopped).toBe(false);
        expect(cleanupRead).toBe(false);
        cleanupGate.resolve();
        await stopping;
        expect(cleanupRead).toBe(true);
        await fixture.harness.executeKernelRun(runId);
        expect(execute).toHaveBeenCalledTimes(1);
      } finally {
        cleanupGate.resolve();
        await execution;
        await stopping;
        fixture.connection.raw.close();
      }
    },
  );

  it('does not read conversation state or trigger a goal turn during shutdown', async () => {
    const fixture = await createFixture();
    const lookup = vi.spyOn(fixture.harness, 'resolveConversationIdForThread');
    try {
      await fixture.runtime.stop();
      fixture.connection.raw.close();
      fixture.harness.maybeStartPendingGoalTurn('shutdown-thread');
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      if (fixture.connection.raw.open) fixture.connection.raw.close();
    }
  });
});
