import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FakeProvider,
  type AdapterEvent,
  type ProviderAdapter,
  type ProviderCallRequest,
} from '@sync-think/adapters';
import {
  DEFAULT_FEATURES,
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type Frame,
} from '@sync-think/protocol';
import { openDatabaseAsync, SqliteEventCheckpointStore } from '@sync-think/storage';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function frameReader(socket: Socket) {
  const queued: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queued.push(frame);
    }
  });
  return {
    read(): Promise<Frame> {
      const frame = queued.shift();
      if (frame) return Promise.resolve(frame);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

async function request(socket: Socket, reader: ReturnType<typeof frameReader>, frame: Frame) {
  const response = reader.read();
  socket.write(encodeFrame(frame));
  return response;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
}

describe('subtask delegation and handoff Runtime commands', () => {
  it('creates a real child task and records one audited directional handoff', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-collaboration-tools-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `collaboration-tools-${randomBytes(4).toString('hex')}`;
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      allowNoToken: true,
      demoProvider: new FakeProvider({ chunksPerWord: 1, tickMs: 25 }),
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const reader = frameReader(socket);

    try {
      const hello = await request(socket, reader, {
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: 'collaboration-tools-test',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: DEFAULT_FEATURES,
        },
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const workspace = await request(socket, reader, {
        id: 'workspace',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Collaboration tools', folderPath: dir },
      });
      const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const defaultAgent = await request(socket, reader, {
        id: 'default-agent',
        kind: 'request',
        type: 'agent.get',
        payload: {},
      });
      const leadAgent = (
        defaultAgent.payload as {
          agent: { agentVersionId: string; defaultModelId: string };
        }
      ).agent;
      const leadAgentVersionId = leadAgent.agentVersionId;
      const worker = await request(socket, reader, {
        id: 'worker-agent',
        kind: 'request',
        type: 'agent.create',
        payload: {
          name: 'Focused worker',
          role: 'worker',
          developerInstructions: 'Complete only an explicitly delegated subtask.',
          inputContract: 'isolated subtask packet',
          outputContract: 'evidence-backed handoff',
          defaultModelId: leadAgent.defaultModelId,
          maxConcurrency: 2,
        },
      });
      expect(worker.error).toBeUndefined();
      const workerAgentVersionId = (
        worker.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;

      const parent = await request(socket, reader, {
        id: 'parent-task',
        kind: 'request',
        type: 'task.create',
        payload: {
          workspaceId,
          title: 'Parent task',
          goal: 'Coordinate one explicit child task',
          acceptanceCriteria: ['The handoff is persisted'],
        },
      });
      const parentPayload = parent.payload as { taskId: string; threadId: string };
      const parentTaskId = parentPayload.taskId;
      const delegated = await request(socket, reader, {
        id: 'delegate',
        kind: 'request',
        type: 'task.delegateSubtask',
        meta: { callerSurface: 'cli' },
        payload: {
          workspaceId,
          parentTaskId,
          delegateAgentVersionId: workerAgentVersionId,
          title: 'Focused child task',
          goal: 'Implement only the parser',
          requiredEvidence: ['focused test output'],
          acceptanceConditions: ['focused tests pass'],
          allowedTools: ['read_file'],
          delegatingAgentVersionId: leadAgentVersionId,
          delegationBatchId: 'delegation-batch-1',
        },
      });
      expect(delegated.error).toBeUndefined();
      expect(delegated.payload).toMatchObject({
        parentTaskId,
        delegateAgentVersionId: workerAgentVersionId,
        packet: {
          goal: 'Implement only the parser',
          requiredEvidence: ['focused test output'],
          acceptanceConditions: ['focused tests pass'],
          allowedTools: ['read_file'],
          handoffHistory: [],
          dependsOnTaskIds: [],
          retryLimit: 5,
        },
      });
      const childTaskId = (delegated.payload as { taskId: string }).taskId;
      const parallel = await request(socket, reader, {
        id: 'delegate-parallel',
        kind: 'request',
        type: 'task.delegateSubtask',
        meta: { callerSurface: 'cli' },
        payload: {
          workspaceId,
          parentTaskId,
          delegateAgentVersionId: workerAgentVersionId,
          title: 'Parallel child task',
          goal: 'Inspect the independent formatter',
          delegatingAgentVersionId: leadAgentVersionId,
          delegationBatchId: 'delegation-batch-1',
        },
      });
      expect(parallel.error).toBeUndefined();
      const parallelTaskId = (parallel.payload as { taskId: string }).taskId;
      const serial = await request(socket, reader, {
        id: 'delegate-serial',
        kind: 'request',
        type: 'task.delegateSubtask',
        meta: { callerSurface: 'cli' },
        payload: {
          workspaceId,
          parentTaskId,
          delegateAgentVersionId: workerAgentVersionId,
          title: 'Dependent child task',
          goal: 'Verify the parser after implementation',
          dependsOnTaskIds: [childTaskId],
          delegatingAgentVersionId: leadAgentVersionId,
          delegationBatchId: 'delegation-batch-1',
        },
      });
      expect(serial.error).toBeUndefined();
      const serialTaskId = (serial.payload as { taskId: string }).taskId;

      const automaticInspection = await openDatabaseAsync({ path: dbPath });
      try {
        const automaticEvents = new SqliteEventCheckpointStore(automaticInspection.raw);
        await waitFor(() =>
          [childTaskId, parallelTaskId].every((taskId) =>
            automaticEvents
              .listAllEvents(0)
              .some(
                (event) =>
                  event.type === 'subtask.blocked' && event.payload.childTaskId === taskId,
              ),
          ),
        );
        const events = automaticEvents.listAllEvents(0);
        const eventFor = (type: string, taskId: string) =>
          events.find(
            (event) => event.type === type && event.payload.childTaskId === taskId,
          );
        const firstStarted = eventFor('subtask.execution-started', childTaskId)!;
        const parallelStarted = eventFor('subtask.execution-started', parallelTaskId)!;
        const firstBlocked = eventFor('subtask.blocked', childTaskId)!;
        const parallelBlocked = eventFor('subtask.blocked', parallelTaskId)!;
        expect(firstStarted.sequence).toBeLessThan(firstBlocked.sequence);
        expect(parallelStarted.sequence).toBeLessThan(parallelBlocked.sequence);
        expect(eventFor('subtask.execution-started', serialTaskId)).toBeUndefined();
        expect(
          events.filter(
            (event) =>
              event.type === 'subtask.parent-resumed' &&
              event.payload.delegationBatchId === 'delegation-batch-1',
          ),
        ).toHaveLength(0);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'subtask.agent-assigned',
              taskId: childTaskId,
              payload: expect.objectContaining({ agentVersionId: workerAgentVersionId }),
            }),
            expect.objectContaining({
              type: 'subtask.agent-message',
              taskId: childTaskId,
              payload: expect.objectContaining({ agentVersionId: workerAgentVersionId }),
            }),
            expect.objectContaining({ type: 'subtask.execution-started', taskId: childTaskId }),
            expect.objectContaining({
              type: 'subtask.blocked',
              payload: expect.objectContaining({
                childTaskId,
                retryConsumed: false,
              }),
            }),
          ]),
        );
      } finally {
        automaticInspection.raw.close();
      }

      const reopenedChild = await request(socket, reader, {
        id: 'open-assigned-child',
        kind: 'request',
        type: 'task.open',
        payload: { taskId: childTaskId },
      });
      const childTaskVersion = (
        reopenedChild.payload as { task: { taskVersion: number } }
      ).task.taskVersion;
      const continuationInspection = await openDatabaseAsync({ path: dbPath });
      const continuationEvents = new SqliteEventCheckpointStore(continuationInspection.raw);
      const beforeContinuation = continuationEvents.listAllEvents(0).length;
      const continued = await request(socket, reader, {
        id: 'continue-assigned-child',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: (delegated.payload as { threadId: string }).threadId,
          expectedTaskVersion: childTaskVersion,
          role: 'user',
          text: '继续完成这个子任务。',
        },
      });
      expect(continued.error).toBeUndefined();
      await waitFor(() =>
        continuationEvents
          .listAllEvents(0)
          .slice(beforeContinuation)
          .some(
            (event) =>
              event.type === 'context.packet.built' &&
              event.payload.agentVersionId === workerAgentVersionId,
          ),
      );
      continuationInspection.raw.close();

      const nestedDelegation = await request(socket, reader, {
        id: 'delegate-grandchild',
        kind: 'request',
        type: 'task.delegateSubtask',
        meta: { callerSurface: 'cli' },
        payload: {
          workspaceId,
          parentTaskId: childTaskId,
          delegateAgentVersionId: workerAgentVersionId,
          title: 'Unsupported grandchild',
          goal: 'This must remain one level deep',
        },
      });
      expect(nestedDelegation.error?.message).toMatch(/one level/i);

      const handoff = await request(socket, reader, {
        id: 'handoff',
        kind: 'request',
        type: 'task.recordHandoff',
        meta: { callerSurface: 'mcp' },
        payload: {
          taskId: childTaskId,
          fromAgentVersionId: workerAgentVersionId,
          toAgentVersionId: leadAgentVersionId,
          summary: 'Parser implemented and focused tests pass.',
          evidenceRefs: ['artifact-version-focused-test'],
          status: 'completed',
        },
      });
      expect(handoff.error).toBeUndefined();
      expect(handoff.payload).toMatchObject({ taskId: childTaskId, eventId: expect.any(String) });

      const listed = await request(socket, reader, {
        id: 'task-list',
        kind: 'request',
        type: 'task.list',
        payload: { workspaceId, includeArchived: true },
      });
      expect(
        (listed.payload as { tasks: Array<{ taskId: string; parentTaskId?: string }> }).tasks,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ taskId: childTaskId, parentTaskId }),
          expect.objectContaining({ taskId: parallelTaskId, parentTaskId }),
          expect.objectContaining({ taskId: serialTaskId, parentTaskId }),
        ]),
      );

      const inspection = await openDatabaseAsync({ path: dbPath });
      try {
        const events = new SqliteEventCheckpointStore(inspection.raw).listAllEvents(0);
        expect(events.find((event) => event.type === 'subtask.delegated')?.payload).toMatchObject({
          childTaskId,
          delegateAgentVersionId: workerAgentVersionId,
          callerSurface: 'cli',
        });
        expect(
          events.find((event) => event.type === 'subtask.handoff-recorded')?.payload,
        ).toMatchObject({
          fromAgentVersionId: workerAgentVersionId,
          toAgentVersionId: leadAgentVersionId,
          callerSurface: 'mcp',
          status: 'completed',
        });
      } finally {
        inspection.raw.close();
      }
    } finally {
      socket.destroy();
      await session.close();
    }
  });

  it('runs group chat like direct chat and routes an explicit mention to the exact member', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-group-runtime-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = `group-runtime-${randomBytes(4).toString('hex')}`;
    const providerRequests: ProviderCallRequest[] = [];
    let workerAgentVersionId = '';
    const adapter: ProviderAdapter = {
      protocol: 'openai-chat',
      async discoverModels() {
        return [];
      },
      async *call(request): AsyncIterable<AdapterEvent> {
        providerRequests.push(structuredClone(request));
        const prompt = request.messages
          .map((message) => (typeof message.content === 'string' ? message.content : ''))
          .join('\n');
        const output = prompt.includes('single|delegate')
          ? JSON.stringify({
              mode: 'delegate',
              reason: 'The implementation needs one focused worker.',
              assignments: [
                {
                  agentVersionId: workerAgentVersionId,
                  goal: 'Implement the isolated parser change.',
                  requiredEvidence: ['focused test output'],
                  acceptanceConditions: ['focused tests pass'],
                  allowedTools: [],
                },
              ],
            })
          : prompt.includes('Isolated subtask packet')
            ? 'Worker completed the parser and attached focused evidence.'
            : 'Lead summary: the parser change is complete and verified.';
        yield { type: 'text-delta', text: output };
        yield { type: 'finished', reason: 'stop' };
      },
    };
    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: join(dir, 'secure-key.bin'),
      allowNoToken: true,
      demoProvider: new FakeProvider(),
      discoveryByProtocol: { 'openai-chat': adapter },
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);
    const reader = frameReader(socket);
    const inspection = await openDatabaseAsync({ path: dbPath });
    const eventStore = new SqliteEventCheckpointStore(inspection.raw);

    try {
      await request(socket, reader, {
        id: 'hello-group',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: 'group-runtime-test',
          installId,
          nonce: randomBytes(8).toString('hex'),
          features: DEFAULT_FEATURES,
        },
      });
      const workspace = await request(socket, reader, {
        id: 'workspace-group',
        kind: 'request',
        type: 'workspace.create',
        payload: { name: 'Group runtime', folderPath: dir },
      });
      const workspaceId = (workspace.payload as { workspaceId: string }).workspaceId;
      const provider = await request(socket, reader, {
        id: 'provider-group',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Group Provider',
          baseUrl: 'https://group-provider.example/v1',
          protocol: 'openai-chat',
          apiKey: 'sk-group-runtime-test-not-real',
          supportsDiscovery: false,
        },
      });
      expect(provider.error).toBeUndefined();
      const providerPayload = provider.payload as {
        provider: {
          providerId: string;
          credentials: Array<{ credentialGroupId: string }>;
        };
      };
      const models = await request(socket, reader, {
        id: 'models-group',
        kind: 'request',
        type: 'provider.addModels',
        payload: {
          providerId: providerPayload.provider.providerId,
          protocol: 'openai-chat',
          models: [{ providerModelId: 'group-model', displayName: 'Group model' }],
        },
      });
      const modelId = (
        models.payload as { models: Array<{ modelId: string }> }
      ).models[0]!.modelId;
      const credentialGroupId = providerPayload.provider.credentials[0]!.credentialGroupId;

      const lead = await request(socket, reader, {
        id: 'lead-group',
        kind: 'request',
        type: 'agent.create',
        payload: {
          name: 'Lead Agent',
          role: 'lead',
          developerInstructions: 'Decide whether to delegate, then provide one final summary.',
          inputContract: 'complete task packet',
          outputContract: 'structured decision or final summary',
          defaultModelId: modelId,
          defaultCredentialGroupId: credentialGroupId,
          approvalMode: 'full',
        },
      });
      const leadAgentVersionId = (
        lead.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;
      const worker = await request(socket, reader, {
        id: 'worker-group',
        kind: 'request',
        type: 'agent.create',
        payload: {
          name: 'Worker Agent',
          role: 'worker',
          developerInstructions: 'Complete only the isolated packet.',
          inputContract: 'isolated packet',
          outputContract: 'evidence-backed result',
          defaultModelId: modelId,
          defaultCredentialGroupId: credentialGroupId,
          approvalMode: 'full',
        },
      });
      workerAgentVersionId = (
        worker.payload as { agent: { agentVersionId: string } }
      ).agent.agentVersionId;
      const group = await request(socket, reader, {
        id: 'group-create-runtime',
        kind: 'request',
        type: 'group.create',
        payload: {
          name: 'Runtime group',
          kind: 'fixed',
          leadAgentVersionId,
          approvalMode: 'full',
          collaborationMode: 'parallel',
          maxConcurrency: 2,
          members: [
            { agentVersionId: leadAgentVersionId, responsibility: 'decide and summarize' },
            { agentVersionId: workerAgentVersionId, responsibility: 'implement parser changes' },
          ],
        },
      });
      expect(group.error).toBeUndefined();
      const groupId = (group.payload as { group: { id: string } }).group.id;
      const groupTask = await request(socket, reader, {
        id: 'group-task-runtime',
        kind: 'request',
        type: 'group.task.create',
        payload: {
          groupId,
          workspaceId,
          title: 'Parser collaboration',
          goal: 'Implement and verify a parser change',
          acceptanceCriteria: ['The focused parser tests pass'],
        },
      });
      expect(groupTask.error).toBeUndefined();
      const task = groupTask.payload as {
        taskId: string;
        threadId: string;
        taskVersion: number;
      };
      const appended = await request(socket, reader, {
        id: 'group-message-runtime',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: task.threadId,
          expectedTaskVersion: task.taskVersion,
          role: 'user',
          text: 'Please coordinate the exact parser change.',
        },
      });
      expect(appended.error).toBeUndefined();
      const firstTaskVersion = (appended.payload as { taskVersion: number }).taskVersion;
      await waitFor(() =>
        eventStore
          .listAllEvents(0)
          .some(
            (event) =>
              event.payload.threadId === task.threadId && event.type === 'run.completed',
          ),
      );

      const mentioned = await request(socket, reader, {
        id: 'group-message-mentioned-runtime',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: task.threadId,
          expectedTaskVersion: firstTaskVersion,
          role: 'user',
          text: '@Worker Agent Please inspect the parser result.',
          agentVersionId: workerAgentVersionId,
        },
      });
      expect(mentioned.error).toBeUndefined();
      await waitFor(() => providerRequests.length === 2);
      await waitFor(
        () =>
          eventStore
            .listAllEvents(0)
            .filter(
              (event) =>
                event.payload.threadId === task.threadId && event.type === 'run.completed',
            ).length >= 2,
      );

      const taskEvents = eventStore
        .listAllEvents(0)
        .filter((event) => event.payload.threadId === task.threadId);
      expect(
        taskEvents.filter((event) => event.type.startsWith('group.collaboration.')),
      ).toEqual([]);
      expect(taskEvents.filter((event) => event.type === 'group.delegation-decided')).toEqual([]);
      expect(taskEvents.filter((event) => event.type === 'group.agent-message')).toEqual([]);
      expect(providerRequests).toHaveLength(2);
      const manifests = taskEvents.filter((event) => event.type === 'context.packet.built');
      expect(manifests).toHaveLength(2);
      const memberManifest = manifests.find(
        (event) => event.payload.agentVersionId === workerAgentVersionId,
      );
      expect(memberManifest?.payload).toMatchObject({
        agentVersionId: workerAgentVersionId,
        includedSourceIds: expect.arrayContaining([expect.stringMatching(/^group:/)]),
      });
      expect(
        manifests.filter((event) => event.payload.agentVersionId === leadAgentVersionId),
      ).toHaveLength(1);
    } finally {
      inspection.raw.close();
      socket.destroy();
      await session.close();
    }
  });
});
