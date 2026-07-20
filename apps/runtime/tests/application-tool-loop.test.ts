import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { Checkpoint, Event, RunId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  SqlitePolicyStore,
  type CommitTransitionInput,
  type CommittedTransition,
  type SqliteWorkspaceStore,
} from '@sync-think/storage';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';
import { openPersistentRuntime } from '../src/persistence.js';

class MemoryRuntimeStateStore implements RuntimeStateStore {
  readonly events: Event[] = [];
  failOnEventType: string | undefined;
  private sequence = 0;
  private checkpoint: Checkpoint | undefined;

  commitTransition(input: CommitTransitionInput): CommittedTransition {
    if (this.failOnEventType && input.events.some((event) => event.type === this.failOnEventType)) {
      throw new Error(`Injected persistence failure for ${this.failOnEventType}`);
    }
    const events = input.events.map((draft) => ({ ...draft, sequence: ++this.sequence }));
    this.events.push(...events);
    if (input.checkpoint) {
      this.checkpoint = { ...input.checkpoint, lastEventSequence: this.sequence };
    }
    return { events, ...(this.checkpoint ? { checkpoint: this.checkpoint } : {}) };
  }

  listEvents(workspaceId: WorkspaceId, afterSequence: number): Event[] {
    return this.events.filter(
      (event) => event.workspaceId === workspaceId && event.sequence > afterSequence,
    );
  }

  listAllEvents(afterSequence: number): Event[] {
    return this.events.filter((event) => event.sequence > afterSequence);
  }

  loadLatestCheckpoint(runId: RunId): Checkpoint | undefined {
    return this.checkpoint?.runId === runId ? this.checkpoint : undefined;
  }
}

class ApplicationToolProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-tool-use'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'call-project-list',
          name: 'sync_think.project.list',
          argumentsJson: '{}',
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    yield { type: 'text-delta', text: '已通过 SYNC-THINK 应用工具检查项目列表。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class ConfigurationApplicationToolProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-tool-use'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'call-project-create',
          name: 'sync_think.project.create',
          argumentsJson: JSON.stringify({ name: 'Agent 创建的项目' }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    yield { type: 'text-delta', text: '项目创建请求正在等待你的确认。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class ExecutionApplicationToolProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-tool-use'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'call-write-file',
          name: 'write_file',
          argumentsJson: JSON.stringify({
            path: 'agent-output.txt',
            content: 'created by a full-access conversation run',
          }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    yield { type: 'text-delta', text: '文件已经创建。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class ReadExecutionApplicationToolProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-tool-use'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'call-read-file',
          name: 'read_file',
          argumentsJson: JSON.stringify({ path: 'context.txt' }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    yield { type: 'text-delta', text: '已经读取项目上下文。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class BrowserNavigationApplicationToolProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-tool-use'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'call-browser-navigate',
          name: 'browser_navigate',
          argumentsJson: JSON.stringify({ url: 'https://example.com/account' }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    yield { type: 'text-delta', text: '浏览器导航已完成。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class DeferredConfigurationApplicationToolProvider extends ConfigurationApplicationToolProvider {
  private releaseFirstCall!: () => void;
  private readonly firstCallReleased = new Promise<void>((resolve) => {
    this.releaseFirstCall = resolve;
  });
  private firstCallEntered!: () => void;
  readonly enteredFirstCall = new Promise<void>((resolve) => {
    this.firstCallEntered = resolve;
  });

  release(): void {
    this.releaseFirstCall();
  }

  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    if (this.requests.length === 0) {
      this.firstCallEntered();
      await this.firstCallReleased;
    }
    yield* super.call(request);
  }
}

const runtimes: Runtime[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

async function requestClient(installId: string) {
  const socket = connect(pipePathPortable(installId));
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let pending = Buffer.alloc(0);
  const waiters = new Map<string, (frame: Frame) => void>();
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (waiter) {
        waiters.delete(frame.id);
        waiter(frame);
      }
    }
  });
  const request = (frame: Frame) => {
    const response = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
    socket.write(encodeFrame(frame));
    return response;
  };
  await request({
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: 'application-tool-test',
      installId,
      nonce: 'application-tool-test',
      features: ['task.appendMessage'],
    },
  });
  return request;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(predicate()).toBe(true);
}

describe('in-app Agent application tool loop', () => {
  it('executes a Runtime command, returns the result to the model, then persists one final answer', async () => {
    const installId = `application-tools-${Date.now()}`;
    const store = new MemoryRuntimeStateStore();
    const provider = new ApplicationToolProvider();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId: 'workspace-tools' as WorkspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
    });
    runtimes.push(runtime);
    await runtime.start();
    const request = await requestClient(installId);

    const appended = await request({
      id: 'append',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: 'thread-tools',
        expectedTaskVersion: 0,
        role: 'user',
        text: '检查项目',
        modelId: 'fake-tool-use',
      },
    });
    expect(appended.error).toBeUndefined();
    await waitFor(() => store.events.some((event) => event.type === 'run.completed'));

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toContain(
      'sync_think.project.list',
    );
    expect(provider.requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant' }),
        expect.objectContaining({ role: 'tool', toolCallId: 'call-project-list' }),
      ]),
    );
    expect(store.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'tool.requested',
        'application.tool_started',
        'application.tool_completed',
        'application.tool_turn_completed',
        'run.completed',
      ]),
    );
    expect(store.events.filter((event) => event.type === 'run.completed')).toHaveLength(1);
  });

  it('binds configuration confirmation to the conversation and executes it only once', async () => {
    const installId = `application-confirm-${Date.now()}`;
    const store = new MemoryRuntimeStateStore();
    const provider = new ConfigurationApplicationToolProvider();
    const createdNames: string[] = [];
    const workspaceStore = {
      getTaskByThreadId: () => undefined,
      createWorkspace: ({ name }: { name: string }) => {
        createdNames.push(name);
        return {
          id: 'workspace-created-by-agent',
          name,
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
        };
      },
    } as unknown as SqliteWorkspaceStore;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceStore,
      workspaceId: 'workspace-tools' as WorkspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
    });
    runtimes.push(runtime);
    await runtime.start();
    const request = await requestClient(installId);

    await request({
      id: 'append-confirmation',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: 'thread-confirmation',
        expectedTaskVersion: 0,
        role: 'user',
        text: '创建一个项目',
        modelId: 'fake-tool-use',
      },
    });
    await waitFor(() =>
      store.events.some((event) => event.type === 'application.tool_confirmation_requested'),
    );
    const confirmationEvent = store.events.find(
      (event) => event.type === 'application.tool_confirmation_requested',
    );
    const confirmationId = String(confirmationEvent?.payload.confirmationId ?? '');
    expect(confirmationId).toMatch(/^confirmation_/);
    expect(JSON.stringify(confirmationEvent?.payload)).not.toContain('confirmationToken');

    const wrongThread = await request({
      id: 'confirm-wrong-thread',
      kind: 'request',
      type: 'application.tool.confirm',
      payload: { confirmationId, threadId: 'thread-other' },
    });
    expect(wrongThread.error?.code).toBe('approval.required');
    expect(createdNames).toEqual([]);

    const confirmed = await request({
      id: 'confirm-correct-thread',
      kind: 'request',
      type: 'application.tool.confirm',
      payload: { confirmationId, threadId: 'thread-confirmation' },
    });
    expect(confirmed.error).toBeUndefined();
    expect(confirmed.payload).toMatchObject({
      confirmationId,
      status: 'confirmed',
      command: 'workspace.create',
    });
    expect(createdNames).toEqual(['Agent 创建的项目']);
    await waitFor(() => provider.requests.length >= 2);
    expect(
      store.events.filter((event) => event.type === 'application.tool_confirmation_requested'),
    ).toHaveLength(1);

    const replayed = await request({
      id: 'confirm-replayed',
      kind: 'request',
      type: 'application.tool.confirm',
      payload: { confirmationId, threadId: 'thread-confirmation' },
    });
    expect(replayed.error?.code).toBe('approval.required');
    expect(createdNames).toEqual(['Agent 创建的项目']);
    expect(
      store.events.filter((event) => event.type === 'application.tool_confirmation_resolved'),
    ).toHaveLength(1);
  });

  it('returns an expired configuration confirmation to the model and resumes the run', async () => {
    const installId = `application-expired-${Date.now()}`;
    const store = new MemoryRuntimeStateStore();
    const provider = new ConfigurationApplicationToolProvider();
    const workspaceStore = {
      getTaskByThreadId: () => undefined,
      createWorkspace: () => {
        throw new Error('expired confirmation must not execute');
      },
    } as unknown as SqliteWorkspaceStore;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceStore,
      workspaceId: 'workspace-tools' as WorkspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
    });
    runtimes.push(runtime);
    await runtime.start();
    const request = await requestClient(installId);

    await request({
      id: 'append-expired-confirmation',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: 'thread-expired-confirmation',
        expectedTaskVersion: 0,
        role: 'user',
        text: '创建一个项目',
        modelId: 'fake-tool-use',
      },
    });
    await waitFor(() =>
      store.events.some((event) => event.type === 'application.tool_confirmation_requested'),
    );
    const confirmationEvent = store.events.find(
      (event) => event.type === 'application.tool_confirmation_requested',
    );
    const confirmationId = String(confirmationEvent?.payload.confirmationId ?? '');
    const confirmationResult = JSON.parse(String(confirmationEvent?.payload.result ?? '{}')) as {
      expiresAt?: string;
    };
    expect(confirmationResult.expiresAt).toBeTruthy();

    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse(String(confirmationResult.expiresAt)) + 1);
    try {
      const expired = await request({
        id: 'confirm-expired',
        kind: 'request',
        type: 'application.tool.confirm',
        payload: { confirmationId, threadId: 'thread-expired-confirmation' },
      });
      expect(expired.error?.code).toBe('approval.required');
    } finally {
      now.mockRestore();
    }

    await waitFor(() => provider.requests.length >= 2);
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain(
      'application.configuration_expired',
    );
    expect(
      store.events.filter((event) => event.type === 'application.tool_confirmation_resolved'),
    ).toHaveLength(1);
  });

  it('expires a pending configuration confirmation after Runtime restart without executing it', async () => {
    const installId = `application-restart-pending-${Date.now()}`;
    const store = new MemoryRuntimeStateStore();
    const provider = new ConfigurationApplicationToolProvider();
    const createdNames: string[] = [];
    const workspaceStore = {
      getTaskByThreadId: () => undefined,
      createWorkspace: ({ name }: { name: string }) => {
        createdNames.push(name);
        return { id: 'unexpected', name, createdAt: '', updatedAt: '' };
      },
    } as unknown as SqliteWorkspaceStore;
    const options = {
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceStore,
      workspaceId: 'workspace-tools' as WorkspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
    };
    const first = new Runtime(options);
    runtimes.push(first);
    await first.start();
    const request = await requestClient(installId);
    await request({
      id: 'append-restart-pending',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: 'thread-restart-pending',
        expectedTaskVersion: 0,
        role: 'user',
        text: '创建一个项目',
        modelId: 'fake-tool-use',
      },
    });
    await waitFor(() =>
      store.events.some((event) => event.type === 'application.tool_confirmation_requested'),
    );
    await first.stop();

    const recovered = new Runtime(options);
    runtimes.push(recovered);
    await recovered.start();
    await waitFor(() => provider.requests.length >= 2);

    expect(createdNames).toEqual([]);
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain(
      'application.configuration_runtime_restarted',
    );
    expect(
      store.events.filter((event) => event.type === 'application.tool_confirmation_resolved'),
    ).toHaveLength(1);
  });

  it('does not repeat a configuration side effect whose persisted started fence has no result', async () => {
    const installId = `application-restart-started-${Date.now()}`;
    const store = new MemoryRuntimeStateStore();
    const provider = new ConfigurationApplicationToolProvider();
    const createdNames: string[] = [];
    const workspaceStore = {
      getTaskByThreadId: () => undefined,
      createWorkspace: ({ name }: { name: string }) => {
        createdNames.push(name);
        return {
          id: 'workspace-created-before-crash',
          name,
          createdAt: '2026-07-20T00:00:00.000Z',
          updatedAt: '2026-07-20T00:00:00.000Z',
        };
      },
    } as unknown as SqliteWorkspaceStore;
    const options = {
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceStore,
      workspaceId: 'workspace-tools' as WorkspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
    };
    const first = new Runtime(options);
    runtimes.push(first);
    await first.start();
    const request = await requestClient(installId);
    await request({
      id: 'append-restart-started',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: 'thread-restart-started',
        expectedTaskVersion: 0,
        role: 'user',
        text: '创建一个项目',
        modelId: 'fake-tool-use',
      },
    });
    await waitFor(() =>
      store.events.some((event) => event.type === 'application.tool_confirmation_requested'),
    );
    const confirmationId = String(
      store.events.find((event) => event.type === 'application.tool_confirmation_requested')
        ?.payload.confirmationId ?? '',
    );
    store.failOnEventType = 'application.tool_confirmation_resolved';
    const failedPersistence = await request({
      id: 'confirm-before-crash',
      kind: 'request',
      type: 'application.tool.confirm',
      payload: { confirmationId, threadId: 'thread-restart-started' },
    });
    expect(failedPersistence.error).toBeDefined();
    expect(createdNames).toEqual(['Agent 创建的项目']);
    expect(
      store.events.filter((event) => event.type === 'application.tool_confirmation_started'),
    ).toHaveLength(1);
    await first.stop();

    store.failOnEventType = undefined;
    const recovered = new Runtime(options);
    runtimes.push(recovered);
    await recovered.start();
    await waitFor(() => provider.requests.length >= 2);

    expect(createdNames).toEqual(['Agent 创建的项目']);
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain(
      'application.configuration_outcome_unknown',
    );
  });

  it('honors a stricter Run policy when deciding whether to auto-confirm configuration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-application-run-policy-'));
    const dbPath = join(dir, 'sync-think.db');
    const installId = `application-run-policy-${Date.now()}`;
    const provider = new DeferredConfigurationApplicationToolProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-store.key'),
      demoProvider: provider,
      allowNoToken: true,
    });
    try {
      await session.runtime.start();
      const request = await requestClient(installId);
      const workspace = await request({
        id: 'workspace-run-policy',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Run policy workspace' },
      });
      const workspaceId = String((workspace.payload as { workspaceId: string }).workspaceId);
      const task = await request({
        id: 'task-run-policy',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Run policy task', goal: 'Keep Run approval strict' },
      });
      const { taskId, threadId } = task.payload as { taskId: string; threadId: string };
      await request({
        id: 'task-policy-full',
        kind: 'request',
        type: 'policy.save',
        payload: { workspaceId, scopeType: 'task', scopeId: taskId, approvalMode: 'full' },
      });
      await request({
        id: 'append-run-policy',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '创建项目',
          modelId: 'fake-tool-use',
        },
      });
      await provider.enteredFirstCall;
      const runId = String(
        session.runtime
          .createCheckpoint()
          .events.find(
            (event) => event.payload.threadId === threadId && event.runId !== undefined,
          )?.runId ??
          '',
      );
      expect(runId).not.toBe('');
      const policyConnection = await openDatabaseAsync({ path: dbPath });
      try {
        new SqlitePolicyStore(policyConnection.raw).save({
          policyId: 'policy-run-request' as never,
          scopeType: 'run',
          scopeId: runId,
          approvalMode: 'request',
          rules: [],
          now: '2026-07-20T00:00:00.000Z',
        });
      } finally {
        policyConnection.raw.close();
      }
      provider.release();
      await waitFor(() =>
        session.runtime
          .createCheckpoint()
          .events.some((event) => event.type === 'application.tool_confirmation_requested'),
      );

      const workspaces = await request({
        id: 'workspace-list-run-policy',
        kind: 'request',
        type: 'workspace.list',
        payload: {},
      });
      expect(
        (workspaces.payload as { workspaces: Array<{ name: string }> }).workspaces.map(
          (item) => item.name,
        ),
      ).not.toContain('Agent 创建的项目');
    } finally {
      provider.release();
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto-confirms a configuration tool when the current task has full access', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-application-full-'));
    const installId = `application-full-${Date.now()}`;
    const provider = new ConfigurationApplicationToolProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure-store.key'),
      demoProvider: provider,
      allowNoToken: true,
    });
    try {
      await session.runtime.start();
      const request = await requestClient(installId);
      const workspace = await request({
        id: 'workspace-full',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Full access workspace' },
      });
      const workspaceId = String((workspace.payload as { workspaceId: string }).workspaceId);
      const task = await request({
        id: 'task-full',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Full access task', goal: 'Create configuration' },
      });
      const { taskId, threadId } = task.payload as { taskId: string; threadId: string };
      const policy = await request({
        id: 'policy-full',
        kind: 'request',
        type: 'policy.save',
        payload: {
          workspaceId,
          scopeType: 'task',
          scopeId: taskId,
          approvalMode: 'full',
          rules: [{ action: 'execution.write_file', approvalMode: 'request' }],
        },
      });
      expect(policy.error).toBeUndefined();

      await request({
        id: 'append-full',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '创建项目',
          modelId: 'fake-tool-use',
        },
      });
      await waitFor(() => provider.requests.length >= 2);

      const listed = await request({
        id: 'workspace-list-full',
        kind: 'request',
        type: 'workspace.list',
        payload: {},
      });
      const names = (listed.payload as { workspaces: Array<{ name: string }> }).workspaces.map(
        (item) => item.name,
      );
      expect(names).toContain('Agent 创建的项目');
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('executes a full-access workspace tool from an ordinary conversation Run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-execution-full-'));
    const installId = `execution-full-${Date.now()}`;
    const provider = new ExecutionApplicationToolProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure-store.key'),
      demoProvider: provider,
      allowNoToken: true,
    });
    try {
      await session.runtime.start();
      const request = await requestClient(installId);
      const workspace = await request({
        id: 'workspace-execution-full',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Execution workspace', folderPath: dir },
      });
      const workspaceId = String((workspace.payload as { workspaceId: string }).workspaceId);
      const task = await request({
        id: 'task-execution-full',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Write a file', goal: 'Write a file without approval' },
      });
      const { taskId, threadId } = task.payload as { taskId: string; threadId: string };
      await request({
        id: 'policy-execution-full',
        kind: 'request',
        type: 'policy.save',
        payload: {
          workspaceId,
          scopeType: 'task',
          scopeId: taskId,
          approvalMode: 'full',
          rules: [],
        },
      });

      const appended = await request({
        id: 'append-execution-full',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '创建 agent-output.txt。',
          modelId: 'fake-tool-use',
        },
      });
      expect(appended.error).toBeUndefined();
      await waitFor(() => provider.requests.length >= 2);

      expect(provider.requests[0]?.tools?.map((tool) => tool.name)).toContain('write_file');
      expect(JSON.stringify(provider.requests[0])).toContain('完全访问');
      expect(JSON.stringify(provider.requests[1]?.messages)).toContain('File write completed');

      const outputPath = join(dir, 'agent-output.txt');
      await waitFor(() => existsSync(outputPath));
      expect(readFileSync(outputPath, 'utf8')).toBe('created by a full-access conversation run');
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs read-only inspection without creating an approval in request mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-execution-read-'));
    writeFileSync(join(dir, 'context.txt'), 'read-only context', 'utf8');
    const installId = `execution-read-${Date.now()}`;
    const provider = new ReadExecutionApplicationToolProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure-store.key'),
      demoProvider: provider,
      allowNoToken: true,
    });
    try {
      await session.runtime.start();
      const request = await requestClient(installId);
      const workspace = await request({
        id: 'workspace-execution-read',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Read workspace', folderPath: dir },
      });
      const workspaceId = String((workspace.payload as { workspaceId: string }).workspaceId);
      const task = await request({
        id: 'task-execution-read',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Read context', goal: 'Inspect without approval' },
      });
      const { taskId, threadId } = task.payload as { taskId: string; threadId: string };
      await request({
        id: 'append-execution-read',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '读取 context.txt。',
          modelId: 'fake-tool-use',
        },
      });
      await waitFor(() => provider.requests.length >= 2);
      expect(JSON.stringify(provider.requests[1]?.messages)).toContain('read-only context');
      const listed = await request({
        id: 'approval-list-read',
        kind: 'request',
        type: 'approval.list',
        payload: { workspaceId, taskId, state: 'pending' },
      });
      expect((listed.payload as { items: unknown[] }).items).toEqual([]);
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not apply the request-mode read shortcut to an explicit custom request rule', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-execution-custom-read-'));
    writeFileSync(join(dir, 'context.txt'), 'protected custom context', 'utf8');
    const installId = `execution-custom-read-${Date.now()}`;
    const provider = new ReadExecutionApplicationToolProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure-store.key'),
      demoProvider: provider,
      allowNoToken: true,
    });
    try {
      await session.runtime.start();
      const request = await requestClient(installId);
      const workspace = await request({
        id: 'workspace-custom-read',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Custom read workspace', folderPath: dir },
      });
      const workspaceId = String((workspace.payload as { workspaceId: string }).workspaceId);
      const task = await request({
        id: 'task-custom-read',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Custom read', goal: 'Ask before this read' },
      });
      const { taskId, threadId } = task.payload as { taskId: string; threadId: string };
      await request({
        id: 'policy-custom-read',
        kind: 'request',
        type: 'policy.save',
        payload: {
          workspaceId,
          scopeType: 'task',
          scopeId: taskId,
          approvalMode: 'custom',
          rules: [{ action: 'execution.read_file', approvalMode: 'request' }],
        },
      });
      await request({
        id: 'append-custom-read',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '读取 context.txt。',
          modelId: 'fake-tool-use',
        },
      });

      let pendingCount = 0;
      await waitFor(async () => {
        const listed = await request({
          id: `approval-list-custom-read-${Date.now()}`,
          kind: 'request',
          type: 'approval.list',
          payload: { workspaceId, taskId, state: 'pending' },
        });
        pendingCount = (listed.payload as { items: unknown[] }).items.length;
        return pendingCount === 1;
      });
      expect(provider.requests).toHaveLength(1);
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires approval before browser navigation in request mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-execution-browser-nav-'));
    const installId = `execution-browser-nav-${Date.now()}`;
    const provider = new BrowserNavigationApplicationToolProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure-store.key'),
      demoProvider: provider,
      allowNoToken: true,
    });
    try {
      await session.runtime.start();
      const request = await requestClient(installId);
      const workspace = await request({
        id: 'workspace-browser-nav',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Browser navigation workspace', folderPath: dir },
      });
      const workspaceId = String((workspace.payload as { workspaceId: string }).workspaceId);
      const task = await request({
        id: 'task-browser-nav',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Navigate', goal: 'Ask before network navigation' },
      });
      const { taskId, threadId } = task.payload as { taskId: string; threadId: string };
      await request({
        id: 'append-browser-nav',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '打开账号页面。',
          modelId: 'fake-tool-use',
        },
      });

      await waitFor(async () => {
        const listed = await request({
          id: `approval-list-browser-nav-${Date.now()}`,
          kind: 'request',
          type: 'approval.list',
          payload: { workspaceId, taskId, state: 'pending' },
        });
        return (listed.payload as { items: unknown[] }).items.length === 1;
      });
      expect(provider.requests).toHaveLength(1);
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pauses one protected conversation tool and resumes it after the exact approval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-execution-approval-'));
    const installId = `execution-approval-${Date.now()}`;
    const provider = new ExecutionApplicationToolProvider();
    const session = await openPersistentRuntime({
      installId,
      dbPath: join(dir, 'sync-think.db'),
      secureStoreKeyPath: join(dir, 'secure-store.key'),
      demoProvider: provider,
      allowNoToken: true,
    });
    try {
      await session.runtime.start();
      const request = await requestClient(installId);
      const workspace = await request({
        id: 'workspace-execution-approval',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Approval workspace', folderPath: dir },
      });
      const workspaceId = String((workspace.payload as { workspaceId: string }).workspaceId);
      const task = await request({
        id: 'task-execution-approval',
        kind: 'request',
        type: 'task.create',
        payload: { workspaceId, title: 'Approve a file', goal: 'Pause before writing' },
      });
      const { taskId, threadId } = task.payload as { taskId: string; threadId: string };

      const appended = await request({
        id: 'append-execution-approval',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '创建 agent-output.txt。',
          modelId: 'fake-tool-use',
        },
      });
      expect(appended.error).toBeUndefined();

      let approvalId = '';
      await waitFor(async () => {
        const listed = await request({
          id: `approval-list-${Date.now()}`,
          kind: 'request',
          type: 'approval.list',
          payload: { workspaceId, taskId, state: 'pending' },
        });
        approvalId = String(
          (listed.payload as { items: Array<{ id: string }> }).items[0]?.id ?? '',
        );
        return Boolean(approvalId);
      });
      expect(existsSync(join(dir, 'agent-output.txt'))).toBe(false);
      expect(provider.requests).toHaveLength(1);

      const decided = await request({
        id: 'approval-decide-execution',
        kind: 'request',
        type: 'approval.decide',
        payload: { id: approvalId, decision: 'approved' },
      });
      expect(decided.error).toBeUndefined();
      await waitFor(() => existsSync(join(dir, 'agent-output.txt')));
      await waitFor(() => provider.requests.length >= 2);
      expect(readFileSync(join(dir, 'agent-output.txt'), 'utf8')).toBe(
        'created by a full-access conversation run',
      );
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
