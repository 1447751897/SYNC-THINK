import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { SecureStore, XorDevBackend } from '@sync-think/secure-store';
import type { RunId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAgentStore,
  SqliteBrowserStore,
  SqliteOrchestrationStore,
  SqliteProviderStore,
} from '@sync-think/storage';
import type {
  BrowserCommandResult,
  BrowserHostExecuteInput,
  BrowserHostLike,
  BrowserLeaseInfo,
} from '@sync-think/workers';
import { openPersistentRuntime, type PersistentRuntimeSession } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

interface DurableBrowserState {
  pages: Map<string, BrowserLeaseInfo>;
  executions: BrowserHostExecuteInput[];
  releases: Array<{ leaseId: string; closePage: boolean }>;
  recoveries: BrowserLeaseInfo[];
  shutdowns: Array<{ preserveSessions?: boolean }>;
}

function createDurableBrowserState(): DurableBrowserState {
  return {
    pages: new Map(),
    executions: [],
    releases: [],
    recoveries: [],
    shutdowns: [],
  };
}

class DurableBrowserHost implements BrowserHostLike {
  readonly leases = new Map<string, BrowserLeaseInfo>();

  constructor(readonly state = createDurableBrowserState()) {}

  get executions(): BrowserHostExecuteInput[] {
    return this.state.executions;
  }

  get releases(): Array<{ leaseId: string; closePage: boolean }> {
    return this.state.releases;
  }

  async acquireLease(input: { profileId: string; ownerId: string }): Promise<BrowserLeaseInfo> {
    const lease: BrowserLeaseInfo = {
      profileId: input.profileId,
      ownerId: input.ownerId,
      leaseId: `lease:${input.ownerId}`,
      pageId: `page:${input.ownerId}`,
    };
    this.leases.set(lease.leaseId, lease);
    this.state.pages.set(lease.pageId, lease);
    return lease;
  }

  async inspectLease(leaseId: string): Promise<BrowserLeaseInfo> {
    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw Object.assign(new Error('browser.lease_not_found'), {
        code: 'browser.lease-not-found',
      });
    }
    return lease;
  }

  async recoverLease(input: BrowserLeaseInfo): Promise<BrowserLeaseInfo> {
    const page = this.state.pages.get(input.pageId);
    if (
      !page ||
      page.leaseId !== input.leaseId ||
      page.profileId !== input.profileId ||
      page.ownerId !== input.ownerId
    ) {
      throw Object.assign(new Error('browser.lease_not_found'), {
        code: 'browser.lease-not-found',
      });
    }
    this.state.recoveries.push({ ...input });
    this.leases.set(input.leaseId, { ...input });
    return { ...input };
  }

  async execute(input: BrowserHostExecuteInput): Promise<BrowserCommandResult> {
    this.state.executions.push(input);
    const lease = await this.inspectLease(input.leaseId);
    return {
      ok: true,
      message: 'Browser navigation completed',
      ...lease,
      url: 'https://example.test/sign-in',
      title: 'Sign in',
    };
  }

  async releaseLease(leaseId: string, options: { closePage: boolean }): Promise<void> {
    this.state.releases.push({ leaseId, closePage: options.closePage });
    const lease = this.leases.get(leaseId);
    this.leases.delete(leaseId);
    if (options.closePage && lease) this.state.pages.delete(lease.pageId);
  }

  async shutdown(options: { preserveSessions?: boolean } = {}): Promise<void> {
    this.state.shutdowns.push(options);
    if (!options.preserveSessions) {
      for (const lease of this.leases.values()) this.state.pages.delete(lease.pageId);
    }
    this.leases.clear();
  }
}

class HandoffProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  constructor(private readonly onCancel: 'keep-open' | 'close-page') {}

  async discoverModels(): Promise<string[]> {
    return [];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    if (!request.messages.some((message) => message.role === 'tool')) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'handoff-open-call',
          name: 'browser_open',
          argumentsJson: JSON.stringify({ url: 'https://example.test/sign-in' }),
        },
      };
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'handoff-user-call',
          name: 'browser_handoff',
          argumentsJson: JSON.stringify({
            reason: 'login',
            requestedOutcome: 'Sign in and leave the dashboard visible.',
            onCancel: this.onCancel,
          }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    yield { type: 'text-delta', text: 'The signed-in workflow completed.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

async function seedHandoffRun(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  const keyPath = join(dir, 'secure', 'key.bin');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const secureStore = new SecureStore(new XorDevBackend(keyPath));
  const secret = await secureStore.storeSecret('handoff-provider-secret');
  const providerStore = new SqliteProviderStore(connection.raw);
  const provider = providerStore.createProvider({
    name: 'Handoff provider',
    baseUrl: 'https://provider.example/v1',
    protocol: 'openai-chat',
    supportsDiscovery: false,
    storeHandle: secret,
  });
  const model = providerStore.upsertModels({
    providerId: provider.provider.id,
    protocol: 'openai-chat',
    models: [{ providerModelId: 'handoff-model' }],
  })[0]!;
  connection.raw
    .prepare(
      `INSERT INTO workspace (id, folder_path, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      'workspace-handoff',
      dir,
      'Handoff',
      '2026-07-31T00:00:00.000Z',
      '2026-07-31T00:00:00.000Z',
    );
  connection.raw
    .prepare(
      `INSERT INTO task (
         id, workspace_id, title, goal, status, participation_mode,
         acceptance_criteria_json, version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', 'automatic', '[]', 0, ?, ?)`,
    )
    .run(
      'task-handoff',
      'workspace-handoff',
      'Browser handoff',
      'Complete login',
      '2026-07-31T00:00:00.000Z',
      '2026-07-31T00:00:00.000Z',
    );
  connection.raw
    .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
    .run('thread-handoff', 'task-handoff', '2026-07-31T00:00:00.000Z');
  const agent = new SqliteAgentStore(connection.raw).createAgent({
    name: 'Handoff worker',
    role: 'worker',
    developerInstructions: 'Complete the browser login workflow.',
    inputContract: 'step instructions',
    outputContract: 'text artifact',
    defaultModelId: model.id,
    defaultCredentialGroupId: provider.credentialGroup.id,
    approvalMode: 'full',
  });
  connection.raw
    .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
    .run(JSON.stringify(['text', 'tool-calling']), model.id);
  connection.raw.prepare('UPDATE agent_version SET permissions_json = ? WHERE id = ?').run(
    JSON.stringify({
      file: [],
      command: [],
      browser: ['https://example.test'],
      desktop: [],
      network: [],
    }),
    agent.id,
  );
  new SqliteBrowserStore(connection.raw).upsertOriginGrant({
    scopeType: 'agent-version',
    scopeId: agent.id,
    origin: 'https://example.test',
    action: 'navigate',
    decision: 'allow',
    approvalId: 'preapproved-browser-open',
  });
  const orchestration = new SqliteOrchestrationStore(connection.raw);
  const plan = orchestration.createPlanDraft({
    taskId: 'task-handoff' as never,
    title: 'Browser handoff run',
    steps: [
      {
        id: 'step-handoff' as never,
        title: 'Sign in',
        instructions: 'Open the login page and request human handoff.',
        agentVersionId: agent.id,
        dependsOn: [],
      },
    ],
    now: '2026-07-31T00:00:00.000Z',
  });
  const graph = orchestration.approvePlan({
    planId: plan.planId,
    revision: 1,
    now: '2026-07-31T00:00:00.000Z',
  });
  secureStore.shutdown();
  connection.raw.close();
  return { dir, dbPath, keyPath, runId: graph.run.id };
}

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolveConnect, reject) => {
    socket.once('connect', resolveConnect);
    socket.once('error', reject);
  });
  return socket;
}

