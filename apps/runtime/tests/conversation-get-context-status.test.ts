import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureContextRequest } from '../src/context-token-meter.js';
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
  inputUsageOffset?:number;

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
    const summaryRequested = request.messages.some(message => typeof message.content === 'string' &&
      message.content.includes('Create a concise structured checkpoint'));
    if (summaryRequested) {
      yield { type: 'text-delta', text: [
        '## Primary Request and Intent\n- 保留快照来源与验收。', '## Key Technical Concepts\n- Runtime context',
        '## Files and Code\n- (none)', '## Errors and Fixes\n- (none)', '## Pending Jobs\n- 继续用户要求',
        '## Current Work\n- 上下文回归', '## Next Step\n- 回答最新问题', '## Critical Context\n- 保留约束。',
      ].join('\n') };
      yield { type: 'finished', reason: 'stop' }; return;
    }
    yield { type: 'reasoning-delta', text: HIDDEN_REASONING };
    yield { type: 'text-delta', text: `assistant-final-${this.calls.length}` };
    if (this.inputUsageOffset !== undefined) yield {type:'usage',tokensIn:measureContextRequest(request,'fixture').usedTokens+this.inputUsageOffset,tokensOut:10,cachedTokensHit:50};
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
  modelId: string;
  providerId: string;
  runtime: Runtime;
  runtimeOptions:ConstructorParameters<typeof Runtime>[0];
  socket: Socket;
  skillStore: SqliteSkillStore;
  stateStore: SqliteEventCheckpointStore;
  taskId: TaskId;
  threadId: ThreadId;
  workspaceId: WorkspaceId;
}

