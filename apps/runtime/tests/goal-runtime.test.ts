import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type Socket } from 'node:net';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type ConversationListMessagesResponse,
  type Frame,
  type GoalGetResponse,
  type GoalResumeResponse,
  type GoalSetResponse,
} from '@sync-think/protocol';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import type { Message } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteProviderStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class GoalRecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['gpt-old', 'gpt-luna'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: '[present]' });
    yield { type: 'assistant-message-start', phase: 'commentary' };
    yield {
      type: 'assistant-message-delta',
      phase: 'commentary',
      text: '正在执行目标。',
    };
    yield { type: 'assistant-message-end', phase: 'commentary' };
    yield { type: 'assistant-message-start', phase: 'final_answer' };
    yield {
      type: 'assistant-message-delta',
      phase: 'final_answer',
      text: '目标工作已完成，验证证据已写入结果。\nGOAL_STATUS: complete',
    };
    yield { type: 'assistant-message-end', phase: 'final_answer' };
    yield { type: 'usage', tokensIn: 12_000, tokensOut: 1_000 };
    yield { type: 'finished', reason: 'stop' };
  }
}

class GoalBlockedAdapter extends GoalRecordingAdapter {
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: '[present]' });
    yield { type: 'assistant-message-start', phase: 'final_answer' };
    yield {
      type: 'assistant-message-delta',
      phase: 'final_answer',
      text: '当前缺少必须的人工输入，本轮暂时受阻。\nGOAL_STATUS: blocked',
    };
    yield { type: 'assistant-message-end', phase: 'final_answer' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class GoalStatusSequenceAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: ProviderCallRequest[] = [];

  constructor(private readonly replies: readonly string[]) {}

  async discoverModels(): Promise<string[]> {
    return ['gpt-luna'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: '[present]' });
    const reply = this.replies[Math.min(this.calls.length - 1, this.replies.length - 1)] ?? '';
    yield { type: 'assistant-message-start', phase: 'final_answer' };
    yield { type: 'assistant-message-delta', phase: 'final_answer', text: reply };
    yield { type: 'assistant-message-end', phase: 'final_answer' };
    yield { type: 'usage', tokensIn: 100, tokensOut: 20 };
    yield { type: 'finished', reason: 'stop' };
  }
}

class DeferredGoalAdapter extends GoalRecordingAdapter {
  private readonly startedPromise: Promise<void>;
  private readonly releasePromise: Promise<void>;
  private markStarted!: () => void;
  private releaseTurn!: () => void;

  constructor() {
    super();
    this.startedPromise = new Promise((resolve) => {
      this.markStarted = resolve;
    });
    this.releasePromise = new Promise((resolve) => {
      this.releaseTurn = resolve;
    });
  }

  waitUntilStarted(): Promise<void> {
    return this.startedPromise;
  }

  release(): void {
    this.releaseTurn();
  }

  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: '[present]' });
    this.markStarted();
    await this.releasePromise;
    yield { type: 'assistant-message-start', phase: 'final_answer' };
    yield {
      type: 'assistant-message-delta',
      phase: 'final_answer',
      text: '互斥模式验证完成。\nGOAL_STATUS: complete',
    };
    yield { type: 'assistant-message-end', phase: 'final_answer' };
    yield { type: 'finished', reason: 'stop' };
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

function frameReader(socket: Socket): (frame: Frame) => Promise<Frame> {
  let pending = Buffer.alloc(0);
  const queued: Frame[] = [];
  const waiters = new Map<string, (frame: Frame) => void>();
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (waiter) {
        waiters.delete(frame.id);
        waiter(frame);
      } else {
        queued.push(frame);
      }
    }
  });
  return (frame) => {
    const response = queued.find((candidate) => candidate.id === frame.id);
    if (response) {
      queued.splice(queued.indexOf(response), 1);
      socket.write(encodeFrame(frame));
      return Promise.resolve(response);
    }
    const promise = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
    socket.write(encodeFrame(frame));
    return promise;
  };
}