function frameInbox(socket: Socket) {
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
      const response = new Promise<Frame>((resolveResponse) =>
        waiters.set(frame.id, resolveResponse),
      );
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

async function connectClient(installId: string) {
  const socket = await connectRuntime(installId);
  const inbox = frameInbox(socket);
  const hello = await inbox.send({
    id: `hello-${randomBytes(4).toString('hex')}`,
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: randomBytes(8).toString('hex'),
      features: ['browser.handoff', 'run.getGraph'],
    },
  });
  expect(hello.error).toBeUndefined();
  return { socket, inbox };
}

async function openSession(input: {
  dbPath: string;
  keyPath: string;
  installId: string;
  provider: ProviderAdapter;
  browserHost: BrowserHostLike;
}): Promise<PersistentRuntimeSession> {
  const session = await openPersistentRuntime({
    dbPath: input.dbPath,
    secureStoreKeyPath: input.keyPath,
    installId: input.installId,
    allowNoToken: true,
    discoveryByProtocol: { 'openai-chat': input.provider },
    browserHost: input.browserHost,
  });
  await session.runtime.start();
  return session;
}

async function waitForWaitingHandoff(
  inbox: ReturnType<typeof frameInbox>,
  runId: RunId,
  timeoutMs = 8_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last: Frame | undefined;
  while (Date.now() < deadline) {
    last = await inbox.send({
      id: `list-${randomBytes(4).toString('hex')}`,
      kind: 'request',
      type: 'browser.handoff.listWaiting',
      payload: { workspaceId: 'workspace-handoff', runId },
    });
    const handoffs = (last.payload as { handoffs?: Array<Record<string, unknown>> }).handoffs ?? [];
    if (handoffs.length === 1) return handoffs[0]!;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`handoff did not become waiting: ${JSON.stringify(last)}`);
}

async function waitForRunState(
  inbox: ReturnType<typeof frameInbox>,
  runId: RunId,
  expectedState: string,
  timeoutMs = 8_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last: Frame | undefined;
  while (Date.now() < deadline) {
    last = await inbox.send({
      id: `graph-${randomBytes(4).toString('hex')}`,
      kind: 'request',
      type: 'run.getGraph',
      payload: { workspaceId: 'workspace-handoff', taskId: 'task-handoff', runId },
    });
    const state = (last.payload as { run?: { state?: string } }).run?.state;
    if (state === expectedState) return last;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`run did not reach ${expectedState}: ${JSON.stringify(last)}`);
}

