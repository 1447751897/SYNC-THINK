import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { Checkpoint, Event, RunId, WorkspaceId } from '@sync-think/shared';
import type {
  CommitTransitionInput,
  CommittedTransition,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';
import { openPersistentRuntime } from '../src/persistence.js';

class MemoryRuntimeStateStore implements RuntimeStateStore {
  readonly events: Event[] = [];
  private sequence = 0;
  private checkpoint: Checkpoint | undefined;

  commitTransition(input: CommitTransitionInput): CommittedTransition {
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

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
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
          rules: [],
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
      expect(JSON.stringify(provider.requests[1]?.messages)).toContain('File write completed');

      const outputPath = join(dir, 'agent-output.txt');
      await waitFor(() => existsSync(outputPath));
      expect(readFileSync(outputPath, 'utf8')).toBe('created by a full-access conversation run');
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
