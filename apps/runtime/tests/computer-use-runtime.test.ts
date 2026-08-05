import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterEvent, ProviderAdapter, ProviderCallRequest } from '@sync-think/adapters';
import {
  COMPUTER_USE_PLUGIN_SETTING_KEY,
  decodeFrames,
  encodeFrame,
  pipePathPortable,
  type Frame,
} from '@sync-think/protocol';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteConversationStore,
  SqliteEventCheckpointStore,
  SqliteDesktopStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type {
  DesktopElementTarget,
  DesktopWorker,
  DesktopWorkerInput,
  WorkerEvent,
  WorkerToken,
} from '@sync-think/workers';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class RecordingProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    yield { type: 'text-delta', text: 'Done.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class DesktopListProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];
  toolResult?: string;

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const resultMessage = request.messages.find((message) => message.role === 'tool');
    if (!resultMessage) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'desktop-list-1',
          name: 'desktop_list_windows',
          argumentsJson: '{}',
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    this.toolResult = String(resultMessage.content);
    yield { type: 'text-delta', text: 'Desktop inspected.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class CompletedDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  calls = 0;
  async *exec(): AsyncIterable<WorkerEvent> {
    this.calls += 1;
    yield {
      type: 'completed',
      output: {
        ok: true,
        message: 'listed',
        result: { kind: 'window-list', windows: [], truncated: false },
      },
    };
  }
}

const FIXTURE_ELEMENT_TARGET: DesktopElementTarget = {
  window: { processId: 42, nativeWindowHandle: '0x1234', title: 'Fixture' },
  snapshotRevision: 'snapshot-1',
  accessibilityRevision: 'accessibility-1',
  elementIndex: 3,
};

class InterruptingDesktopProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  toolResult?: string;

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const resultMessages = request.messages.filter((message) => message.role === 'tool');
    if (resultMessages.length === 0) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'desktop-resolve-interrupt',
          name: 'desktop_resolve_selector',
          argumentsJson: JSON.stringify({
            target: {
              window: FIXTURE_ELEMENT_TARGET.window,
              snapshotRevision: FIXTURE_ELEMENT_TARGET.snapshotRevision,
              accessibilityRevision: FIXTURE_ELEMENT_TARGET.accessibilityRevision,
            },
            selector: { automationId: 'ApplyButton', controlType: 'Button' },
          }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    if (resultMessages.length === 1) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'desktop-interrupt-1',
          name: 'desktop_invoke_element',
          argumentsJson: JSON.stringify({ target: FIXTURE_ELEMENT_TARGET }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    this.toolResult = String(resultMessages.at(-1)?.content ?? '');
    yield { type: 'text-delta', text: 'Desktop interrupted.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class InterruptibleDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  private resolveStarted!: () => void;
  readonly startedPromise = new Promise<void>((resolve) => {
    this.resolveStarted = resolve;
  });

  async *exec(input: DesktopWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (input.action.kind === 'resolve-selector') {
      yield {
        type: 'completed',
        output: {
          ok: true,
          message: 'resolved',
          result: {
            kind: 'element-resolved',
            target: FIXTURE_ELEMENT_TARGET,
            element: {
              index: FIXTURE_ELEMENT_TARGET.elementIndex,
              name: 'Apply',
              automationId: 'ApplyButton',
              controlType: 'Button',
              processId: FIXTURE_ELEMENT_TARGET.window.processId,
              enabled: true,
              offscreen: false,
              isPassword: false,
              supportedPatterns: ['Invoke'],
            },
          },
        },
      };
      return;
    }
    this.resolveStarted();
    await new Promise<void>((resolve) => {
      if (token.signal?.aborted) {
        resolve();
        return;
      }
      token.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    yield {
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'desktop.cancelled', message: 'aborted' },
    };
  }
}

class LateDisabledDesktopProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  readonly requests: ProviderCallRequest[] = [];
  toolResult?: string;

  constructor(private readonly disablePlugin: () => void) {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.requests.push(request);
    const resultMessage = request.messages.find((message) => message.role === 'tool');
    if (!resultMessage) {
      this.disablePlugin();
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'desktop-call-1',
          name: 'desktop_set_value',
          argumentsJson: '{}',
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    this.toolResult = String(resultMessage.content);
    yield { type: 'text-delta', text: 'Desktop capability changed.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class SingleDesktopActionProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  toolResult?: string;

  constructor(
    private readonly toolName: 'desktop_invoke_element' | 'desktop_set_value',
    private readonly argumentsJson: string,
  ) {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const resultMessages = request.messages.filter((message) => message.role === 'tool');
    if (resultMessages.length === 0) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'desktop-sensitive-1',
          name: this.toolName,
          argumentsJson: this.argumentsJson,
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    this.toolResult = String(resultMessages.at(-1)?.content ?? '');
    yield { type: 'text-delta', text: 'Desktop action handled.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class ResolvedDesktopActionProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;
  toolResult?: string;

  constructor(
    private readonly toolName: 'desktop_invoke_element' | 'desktop_set_value',
    private readonly argumentsJson: string,
    private readonly selector: { automationId: string; controlType: string },
  ) {}

  async discoverModels(): Promise<string[]> {
    return ['fake-mini'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const resultMessages = request.messages.filter((message) => message.role === 'tool');
    if (resultMessages.length === 0) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'desktop-resolve-1',
          name: 'desktop_resolve_selector',
          argumentsJson: JSON.stringify({
            target: {
              window: FIXTURE_ELEMENT_TARGET.window,
              snapshotRevision: FIXTURE_ELEMENT_TARGET.snapshotRevision,
              accessibilityRevision: FIXTURE_ELEMENT_TARGET.accessibilityRevision,
            },
            selector: this.selector,
          }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    if (resultMessages.length === 1) {
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'desktop-action-1',
          name: this.toolName,
          argumentsJson: this.argumentsJson,
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    this.toolResult = String(resultMessages.at(-1)?.content ?? '');
    yield { type: 'text-delta', text: 'Desktop action handled.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class MetadataDesktopWorker implements DesktopWorker {
  readonly kind = 'desktop' as const;
  readonly calls: DesktopWorkerInput[] = [];

  constructor(
    private readonly element: {
      name: string;
      automationId: string;
      controlType: string;
      isPassword: boolean;
      supportedPatterns: string[];
    },
  ) {}

  async *exec(input: DesktopWorkerInput): AsyncIterable<WorkerEvent> {
    this.calls.push(input);
    if (input.action.kind === 'resolve-selector') {
      yield {
        type: 'completed',
        output: {
          ok: true,
          message: 'resolved',
          result: {
            kind: 'element-resolved',
            target: FIXTURE_ELEMENT_TARGET,
            element: {
              index: FIXTURE_ELEMENT_TARGET.elementIndex,
              name: this.element.name,
              automationId: this.element.automationId,
              controlType: this.element.controlType,
              processId: FIXTURE_ELEMENT_TARGET.window.processId,
              enabled: true,
              offscreen: false,
              isPassword: this.element.isPassword,
              supportedPatterns: this.element.supportedPatterns,
            },
          },
        },
      };
      return;
    }
    yield {
      type: 'completed',
      output: { ok: true, message: 'acted', result: { kind: 'action-completed' } },
    };
  }
}

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolveConnect, reject) => {
    socket.once('connect', resolveConnect);
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
      if (waiter) {
        waiters.delete(frame.id);
        waiter(frame);
      }
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

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return predicate();
}

async function appendMessage(
  installId: string,
  threadId: string,
  text = 'Inspect the desktop.',
): Promise<Socket> {
  const socket = await connectRuntime(installId);
  const inbox = createFrameInbox(socket);
  await inbox.send({
    id: `hello-${threadId}`,
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: threadId,
      features: ['task.appendMessage'],
    },
  });
  await inbox.send({
    id: `append-${threadId}`,
    kind: 'request',
    type: 'task.appendMessage',
    payload: {
      threadId,
      expectedTaskVersion: 0,
      role: 'user',
      text,
    },
  });
  return socket;
}

async function decideToolApproval(
  installId: string,
  approvalId: string,
  decision: 'approve' | 'deny',
): Promise<Frame> {
  const socket = await connectRuntime(installId);
  const inbox = createFrameInbox(socket);
  try {
    await inbox.send({
      id: `hello-approval-${approvalId}`,
      kind: 'request',
      type: '__hello',
      payload: {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: `approval-${approvalId}`,
        features: ['conversation.decideToolApproval'],
      },
    });
    return await inbox.send({
      id: `decide-${approvalId}`,
      kind: 'request',
      type: 'conversation.decideToolApproval',
      payload: { approvalId, decision },
    });
  } finally {
    socket.destroy();
  }
}

async function startFullAccessDesktopFixture<
  TProvider extends ProviderAdapter,
  TWorker extends DesktopWorker,
>(label: string, provider: TProvider, worker: TWorker) {
  const root = mkdtempSync(join(tmpdir(), `sync-think-desktop-${label}-`));
  tempDirs.push(root);
  const dbPath = join(root, 'sync-think.db');
  const installId = `desktop-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workspaceId = `workspace-desktop-${label}` as WorkspaceId;
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const appSettingStore = new SqliteAppSettingStore(connection.raw);
  const desktopStore = new SqliteDesktopStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const conversationStore = new SqliteConversationStore(connection.raw);
  const unitOfWork = new SqliteUnitOfWork(connection.raw);
  appSettingStore.set(COMPUTER_USE_PLUGIN_SETTING_KEY, { enabled: true });
  workspaceStore.createWorkspace({
    id: workspaceId,
    name: `Desktop ${label}`,
    folderPath: root,
    allowedRoots: [root],
  });
  const task = workspaceStore.createTask({
    workspaceId,
    title: `Desktop ${label}`,
    goal: 'Exercise Desktop approval policy',
  });
  const conversation = conversationStore.create({
    target: { track: 'model', modelId: 'fake-mini' as never },
    workspaceId,
    title: `Desktop ${label}`,
    executionMode: 'full-access',
  });
  conversationStore.bindTask(conversation.id, task.taskId);
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    stateStore,
    appSettingStore,
    workspaceStore,
    conversationStore,
    unitOfWork,
    workspaceId,
    checkpointRunId: `runtime-${installId}` as RunId,
    demoProvider: provider,
    desktopStore,
    desktopWorker: worker,
  });
  await runtime.start();
  const socket = await appendMessage(installId, task.threadId);
  return {
    connection,
    desktopStore,
    installId,
    provider,
    runtime,
    socket,
    worker,
  };
}

function latestEventPayload(
  connection: Awaited<ReturnType<typeof openDatabaseAsync>>,
  type: string,
): Record<string, unknown> | undefined {
  const row = connection.raw
    .prepare('SELECT payload_json FROM event WHERE type = ? ORDER BY sequence DESC LIMIT 1')
    .get(type) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined;
}

describe('Runtime Computer Use plugin gate', () => {
  it('does not expose desktop tools or prompt text while the plugin is disabled by default', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-computer-use-off-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    const installId = `computer-use-off-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-computer-use-off' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const provider = new RecordingProvider();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore,
      appSettingStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
    });
    await runtime.start();
    const socket = await appendMessage(installId, 'thread-computer-use-off');
    try {
      expect(await waitFor(() => provider.requests.length > 0)).toBe(true);
      const request = provider.requests[0]!;
      expect(request.tools?.some((tool) => tool.name.startsWith('desktop_')) ?? false).toBe(false);
      expect(request.systemPrompt).not.toContain('Computer Use tools are ENABLED');
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('persists and completes an enabled Desktop command before returning the tool result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-computer-use-durable-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    const installId = `computer-use-durable-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-computer-use-durable' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const desktopStore = new SqliteDesktopStore(connection.raw);
    appSettingStore.set(COMPUTER_USE_PLUGIN_SETTING_KEY, { enabled: true });
    const provider = new DesktopListProvider();
    const worker = new CompletedDesktopWorker();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore,
      appSettingStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
      desktopStore,
      desktopWorker: worker,
    });
    await runtime.start();
    const socket = await appendMessage(installId, 'thread-computer-use-durable');
    try {
      expect(await waitFor(() => Boolean(provider.toolResult))).toBe(true);
      expect(JSON.parse(provider.toolResult ?? '{}')).toMatchObject({ ok: true });
      expect(worker.calls).toBe(1);
      const rows = connection.raw
        .prepare('SELECT state, tool_name, action FROM desktop_command')
        .all();
      expect(rows).toEqual([
        { state: 'completed', tool_name: 'desktop_list_windows', action: 'list-windows' },
      ]);
      expect(
        connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'desktop.command.started'")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('publishes a durable waiting event only after user input interruption is persisted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-computer-use-interrupt-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    const installId = `computer-use-interrupt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-computer-use-interrupt' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const desktopStore = new SqliteDesktopStore(connection.raw);
    appSettingStore.set(COMPUTER_USE_PLUGIN_SETTING_KEY, { enabled: true });
    let inputTick = 100;
    const provider = new InterruptingDesktopProvider();
    const worker = new InterruptibleDesktopWorker();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore,
      appSettingStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
      desktopStore,
      desktopWorker: worker,
      desktopUserInputMonitor: { sample: () => inputTick },
    });
    await runtime.start();
    const socket = await appendMessage(installId, 'thread-computer-use-interrupt');
    try {
      await worker.startedPromise;
      inputTick = 101;
      expect(await waitFor(() => Boolean(provider.toolResult))).toBe(true);
      const result = JSON.parse(provider.toolResult ?? '{}') as {
        code?: string;
        commandId?: string;
      };
      expect(result).toMatchObject({ code: 'desktop.user-input-detected' });
      expect(desktopStore.getCommand(result.commandId ?? '')).toMatchObject({
        state: 'waiting_user',
        errorCode: 'desktop.user-input-detected',
      });
      const eventRow = connection.raw
        .prepare(
          "SELECT payload_json FROM event WHERE type = 'desktop.command.waiting_user' ORDER BY sequence DESC LIMIT 1",
        )
        .get() as { payload_json: string } | undefined;
      expect(eventRow).toBeTruthy();
      expect(JSON.parse(eventRow?.payload_json ?? '{}')).toMatchObject({
        commandId: result.commandId,
        errorCode: 'desktop.user-input-detected',
      });
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('lists durable waiting Desktop commands as safe summaries and rejects malformed filters', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-computer-use-waiting-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    const installId = `computer-use-waiting-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-computer-use-waiting' as WorkspaceId;
    const runId = 'run-computer-use-waiting' as RunId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const desktopStore = new SqliteDesktopStore(connection.raw);
    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    workspaceStore.createWorkspace({ id: workspaceId, name: 'Desktop waiting fixture' });
    const task = workspaceStore.createTask({
      id: 'task-computer-use-waiting',
      threadId: 'thread-computer-use-waiting',
      workspaceId,
      title: 'Desktop waiting fixture',
      goal: 'Project a durable waiting command',
    });
    const reserved = desktopStore.reserveCommand({
      id: 'desktop-command-waiting',
      idempotencyKey: 'desktop:run-computer-use-waiting:tool-1',
      workspaceId,
      runId,
      ownerId: task.threadId,
      toolName: 'desktop_set_value',
      action: 'set-value',
      targetIdentity: 'native-handle:0x1234:owner-secret',
      sanitizedArgs: {
        kind: 'set-value',
        value: 'secret-input-value',
        valueDigest: 'secret-digest',
        target: {
          window: {
            processId: 42,
            title: 'Fixture settings',
            appId: 'fixture.settings',
            nativeWindowHandle: '0x1234',
          },
          snapshotRevision: 'snapshot-secret',
          accessibilityRevision: 'accessibility-secret',
          elementIndex: 7,
        },
      },
      now: '2026-08-01T00:00:00.000Z',
    });
    desktopStore.markWaitingUser(
      reserved.id,
      'desktop.user-input-detected',
      '2026-08-01T00:01:00.000Z',
    );
    const cancelReserved = desktopStore.reserveCommand({
      id: 'desktop-command-requested',
      idempotencyKey: 'desktop:run-computer-use-waiting:tool-2',
      workspaceId,
      runId,
      ownerId: task.threadId,
      toolName: 'desktop_list_windows',
      action: 'list-windows',
      targetIdentity: 'desktop:list-windows',
      sanitizedArgs: { kind: 'list-windows' },
    });
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore,
      workspaceStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      desktopStore,
      desktopWorker: new CompletedDesktopWorker(),
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    try {
      const hello = await inbox.send({
        id: 'hello-desktop-waiting',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'desktop-waiting',
          features: [
            'desktop.command.listWaiting',
            'desktop.command.continue',
            'desktop.command.cancel',
          ],
        },
      });
      expect(hello.error).toBeUndefined();

      const response = await inbox.send({
        id: 'list-desktop-waiting',
        kind: 'request',
        type: 'desktop.command.listWaiting',
        payload: { workspaceId, runId },
      });
      expect(response.error).toBeUndefined();
      expect(response.payload).toEqual({
        commands: [
          {
            commandId: reserved.id,
            workspaceId,
            taskId: task.taskId,
            runId,
            toolName: 'desktop_set_value',
            action: 'set-value',
            target: { processId: 42, title: 'Fixture settings', appId: 'fixture.settings' },
            reason: 'user-input-detected',
            errorCode: 'desktop.user-input-detected',
            status: 'waiting_user',
            canContinue: true,
            canCancel: true,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:01:00.000Z',
          },
        ],
      });
      expect(JSON.stringify(response)).not.toMatch(
        /secret-input-value|secret-digest|nativeWindowHandle|targetIdentity|ownerId|snapshot-secret|accessibility-secret|elementIndex|0x1234/,
      );

      const malformed = await inbox.send({
        id: 'list-desktop-waiting-malformed',
        kind: 'request',
        type: 'desktop.command.listWaiting',
        payload: { workspaceId, unexpected: true },
      });
      expect(malformed.error).toMatchObject({ code: 'protocol.frame_malformed' });

      const malformedContinue = await inbox.send({
        id: 'continue-desktop-waiting-malformed',
        kind: 'request',
        type: 'desktop.command.continue',
        payload: { commandId: reserved.id, expectedUpdatedAt: 'yesterday' },
      });
      expect(malformedContinue.error).toMatchObject({ code: 'protocol.frame_malformed' });
      const malformedCancel = await inbox.send({
        id: 'cancel-desktop-waiting-malformed',
        kind: 'request',
        type: 'desktop.command.cancel',
        payload: {
          commandId: reserved.id,
          expectedUpdatedAt: '2026-08-01T00:01:00.000Z',
          unexpected: true,
        },
      });
      expect(malformedCancel.error).toMatchObject({ code: 'protocol.frame_malformed' });

      const continued = await inbox.send({
        id: 'continue-desktop-waiting',
        kind: 'request',
        type: 'desktop.command.continue',
        payload: {
          commandId: reserved.id,
          expectedUpdatedAt: '2026-08-01T00:01:00.000Z',
        },
      });
      expect(continued.error).toBeUndefined();
      expect(continued.payload).toMatchObject({
        status: 'continued',
        commandId: reserved.id,
        replayed: false,
      });
      expect(desktopStore.getCommand(reserved.id)).toMatchObject({
        state: 'completed',
        result: {
          output: {
            ok: true,
            commandId: reserved.id,
            resolution: 'user-confirmed',
            sourceUpdatedAt: '2026-08-01T00:01:00.000Z',
          },
        },
      });

      const afterContinue = await inbox.send({
        id: 'list-desktop-after-continue',
        kind: 'request',
        type: 'desktop.command.listWaiting',
        payload: { workspaceId, runId },
      });
      expect(afterContinue.error).toBeUndefined();
      expect(afterContinue.payload).toEqual({ commands: [] });

      const continuedReplay = await inbox.send({
        id: 'continue-desktop-waiting-replay',
        kind: 'request',
        type: 'desktop.command.continue',
        payload: {
          commandId: reserved.id,
          expectedUpdatedAt: '2026-08-01T00:01:00.000Z',
        },
      });
      expect(continuedReplay.error).toBeUndefined();
      expect(continuedReplay.payload).toMatchObject({
        status: 'continued',
        commandId: reserved.id,
        replayed: true,
      });

      const cancelWaiting = desktopStore.markWaitingUser(
        cancelReserved.id,
        'desktop.command-inspection-required',
        '2026-08-01T00:02:00.000Z',
      );
      const staleCancel = await inbox.send({
        id: 'cancel-desktop-waiting-stale',
        kind: 'request',
        type: 'desktop.command.cancel',
        payload: {
          commandId: cancelReserved.id,
          expectedUpdatedAt: '2026-08-01T00:01:59.000Z',
        },
      });
      expect(staleCancel.error).toMatchObject({ code: 'desktop.command-conflict' });
      expect(desktopStore.getCommand(cancelReserved.id)).toMatchObject({
        state: 'waiting_user',
        updatedAt: cancelWaiting.updatedAt,
      });

      const cancelled = await inbox.send({
        id: 'cancel-desktop-waiting',
        kind: 'request',
        type: 'desktop.command.cancel',
        payload: {
          commandId: cancelReserved.id,
          expectedUpdatedAt: cancelWaiting.updatedAt,
        },
      });
      expect(cancelled.error).toBeUndefined();
      expect(cancelled.payload).toMatchObject({
        status: 'cancelled',
        commandId: cancelReserved.id,
        replayed: false,
      });
      expect(desktopStore.getCommand(cancelReserved.id)).toMatchObject({
        state: 'failed',
        errorCode: 'desktop.command-cancelled',
        failureClass: 'acceptance',
      });

      const cancelledReplay = await inbox.send({
        id: 'cancel-desktop-waiting-replay',
        kind: 'request',
        type: 'desktop.command.cancel',
        payload: {
          commandId: cancelReserved.id,
          expectedUpdatedAt: cancelWaiting.updatedAt,
        },
      });
      expect(cancelledReplay.error).toBeUndefined();
      expect(cancelledReplay.payload).toMatchObject({
        status: 'cancelled',
        commandId: cancelReserved.id,
        replayed: true,
      });

      expect(
        connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'desktop.command.continued'")
          .get(),
      ).toEqual({ count: 2 });
      expect(
        connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'desktop.command.cancelled'")
          .get(),
      ).toEqual({ count: 2 });
      const lifecyclePayloads = connection.raw
        .prepare(
          "SELECT payload_json FROM event WHERE type IN ('desktop.command.continued', 'desktop.command.cancelled') ORDER BY sequence ASC",
        )
        .all() as Array<{ payload_json: string }>;
      expect(JSON.stringify(lifecyclePayloads)).not.toMatch(
        /secret-input-value|secret-digest|nativeWindowHandle|targetIdentity|ownerId|snapshot-secret|accessibility-secret|elementIndex|0x1234/,
      );
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });

  it('exposes desktop tools when enabled and rejects a late call after the plugin is disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-computer-use-on-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    const installId = `computer-use-on-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-computer-use-on' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const appSettingStore = new SqliteAppSettingStore(connection.raw);
    const desktopStore = new SqliteDesktopStore(connection.raw);
    appSettingStore.set(COMPUTER_USE_PLUGIN_SETTING_KEY, { enabled: true });
    const provider = new LateDisabledDesktopProvider(() => {
      appSettingStore.set(COMPUTER_USE_PLUGIN_SETTING_KEY, { enabled: false });
    });
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore,
      appSettingStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
      desktopStore,
      desktopWorker: new CompletedDesktopWorker(),
    });
    await runtime.start();
    const socket = await appendMessage(
      installId,
      'thread-computer-use-on',
      [
        '使用 Computer Use 操作标题包含“SYNC THINK Desktop Handoff Fixture [manual]”的窗口。',
        '先枚举并检查窗口，再解析 automationId 为 InputText、controlType 为 Edit 的元素，',
        '最后把值设置为 "manual-test"。',
      ].join('\n'),
    );
    try {
      expect(await waitFor(() => Boolean(provider.toolResult))).toBe(true);
      const firstRequest = provider.requests[0]!;
      const desktopToolNames = firstRequest.tools
        ?.map((tool) => tool.name)
        .filter((name) => name.startsWith('desktop_'));
      expect(desktopToolNames).toEqual([
        'desktop_list_windows',
        'desktop_inspect_window',
        'desktop_resolve_selector',
        'desktop_read_element',
        'desktop_focus_element',
        'desktop_invoke_element',
        'desktop_set_value',
      ]);
      expect(firstRequest.systemPrompt).toContain('Computer Use tools are ENABLED');
      expect(JSON.parse(provider.toolResult ?? '{}')).toMatchObject({
        ok: false,
        code: 'desktop.capability-disabled',
      });
      expect(
        provider.requests[1]?.tools?.some((tool) => tool.name.startsWith('desktop_')) ?? false,
      ).toBe(false);
      expect(connection.raw.prepare('SELECT COUNT(*) AS count FROM desktop_command').get()).toEqual(
        { count: 0 },
      );
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
  it('requires approval for unresolved sensitive actions in full-access and keeps approval events redacted', async () => {
    const secretValue = 'runtime-sensitive-value';
    const provider = new SingleDesktopActionProvider(
      'desktop_set_value',
      JSON.stringify({ target: FIXTURE_ELEMENT_TARGET, value: secretValue }),
    );
    const worker = new CompletedDesktopWorker();
    const fixture = await startFullAccessDesktopFixture('sensitive-deny', provider, worker);
    try {
      expect(
        await waitFor(() =>
          Boolean(latestEventPayload(fixture.connection, 'tool.approval_requested')),
        ),
      ).toBe(true);
      const approval = latestEventPayload(fixture.connection, 'tool.approval_requested')!;
      expect(approval).toMatchObject({
        toolName: 'desktop_set_value',
        executionMode: 'full-access',
        risk: { level: 'sensitive' },
        arguments: { action: 'set-value', valueLength: secretValue.length },
      });
      expect(JSON.stringify(approval)).not.toMatch(
        /runtime-sensitive-value|valueDigest|nativeWindowHandle|snapshotRevision|accessibilityRevision|elementIndex|targetIdentity|ownerId|0x1234/,
      );
      expect(worker.calls).toBe(0);
      expect(
        fixture.connection.raw.prepare('SELECT COUNT(*) AS count FROM desktop_command').get(),
      ).toEqual({ count: 0 });

      const response = await decideToolApproval(
        fixture.installId,
        String(approval.approvalId),
        'deny',
      );
      expect(response.error).toBeUndefined();
      expect(await waitFor(() => Boolean(provider.toolResult))).toBe(true);
      expect(JSON.parse(provider.toolResult ?? '{}')).toMatchObject({
        ok: false,
        code: 'desktop.approval-denied',
      });
      expect(worker.calls).toBe(0);
      expect(
        fixture.connection.raw.prepare('SELECT COUNT(*) AS count FROM desktop_command').get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('requires human approval in full-access and executes only after approval reaches the controller', async () => {
    const secretValue = 'runtime-password-value';
    const provider = new ResolvedDesktopActionProvider(
      'desktop_set_value',
      JSON.stringify({ target: FIXTURE_ELEMENT_TARGET, value: secretValue }),
      { automationId: 'PasswordBox', controlType: 'Edit' },
    );
    const worker = new MetadataDesktopWorker({
      name: 'Password',
      automationId: 'PasswordBox',
      controlType: 'Edit',
      isPassword: true,
      supportedPatterns: ['Value'],
    });
    const fixture = await startFullAccessDesktopFixture('human-only-approve', provider, worker);
    try {
      expect(
        await waitFor(() =>
          Boolean(latestEventPayload(fixture.connection, 'tool.approval_requested')),
        ),
      ).toBe(true);
      const approval = latestEventPayload(fixture.connection, 'tool.approval_requested')!;
      expect(approval).toMatchObject({
        toolName: 'desktop_set_value',
        executionMode: 'full-access',
        risk: { level: 'human-only', humanOnlyAction: 'access-or-create-secret' },
        arguments: {
          action: 'set-value',
          element: { automationId: 'PasswordBox', controlType: 'Edit', isPassword: true },
          valueLength: secretValue.length,
        },
      });
      expect(worker.calls).toHaveLength(1);

      const response = await decideToolApproval(
        fixture.installId,
        String(approval.approvalId),
        'approve',
      );
      expect(response.error).toBeUndefined();
      expect(await waitFor(() => Boolean(provider.toolResult))).toBe(true);
      expect(JSON.parse(provider.toolResult ?? '{}')).toMatchObject({ ok: true });
      expect(worker.calls).toHaveLength(2);
      expect(worker.calls[1]?.action).toMatchObject({ kind: 'set-value', value: secretValue });

      const started = latestEventPayload(fixture.connection, 'desktop.command.started')!;
      expect(started).toMatchObject({
        toolName: 'desktop_set_value',
        action: 'set-value',
        risk: { level: 'human-only', humanOnlyAction: 'access-or-create-secret' },
        args: {
          action: 'set-value',
          element: { automationId: 'PasswordBox', controlType: 'Edit', isPassword: true },
          valueLength: secretValue.length,
        },
      });
      expect(JSON.stringify(started)).not.toMatch(
        /runtime-password-value|valueDigest|nativeWindowHandle|snapshotRevision|accessibilityRevision|elementIndex|targetIdentity|ownerId|0x1234/,
      );
    } finally {
      fixture.socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });

  it('runs a resolved ordinary display action in full-access without approval', async () => {
    const provider = new ResolvedDesktopActionProvider(
      'desktop_invoke_element',
      JSON.stringify({ target: FIXTURE_ELEMENT_TARGET }),
      { automationId: 'ApplyButton', controlType: 'Button' },
    );
    const worker = new MetadataDesktopWorker({
      name: 'Apply',
      automationId: 'ApplyButton',
      controlType: 'Button',
      isPassword: false,
      supportedPatterns: ['Invoke'],
    });
    const fixture = await startFullAccessDesktopFixture('display-auto', provider, worker);
    try {
      expect(await waitFor(() => Boolean(provider.toolResult))).toBe(true);
      expect(JSON.parse(provider.toolResult ?? '{}')).toMatchObject({ ok: true });
      expect(worker.calls).toHaveLength(2);
      expect(
        fixture.connection.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'tool.approval_requested'")
          .get(),
      ).toEqual({ count: 0 });
      expect(latestEventPayload(fixture.connection, 'desktop.command.started')).toMatchObject({
        toolName: 'desktop_invoke_element',
        action: 'invoke-element',
        risk: { level: 'display' },
      });
    } finally {
      fixture.socket.destroy();
      await fixture.runtime.stop();
      fixture.connection.raw.close();
    }
  });
});