describe('Runtime durable Browser handoff commands', () => {
  it('lists after cold restart, continues once, drains the same Step, and replays idempotently', async () => {
    const fixture = await seedHandoffRun('sync-think-browser-handoff-runtime-');
    const provider = new HandoffProvider('keep-open');
    const browserState = createDurableBrowserState();
    const firstBrowserHost = new DurableBrowserHost(browserState);
    const firstInstallId = `handoff-first-${randomBytes(4).toString('hex')}`;
    const first = await openSession({
      ...fixture,
      installId: firstInstallId,
      provider,
      browserHost: firstBrowserHost,
    });
    const firstClient = await connectClient(firstInstallId);
    let waitingBeforeRestart: Record<string, unknown>;
    try {
      waitingBeforeRestart = await waitForWaitingHandoff(firstClient.inbox, fixture.runId);
      expect(waitingBeforeRestart).toMatchObject({
        revision: 1,
        workspaceId: 'workspace-handoff',
        taskId: 'task-handoff',
        runId: fixture.runId,
        stepId: 'step-handoff',
        siteOrigin: 'https://example.test',
        reason: 'login',
        status: 'waiting_user',
      });
      expect(waitingBeforeRestart).not.toHaveProperty('leaseId');
      expect(waitingBeforeRestart).not.toHaveProperty('pageId');
      expect(waitingBeforeRestart).not.toHaveProperty('ownerId');
    } finally {
      firstClient.socket.destroy();
      await first.close();
    }

    expect(browserState.shutdowns).toEqual([{ preserveSessions: true }]);
    expect(firstBrowserHost.leases).toHaveLength(0);

    const secondBrowserHost = new DurableBrowserHost(browserState);
    const secondInstallId = `handoff-second-${randomBytes(4).toString('hex')}`;
    const second = await openSession({
      ...fixture,
      installId: secondInstallId,
      provider,
      browserHost: secondBrowserHost,
    });
    const secondClient = await connectClient(secondInstallId);
    try {
      const waiting = await waitForWaitingHandoff(secondClient.inbox, fixture.runId);
      expect(waiting.handoffId).toBe(waitingBeforeRestart.handoffId);
      const continued = await secondClient.inbox.send({
        id: 'continue-handoff',
        kind: 'request',
        type: 'browser.handoff.continue',
        payload: { handoffId: waiting.handoffId, expectedRevision: 1 },
      });
      expect(continued.error).toBeUndefined();
      expect(continued.payload).toMatchObject({
        status: 'continued',
        handoffId: waiting.handoffId,
        replayed: false,
        runId: fixture.runId,
        stepId: 'step-handoff',
      });
      await waitForRunState(secondClient.inbox, fixture.runId, 'completed');
      expect(provider.requests).toHaveLength(2);
      expect(browserState.executions).toHaveLength(1);
      expect(browserState.releases).toHaveLength(0);
      expect(browserState.recoveries).toEqual([
        {
          leaseId: expect.stringMatching(/^lease:/),
          pageId: expect.stringMatching(/^page:/),
          profileId: 'default',
          ownerId: expect.stringContaining('step-handoff'),
        },
      ]);

      const replay = await secondClient.inbox.send({
        id: 'continue-handoff-replay',
        kind: 'request',
        type: 'browser.handoff.continue',
        payload: { handoffId: waiting.handoffId, expectedRevision: 1 },
      });
      expect(replay.error).toBeUndefined();
      expect(replay.payload).toMatchObject({ status: 'continued', replayed: true });
      expect(provider.requests).toHaveLength(2);
    } finally {
      secondClient.socket.destroy();
      await second.close();
    }

    const verificationConnection = await openDatabaseAsync({ path: fixture.dbPath });
    try {
      const sessions = new SqliteBrowserStore(verificationConnection.raw).listSiteSessions(
        'default',
      );
      expect(sessions).toMatchObject([
        {
          siteKey: 'example.test',
          state: 'verified',
          origins: ['https://example.test'],
        },
      ]);
    } finally {
      verificationConnection.raw.close();
    }
  });

  it('recovers a keep-open lease after cold restart so final shutdown still owns the browser', async () => {
    const fixture = await seedHandoffRun('sync-think-browser-handoff-cancel-keep-open-');
    const provider = new HandoffProvider('keep-open');
    const browserState = createDurableBrowserState();
    const firstBrowserHost = new DurableBrowserHost(browserState);
    const firstInstallId = `handoff-keep-open-first-${randomBytes(4).toString('hex')}`;
    const first = await openSession({
      ...fixture,
      installId: firstInstallId,
      provider,
      browserHost: firstBrowserHost,
    });
    const firstClient = await connectClient(firstInstallId);
    let waitingBeforeRestart: Record<string, unknown>;
    try {
      waitingBeforeRestart = await waitForWaitingHandoff(firstClient.inbox, fixture.runId);
    } finally {
      firstClient.socket.destroy();
      await first.close();
    }

    expect(browserState.shutdowns).toEqual([{ preserveSessions: true }]);
    expect(browserState.pages).toHaveLength(1);

    const secondBrowserHost = new DurableBrowserHost(browserState);
    const secondInstallId = `handoff-keep-open-second-${randomBytes(4).toString('hex')}`;
    const second = await openSession({
      ...fixture,
      installId: secondInstallId,
      provider,
      browserHost: secondBrowserHost,
    });
    const secondClient = await connectClient(secondInstallId);
    try {
      const waiting = await waitForWaitingHandoff(secondClient.inbox, fixture.runId);
      expect(waiting.handoffId).toBe(waitingBeforeRestart.handoffId);
      const cancelled = await secondClient.inbox.send({
        id: 'cancel-keep-open-handoff',
        kind: 'request',
        type: 'browser.handoff.cancel',
        payload: { handoffId: waiting.handoffId, expectedRevision: 1 },
      });
      expect(cancelled.error).toBeUndefined();
      expect(cancelled.payload).toMatchObject({
        status: 'cancelled',
        handoffId: waiting.handoffId,
        replayed: false,
      });
      await waitForRunState(secondClient.inbox, fixture.runId, 'failed');
      expect(browserState.recoveries).toEqual([
        {
          leaseId: expect.stringMatching(/^lease:/),
          pageId: expect.stringMatching(/^page:/),
          profileId: 'default',
          ownerId: expect.stringContaining('step-handoff'),
        },
      ]);
      expect(browserState.releases).toHaveLength(0);
      expect(browserState.pages).toHaveLength(1);
      expect(provider.requests).toHaveLength(1);
    } finally {
      secondClient.socket.destroy();
      await second.close();
    }

    expect(browserState.shutdowns).toEqual([
      { preserveSessions: true },
      { preserveSessions: false },
    ]);
    expect(browserState.pages).toHaveLength(0);
  });

  it('cancels with close-page exactly once and rejects the waiting Step', async () => {
    const fixture = await seedHandoffRun('sync-think-browser-handoff-cancel-');
    const provider = new HandoffProvider('close-page');
    const browserHost = new DurableBrowserHost();
    const installId = `handoff-cancel-${randomBytes(4).toString('hex')}`;
    const session = await openSession({ ...fixture, installId, provider, browserHost });
    const client = await connectClient(installId);
    try {
      const waiting = await waitForWaitingHandoff(client.inbox, fixture.runId);
      const cancelled = await client.inbox.send({
        id: 'cancel-handoff',
        kind: 'request',
        type: 'browser.handoff.cancel',
        payload: { handoffId: waiting.handoffId, expectedRevision: 1 },
      });
      expect(cancelled.error).toBeUndefined();
      expect(cancelled.payload).toMatchObject({
        status: 'cancelled',
        handoffId: waiting.handoffId,
        replayed: false,
        runId: fixture.runId,
        stepId: 'step-handoff',
      });
      await waitForRunState(client.inbox, fixture.runId, 'failed');
      expect(browserHost.releases).toEqual([
        { leaseId: expect.stringMatching(/^lease:/), closePage: true },
      ]);
      expect(provider.requests).toHaveLength(1);

      const replay = await client.inbox.send({
        id: 'cancel-handoff-replay',
        kind: 'request',
        type: 'browser.handoff.cancel',
        payload: { handoffId: waiting.handoffId, expectedRevision: 1 },
      });
      expect(replay.error).toBeUndefined();
      expect(replay.payload).toMatchObject({ status: 'cancelled', replayed: true });
      expect(browserHost.releases).toHaveLength(1);
    } finally {
      client.socket.destroy();
      await session.close();
    }
  });

  it('returns stable Browser handoff error codes without exposing internal lease identity', async () => {
    const fixture = await seedHandoffRun('sync-think-browser-handoff-errors-');
    const provider = new HandoffProvider('keep-open');
    const browserHost = new DurableBrowserHost();
    const installId = `handoff-errors-${randomBytes(4).toString('hex')}`;
    const session = await openSession({ ...fixture, installId, provider, browserHost });
    const client = await connectClient(installId);
    try {
      await waitForWaitingHandoff(client.inbox, fixture.runId);
      const missing = await client.inbox.send({
        id: 'continue-missing-handoff',
        kind: 'request',
        type: 'browser.handoff.continue',
        payload: { handoffId: 'missing-handoff', expectedRevision: 1 },
      });
      expect(missing.error).toMatchObject({ code: 'browser.handoff-not-found' });
      expect(JSON.stringify(missing)).not.toMatch(/lease:|page:|ownerId|profileId/);
    } finally {
      client.socket.destroy();
      await session.close();
    }
  });
});