interface CreateHarnessOptions {
  alternateContextWindow?: number;
  modelMaxOutputTokens?:number;
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
        limitsJson: JSON.stringify({ contextWindow,maxOutputTokens:options.modelMaxOutputTokens }),
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
  const runtimeOptions:ConstructorParameters<typeof Runtime>[0] = {
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
  };
  const runtime=new Runtime(runtimeOptions);
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
      features: [
        'task.appendMessage',
        'conversation.getContextStatus',
        'conversation.compact',
        'provider.updateModel',
      ],
    },
  });
  expect(hello.error).toBeUndefined();

  return {
    adapter,
    ...(alternateModel ? { alternateModelId: alternateModel.id } : {}),
    connection,
    conversationId: conversation.id,
    inbox,
    modelId: model.id,
    providerId: provider.provider.id,
    runtime,
    runtimeOptions,
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
  kernelId?: string,
): Promise<ConversationGetContextStatusResponse> {
  const frame = await harness.inbox.send({
    id: requestId,
    kind: 'request',
    type: 'conversation.getContextStatus',
    payload: {
      conversationId: harness.conversationId,
      ...(modelId ? { modelId } : {}),
      ...(kernelId ? { kernelId } : {}),
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
  const sections = [
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
  const fixedBlocks = sections.slice(0, 4);
  const blockTokens = fixedBlocks.reduce((total, section) => total + section.tokens, 0);
  const framingSection = fixedBlocks.find(section => section.tokens > 0) ?? fixedBlocks[0]!;
  framingSection.tokens += estimateTextTokens(prompt) - blockTokens;
  return sections;
}

describe('conversation.getContextStatus runtime integration', () => {
  it('reuses an automatically compacted canonical prefix in the next run instead of paying for the same summary again',async()=>{
    const h=await createHarness(32000,{target:'model',modelMaxOutputTokens:2048});
    try{
      const messages=new SqliteMessageStore(h.connection.raw);
      for(let index=0;index<12;index++)messages.appendMessage({id:('auto-prefix-'+index) as import('@sync-think/shared').MessageId,
        threadId:h.threadId,sequence:index,role:index%2 ? 'assistant':'user',createdAt:'2026-10-02T00:00:00.000Z',blocks:[{type:'text',text:'raw-'+index+' '+ 'x'.repeat(8000)}]});
      const version=await appendUserMessage(h,'继续当前工作并保留原约束',0,'automatic-first');
      const compacted=h.stateStore.listEventsByTask(h.taskId).find(e=>e.type==='context.compacted');
      expect(compacted?.payload).toMatchObject({mode:'auto',origin:'native-preflight'});
      expect(Number(compacted!.payload.coveredThroughMessageSequence)).toBeGreaterThan(0);
      const summaryCalls=()=>h.adapter.calls.filter(call=>call.messages.some(m=>typeof m.content==='string'&&m.content.includes('Create a concise structured checkpoint'))).length;
      expect(summaryCalls()).toBe(1);
      const checkpointRequest=h.adapter.calls.find(call=>call.messages.some(m=>typeof m.content==='string'&&m.content.includes('Create a concise structured checkpoint')))!;
      expect(checkpointRequest.tools ?? []).toEqual([]);
      const count=messages.listMessages(h.threadId,{limit:100}).messages.filter(m=>m.id.startsWith('auto-prefix-')).length;
      expect(count).toBe(12);
      await appendUserMessage(h,'继续；原约束还在吗？',version,'automatic-second');
      expect(summaryCalls()).toBe(1);
      const last=h.adapter.calls.at(-1)!;
      expect(last.systemPrompt).toContain('Primary Request and Intent');
      expect(JSON.stringify(last.messages)).not.toContain('raw-0 ');
      expect(JSON.stringify(last.messages)).toContain('原约束还在吗');
    }finally{await closeHarness(h);}
  });
  it('uses the metadata output cap and calibrates from the actual request across a Runtime restart',async()=>{
    const h=await createHarness(128000,{target:'model',modelMaxOutputTokens:2048,alternateContextWindow:200000});
    try{
      const initial=await getContextStatus(h,'cap-before');
      expect(initial.budget?.reservedOutputTokens).toBe(2048);
      h.adapter.inputUsageOffset=200;
      await appendUserMessage(h,'确认保留这段用户约束',0,'calibrated-append');
      expect(h.adapter.calls[0]?.maxOutputTokens).toBe(2048);
      const before=await getContextStatus(h,'calibrated-status');
      expect(before.measurement?.source).toBe('provider-calibrated');
      expect(before.estimatedUsedTokens).toBe(before.measurement!.estimatedTokens+200);
      expect(before.sections.reduce((sum,s)=>sum+s.tokens,0)).toBe(before.estimatedUsedTokens);
      expect(h.stateStore.listEventsByTask(h.taskId).filter(e=>e.type==='provider.usage')).toHaveLength(1);
      h.socket.destroy();await h.runtime.stop();
      h.runtime=new Runtime(h.runtimeOptions);await h.runtime.start();
      h.socket=await connectRuntime(h.runtimeOptions.installId);h.inbox=createFrameInbox(h.socket);
      await h.inbox.send({id:'restart-hello',kind:'request',type:'__hello',payload:{protocolVersion:2,appVersion:'fixture',installId:h.runtimeOptions.installId,nonce:'restart',features:['conversation.getContextStatus']}});
      const after=await getContextStatus(h,'calibrated-restarted');
      expect(after.estimatedUsedTokens).toBe(before.estimatedUsedTokens);
      expect(after.measurement?.source).toBe('provider-calibrated');
      const switched=await getContextStatus(h,'calibrated-switch',h.alternateModelId);
      expect(switched.measurement?.source).toBe('estimate');
    }finally{await closeHarness(h);}
  });
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
    const harness = await createHarness(32_000);
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
    const harness = await createHarness(32_000);
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

      const luna = await getContextStatus(harness, 'context-status-luna', harness.alternateModelId);
      expect(luna.modelId).toBe(harness.alternateModelId);
      expect(luna.contextWindow).toBe(400_000);

      const restored = await getContextStatus(harness, 'context-status-restored');
      expect(restored.modelId).not.toBe(harness.alternateModelId);
      expect(restored.contextWindow).toBe(128_000);

      const snapshotsByThread = (
        harness.runtime as unknown as {
          contextSnapshotCache: { countForThread(threadId: string): number };
        }
      ).contextSnapshotCache;
      expect(snapshotsByThread.countForThread(String(harness.threadId))).toBe(2);
    } finally {
      await closeHarness(harness);
    }
  });

  it('keeps legacy conversation overrides out of model-owned context capacity', async () => {
    const harness = await createHarness(128_000, { target: 'model' });
    try {
      const changed = await harness.inbox.send({
        id: 'set-context-window-override',
        kind: 'request',
        type: 'conversation.setContextWindowOverride',
        payload: {
          conversationId: harness.conversationId,
          contextWindowOverride: 400_000,
        },
      });
      expect(changed.error).toBeUndefined();
      expect(
        (changed.payload as { conversation: { contextWindowOverride?: number } }).conversation
          .contextWindowOverride,
      ).toBe(400_000);

      const native = await getContextStatus(harness, 'context-status-override');
      expect(native).toMatchObject({
        contextWindow: 128_000,
        modelContextWindow: 128_000,
        contextWindowSource: 'model-default',
      });
      expect(native.contextWindowOverride).toBeUndefined();

      const external = await getContextStatus(
        harness,
        'context-status-claude-cap',
        undefined,
        'claude-code',
      );
      expect(external).toMatchObject({
        contextWindow: 128_000,
        modelContextWindow: 128_000,
        contextWindowSource: 'model-default',
      });
      expect(external.contextWindowOverride).toBeUndefined();
      expect(external.kernelContextWindowLimit).toBeUndefined();
      expect(external.usageRatio).toBe(external.estimatedUsedTokens / external.contextWindow);

      const cleared = await harness.inbox.send({
        id: 'clear-context-window-override',
        kind: 'request',
        type: 'conversation.setContextWindowOverride',
        payload: { conversationId: harness.conversationId, contextWindowOverride: null },
      });
      expect(cleared.error).toBeUndefined();
      const restored = await getContextStatus(harness, 'context-status-model-default');
      expect(restored).toMatchObject({
        contextWindow: 128_000,
        modelContextWindow: 128_000,
        contextWindowSource: 'model-default',
      });
      expect(restored.contextWindowOverride).toBeUndefined();
    } finally {
      await closeHarness(harness);
    }
  });

  it('lets Claude Code use the configured model window instead of a 200k host cap', async () => {
    const harness = await createHarness(400_000, { target: 'model' });
    try {
      const status = await getContextStatus(
        harness,
        'context-status-claude-follows-model',
        undefined,
        'claude-code',
      );
      expect(status).toMatchObject({
        contextWindow: 400_000,
        modelContextWindow: 400_000,
        contextWindowSource: 'model-default',
      });
      expect(status.kernelContextWindowLimit).toBeUndefined();
    } finally {
      await closeHarness(harness);
    }
  });

  it('keeps Agent context on its owned model despite a stale composer model hint', async () => {
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
      expect(luna.modelId).toBe(original.modelId);
      expect(luna.contextWindow).toBe(128_000);

      const restored = await getContextStatus(harness, 'agent-context-status-restored');
      expect(restored.modelId).not.toBe(harness.alternateModelId);
      expect(restored.contextWindow).toBe(128_000);
    } finally {
      await closeHarness(harness);
    }
  });

  it('rebuilds cache-miss system, agent, project, and tools from the same provider context', async () => {
    const harness = await createHarness(1_000_000, { target: 'model' });
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

  it('invalidates cached context status when a durable message is written', async () => {
    const harness = await createHarness(1_000_000, { target: 'model' });
    const internals = harness.runtime as unknown as {
      contextSnapshotCache: { hasThread(threadId: string): boolean };
      persistFinalChatMessage(input: {
        id: string;
        threadId: string;
        role: 'user';
        text: string;
        createdAt: string;
      }): void;
    };
    try {
      const before = await getContextStatus(harness, 'cache-invalidation-before');
      expect(internals.contextSnapshotCache.hasThread(String(harness.threadId))).toBe(true);

      internals.persistFinalChatMessage({
        id: 'cache-invalidation-message',
        threadId: String(harness.threadId),
        role: 'user',
        text: 'A durable message written after the cached snapshot.',
        createdAt: '2026-08-14T00:00:00.000Z',
      });
      expect(internals.contextSnapshotCache.hasThread(String(harness.threadId))).toBe(false);

      const after = await getContextStatus(harness, 'cache-invalidation-after');
      expect(after.sections.find((section) => section.type === 'messages')?.tokens).toBeGreaterThan(
        before.sections.find((section) => section.type === 'messages')?.tokens ?? 0,
      );
    } finally {
      await closeHarness(harness);
    }
  });

  it('rebuilds context capacity after the model window is updated', async () => {
    const harness = await createHarness(128_000, { target: 'model' });
    const internals = harness.runtime as unknown as {
      contextSnapshotCache: { hasThread(threadId: string): boolean };
    };
    try {
      const before = await getContextStatus(harness, 'update-model-window-before');
      expect(before.contextWindow).toBe(128_000);
      expect(before.contextWindowEstimated).toBeUndefined();
      expect(internals.contextSnapshotCache.hasThread(String(harness.threadId))).toBe(true);

      const updated = await harness.inbox.send({
        id: 'update-model-window',
        kind: 'request',
        type: 'provider.updateModel',
        payload: {
          providerId: harness.providerId,
          modelId: harness.modelId,
          contextWindow: 372_000,
        },
      });
      expect(updated.error).toBeUndefined();
      expect(internals.contextSnapshotCache.hasThread(String(harness.threadId))).toBe(false);

      const after = await getContextStatus(harness, 'update-model-window-after');
      expect(after.contextWindow).toBe(372_000);
      expect(after.modelContextWindow).toBe(372_000);
      expect(after.contextWindowEstimated).toBeUndefined();
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

      const getVersion = vi.spyOn(harness.skillStore, 'getVersion');
      const status = await getContextStatus(harness, 'get-context-status');
      expect(getVersion).not.toHaveBeenCalled();
      getVersion.mockRestore();
      expect(status.compactThreshold).toBe(0.85);
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
      expect(actualRequest.systemPrompt).toContain('AI design draft output contract (html)');
      expect(actualRequest.systemPrompt).toContain('exactly one fenced block tagged `html`');
      expect(actualRequest.systemPrompt).not.toContain(
        'AI design draft output contract (design-ui)',
      );
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

  it('ignores forged high renderer hints when the Runtime snapshot is below 85 percent', async () => {
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
      const skipped = harness.stateStore
        .listEventsByTask(harness.taskId)
        .find((event) => event.type === 'context.compaction_skipped');
      expect(skipped?.payload).toMatchObject({
        operationId: 'compact-forged-high',
        reason: 'below-threshold',
        beforeTokens: status.estimatedUsedTokens,
        foldedCount: 0,
      });
    } finally {
      await closeHarness(harness);
    }
  });

  it('ignores forged low renderer hints, compacts at Runtime 85 percent truth, and reports snapshot beforeTokens', async () => {
    const harness = await createHarness(32_000);
    try {
      // Seed a pressure snapshot through the public durable-message store. Normal
      // Native sends now compact before dispatch, rather than knowingly overflowing.
      const messages = new SqliteMessageStore(harness.connection.raw);
      for (let index = 0; index < 12; index++) messages.appendMessage({
        id: ('pressure-fixture-' + index) as import('@sync-think/shared').MessageId,
        threadId: harness.threadId, sequence: index, role: index % 2 ? 'assistant' : 'user',
        createdAt: '2026-10-02T00:00:00.000Z', blocks: [{type: 'text', text: 'x'.repeat(8000)}],
      });
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
      const lifecycle = harness.stateStore
        .listEventsByTask(harness.taskId)
        .filter(
          (event) =>
            event.type === 'context.compaction_started' || event.type === 'context.compacted',
        );
      expect(lifecycle.map((event) => event.type)).toEqual([
        'context.compaction_started',
        'context.compacted',
      ]);
      expect(lifecycle[0]?.payload).toMatchObject({
        operationId: 'compact-forged-low',
        beforeTokens: compact.beforeTokens,
        foldedCount: compact.foldedCount,
      });
      expect(lifecycle[1]?.payload).toMatchObject({
        operationId: 'compact-forged-low',
        beforeTokens: compact.beforeTokens,
        afterTokens: compact.afterTokens,
        foldedCount: compact.foldedCount,
      });
      expect(lifecycle[1]?.payload.durationMs).toEqual(expect.any(Number));
    } finally {
      await closeHarness(harness);
    }
  });
});
