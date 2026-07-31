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
  BrowserWorker,
  BrowserWorkerInput,
  WorkerEvent,
  WorkerToken,
} from '@sync-think/workers';
import {
  RuntimeBrowserController,
  type RuntimeBrowserExecuteInput,
  type RuntimeBrowserPermissionInput,
} from './runtime-browser-controller.js';

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

async function createHarness(worker = new RecordingBrowserWorker()) {
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
  });
  return { controller, store, worker, connection };
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
