import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteDelegatedRunStore,
  SqliteGlobalAgentStore,
  SqliteTaskPlanStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, RunId, WorkspaceId } from '@sync-think/shared';
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
  platformMcpRuns: { setCatalog(runId: string, catalog: readonly unknown[]): void };
  activeToolApprovals: {
    readonly size: number;
    firstId(): string | undefined;
    settle(approvalId: string, decision: 'approve' | 'deny'): unknown;
  };
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
  harness.platformMcpRuns.setCatalog(
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
      const approvalId = harness.activeToolApprovals.firstId();
      if (approvalId) return approvalId;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('no platform tool approval was raised');
  };

  const decideNextApproval = async (decision: 'approve' | 'deny'): Promise<void> => {
    const approvalId = await waitForApproval();
    harness.activeToolApprovals.settle(approvalId, decision);
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
  it.each(['claude-code', 'codex'] as const)(
    'instructs %s to use only its native task surface',
    async (kernelId) => {
      const fixture = await createFixture('full-access');
      try {
        const run = fixture.harness.demoRuns.get(fixture.runId)!;
        const context = fixture.harness.buildKernelSystemContext(
          { ...run, kernelId },
          fixture.root,
        );
        expect(context).not.toContain('mcp__sync-think-platform__update_task_plan');
        expect(context).toContain('Do not call any MCP/platform task tools');
        expect(context).toContain(
          kernelId === 'codex' ? 'Codex native update_plan' : 'Claude Code native task tools',
        );
        expect(context).toContain('Workspace Agent activation is live SYNC-THINK runtime state');
        expect(context).toContain('call `list_available_agents` (preferred) or `agent_list`');
        expect(context).toContain('Never inspect AGENTS.md');
      } finally {
        fixture.connection.raw.close();
      }
    },
  );

  it('returns only globally available or workspace-activated agents from agent_list', async () => {
    const fixture = await createFixture('workspace');
    try {
      fixture.globalAgentStore.create({
        id: 'agent-global' as AgentId,
        name: 'Global Agent',
        defaultModelId: 'fake-mini' as ModelId,
        availabilityScope: 'global',
      });
      fixture.globalAgentStore.create({
        id: 'agent-active' as AgentId,
        name: 'Workspace Agent',
        defaultModelId: 'fake-mini' as ModelId,
        availabilityScope: 'workspace',
      });
      fixture.globalAgentStore.create({
        id: 'agent-inactive' as AgentId,
        name: 'Inactive Agent',
        defaultModelId: 'fake-mini' as ModelId,
        availabilityScope: 'workspace',
      });
      fixture.globalAgentStore.setWorkspaceActivation({
        agentId: 'agent-active' as AgentId,
        workspaceId: fixture.workspaceId,
        active: true,
      });

      const result = await fixture.callTool({
        id: 'call-agent-list',
        tool: 'agent_list',
        input: {},
      });
      expect(result.ok).toBe(true);
      const content = JSON.parse(result.content!);
      expect(content.workspaceId).toBe(fixture.workspaceId);
      expect(content.agents.map((agent: { agentId: string }) => agent.agentId)).toEqual([
        'agent-global',
        'agent-active',
      ]);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('returns agent_run immediately while the child continues in the background', async () => {
    const fixture = await createFixture('full-access');
    let releaseChild!: () => void;
    const childGate = new Promise<void>((resolve) => {
      releaseChild = resolve;
    });
    const executeSpy = vi
      .spyOn(
        fixture.harness as unknown as { executeDemoRun(runId: RunId): Promise<void> },
        'executeDemoRun',
      )
      .mockImplementation(async () => childGate);
    try {
      const parentCall = new AbortController();
      fixture.globalAgentStore.create({
        id: 'agent-background' as AgentId,
        name: 'Background Agent',
        defaultModelId: 'fake-mini' as ModelId,
        availabilityScope: 'global',
      });

      fixture.globalAgentStore.create({
        id: 'agent-inactive' as AgentId,
        name: 'Inactive Agent',
        defaultModelId: 'fake-mini' as ModelId,
        availabilityScope: 'workspace',
      });
      for (const [input, expected] of [
        [{ agentId: 'agent-background' }, { error: 'agent_delegate: task is required.' }],
        [{ task: 'Review' }, { code: 'AGENT_ID_REQUIRED' }],
        [{ task: 'Review', agentId: 'agent-inactive' }, { code: 'AGENT_UNAVAILABLE' }],
        [
          { task: 'Review', agentId: 'agent-background', requiredSkillIds: ['missing'] },
          { code: 'AGENT_CAPABILITY_MISMATCH' },
        ],
      ] as const) {
        const denied = await fixture.callTool({ id: 'denied-admission', tool: 'agent_run', input });
        expect(JSON.parse(denied.content!)).toMatchObject({ ok: false, ...expected });
        expect(executeSpy).not.toHaveBeenCalled();
        expect(fixture.harness.demoRuns.size).toBe(1);
        expect(fixture.harness.demoRuns.get(fixture.runId)?.delegationChildCount ?? 0).toBe(0);
        expect(
          fixture.connection.raw.prepare('SELECT COUNT(*) AS count FROM delegated_run').get(),
        ).toEqual({ count: 0 });
        expect(
          fixture.connection.raw
            .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.started'")
            .get(),
        ).toEqual({ count: 0 });
      }

      fixture.connection.raw.exec(`CREATE TRIGGER fail_child_admission
        BEFORE INSERT ON delegated_run
        BEGIN SELECT RAISE(ABORT, 'injected child admission failure'); END;`);
      const rejected = await fixture.callTool({
        id: 'failed-admission',
        tool: 'agent_run',
        input: { agentId: 'agent-background', task: 'Inspect the current changes' },
      });
      expect(rejected.ok).toBe(false);
      expect(executeSpy).not.toHaveBeenCalled();
      expect(fixture.harness.demoRuns.size).toBe(1);
      expect(fixture.harness.demoRuns.get(fixture.runId)?.delegationChildCount ?? 0).toBe(0);
      expect(
        fixture.connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'run.started'")
          .get(),
      ).toEqual({ count: 0 });
      fixture.connection.raw.exec('DROP TRIGGER fail_child_admission');
      const result = await Promise.race([
        fixture.callTool({
          id: 'call-agent-run-background',
          tool: 'agent_run',
          input: {
            agentId: 'agent-background',
            task: 'Inspect the current changes',
          },
          signal: parentCall.signal,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('agent_run did not return immediately')), 500),
        ),
      ]);

      expect(result.ok).toBe(true);
      expect(JSON.parse(result.content!)).toMatchObject({
        ok: true,
        status: 'running',
        assignment: { kind: 'existing', agentId: 'agent-background' },
        timeoutPolicy: { idleSeconds: 1_800, absoluteSeconds: 7_200 },
      });
      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(fixture.harness.demoRuns.get(fixture.runId)?.delegationChildCount).toBe(1);
      const childRunId = String(JSON.parse(result.content!).childRunId);
      const durable = new SqliteDelegatedRunStore(fixture.connection.raw).get(childRunId);
      expect(durable).toMatchObject({
        childRunId,
        parentRunId: fixture.runId,
        agentId: 'agent-background',
        status: 'running',
      });
      const childEvents = new SqliteEventCheckpointStore(fixture.connection.raw).listEventsByRun(
        childRunId as RunId,
      );
      expect(
        childEvents.find((event) => event.sequence === durable?.sequence)?.payload.delegatedRun,
      ).toMatchObject({ childRunId, parentRunId: fixture.runId, status: 'running' });
      parentCall.abort();
      expect(fixture.harness.demoRuns.has(childRunId)).toBe(true);
    } finally {
      releaseChild();
      await Promise.resolve();
      executeSpy.mockRestore();
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

  it.each(['ask', 'workspace', 'full-access'] as const)(
    'keeps agent-library writes outside the external catalog in %s mode',
    async (mode) => {
      const fixture = await createFixture(mode);
      try {
        for (const tool of ['create_agent', 'update_agent', 'archive_agent']) {
          const call = {
            id: `unsupported-${tool}`,
            tool,
            input: { name: 'Agent', defaultModelId: 'fake-mini' },
          };
          const first = await fixture.callTool(call);
          expect(first.ok).toBe(false);
          expect(first.error).toContain('unknown platform tool');
          expect(await fixture.callTool(call)).toEqual(first);
        }
        expect(fixture.harness.activeToolApprovals.size).toBe(0);
        expect(fixture.globalAgentStore.list()).toEqual([]);
      } finally {
        fixture.connection.raw.close();
      }
    },
  );

  it('exposes delegated status as a read-only platform query', async () => {
    const fixture = await createFixture('workspace');
    try {
      const result = await fixture.callTool({ id: 'status', tool: 'agent_run_status', input: {} });
      expect(result.ok).toBe(true);
      expect(JSON.parse(result.content!)).toMatchObject({ ok: true, total: 0, tasks: [] });
      expect(fixture.harness.activeToolApprovals.size).toBe(0);
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
});
