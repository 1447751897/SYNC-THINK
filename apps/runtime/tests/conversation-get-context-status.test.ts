import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AdapterEvent,
  ProviderAdapter,
  ProviderCallRequest,
  ProviderMessage,
  ProviderToolSchema,
} from '@sync-think/adapters';
import {
  COMPUTER_USE_PLUGIN_SETTING_KEY,
  decodeFrames,
  encodeFrame,
  parseConversationGetContextStatusResponse,
  pipePathPortable,
  type ConversationCompactResponse,
  type ConversationGetContextStatusResponse,
  type Frame,
} from '@sync-think/protocol';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import type { ConversationId, RunId, TaskId, ThreadId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  DEFAULT_CONVERSATION_AGENT_ID,
  SqliteAgentStore,
  SqliteAppSettingStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteMcpStore,
  SqliteMemoryStore,
  SqliteMessageStore,
  SqliteProviderStore,
  SqliteSkillStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { estimateProviderMessageTokens } from '../src/context-snapshot.js';
import { Runtime } from '../src/runtime.js';

const HIDDEN_REASONING = 'HIDDEN_REASONING_MUST_NOT_ENTER_CONTEXT';
const TASK_GOAL = 'Ship the S5 runtime context snapshot integration';
const ACCEPTANCE_CRITERION = 'Every displayed token count comes from the actual provider request';
const PROJECT_MEMORY = 'Runtime context snapshots are the sole occupancy source of truth';
const SKILL_BODY = 'SKILL_BODY_MARKER: always compare the context ring with the provider payload.';
const MCP_SCHEMA_MARKER = 'MCP_SCHEMA_MARKER_QUERY';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly retain SQLite handles after a test failure.
    }
  }
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function createFrameInbox(socket: Socket) {
  const frames: Frame[] = [];
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (waiter) {
        waiters.delete(frame.id);
        waiter(frame);
      } else {
        frames.push(frame);
      }
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
    frames,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

function cloneProviderMessage(message: ProviderMessage): ProviderMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : message.content,
  };
}

function cloneProviderTool(tool: ProviderToolSchema): ProviderToolSchema {
  return { ...tool, inputSchema: structuredClone(tool.inputSchema) };
}

class ContextRecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['context-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({
      ...request,
      apiKey: request.apiKey ? '[present]' : '',
      messages: request.messages.map(cloneProviderMessage),
      ...(request.tools ? { tools: request.tools.map(cloneProviderTool) } : {}),
    });
    yield { type: 'reasoning-delta', text: HIDDEN_REASONING };
    yield { type: 'text-delta', text: `assistant-final-${this.calls.length}` };
    yield { type: 'finished', reason: 'stop' };
  }
}

type FrameInbox = ReturnType<typeof createFrameInbox>;

interface RuntimeHarness {
  adapter: ContextRecordingAdapter;
  alternateModelId?: string;
  connection: Awaited<ReturnType<typeof openDatabaseAsync>>;
  conversationId: ConversationId;
  inbox: FrameInbox;
  runtime: Runtime;
  socket: Socket;
  skillStore: SqliteSkillStore;
  stateStore: SqliteEventCheckpointStore;
  taskId: TaskId;
  threadId: ThreadId;
  workspaceId: WorkspaceId;
}

interface CreateHarnessOptions {
  alternateContextWindow?: number;
  target?: 'agent' | 'model';
}