async function waitForGoal(
  request: (frame: Frame) => Promise<Frame>,
  conversationId: string,
  status: string,
): Promise<GoalGetResponse> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await request({
      id: `goal-poll-${Date.now()}-${Math.random()}`,
      kind: 'request',
      type: 'goal.get',
      payload: { conversationId },
    });
    const payload = response.payload as GoalGetResponse;
    if (payload.goal?.status === status) return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`goal did not reach ${status}`);
}

async function waitForTerminalGoal(
  request: (frame: Frame) => Promise<Frame>,
  conversationId: string,
): Promise<GoalGetResponse> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await request({
      id: `goal-terminal-${Date.now()}-${Math.random()}`,
      kind: 'request',
      type: 'goal.get',
      payload: { conversationId },
    });
    const payload = response.payload as GoalGetResponse;
    if (payload.goal?.status === 'achieved' || payload.goal?.status === 'blocked') return payload;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('goal did not reach a terminal status');
}

describe('goal runtime execution', () => {
  it('keeps Plan and Goal mutually exclusive in Runtime commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-goal-plan-exclusive-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const keyPath = join(dir, 'secure', 'key.bin');
    await runMigrations(dbPath);

    const connection = await openDatabaseAsync({ path: dbPath });
    const providerStore = new SqliteProviderStore(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(keyPath));
    const storeHandle = await secureStore.storeSecret('goal-runtime-secret');
    const provider = providerStore.createProvider({
      name: 'Goal plan exclusion fixture provider',
      baseUrl: 'https://goal.example/v1',
      protocol: 'openai-chat',
      storeHandle,
    });
    const [goalModel] = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'gpt-luna', displayName: 'Luna selected model' }],
    });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({ name: 'Goal plan exclusion fixture' });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Goal chat',
      goal: 'Goal chat',
    });
    const conversation = conversationStore.create({
      id: 'conv-goal-plan-exclusive' as never,
      target: { track: 'model', modelId: goalModel!.id },
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    connection.raw.close();

    const adapter = new DeferredGoalAdapter();
    const installId = `goal-runtime-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: keyPath,
      allowNoToken: true,
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const request = frameReader(socket);

    try {
      await request({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'goal-plan-exclusive',
          features: ['goal.set', 'goal.get', 'goal.resume', 'conversation.setInteractionMode'],
        },
      });
      await request({
        id: 'plan-before-goal',
        kind: 'request',
        type: 'conversation.setInteractionMode',
        payload: { conversationId: conversation.id, interactionMode: 'plan' },
      });
      await request({
        id: 'goal-set',
        kind: 'request',
        type: 'goal.set',
        payload: {
          conversationId: conversation.id,
          condition: '验证 Goal 与 Plan 互斥',
          modelId: goalModel!.id,
          kernelId: 'native',
        },
      });
      await adapter.waitUntilStarted();

      const afterGoal = await request({
        id: 'conversation-after-goal',
        kind: 'request',
        type: 'conversation.list',
        payload: {},
      });
      expect(afterGoal.payload).toMatchObject({
        conversations: [{ id: conversation.id, interactionMode: 'execute' }],
      });

      await request({
        id: 'plan-pauses-goal',
        kind: 'request',
        type: 'conversation.setInteractionMode',
        payload: { conversationId: conversation.id, interactionMode: 'plan' },
      });
      const paused = await request({
        id: 'goal-paused-by-plan',
        kind: 'request',
        type: 'goal.get',
        payload: { conversationId: conversation.id },
      });
      expect(paused.payload as GoalGetResponse).toMatchObject({
        goal: { status: 'paused' },
      });

      await request({
        id: 'goal-resume',
        kind: 'request',
        type: 'goal.resume',
        payload: { conversationId: conversation.id },
      });
      const afterResume = await request({
        id: 'conversation-after-resume',
        kind: 'request',
        type: 'conversation.list',
        payload: {},
      });
      expect(afterResume.payload).toMatchObject({
        conversations: [{ id: conversation.id, interactionMode: 'execute' }],
      });

      adapter.release();
      await waitForGoal(request, conversation.id, 'achieved');
      const cleared = await request({
        id: 'goal-clear-after-achieved',
        kind: 'request',
        type: 'goal.clear',
        payload: { conversationId: conversation.id },
      });
      expect(cleared.payload).toMatchObject({
        cleared: true,
        goal: { status: 'cleared' },
      });
    } finally {
      adapter.release();
      socket.destroy();
      await session.close();
    }
  }, 30_000);

  it('uses the selected work model status to complete without a separate evaluator', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-goal-runtime-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const keyPath = join(dir, 'secure', 'key.bin');
    await runMigrations(dbPath);

    const connection = await openDatabaseAsync({ path: dbPath });
    const providerStore = new SqliteProviderStore(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(keyPath));
    const storeHandle = await secureStore.storeSecret('goal-runtime-secret');
    const provider = providerStore.createProvider({
      name: 'Goal fixture provider',
      baseUrl: 'https://goal.example/v1',
      protocol: 'openai-chat',
      storeHandle,
    });
    const [oldModel, lunaModel] = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [
        { providerModelId: 'gpt-old', displayName: 'Old conversation model' },
        { providerModelId: 'gpt-luna', displayName: 'Luna selected model' },
      ],
    });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({ name: 'Goal runtime fixture' });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Goal chat',
      goal: 'Goal chat',
    });
    const conversation = conversationStore.create({
      id: 'conv-goal-runtime' as never,
      target: { track: 'model', modelId: oldModel!.id },
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    connection.raw.close();

    const adapter = new GoalRecordingAdapter();
    const installId = `goal-runtime-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: keyPath,
      allowNoToken: true,
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const request = frameReader(socket);

    try {
      await request({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'goal-runtime',
          features: ['goal.set', 'goal.get', 'conversation.listMessages'],
        },
      });
      const setResponse = await request({
        id: 'goal-set',
        kind: 'request',
        type: 'goal.set',
        payload: {
          conversationId: conversation.id,
          condition: '完成一次可验证目标',
          stopCondition: '验证目标产物已经写入结果',
          modelId: lunaModel!.id,
          kernelId: 'native',
          reasoningEffort: 'medium',
          maxGoalRounds: 1,
          maxGoalTokens: 25_000,
        },
      });
      expect(setResponse.error).toBeUndefined();
      expect(setResponse.payload as GoalSetResponse).toMatchObject({
        started: true,
        evaluatorConfigured: true,
        goal: {
          modelId: lunaModel!.id,
          kernelId: 'native',
          reasoningEffort: 'medium',
          stopCondition: '验证目标产物已经写入结果',
          maxGoalTokens: 25_000,
        },
      });

      const achieved = await waitForGoal(request, conversation.id, 'achieved');
      expect(achieved.goal).toMatchObject({
        status: 'achieved',
        roundsStarted: 1,
        lastReason: '工作模型已确认目标完成',
        tokensIn: 12_000,
        tokensOut: 1_000,
      });
      expect(adapter.calls.map((call) => call.modelId)).toEqual(['gpt-luna']);
      expect(adapter.calls[0]?.messages).toContainEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('GOAL_STATUS: complete'),
        }),
      );

      const listed = await request({
        id: 'messages',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversation.id },
      });
      const messages = (listed.payload as ConversationListMessagesResponse).messages;
      const user = messages.find((message: Message) => message.role === 'user');
      expect(user).toMatchObject({ modelId: lunaModel!.id });
      expect(user?.blocks).toContainEqual({ type: 'text', text: '完成一次可验证目标' });
      const assistant = messages.find((message: Message) => message.role === 'assistant');
      expect(assistant?.blocks).toContainEqual({
        type: 'text',
        text: '目标工作已完成，验证证据已写入结果。',
      });
      expect(JSON.stringify(assistant?.blocks)).not.toContain('GOAL_STATUS');
    } finally {
      socket.destroy();
      await session.close();
    }
  }, 30_000);

  it('continues on GOAL_STATUS: continue and completes on the next work-model turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-goal-continue-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const keyPath = join(dir, 'secure', 'key.bin');
    await runMigrations(dbPath);

    const connection = await openDatabaseAsync({ path: dbPath });
    const providerStore = new SqliteProviderStore(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(keyPath));
    const storeHandle = await secureStore.storeSecret('goal-runtime-secret');
    const provider = providerStore.createProvider({
      name: 'Goal fixture provider',
      baseUrl: 'https://goal.example/v1',
      protocol: 'openai-chat',
      storeHandle,
    });
    const [goalModel] = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'gpt-luna', displayName: 'Luna selected model' }],
    });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({ name: 'Goal continue fixture' });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Goal chat',
      goal: 'Goal chat',
    });
    const conversation = conversationStore.create({
      id: 'conv-goal-continue' as never,
      target: { track: 'model', modelId: goalModel!.id },
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    connection.raw.close();

    const adapter = new GoalStatusSequenceAdapter([
      '第一阶段产物已完成，仍需做最终验证。\nGOAL_STATUS: continue',
      '最终验证已通过，目标产物完整。\nGOAL_STATUS: complete',
    ]);
    const installId = `goal-runtime-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: keyPath,
      allowNoToken: true,
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const request = frameReader(socket);

    try {
      await request({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'goal-runtime',
          features: ['goal.set', 'goal.get', 'conversation.listMessages'],
        },
      });
      await request({
        id: 'goal-set',
        kind: 'request',
        type: 'goal.set',
        payload: {
          conversationId: conversation.id,
          condition: '完成分阶段验收目标',
          stopCondition: '最终验证已通过',
          modelId: goalModel!.id,
          kernelId: 'native',
          maxGoalRounds: 5,
        },
      });

      const achieved = await waitForGoal(request, conversation.id, 'achieved');
      expect(achieved.goal).toMatchObject({
        status: 'achieved',
        roundsStarted: 2,
        turnCount: 2,
        blockedStreak: 0,
        tokensIn: 200,
        tokensOut: 40,
      });
      expect(adapter.calls.map((call) => call.modelId)).toEqual(['gpt-luna', 'gpt-luna']);
      expect(adapter.calls[1]?.messages).toContainEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('[Goal 第 2 轮]'),
        }),
      );

      const listed = await request({
        id: 'messages',
        kind: 'request',
        type: 'conversation.listMessages',
        payload: { conversationId: conversation.id },
      });
      const messages = (listed.payload as ConversationListMessagesResponse).messages;
      expect(JSON.stringify(messages)).not.toContain('GOAL_STATUS');
    } finally {
      socket.destroy();
      await session.close();
    }
  }, 30_000);

  it('requires three consecutive work-model blocked statuses before stopping', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-goal-blocked-streak-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const keyPath = join(dir, 'secure', 'key.bin');
    await runMigrations(dbPath);

    const connection = await openDatabaseAsync({ path: dbPath });
    const providerStore = new SqliteProviderStore(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(keyPath));
    const storeHandle = await secureStore.storeSecret('goal-runtime-secret');
    const provider = providerStore.createProvider({
      name: 'Goal fixture provider',
      baseUrl: 'https://goal.example/v1',
      protocol: 'openai-chat',
      storeHandle,
    });
    const [goalModel] = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [
        { providerModelId: 'gpt-luna', displayName: 'Luna selected model' },
      ],
    });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({ name: 'Goal blocked streak fixture' });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Goal chat',
      goal: 'Goal chat',
    });
    const conversation = conversationStore.create({
      id: 'conv-goal-blocked-streak' as never,
      target: { track: 'model', modelId: goalModel!.id },
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    connection.raw.close();

    const adapter = new GoalBlockedAdapter();
    const installId = `goal-runtime-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: keyPath,
      allowNoToken: true,
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const request = frameReader(socket);

    try {
      await request({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'goal-runtime',
          features: ['goal.set', 'goal.get'],
        },
      });
      await request({
        id: 'goal-set',
        kind: 'request',
        type: 'goal.set',
        payload: {
          conversationId: conversation.id,
          condition: '完成一次可验证目标',
          modelId: goalModel!.id,
          kernelId: 'native',
        },
      });

      const blocked = await waitForGoal(request, conversation.id, 'blocked');
      expect(blocked.goal).toMatchObject({
        status: 'blocked',
        roundsStarted: 3,
        blockedStreak: 3,
        maxGoalRounds: 10,
        maxGoalTokens: 1_000_000,
        blockedReason: '工作模型连续 3 轮报告目标受阻',
      });
      expect(adapter.calls.map((call) => call.modelId)).toEqual([
        'gpt-luna',
        'gpt-luna',
        'gpt-luna',
      ]);
    } finally {
      socket.destroy();
      await session.close();
    }
  }, 30_000);

  it('blocks at the token budget before trusting the work-model completion status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-goal-token-budget-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const keyPath = join(dir, 'secure', 'key.bin');
    await runMigrations(dbPath);

    const connection = await openDatabaseAsync({ path: dbPath });
    const providerStore = new SqliteProviderStore(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(keyPath));
    const storeHandle = await secureStore.storeSecret('goal-runtime-secret');
    const provider = providerStore.createProvider({
      name: 'Goal fixture provider',
      baseUrl: 'https://goal.example/v1',
      protocol: 'openai-chat',
      storeHandle,
    });
    const [goalModel] = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [
        { providerModelId: 'gpt-luna', displayName: 'Luna selected model' },
      ],
    });
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const workspace = workspaceStore.createWorkspace({ name: 'Goal token budget fixture' });
    const task = workspaceStore.createTask({
      workspaceId: workspace.id,
      title: 'Goal chat',
      goal: 'Goal chat',
    });
    const conversation = conversationStore.create({
      id: 'conv-goal-token-budget' as never,
      target: { track: 'model', modelId: goalModel!.id },
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    connection.raw.close();

    const adapter = new GoalRecordingAdapter();
    const installId = `goal-runtime-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: keyPath,
      allowNoToken: true,
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const request = frameReader(socket);

    try {
      await request({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'goal-runtime',
          features: ['goal.set', 'goal.get', 'goal.pause', 'goal.resume'],
        },
      });
      const setResponse = await request({
        id: 'goal-set',
        kind: 'request',
        type: 'goal.set',
        payload: {
          conversationId: conversation.id,
          condition: '完成一次可验证目标',
          stopCondition: '目标结果通过最终验收',
          modelId: goalModel!.id,
          kernelId: 'native',
          maxGoalRounds: 5,
          maxGoalTokens: 10_000,
        },
      });
      expect(setResponse.payload as GoalSetResponse).toMatchObject({
        started: true,
        evaluatorConfigured: true,
        goal: {
          status: 'active',
          stopCondition: '目标结果通过最终验收',
          maxGoalTokens: 10_000,
        },
      });

      const terminal = await waitForTerminalGoal(request, conversation.id);
      expect(terminal.goal).toMatchObject({
        status: 'blocked',
        stopCondition: '目标结果通过最终验收',
        maxGoalTokens: 10_000,
        tokensIn: 12_000,
        tokensOut: 1_000,
        blockedReason: '已达 Token 上限（10000）',
      });
      expect(adapter.calls.map((call) => call.modelId)).toEqual(['gpt-luna']);

      const resumeResponse = await request({
        id: 'goal-resume',
        kind: 'request',
        type: 'goal.resume',
        payload: { conversationId: conversation.id },
      });
      expect(resumeResponse.payload as GoalResumeResponse).toMatchObject({
        started: false,
        goal: {
          status: 'blocked',
          stopCondition: '目标结果通过最终验收',
          maxGoalTokens: 10_000,
          tokensIn: 12_000,
          tokensOut: 1_000,
          blockedReason: '已达 Token 上限（10000）',
        },
      });
      expect(adapter.calls.map((call) => call.modelId)).toEqual(['gpt-luna']);
    } finally {
      socket.destroy();
      await session.close();
    }
  }, 30_000);
});
