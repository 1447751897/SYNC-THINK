import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type {
  KernelAdapter,
  KernelPermissionDecision,
  KernelPermissionRequest,
  ModelId,
  RunId,
} from '@sync-think/shared';
import { createDemoRun, type DemoRunState } from '../src/demo-run.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirs.splice(0)) {
    const target = realpathSync(directory);
    if (
      dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() ||
      !basename(target).startsWith('sync-think-kernel-durability-')
    ) {
      throw new Error('Unexpected fixture cleanup path');
    }
    rmSync(target, { recursive: true, force: true });
  }
});

interface PermissionHarness {
  demoRuns: Map<string, DemoRunState>;
  pendingToolApprovals: Map<string, { resolve(decision: 'approve' | 'deny'): void }>;
  wireKernelPermissionBridge(
    runId: RunId,
    threadId: string,
    adapter: KernelAdapter,
    signal: AbortSignal,
  ): void;
}

async function createFixture(kernelId: string) {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-kernel-durability-'));
  tempDirs.push(directory);
  const dbPath = join(directory, 'runtime.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({
    name: 'Approval durability',
    folderPath: directory,
    allowedRoots: [directory],
  });
  const task = workspaceStore.createTask({
    workspaceId: workspace.id,
    title: 'Approval durability',
    goal: 'Verify approval registration',
  });
  const conversation = conversationStore.create({
    workspaceId: workspace.id,
    title: 'Approval durability',
    target: { track: 'model', modelId: 'fixture-model' as ModelId },
    executionMode: 'ask',
  });
  conversationStore.bindTask(conversation.id, task.taskId);
  const runtime = new Runtime({
    installId: basename(directory),
    allowNoToken: true,
    stateStore,
    workspaceStore,
    conversationStore,
    workspaceId: workspace.id,
    checkpointRunId: 'runtime-permission-durability' as RunId,
  });
  const runId = 'run-permission-durability' as RunId;
  const harness = runtime as unknown as PermissionHarness;
  harness.demoRuns.set(
    runId,
    createDemoRun(runId, task.threadId, 'Write the requested file', { kernelId }),
  );
  let permissionHandler: ((request: KernelPermissionRequest) => void) | undefined;
  const respondPermission =
    vi.fn<(requestId: string, decision: KernelPermissionDecision) => void>();
  const adapter = {
    onPermissionRequest: (handler: (request: KernelPermissionRequest) => void) => {
      permissionHandler = handler;
    },
    respondPermission,
  } as unknown as KernelAdapter;
  harness.wireKernelPermissionBridge(runId, task.threadId, adapter, new AbortController().signal);
  return {
    connection,
    runtime,
    harness,
    respondPermission,
    request: (permission: KernelPermissionRequest) => permissionHandler!(permission),
  };
}

describe('kernel permission durable registration', () => {
  it.each([
    {
      kernelId: 'claude-code',
      toolName: 'Write',
      toolInput: { file_path: 'requested.txt', content: 'requested' },
    },
    {
      kernelId: 'codex',
      toolName: 'command_execution',
      toolInput: { kind: 'command', command: 'write requested.txt', cwd: 'fixture-workspace' },
    },
  ])(
    'denies $kernelId if SQLite rejects the approval and recovers on a fresh request',
    async ({ kernelId, toolName, toolInput }) => {
      const fixture = await createFixture(kernelId);
      try {
        fixture.connection.raw.exec(
          "CREATE TRIGGER reject_approval_insert BEFORE INSERT ON event WHEN NEW.type = 'tool.approval_requested' BEGIN SELECT RAISE(ABORT, 'fixture approval write failure'); END",
        );
        fixture.request({ requestId: 'failed-request', toolName, toolInput });
        expect(fixture.respondPermission).toHaveBeenCalledTimes(1);
        expect(fixture.respondPermission).toHaveBeenCalledWith('failed-request', {
          allow: false,
          message: '审批请求登记失败，本次操作未获批准。',
        });
        expect(fixture.harness.pendingToolApprovals.size).toBe(0);
        expect(
          fixture.connection.raw
            .prepare("SELECT count(*) AS count FROM event WHERE type = 'tool.approval_requested'")
            .get(),
        ).toEqual({ count: 0 });
        fixture.connection.raw.exec('DROP TRIGGER reject_approval_insert');
        fixture.request({ requestId: 'fresh-request', toolName, toolInput });
        expect(fixture.respondPermission).toHaveBeenCalledTimes(1);
        expect(fixture.harness.pendingToolApprovals.size).toBe(1);
        const saved = fixture.connection.raw
          .prepare("SELECT payload_json FROM event WHERE type = 'tool.approval_requested'")
          .get() as { payload_json: string };
        expect(JSON.parse(saved.payload_json)).toMatchObject({
          toolCallId: 'fresh-request',
          toolName,
          arguments: toolInput,
        });
        fixture.harness.pendingToolApprovals.values().next().value!.resolve('approve');
        expect(fixture.respondPermission).toHaveBeenLastCalledWith('fresh-request', {
          allow: true,
        });
      } finally {
        fixture.harness.pendingToolApprovals.clear();
        fixture.harness.demoRuns.clear();
        await fixture.runtime.stop();
        fixture.connection.raw.close();
      }
    },
  );
});