async function createHarness(
  contextWindow: number,
  options: CreateHarnessOptions = {},
): Promise<RuntimeHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-context-status-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const providerStore = new SqliteProviderStore(connection.raw);
  const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
  const agentStore = new SqliteAgentStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const memoryStore = new SqliteMemoryStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const skillStore = new SqliteSkillStore(connection.raw);
  const mcpStore = new SqliteMcpStore(connection.raw);
  const unitOfWork = new SqliteUnitOfWork(connection.raw);
  const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
  const storeHandle = await secureStore.storeSecret('sk-CONTEXT_STATUS_INTEGRATION_KEY');
  const provider = providerStore.createProvider({
    name: 'Context Status Gateway',
    baseUrl: 'https://context-status.example/v1',
    protocol: 'openai-chat',
    storeHandle,
  });
  const [model, alternateModel] = providerStore.upsertModels({
    providerId: provider.provider.id,
    protocol: 'openai-chat',
    models: [
      {
        providerModelId: 'context-model',
        displayName: 'Context Model',
        limitsJson: JSON.stringify({ contextWindow }),
      },
      ...(options.alternateContextWindow
        ? [
            {
              providerModelId: 'context-model-luna',
              displayName: 'Context Model Luna',
              limitsJson: JSON.stringify({
                contextWindow: options.alternateContextWindow,
              }),
            },
          ]
        : []),
    ],
  });
  if (!model) throw new Error('model fixture was not created');

  const skill = skillStore.importVersion({
    name: 'Context Snapshot Auditor',
    description: 'Verifies context snapshot truth',
    version: '1.0.0',
    sourceMd: `# Context Snapshot Auditor\n\n${SKILL_BODY}`,
    body: SKILL_BODY,
    contentFingerprint: `context-snapshot-${randomBytes(8).toString('hex')}`,
  });
  agentStore.ensureConversationAgent({ defaultModelId: model.id });
  agentStore.updateBinding({
    agentId: DEFAULT_CONVERSATION_AGENT_ID,
    defaultModelId: model.id,
    fallbackModelIds: [],
    pauseOnFailure: true,
    skillVersionIds: [skill.id],
  });
  const mcp = mcpStore.register({
    id: 'mcp-context-status',
    name: 'Context Status MCP',
    transport: 'remote-http',
    endpoint: 'https://mcp-context-status.example/rpc',
    trusted: true,
    tools: [
      {
        name: 'lookup_context',
        description: 'Look up context metadata',
        inputSchemaJson: JSON.stringify({
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string', description: MCP_SCHEMA_MARKER },
          },
        }),
      },
    ],
  });
  const agent = globalAgentStore.create({
    name: 'Context Snapshot Agent',
    persona: 'Keep context accounting exact and never expose hidden reasoning.',
    defaultModelId: model.id,
    skillIds: [skill.id],
    mcpServerIds: [mcp.id],
  });

  const workspaceId = 'workspace-context-status' as WorkspaceId;
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: 'Context Status Workspace',
    folderPath: dir,
    allowedRoots: [dir],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: 'S5 context snapshot',
    goal: TASK_GOAL,
    acceptanceCriteria: [ACCEPTANCE_CRITERION],
  });
  memoryStore.proposeChange({
    workspaceId,
    taskId: task.taskId,
    targetScope: 'project',
    additions: [
      {
        id: 'memory-context-status',
        key: 'context-source-of-truth',
        value: PROJECT_MEMORY,
        targetScope: 'project',
      },
    ],
    evidenceRefs: ['integration-test'],
    autoApprove: true,
  });
  const conversation = conversationStore.create({
    target:
      options.target === 'model'
        ? { track: 'model', modelId: model.id }
        : { track: 'agent', agentId: agent.id },
    workspaceId,
    title: 'S5 context status integration',
    executionMode: 'full-access',
  });
  conversationStore.bindTask(conversation.id, task.taskId);

  const installId = `context-status-${randomBytes(6).toString('hex')}`;
  const adapter = new ContextRecordingAdapter();
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    providerStore,
    agentStore,
    globalAgentStore,
    conversationStore,
    workspaceStore,
    memoryStore,
    messageStore,
    skillStore,
    mcpStore,
    unitOfWork,
    secureStore,
    discoveryByProtocol: { 'openai-chat': adapter },
  });
  await runtime.start();
  const socket = await connectRuntime(installId);
  const inbox = createFrameInbox(socket);
  const hello = await inbox.send({
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: ['task.appendMessage', 'conversation.getContextStatus', 'conversation.compact'],
    },
  });
  expect(hello.error).toBeUndefined();

  return {
    adapter,
    ...(alternateModel ? { alternateModelId: alternateModel.id } : {}),
    connection,
    conversationId: conversation.id,
    inbox,
    runtime,
    socket,
    skillStore,
    stateStore,
    taskId: task.taskId,
    threadId: task.threadId,
    workspaceId,
  };
}

