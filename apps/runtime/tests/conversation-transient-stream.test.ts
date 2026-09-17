import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type ConversationTransientFrame,
  type Frame,
} from '@sync-think/protocol';
import { COLLABORATION_SETTINGS_KEY } from '@sync-think/protocol/collaboration';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteAppSettingStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { Message, ModelId, RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class ScriptedProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;

  constructor(
    private readonly createEvents: () => AdapterEvent[],
    private readonly tickMs: number = 1,
  ) {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    for (const event of this.createEvents()) {
      yield event;
      if (this.tickMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.tickMs));
      }
    }
  }
}

class PartialTerminalProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  emitted = false;

  constructor(private readonly terminal: 'failed' | 'cancelled') {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield { type: 'text-delta', text: 'partial answer' };
    this.emitted = true;
    if (this.terminal === 'failed') {
      yield { type: 'error', failureClass: 'acceptance', message: 'fixture failure' };
      return;
    }
    await new Promise<void>((resolve) => {
      if (request.signal.aborted) resolve();
      else request.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

class ReasoningOnlyTerminalProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  emitted = false;

  constructor(private readonly terminal: 'completed' | 'failed' | 'cancelled') {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield { type: 'reasoning-delta', text: 'reasoning-only summary' };
    this.emitted = true;
    if (this.terminal === 'completed') {
      yield { type: 'finished', reason: 'stop' };
      return;
    }
    if (this.terminal === 'failed') {
      yield { type: 'error', failureClass: 'acceptance', message: 'reasoning fixture failure' };
      return;
    }
    await new Promise<void>((resolve) => {
      if (request.signal.aborted) resolve();
      else request.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

class DelegationProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];
  childAborted = false;

  constructor(
    private readonly childTerminal:
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'budget'
      | 'timeout' = 'completed',
  ) {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const hasToolResult = request.messages.some((message) => message.role === 'tool');
    const userText = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');

    if (userText.includes('child delegation task')) {
      if (this.childTerminal === 'failed') {
        yield { type: 'error', failureClass: 'acceptance', message: 'child fixture failure' };
        return;
      }
      if (this.childTerminal === 'cancelled') {
        yield { type: 'text-delta', text: 'child progress' };
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        this.childAborted = request.signal.aborted;
        return;
      }
      if (this.childTerminal === 'budget') {
        yield { type: 'usage', tokensIn: 2, tokensOut: 2 };
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
      }
      if (this.childTerminal === 'timeout') {
        await new Promise<void>((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
      }
      if (!hasToolResult) {
        yield {
          type: 'tool-call',
          toolCall: {
            id: 'child-list-files',
            name: 'list_files',
            argumentsJson: JSON.stringify({ path: '.', maxEntries: 5 }),
          },
        };
        yield { type: 'finished', reason: 'tool-requests' };
        return;
      }
      yield { type: 'text-delta', text: 'child result only' };
      // A real child bills; the card reads its spend from these usage events.
      yield {
        type: 'usage',
        tokensIn: 1_200,
        tokensOut: 300,
        cachedTokensHit: 400,
        cachedTokensCreated: 100,
      };
      yield { type: 'finished', reason: 'stop' };
      return;
    }

    if (hasToolResult) {
      yield { type: 'text-delta', text: 'parent final answer' };
      yield { type: 'finished', reason: 'stop' };
      return;
    }

    yield {
      type: 'tool-call',
      toolCall: {
        id: 'parent-delegate',
        name: 'agent_delegate',
      argumentsJson: JSON.stringify({
        task: 'child delegation task',
        agentId: 'agent-code-reviewer',
        ...(this.childTerminal === 'budget' ? { tokenBudget: 1 } : {}),
        ...(this.childTerminal === 'timeout' ? { timeoutSeconds: 1 } : {}),
      }),
      },
    };
    yield { type: 'finished', reason: 'tool-requests' };
  }
}

class ReadOnlyProbeChildProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const hasToolResult = request.messages.some((message) => message.role === 'tool');
    const userText = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');

    if (userText.includes('child write probe')) {
      if (hasToolResult) {
        yield { type: 'text-delta', text: 'child refused' };
        yield { type: 'finished', reason: 'stop' };
        return;
      }
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'child-write-file',
          name: 'write_file',
          argumentsJson: JSON.stringify({ path: 'child-probe.txt', content: 'probe' }),
        },
      };
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'child-run-command',
          name: 'run_command',
          argumentsJson: JSON.stringify({ command: 'echo probe' }),
        },
      };
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'child-create-agent',
          name: 'create_agent',
          argumentsJson: JSON.stringify({ name: 'sneaky-child-agent' }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }

    if (hasToolResult) {
      yield { type: 'text-delta', text: 'parent final answer' };
      yield { type: 'finished', reason: 'stop' };
      return;
    }

    yield {
      type: 'tool-call',
      toolCall: {
        id: 'parent-delegate',
        name: 'agent_delegate',
        argumentsJson: JSON.stringify({ task: 'child write probe', agentId: 'agent-code-reviewer' }),
      },
    };
    yield { type: 'finished', reason: 'tool-requests' };
  }
}

class McpProbeChildProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const hasToolResult = request.messages.some((message) => message.role === 'tool');
    const userText = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');

    if (userText.includes('child mcp probe')) {
      if (hasToolResult) {
        yield { type: 'text-delta', text: 'child refused the mcp tool' };
        yield { type: 'finished', reason: 'stop' };
        return;
      }
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'child-mcp-probe',
          name: 'mcp__demo__deploy_probe',
          argumentsJson: JSON.stringify({ target: 'demo-fixture' }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }

    if (hasToolResult) {
      yield { type: 'text-delta', text: 'parent final answer' };
      yield { type: 'finished', reason: 'stop' };
      return;
    }

    yield {
      type: 'tool-call',
      toolCall: {
        id: 'parent-delegate',
        name: 'agent_delegate',
        argumentsJson: JSON.stringify({ task: 'child mcp probe', agentId: 'agent-code-reviewer' }),
      },
    };
    yield { type: 'finished', reason: 'tool-requests' };
  }
}

class ParallelDelegationProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];
  activeChildren = 0;
  maxConcurrentChildren = 0;

  constructor(private readonly failureTask?: string) {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const hasToolResult = request.messages.some((message) => message.role === 'tool');
    const userText = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n');

    if (userText.includes('parallel child')) {
      this.activeChildren += 1;
      this.maxConcurrentChildren = Math.max(this.maxConcurrentChildren, this.activeChildren);
      await new Promise((resolve) => setTimeout(resolve, 30));
      this.activeChildren -= 1;
      if (this.failureTask && userText.includes(this.failureTask)) {
        yield { type: 'error', failureClass: 'acceptance', message: 'parallel child fixture failure' };
        return;
      }
      yield { type: 'text-delta', text: `result for ${userText}` };
      yield { type: 'finished', reason: 'stop' };
      return;
    }

    if (hasToolResult) {
      yield { type: 'text-delta', text: 'parallel parent final answer' };
      yield { type: 'finished', reason: 'stop' };
      return;
    }

    for (const [id, task] of [
      ['parallel-a', 'parallel child A'],
      ['parallel-b', 'parallel child B'],
    ] as const) {
      yield {
        type: 'tool-call',
        toolCall: {
          id,
          name: 'agent_delegate',
          argumentsJson: JSON.stringify({
            task,
            agentId: 'agent-code-reviewer',
            parallelGroup: 'parallel-review',
          }),
        },
      };
    }
    yield { type: 'finished', reason: 'tool-requests' };
  }
}

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function createInbox(socket: Socket) {
  const queued: Frame[] = [];
  const responseWaiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = responseWaiters.get(frame.id);
      if (frame.kind === 'response' && waiter) {
        responseWaiters.delete(frame.id);
        waiter(frame);
      } else {
        queued.push(frame);
      }
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => responseWaiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
    queued,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

async function hello(
  inbox: ReturnType<typeof createInbox>,
  installId: string,
  id: string,
): Promise<void> {
  const response = await inbox.send({
    id,
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: id,
      features: ['task.appendMessage', 'conversation.transientStream'],
    },
  });
  expect(response.error).toBeUndefined();
}

async function createFixture(events: () => AdapterEvent[], tickMs: number = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-transient-stream-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = 'workspace-transient-stream' as WorkspaceId;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const store = new SqliteEventCheckpointStore(connection.raw);
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    demoProvider: new ScriptedProvider(events, tickMs),
  });
  await runtime.start();
  return { connection, installId, runtime, store, workspaceId };
}

async function createDelegationFixture(
  provider: ProviderAdapter,
  options: { existingAgent?: boolean; dynamicSubagentsEnabled?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-delegation-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `delegation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = `workspace-delegation-${Date.now()}` as WorkspaceId;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const store = new SqliteEventCheckpointStore(connection.raw);
  const appSettingStore = new SqliteAppSettingStore(connection.raw);
  appSettingStore.set(COLLABORATION_SETTINGS_KEY, {
    dynamicSubagentsEnabled: options.dynamicSubagentsEnabled !== false,
  });
  const messageStore = new SqliteMessageStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: 'Delegation fixture',
    folderPath: dir,
    allowedRoots: [dir],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: 'Delegation fixture',
    goal: 'Verify dynamic child Agent execution',
  });
  const existingAgent = options.existingAgent !== false
    ? globalAgentStore.create({
        id: 'agent-code-reviewer' as never,
        name: 'child delegation task reviewer',
        defaultModelId: 'fake-mini' as ModelId,
        persona: 'Focused child delegation task reviewer',
        description: 'Matches child delegation task work',
      })
    : undefined;
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    messageStore,
    workspaceStore,
    globalAgentStore,
    appSettingStore,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    demoProvider: provider,
  });
  await runtime.start();
  return {
    connection,
    existingAgent,
    globalAgentStore,
    installId,
    messageStore,
    runtime,
    store,
    task,
    workspaceId,
  };
}

async function createNativePlanningFixture(events: () => AdapterEvent[]) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-native-planning-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `native-planning-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = `workspace-native-planning-${Date.now()}` as WorkspaceId;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const store = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: 'Native planning fixture',
    folderPath: dir,
    allowedRoots: [dir],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: 'Native planning fixture',
    goal: 'Verify missing formal plan completion guard',
  });
  const conversation = conversationStore.create({
    target: { track: 'model', modelId: 'fake-mini' as ModelId },
    workspaceId,
    title: 'Native planning fixture',
    interactionMode: 'plan',
  });
  conversationStore.bindTask(conversation.id, task.taskId);
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    messageStore,
    workspaceStore,
    conversationStore,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    demoProvider: new ScriptedProvider(events),
  });
  await runtime.start();
  return {
    connection,
    conversation,
    conversationStore,
    installId,
    messageStore,
    runtime,
    store,
    task,
    workspaceId,
  };
}

async function createPartialMessageFixture(terminal: 'failed' | 'cancelled') {
  const dir = mkdtempSync(join(tmpdir(), `sync-think-partial-${terminal}-`));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `partial-${terminal}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = `workspace-partial-${terminal}` as WorkspaceId;
  const threadId = `thread-partial-${terminal}`;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, `task-partial-${terminal}`, '2026-07-28T00:00:00.000Z');
  const store = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const provider = new PartialTerminalProvider(terminal);
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    messageStore,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    demoProvider: provider,
  });
  await runtime.start();
  return { connection, installId, messageStore, provider, runtime, store, threadId, workspaceId };
}

async function createReasoningOnlyMessageFixture(terminal: 'completed' | 'failed' | 'cancelled') {
  const dir = mkdtempSync(join(tmpdir(), `sync-think-reasoning-only-${terminal}-`));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `reasoning-only-${terminal}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = `workspace-reasoning-only-${terminal}` as WorkspaceId;
  const threadId = `thread-reasoning-only-${terminal}`;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run(threadId, `task-reasoning-only-${terminal}`, '2026-08-07T00:00:00.000Z');
  const store = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const provider = new ReasoningOnlyTerminalProvider(terminal);
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore: store,
    messageStore,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    demoProvider: provider,
  });
  await runtime.start();
  return { connection, installId, messageStore, provider, runtime, store, threadId, workspaceId };
}

function transientFrames(inbox: ReturnType<typeof createInbox>): ConversationTransientFrame[] {
  return inbox.queued
    .filter((frame) => frame.kind === 'event' && frame.type === 'conversation.transientFrame')
    .map((frame) => (frame.payload as { frame: ConversationTransientFrame }).frame);
}

