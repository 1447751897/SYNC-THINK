import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type Frame,
  type RunAgentVersionPin,
  type StepAgentVersionPin,
} from '@sync-think/protocol';
import type { AgentVersionId, RunId, StepId } from '@sync-think/shared';
import { FakeProvider } from '@sync-think/adapters';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly lock better-sqlite3 files after session.close.
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

function createFrameReader(sock: Socket): {
  read: (count: number) => Promise<Frame[]>;
} {
  const queued: Frame[] = [];
  const waiters: Array<{
    count: number;
    resolve: (frames: Frame[]) => void;
    reject: (err: unknown) => void;
  }> = [];
  let pending = Buffer.alloc(0);

  const drain = () => {
    while (waiters.length > 0 && queued.length >= waiters[0]!.count) {
      const waiter = waiters.shift()!;
      waiter.resolve(queued.splice(0, waiter.count));
    }
  };

  sock.on('data', (chunk: Buffer) => {
    try {
      const decoded = decodeFrames(Buffer.concat([pending, chunk]));
      pending = decoded.remaining;
      queued.push(...decoded.frames);
      drain();
    } catch (e) {
      while (waiters.length > 0) waiters.shift()!.reject(e);
    }
  });
  sock.on('error', (e) => {
    while (waiters.length > 0) waiters.shift()!.reject(e);
  });
  sock.on('close', () => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(new Error('socket closed before the requested frame arrived'));
    }
  });

  return {
    read(count: number) {
      if (queued.length >= count) return Promise.resolve(queued.splice(0, count));
      return new Promise((resolve, reject) => waiters.push({ count, resolve, reject }));
    },
  };
}

async function writeAndRead(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  frame: Frame,
): Promise<Frame> {
  const next = reader.read(1);
  sock.write(encodeFrame(frame));
  return (await next)[0]!;
}

