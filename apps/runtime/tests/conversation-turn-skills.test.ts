import { afterEach, describe, expect, it } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteMessageStore,
  SqliteProviderStore,
  SqliteSkillStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly retain a native SQLite handle.
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
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (!waiter) continue;
      waiters.delete(frame.id);
      waiter(frame);
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolve) => waiters.set(frame.id, resolve));
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return predicate();
}

class FallbackRecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: ProviderCallRequest[] = [];
  private failedCalls = 0;

  constructor(private readonly onFirstCall: () => void) {}

  async discoverModels(): Promise<string[]> {
    return ['turn-skill-primary', 'turn-skill-fallback'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: '[present]' });
    if (this.failedCalls < 6) {
      this.failedCalls += 1;
      if (this.failedCalls === 1) this.onFirstCall();
      yield { type: 'error', failureClass: 'rate-limit', message: 'retry on fallback' };
      return;
    }
    yield { type: 'text-delta', text: 'done' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class BlockingRecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: ProviderCallRequest[] = [];
  private release!: () => void;
  private finish!: () => void;
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  readonly done = new Promise<void>((resolve) => {
    this.finish = resolve;
  });

  async discoverModels(): Promise<string[]> {
    return ['restart-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: '[present]' });
    try {
      await this.released;
      const error = new Error('restart fixture aborted');
      error.name = 'AbortError';
      throw error;
    } finally {
      this.finish();
    }
  }

  abortFixture(): void {
    this.release();
  }
}

class CompletingRecordingAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly calls: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['restart-model'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls.push({ ...request, apiKey: '[present]' });
    yield { type: 'text-delta', text: 'restored' };
    yield { type: 'finished', reason: 'stop' };
  }
}

async function expectUnauthorizedSelectionRejected(options: {
  stateStore: boolean;
  provider: boolean;
}): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-turn-skill-auth-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const installId = `turn-skill-auth-${randomBytes(5).toString('hex')}`;
  const workspaceId = `workspace-auth-${randomBytes(4).toString('hex')}` as WorkspaceId;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const stateStore = options.stateStore
    ? new SqliteEventCheckpointStore(connection.raw)
    : undefined;
  const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const skillStore = new SqliteSkillStore(connection.raw);
  const unitOfWork = new SqliteUnitOfWork(connection.raw);
  const allowed = skillStore.importVersion({
    name: 'allowed',
    description: 'Allowed Skill',
    version: '1.0.0',
    sourceMd: 'ALLOWED',
    body: 'ALLOWED',
    contentFingerprint: `allowed-${randomBytes(4).toString('hex')}`,
  });
  const denied = skillStore.importVersion({
    name: 'denied',
    description: 'Denied Skill',
    version: '1.0.0',
    sourceMd: 'DENIED',
    body: 'DENIED',
    contentFingerprint: `denied-${randomBytes(4).toString('hex')}`,
  });
  const agent = globalAgentStore.create({
    name: 'Authorization Agent',
    defaultModelId: 'fake-mini' as never,
    skillIds: [allowed.id],
  });
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: 'Authorization Workspace',
    folderPath: dir,
    allowedRoots: [dir],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: 'Authorization task',
    goal: 'Reject stale per-turn selection',
  });
  const conversation = conversationStore.create({
    target: { track: 'agent', agentId: agent.id },
    workspaceId,
    title: 'Authorization conversation',
    executionMode: 'full-access',
  });
  conversationStore.bindTask(conversation.id, task.taskId);

  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    modelRetryBaseDelayMs: 0,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    ...(stateStore ? { stateStore } : {}),
    globalAgentStore,
    conversationStore,
    messageStore,
    workspaceStore,
    skillStore,
    unitOfWork,
    ...(options.provider
      ? { demoProvider: new FallbackRecordingAdapter(() => undefined) }
      : {}),
  });
  await runtime.start();
  const socket = await connectRuntime(installId);
  const inbox = createFrameInbox(socket);
  try {
    await inbox.send({
      id: 'hello-auth',
      kind: 'request',
      type: '__hello',
      payload: {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: randomBytes(8).toString('hex'),
        features: ['task.appendMessage'],
      },
    });
    const response = await inbox.send({
      id: 'append-auth-denied',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: task.threadId,
        expectedTaskVersion: 0,
        role: 'user',
        text: 'This message must not persist',
        skillVersionIds: [denied.id],
      },
    });
    expect(response.error?.message).toMatch(/allowlist|allowlisted/i);
    expect(workspaceStore.getTask(task.taskId)?.version).toBe(0);
    expect(messageStore.listMessages(task.threadId).messages).toEqual([]);
    expect(
      stateStore
        ?.listEvents(workspaceId, 0)
        .some((event) => event.type === 'message.appended'),
    ).not.toBe(true);
  } finally {
    socket.destroy();
    await runtime.stop();
    connection.raw.close();
  }
}