describe('conversation transient shadow stream', () => {
  it('fails a native planning run that finishes without submitting a formal plan', async () => {
    let round = 0;
    const fixture = await createNativePlanningFixture(() => {
      round += 1;
      if (round === 1) {
        return [
          {
            type: 'tool-call',
            toolCall: {
              id: 'native-plan-progress-only',
              name: 'update_task_plan',
              argumentsJson: JSON.stringify({
                items: [{ title: '分析问题', status: 'completed' }],
              }),
            },
          },
          { type: 'finished', reason: 'tool-requests' },
        ];
      }
      return [
        {
          type: 'assistant-message-delta',
          phase: 'final_answer',
          itemId: 'native-plan-prose-only',
          text: '方案已经创建完成。',
        },
        { type: 'finished', reason: 'stop' },
      ];
    });
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-native-planning');
      const append = await inbox.send({
        id: 'append-native-planning',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: '给我一份实施方案',
        },
      });
      expect(append.error).toBeUndefined();
      const runId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(runId).not.toBe('');
      expect(
        await waitFor(() =>
          fixture.store
            .listEventsByRun(runId)
            .some((event) => event.type === 'run.completed' || event.type === 'run.failed'),
        ),
      ).toBe(true);

      const events = fixture.store.listEventsByRun(runId);
      expect(events.filter((event) => event.type === 'conversation.plan_submitted')).toHaveLength(0);
      expect(events.filter((event) => event.type === 'run.completed')).toHaveLength(0);
      expect(events.filter((event) => event.type === 'run.failed')).toHaveLength(1);
      expect(events.at(-1)).toMatchObject({
        type: 'run.failed',
        payload: {
          failureClass: 'protocol',
          errorMessage: '规划轮已结束，但没有提交正式方案。请重试 /plan。',
          assistantText: '',
        },
      });
      expect(fixture.conversationStore.getConversationPlan(fixture.conversation.id)).toBeUndefined();
      expect(fixture.conversationStore.get(fixture.conversation.id)?.interactionMode).toBe('plan');
      const assistant = fixture.messageStore
        .listMessages(fixture.task.threadId as never)
        .messages.find((message: Message) => message.role === 'assistant');
      expect(assistant?.blocks).not.toContainEqual({ type: 'text', text: '方案已经创建完成。' });
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it.each(['failed', 'cancelled'] as const)(
    'persists partial assistant text when a run is %s',
    async (terminal) => {
      const fixture = await createPartialMessageFixture(terminal);
      const socket = await connectRuntime(fixture.installId);
      const inbox = createInbox(socket);
      try {
        await hello(inbox, fixture.installId, `hello-partial-${terminal}`);
        const append = await inbox.send({
          id: `append-partial-${terminal}`,
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: fixture.threadId,
            expectedTaskVersion: 0,
            role: 'user',
            text: `start ${terminal} run`,
          },
        });
        expect(append.error).toBeUndefined();
        const runId = String((append.payload as { streamId?: string }).streamId ?? '');
        expect(await waitFor(() => fixture.provider.emitted)).toBe(true);
        if (terminal === 'cancelled') {
          const cancelled = await inbox.send({
            id: 'cancel-partial-run',
            kind: 'request',
            type: 'run.cancel',
            payload: { runId },
          });
          expect(cancelled.error).toBeUndefined();
        }
        expect(
          await waitFor(() =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .some((event) => event.type === `run.${terminal}`),
          ),
        ).toBe(true);

        const assistant = fixture.messageStore
          .listMessages(fixture.threadId as never)
          .messages.find((message: Message) => message.role === 'assistant');
        expect(assistant?.blocks.map((block) => block.type)).toEqual([
          'commentary',
          'text',
          'error',
        ]);
        expect(assistant?.blocks[0]?.payload).toMatchObject({
          assistantTimeline: [
            expect.objectContaining({
              kind: 'text',
              phase: 'final_answer',
              text: 'partial answer',
              status: 'completed',
            }),
          ],
        });
        expect(assistant?.blocks[1]).toEqual({ type: 'text', text: 'partial answer' });
        expect(assistant?.blocks[2]).toEqual(
          expect.objectContaining({
            type: 'error',
            payload: expect.objectContaining({ terminalState: terminal }),
          }),
        );
      } finally {
        socket.destroy();
        await fixture.runtime.stop();
        fixture.connection.raw.close();
      }
    },
  );

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'persists a reasoning-only assistant message when a run is %s',
    async (terminal) => {
      const fixture = await createReasoningOnlyMessageFixture(terminal);
      const socket = await connectRuntime(fixture.installId);
      const inbox = createInbox(socket);
      try {
        await hello(inbox, fixture.installId, `hello-reasoning-only-${terminal}`);
        const append = await inbox.send({
          id: `append-reasoning-only-${terminal}`,
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: fixture.threadId,
            expectedTaskVersion: 0,
            role: 'user',
            text: `start reasoning-only ${terminal} run`,
          },
        });
        expect(append.error).toBeUndefined();
        const runId = String((append.payload as { streamId?: string }).streamId ?? '');
        expect(await waitFor(() => fixture.provider.emitted)).toBe(true);
        if (terminal === 'cancelled') {
          const cancelled = await inbox.send({
            id: 'cancel-reasoning-only-run',
            kind: 'request',
            type: 'run.cancel',
            payload: { runId },
          });
          expect(cancelled.error).toBeUndefined();
        }
        expect(
          await waitFor(() =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .some((event) => event.type === `run.${terminal}`),
          ),
        ).toBe(true);

        const assistant = fixture.messageStore
          .listMessages(fixture.threadId as never)
          .messages.find((message: Message) => message.role === 'assistant');
        expect(assistant?.blocks[0]?.payload).toMatchObject({
          assistantTimeline: [
            expect.objectContaining({
              kind: 'thinking',
              text: 'reasoning-only summary',
              status: 'completed',
            }),
          ],
        });
        expect(assistant?.blocks[1]).toMatchObject({
          type: 'reasoning',
          reasoningText: 'reasoning-only summary',
        });
        if (terminal === 'completed') {
          expect(assistant?.blocks).toHaveLength(2);
        } else {
          expect(assistant?.blocks[2]).toEqual(
            expect.objectContaining({
              type: 'error',
              payload: expect.objectContaining({ terminalState: terminal }),
            }),
          );
        }
      } finally {
        socket.destroy();
        await fixture.runtime.stop();
        fixture.connection.raw.close();
      }
    },
  );

  it('delivers process, text, reasoning, and terminal frames without persisting delta events', async () => {
    const fixture = await createFixture(() => [
      { type: 'reasoning-delta', text: 'think' },
      { type: 'text-delta', text: 'answer' },
      { type: 'finished', reason: 'stop' },
    ]);
    const socketA = await connectRuntime(fixture.installId);
    const socketB = await connectRuntime(fixture.installId);
    const inboxA = createInbox(socketA);
    const inboxB = createInbox(socketB);
    try {
      await hello(inboxA, fixture.installId, 'hello-a');
      await hello(inboxB, fixture.installId, 'hello-b');
      const subscribedA = await inboxA.send({
        id: 'subscribe-a',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-a', afterStreamSequence: 0 },
      });
      await inboxB.send({
        id: 'subscribe-b',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-b', afterStreamSequence: 0 },
      });
      expect(subscribedA.payload).toMatchObject({
        threadId: 'thread-a',
        replayedFrames: [],
        latestStreamSequence: 0,
        resetRequired: false,
      });

      await inboxA.send({
        id: 'append-a',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-a',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'hello',
        },
      });
      expect(await waitFor(() => transientFrames(inboxA).length === 4)).toBe(true);
      expect(transientFrames(inboxA)).toMatchObject([
        { threadId: 'thread-a', streamSequence: 1, kind: 'process' },
        { threadId: 'thread-a', streamSequence: 2, kind: 'reasoning', textDelta: 'think' },
        { threadId: 'thread-a', streamSequence: 3, kind: 'text', textDelta: 'answer' },
        {
          threadId: 'thread-a',
          streamSequence: 4,
          kind: 'terminal',
          terminalState: 'completed',
        },
      ]);
      expect(transientFrames(inboxB)).toEqual([]);

      const durable = fixture.store.listEvents(fixture.workspaceId, 0);
      expect(durable.map((event) => event.type)).toContain('run.completed');
      expect(durable.map((event) => event.type)).not.toContain('message.reasoning_delta');
      expect(durable.map((event) => event.type)).not.toContain('message.delta');
      expect(durable.every((event) => Number.isSafeInteger(event.sequence))).toBe(true);
    } finally {
      socketA.destroy();
      socketB.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('replays frames after a thread-local cursor and stops delivery after unsubscribe', async () => {
    const fixture = await createFixture(() => [
      { type: 'reasoning-delta', text: 'r' },
      { type: 'text-delta', text: 't' },
      { type: 'finished', reason: 'stop' },
    ]);
    const producer = await connectRuntime(fixture.installId);
    const producerInbox = createInbox(producer);
    const subscriber = await connectRuntime(fixture.installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(producerInbox, fixture.installId, 'hello-producer');
      await hello(subscriberInbox, fixture.installId, 'hello-subscriber');
      await producerInbox.send({
        id: 'append-before-replay',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-replay',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'first',
        },
      });
      expect(
        await waitFor(() =>
          fixture.store
            .listEvents(fixture.workspaceId, 0)
            .some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);

      const subscribed = await subscriberInbox.send({
        id: 'subscribe-replay',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-replay', afterStreamSequence: 1 },
      });
      expect(subscribed.payload).toMatchObject({
        latestStreamSequence: 4,
        resetRequired: false,
        replayedFrames: [
          { streamSequence: 2, kind: 'reasoning' },
          { streamSequence: 3, kind: 'text' },
          { streamSequence: 4, kind: 'terminal' },
        ],
      });
      const streamId = (subscribed.payload as { streamId: string }).streamId;
      const unsubscribed = await subscriberInbox.send({
        id: 'unsubscribe-replay',
        kind: 'request',
        type: 'conversation.unsubscribeTransientStream',
        payload: { streamId },
      });
      expect(unsubscribed.payload).toEqual({ streamId });

      await producerInbox.send({
        id: 'append-after-unsubscribe',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-replay',
          expectedTaskVersion: 1,
          role: 'user',
          text: 'second',
        },
      });
      expect(
        await waitFor(
          () =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .filter((event) => event.type === 'run.completed').length === 2,
        ),
      ).toBe(true);
      expect(transientFrames(subscriberInbox)).toEqual([]);
    } finally {
      producer.destroy();
      subscriber.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('returns an active snapshot when replay reset is required mid-run', async () => {
    let releaseCompletion!: () => void;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    class PausedProvider implements ProviderAdapter {
      readonly protocol = 'openai-chat' as const;
      async discoverModels(): Promise<string[]> {
        return ['fake-mini'];
      }
      async *call(_request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
        for (let index = 0; index < 260; index++) {
          yield {
            type: 'assistant-message-delta',
            phase: 'final_answer',
            itemId: 'final-snapshot',
            text: 'x',
          };
        }
        await completionGate;
        yield { type: 'finished', reason: 'stop' };
      }
    }

    const dir = mkdtempSync(join(tmpdir(), 'sync-think-transient-snapshot-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-transient-snapshot' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: new PausedProvider(),
    });
    await runtime.start();
    const producer = await connectRuntime(installId);
    const producerInbox = createInbox(producer);
    const subscriber = await connectRuntime(installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(producerInbox, installId, 'hello-snapshot-producer');
      await hello(subscriberInbox, installId, 'hello-snapshot-subscriber');
      await producerInbox.send({
        id: 'append-snapshot',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-snapshot',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'produce active snapshot',
        },
      });
      expect(
        await waitFor(() => {
          const events = store.listEvents(workspaceId, 0);
          return (
            events.some((event) => event.type === 'run.started') &&
            !events.some((event) => event.type === 'run.completed')
          );
        }, 5_000),
      ).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const subscribed = await subscriberInbox.send({
        id: 'subscribe-snapshot',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-snapshot', afterStreamSequence: 0 },
      });
      expect(subscribed.payload).toMatchObject({
        latestStreamSequence: 261,
        resetRequired: true,
        snapshot: {
          threadId: 'thread-snapshot',
          streamSequence: 261,
          text: 'x'.repeat(260),
        },
      });
      const durableTypes = store.listEvents(workspaceId, 0).map((event) => event.type);
      expect(durableTypes).not.toContain('message.delta');
      expect(durableTypes).not.toContain('message.reasoning_delta');
    } finally {
      releaseCompletion();
      producer.destroy();
      subscriber.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
  it('signals resetRequired for a cursor ahead of the Runtime without rejecting the subscription', async () => {
    const fixture = await createFixture(() => []);
    const subscriber = await connectRuntime(fixture.installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(subscriberInbox, fixture.installId, 'hello-ahead-subscriber');
      const subscribed = await subscriberInbox.send({
        id: 'subscribe-ahead',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-ahead', afterStreamSequence: 99 },
      });
      expect(subscribed.error).toBeUndefined();
      expect(subscribed.payload).toMatchObject({
        threadId: 'thread-ahead',
        replayedFrames: [],
        latestStreamSequence: 0,
        resetRequired: true,
      });
    } finally {
      subscriber.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('keeps 1000 output chunks transient while persisting one terminal boundary', async () => {
    const fixture = await createFixture(
      () => [
        ...Array.from({ length: 1_000 }, (_, index) =>
          index % 2 === 0
            ? ({ type: 'text-delta', text: 'a' } as const)
            : ({ type: 'reasoning-delta', text: 'r' } as const),
        ),
        { type: 'finished', reason: 'stop' } as const,
      ],
      0,
    );
    const producer = await connectRuntime(fixture.installId);
    const producerInbox = createInbox(producer);
    try {
      await hello(producerInbox, fixture.installId, 'hello-1000-deltas');
      await producerInbox.send({
        id: 'append-1000-deltas',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-1000-deltas',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'stream 1000 chunks',
        },
      });
      expect(
        await waitFor(
          () =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .some((event) => event.type === 'run.completed'),
          10_000,
        ),
      ).toBe(true);

      const durable = fixture.store.listEvents(fixture.workspaceId, 0);
      expect(durable.filter((event) => event.type === 'message.delta')).toHaveLength(0);
      expect(durable.filter((event) => event.type === 'message.reasoning_delta')).toHaveLength(0);
      expect(durable.filter((event) => event.type === 'run.completed')).toHaveLength(1);
      const completed = durable.find((event) => event.type === 'run.completed');
      expect(String(completed?.payload.assistantText ?? '')).toHaveLength(500);
      expect(String(completed?.payload.reasoningText ?? '')).toHaveLength(500);
      // The exact count includes message/run intent boundaries, but must remain
      // constant rather than growing with the 1000 provider chunks.
      expect(durable.length).toBeLessThan(20);
    } finally {
      producer.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
  it('signals resetRequired when a cursor falls outside the bounded replay window', async () => {
    const fixture = await createFixture(
      () => [
        ...Array.from(
          { length: 260 },
          () =>
            ({
              type: 'assistant-message-delta',
              phase: 'final_answer',
              itemId: 'final-reset',
              text: 'x',
            }) as const,
        ),
        { type: 'finished', reason: 'stop' } as const,
      ],
      0,
    );
    const producer = await connectRuntime(fixture.installId);
    const producerInbox = createInbox(producer);
    const subscriber = await connectRuntime(fixture.installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(producerInbox, fixture.installId, 'hello-reset-producer');
      await hello(subscriberInbox, fixture.installId, 'hello-reset-subscriber');
      await producerInbox.send({
        id: 'append-reset',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-reset',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'produce many frames',
        },
      });
      expect(
        await waitFor(
          () =>
            fixture.store
              .listEvents(fixture.workspaceId, 0)
              .some((event) => event.type === 'run.completed'),
          5_000,
        ),
      ).toBe(true);

      const subscribed = await subscriberInbox.send({
        id: 'subscribe-reset',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        // cursor > 0 keeps the full replay contract: a short disconnect still
        // fills its gap even after the Run finished.
        payload: { threadId: 'thread-reset', afterStreamSequence: 1 },
      });
      const payload = subscribed.payload as {
        replayedFrames: ConversationTransientFrame[];
        latestStreamSequence: number;
        resetRequired: boolean;
      };
      expect(payload.latestStreamSequence).toBe(262);
      expect(payload.resetRequired).toBe(true);
      expect(payload.replayedFrames).toHaveLength(256);
      expect(payload.replayedFrames[0]?.streamSequence).toBe(7);
      expect(payload.replayedFrames.at(-1)).toMatchObject({
        streamSequence: 262,
        kind: 'terminal',
      });
    } finally {
      producer.destroy();
      subscriber.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('serves only the terminal boundary for a fresh subscription to a finished run', async () => {
    const fixture = await createFixture(() => [
      { type: 'reasoning-delta', text: 'r' },
      { type: 'text-delta', text: 't' },
      { type: 'finished', reason: 'stop' },
    ]);
    const producer = await connectRuntime(fixture.installId);
    const producerInbox = createInbox(producer);
    const subscriber = await connectRuntime(fixture.installId);
    const subscriberInbox = createInbox(subscriber);
    try {
      await hello(producerInbox, fixture.installId, 'hello-finished-producer');
      await hello(subscriberInbox, fixture.installId, 'hello-finished-subscriber');
      await producerInbox.send({
        id: 'append-finished-run',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-finished-replay',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'already done',
        },
      });
      expect(
        await waitFor(() =>
          fixture.store
            .listEvents(fixture.workspaceId, 0)
            .some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);

      const subscribed = await subscriberInbox.send({
        id: 'subscribe-finished-replay',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: 'thread-finished-replay', afterStreamSequence: 0 },
      });
      const payload = subscribed.payload as {
        replayedFrames: ConversationTransientFrame[];
        resetRequired: boolean;
      };
      // A finished Run is restored from the durable message store, so a fresh
      // subscription must not re-stream its prose frame by frame.
      expect(payload.replayedFrames.map((frame) => frame.kind)).toEqual(['terminal']);
      expect(payload.resetRequired).toBe(false);
    } finally {
      producer.destroy();
      subscriber.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('runs a delegated child through an existing Agent without promoting child text to the parent answer', async () => {
      const existingAgent = true;
      const expectedKind = 'existing' as const;
      const provider = new DelegationProvider();
      const fixture = await createDelegationFixture(provider, { existingAgent });
      const socket = await connectRuntime(fixture.installId);
      const inbox = createInbox(socket);
      try {
        await hello(inbox, fixture.installId, 'hello-delegation-existing');
        const subscription = await inbox.send({
          id: 'subscribe-delegation-existing',
          kind: 'request',
          type: 'conversation.subscribeTransientStream',
          payload: { threadId: fixture.task.threadId, afterStreamSequence: 0 },
        });
        expect(subscription.error).toBeUndefined();

        const append = await inbox.send({
          id: 'append-delegation-existing',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: fixture.task.threadId,
            expectedTaskVersion: 0,
            role: 'user',
            text: 'delegate child work',
          },
        });
        expect(append.error).toBeUndefined();
        const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
        expect(parentRunId).not.toBe('');
        expect(
          await waitFor(() =>
            fixture.store
              .listEventsByRun(parentRunId)
              .some((event) => event.type === 'run.completed'),
          ),
        ).toBe(true);

        const parentEvents = fixture.store.listEventsByRun(parentRunId);
        const delegateResultEvent = parentEvents.find(
          (event) => event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate',
        );
        expect(delegateResultEvent).toBeDefined();
        const delegateToolCallId = String(delegateResultEvent?.payload.toolCallId ?? '');
        expect(delegateToolCallId).not.toBe('');
        const delegateResult = JSON.parse(String(delegateResultEvent?.payload.result)) as {
          childRunId: string;
          assignment: { kind: string; agentId: string | null };
          result: string;
          toolEvents: Array<{ toolName: string; status: string }>;
        };
        expect(delegateResult.assignment.kind).toBe(expectedKind);
        expect(delegateResult.assignment.agentId).toBe(
          expectedKind === 'existing' ? fixture.existingAgent?.id : null,
        );
        expect(delegateResult.result).toBe('child result only');
        expect(delegateResult.toolEvents).toEqual([
          expect.objectContaining({ toolName: 'list_files', status: 'completed' }),
        ]);

        const childEvents = fixture.store.listEventsByRun(delegateResult.childRunId as RunId);
        expect(childEvents.map((event) => event.type)).toContain('run.completed');
        expect(childEvents.map((event) => event.type)).toContain('tool.completed');

        const delegatedFrames = transientFrames(inbox).filter((frame) => frame.delegatedAgent);
        expect(delegatedFrames.length).toBeGreaterThan(0);
        expect(
          await waitFor(() =>
            transientFrames(inbox).some(
              (frame) =>
                frame.delegatedAgent?.childRunId === delegateResult.childRunId &&
                frame.delegatedAgent.status === 'completed',
            ),
          ),
        ).toBe(true);
        const completedDelegatedFrame = transientFrames(inbox).findLast(
          (frame) =>
            frame.delegatedAgent?.childRunId === delegateResult.childRunId &&
            frame.delegatedAgent.status === 'completed',
        );
        expect(completedDelegatedFrame?.delegatedAgent).toMatchObject({
          childRunId: delegateResult.childRunId,
          parentRunId,
          kind: expectedKind,
          status: 'completed',
          result: 'child result only',
          // Anchored to the parent's own tool row, so the card can sit under its
          // `agent_delegate` row from the first frame instead of waiting for the
          // durable result to reveal childRunId.
          parentToolCallId: delegateToolCallId,
          // The child bills separately from its parent, so its spend rides the
          // projection for the card to show.
          usage: {
            tokensIn: 1_200,
            tokensOut: 300,
            cachedTokensHit: 400,
            cachedTokensCreated: 100,
          },
          toolEvents: [expect.objectContaining({ toolName: 'list_files', status: 'completed' })],
        });
        expect(provider.requests.length).toBeGreaterThanOrEqual(4);

        const messages = fixture.messageStore.listMessages(fixture.task.threadId as never).messages;
        const assistants = messages.filter((message: Message) => message.role === 'assistant');
        expect(assistants).toHaveLength(1);
        expect(assistants[0]?.runId).toBe(parentRunId);
        expect(assistants[0]?.blocks.filter((block) => block.type === 'text')).toEqual([
          { type: 'text', text: 'parent final answer' },
        ]);
        expect(
          messages.some((message: Message) => message.runId === delegateResult.childRunId),
        ).toBe(false);
      } finally {
        socket.destroy();
        await fixture.runtime.stop();
        fixture.connection.raw.close();
      }
    });

  it('binds a reused Agent persona into the child run', async () => {
    const reuseProvider = new DelegationProvider();
    const reuseFixture = await createDelegationFixture(reuseProvider, { existingAgent: true });
    const reuseSocket = await connectRuntime(reuseFixture.installId);
    const reuseInbox = createInbox(reuseSocket);
    try {
      await hello(reuseInbox, reuseFixture.installId, 'hello-delegation-reused-agent');
      const subscription = await reuseInbox.send({
        id: 'subscribe-delegation-reused-agent',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: reuseFixture.task.threadId, afterStreamSequence: 0 },
      });
      expect(subscription.error).toBeUndefined();
      const append = await reuseInbox.send({
        id: 'append-delegation-reused-agent',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: reuseFixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(() =>
          reuseFixture.store
            .listEventsByRun(parentRunId)
            .some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);

      const childRequests = reuseProvider.requests.filter((request) =>
        request.messages
          .filter((message) => message.role === 'user')
          .map((message) => (typeof message.content === 'string' ? message.content : ''))
          .join('\n')
          .includes('child delegation task'),
      );
      expect(childRequests.length).toBeGreaterThan(0);
      expect(
        childRequests.some((request) =>
          (request.systemPrompt ?? '').includes('Focused child delegation task reviewer'),
        ),
      ).toBe(true);
      expect(
        transientFrames(reuseInbox).some(
          (frame) => frame.delegatedAgent?.agentId === reuseFixture.existingAgent?.id,
        ),
      ).toBe(true);
      expect(reuseFixture.globalAgentStore.list()).toHaveLength(1);
    } finally {
      reuseSocket.destroy();
      await reuseFixture.runtime.stop();
      reuseFixture.connection.raw.close();
    }

  });

  it('rejects delegation when the requested Agent is not active', async () => {
    const provider = new DelegationProvider();
    const fixture = await createDelegationFixture(provider, { existingAgent: false });
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-no-agent');
      const append = await inbox.send({
        id: 'append-delegation-no-agent',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const delegateEvent = fixture.store
        .listEventsByRun(parentRunId)
        .find((event) => event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate');
      const result = JSON.parse(String(delegateEvent?.payload.result)) as {
        ok: boolean;
        code?: string;
        error?: string;
        childRunId?: string;
      };
      expect(result.ok).toBe(false);
      expect(result.code).toBe('AGENT_UNAVAILABLE');
      expect(result.error).toContain('not active in workspace');
      expect(result.childRunId).toBeUndefined();
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('rejects agent_delegate while the model-conversation delegation switch is off', async () => {
    const provider = new DelegationProvider();
    const fixture = await createDelegationFixture(provider, { dynamicSubagentsEnabled: false });
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-disabled');
      const append = await inbox.send({
        id: 'append-delegation-disabled',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const delegateEvent = fixture.store
        .listEventsByRun(parentRunId)
        .find(
          (event) =>
            event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate',
        );
      expect(delegateEvent).toBeDefined();
      const result = JSON.parse(String(delegateEvent?.payload.result)) as {
        ok: boolean;
        error: string;
        childRunId?: string;
      };
      expect(result.ok).toBe(false);
      expect(result.error).toContain('delegation rejected (disabled)');
      expect(result.error).toContain('模型对话向已有智能体的并发委派当前已关闭');
      expect(result.childRunId).toBeUndefined();
      expect(
        provider.requests.filter((request) =>
          request.messages
            .filter((message) => message.role === 'user')
            .map((message) => (typeof message.content === 'string' ? message.content : ''))
            .join('\n')
            .includes('child delegation task'),
        ),
      ).toHaveLength(0);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('keeps a delegated child inside the read-only tool allowlist', async () => {
    const provider = new ReadOnlyProbeChildProvider();
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-readonly');
      const append = await inbox.send({
        id: 'append-delegation-readonly',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const delegateEvent = fixture.store
        .listEventsByRun(parentRunId)
        .find(
          (event) =>
            event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate',
        );
      const result = JSON.parse(String(delegateEvent?.payload.result)) as {
        ok: boolean;
        childRunId: string;
        result: string;
      };
      expect(result.ok).toBe(true);
      expect(result.result).toBe('child refused');
      const childToolResults = fixture.store
        .listEventsByRun(result.childRunId as RunId)
        .filter((event) => event.type === 'tool.completed')
        .map((event) => JSON.parse(String(event.payload.result)) as { error?: string });
      expect(childToolResults).toHaveLength(3);
      for (const toolResult of childToolResults) {
        expect(toolResult.error).toContain('Delegated child Agents are limited to read-only tools.');
      }
      expect(fixture.globalAgentStore.list()).toHaveLength(1);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('refuses a delegated child that bypasses the tool catalog with an MCP tool', async () => {
    const provider = new McpProbeChildProvider();
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-mcp-readonly');
      const append = await inbox.send({
        id: 'append-delegation-mcp-readonly',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const delegateEvent = fixture.store
        .listEventsByRun(parentRunId)
        .find(
          (event) =>
            event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate',
        );
      const result = JSON.parse(String(delegateEvent?.payload.result)) as {
        ok: boolean;
        childRunId: string;
        result: string;
      };
      expect(result.ok).toBe(true);
      expect(result.result).toBe('child refused the mcp tool');
      const childToolResults = fixture.store
        .listEventsByRun(result.childRunId as RunId)
        .filter((event) => event.type === 'tool.completed')
        .map((event) => JSON.parse(String(event.payload.result)) as { error?: string });
      expect(childToolResults).toHaveLength(1);
      expect(childToolResults[0]?.error).toContain(
        'Delegated child Agents are limited to read-only tools.',
      );
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
  it('runs same-turn delegated children concurrently and preserves tool-call order', async () => {
    const provider = new ParallelDelegationProvider();
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-parallel');
      await inbox.send({
        id: 'subscribe-delegation-parallel',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: fixture.task.threadId, afterStreamSequence: 0 },
      });
      const append = await inbox.send({
        id: 'append-delegation-parallel',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'run two delegated reviews',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(
          () =>
            transientFrames(inbox).some(
              (frame) => frame.delegatedAgent?.parallelGroup === 'parallel-review',
            ),
          2_000,
        ),
      ).toBe(true);
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);

      expect(provider.maxConcurrentChildren).toBe(2);
      const delegateEvents = fixture.store
        .listEventsByRun(parentRunId)
        .filter((event) => event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate');
      expect(delegateEvents.map((event) => event.payload.toolCallId)).toEqual([
        'parallel-a',
        'parallel-b',
      ]);
      const results = delegateEvents.map((event) => JSON.parse(String(event.payload.result)) as {
        childRunId: string;
        parallelGroup?: string;
        result: string;
      });
      expect(results.map((result) => result.parallelGroup)).toEqual([
        'parallel-review',
        'parallel-review',
      ]);
      expect(new Set(results.map((result) => result.childRunId)).size).toBe(2);
      expect(results.map((result) => result.result)).toEqual([
        expect.stringContaining('parallel child A'),
        expect.stringContaining('parallel child B'),
      ]);
      expect(
        fixture.messageStore.listMessages(fixture.task.threadId as never).messages.filter(
          (message: Message) => message.role === 'assistant',
        ),
      ).toHaveLength(1);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('keeps a successful sibling running when another parallel child fails', async () => {
    const provider = new ParallelDelegationProvider('parallel child B');
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-parallel-partial');
      await inbox.send({
        id: 'subscribe-delegation-parallel-partial',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: fixture.task.threadId, afterStreamSequence: 0 },
      });
      const append = await inbox.send({
        id: 'append-delegation-parallel-partial',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'run two delegated reviews',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      expect(provider.maxConcurrentChildren).toBe(2);
      const results = fixture.store
        .listEventsByRun(parentRunId)
        .filter((event) => event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate')
        .map((event) => JSON.parse(String(event.payload.result)) as { ok: boolean; result?: string; error?: string });
      expect(results).toHaveLength(2);
      expect(results.find((result) => result.ok)?.result).toContain('parallel child A');
      expect(results.find((result) => !result.ok)?.error).toContain('child run failed');
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('returns a child failure to the parent and keeps the parent turn completable', async () => {
    const provider = new DelegationProvider('failed');
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-failed');
      await inbox.send({
        id: 'subscribe-delegation-failed',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: fixture.task.threadId, afterStreamSequence: 0 },
      });
      const append = await inbox.send({
        id: 'append-delegation-failed',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work after failure',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const delegateEvent = fixture.store
        .listEventsByRun(parentRunId)
        .find((event) => event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate');
      const result = JSON.parse(String(delegateEvent?.payload.result)) as {
        childRunId: string;
        ok: boolean;
        error: string;
      };
      expect(result.ok).toBe(false);
      expect(result.error).toContain('child run failed');
      expect(fixture.store.listEventsByRun(result.childRunId as RunId).map((event) => event.type)).toContain(
        'run.failed',
      );
      expect(
        await waitFor(() =>
          transientFrames(inbox).some(
            (frame) =>
              frame.delegatedAgent?.childRunId === result.childRunId &&
              frame.delegatedAgent.status === 'failed',
          ),
        ),
      ).toBe(true);
      expect(transientFrames(inbox).findLast(
        (frame) =>
          frame.delegatedAgent?.childRunId === result.childRunId &&
          frame.delegatedAgent.status === 'failed',
      )?.delegatedAgent).toMatchObject({
        childRunId: result.childRunId,
        status: 'failed',
      });
      expect(fixture.messageStore.listMessages(fixture.task.threadId as never).messages.filter(
        (message: Message) => message.role === 'assistant',
      )).toHaveLength(1);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it.each([
    { mode: 'budget' as const, expectedStatus: 'failed' as const },
    { mode: 'timeout' as const, expectedStatus: 'timed_out' as const },
  ])('enforces the delegated child $mode limit', async ({ mode, expectedStatus }) => {
    const provider = new DelegationProvider(mode);
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, `hello-delegation-${mode}`);
      await inbox.send({
        id: `subscribe-delegation-${mode}`,
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: fixture.task.threadId, afterStreamSequence: 0 },
      });
      const append = await inbox.send({
        id: `append-delegation-${mode}`,
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: `delegate child work ${mode}`,
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(
        await waitFor(
          () => fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
          5_000,
        ),
      ).toBe(true);
      const delegateEvent = fixture.store
        .listEventsByRun(parentRunId)
        .find((event) => event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate');
      const result = JSON.parse(String(delegateEvent?.payload.result)) as {
        childRunId: string;
        status?: string;
        error?: string;
        tokensUsed?: number;
      };
      expect(result.status).toBe(expectedStatus);
      expect(result.error).toContain(mode === 'budget' ? 'token budget' : 'timed out');
      if (mode === 'budget') expect(result.tokensUsed).toBeGreaterThan(0);
      expect(provider.requests.some((request) => request.maxOutputTokens === 1)).toBe(mode === 'budget');
      expect(
        await waitFor(() =>
          transientFrames(inbox).some(
            (frame) => frame.delegatedAgent?.status === expectedStatus,
          ),
          5_000,
        ),
      ).toBe(true);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('cancels an individual delegated child and lets the parent finish', async () => {
    const provider = new DelegationProvider('cancelled');
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-child-cancel');
      await inbox.send({
        id: 'subscribe-delegation-child-cancel',
        kind: 'request',
        type: 'conversation.subscribeTransientStream',
        payload: { threadId: fixture.task.threadId, afterStreamSequence: 0 },
      });
      const append = await inbox.send({
        id: 'append-delegation-child-cancel',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work and cancel child only',
        },
      });
      const parentRunId = String((append.payload as { streamId?: string }).streamId ?? '') as RunId;
      expect(await waitFor(() => provider.requests.length >= 2)).toBe(true);
      expect(
        await waitFor(() =>
          transientFrames(inbox).some((frame) => frame.delegatedAgent?.status === 'running'),
        ),
      ).toBe(true);
      const runningFrame = transientFrames(inbox).find(
        (frame) => frame.delegatedAgent?.status === 'running',
      );
      const childRunId = runningFrame?.delegatedAgent?.childRunId;
      expect(childRunId).toBeTruthy();
      const cancelled = await inbox.send({
        id: 'cancel-delegation-child-only',
        kind: 'request',
        type: 'run.cancel',
        payload: { runId: childRunId },
      });
      expect(cancelled.error).toBeUndefined();
      expect(
        await waitFor(() =>
          fixture.store.listEventsByRun(parentRunId).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      const delegateEvent = fixture.store
        .listEventsByRun(parentRunId)
        .find((event) => event.type === 'tool.completed' && event.payload.toolName === 'agent_delegate');
      expect(String(delegateEvent?.payload.result)).toContain('child run cancelled');
      expect(
        await waitFor(() =>
          transientFrames(inbox).some(
            (frame) =>
              frame.delegatedAgent?.childRunId === childRunId &&
              frame.delegatedAgent.status === 'cancelled',
          ),
        ),
      ).toBe(true);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('propagates parent cancellation to an in-flight child and preserves the delegated snapshot on reconnect', async () => {
    const provider = new DelegationProvider('cancelled');
    const fixture = await createDelegationFixture(provider);
    const socket = await connectRuntime(fixture.installId);
    const inbox = createInbox(socket);
    let parentRunId = '';
    try {
      await hello(inbox, fixture.installId, 'hello-delegation-cancelled');
      const append = await inbox.send({
        id: 'append-delegation-cancelled',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: fixture.task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'delegate child work and cancel',
        },
      });
      parentRunId = String((append.payload as { streamId?: string }).streamId ?? '');
      expect(await waitFor(() => provider.requests.length >= 2)).toBe(true);

      const reconnect = await connectRuntime(fixture.installId);
      const reconnectInbox = createInbox(reconnect);
      try {
        await hello(reconnectInbox, fixture.installId, 'hello-delegation-reconnect');
        const subscribed = await reconnectInbox.send({
          id: 'subscribe-delegation-reconnect',
          kind: 'request',
          type: 'conversation.subscribeTransientStream',
          payload: { threadId: fixture.task.threadId, afterStreamSequence: 0 },
        });
        expect(subscribed.payload).toMatchObject({
          snapshot: expect.objectContaining({
            runId: parentRunId,
            delegatedAgents: [expect.objectContaining({ status: 'running' })],
          }),
        });
      } finally {
        reconnect.destroy();
      }

      const cancelled = await inbox.send({
        id: 'cancel-delegation-parent',
        kind: 'request',
        type: 'run.cancel',
        payload: { runId: parentRunId },
      });
      expect(cancelled.error).toBeUndefined();
      expect(await waitFor(() => provider.childAborted)).toBe(true);
      expect(fixture.store.listEventsByRun(parentRunId).map((event) => event.type)).toContain(
        'run.cancelled',
      );
      expect(fixture.messageStore.listMessages(fixture.task.threadId as never).messages.filter(
        (message: Message) => message.role === 'assistant' && message.runId !== parentRunId,
      )).toHaveLength(0);
    } finally {
      socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});