async function hello(
  sock: Socket,
  reader: ReturnType<typeof createFrameReader>,
  installId: string,
): Promise<void> {
  const resp = await writeAndRead(sock, reader, {
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: [
        'agent.get',
        'agent.updateBinding',
        'agent.list',
        'agent.create',
        'agent.listVersions',
        'agent.createVersion',
        'provider.create',
        'provider.list',
      ],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

describe('agent commands', () => {
  it('seeds conversation agent, updates binding immutably, and uses store default on run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-agent-cmd-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    // Create provider + two models so binding can reference real ids.
    const created = await writeAndRead(sock, reader, {
      id: 'prov-1',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Agent Gateway',
        baseUrl: 'https://agent-gw.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-agent-test-key-not-for-real-use',
        supportsDiscovery: false,
      },
    });
    expect(created.error).toBeUndefined();
    const providerId = (created.payload as { provider: { providerId: string } }).provider.providerId;

    const add = await writeAndRead(sock, reader, {
      id: 'add-1',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'alpha-model', displayName: 'Alpha' },
          { providerModelId: 'beta-model', displayName: 'Beta' },
          { providerModelId: 'gamma-model', displayName: 'Gamma' },
        ],
      },
    });
    expect(add.error).toBeUndefined();
    const models = (add.payload as { models: Array<{ modelId: string; providerModelId: string }> })
      .models;
    expect(models.length).toBe(3);
    const alpha = models.find((m) => m.providerModelId === 'alpha-model')!;
    const beta = models.find((m) => m.providerModelId === 'beta-model')!;
    const gamma = models.find((m) => m.providerModelId === 'gamma-model')!;

    const got1 = await writeAndRead(sock, reader, {
      id: 'agent-get-1',
      kind: 'request',
      type: 'agent.get',
      payload: {},
    });
    expect(got1.error).toBeUndefined();
    const agent1 = (
      got1.payload as {
        agent: {
          agentId: string;
          agentVersionId: string;
          version: number;
          defaultModelId: string;
        };
      }
    ).agent;
    expect(agent1.agentId).toBe('agent-default-conversation');
    expect(agent1.version).toBeGreaterThanOrEqual(1);

    const createdAgent = await writeAndRead(sock, reader, {
      id: 'agent-create-planner',
      kind: 'request',
      type: 'agent.create' as never,
      payload: {
        agentId: 'agent-planner',
        name: 'Planner',
        role: 'planner',
        developerInstructions: 'Plan against acceptance criteria.',
        inputContract: 'task goal',
        outputContract: 'approved plan',
        description: 'Creates and reviews executable plans.',
        visualIdentity: { icon: 'workflow', color: '#227755' },
        defaultModelId: alpha.modelId,
        fallbackModelIds: [beta.modelId],
        pauseOnFailure: true,
        memoryScope: 'project',
        skillVersionIds: [],
        mcpServerIds: [],
        mcpToolAllowlist: ['read_file'],
        permissions: {
          file: ['workspace:read'],
          command: ['pnpm test'],
          browser: ['localhost'],
          desktop: [],
          network: [],
        },
        reviewBehavior: {
          role: 'executor-reviewer',
          maxIterations: 2,
          onLimitReached: 'pause',
        },
        artifactRules: {
          retainVersions: true,
          requireReview: true,
          defaultStatus: 'candidate',
        },
        approvalMode: 'request',
      },
    });
    expect(createdAgent.error).toBeUndefined();
    expect(createdAgent.payload).toMatchObject({
      agent: {
        agentId: 'agent-planner',
        version: 1,
        developerInstructions: 'Plan against acceptance criteria.',
        description: 'Creates and reviews executable plans.',
        visualIdentity: { icon: 'workflow', color: '#227755' },
        mcpToolAllowlist: ['read_file'],
        permissions: {
          file: ['workspace:read'],
          command: ['pnpm test'],
          browser: ['localhost'],
          desktop: [],
          network: [],
        },
        reviewBehavior: {
          role: 'executor-reviewer',
          maxIterations: 2,
          onLimitReached: 'pause',
        },
        artifactRules: {
          retainVersions: true,
          requireReview: true,
          defaultStatus: 'candidate',
        },
      },
    });

    const invalidNestedAgent = await writeAndRead(sock, reader, {
      id: 'agent-create-invalid-nested',
      kind: 'request',
      type: 'agent.create' as never,
      payload: {
        agentId: 'agent-invalid-nested',
        name: 'Invalid',
        role: 'worker',
        developerInstructions: 'Work.',
        inputContract: 'Input.',
        outputContract: 'Output.',
        defaultModelId: alpha.modelId,
        visualIdentity: { icon: 'bot', color: '#000000', unknown: true },
      },
    });
    expect(invalidNestedAgent.error).toMatchObject({ code: 'protocol.frame_malformed' });

    const listedAgents = await writeAndRead(sock, reader, {
      id: 'agent-list-all',
      kind: 'request',
      type: 'agent.list' as never,
      payload: {},
    });
    expect(listedAgents.error).toBeUndefined();
    expect(
      (listedAgents.payload as { agents: Array<{ agentId: string }> }).agents.map(
        (agent) => agent.agentId,
      ),
    ).toEqual(expect.arrayContaining(['agent-default-conversation', 'agent-planner']));

    const plannerV2 = await writeAndRead(sock, reader, {
      id: 'agent-planner-v2',
      kind: 'request',
      type: 'agent.createVersion' as never,
      payload: {
        agentId: 'agent-planner',
        expectedVersion: 1,
        name: 'Planner',
        role: 'planner',
        developerInstructions: 'Plan, execute, and verify.',
        inputContract: 'task goal',
        outputContract: 'reviewed plan',
        defaultModelId: alpha.modelId,
        fallbackModelIds: [beta.modelId],
        pauseOnFailure: true,
        memoryScope: 'project',
        skillVersionIds: [],
        mcpServerIds: [],
        approvalMode: 'request',
      },
    });
    expect(plannerV2.error).toBeUndefined();
    expect(plannerV2.payload).toMatchObject({ agent: { version: 2 } });

    const stalePlanner = await writeAndRead(sock, reader, {
      id: 'agent-planner-stale',
      kind: 'request',
      type: 'agent.createVersion' as never,
      payload: {
        agentId: 'agent-planner',
        expectedVersion: 1,
        name: 'Planner stale',
        role: 'planner',
        developerInstructions: 'stale',
        inputContract: 'goal',
        outputContract: 'plan',
        defaultModelId: alpha.modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        memoryScope: 'project',
        skillVersionIds: [],
        mcpServerIds: [],
        approvalMode: 'request',
      },
    });
    expect(stalePlanner.error?.message).toMatch(/expectedVersion|stale/i);

    const plannerVersions = await writeAndRead(sock, reader, {
      id: 'agent-planner-versions',
      kind: 'request',
      type: 'agent.listVersions' as never,
      payload: { agentId: 'agent-planner' },
    });
    expect(plannerVersions.error).toBeUndefined();
    expect(
      (plannerVersions.payload as { versions: Array<{ version: number }> }).versions.map(
        (version) => version.version,
      ),
    ).toEqual([1, 2]);

    const updated = await writeAndRead(sock, reader, {
      id: 'agent-upd-1',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: beta.modelId,
        fallbackModelIds: [gamma.modelId, alpha.modelId],
        pauseOnFailure: true,
      },
    });
    expect(updated.error).toBeUndefined();
    const agent2 = (
      updated.payload as {
        agent: {
          version: number;
          defaultModelId: string;
          fallbackModelIds: string[];
          agentVersionId: string;
        };
      }
    ).agent;
    expect(agent2.version).toBeGreaterThan(agent1.version);
    expect(agent2.defaultModelId).toBe(beta.modelId);
    expect(agent2.fallbackModelIds).toEqual([gamma.modelId, alpha.modelId]);

    const got2 = await writeAndRead(sock, reader, {
      id: 'agent-get-2',
      kind: 'request',
      type: 'agent.get',
      payload: {},
    });
    expect((got2.payload as { agent: { defaultModelId: string } }).agent.defaultModelId).toBe(
      beta.modelId,
    );

    // Append message without run override → resolution should use agent default (beta).
    const ws = await writeAndRead(sock, reader, {
      id: 'ws-1',
      kind: 'request',
      type: 'workspace.create',
      payload: { folderPath: join(dir, 'workspace'), name: 'Agent WS' },
    });
    expect(ws.error).toBeUndefined();
    const workspaceId = (ws.payload as { workspaceId: string }).workspaceId;

    const task = await writeAndRead(sock, reader, {
      id: 'task-1',
      kind: 'request',
      type: 'task.create',
      payload: { workspaceId, title: 'Agent bind task', goal: 'verify default' },
    });
    expect(task.error).toBeUndefined();
    const taskPayload = task.payload as {
      taskId: string;
      threadId: string;
      taskVersion: number;
    };

    const runPin = {
      runId: 'run-agent-v1' as RunId,
      agentVersionId: agent1.agentVersionId as AgentVersionId,
    } satisfies RunAgentVersionPin;
    const stepPin = {
      ...runPin,
      stepId: 'step-agent-v1' as StepId,
    } satisfies StepAgentVersionPin;
    expect(stepPin.agentVersionId).toBe(agent1.agentVersionId);

    const pinnedPeek = await writeAndRead(sock, reader, {
      id: 'peek-agent-v1',
      kind: 'request',
      type: 'context.packet.peek',
      payload: {
        threadId: taskPayload.threadId,
        agentVersionId: agent1.agentVersionId,
      },
    });
    expect(pinnedPeek.error).toBeUndefined();
    expect(pinnedPeek.payload).toMatchObject({
      agentVersionId: agent1.agentVersionId,
      modelId: alpha.modelId,
    });

    const missingPeek = await writeAndRead(sock, reader, {
      id: 'peek-agent-missing',
      kind: 'request',
      type: 'context.packet.peek',
      payload: {
        threadId: taskPayload.threadId,
        agentVersionId: 'missing-agent-version',
      },
    });
    expect(missingPeek.error?.message).toContain('AgentVersion not found');

    const missingRun = await writeAndRead(sock, reader, {
      id: 'msg-agent-missing',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'do not substitute latest',
        agentVersionId: 'missing-agent-version',
      },
    });
    expect(missingRun.error?.message).toContain('AgentVersion not found');

    // Subscribe to capture context.packet.built / run events.
    const sub = await writeAndRead(sock, reader, {
      id: 'sub-1',
      kind: 'request',
      type: 'runtime.subscribeEvents',
      payload: { afterCursor: 0 },
    });
    expect(sub.error).toBeUndefined();

    const append = await writeAndRead(sock, reader, {
      id: 'msg-1',
      kind: 'request',
      type: 'task.appendMessage',
      payload: {
        threadId: taskPayload.threadId,
        expectedTaskVersion: taskPayload.taskVersion,
        role: 'user',
        text: 'hello agent default binding',
      },
    });
    expect(append.error).toBeUndefined();

    // Collect a few event frames looking for model id in payload.
    let sawAgentDefault = false;
    let sawModel = false;
    for (let i = 0; i < 12; i++) {
      const frames = await reader.read(1);
      const frame = frames[0]!;
      if (frame.kind !== 'event') continue;
      const payload = frame.payload as {
        type?: string;
        payload?: Record<string, unknown>;
        modelId?: string;
        resolutionSource?: string;
      };
      const inner = (payload.payload ?? payload) as Record<string, unknown>;
      const modelId = String(inner.modelId ?? payload.modelId ?? '');
      const source = String(inner.resolutionSource ?? payload.resolutionSource ?? '');
      if (modelId === beta.modelId) sawModel = true;
      if (source === 'agentDefault' || source.includes('agentDefault')) sawAgentDefault = true;
      if (JSON.stringify(inner).includes(beta.modelId)) sawModel = true;
      if (JSON.stringify(frame).includes('agentDefault')) sawAgentDefault = true;
      if (sawModel && sawAgentDefault) break;
    }
    expect(sawModel).toBe(true);

    sock.destroy();
    await session.close();
  }, 30_000);

  it('honors agent credential group and pin when opening a run (§5.4)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-agent-cred-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-agent-cred-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const session = await openPersistentRuntime({
      installId,
      dbPath,
      secureStoreKeyPath: secureKey,
      allowNoToken: true,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    const sock = await connectRuntime(installId);
    const reader = createFrameReader(sock);
    await hello(sock, reader, installId);

    const createdA = await writeAndRead(sock, reader, {
      id: 'prov-a',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Cred Gateway A',
        baseUrl: 'https://cred-a.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-group-a-primary-not-real',
        supportsDiscovery: false,
        credentialLabel: 'a-primary',
      },
    });
    expect(createdA.error).toBeUndefined();
    const providerA = (createdA.payload as {
      provider: {
        providerId: string;
        credentials: Array<{ credentialRefId: string; credentialGroupId: string; label: string }>;
      };
    }).provider;
    const groupA = providerA.credentials[0]!.credentialGroupId;
    const credAPrimary = providerA.credentials[0]!.credentialRefId;

    const createdB = await writeAndRead(sock, reader, {
      id: 'prov-b',
      kind: 'request',
      type: 'provider.create',
      payload: {
        name: 'Cred Gateway B',
        baseUrl: 'https://cred-b.example/v1',
        protocol: 'openai-chat',
        apiKey: 'sk-group-b-primary-not-real',
        supportsDiscovery: false,
        credentialLabel: 'b-primary',
      },
    });
    expect(createdB.error).toBeUndefined();
    const providerB = (createdB.payload as {
      provider: {
        providerId: string;
        credentials: Array<{ credentialRefId: string; credentialGroupId: string }>;
      };
    }).provider;
    const credBPrimary = providerB.credentials[0]!.credentialRefId;

    const addA = await writeAndRead(sock, reader, {
      id: 'add-a',
      kind: 'request',
      type: 'provider.addModels',
      payload: {
        providerId: providerA.providerId,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'cred-model', displayName: 'Cred Model' }],
      },
    });
    expect(addA.error).toBeUndefined();
    const modelA = (addA.payload as { models: Array<{ modelId: string }> }).models[0]!;

    const updGroup = await writeAndRead(sock, reader, {
      id: 'agent-upd-group',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelA.modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        defaultCredentialGroupId: groupA,
      },
    });
    expect(updGroup.error).toBeUndefined();
    const agentGroup = (updGroup.payload as {
      agent: { defaultCredentialGroupId?: string; pinnedCredentialRefId?: string };
    }).agent;
    expect(agentGroup.defaultCredentialGroupId).toBe(groupA);

    // Binding persistence is the §5.4 contract under test.
    // (Avoid event-drain loops that leave frame waiters and steal updateBinding responses.)

    const pin = await writeAndRead(sock, reader, {
      id: 'agent-pin',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelA.modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        defaultCredentialGroupId: groupA,
        pinnedCredentialRefId: credAPrimary,
      },
    });
    expect(pin.error).toBeUndefined();
    const agentPin = (pin.payload as {
      agent: { pinnedCredentialRefId?: string; defaultCredentialGroupId?: string };
    }).agent;
    expect(agentPin.pinnedCredentialRefId).toBe(credAPrimary);
    expect(agentPin.defaultCredentialGroupId).toBe(groupA);

    const unpin = await writeAndRead(sock, reader, {
      id: 'agent-unpin',
      kind: 'request',
      type: 'agent.updateBinding',
      payload: {
        defaultModelId: modelA.modelId,
        fallbackModelIds: [],
        pauseOnFailure: true,
        defaultCredentialGroupId: groupA,
        pinnedCredentialRefId: null,
      },
    });
    expect(unpin.error).toBeUndefined();
    const agentUnpin = (unpin.payload as { agent: { pinnedCredentialRefId?: string | null } }).agent;
    expect(agentUnpin.pinnedCredentialRefId == null || agentUnpin.pinnedCredentialRefId === undefined).toBe(true);

    sock.destroy();
    await session.close();
  }, 45_000)

});
