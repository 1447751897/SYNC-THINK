import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteProviderStore,
  SqliteGlobalAgentStore,
  SqliteConversationStore,
  SqliteWorkspaceStore,
  SqliteUnitOfWork,
} from '@sync-think/storage';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import type { WorkspaceId, RunId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly lock better-sqlite3 files.
    }
  }
});

async function connectRuntime(installId: string): Promise<Socket> {
  const sock = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  return sock;
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
      } else frames.push(frame);
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

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

class RecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  calls: ProviderCallRequest[] = [];
  async discoverModels(): Promise<string[]> {
    return ['persona-mini'];
  }
  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({
      ...request,
      apiKey: request.apiKey ? '[present]' : '',
    });
    const personaHint =
      typeof request.systemPrompt === 'string' && request.systemPrompt.includes('海盗船长')
        ? '啊哈，船长在此！'
        : '普通助手回复';
    yield { type: 'text-delta', text: personaHint };
    yield { type: 'finished', reason: 'stop' };
  }
}

describe('agent-track persona + default model binding', () => {
  it('injects global agent persona into systemPrompt and uses agent default model', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-agent-persona-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `test-agent-persona-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-agent-persona' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const providerStore = new SqliteProviderStore(connection.raw);
    const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const unitOfWork = new SqliteUnitOfWork(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
    const secret = 'sk-AGENT_PERSONA_TEST_KEY';
    const handle = await secureStore.storeSecret(secret);
    const createdProvider = providerStore.createProvider({
      name: 'Persona Gateway',
      baseUrl: 'https://persona.example/v1',
      protocol: 'openai-chat',
      storeHandle: handle,
    });
    const models = providerStore.upsertModels({
      providerId: createdProvider.provider.id,
      protocol: 'openai-chat',
      models: [
        { providerModelId: 'persona-mini', displayName: 'Persona Mini' },
        { providerModelId: 'other-model', displayName: 'Other Model' },
      ],
    });
    const defaultModel = models.find((m) => m.providerModelId === 'persona-mini')!;
    const agent = globalAgentStore.create({
      name: '海盗船长',
      defaultModelId: defaultModel.id,
      persona:
        '你是一位说话夸张的海盗船长。每句话都以「啊哈」开头，喜欢用航海隐喻，绝不说自己是普通助手。',
      description: '风格鲜明的测试智能体',
      reasoningEffort: 'medium',
    });
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Agent Persona WS',
      folderPath: dir,
      allowedRoots: [dir],
    });

    const adapter = new RecordingAdapter();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      workspaceId,
      checkpointRunId,
      providerStore,
      globalAgentStore,
      conversationStore,
      workspaceStore,
      unitOfWork,
      secureStore,
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    try {
      await inbox.send({
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: [
            'conversation.create',
            'conversation.sendMessage',
            'task.appendMessage',
            'globalAgent.list',
          ],
        },
      });

      const created = await inbox.send({
        id: 'create-conv',
        kind: 'request',
        type: 'conversation.create',
        payload: {
          track: 'agent',
          targetRef: agent.id,
          workspaceId,
          title: '与海盗船长对话',
          executionMode: 'full-access',
        },
      });
      expect(created.error).toBeUndefined();
      const conversationId = (created.payload as { conversation: { id: string } }).conversation.id;

      const prep = await inbox.send({
        id: 'prep',
        kind: 'request',
        type: 'conversation.sendMessage',
        payload: {
          conversationId,
          text: '用你的风格跟我打个招呼',
        },
      });
      expect(prep.error).toBeUndefined();
      const prepPayload = prep.payload as { threadId: string; taskVersion: number };
      expect(prepPayload.threadId).toBeTruthy();

      const append = await inbox.send({
        id: 'append',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: prepPayload.threadId,
          expectedTaskVersion: prepPayload.taskVersion,
          role: 'user',
          text: '用你的风格跟我打个招呼',
          // Intentionally omit modelId — agent track must resolve defaultModelId.
        },
      });
      expect(append.error).toBeUndefined();

      expect(
        await waitFor(() =>
          store.listEvents(workspaceId, 0).some((e) => e.type === 'run.completed'),
        ),
      ).toBe(true);

      expect(adapter.calls.length).toBeGreaterThanOrEqual(1);
      const call = adapter.calls[0]!;
      expect(call.modelId).toBe('persona-mini');
      expect(call.systemPrompt).toBeTruthy();
      expect(String(call.systemPrompt)).toContain('海盗船长');
      expect(String(call.systemPrompt)).toContain('啊哈');
      expect(String(call.systemPrompt)).toMatch(/persona|Follow this persona/i);
      expect(String(call.systemPrompt)).toContain(
        'Write commentary in the same language as the latest user message',
      );
      expect(String(call.systemPrompt)).toContain(
        'Before meaningful tool work, send a brief commentary preamble',
      );
      expect(String(call.systemPrompt)).toContain(
        'Never expose hidden chain-of-thought or provider reasoning summaries',
      );
      expect(String(call.systemPrompt)).toContain(
        'Keep the terminal response separate as the final answer',
      );
      expect(call.reasoningEffort).toBe('medium');

      const packet = store.listEvents(workspaceId, 0).find((e) => e.type === 'context.packet.built');
      expect(packet?.payload).toMatchObject({
        providerModelId: 'persona-mini',
      });

      const completed = store
        .listEvents(workspaceId, 0)
        .find((event) => event.type === 'run.completed');
      expect(String(completed?.payload.assistantText ?? '')).toContain('啊哈');
      expect(store.listEvents(workspaceId, 0).map((event) => event.type)).not.toContain(
        'message.delta',
      );
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
