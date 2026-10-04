import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FakeProvider } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteWorkspaceStore } from '@sync-think/storage';
import type { ModelId, RunId, TaskId, ThreadId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { serializeDemoRun, type DemoRunState } from './demo-run.js';

it('never restores a collaboration-owned interrupted provider attempt as an independent model conversation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'group-recovery-owner-'));
  const path = join(directory, 'test.db'); await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  workspaces.createWorkspace({ id: 'recovery-workspace' as WorkspaceId, name: 'recovery' });
  workspaces.createTask({ id: 'collaboration-task:old-attempt' as TaskId, workspaceId: 'recovery-workspace' as WorkspaceId, threadId: 'room:old-attempt' as ThreadId, title: 'old', goal: 'old' });
  workspaces.createTask({ id: 'ordinary-task' as TaskId, workspaceId: 'recovery-workspace' as WorkspaceId, threadId: 'ordinary-thread' as ThreadId, title: 'ordinary', goal: 'ordinary' });
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const options = { installId: 'recovery-owner', allowNoToken: true, workspaceStore: workspaces, stateStore, demoProvider: new FakeProvider() };
  const first = new Runtime(options);
  type Internal = { prepareRunBinding(input: object): { run: DemoRunState }; persistProjectedEvent(draft: object, runs: Map<string, DemoRunState>): unknown; resumeDemoRuns(): void; demoRuns: Map<string, DemoRunState>; executeKernelRun(runId: RunId): Promise<void> };
  const original = first as unknown as Internal;
  const old = original.prepareRunBinding({ runId: 'orphan-model-run', threadId: 'room:old-attempt', track: 'model', modelId: 'fake-mini' as ModelId, userText: 'old' }).run;
  const ordinary = original.prepareRunBinding({ runId: 'ordinary-model-run', threadId: 'ordinary-thread', track: 'model', modelId: 'fake-mini' as ModelId, userText: 'ordinary' }).run;
  const now = new Date().toISOString();
  for (const run of [old, ordinary]) original.persistProjectedEvent({ id: 'started-' + run.runId, workspaceId: 'recovery-workspace', runId: run.runId, category: 'run', type: 'run.started', occurredAt: now, payload: { threadId: run.threadId, run: serializeDemoRun(run) } }, new Map([[old.runId, old], [ordinary.runId, ordinary]]));
  await first.stop();
  const restored = new Runtime(options);
  const internal = restored as unknown as Internal;
  const execute = vi.spyOn(internal, 'executeKernelRun').mockResolvedValue();
  try {
    expect(internal.demoRuns.has(old.runId)).toBe(true);
    internal.resumeDemoRuns();
    expect(execute.mock.calls.map(([id]) => id)).toEqual([ordinary.runId]);
    expect(internal.demoRuns.has(old.runId)).toBe(false);
    expect(stateStore.listEventsByRun(old.runId).some(event => event.type === 'run.cancelled' && event.payload.reason === 'collaboration_host_recovery')).toBe(true);
    const after = new Runtime(options);
    try { expect((after as unknown as Internal).demoRuns.has(old.runId)).toBe(false); }
    finally { await after.stop(); }
  } finally { await restored.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); }
});
