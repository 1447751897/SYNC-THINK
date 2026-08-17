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

interface AskHarness {
  demoRuns: Map<string, DemoRunState>;
  platformMcpCatalogByRun: Map<string, unknown>;
  pendingAsks: Map<
    string,
    { resolve(result: { ok: boolean; content?: string; error?: string }): void; onAbort(): void }
  >;
  handlePlatformMcpToolCall(
    runId: RunId,
    run: DemoRunState,
    workspaceRoot: string,
    call: PlatformMcpToolCall,
  ): Promise<{ ok: boolean; content?: string; error?: string }>;
}

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-ask-tool-'));
  tempDirs.push(root);
  const dbPath = join(root, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const workspaceId = 'workspace-ask-tool' as WorkspaceId;
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const taskPlanStore = new SqliteTaskPlanStore(connection.raw);
  const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
  const unitOfWork = new SqliteUnitOfWork(connection.raw);
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: 'Ask tool',
    folderPath: root,
    allowedRoots: [root],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: 'Ask tool',
    goal: 'Exercise ask_user_question',
  });
  conversationStore.create({
    target: { track: 'model', modelId: 'fake-mini' as ModelId },
    workspaceId,
    title: 'Ask tool',
  });
  conversationStore.bindTask(conversationStore.list()[0]!.id, task.taskId);

  const runtime = new Runtime({
    installId: `ask-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    allowNoToken: true,
    stateStore,
    workspaceStore,
    conversationStore,
    taskPlanStore,
    globalAgentStore,
    unitOfWork,
    workspaceId,
    checkpointRunId: 'runtime-ask-tool' as RunId,
  });
  const runId = `run-ask-tool-${Date.now()}` as RunId;
  const run = createDemoRun(runId, task.threadId, 'kernel prompt', {
    kernelId: 'native',
    modelId: 'fake-mini',
    providerModelId: 'fake-mini',
    useFakeProvider: false,
  });
  const harness = runtime as unknown as AskHarness;
  harness.demoRuns.set(runId, run);
  harness.platformMcpCatalogByRun.set(runId, buildPlatformMcpToolDefinitions({}));

  const callTool = (call: Omit<PlatformMcpToolCall, 'signal'> & { signal?: AbortSignal }) =>
    harness.handlePlatformMcpToolCall(runId, run, root, {
      ...call,
      signal: call.signal ?? new AbortController().signal,
    });

  const waitForAsk = async (): Promise<string> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const askId = [...harness.pendingAsks.keys()][0];
      if (askId) return askId;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('no pending ask was raised');
  };

  return { callTool, connection, harness, root, runId, waitForAsk };
}

describe('ask_user_question platform tool', () => {
  it('is in the catalog and plan_submit is back for planning-mode submissions (§12.18)', () => {
    const definitions = buildPlatformMcpToolDefinitions({});
    const names = definitions.map((definition) => definition.name);
    expect(names).toContain('ask_user_question');
    expect(names).toContain('plan_submit');
    // 规划模式目录同时保留 ask（中途问询）与 plan_submit（最终方案提交）。
    const planning = buildPlatformMcpToolDefinitions({ planningMode: true });
    expect(planning.map((definition) => definition.name)).toContain('ask_user_question');
    expect(planning.map((definition) => definition.name)).toContain('plan_submit');
  });

  it('pends the tool call and resolves with the user answer', async () => {
    const fixture = await createFixture();
    try {
      const pending = fixture.callTool({
        id: 'call-ask-1',
        tool: 'ask_user_question',
        input: {
          questions: [
            {
              id: 'q1',
              question: '继续吗？',
              options: [{ label: '继续' }, { label: '停止' }],
            },
          ],
        },
      });
      const askId = await fixture.waitForAsk();
      const entry = fixture.harness.pendingAsks.get(askId);
      expect(entry).toBeTruthy();
      const result = pending.then((value) => value);
      // 模拟 conversation.ask.answer 命令 handler：先删注册表，再 resolve 回填。
      fixture.harness.pendingAsks.delete(askId);
      entry!.resolve({ ok: true, content: JSON.stringify({ answers: [{ id: 'q1', selected: ['继续'] }] }) });
      const settled = await result;
      expect(settled.ok).toBe(true);
      expect(settled.content).toContain('"selected":["继续"]');
      expect(fixture.harness.pendingAsks.has(askId)).toBe(false);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('cancels the tool call when the run aborts', async () => {
    const fixture = await createFixture();
    try {
      const abort = new AbortController();
      const pending = fixture.callTool({
        id: 'call-ask-2',
        tool: 'ask_user_question',
        input: { questions: [{ id: 'q1', question: '继续吗？' }] },
        signal: abort.signal,
      });
      const askId = await fixture.waitForAsk();
      abort.abort();
      const settled = await pending;
      expect(settled.ok).toBe(false);
      expect(settled.error).toContain('cancelled');
      expect(fixture.harness.pendingAsks.has(askId)).toBe(false);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('rejects malformed question structures', async () => {
    const fixture = await createFixture();
    try {
      const settled = await fixture.callTool({
        id: 'call-ask-3',
        tool: 'ask_user_question',
        input: { questions: [{ question: '缺少 id' }] },
      });
      expect(settled.ok).toBe(false);
      expect(settled.error).toContain('invalid questions');
      expect(fixture.harness.pendingAsks.size).toBe(0);
    } finally {
      fixture.connection.raw.close();
    }
  });
});
