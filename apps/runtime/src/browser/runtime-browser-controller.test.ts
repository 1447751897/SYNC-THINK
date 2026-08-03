import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteBrowserStore,
} from '@sync-think/storage';
import type {
  BrowserHostLike,
  BrowserLeaseInfo,
  BrowserWorker,
  BrowserWorkerInput,
  WorkerEvent,
  WorkerToken,
} from '@sync-think/workers';
import {
  RuntimeBrowserController,
  type RuntimeBrowserExecuteInput,
  type RuntimeBrowserHandoffRequest,
  type RuntimeBrowserPermissionInput,
} from './runtime-browser-controller.js';

class RecordingLeaseHost
  implements Pick<BrowserHostLike, 'inspectLease' | 'recoverLease' | 'releaseLease'>
{
  lease: BrowserLeaseInfo = {
    leaseId: 'lease-1',
    pageId: 'page-1',
    profileId: 'default',
    ownerId: 'conversation:1',
  };
  readonly releases: Array<{ leaseId: string; closePage: boolean | undefined }> = [];
  readonly recoveries: BrowserLeaseInfo[] = [];
  missingUntilRecovered = false;

  async inspectLease(): Promise<BrowserLeaseInfo> {
    if (this.missingUntilRecovered) {
      throw Object.assign(new Error('lease missing'), { code: 'browser.lease-not-found' });
    }
    return { ...this.lease };
  }

  async recoverLease(input: BrowserLeaseInfo): Promise<BrowserLeaseInfo> {
    this.recoveries.push({ ...input });
    this.lease = { ...input };
    this.missingUntilRecovered = false;
    return { ...this.lease };
  }

  async releaseLease(leaseId: string, options?: { closePage?: boolean }): Promise<void> {
    this.releases.push({ leaseId, closePage: options?.closePage });
  }
}

class RecordingBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;
  readonly calls: Array<{ input: BrowserWorkerInput; token: WorkerToken }> = [];
  events: WorkerEvent[] = [
    { type: 'progress', fraction: 0.1, message: 'lease acquired' },
    {
      type: 'completed',
      output: {
        ok: true,
        message: 'Browser action completed',
        profileId: 'default',
        leaseId: 'lease-1',
        pageId: 'page-1',
        url: 'https://example.test/dashboard',
        title: 'Dashboard',
      },
    },
  ];

  async *exec(input: BrowserWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    this.calls.push({ input, token });
    yield* this.events;
  }
}

const tempDirs: string[] = [];
const connections: Array<Awaited<ReturnType<typeof openDatabaseAsync>>> = [];

