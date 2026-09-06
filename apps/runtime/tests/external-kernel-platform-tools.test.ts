import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteTaskPlanStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { ModelId, RunId, WorkspaceId } from '@sync-think/shared';
import { createDemoRun, type DemoRunState } from '../src/demo-run.js';
import type { PlatformMcpToolCall } from '../src/kernel/mcp-broker.js';
import { buildPlatformMcpToolDefinitions } from '../src/kernel/platform-tools.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface PlatformToolHarness {
  buildKernelSystemContext(run: DemoRunState, workspaceRoot?: string): string;
  demoRuns: Map<string, DemoRunState>;
  platformMcpCatalogByRun: Map<string, unknown>;
  pendingToolApprovals: Map<string, { resolve(decision: 'approve' | 'deny'): void }>;
  handlePlatformMcpToolCall(
    runId: RunId,
    run: DemoRunState,
    workspaceRoot: string,
    call: PlatformMcpToolCall,
  ): Promise<{ ok: boolean; content?: string; error?: string }>;
}

async function createFixture(executionMode: 'ask' | 'workspace' | 'full-access') {
  const root = mkdtempSync(join(tmpdir(), `sync-think-platform-tool-${executionMode}-`));
  tempDirs.push(root);
  const dbPath = join(root, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const workspaceId = `workspace-platform-${executionMode}` as WorkspaceId;
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const taskPlanStore = new SqliteTaskPlanStore(connection.raw);
  const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
  const unitOfWork = new SqliteUnitOfWork(connection.raw);
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: `Platform ${executionMode}`,
    folderPath: root,
    allowedRoots: [root],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: `Platform ${executionMode}`,
    goal: 'Exercise external kernel platform tools',
  });
  const conversation = conversationStore.create({
    target: { track: 'model', modelId: 'fake-mini' as ModelId },
    workspaceId,
    title: `Platform ${executionMode}`,
    executionMode,
  });
  conversationStore.bindTask(conversation.id, task.taskId);

  const runtime = new Runtime({
    installId: `platform-tool-${executionMode}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    allowNoToken: true,
    stateStore,
    workspaceStore,
    conversationStore,
    taskPlanStore,
    globalAgentStore,
    unitOfWork,
    workspaceId,
    checkpointRunId: `runtime-platform-${executionMode}` as RunId,
  });
  const runId = `run-platform-${executionMode}-${Date.now()}` as RunId;
  const run = createDemoRun(runId, task.threadId, 'kernel prompt', {
    kernelId: 'codex',
    modelId: 'fake-mini',
    providerModelId: 'fake-mini',
    useFakeProvider: false,
  });
  const harness = runtime as unknown as PlatformToolHarness;
  harness.demoRuns.set(runId, run);
  harness.platformMcpCatalogByRun.set(
    runId,
    buildPlatformMcpToolDefinitions({
      executionMode,
      includeAgentTools: true,
      includeTaskTools: true,
    }),
  );

  const callTool = (call: Omit<PlatformMcpToolCall, 'signal'> & { signal?: AbortSignal }) =>
    harness.handlePlatformMcpToolCall(runId, run, root, {
      ...call,
      signal: call.signal ?? new AbortController().signal,
    });

  const waitForApproval = async (): Promise<string> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const approvalId = [...harness.pendingToolApprovals.keys()][0];
      if (approvalId) return approvalId;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('no platform tool approval was raised');
  };

  const decideNextApproval = async (decision: 'approve' | 'deny'): Promise<void> => {
    const approvalId = await waitForApproval();
    const pending = harness.pendingToolApprovals.get(approvalId);
    harness.pendingToolApprovals.delete(approvalId);
    pending?.resolve(decision);
  };

  return {
    callTool,
    connection,
    decideNextApproval,
    globalAgentStore,
    harness,
    root,
    runId,
    taskPlanStore,
    waitForApproval,
    workspaceId,
  };
}

describe('external kernel platform tool dispatch', () => {
  it.each(['claude-code', 'codex'] as const)('instructs %s to use only its native task surface', async (kernelId) => {
    const fixture = await createFixture('full-access');
    try {
      const run = fixture.harness.demoRuns.get(fixture.runId)!;
      const context = fixture.harness.buildKernelSystemContext({ ...run, kernelId }, fixture.root);
      expect(context).not.toContain('mcp__sync-think-platform__update_task_plan');
      expect(context).toContain('Do not call any MCP/platform task tools');
      expect(context).toContain(kernelId === 'codex' ? 'Codex native update_plan' : 'Claude Code native task tools');
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('executes the persisted task checklist through the native task executors', async () => {
    const fixture = await createFixture('workspace');
    try {
      const created = await fixture.callTool({
        id: 'call-task-create',
        tool: 'TaskCreate',
        input: {
          title: 'kernel created task',
          description: 'Inspect runtime/desktop duplicate modules',
          priority: 'high',
        },
      });
      expect(created.ok).toBe(true);
      expect(JSON.parse(created.content!).plan.items[0].description).toBe(
        'Inspect runtime/desktop duplicate modules',
      );
      expect(fixture.taskPlanStore.list(fixture.workspaceId).map((task) => task.title)).toEqual([
        'kernel created task',
      ]);

      const listed = await fixture.callTool({
        id: 'call-task-list',
        tool: 'TaskList',
        input: {},
      });
      expect(listed.ok).toBe(true);
      expect(String(listed.content)).toContain('kernel created task');
      expect(JSON.parse(listed.content!).plan.items[0].description).toBe(
        'Inspect runtime/desktop duplicate modules',
      );
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('requires approval for agent-library writes in workspace mode', async () => {
    const fixture = await createFixture('workspace');
    try {
      const call = fixture.callTool({
        id: 'call-create-agent',
        tool: 'create_agent',
        input: { name: 'Kernel Agent', defaultModelId: 'fake-mini' },
      });
      await fixture.decideNextApproval('approve');
      const result = await call;
      expect(result.ok).toBe(true);
      expect(fixture.globalAgentStore.list().map((agent) => agent.name)).toEqual(['Kernel Agent']);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('denies the agent write and never touches the store when the user rejects', async () => {
    const fixture = await createFixture('ask');
    try {
      const call = fixture.callTool({
        id: 'call-create-agent-denied',
        tool: 'create_agent',
        input: { name: 'Rejected Agent', defaultModelId: 'fake-mini' },
      });
      await fixture.decideNextApproval('deny');
      const result = await call;
      expect(result.ok).toBe(false);
      expect(result.error ?? '').toContain('拒绝');
      expect(fixture.globalAgentStore.list()).toEqual([]);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('auto-executes agent-library writes in full-access without a card', async () => {
    const fixture = await createFixture('full-access');
    try {
      const result = await fixture.callTool({
        id: 'call-create-agent-full',
        tool: 'create_agent',
        input: { name: 'Full Access Agent', defaultModelId: 'fake-mini' },
      });
      expect(result.ok).toBe(true);
      expect(fixture.harness.pendingToolApprovals.size).toBe(0);
      expect(fixture.globalAgentStore.list().map((agent) => agent.name)).toEqual([
        'Full Access Agent',
      ]);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('rejects tools that are not in this run frozen catalog', async () => {
    const fixture = await createFixture('full-access');
    try {
      const result = await fixture.callTool({
        id: 'call-browser',
        tool: 'browser_open',
        input: { url: 'https://example.com' },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('unknown platform tool');
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('replays the same call id instead of creating a second agent', async () => {
    const fixture = await createFixture('full-access');
    try {
      const input = { name: 'Retried Agent', defaultModelId: 'fake-mini' };
      const first = await fixture.callTool({ id: 'call-retry', tool: 'create_agent', input });
      const second = await fixture.callTool({ id: 'call-retry', tool: 'create_agent', input });
      expect(first.ok).toBe(true);
      expect(second).toEqual(first);
      expect(fixture.globalAgentStore.list()).toHaveLength(1);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('collapses the approval card and skips execution when the kernel cancels', async () => {
    const fixture = await createFixture('ask');
    try {
      const controller = new AbortController();
      const call = fixture.callTool({
        id: 'call-cancelled',
        tool: 'create_agent',
        input: { name: 'Cancelled Agent', defaultModelId: 'fake-mini' },
        signal: controller.signal,
      });
      await fixture.waitForApproval();
      controller.abort();
      const result = await call;
      expect(result.ok).toBe(false);
      expect(fixture.harness.pendingToolApprovals.size).toBe(0);
      expect(fixture.globalAgentStore.list()).toEqual([]);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('refuses a late approval after the kernel already cancelled the call', async () => {
    const fixture = await createFixture('ask');
    try {
      const controller = new AbortController();
      const call = fixture.callTool({
        id: 'call-late-approval',
        tool: 'create_agent',
        input: { name: 'Late Agent', defaultModelId: 'fake-mini' },
        signal: controller.signal,
      });
      const approvalId = await fixture.waitForApproval();
      const pending = fixture.harness.pendingToolApprovals.get(approvalId);
      controller.abort();
      // The user clicks approve after the kernel gave up: no side effect allowed.
      pending?.resolve('approve');
      const result = await call;
      expect(result.ok).toBe(false);
      expect(fixture.globalAgentStore.list()).toEqual([]);
    } finally {
      fixture.connection.raw.close();
    }
  });
});