describe('per-turn Skill selection', () => {
  it('rejects unauthorized selections before persistence without a Provider or state store', async () => {
    await expectUnauthorizedSelectionRejected({ stateStore: true, provider: false });
    await expectUnauthorizedSelectionRejected({ stateStore: false, provider: true });
  }, 60_000);

  it('rehydrates an exact frozen Skill after Runtime restart and blocks fingerprint drift', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-turn-skill-restart-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const workspaceId = 'workspace-turn-skill-restart' as WorkspaceId;
    const checkpointRunId = 'runtime-turn-skill-restart' as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const providerStore = new SqliteProviderStore(connection.raw);
    const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const messageStore = new SqliteMessageStore(connection.raw);
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const skillStore = new SqliteSkillStore(connection.raw);
    const unitOfWork = new SqliteUnitOfWork(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
    const storeHandle = await secureStore.storeSecret('test-turn-skill-restart-secret');
    const provider = providerStore.createProvider({
      name: 'Restart Skill Gateway',
      baseUrl: 'https://restart-skills.example/v1',
      protocol: 'openai-chat',
      storeHandle,
    });
    const [model] = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'restart-model', displayName: 'Restart Model' }],
    });
    if (!model) throw new Error('restart model fixture missing');
    const skill = skillStore.importVersion({
      name: 'restart-guidance',
      description: 'Survives Runtime restart',
      version: '3.0.0',
      sourceMd: 'RESTART_SKILL_BODY',
      body: 'RESTART_SKILL_BODY',
      contentFingerprint: 'fingerprint-restart-guidance',
    });
    const agent = globalAgentStore.create({
      name: 'Restart Agent',
      defaultModelId: model.id,
      fallbackModelIds: [],
      skillIds: [skill.id],
    });
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Restart Workspace',
      folderPath: dir,
      allowedRoots: [dir],
    });
    const task = workspaceStore.createTask({
      workspaceId,
      title: 'Restart task',
      goal: 'Resume the exact Skill snapshot',
    });
    const conversation = conversationStore.create({
      target: { track: 'agent', agentId: agent.id },
      workspaceId,
      title: 'Restart conversation',
      executionMode: 'full-access',
    });
    conversationStore.bindTask(conversation.id, task.taskId);

    let runtimeIndex = 0;
    const startRuntime = async (adapter: ProviderAdapter) => {
      runtimeIndex += 1;
      const installId = `turn-skill-restart-${runtimeIndex}-${randomBytes(4).toString('hex')}`;
      const runtime = new Runtime({
        installId,
        allowNoToken: true,
    modelRetryBaseDelayMs: 0,
        modelRetryBaseDelayMs: 0,
        stateStore,
        workspaceId,
        checkpointRunId,
        providerStore,
        globalAgentStore,
        conversationStore,
        messageStore,
        workspaceStore,
        skillStore,
        unitOfWork,
        secureStore,
        discoveryByProtocol: { 'openai-chat': adapter },
      });
      await runtime.start();
      const socket = await connectRuntime(installId);
      const inbox = createFrameInbox(socket);
      const hello = await inbox.send({
        id: `hello-restart-${runtimeIndex}`,
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: ['task.appendMessage'],
        },
      });
      expect(hello.error).toBeUndefined();
      return { runtime, socket, inbox };
    };

    const firstBlocker = new BlockingRecordingAdapter();
    const secondBlocker = new BlockingRecordingAdapter();
    try {
      const first = await startRuntime(firstBlocker);
      const firstAppend = await first.inbox.send({
        id: 'append-before-restart',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: task.threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'Resume me after restart',
          skillVersionIds: [skill.id],
        },
      });
      expect(firstAppend.error).toBeUndefined();
      const firstRunId = (firstAppend.payload as { streamId: string }).streamId;
      expect(await waitFor(() => firstBlocker.calls.length === 1)).toBe(true);
      first.socket.destroy();
      await first.runtime.stop();

      globalAgentStore.update({ agentId: agent.id, skillIds: [] });
      const resumedAdapter = new CompletingRecordingAdapter();
      const resumed = await startRuntime(resumedAdapter);
      expect(await waitFor(() => resumedAdapter.calls.length === 1)).toBe(true);
      expect(String(resumedAdapter.calls[0]!.systemPrompt)).toContain('RESTART_SKILL_BODY');
      expect(
        await waitFor(() =>
          stateStore
            .listEvents(workspaceId, 0)
            .some((event) => event.type === 'run.completed' && event.runId === firstRunId),
        ),
      ).toBe(true);
      resumed.socket.destroy();
      await resumed.runtime.stop();

      globalAgentStore.update({ agentId: agent.id, skillIds: [skill.id] });
      const second = await startRuntime(secondBlocker);
      const secondAppend = await second.inbox.send({
        id: 'append-before-integrity-restart',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: task.threadId,
          expectedTaskVersion: 1,
          role: 'user',
          text: 'Detect fingerprint drift',
          skillVersionIds: [skill.id],
        },
      });
      expect(secondAppend.error).toBeUndefined();
      const secondRunId = (secondAppend.payload as { streamId: string }).streamId;
      expect(await waitFor(() => secondBlocker.calls.length === 1)).toBe(true);
      second.socket.destroy();
      await second.runtime.stop();

      connection.raw
        .prepare(`UPDATE skill_version SET content_fingerprint = ? WHERE id = ?`)
        .run('fingerprint-tampered', skill.id);
      const rejectedAdapter = new CompletingRecordingAdapter();
      const rejected = await startRuntime(rejectedAdapter);
      expect(
        await waitFor(() =>
          stateStore
            .listEvents(workspaceId, 0)
            .some(
              (event) =>
                (event.type === 'run.failed' || event.type === 'run.paused') &&
                event.runId === secondRunId,
            ),
        ),
      ).toBe(true);
      expect(rejectedAdapter.calls).toHaveLength(0);
      rejected.socket.destroy();
      await rejected.runtime.stop();
    } finally {
      firstBlocker.abortFixture();
      secondBlocker.abortFixture();
      if (firstBlocker.calls.length > 0) await firstBlocker.done;
      if (secondBlocker.calls.length > 0) await secondBlocker.done;
      connection.raw.close();
    }
  }, 60_000);

  it('uses only selected exact versions and freezes them through fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-turn-skills-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `turn-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-turn-skills' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const providerStore = new SqliteProviderStore(connection.raw);
    const globalAgentStore = new SqliteGlobalAgentStore(connection.raw);
    const conversationStore = new SqliteConversationStore(connection.raw);
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const skillStore = new SqliteSkillStore(connection.raw);
    const unitOfWork = new SqliteUnitOfWork(connection.raw);
    const secureStore = new SecureStore(new XorDevBackend(join(dir, 'secure', 'key.bin')));
    const storeHandle = await secureStore.storeSecret('sk-TURN_SKILL_TEST_KEY');
    const provider = providerStore.createProvider({
      name: 'Turn Skill Gateway',
      baseUrl: 'https://turn-skills.example/v1',
      protocol: 'openai-chat',
      storeHandle,
    });
    const models = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [
        { providerModelId: 'turn-skill-primary', displayName: 'Primary' },
        { providerModelId: 'turn-skill-fallback', displayName: 'Fallback' },
      ],
    });
    const skillA = skillStore.importVersion({
      name: 'alpha',
      description: 'Alpha instructions',
      version: '1.0.0',
      sourceMd: '---\nname: alpha\n---\nALPHA_SKILL_BODY',
      body: 'ALPHA_SKILL_BODY',
      contentFingerprint: 'fingerprint-alpha',
    });
    const skillB = skillStore.importVersion({
      name: 'beta',
      description: 'Beta instructions',
      version: '2.0.0',
      sourceMd: '---\nname: beta\n---\nBETA_SKILL_BODY',
      body: 'BETA_SKILL_BODY',
      contentFingerprint: 'fingerprint-beta',
    });
    const emptySkill = skillStore.importVersion({
      name: 'empty-guidance',
      description: 'Valid metadata-only guidance',
      version: '1.0.0',
      sourceMd: '---\nname: empty-guidance\n---\n',
      body: '',
      contentFingerprint: 'fingerprint-empty-guidance',
    });
    const agent = globalAgentStore.create({
      name: 'Turn Skill Agent',
      defaultModelId: models[0]!.id,
      fallbackModelIds: [models[1]!.id],
      skillIds: [skillA.id, skillB.id, emptySkill.id],
    });
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: 'Turn Skill Workspace',
      folderPath: dir,
      allowedRoots: [dir],
    });

    const adapter = new FallbackRecordingAdapter(() => {
      globalAgentStore.update({ agentId: agent.id, skillIds: [skillA.id, emptySkill.id] });
    });
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
    modelRetryBaseDelayMs: 0,
      stateStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      providerStore,
      globalAgentStore,
      conversationStore,
      workspaceStore,
      skillStore,
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
          features: ['conversation.create', 'conversation.sendMessage', 'task.appendMessage'],
        },
      });
      const created = await inbox.send({
        id: 'create',
        kind: 'request',
        type: 'conversation.create',
        payload: {
          track: 'agent',
          targetRef: agent.id,
          workspaceId,
          title: 'Per-turn skills',
          executionMode: 'full-access',
        },
      });
      const conversationId = (created.payload as { conversation: { id: string } }).conversation.id;

      const prep = await inbox.send({
        id: 'prep-selected',
        kind: 'request',
        type: 'conversation.sendMessage',
        payload: { conversationId, text: 'Use only beta' },
      });
      const prepPayload = prep.payload as { threadId: string; taskVersion: number };
      const selected = await inbox.send({
        id: 'append-selected',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: prepPayload.threadId,
          expectedTaskVersion: prepPayload.taskVersion,
          role: 'user',
          text: 'Use only beta',
          skillVersionIds: [skillB.id, skillB.id],
        },
      });
      expect(selected.error).toBeUndefined();
      // The primary model retries in place 5 times (6 failed attempts) before
      // the fallback walk runs the 7th call. All calls must use the frozen
      // per-turn selection (skillB), never the agent's mutated skillIds.
      expect(await waitFor(() => adapter.calls.length >= 7)).toBe(true);
      for (const call of adapter.calls) {
        expect(String(call.systemPrompt)).toContain('BETA_SKILL_BODY');
        expect(String(call.systemPrompt)).not.toContain('ALPHA_SKILL_BODY');
      }

      const firstTurnEvents = stateStore.listEvents(workspaceId, 0);
      const contextEvents = firstTurnEvents.filter((event) => event.type === 'context.packet.built');
      expect(contextEvents.length).toBeGreaterThanOrEqual(2);
      for (const event of contextEvents) {
        expect(JSON.stringify(event.payload)).not.toContain('BETA_SKILL_BODY');
        expect(event.payload.skillVersionIds).toEqual([skillB.id]);
        expect(event.payload.includedSourceIds).toContain(`skill:${skillB.id}`);
        expect(event.payload.includedSourceIds).not.toContain(`skill:${skillA.id}`);
      }
      const persistedRuns = firstTurnEvents.filter(
        (event) => event.type === 'run.started' || event.type === 'run.fallback.selected',
      );
      expect(persistedRuns.length).toBeGreaterThanOrEqual(2);
      for (const event of persistedRuns) {
        const serialized = JSON.stringify(event.payload);
        expect(serialized).not.toContain('ALPHA_SKILL_BODY');
        expect(serialized).not.toContain('BETA_SKILL_BODY');
        expect((event.payload.run as { skillVersionIds?: string[] }).skillVersionIds).toEqual([
          skillB.id,
        ]);
      }

      const prepEmpty = await inbox.send({
        id: 'prep-empty',
        kind: 'request',
        type: 'conversation.sendMessage',
        payload: { conversationId, text: 'Use no skill' },
      });
      const emptyPrep = prepEmpty.payload as { threadId: string; taskVersion: number };
      const empty = await inbox.send({
        id: 'append-empty',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: emptyPrep.threadId,
          expectedTaskVersion: emptyPrep.taskVersion,
          role: 'user',
          text: 'Use no skill',
          skillVersionIds: [],
        },
      });
      expect(empty.error).toBeUndefined();
      // First turn consumed 7 calls (6 failed attempts + 1 success after the
      // fallback); the no-skill turn is call index 7.
      expect(await waitFor(() => adapter.calls.length >= 8)).toBe(true);
      expect(String(adapter.calls[7]!.systemPrompt)).not.toContain('ALPHA_SKILL_BODY');
      expect(String(adapter.calls[7]!.systemPrompt)).not.toContain('BETA_SKILL_BODY');

      const prepEmptyBody = await inbox.send({
        id: 'prep-empty-body',
        kind: 'request',
        type: 'conversation.sendMessage',
        payload: { conversationId, text: 'Use metadata-only guidance' },
      });
      const emptyBodyPrep = prepEmptyBody.payload as { threadId: string; taskVersion: number };
      const callsBeforeEmptyBody = adapter.calls.length;
      const emptyBody = await inbox.send({
        id: 'append-empty-body',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: emptyBodyPrep.threadId,
          expectedTaskVersion: emptyBodyPrep.taskVersion,
          role: 'user',
          text: 'Use metadata-only guidance',
          skillVersionIds: [emptySkill.id],
        },
      });
      expect(emptyBody.error).toBeUndefined();
      expect(await waitFor(() => adapter.calls.length > callsBeforeEmptyBody)).toBe(true);
      expect(String(adapter.calls[callsBeforeEmptyBody]!.systemPrompt)).toContain(
        '### Skill: empty-guidance (1.0.0)',
      );

      const prepDenied = await inbox.send({
        id: 'prep-denied',
        kind: 'request',
        type: 'conversation.sendMessage',
        payload: { conversationId, text: 'Try stale beta' },
      });
      const deniedPrep = prepDenied.payload as { threadId: string; taskVersion: number };
      const denied = await inbox.send({
        id: 'append-denied',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: deniedPrep.threadId,
          expectedTaskVersion: deniedPrep.taskVersion,
          role: 'user',
          text: 'Try stale beta',
          skillVersionIds: [skillB.id],
        },
      });
      expect(denied.error).toBeDefined();
      expect(String(denied.error?.message ?? '')).toMatch(/allowlist|allowlisted/i);
      expect(
        stateStore
          .listEvents(workspaceId, 0)
          .some((event) => event.type === 'message.appended' && event.payload.text === 'Try stale beta'),
      ).toBe(false);
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  }, 60_000);
});