afterEach(() => {
  for (const connection of connections.splice(0)) connection.raw.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function createHarnessWithWorker<T extends BrowserWorker>(
  worker: T,
  leaseHost?: Pick<BrowserHostLike, 'inspectLease' | 'recoverLease' | 'releaseLease'>,
) {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-controller-'));
  tempDirs.push(root);
  const databasePath = join(root, 'sync-think.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  connections.push(connection);
  const store = new SqliteBrowserStore(connection.raw);
  const controller = new RuntimeBrowserController({
    worker,
    store,
    profileId: 'default',
    fallbackWorkingDir: 'D:/runtime-data',
    leaseHost,
  });
  return { controller, store, worker, connection, leaseHost };
}

async function createHarness() {
  return createHarnessWithWorker(new RecordingBrowserWorker());
}

function permissionInput(overrides: Partial<RuntimeBrowserPermissionInput> = {}): RuntimeBrowserPermissionInput {
  return {
    toolName: 'browser_open',
    argumentsJson: JSON.stringify({ url: 'https://example.test/dashboard?secret=hidden' }),
    workspaceId: 'workspace-1',
    runId: 'run-1',
    ownerId: 'conversation:1',
    idempotencyKey: 'browser:run-1:call-1',
    ...overrides,
  };
}

function executeInput(
  overrides: Partial<RuntimeBrowserExecuteInput> = {},
): RuntimeBrowserExecuteInput {
  return {
    ...permissionInput(),
    capabilityToken: 'browser:run-1:call-1',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function handoffInput(
  overrides: Partial<RuntimeBrowserHandoffRequest> = {},
): RuntimeBrowserHandoffRequest {
  return {
    workspaceId: 'workspace-1',
    runId: 'run-1',
    ownerId: 'conversation:1',
    idempotencyKey: 'browser:run-1:handoff-1',
    reason: 'login',
    requestedOutcome: 'Complete sign-in and return to the dashboard.',
    onCancel: 'keep-open',
    ...overrides,
  };
}

describe('RuntimeBrowserController durable permissions', () => {
  it('requires a precise grant before Worker execution and persists the completed command', async () => {
    const { controller, store, worker } = await createHarness();
    const input = permissionInput();

    expect(controller.evaluatePermission(input)).toMatchObject({
      decision: 'approval-required',
      targetOrigin: 'https://example.test',
      permissionAction: 'navigate',
    });
    expect(worker.calls).toHaveLength(0);

    expect(controller.recordPermissionDecision(input, 'allow', 'approval-1')).toMatchObject({
      decision: 'allow',
    });
    const order: string[] = [];
    const result = JSON.parse(
      await controller.execute(
        executeInput({
          beforeExecute: (intent) => {
            order.push('intent');
            expect(intent.auditArgs).toEqual({ url: 'https://example.test/dashboard' });
          },
          onWorkerEvent: () => {
            order.push('worker');
          },
        }),
      ),
    ) as Record<string, unknown>;

    expect(order[0]).toBe('intent');
    expect(worker.calls).toHaveLength(1);
    expect(worker.calls[0]?.input).toMatchObject({
      workingDir: 'D:/runtime-data',
      profileId: 'default',
      ownerId: 'conversation:1',
      allowedSites: ['https://example.test'],
      action: { kind: 'navigate', url: 'https://example.test/dashboard?secret=hidden' },
    });
    expect(result).toMatchObject({ ok: true, url: 'https://example.test/dashboard' });

    const command = store.getCommandByIdempotencyKey(input.idempotencyKey);
    expect(command).toMatchObject({
      state: 'completed',
      targetOrigin: 'https://example.test',
      action: 'navigate',
      leaseId: 'lease-1',
      pageId: 'page-1',
    });
    expect(command?.sanitizedArgs).toEqual({ url: 'https://example.test/dashboard' });
  });

  it('persists deny decisions and never invokes the Worker', async () => {
    const { controller, store, worker } = await createHarness();
    const input = permissionInput();

    expect(controller.recordPermissionDecision(input, 'deny', 'approval-denied')).toMatchObject({
      decision: 'deny',
      code: 'browser.origin-denied',
    });
    const result = JSON.parse(await controller.execute(executeInput())) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: false,
      code: 'browser.origin-denied',
      failureClass: 'permission',
    });
    expect(worker.calls).toHaveLength(0);
    expect(store.getCommandByIdempotencyKey(input.idempotencyKey)).toMatchObject({ state: 'failed' });
  });

  it('replays a completed idempotency key without repeating the browser side effect', async () => {
    const { controller, worker } = await createHarness();
    const permission = permissionInput();
    controller.recordPermissionDecision(permission, 'allow', 'approval-1');

    const first = JSON.parse(await controller.execute(executeInput())) as Record<string, unknown>;
    const replay = JSON.parse(await controller.execute(executeInput())) as Record<string, unknown>;

    expect(first).toMatchObject({ ok: true });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(worker.calls).toHaveLength(1);
  });

  it('requires a distinct approval for click/fill and isolates grants by run', async () => {
    const { controller, worker } = await createHarness();
    const open = permissionInput();
    controller.recordPermissionDecision(open, 'allow', 'approval-open');
    await controller.execute(executeInput());

    const click = permissionInput({
      toolName: 'browser_click',
      argumentsJson: JSON.stringify({ selector: '#continue' }),
      idempotencyKey: 'browser:run-1:call-click',
    });
    expect(controller.evaluatePermission(click)).toMatchObject({ decision: 'approval-required' });
    controller.recordPermissionDecision(click, 'allow', 'approval-click');
    await controller.execute(
      executeInput({
        ...click,
        capabilityToken: 'browser:run-1:call-click',
      }),
    );

    const otherRun = permissionInput({
      runId: 'run-2',
      idempotencyKey: 'browser:run-2:call-open',
    });
    expect(controller.evaluatePermission(otherRun)).toMatchObject({ decision: 'approval-required' });
    expect(worker.calls).toHaveLength(2);
  });



  it('isolates Team Step grants by exact AgentVersion and rejects origins outside the frozen permission snapshot', async () => {
    const { controller, store } = await createHarness();
    const memberA = permissionInput({
      ownerId: 'step:run-1:step-a:agent-version-a',
      agentVersionId: 'agent-version-a',
      stepId: 'step-a',
      allowedOrigins: ['https://example.test'],
    });
    const memberB = permissionInput({
      ownerId: 'step:run-1:step-b:agent-version-b',
      agentVersionId: 'agent-version-b',
      stepId: 'step-b',
      allowedOrigins: ['https://example.test'],
      idempotencyKey: 'browser:run-1:step-b:call-1',
    });

    controller.recordPermissionDecision(memberA, 'allow', 'approval-agent-a');
    expect(controller.evaluatePermission(memberA)).toMatchObject({ decision: 'allow' });
    expect(controller.evaluatePermission(memberB)).toMatchObject({ decision: 'approval-required' });
    expect(
      store.resolveOriginDecision({
        scopes: [{ scopeType: 'agent-version', scopeId: 'agent-version-a' }],
        origin: 'https://example.test',
        action: 'navigate',
      }),
    ).toMatchObject({ decision: 'allow' });

    store.upsertOriginGrant({
      scopeType: 'run',
      scopeId: 'run-1',
      origin: 'https://blocked.example',
      action: 'navigate',
      decision: 'allow',
      approvalId: 'coordinator-run-grant',
    });
    expect(
      controller.evaluatePermission(
        permissionInput({
          argumentsJson: JSON.stringify({ url: 'https://blocked.example/private' }),
          ownerId: 'step:run-1:step-a:agent-version-a',
          agentVersionId: 'agent-version-a',
          stepId: 'step-a',
          allowedOrigins: ['https://example.test'],
          idempotencyKey: 'browser:run-1:step-a:blocked',
        }),
      ),
    ).toMatchObject({ decision: 'deny', code: 'browser.agent-origin-denied' });
  });

  it('shares a Profile while keeping each Team Step on a distinct owner lease', async () => {
    const calls: Array<{ input: BrowserWorkerInput; token: WorkerToken }> = [];
    const worker: BrowserWorker = {
      kind: 'browser',
      async *exec(input, token): AsyncIterable<WorkerEvent> {
        calls.push({ input, token });
        yield {
          type: 'completed',
          output: {
            ok: true,
            message: 'Browser action completed',
            profileId: input.profileId,
            leaseId: `lease:${input.ownerId}`,
            pageId: `page:${input.ownerId}`,
            url: 'https://example.test/dashboard',
          },
        };
      },
    };
    const { controller } = await createHarnessWithWorker(worker);
    const memberA = permissionInput({
      ownerId: 'step:run-1:step-a:agent-version-a',
      agentVersionId: 'agent-version-a',
      stepId: 'step-a',
      allowedOrigins: ['https://example.test'],
      idempotencyKey: 'browser:run-1:step-a:call-1',
    });
    const memberB = permissionInput({
      ownerId: 'step:run-1:step-b:agent-version-b',
      agentVersionId: 'agent-version-b',
      stepId: 'step-b',
      allowedOrigins: ['https://example.test'],
      idempotencyKey: 'browser:run-1:step-b:call-1',
    });
    controller.recordPermissionDecision(memberA, 'allow', 'approval-agent-a');
    controller.recordPermissionDecision(memberB, 'allow', 'approval-agent-b');

    const resultA = JSON.parse(
      await controller.execute(
        executeInput({ ...memberA, capabilityToken: 'browser:run-1:step-a:call-1' }),
      ),
    ) as Record<string, unknown>;
    const resultB = JSON.parse(
      await controller.execute(
        executeInput({ ...memberB, capabilityToken: 'browser:run-1:step-b:call-1' }),
      ),
    ) as Record<string, unknown>;

    expect(calls.map((call) => call.input.profileId)).toEqual(['default', 'default']);
    expect(calls[0]?.input.ownerId).not.toBe(calls[1]?.input.ownerId);
    expect(calls[0]?.input).not.toHaveProperty('leaseId');
    expect(calls[1]?.input).not.toHaveProperty('leaseId');
    expect(resultA.leaseId).toBe('lease:step:run-1:step-a:agent-version-a');
    expect(resultB.leaseId).toBe('lease:step:run-1:step-b:agent-version-b');
    expect(resultA.leaseId).not.toBe(resultB.leaseId);
  });

  it('returns and persists Team Step audit identity without accepting caller lease identifiers', async () => {
    const { controller, store, worker } = await createHarness();
    const input = permissionInput({
      ownerId: 'step:run-1:step-a:agent-version-a',
      agentVersionId: 'agent-version-a',
      stepId: 'step-a',
      allowedOrigins: ['https://example.test'],
    });
    controller.recordPermissionDecision(input, 'allow', 'approval-agent-a');

    const result = JSON.parse(
      await controller.execute(
        executeInput({
          ...input,
          capabilityToken: 'browser:run-1:step-a:call-1',
        }),
      ),
    ) as Record<string, unknown>;

    expect(worker.calls[0]?.input).toMatchObject({
      ownerId: 'step:run-1:step-a:agent-version-a',
      profileId: 'default',
    });
    expect(result).toMatchObject({
      commandId: expect.any(String),
      ownerId: 'step:run-1:step-a:agent-version-a',
      agentVersionId: 'agent-version-a',
      stepId: 'step-a',
      profileId: 'default',
      leaseId: 'lease-1',
      pageId: 'page-1',
      targetOrigin: 'https://example.test',
    });
    expect(store.getCommandByIdempotencyKey(input.idempotencyKey)?.result?.output).toMatchObject({
      commandId: result.commandId,
      ownerId: 'step:run-1:step-a:agent-version-a',
      agentVersionId: 'agent-version-a',
      stepId: 'step-a',
      profileId: 'default',
      leaseId: 'lease-1',
      targetOrigin: 'https://example.test',
    });
  });

  it('persists a durable waiting handoff against the exact active Page lease', async () => {
    const leaseHost = new RecordingLeaseHost();
    const { controller, store } = await createHarnessWithWorker(new RecordingBrowserWorker(), leaseHost);
    const browserInput = permissionInput();
    controller.recordPermissionDecision(browserInput, 'allow', 'approval-1');
    await controller.execute(executeInput());

    const result = await controller.requestHandoff(handoffInput());
    expect(result.status).toBe('waiting_user');
    if (result.status !== 'waiting_user') throw new Error('expected waiting handoff');

    expect(result).toMatchObject({
      status: 'waiting_user',
      handoff: {
        revision: 1,
        workspaceId: 'workspace-1',
        runId: 'run-1',
        siteOrigin: 'https://example.test',
        reason: 'login',
        requestedOutcome: 'Complete sign-in and return to the dashboard.',
        status: 'waiting_user',
      },
    });
    expect(result.handoff).not.toHaveProperty('leaseId');
    expect(result.handoff).not.toHaveProperty('ownerId');
    expect(store.getCommand(result.handoff.handoffId)).toMatchObject({
      toolName: 'browser_handoff',
      state: 'waiting_user',
      leaseId: 'lease-1',
      pageId: 'page-1',
      errorCode: 'browser.handoff-required',
    });
    expect(controller.listWaitingHandoffs({ workspaceId: 'workspace-1' })).toEqual([
      result.handoff,
    ]);
  });

  it('revalidates lease ownership before Continue and completes from the same handoff checkpoint', async () => {
    const leaseHost = new RecordingLeaseHost();
    const { controller } = await createHarnessWithWorker(new RecordingBrowserWorker(), leaseHost);
    const browserInput = permissionInput();
    controller.recordPermissionDecision(browserInput, 'allow', 'approval-1');
    await controller.execute(executeInput());
    const waiting = await controller.requestHandoff(handoffInput());
    if (waiting.status !== 'waiting_user') throw new Error('expected waiting handoff');

    leaseHost.lease = { ...leaseHost.lease, ownerId: 'conversation:other' };
    await expect(
      controller.continueHandoff({ handoffId: waiting.handoff.handoffId, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'browser.handoff-ownership-mismatch' });

    leaseHost.lease = { ...leaseHost.lease, ownerId: 'conversation:1' };
    await expect(
      controller.continueHandoff({ handoffId: waiting.handoff.handoffId, expectedRevision: 1 }),
    ).resolves.toMatchObject({ status: 'continued' });
    await expect(controller.requestHandoff(handoffInput())).resolves.toMatchObject({
      status: 'continued',
      replayed: false,
    });
    await expect(controller.requestHandoff(handoffInput())).resolves.toMatchObject({
      status: 'continued',
      replayed: true,
    });
  });

  it('recovers a missing in-memory lease from the durable handoff checkpoint before Continue', async () => {
    const leaseHost = new RecordingLeaseHost();
    const { controller } = await createHarnessWithWorker(new RecordingBrowserWorker(), leaseHost);
    const browserInput = permissionInput();
    controller.recordPermissionDecision(browserInput, 'allow', 'approval-1');
    await controller.execute(executeInput());
    const waiting = await controller.requestHandoff(handoffInput());
    if (waiting.status !== 'waiting_user') throw new Error('expected waiting handoff');

    leaseHost.missingUntilRecovered = true;
    await expect(
      controller.continueHandoff({ handoffId: waiting.handoff.handoffId, expectedRevision: 1 }),
    ).resolves.toMatchObject({ status: 'continued', replayed: false });
    expect(leaseHost.recoveries).toEqual([
      {
        leaseId: 'lease-1',
        pageId: 'page-1',
        profileId: 'default',
        ownerId: 'conversation:1',
      },
    ]);
  });

  it('cancels idempotently and only closes the Page for the explicit close-page lifecycle', async () => {
    const leaseHost = new RecordingLeaseHost();
    const { controller } = await createHarnessWithWorker(new RecordingBrowserWorker(), leaseHost);
    const browserInput = permissionInput();
    controller.recordPermissionDecision(browserInput, 'allow', 'approval-1');
    await controller.execute(executeInput());
    const waiting = await controller.requestHandoff(
      handoffInput({ onCancel: 'close-page' }),
    );
    if (waiting.status !== 'waiting_user') throw new Error('expected waiting handoff');
    leaseHost.missingUntilRecovered = true;

    await expect(
      controller.cancelHandoff({
        handoffId: waiting.handoff.handoffId,
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ status: 'cancelled', replayed: false });
    await expect(
      controller.cancelHandoff({
        handoffId: waiting.handoff.handoffId,
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({ status: 'cancelled', replayed: true });
    expect(leaseHost.recoveries).toEqual([leaseHost.lease]);
    expect(leaseHost.releases).toEqual([{ leaseId: 'lease-1', closePage: true }]);
  });

  it('marks unknown running commands for inspection when a controller restarts', async () => {
    const { store, worker } = await createHarness();
    const input = permissionInput();
    store.upsertOriginGrant({
      scopeType: 'run',
      scopeId: input.runId,
      origin: 'https://example.test',
      action: 'navigate',
      decision: 'allow',
      approvalId: 'approval-1',
    });
    const command = store.reserveCommand({
      idempotencyKey: input.idempotencyKey,
      workspaceId: input.workspaceId,
      runId: input.runId,
      ownerId: input.ownerId,
      profileId: 'default',
      toolName: input.toolName,
      action: 'navigate',
      targetOrigin: 'https://example.test',
      sanitizedArgs: { url: 'https://example.test/dashboard' },
    });
    store.markApproved(command.id);
    store.markRunning(command.id);

    new RuntimeBrowserController({
      worker,
      store,
      fallbackWorkingDir: 'D:/runtime-data',
    });

    expect(store.getCommand(command.id)).toMatchObject({
      state: 'waiting_user',
      errorCode: 'browser.command-inspection-required',
    });
    expect(worker.calls).toHaveLength(0);
  });

  it('does not invoke the Worker when durable intent persistence fails', async () => {
    const { controller, worker } = await createHarness();
    const input = permissionInput();
    controller.recordPermissionDecision(input, 'allow', 'approval-1');
    const beforeExecute = vi.fn(() => {
      throw new Error('event store unavailable');
    });

    const result = JSON.parse(
      await controller.execute(executeInput({ beforeExecute })),
    ) as Record<string, unknown>;

    expect(result).toMatchObject({ ok: false, code: 'browser.intent-persist-failed' });
    expect(worker.calls).toHaveLength(0);
  });
});
