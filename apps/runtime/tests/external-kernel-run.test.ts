import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type {
  KernelAdapter,
  KernelEvent,
  KernelPermissionDecision,
  KernelPermissionRequest,
  KernelRequest,
  KernelUsage,
  Message,
  MessageId,
  ModelId,
  RunId,
  ThreadId,
  WorkspaceId,
} from '@sync-think/shared';
import { createDemoRun, type DemoRunState } from '../src/demo-run.js';
import type { PlatformMcpToolCall } from '../src/kernel/mcp-broker.js';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class FixtureKernelAdapter implements KernelAdapter {
  readonly id = 'fixture-kernel';
  readonly name = 'Fixture Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };

  constructor(private readonly events: readonly KernelEvent[]) {}

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(_request: KernelRequest): AsyncIterable<KernelEvent> {
    yield* this.events;
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

class AttemptKernelAdapter implements KernelAdapter {
  readonly id = 'fixture-kernel';
  readonly name = 'Attempt Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  readonly requests: KernelRequest[] = [];

  constructor(private readonly attempts: readonly (readonly KernelEvent[])[]) {}

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    this.requests.push(request);
    yield* this.attempts[this.requests.length - 1] ?? [];
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

class ExitDiagnosticKernelAdapter implements KernelAdapter {
  readonly id = 'fixture-kernel';
  readonly name = 'Fixture Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };

  private readonly exitCallbacks: Array<(code: number | null, stderrTail: string) => void> = [];

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(_request: KernelRequest): AsyncIterable<KernelEvent> {
    this.exitCallbacks.forEach((callback) =>
      callback(23, 'fixture kernel stderr: api_key=[REDACTED]'),
    );
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(callback: (code: number | null, stderrTail: string) => void): void {
    this.exitCallbacks.push(callback);
  }
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

class CapturingKernelAdapter implements KernelAdapter {
  readonly name = 'Capturing Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  readonly requests: KernelRequest[] = [];
  stopCalls = 0;

  constructor(
    readonly id: 'codex' | 'claude-code',
    private readonly events: readonly KernelEvent[],
  ) {}

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    this.requests.push(request);
    yield* this.events;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

class RequestSessionKernelAdapter implements KernelAdapter {
  readonly id = 'claude-code';
  readonly name = 'Request Session Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['anthropic-messages' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'turn' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  readonly requests: KernelRequest[] = [];

  constructor(
    private readonly terminal: Extract<KernelEvent, { type: 'terminal' }>,
    private readonly reportSession = true,
  ) {}

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    this.requests.push(request);
    if (this.reportSession && request.session?.id) {
      yield { type: 'session-started', sessionId: request.session.id };
    }
    yield this.terminal;
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

class DeferredKernelAdapter implements KernelAdapter {
  readonly name = 'Deferred Kernel';
  readonly icon = 'fixture';
  readonly knownGoodVersions = ['1.0.0'];
  readonly capabilities = {
    protocols: ['openai-responses' as const],
    permission: 'own' as const,
    permissionBridge: false,
    pause: 'session' as const,
    compress: 'own' as const,
    usageReport: true,
  };
  readonly requests: KernelRequest[] = [];
  readonly started: Promise<void>;
  readonly cancelled: Promise<void>;
  cancelCalls = 0;

  private resolveStarted!: () => void;
  private resolveCancelled!: () => void;
  private resolveRelease!: () => void;
  private readonly released: Promise<void>;
  private wasCancelled = false;

  constructor(
    readonly id: 'codex' | 'claude-code',
    private readonly sessionId?: string,
  ) {
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.cancelled = new Promise((resolve) => {
      this.resolveCancelled = resolve;
    });
    this.released = new Promise((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  async detectVersion(): Promise<string | null> {
    return '1.0.0';
  }

  async *start(request: KernelRequest): AsyncIterable<KernelEvent> {
    this.requests.push(request);
    this.wasCancelled = false;
    if (this.sessionId) {
      yield { type: 'session-started', sessionId: this.sessionId };
    }
    this.resolveStarted();
    await this.released;
    if (!this.wasCancelled) {
      yield { type: 'terminal', status: 'completed' };
    }
  }

  release(): void {
    this.resolveRelease();
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {
    this.cancelCalls += 1;
    this.wasCancelled = true;
    this.resolveCancelled();
    this.release();
  }
  onExit(_callback: (code: number | null, stderrTail: string) => void): void {}
  onPermissionRequest(_callback: (request: KernelPermissionRequest) => void): void {}
  respondPermission(_requestId: string, _decision: KernelPermissionDecision): void {}
  onUsage(_callback: (usage: KernelUsage) => void): void {}
}

interface RuntimeExternalKernelHarness {
  demoRuns: Map<string, DemoRunState>;
  demoRunAborts: Map<string, AbortController>;
  transientReplay: Array<{ kind: string; textDelta?: string }>;
  openGateway: {
    tickets: {
      recordContinuationItem(scopeId: string, callId: string, responseId: string): void;
      resolveContinuationItem(scopeId: string, callId: string): string | undefined;
      recordRunUsage(
        runId: string,
        usage: {
          requestId: string;
          providerResponseId?: string;
          providerId?: string;
          providerModelId: string;
          tokensIn: number;
          tokensOut: number;
          cachedTokensHit?: number;
          cachedTokensCreated?: number;
          reasoningTokens?: number;
          totalTokens: number;
        },
      ): void;
      consumeRunUsage(runId: string): Array<{
        requestId: string;
        providerResponseId?: string;
        providerId?: string;
        providerModelId: string;
        tokensIn: number;
        tokensOut: number;
        cachedTokensHit?: number;
        cachedTokensCreated?: number;
        reasoningTokens?: number;
        totalTokens: number;
      }>;
      clear(): void;
    };
  };
  executeExternalKernelRun(runId: RunId): Promise<void>;
  handlePlanSubmitToolCall(
    runId: RunId,
    run: DemoRunState,
    call: PlatformMcpToolCall,
    argumentsJson: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }>;
  buildKernelRequestForRun(run: DemoRunState, runId?: RunId): Promise<KernelRequest>;
  clearKernelConversationSession(run: DemoRunState, expectedSessionId?: string): void;
  clearKernelConversationSessionByKey(
    kernelId: 'claude-code' | 'codex',
    key: string,
    expectedSessionId?: string,
  ): void;
}

async function waitForPromise<T>(promise: Promise<T>, timeoutMs = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for test signal')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function createControlledRuntime(
  adapters: DeferredKernelAdapter[],
  threadIds: readonly ThreadId[],
) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-kernel-session-queue-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  for (const threadId of threadIds) {
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, `task-${threadId}`, '2026-08-14T00:00:00.000Z');
  }
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const appSettingStore = new SqliteAppSettingStore(connection.raw);
  let adapterIndex = 0;
  const runtime = new Runtime({
    installId: `kernel-session-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    allowNoToken: true,
    stateStore,
    messageStore,
    appSettingStore,
    workspaceId: 'workspace-kernel-session-queue' as WorkspaceId,
    kernelAdapterResolver: () => adapters[adapterIndex++],
  }) as unknown as RuntimeExternalKernelHarness;
  return { connection, runtime };
}

function createCodexRun(runId: RunId, threadId: ThreadId, userText: string): DemoRunState {
  return createDemoRun(runId, threadId, userText, {
    kernelId: 'codex',
    modelId: 'gpt-5',
    providerModelId: 'gpt-5',
    useFakeProvider: false,
  });
}

async function createFixture(events: readonly KernelEvent[], adapterOverride?: KernelAdapter) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-external-kernel-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, `task-${threadId}`, '2026-08-14T00:00:00.000Z');
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const adapter = adapterOverride ?? new FixtureKernelAdapter(events);
  const runtime = new Runtime({
    installId: `external-kernel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    allowNoToken: true,
    stateStore,
    messageStore,
    workspaceId: 'workspace-external-kernel' as WorkspaceId,
    kernelAdapterResolver: () => adapter,
    modelRetryBaseDelayMs: 0,
  });
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2)}` as RunId;
  const run = createDemoRun(runId, threadId, 'fixture prompt', {
    kernelId: adapter.id,
    modelId: 'fixture-model',
    providerModelId: 'fixture-model',
    useFakeProvider: false,
  });
  const harness = runtime as unknown as RuntimeExternalKernelHarness;
  harness.demoRuns.set(runId, run);
  return { adapter, connection, harness, messageStore, runId, stateStore, threadId };
}

async function createPlanningFixture(events: readonly KernelEvent[]) {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-external-kernel-plan-'));
  tempDirs.push(root);
  const dbPath = join(root, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const workspaceId = `workspace-plan-${Date.now()}` as WorkspaceId;
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: 'External kernel planning fixture',
    folderPath: root,
    allowedRoots: [root],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: 'Planning fixture',
    goal: 'Verify formal plan submission',
  });
  const conversation = conversationStore.create({
    target: { track: 'model', modelId: 'gpt-5' as ModelId },
    workspaceId,
    title: 'Planning fixture',
    interactionMode: 'plan',
  });
  conversationStore.bindTask(conversation.id, task.taskId);
  const adapter = new CapturingKernelAdapter('codex', events);
  const runtime = new Runtime({
    installId: `external-kernel-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    allowNoToken: true,
    stateStore,
    messageStore,
    workspaceStore,
    conversationStore,
    workspaceId,
    kernelAdapterResolver: () => adapter,
  });
  const runId = `run-plan-${Date.now()}-${Math.random().toString(36).slice(2)}` as RunId;
  const run = createDemoRun(runId, task.threadId, 'Create a formal plan', {
    kernelId: 'codex',
    modelId: 'gpt-5',
    providerModelId: 'gpt-5',
    useFakeProvider: false,
    planningMode: true,
  });
  const harness = runtime as unknown as RuntimeExternalKernelHarness;
  harness.demoRuns.set(runId, run);
  return {
    connection,
    conversation,
    conversationStore,
    harness,
    messageStore,
    root,
    run,
    runId,
    stateStore,
    workspaceId,
    workspaceStore,
  };
}

function assistantMessage(messages: Message[]): Message | undefined {
  return messages.find((message) => message.role === 'assistant');
}

describe('Runtime external kernel finalization', () => {
  it('persists one formal plan revision before completing a planning run', async () => {
    const fixture = await createPlanningFixture([
      { type: 'plan-submitted', text: '# 实施方案\n\n1. 读取现状\n2. 完成验证' },
      { type: 'plan-submitted', text: '# 重复方案\n\n1. 不应创建第二版' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const events = fixture.stateStore.listEventsByRun(fixture.runId);
      expect(events.filter((event) => event.type === 'conversation.plan_submitted')).toHaveLength(1);
      expect(events.at(-1)?.type).toBe('run.completed');
      expect(fixture.conversationStore.getConversationPlan(fixture.conversation.id)).toMatchObject({
        currentRevision: 1,
        state: 'draft',
      });
      expect(fixture.conversationStore.get(fixture.conversation.id)?.interactionMode).toBe('plan');
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('fails a completed planning run that only produced progress and ordinary prose', async () => {
    const fixture = await createPlanningFixture([
      {
        type: 'tool-call',
        toolId: 'plan-progress-only',
        name: 'update_task_plan',
        argsJson: JSON.stringify({
          plan: [{ id: 'step-1', title: '分析问题', status: 'completed' }],
        }),
        partial: false,
      },
      {
        type: 'tool-result',
        toolId: 'plan-progress-only',
        output: JSON.stringify({ ok: true }),
        isError: false,
      },
      { type: 'delta', text: '方案已经创建完成。', final: true },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const events = fixture.stateStore.listEventsByRun(fixture.runId);
      expect(events.filter((event) => event.type === 'conversation.plan_submitted')).toHaveLength(0);
      expect(events.filter((event) => event.type === 'run.completed')).toHaveLength(0);
      expect(events.at(-1)).toMatchObject({
        type: 'run.failed',
        payload: {
          failureClass: 'protocol',
          errorMessage: '规划轮已结束，但没有提交正式方案。请重试 /plan。',
          assistantText: '',
        },
      });
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.run.threadId as never).messages,
      );
      expect(assistant?.blocks).not.toContainEqual({ type: 'text', text: '方案已经创建完成。' });
      expect(fixture.conversationStore.getConversationPlan(fixture.conversation.id)).toBeUndefined();
      expect(fixture.conversationStore.get(fixture.conversation.id)?.interactionMode).toBe('plan');
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('deduplicates platform and canonical plan submissions within the same run', async () => {
    const fixture = await createPlanningFixture([
      { type: 'plan-submitted', text: '# Canonical 方案\n\n1. 不应新增 revision' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      const platformResult = await fixture.harness.handlePlanSubmitToolCall(
        fixture.runId,
        fixture.run,
        {
          id: 'platform-plan-submit',
          tool: 'plan_submit',
          input: {
            title: '平台方案',
            goal: '只提交一次',
            scope: [],
            assumptions: [],
            decisions: [],
            steps: [
              {
                id: 'step-1',
                title: '完成实现',
                description: '',
                acceptanceChecks: ['只有一个 revision'],
              },
            ],
            risks: [],
            finalAcceptanceChecks: [],
          },
          signal: new AbortController().signal,
        },
        '{}',
      );
      expect(platformResult.ok).toBe(true);

      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const events = fixture.stateStore.listEventsByRun(fixture.runId);
      expect(events.filter((event) => event.type === 'conversation.plan_submitted')).toHaveLength(1);
      expect(events.at(-1)?.type).toBe('run.completed');
      expect(fixture.conversationStore.getConversationPlan(fixture.conversation.id)).toMatchObject({
        currentRevision: 1,
      });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('deduplicates a persisted plan submission after Runtime recovery', async () => {
    const fixture = await createPlanningFixture([]);
    const firstSubmission = await fixture.harness.handlePlanSubmitToolCall(
      fixture.runId,
      fixture.run,
      {
        id: 'platform-plan-before-recovery',
        tool: 'plan_submit',
        input: {
          title: '恢复前方案',
          goal: '恢复后仍只保留一个 revision',
          scope: [],
          assumptions: [],
          decisions: [],
          steps: [
            {
              id: 'step-1',
              title: '完成实现',
              description: '',
              acceptanceChecks: ['只有一个 revision'],
            },
          ],
          risks: [],
          finalAcceptanceChecks: [],
        },
        signal: new AbortController().signal,
      },
      '{}',
    );
    expect(firstSubmission.ok).toBe(true);

    const recoveredAdapter = new CapturingKernelAdapter('codex', [
      { type: 'plan-submitted', text: '# Canonical 重放\n\n1. 不应新增 revision' },
      { type: 'terminal', status: 'completed' },
    ]);
    const recoveredRuntime = new Runtime({
      installId: `external-kernel-plan-recovery-${Date.now()}`,
      allowNoToken: true,
      stateStore: fixture.stateStore,
      messageStore: fixture.messageStore,
      workspaceStore: fixture.workspaceStore,
      conversationStore: fixture.conversationStore,
      workspaceId: fixture.workspaceId,
      kernelAdapterResolver: () => recoveredAdapter,
    });
    const recoveredHarness = recoveredRuntime as unknown as RuntimeExternalKernelHarness;
    recoveredHarness.demoRuns.set(fixture.runId, fixture.run);
    try {
      await recoveredRuntime.start();
      await recoveredHarness.executeExternalKernelRun(fixture.runId);

      const events = fixture.stateStore.listEventsByRun(fixture.runId);
      expect(events.filter((event) => event.type === 'conversation.plan_submitted')).toHaveLength(1);
      expect(events.at(-1)?.type).toBe('run.completed');
      expect(fixture.conversationStore.getConversationPlan(fixture.conversation.id)).toMatchObject({
        currentRevision: 1,
      });
    } finally {
      await recoveredRuntime.stop();
      fixture.connection.raw.close();
    }
  });

  it('rejects plan_submit outside a planning run', async () => {
    const fixture = await createPlanningFixture([]);
    try {
      fixture.conversationStore.setInteractionMode(fixture.conversation.id, 'execute');
      const result = await fixture.harness.handlePlanSubmitToolCall(
        fixture.runId,
        { ...fixture.run, planningMode: false },
        {
          id: 'execute-mode-plan-submit',
          tool: 'plan_submit',
          input: {
            title: '不应提交的方案',
            steps: [{ id: 'step-1', title: '不应创建', description: '' }],
          },
          signal: new AbortController().signal,
        },
        '{}',
      );

      expect(result).toEqual({
        ok: false,
        error: 'plan_submit is only available during a planning run',
      });
      expect(
        fixture.stateStore
          .listEventsByRun(fixture.runId)
          .filter((event) => event.type === 'conversation.plan_submitted'),
      ).toHaveLength(0);
      expect(fixture.conversationStore.getConversationPlan(fixture.conversation.id)).toBeUndefined();
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('treats a deleted workspace folder as unbound so external kernels can still start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-kernel-missing-workspace-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({
      name: 'Moved project',
      folderPath: join(dir, 'folder-that-no-longer-exists'),
    });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Continue without stale cwd',
      goal: 'Keep the conversation usable',
    });
    const adapter = new CapturingKernelAdapter('claude-code', [
      { type: 'terminal', status: 'completed' },
    ]);
    const runtime = new Runtime({
      installId: `missing-workspace-${Date.now()}`,
      allowNoToken: true,
      stateStore: new SqliteEventCheckpointStore(connection.raw),
      messageStore: new SqliteMessageStore(connection.raw),
      workspaceStore,
      workspaceId: workspace.id,
      kernelAdapterResolver: () => adapter,
    }) as unknown as RuntimeExternalKernelHarness;
    const runId = 'run-missing-workspace' as RunId;
    runtime.demoRuns.set(
      runId,
      createDemoRun(runId, task.threadId, 'answer without project files', {
        kernelId: 'claude-code',
        modelId: 'claude-sonnet-4-5',
        providerModelId: 'claude-sonnet-4-5',
        useFakeProvider: false,
      }),
    );

    try {
      await runtime.executeExternalKernelRun(runId);
      expect(adapter.requests).toHaveLength(1);
      expect(adapter.requests[0]?.workspaceDir).toBe(process.cwd());
      expect(adapter.requests[0]?.systemContext).toContain(
        'No project folder is bound for this conversation.',
      );
      expect(adapter.requests[0]?.systemContext).not.toContain(
        'mcp__sync-think-platform__update_task_plan',
      );
      expect(adapter.requests[0]?.systemContext).toContain('Use Claude Code native task tools for multi-step work');
      expect(adapter.requests[0]?.systemContext).toContain('TaskCreate (subject, description)');
    } finally {
      connection.raw.close();
    }
  });

  it('retries a 503 and continues the same run on its configured fallback model', async () => {
    const serviceUnavailable: KernelEvent = {
      type: 'terminal',
      status: 'failed',
      error:
        'unexpected status 503 Service Unavailable: Service temporarily unavailable, url: https://provider.example/responses',
    };
    const adapter = new AttemptKernelAdapter([
      [serviceUnavailable],
      [
        { type: 'delta', text: 'fallback recovered' },
        { type: 'terminal', status: 'completed' },
      ],
    ]);
    const fixture = await createFixture([], adapter);
    try {
      const run = fixture.harness.demoRuns.get(fixture.runId)!;
      fixture.harness.demoRuns.set(fixture.runId, {
        ...run,
        fallbackModelIds: ['fallback-model'],
      });

      await fixture.harness.executeExternalKernelRun(fixture.runId);

      expect(adapter.requests.map((request) => request.model)).toEqual([
        'fixture-model',
        'fallback-model',
      ]);
      const events = fixture.stateStore.listEventsByRun(fixture.runId);
      expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(0);
      expect(events.filter((event) => event.type === 'run.fallback.selected')).toHaveLength(1);
      expect(events.at(-1)?.type).toBe('run.completed');
      expect(events.at(-1)?.payload).toMatchObject({
        assistantText: 'fallback recovered',
        providerModelId: 'fallback-model',
      });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('persists the latest streamed text in the terminal event and final message', async () => {
    const fixture = await createFixture([
      { type: 'delta', text: 'hello ' },
      { type: 'delta', text: 'kernel' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const terminal = fixture.stateStore
        .listEventsByRun(fixture.runId)
        .find((event) => event.type === 'run.completed');
      expect(terminal?.payload).toMatchObject({ assistantText: 'hello kernel' });
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      expect(assistant?.id).toBe(`asst-${fixture.runId}`);
      expect(assistant?.blocks.map((block) => block.type)).toEqual(['commentary', 'text']);
      expect(assistant?.blocks[0]?.payload).toMatchObject({
        assistantTimeline: [
          expect.objectContaining({
            kind: 'text',
            phase: 'final_answer',
            text: 'hello kernel',
            status: 'completed',
          }),
        ],
      });
      expect(assistant?.blocks[1]).toEqual({ type: 'text', text: 'hello kernel' });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('replays the terminally classified kernel answer through the transient stream', async () => {
    const fixture = await createFixture([
      { type: 'reasoning', text: 'think first' },
      { type: 'delta', text: 'hello ' },
      { type: 'delta', text: 'kernel' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const textFrames = fixture.harness.transientReplay.filter((frame) => frame.kind === 'text');
      expect(textFrames.map((frame) => frame.textDelta)).toEqual(['hello kernel']);
      const terminalIndex = fixture.harness.transientReplay.findIndex(
        (frame) => frame.kind === 'terminal',
      );
      const textIndex = fixture.harness.transientReplay.findIndex((frame) => frame.kind === 'text');
      expect(textIndex).toBeGreaterThanOrEqual(0);
      expect(textIndex).toBeLessThan(terminalIndex);
      expect(
        fixture.harness.transientReplay.some(
          (frame) => frame.kind === 'commentary' && Boolean(frame.textDelta),
        ),
      ).toBe(false);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('flushes buffered kernel prose before the next reasoning section', async () => {
    const fixture = await createFixture([
      { type: 'reasoning', text: 'first thought' },
      { type: 'delta', text: 'progress update' },
      { type: 'reasoning', text: 'second thought' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const snapshots = fixture.harness.transientReplay
        .map((frame) => frame.assistantTimeline)
        .filter((timeline): timeline is NonNullable<typeof timeline> => Boolean(timeline?.length));
      const textBeforeSecondThinking = snapshots.find((timeline) => {
        const textIndex = timeline.findIndex(
          (segment) => segment.kind === 'text' && segment.phase === 'commentary',
        );
        const secondThinkingIndex = timeline.findIndex(
          (segment) => segment.kind === 'thinking' && segment.text === 'second thought',
        );
        return textIndex >= 0 && secondThinkingIndex >= 0 && textIndex < secondThinkingIndex;
      });

      expect(textBeforeSecondThinking).toBeDefined();
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('renders Codex reasoning summary sections as separate process rows', async () => {
    const fixture = await createFixture([
      { type: 'reasoning', text: 'Planning login layout' },
      { type: 'reasoning', text: '\n\n', boundary: true },
      { type: 'reasoning', text: 'Reviewing interaction states' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      const metadata = assistant?.blocks.find((block) => block.type === 'commentary') as
        { payload?: { assistantTimeline?: Array<Record<string, unknown>> } } | undefined;
      expect(metadata?.payload?.assistantTimeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'thinking', text: 'Planning login layout' }),
          expect.objectContaining({ kind: 'thinking', text: 'Reviewing interaction states' }),
        ]),
      );
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('keeps reasoning and commentary when a tool result contains an embedded image', async () => {
    const fixture = await createFixture([
      { type: 'reasoning', text: 'inspect resources' },
      { type: 'delta', text: '我先检查资源。' },
      {
        type: 'tool-call',
        toolId: 'tool-image-source',
        name: 'command_execution',
        argsJson: '{"command":"search source"}',
      },
      {
        type: 'tool-result',
        toolId: 'tool-image-source',
        output: 'const icon = `data:image/png;base64,' + 'A'.repeat(300_000) + '`;',
      },
      { type: 'delta', text: '最终结论。' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      const serialized = JSON.stringify(assistant?.blocks ?? []);
      const metadata = assistant?.blocks.find((block) => block.type === 'commentary') as
        { payload?: { assistantTimeline?: Array<Record<string, unknown>> } } | undefined;

      expect(serialized).not.toMatch(/data:image\//i);
      expect(serialized).toContain('embedded image omitted');
      expect(metadata?.payload?.assistantTimeline).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'thinking', text: 'inspect resources' }),
          expect.objectContaining({ kind: 'text', phase: 'commentary', text: '我先检查资源。' }),
          expect.objectContaining({ kind: 'tool', toolCallId: 'tool-image-source' }),
          expect.objectContaining({ kind: 'text', phase: 'final_answer', text: '最终结论。' }),
        ]),
      );
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('fails an EOF without terminal while retaining partial streamed text', async () => {
    const fixture = await createFixture([{ type: 'delta', text: 'partial kernel output' }]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const terminal = fixture.stateStore
        .listEventsByRun(fixture.runId)
        .find((event) => event.type === 'run.failed');
      expect(terminal?.payload).toMatchObject({
        assistantText: 'partial kernel output',
        errorMessage: 'kernel process ended before a terminal event',
      });
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      expect(assistant?.blocks.map((block) => block.type)).toEqual(['commentary', 'text', 'error']);
      expect(assistant?.blocks[0]?.payload).toMatchObject({
        assistantTimeline: [
          expect.objectContaining({
            kind: 'text',
            phase: 'final_answer',
            text: 'partial kernel output',
          }),
        ],
      });
      expect(assistant?.blocks[1]).toEqual({ type: 'text', text: 'partial kernel output' });
      expect(assistant?.blocks[2]).toEqual(
        expect.objectContaining({
          type: 'error',
          payload: expect.objectContaining({ terminalState: 'failed' }),
        }),
      );
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('uses adapter exit diagnostics when the event stream ends without a terminal', async () => {
    const fixture = await createFixture([], new ExitDiagnosticKernelAdapter());
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const terminal = fixture.stateStore
        .listEventsByRun(fixture.runId)
        .find((event) => event.type === 'run.failed');
      expect(terminal?.payload).toMatchObject({
        errorMessage:
          'Fixture Kernel exited with code 23: fixture kernel stderr: api_key=[REDACTED]',
      });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('projects kernel reasoning, compaction and usage without polluting chat text', async () => {
    const fixture = await createFixture([
      { type: 'reasoning', text: 'internal plan' },
      { type: 'delta', text: 'visible answer' },
      { type: 'compaction-started' },
      { type: 'compacted' },
      {
        type: 'usage',
        usage: {
          real: 150,
          window: 200_000,
          input: 100,
          output: 50,
          cached: 40,
          cachedTokensCreated: 12,
          reasoningTokens: 9,
          requestId: 'kernel-provider-request-1',
          providerResponseId: 'provider-response-1',
        },
      },
      {
        type: 'usage',
        usage: {
          real: 150,
          window: 200_000,
          input: 100,
          output: 50,
          cached: 40,
          cachedTokensCreated: 12,
          reasoningTokens: 9,
          requestId: 'kernel-provider-request-1',
          providerResponseId: 'provider-response-1',
        },
      },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);
      const events = fixture.stateStore.listEventsByRun(fixture.runId);

      // Ordered metadata preserves reasoning -> answer -> compaction exactly;
      // compatibility blocks follow the same visible order without emitting a
      // provider-context block for the status row.
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      expect(assistant?.blocks.map((block) => block.type)).toEqual([
        'commentary',
        'reasoning',
        'text',
      ]);
      expect(assistant?.blocks[0]?.payload).toMatchObject({
        assistantTimeline: [
          expect.objectContaining({ kind: 'thinking', text: 'internal plan' }),
          expect.objectContaining({ kind: 'text', phase: 'final_answer', text: 'visible answer' }),
          expect.objectContaining({
            kind: 'status',
            statusType: 'compaction',
            label: '正在压缩上下文',
          }),
          expect.objectContaining({
            kind: 'status',
            statusType: 'compaction',
            label: '上下文压缩成功',
          }),
        ],
      });
      expect(assistant?.blocks[1]).toEqual({ type: 'reasoning', reasoningText: 'internal plan' });
      expect(assistant?.blocks[2]).toEqual({ type: 'text', text: 'visible answer' });

      // The kernel compacted its own context; the host records a kernel-scoped
      // boundary and never the native context.compacted truncation marker.
      expect(events.some((event) => event.type === 'kernel.context_compaction_started')).toBe(true);
      expect(events.some((event) => event.type === 'kernel.context_compacted')).toBe(true);
      expect(events.some((event) => event.type === 'context.compacted')).toBe(false);

      // Progressive usage reports for the same provider request retain one
      // stable id; the usage projection takes the maximum counters.
      const usageRequestIds = events
        .filter((event) => event.type === 'provider.usage')
        .map((event) => event.payload.requestId);
      expect(usageRequestIds).toHaveLength(2);
      expect(new Set(usageRequestIds).size).toBe(1);
      const usage = events.find((event) => event.type === 'provider.usage');
      expect(usage?.payload).toMatchObject({
        requestId: 'kernel-provider-request-1',
        providerResponseId: 'provider-response-1',
        cachedTokensHit: 40,
        cachedTokensCreated: 12,
        reasoningTokens: 9,
      });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('persists kernel occupancy separately from billed provider usage', async () => {
    const fixture = await createFixture([
      {
        type: 'usage',
        usage: {
          real: 43_364,
          window: 372_000,
          input: 39_585,
          output: 3_779,
          cached: 38_528,
          requestId: 'kernel-provider-request-occupancy',
        },
      },
      {
        type: 'context-occupancy',
        usedTokens: 57_234,
        windowTokens: 200_000,
        categories: [
          { name: 'System prompt', tokens: 12_000 },
          { name: 'Messages', tokens: 8_234 },
        ],
      },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);
      const events = fixture.stateStore.listEventsByRun(fixture.runId);
      const occupancy = events.find((event) => event.type === 'kernel.context_occupancy');
      expect(occupancy?.payload).toMatchObject({
        usedTokens: 57_234,
        windowTokens: 200_000,
        categories: [
          { name: 'System prompt', tokens: 12_000 },
          { name: 'Messages', tokens: 8_234 },
        ],
      });
      const usage = events.find((event) => event.type === 'provider.usage');
      expect(usage?.payload).toMatchObject({
        requestId: 'kernel-provider-request-occupancy',
        tokensIn: 39_585,
      });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('prefers gateway provider usage over zero-valued kernel usage', async () => {
    const fixture = await createFixture([
      {
        type: 'usage',
        usage: {
          real: 0,
          window: 200_000,
          input: 0,
          output: 0,
          requestId: 'kernel-synthetic-zero',
        },
      },
      { type: 'delta', text: 'gateway-accounted answer' },
      { type: 'terminal', status: 'completed' },
    ]);
    fixture.harness.openGateway.tickets.recordRunUsage(fixture.runId, {
      requestId: 'gateway-provider-request-1',
      providerResponseId: 'deepseek-response-1',
      providerId: 'deepseek-provider',
      providerModelId: 'deepseek-v4-flash',
      tokensIn: 88,
      tokensOut: 16,
      cachedTokensHit: 24,
      cachedTokensCreated: 4,
      reasoningTokens: 6,
      totalTokens: 104,
    });

    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const usageEvents = fixture.stateStore
        .listEventsByRun(fixture.runId)
        .filter((event) => event.type === 'provider.usage');
      expect(usageEvents).toHaveLength(1);
      expect(usageEvents[0]?.payload).toMatchObject({
        requestId: 'gateway-provider-request-1',
        providerResponseId: 'deepseek-response-1',
        providerId: 'deepseek-provider',
        providerModelId: 'deepseek-v4-flash',
        tokensIn: 88,
        tokensOut: 16,
        cachedTokensHit: 24,
        cachedTokensCreated: 4,
        reasoningTokens: 6,
        totalTokens: 104,
      });
      expect(fixture.harness.openGateway.tickets.consumeRunUsage(fixture.runId)).toEqual([]);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('keeps partial tool calls and failed tool results distinguishable', async () => {
    const fixture = await createFixture([
      {
        type: 'tool-call',
        toolId: 'tool-1',
        name: 'Read',
        argsJson: '{"path":"a"}',
        partial: true,
      },
      { type: 'tool-result', toolId: 'tool-1', output: 'boom', isError: true },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);
      const events = fixture.stateStore.listEventsByRun(fixture.runId);

      const requested = events.find((event) => event.type === 'tool.requested');
      expect(requested?.payload).toMatchObject({
        threadId: fixture.threadId,
        partial: true,
      });
      const completed = events.find((event) => event.type === 'tool.completed');
      expect(completed?.payload).toMatchObject({
        threadId: fixture.threadId,
        result: 'boom',
        failed: true,
      });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('upserts streamed tool arguments without duplicating the assistant timeline row', async () => {
    const fixture = await createFixture([
      {
        type: 'tool-call',
        toolId: 'tool-streamed',
        name: 'Bash',
        argsJson: '{}',
        partial: true,
      },
      {
        type: 'tool-call',
        toolId: 'tool-streamed',
        name: 'Bash',
        argsJson: '{"command":"sleep 1"}',
        partial: false,
      },
      { type: 'tool-result', toolId: 'tool-streamed', output: 'ok', isError: false },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);
      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      const commentary = assistant?.blocks.find((block) => block.type === 'commentary') as
        { payload?: { assistantTimeline?: unknown[] } } | undefined;
      const toolRows = (commentary?.payload?.assistantTimeline ?? []).filter(
        (segment) => (segment as { kind?: string }).kind === 'tool',
      );
      expect(toolRows).toHaveLength(1);
      expect(toolRows[0]).toMatchObject({
        toolCallId: 'tool-streamed',
        argumentsJson: '{"command":"sleep 1"}',
        output: 'ok',
        status: 'completed',
      });
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('reveals a batch-announced tool sequence one-by-one and converges the full timeline', async () => {
    // claude-code announces the whole batch in one assistant message while it
    // executes tools sequentially. The reveal logic must put the first row into
    // the timeline immediately, add each next row when the previous tool's
    // result arrives, and converge to the complete ordered timeline.
    const fixture = await createFixture([
      { type: 'tool-call', toolId: 'tool-1', name: 'Read', argsJson: '{"path":"a"}' },
      { type: 'tool-call', toolId: 'tool-2', name: 'Edit', argsJson: '{"path":"b"}' },
      { type: 'tool-call', toolId: 'tool-3', name: 'Write', argsJson: '{"path":"c"}' },
      { type: 'tool-result', toolId: 'tool-1', output: 'ok-1' },
      { type: 'tool-result', toolId: 'tool-2', output: 'ok-2' },
      { type: 'tool-result', toolId: 'tool-3', output: 'ok-3' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      const commentary = assistant?.blocks.find((block) => block.type === 'commentary') as
        { payload?: { assistantTimeline?: unknown[] } } | undefined;
      const timeline = commentary?.payload?.assistantTimeline ?? [];
      const toolRows = timeline.filter((segment) => (segment as { kind?: string }).kind === 'tool');
      expect(toolRows.map((row) => (row as { toolCallId?: string }).toolCallId)).toEqual([
        'tool-1',
        'tool-2',
        'tool-3',
      ]);
      for (const row of toolRows) {
        expect(row).toMatchObject({ status: 'completed', isError: false });
      }
      // 未执行工具不占位：全部宣布的工具都执行完成时，pending 队列耗尽。
      expect(toolRows).toHaveLength(3);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('defends out-of-order results from a parallel kernel without losing rows', async () => {
    // A parallel kernel may complete a later-announced tool first. The reveal
    // logic must then surface the whole in-flight prefix at once instead of
    // waiting for the earlier result, while converging to the full timeline.
    const fixture = await createFixture([
      { type: 'tool-call', toolId: 'tool-1', name: 'Read', argsJson: '{"path":"a"}' },
      { type: 'tool-call', toolId: 'tool-2', name: 'Edit', argsJson: '{"path":"b"}' },
      { type: 'tool-result', toolId: 'tool-2', output: 'ok-2' },
      { type: 'tool-result', toolId: 'tool-1', output: 'ok-1' },
      { type: 'terminal', status: 'completed' },
    ]);
    try {
      await fixture.harness.executeExternalKernelRun(fixture.runId);

      const assistant = assistantMessage(
        fixture.messageStore.listMessages(fixture.threadId as never).messages,
      );
      const commentary = assistant?.blocks.find((block) => block.type === 'commentary') as
        { payload?: { assistantTimeline?: unknown[] } } | undefined;
      const timeline = commentary?.payload?.assistantTimeline ?? [];
      const toolRows = timeline.filter((segment) => (segment as { kind?: string }).kind === 'tool');
      expect(toolRows.map((row) => (row as { toolCallId?: string }).toolCallId)).toEqual([
        'tool-1',
        'tool-2',
      ]);
      for (const row of toolRows) {
        expect(row).toMatchObject({ status: 'completed' });
      }
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('persists a Claude session only after the adapter reports it and appends context changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-claude-session-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const threadId = 'thread-claude-session' as ThreadId;
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task-claude-session', '2026-08-14T00:00:00.000Z');
    const messageStore = new SqliteMessageStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    try {
      messageStore.appendMessage({
        id: 'message-session-user' as MessageId,
        threadId,
        role: 'user',
        sequence: 0,
        blocks: [{ type: 'text', text: 'remember this context' }],
        createdAt: '2026-08-14T00:00:01.000Z',
      });
      messageStore.appendMessage({
        id: 'message-session-assistant' as MessageId,
        threadId,
        role: 'assistant',
        sequence: 1,
        blocks: [{ type: 'text', text: 'context remembered' }],
        createdAt: '2026-08-14T00:00:02.000Z',
      });

      const makeRun = (runId: RunId, skillBody: string) => {
        const run = createDemoRun(runId, threadId, 'next turn', {
          kernelId: 'claude-code',
          modelId: 'claude-sonnet-4-5',
          providerModelId: 'claude-sonnet-4-5',
          useFakeProvider: false,
        });
        run.persona = 'Keep answers precise.';
        run.skillPromptBlocks = [`### Skill: session-test\n${skillBody}`];
        run.projectContextPromptBlocks = [
          'Project fact: external kernels receive project context.',
        ];
        return run;
      };

      const firstRuntime = new Runtime({
        installId: 'claude-session-first',
        allowNoToken: true,
        messageStore,
        appSettingStore,
      }) as unknown as RuntimeExternalKernelHarness;
      const firstRequest = await firstRuntime.buildKernelRequestForRun(
        makeRun('run-session-first' as RunId, 'SKILL-V1'),
        'run-session-first' as RunId,
      );

      expect(firstRequest.session).toMatchObject({ mode: 'create' });
      expect(firstRequest.systemContext).toContain('SKILL-V1');
      expect(firstRequest.systemContext).toContain('Project fact');
      expect(firstRequest.systemContext).toContain('remember this context');
      expect(firstRequest.systemContext).toContain('context remembered');
      expect(firstRequest.systemContext).toContain('Simplified Chinese');
      expect(firstRequest.systemContext).toContain('thinking/reasoning');
      expect(firstRequest.systemContext).toContain('Do not switch to English');
      expect(firstRequest.systemContext).not.toContain('### User\nnext turn');

      const unestablishedRuntime = new Runtime({
        installId: 'claude-session-unestablished',
        allowNoToken: true,
        messageStore,
        appSettingStore,
      }) as unknown as RuntimeExternalKernelHarness;
      const unestablishedRequest = await unestablishedRuntime.buildKernelRequestForRun(
        makeRun('run-session-unestablished' as RunId, 'SKILL-V1'),
        'run-session-unestablished' as RunId,
      );
      expect(unestablishedRequest.session).toMatchObject({ mode: 'create' });
      expect(unestablishedRequest.session?.id).not.toBe(firstRequest.session?.id);

      const establishedSessionId = 'claude-session-confirmed-by-cli';
      const establishedAdapter = new CapturingKernelAdapter('claude-code', [
        { type: 'session-started', sessionId: establishedSessionId },
        { type: 'terminal', status: 'completed' },
      ]);
      const establishedRuntime = new Runtime({
        installId: 'claude-session-established',
        allowNoToken: true,
        stateStore: new SqliteEventCheckpointStore(connection.raw),
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-claude-session' as WorkspaceId,
        kernelAdapterResolver: () => establishedAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const establishedRunId = 'run-session-established' as RunId;
      establishedRuntime.demoRuns.set(establishedRunId, makeRun(establishedRunId, 'SKILL-V1'));
      await establishedRuntime.executeExternalKernelRun(establishedRunId);

      const resumedRuntime = new Runtime({
        installId: 'claude-session-resumed',
        allowNoToken: true,
        messageStore,
        appSettingStore,
      }) as unknown as RuntimeExternalKernelHarness;
      const resumedRequest = await resumedRuntime.buildKernelRequestForRun(
        makeRun('run-session-resumed' as RunId, 'SKILL-V1'),
        'run-session-resumed' as RunId,
      );
      expect(resumedRequest.session).toEqual({
        id: establishedSessionId,
        mode: 'resume',
      });

      const changedRequest = await resumedRuntime.buildKernelRequestForRun(
        makeRun('run-session-changed' as RunId, 'SKILL-V2'),
        'run-session-changed' as RunId,
      );
      expect(changedRequest.session).toMatchObject({
        id: establishedSessionId,
        mode: 'resume',
      });
      expect(changedRequest.session?.catchUp).toContain('## Host context update');
      expect(changedRequest.session?.catchUp).toContain('SKILL-V2');
    } finally {
      connection.raw.close();
    }
  });

  it('falls back to the requested Claude session id after a successful legacy CLI run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-claude-session-fallback-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const threadId = 'thread-claude-session-fallback' as ThreadId;
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task-claude-session-fallback', '2026-08-14T00:00:00.000Z');
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const messageStore = new SqliteMessageStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const makeRun = (runId: RunId) =>
      createDemoRun(runId, threadId, 'continue the task', {
        kernelId: 'claude-code',
        modelId: 'claude-sonnet-4-5',
        providerModelId: 'claude-sonnet-4-5',
        useFakeProvider: false,
      });

    try {
      const adapter = new RequestSessionKernelAdapter(
        { type: 'terminal', status: 'completed' },
        false,
      );
      const runtime = new Runtime({
        installId: 'claude-session-fallback',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-claude-session-fallback' as WorkspaceId,
        kernelAdapterResolver: () => adapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const runId = 'run-claude-session-fallback' as RunId;
      runtime.demoRuns.set(runId, makeRun(runId));
      await runtime.executeExternalKernelRun(runId);

      const requestedSessionId = adapter.requests[0]?.session?.id;
      expect(requestedSessionId).toBeTruthy();

      const restoredRuntime = new Runtime({
        installId: 'claude-session-fallback-restored',
        allowNoToken: true,
        messageStore,
        appSettingStore,
      }) as unknown as RuntimeExternalKernelHarness;
      const restoredRequest = await restoredRuntime.buildKernelRequestForRun(
        makeRun('run-claude-session-fallback-restored' as RunId),
      );
      expect(restoredRequest.session).toEqual({
        id: requestedSessionId,
        mode: 'resume',
      });
    } finally {
      connection.raw.close();
    }
  });

  it('restores Responses tool continuation ids across runtime restart and clears them with the Claude session', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-claude-continuation-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const threadId = 'thread-claude-continuation' as ThreadId;
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task-claude-continuation', '2026-08-15T00:00:00.000Z');
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const messageStore = new SqliteMessageStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const makeRun = (runId: RunId) =>
      createDemoRun(runId, threadId, 'continue with a tool result', {
        kernelId: 'claude-code',
        modelId: 'gpt-responses-model',
        providerModelId: 'gpt-responses-model',
        protocol: 'openai-responses',
        useFakeProvider: false,
      });

    try {
      const adapter = new RequestSessionKernelAdapter({
        type: 'terminal',
        status: 'completed',
      });
      const firstRuntime = new Runtime({
        installId: 'claude-continuation-first',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-claude-continuation' as WorkspaceId,
        kernelAdapterResolver: () => adapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const firstRunId = 'run-claude-continuation-first' as RunId;
      const firstRun = makeRun(firstRunId);
      firstRuntime.demoRuns.set(firstRunId, firstRun);
      await firstRuntime.executeExternalKernelRun(firstRunId);

      const sessionRecord = appSettingStore
        .list()
        .find((record) => record.key.startsWith('kernel.session.claude-code.'));
      const sessionValue = sessionRecord?.value as
        { sessionId?: string; responseContinuationScopeId?: string } | undefined;
      expect(sessionValue?.sessionId).toBeTruthy();
      expect(sessionValue?.responseContinuationScopeId).toMatch(/^kernel_/);
      const scopeId = sessionValue!.responseContinuationScopeId!;

      firstRuntime.openGateway.tickets.recordContinuationItem(
        scopeId,
        'call-persisted',
        'resp-persisted',
      );
      firstRuntime.openGateway.tickets.clear();

      const restoredRuntime = new Runtime({
        installId: 'claude-continuation-restored',
        allowNoToken: true,
        messageStore,
        appSettingStore,
      }) as unknown as RuntimeExternalKernelHarness;
      expect(
        restoredRuntime.openGateway.tickets.resolveContinuationItem(scopeId, 'call-persisted'),
      ).toBe('resp-persisted');

      restoredRuntime.clearKernelConversationSession(
        makeRun('run-claude-continuation-clear' as RunId),
        sessionValue!.sessionId,
      );
      expect(
        restoredRuntime.openGateway.tickets.resolveContinuationItem(scopeId, 'call-persisted'),
      ).toBeUndefined();
      expect(appSettingStore.get(`gateway.response-continuation.${scopeId}`)?.value).toBeNull();
    } finally {
      connection.raw.close();
    }
  });

  it('uses the explicit kernel id when clearing a legacy session without a continuation scope', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-kernel-continuation-cleanup-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const sessionKey = 'legacy.session.alias';
    const sessionId = 'claude-session-explicit-kernel';
    const scopeId = `kernel_${createHash('sha256')
      .update(JSON.stringify({ version: 1, kernelId: 'claude-code', sessionId }))
      .digest('base64url')}`;

    try {
      appSettingStore.set(sessionKey, {
        version: 1,
        sessionId,
        fingerprint: 'legacy-fingerprint',
        updatedAt: '2026-08-15T00:00:00.000Z',
      });
      appSettingStore.set(`gateway.response-continuation.${scopeId}`, {
        version: 1,
        items: [['call-legacy', 'fc-item-legacy']],
        updatedAt: '2026-08-15T00:00:01.000Z',
      });

      const runtime = new Runtime({
        installId: 'kernel-continuation-explicit-cleanup',
        allowNoToken: true,
        appSettingStore,
      }) as unknown as RuntimeExternalKernelHarness;
      expect(
        runtime.openGateway.tickets.resolveContinuationItem(scopeId, 'call-legacy'),
      ).toBeUndefined();

      runtime.clearKernelConversationSessionByKey('claude-code', sessionKey, sessionId);

      expect(
        runtime.openGateway.tickets.resolveContinuationItem(scopeId, 'call-legacy'),
      ).toBeUndefined();
      expect(appSettingStore.get(sessionKey)?.value).toBeNull();
      expect(appSettingStore.get(`gateway.response-continuation.${scopeId}`)?.value).toBeNull();
    } finally {
      connection.raw.close();
    }
  });

  it('persists a Codex thread reported by the adapter and resumes it after runtime restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-codex-session-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const threadId = 'thread-codex-session' as ThreadId;
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task-codex-session', '2026-08-14T00:00:00.000Z');
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const messageStore = new SqliteMessageStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    messageStore.appendMessage({
      id: 'message-codex-context-user' as MessageId,
      threadId,
      role: 'user',
      sequence: 0,
      blocks: [{ type: 'text', text: 'remember the Codex context' }],
      createdAt: '2026-08-14T00:00:01.000Z',
    });
    messageStore.appendMessage({
      id: 'message-codex-context-assistant' as MessageId,
      threadId,
      role: 'assistant',
      sequence: 1,
      blocks: [{ type: 'text', text: 'Codex context remembered' }],
      createdAt: '2026-08-14T00:00:02.000Z',
    });
    const makeRun = (runId: RunId) =>
      createDemoRun(runId, threadId, 'continue the task', {
        kernelId: 'codex',
        modelId: 'gpt-5',
        providerModelId: 'gpt-5',
        useFakeProvider: false,
      });

    try {
      const firstAdapter = new CapturingKernelAdapter('codex', [
        { type: 'session-started', sessionId: 'codex-thread-1' },
        { type: 'delta', text: 'first answer' },
        { type: 'terminal', status: 'completed' },
      ]);
      const firstRuntime = new Runtime({
        installId: 'codex-session-first',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-codex-session' as WorkspaceId,
        kernelAdapterResolver: () => firstAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const firstRunId = 'run-codex-session-first' as RunId;
      firstRuntime.demoRuns.set(firstRunId, makeRun(firstRunId));
      await firstRuntime.executeExternalKernelRun(firstRunId);
      expect(firstAdapter.requests[0].session).toEqual({ mode: 'create' });
      expect(firstAdapter.requests[0].systemContext).toContain('Restored conversation context');
      expect(firstAdapter.requests[0].systemContext).toContain('Simplified Chinese');
      expect(firstAdapter.requests[0].systemContext).toContain('thinking/reasoning');
      expect(firstAdapter.requests[0].systemContext).toContain(
        'AI design draft output contract (design-html)',
      );
      expect(firstAdapter.requests[0].systemContext).toContain(
        'exactly one fenced block tagged `design-html`',
      );
      const sessionRecord = appSettingStore
        .list()
        .find((record) => record.key.startsWith('kernel.session.codex.'));
      expect(
        (sessionRecord?.value as { responseContinuationScopeId?: string } | undefined)
          ?.responseContinuationScopeId,
      ).toMatch(/^kernel_/);

      const secondAdapter = new CapturingKernelAdapter('codex', [
        { type: 'terminal', status: 'completed' },
      ]);
      const secondRuntime = new Runtime({
        installId: 'codex-session-second',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-codex-session' as WorkspaceId,
        kernelAdapterResolver: () => secondAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const secondRunId = 'run-codex-session-second' as RunId;
      const secondRun = makeRun(secondRunId);
      const restoredRequest = await secondRuntime.buildKernelRequestForRun(secondRun, secondRunId);
      expect(restoredRequest.session).toEqual({
        id: 'codex-thread-1',
        mode: 'resume',
      });

      const changedModelRun = createDemoRun(
        'run-codex-session-model-change' as RunId,
        threadId,
        'continue with another model',
        {
          kernelId: 'codex',
          modelId: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
          useFakeProvider: false,
        },
      );
      const changedModelRequest = await secondRuntime.buildKernelRequestForRun(changedModelRun);
      expect(changedModelRequest.session).toMatchObject({
        id: 'codex-thread-1',
        mode: 'resume',
      });

      const planningRun = createDemoRun(
        'run-codex-session-planning-change' as RunId,
        threadId,
        'plan the next change',
        {
          kernelId: 'codex',
          modelId: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
          useFakeProvider: false,
          planningMode: true,
        },
      );
      const planningRequest = await secondRuntime.buildKernelRequestForRun(planningRun);
      expect(planningRequest.session).toMatchObject({
        id: 'codex-thread-1',
        mode: 'resume',
      });
      expect(planningRequest.session?.catchUp).toContain('规划模式（Planning mode）');
    } finally {
      connection.raw.close();
    }
  });

  it('resumes a durable Codex thread after its idle app-server is evicted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-codex-session-host-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const firstThreadId = 'thread-codex-host-first' as ThreadId;
    const secondThreadId = 'thread-codex-host-second' as ThreadId;
    for (const threadId of [firstThreadId, secondThreadId]) {
      connection.raw
        .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
        .run(threadId, `task-${threadId}`, '2026-08-20T00:00:00.000Z');
    }
    const firstAdapter = new CapturingKernelAdapter('codex', [
      { type: 'session-started', sessionId: 'codex-thread-host-first' },
      { type: 'terminal', status: 'completed' },
    ]);
    const secondAdapter = new CapturingKernelAdapter('codex', [
      { type: 'session-started', sessionId: 'codex-thread-host-second' },
      { type: 'terminal', status: 'completed' },
    ]);
    const resumedAdapter = new CapturingKernelAdapter('codex', [
      { type: 'terminal', status: 'completed' },
    ]);
    const adapters = [firstAdapter, secondAdapter, resumedAdapter];
    let adapterIndex = 0;
    const runtime = new Runtime({
      installId: 'codex-session-host-eviction',
      allowNoToken: true,
      stateStore: new SqliteEventCheckpointStore(connection.raw),
      messageStore: new SqliteMessageStore(connection.raw),
      appSettingStore: new SqliteAppSettingStore(connection.raw),
      workspaceId: 'workspace-codex-session-host' as WorkspaceId,
      codexSessionMaxEntries: 1,
      codexSessionIdleTimeoutMs: 60_000,
      kernelAdapterResolver: () => adapters[adapterIndex++],
    });
    const harness = runtime as unknown as RuntimeExternalKernelHarness;
    const run = (runId: RunId, threadId: ThreadId, userText: string) => {
      harness.demoRuns.set(runId, createCodexRun(runId, threadId, userText));
      return harness.executeExternalKernelRun(runId);
    };

    try {
      await run('run-codex-host-first' as RunId, firstThreadId, 'first conversation');
      await run('run-codex-host-second' as RunId, secondThreadId, 'second conversation');
      expect(firstAdapter.stopCalls).toBe(1);

      await run('run-codex-host-resumed' as RunId, firstThreadId, 'resume first conversation');

      expect(secondAdapter.stopCalls).toBe(1);
      expect(resumedAdapter.requests[0]?.session).toEqual({
        id: 'codex-thread-host-first',
        mode: 'resume',
      });
    } finally {
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('serializes one conversation and builds the next request after the session is saved', async () => {
    const threadId = 'thread-kernel-session-serialized' as ThreadId;
    const firstAdapter = new DeferredKernelAdapter('codex', 'codex-thread-serialized');
    const fixture = await createControlledRuntime([firstAdapter], [threadId]);
    const firstRunId = 'run-kernel-session-serialized-first' as RunId;
    const secondRunId = 'run-kernel-session-serialized-second' as RunId;
    fixture.runtime.demoRuns.set(firstRunId, createCodexRun(firstRunId, threadId, 'first turn'));
    fixture.runtime.demoRuns.set(secondRunId, createCodexRun(secondRunId, threadId, 'second turn'));

    try {
      const firstRun = fixture.runtime.executeExternalKernelRun(firstRunId);
      await waitForPromise(firstAdapter.started);
      const secondRun = fixture.runtime.executeExternalKernelRun(secondRunId);
      await new Promise((resolve) => setTimeout(resolve, 25));

      expect(firstAdapter.requests).toHaveLength(1);

      firstAdapter.release();
      await firstRun;
      await waitForCondition(() => firstAdapter.requests.length === 2);
      expect(firstAdapter.requests).toHaveLength(2);
      expect(firstAdapter.requests[1]?.session).toEqual({
        id: 'codex-thread-serialized',
        mode: 'resume',
      });

      await secondRun;
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('allows external kernel sessions from different conversations to run in parallel', async () => {
    const firstThreadId = 'thread-kernel-session-parallel-first' as ThreadId;
    const secondThreadId = 'thread-kernel-session-parallel-second' as ThreadId;
    const firstAdapter = new DeferredKernelAdapter('codex', 'codex-thread-parallel-first');
    const secondAdapter = new DeferredKernelAdapter('codex', 'codex-thread-parallel-second');
    const fixture = await createControlledRuntime(
      [firstAdapter, secondAdapter],
      [firstThreadId, secondThreadId],
    );
    const firstRunId = 'run-kernel-session-parallel-first' as RunId;
    const secondRunId = 'run-kernel-session-parallel-second' as RunId;
    fixture.runtime.demoRuns.set(
      firstRunId,
      createCodexRun(firstRunId, firstThreadId, 'first conversation'),
    );
    fixture.runtime.demoRuns.set(
      secondRunId,
      createCodexRun(secondRunId, secondThreadId, 'second conversation'),
    );

    try {
      const firstRun = fixture.runtime.executeExternalKernelRun(firstRunId);
      await waitForPromise(firstAdapter.started);
      const secondRun = fixture.runtime.executeExternalKernelRun(secondRunId);
      await waitForPromise(secondAdapter.started);

      expect(firstAdapter.requests).toHaveLength(1);
      expect(secondAdapter.requests).toHaveLength(1);

      firstAdapter.release();
      secondAdapter.release();
      await Promise.all([firstRun, secondRun]);
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('cancels an active adapter immediately and releases the session queue', async () => {
    const threadId = 'thread-kernel-session-cancel-active' as ThreadId;
    const firstAdapter = new DeferredKernelAdapter('codex', 'codex-thread-cancel-active');
    const fixture = await createControlledRuntime([firstAdapter], [threadId]);
    const firstRunId = 'run-kernel-session-cancel-active-first' as RunId;
    const secondRunId = 'run-kernel-session-cancel-active-second' as RunId;
    fixture.runtime.demoRuns.set(firstRunId, createCodexRun(firstRunId, threadId, 'blocking turn'));
    fixture.runtime.demoRuns.set(secondRunId, createCodexRun(secondRunId, threadId, 'queued turn'));

    try {
      const firstRun = fixture.runtime.executeExternalKernelRun(firstRunId);
      await waitForPromise(firstAdapter.started);
      const secondRun = fixture.runtime.executeExternalKernelRun(secondRunId);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(firstAdapter.requests).toHaveLength(1);

      fixture.runtime.demoRunAborts.get(firstRunId)?.abort();
      await waitForPromise(firstAdapter.cancelled);
      await firstRun;
      await waitForCondition(() => firstAdapter.requests.length === 2);
      expect(firstAdapter.requests).toHaveLength(2);

      expect(firstAdapter.cancelCalls).toBe(1);
      await secondRun;
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('skips a queued run that is cancelled before its session turn', async () => {
    const threadId = 'thread-kernel-session-cancel-queued' as ThreadId;
    const firstAdapter = new DeferredKernelAdapter('codex', 'codex-thread-cancel-queued');
    const fixture = await createControlledRuntime([firstAdapter], [threadId]);
    const firstRunId = 'run-kernel-session-cancel-queued-first' as RunId;
    const cancelledRunId = 'run-kernel-session-cancel-queued-second' as RunId;
    const nextRunId = 'run-kernel-session-cancel-queued-third' as RunId;
    fixture.runtime.demoRuns.set(firstRunId, createCodexRun(firstRunId, threadId, 'blocking turn'));
    fixture.runtime.demoRuns.set(
      cancelledRunId,
      createCodexRun(cancelledRunId, threadId, 'cancelled queued turn'),
    );
    fixture.runtime.demoRuns.set(
      nextRunId,
      createCodexRun(nextRunId, threadId, 'next queued turn'),
    );

    try {
      const firstRun = fixture.runtime.executeExternalKernelRun(firstRunId);
      await waitForPromise(firstAdapter.started);
      const cancelledRun = fixture.runtime.executeExternalKernelRun(cancelledRunId);
      fixture.runtime.demoRunAborts.get(cancelledRunId)?.abort();
      await waitForPromise(cancelledRun);

      const nextRun = fixture.runtime.executeExternalKernelRun(nextRunId);
      firstAdapter.release();
      await firstRun;
      await waitForCondition(() => firstAdapter.requests.length === 2);

      expect(firstAdapter.requests[1]?.userText).toBe('next queued turn');
      await nextRun;
    } finally {
      fixture.connection.raw.close();
    }
  });

  it('preserves resumed sessions on task failure and clears only invalid sessions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-kernel-session-failure-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const threadId = 'thread-kernel-session-failure' as ThreadId;
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task-kernel-session-failure', '2026-08-14T00:00:00.000Z');
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const messageStore = new SqliteMessageStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const makeRun = (runId: RunId) =>
      createDemoRun(runId, threadId, 'continue the task', {
        kernelId: 'codex',
        modelId: 'gpt-5',
        providerModelId: 'gpt-5',
        useFakeProvider: false,
      });

    try {
      const createAdapter = new CapturingKernelAdapter('codex', [
        { type: 'session-started', sessionId: 'codex-thread-failure-test' },
        { type: 'terminal', status: 'completed' },
      ]);
      const createRuntime = new Runtime({
        installId: 'kernel-session-create',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-kernel-session-failure' as WorkspaceId,
        kernelAdapterResolver: () => createAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const createRunId = 'run-kernel-session-create' as RunId;
      createRuntime.demoRuns.set(createRunId, makeRun(createRunId));
      await createRuntime.executeExternalKernelRun(createRunId);

      const taskFailureAdapter = new CapturingKernelAdapter('codex', [
        { type: 'terminal', status: 'failed', error: 'tool execution failed' },
      ]);
      const taskFailureRuntime = new Runtime({
        installId: 'kernel-session-task-failure',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-kernel-session-failure' as WorkspaceId,
        kernelAdapterResolver: () => taskFailureAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const taskFailureRunId = 'run-kernel-session-task-failure' as RunId;
      taskFailureRuntime.demoRuns.set(taskFailureRunId, makeRun(taskFailureRunId));
      await taskFailureRuntime.executeExternalKernelRun(taskFailureRunId);
      const afterTaskFailure = await taskFailureRuntime.buildKernelRequestForRun(
        makeRun('run-kernel-session-after-task-failure' as RunId),
      );
      expect(afterTaskFailure.session).toEqual({
        id: 'codex-thread-failure-test',
        mode: 'resume',
      });

      const sessionMetricsFailureAdapter = new CapturingKernelAdapter('codex', [
        {
          type: 'terminal',
          status: 'failed',
          error: 'failed to load tool output for session metrics',
        },
      ]);
      const sessionMetricsFailureRuntime = new Runtime({
        installId: 'kernel-session-metrics-failure',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-kernel-session-failure' as WorkspaceId,
        kernelAdapterResolver: () => sessionMetricsFailureAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const sessionMetricsFailureRunId = 'run-kernel-session-metrics-failure' as RunId;
      sessionMetricsFailureRuntime.demoRuns.set(
        sessionMetricsFailureRunId,
        makeRun(sessionMetricsFailureRunId),
      );
      await sessionMetricsFailureRuntime.executeExternalKernelRun(sessionMetricsFailureRunId);
      const afterSessionMetricsFailure =
        await sessionMetricsFailureRuntime.buildKernelRequestForRun(
          makeRun('run-kernel-session-after-metrics-failure' as RunId),
        );
      expect(afterSessionMetricsFailure.session).toEqual({
        id: 'codex-thread-failure-test',
        mode: 'resume',
      });

      const invalidSessionAdapter = new CapturingKernelAdapter('codex', [
        {
          type: 'terminal',
          status: 'failed',
          error: 'Session codex-thread-failure-test not found',
        },
      ]);
      const invalidSessionRuntime = new Runtime({
        installId: 'kernel-session-invalid',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-kernel-session-failure' as WorkspaceId,
        kernelAdapterResolver: () => invalidSessionAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const invalidRunId = 'run-kernel-session-invalid' as RunId;
      invalidSessionRuntime.demoRuns.set(invalidRunId, makeRun(invalidRunId));
      await invalidSessionRuntime.executeExternalKernelRun(invalidRunId);
      const afterInvalidSession = await invalidSessionRuntime.buildKernelRequestForRun(
        makeRun('run-kernel-session-after-invalid' as RunId),
      );
      expect(afterInvalidSession.session).toEqual({ mode: 'create' });
    } finally {
      connection.raw.close();
    }
  });

  it('preserves an established Claude session on ordinary failure and clears it when invalid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-claude-session-failure-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const threadId = 'thread-claude-session-failure' as ThreadId;
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run(threadId, 'task-claude-session-failure', '2026-08-14T00:00:00.000Z');
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const messageStore = new SqliteMessageStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const makeRun = (runId: RunId) =>
      createDemoRun(runId, threadId, 'continue the task', {
        kernelId: 'claude-code',
        modelId: 'claude-sonnet-4-5',
        providerModelId: 'claude-sonnet-4-5',
        useFakeProvider: false,
      });

    try {
      const taskFailureAdapter = new RequestSessionKernelAdapter({
        type: 'terminal',
        status: 'failed',
        error: 'tool execution failed',
      });
      const taskFailureRuntime = new Runtime({
        installId: 'claude-session-task-failure',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-claude-session-failure' as WorkspaceId,
        kernelAdapterResolver: () => taskFailureAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const taskFailureRunId = 'run-claude-session-task-failure' as RunId;
      taskFailureRuntime.demoRuns.set(taskFailureRunId, makeRun(taskFailureRunId));
      await taskFailureRuntime.executeExternalKernelRun(taskFailureRunId);

      const establishedSessionId = taskFailureAdapter.requests[0]?.session?.id;
      expect(establishedSessionId).toBeTruthy();
      const afterTaskFailure = await taskFailureRuntime.buildKernelRequestForRun(
        makeRun('run-claude-session-after-task-failure' as RunId),
      );
      expect(afterTaskFailure.session).toEqual({
        id: establishedSessionId,
        mode: 'resume',
      });

      const invalidSessionAdapter = new CapturingKernelAdapter('claude-code', [
        {
          type: 'terminal',
          status: 'failed',
          error: `Session ${establishedSessionId} not found`,
        },
      ]);
      const invalidSessionRuntime = new Runtime({
        installId: 'claude-session-invalid',
        allowNoToken: true,
        stateStore,
        messageStore,
        appSettingStore,
        workspaceId: 'workspace-claude-session-failure' as WorkspaceId,
        kernelAdapterResolver: () => invalidSessionAdapter,
      }) as unknown as RuntimeExternalKernelHarness;
      const invalidRunId = 'run-claude-session-invalid' as RunId;
      invalidSessionRuntime.demoRuns.set(invalidRunId, makeRun(invalidRunId));
      await invalidSessionRuntime.executeExternalKernelRun(invalidRunId);

      const afterInvalidSession = await invalidSessionRuntime.buildKernelRequestForRun(
        makeRun('run-claude-session-after-invalid' as RunId),
      );
      expect(afterInvalidSession.session).toMatchObject({ mode: 'create' });
      expect(afterInvalidSession.session?.id).not.toBe(establishedSessionId);
    } finally {
      connection.raw.close();
    }
  });
});