async function closeHarness(harness: RuntimeHarness): Promise<void> {
  harness.socket.destroy();
  await harness.runtime.stop();
  harness.connection.raw.close();
}

async function appendUserMessage(
  harness: RuntimeHarness,
  text: string,
  expectedTaskVersion: number,
  requestId: string,
  skillVersionIds?: readonly string[],
): Promise<number> {
  const beforeCompleted = harness.stateStore
    .listEvents(harness.workspaceId, 0)
    .filter((event) => event.type === 'run.completed').length;
  const response = await harness.inbox.send({
    id: requestId,
    kind: 'request',
    type: 'task.appendMessage',
    payload: {
      threadId: harness.threadId,
      expectedTaskVersion,
      role: 'user',
      text,
      ...(skillVersionIds === undefined ? {} : { skillVersionIds: [...skillVersionIds] }),
    },
  });
  expect(response.error).toBeUndefined();
  const taskVersion = (response.payload as { taskVersion: number }).taskVersion;
  expect(
    await waitFor(
      () =>
        harness.stateStore
          .listEvents(harness.workspaceId, 0)
          .filter((event) => event.type === 'run.completed').length > beforeCompleted,
    ),
  ).toBe(true);
  return taskVersion;
}

async function getContextStatus(
  harness: RuntimeHarness,
  requestId: string,
  modelId?: string,
): Promise<ConversationGetContextStatusResponse> {
  const frame = await harness.inbox.send({
    id: requestId,
    kind: 'request',
    type: 'conversation.getContextStatus',
    payload: {
      conversationId: harness.conversationId,
      ...(modelId ? { modelId } : {}),
    },
  });
  expect(frame.error).toBeUndefined();
  return parseConversationGetContextStatusResponse(frame.payload);
}

function estimateTextTokens(text: string): number {
  return text ? Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4)) : 0;
}

function extractPromptSection(systemPrompt: string, heading: string): string {
  const start = systemPrompt.indexOf(heading);
  if (start < 0) return '';
  const headings = [
    '## System instructions',
    '## Agent / Team instructions',
    '## Project context',
    '## Compact summary',
  ];
  const next = headings
    .map((candidate) => systemPrompt.indexOf(candidate, start + heading.length))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  return systemPrompt.slice(start, next).trimEnd();
}

function expectedSectionsFromProviderRequest(request: ProviderCallRequest) {
  const prompt = String(request.systemPrompt ?? '');
  const systemBlock = extractPromptSection(prompt, '## System instructions');
  const agentBlock = extractPromptSection(prompt, '## Agent / Team instructions');
  const projectBlock = extractPromptSection(prompt, '## Project context');
  const summaryBlock = extractPromptSection(prompt, '## Compact summary');
  return [
    { type: 'system' as const, tokens: estimateTextTokens(systemBlock) },
    { type: 'agent' as const, tokens: estimateTextTokens(agentBlock) },
    { type: 'project' as const, tokens: estimateTextTokens(projectBlock) },
    { type: 'summary' as const, tokens: estimateTextTokens(summaryBlock) },
    {
      type: 'messages' as const,
      tokens: request.messages.reduce(
        (total, message) => total + estimateProviderMessageTokens(message),
        0,
      ),
    },
    {
      type: 'tools' as const,
      tokens: request.tools?.length ? estimateTextTokens(JSON.stringify(request.tools)) : 0,
    },
  ];
}

describe('conversation.getContextStatus runtime integration', () => {
  it('counts Computer Use schemas on a cache miss without a project or Agent tools', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-context-status-desktop-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const workspaceId = 'workspace-context-status-desktop' as WorkspaceId;
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Context Status Desktop',
    });
    const task = workspaceStore.createTask({
      workspaceId,
      title: 'Computer Use context status',
      goal: 'Count enabled Desktop tool schemas',
    });
    const conversation = conversationStore.create({
      target: { track: 'model', modelId: 'fake-mini' as never },
      workspaceId,
      title: 'Computer Use context status',
      executionMode: 'full-access',
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    appSettingStore.set(COMPUTER_USE_PLUGIN_SETTING_KEY, { enabled: true });

    const installId = `context-status-desktop-${randomBytes(6).toString('hex')}`;
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore,
      workspaceStore,
      conversationStore,
      appSettingStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: new ContextRecordingAdapter(),
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    try {
      const hello = await inbox.send({
        id: 'desktop-context-status-hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: ['conversation.getContextStatus'],
        },
      });
      expect(hello.error).toBeUndefined();

      const frame = await inbox.send({
        id: 'desktop-context-status',
        kind: 'request',
        type: 'conversation.getContextStatus',
        payload: { conversationId: conversation.id },
      });
      expect(frame.error).toBeUndefined();
      const status = parseConversationGetContextStatusResponse(frame.payload);
      expect(status.sections.find((section) => section.type === 'tools')?.tokens).toBeGreaterThan(
        0,
      );
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('uses task-indexed history for context status and compact maintenance', async () => {
    const harness = await createHarness(200);
    const listTaskEvents = vi.spyOn(harness.stateStore, 'listEventsByTask');
    const listAllEvents = vi.spyOn(harness.stateStore, 'listAllEvents').mockImplementation(() => {
      throw new Error('global event history must not be materialized');
    });
    try {
      const status = await getContextStatus(harness, 'task-indexed-status');
      expect(status.modelId).toBeDefined();

      let taskVersion = await appendUserMessage(
        harness,
        'task-indexed-compact-one-' + 'x'.repeat(1_000),
        0,
        'task-indexed-append-one',
        [],
      );
      taskVersion = await appendUserMessage(
        harness,
        'task-indexed-compact-two-' + 'y'.repeat(1_000),
        taskVersion,
        'task-indexed-append-two',
        [],
      );
      expect(taskVersion).toBe(2);

      const compact = await harness.inbox.send({
        id: 'task-indexed-compact',
        kind: 'request',
        type: 'conversation.compact',
        payload: {
          conversationId: harness.conversationId,
          mode: 'manual',
          keepRecent: 1,
        },
      });
      expect(compact.error).toBeUndefined();
      expect(listTaskEvents).toHaveBeenCalledWith(harness.taskId);
      expect(listAllEvents).not.toHaveBeenCalled();
    } finally {
      listTaskEvents.mockRestore();
      listAllEvents.mockRestore();
      await closeHarness(harness);
    }
  });

  it('does not load Skill bodies for status, peek, or compact maintenance paths', async () => {
    const harness = await createHarness(200);
    const getVersion = vi.spyOn(harness.skillStore, 'getVersion');
    try {
      const status = await getContextStatus(harness, 'maintenance-status');
      expect(status.modelId).toBeDefined();
      expect(getVersion).not.toHaveBeenCalled();

      getVersion.mockClear();
      const peek = await harness.inbox.send({
        id: 'maintenance-peek',
        kind: 'request',
        type: 'context.packet.peek',
        payload: { threadId: harness.threadId },
      });
      expect(peek.error).toBeUndefined();
      expect((peek.payload as { skillVersionIds?: string[] }).skillVersionIds).toEqual([]);
      expect(getVersion).not.toHaveBeenCalled();

      let taskVersion = await appendUserMessage(
        harness,
        'maintenance-compact-one-' + 'x'.repeat(1_000),
        0,
        'maintenance-append-one',
        [],
      );
      taskVersion = await appendUserMessage(
        harness,
        'maintenance-compact-two-' + 'y'.repeat(1_000),
        taskVersion,
        'maintenance-append-two',
        [],
      );
      expect(taskVersion).toBe(2);

      getVersion.mockClear();
      const compact = await harness.inbox.send({
        id: 'maintenance-compact',
        kind: 'request',
        type: 'conversation.compact',
        payload: {
          conversationId: harness.conversationId,
          mode: 'manual',
          keepRecent: 1,
        },
      });
      expect(compact.error).toBeUndefined();
      expect(getVersion).not.toHaveBeenCalled();
    } finally {
      getVersion.mockRestore();
      await closeHarness(harness);
    }
  });

  it('builds status for a model conversation without a bound agent', async () => {
    const harness = await createHarness(128_000, { target: 'model' });
    try {
      const status = await getContextStatus(harness, 'model-context-status');
      expect(status.modelId).toBeDefined();
      expect(status.contextWindow).toBe(128_000);
      expect(status.sections.find((section) => section.type === 'agent')?.tokens).toBeGreaterThan(
        0,
      );
    } finally {
      await closeHarness(harness);
    }
  });

  it('keeps independent cached snapshots when the requested compose model changes', async () => {
    const harness = await createHarness(128_000, {
      target: 'model',
      alternateContextWindow: 400_000,
    });
    try {
      const original = await getContextStatus(harness, 'context-status-original');
      expect(original.contextWindow).toBe(128_000);

      const luna = await getContextStatus(
        harness,
        'context-status-luna',
        harness.alternateModelId,
      );
      expect(luna.modelId).toBe(harness.alternateModelId);
      expect(luna.contextWindow).toBe(400_000);

      const restored = await getContextStatus(harness, 'context-status-restored');
      expect(restored.modelId).not.toBe(harness.alternateModelId);
      expect(restored.contextWindow).toBe(128_000);

      const snapshotsByThread = (
        harness.runtime as unknown as {
          contextSnapshotByThread: Map<string, Map<string, unknown>>;
        }
      ).contextSnapshotByThread;
      expect(snapshotsByThread.get(String(harness.threadId))?.size).toBe(2);
    } finally {
      await closeHarness(harness);
    }
  });

  it('previews an explicit compose model for an Agent conversation without changing its default', async () => {
    const harness = await createHarness(128_000, {
      target: 'agent',
      alternateContextWindow: 400_000,
    });
    try {
      const original = await getContextStatus(harness, 'agent-context-status-original');
      expect(original.contextWindow).toBe(128_000);

      const luna = await getContextStatus(
        harness,
        'agent-context-status-luna',
        harness.alternateModelId,
      );
      expect(luna.modelId).toBe(harness.alternateModelId);
      expect(luna.contextWindow).toBe(400_000);

      const restored = await getContextStatus(harness, 'agent-context-status-restored');
      expect(restored.modelId).not.toBe(harness.alternateModelId);
      expect(restored.contextWindow).toBe(128_000);
    } finally {
      await closeHarness(harness);
    }
  });

  it('rebuilds cache-miss system, agent, project, and tools from the same provider context', async () => {
    const harness = await createHarness(1_000_000);
    try {
      expect(harness.adapter.calls).toHaveLength(0);
      const cacheMissStatus = await getContextStatus(harness, 'cache-miss-context-status');
      expect(
        cacheMissStatus.sections.find((section) => section.type === 'tools')?.tokens,
      ).toBeGreaterThan(0);

      await appendUserMessage(
        harness,
        'First request after a cache-miss status rebuild.',
        0,
        'cache-miss-append',
        [],
      );
      expect(harness.adapter.calls).toHaveLength(1);
      const actualSections = expectedSectionsFromProviderRequest(harness.adapter.calls[0]!);
      for (const type of ['system', 'agent', 'project', 'summary', 'tools'] as const) {
        expect(cacheMissStatus.sections.find((section) => section.type === type)).toEqual(
          actualSections.find((section) => section.type === type),
        );
      }
    } finally {
      await closeHarness(harness);
    }
  });

  it('returns a strict status whose breakdown matches the actual provider request and excludes reasoning', async () => {
    const harness = await createHarness(1_000_000);
    try {
      let taskVersion = await appendUserMessage(
        harness,
        'First request establishes durable assistant history.',
        0,
        'append-first',
      );
      taskVersion = await appendUserMessage(
        harness,
        'Second request must rebuild history without hidden reasoning.',
        taskVersion,
        'append-second',
      );
      expect(taskVersion).toBe(2);
      expect(harness.adapter.calls).toHaveLength(2);

      const status = await getContextStatus(harness, 'get-context-status');
      expect(status.compactThreshold).toBe(0.7);
      expect(status.contextWindow).toBe(1_000_000);
      expect(status.sections.reduce((total, section) => total + section.tokens, 0)).toBe(
        status.estimatedUsedTokens,
      );
      expect(status.usageRatio).toBe(status.estimatedUsedTokens / status.contextWindow);

      const actualRequest = harness.adapter.calls[1]!;
      expect(actualRequest.systemPrompt).toContain(TASK_GOAL);
      expect(actualRequest.systemPrompt).toContain(ACCEPTANCE_CRITERION);
      expect(actualRequest.systemPrompt).toContain(PROJECT_MEMORY);
      expect(actualRequest.systemPrompt).toContain(SKILL_BODY);
      expect(JSON.stringify(actualRequest)).not.toContain(HIDDEN_REASONING);

      const mcpTool = actualRequest.tools?.find((tool) =>
        tool.name.includes('mcp__mcp-context-status__lookup_context'),
      );
      expect(mcpTool).toBeDefined();
      expect(JSON.stringify(mcpTool?.inputSchema)).toContain(MCP_SCHEMA_MARKER);

      const expectedSections = expectedSectionsFromProviderRequest(actualRequest);
      expect(status.sections).toEqual(expectedSections);
      expect(status.estimatedUsedTokens).toBe(
        expectedSections.reduce((total, section) => total + section.tokens, 0),
      );

      const invalid = await harness.inbox.send({
        id: 'invalid-context-status',
        kind: 'request',
        type: 'conversation.getContextStatus',
        payload: { conversationId: '' },
      });
      expect(invalid.error).toMatchObject({ code: 'protocol.frame_malformed' });
    } finally {
      await closeHarness(harness);
    }
  });

  it('ignores forged high renderer hints when the Runtime snapshot is below 70 percent', async () => {
    const harness = await createHarness(1_000_000);
    try {
      let taskVersion = await appendUserMessage(harness, 'compact-low-usage-one', 0, 'low-1');
      taskVersion = await appendUserMessage(harness, 'compact-low-usage-two', taskVersion, 'low-2');
      expect(taskVersion).toBe(2);
      const status = await getContextStatus(harness, 'low-status');
      expect(status.usageRatio).toBeLessThan(status.compactThreshold);

      const frame = await harness.inbox.send({
        id: 'compact-forged-high',
        kind: 'request',
        type: 'conversation.compact',
        payload: {
          conversationId: harness.conversationId,
          mode: 'auto',
          onlyIfNeeded: true,
          keepRecent: 1,
          usedTokens: 999_999_999,
          contextWindow: 1,
        },
      });
      expect(frame.error).toBeUndefined();
      const compact = frame.payload as ConversationCompactResponse;
      expect(compact.compacted).toBe(false);
      expect(compact.beforeTokens).toBe(status.estimatedUsedTokens);
      expect(compact.afterTokens).toBe(status.estimatedUsedTokens);
      expect(compact.foldedCount).toBe(0);
    } finally {
      await closeHarness(harness);
    }
  });

  it('ignores forged low renderer hints, compacts at Runtime 70 percent truth, and reports snapshot beforeTokens', async () => {
    const harness = await createHarness(200);
    try {
      let taskVersion = 0;
      for (let index = 0; index < 3; index += 1) {
        taskVersion = await appendUserMessage(
          harness,
          `long-context-${index}:` + '上下文快照必须来自真实请求。'.repeat(1_200),
          taskVersion,
          `high-${index}`,
        );
      }
      expect(taskVersion).toBe(3);
      const status = await getContextStatus(harness, 'high-status');
      expect(status.usageRatio).toBeGreaterThanOrEqual(status.compactThreshold);

      const frame = await harness.inbox.send({
        id: 'compact-forged-low',
        kind: 'request',
        type: 'conversation.compact',
        payload: {
          conversationId: harness.conversationId,
          mode: 'auto',
          onlyIfNeeded: true,
          keepRecent: 1,
          usedTokens: 0,
          contextWindow: 999_999_999,
        },
      });
      expect(frame.error).toBeUndefined();
      const compact = frame.payload as ConversationCompactResponse;
      expect(compact.compacted).toBe(true);
      expect(compact.beforeTokens).toBe(status.estimatedUsedTokens);
      expect(compact.afterTokens).toBeLessThan(compact.beforeTokens);
      expect(compact.foldedCount).toBeGreaterThan(0);
    } finally {
      await closeHarness(harness);
    }
  });
});
