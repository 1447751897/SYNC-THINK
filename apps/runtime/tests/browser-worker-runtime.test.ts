import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AdapterEvent,
  ProviderAdapter,
  ProviderCallRequest,
} from '@sync-think/adapters';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteBrowserStore,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import {
  BrowserHostError,
  type BrowserCommandResult,
  type BrowserHostExecuteInput,
  type BrowserHostLike,
  type BrowserLeaseInfo,
} from '@sync-think/workers';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class BrowserToolProvider implements ProviderAdapter {
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
          id: 'browser-call-1',
          name: 'browser_open',
          argumentsJson: JSON.stringify({
            url: 'https://example.test/dashboard?secret=must-not-enter-audit',
          }),
        },
      };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    this.toolResult = String(resultMessage.content);
    yield { type: 'text-delta', text: 'Browser opened.' };
    yield { type: 'finished', reason: 'stop' };
  }
}

class RecordingBrowserHost implements BrowserHostLike {
  readonly executions: BrowserHostExecuteInput[] = [];
  shutdownCalled = false;
  executeFailure?: BrowserHostError;
  private lease?: BrowserLeaseInfo;

  async acquireLease(input: { profileId: string; ownerId: string }): Promise<BrowserLeaseInfo> {
    this.lease = { ...input, leaseId: 'lease-1', pageId: 'page-1' };
    return this.lease;
  }

  async inspectLease(leaseId: string): Promise<BrowserLeaseInfo> {
    if (!this.lease || this.lease.leaseId !== leaseId) {
      throw new BrowserHostError('browser.lease_not_found', 'lease not found');
    }
    return this.lease;
  }

  async execute(input: BrowserHostExecuteInput): Promise<BrowserCommandResult> {
    this.executions.push(input);
    if (this.executeFailure) throw this.executeFailure;
    return {
      ok: true,
      message: 'Browser navigation completed',
      profileId: 'default',
      ownerId: 'thread-browser-worker',
      leaseId: 'lease-1',
      pageId: 'page-1',
      url: 'https://example.test/dashboard?session=completion-secret',
      title: 'Dashboard',
    };
  }

  async releaseLease(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
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

describe('Runtime Browser Worker tool loop', () => {
  it('persists a scrubbed intent, executes without Renderer, and returns the result to Provider', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-runtime-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    const installId = `browser-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-browser-runtime' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const browserStore = new SqliteBrowserStore(connection.raw);
    browserStore.upsertOriginGrant({
      scopeType: 'workspace',
      scopeId: workspaceId,
      origin: 'https://example.test',
      action: 'navigate',
      decision: 'allow',
      approvalId: 'test-preapproved',
    });
    const provider = new BrowserToolProvider();
    const browserHost = new RecordingBrowserHost();
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      browserStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
      browserHost,
      browserFallbackWorkingDir: root,
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    try {
      await inbox.send({
        id: 'hello-browser-runtime',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'browser-runtime',
          features: ['task.appendMessage'],
        },
      });
      await inbox.send({
        id: 'append-browser-runtime',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-browser-worker',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'Open the dashboard.',
          networkEnabled: true,
        },
      });

      expect(
        await waitFor(() =>
          store.listEvents(workspaceId, 0).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      expect(browserHost.executions).toHaveLength(1);
      expect(browserHost.executions[0]).toMatchObject({
        action: {
          kind: 'navigate',
          url: 'https://example.test/dashboard?secret=must-not-enter-audit',
        },
        allowedSites: ['https://example.test'],
      });
      expect(JSON.parse(provider.toolResult ?? '{}')).toMatchObject({
        ok: true,
        url: 'https://example.test/dashboard?session=completion-secret',
      });

      const events = store.listEvents(workspaceId, 0);
      expect(events.some((event) => event.type === 'browser.command_requested')).toBe(false);
      const intent = events.find((event) => event.type === 'browser.command.started');
      expect(intent?.payload).toMatchObject({
        toolName: 'browser_open',
        action: 'navigate',
        args: { url: 'https://example.test/dashboard' },
        allowedOrigins: ['https://example.test'],
      });
      expect(JSON.stringify(intent)).not.toContain('must-not-enter-audit');
      const completion = events.find(
        (event) =>
          event.type === 'tool.completed' && event.payload.toolName === 'browser_open',
      );
      expect(JSON.parse(String(completion?.payload.result ?? '{}'))).toMatchObject({
        ok: true,
        url: 'https://example.test/dashboard',
      });
      expect(JSON.stringify(completion)).not.toContain('completion-secret');
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
    expect(browserHost.shutdownCalled).toBe(true);
  });

  it('removes URL credentials, query, and hash from persisted Browser errors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-error-runtime-'));
    tempDirs.push(root);
    const dbPath = join(root, 'sync-think.db');
    const installId = `browser-error-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workspaceId = 'workspace-browser-error-runtime' as WorkspaceId;
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    const store = new SqliteEventCheckpointStore(connection.raw);
    const browserStore = new SqliteBrowserStore(connection.raw);
    browserStore.upsertOriginGrant({
      scopeType: 'workspace',
      scopeId: workspaceId,
      origin: 'https://example.test',
      action: 'navigate',
      decision: 'allow',
      approvalId: 'test-preapproved',
    });
    const provider = new BrowserToolProvider();
    const browserHost = new RecordingBrowserHost();
    browserHost.executeFailure = new BrowserHostError(
      'browser.operation-failed',
      'page.goto failed at https://user:password@example.test/oauth/callback?token=oauth-secret&code=abc#fragment',
      'unknown',
    );
    const runtime = new Runtime({
      installId,
      allowNoToken: true,
      stateStore: store,
      browserStore,
      workspaceId,
      checkpointRunId: `runtime-${installId}` as RunId,
      demoProvider: provider,
      browserHost,
      browserFallbackWorkingDir: root,
    });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    try {
      await inbox.send({
        id: 'hello-browser-error-runtime',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'browser-error-runtime',
          features: ['task.appendMessage'],
        },
      });
      await inbox.send({
        id: 'append-browser-error-runtime',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId: 'thread-browser-error-worker',
          expectedTaskVersion: 0,
          role: 'user',
          text: 'Open the dashboard.',
          networkEnabled: true,
        },
      });

      expect(
        await waitFor(() =>
          store.listEvents(workspaceId, 0).some((event) => event.type === 'run.completed'),
        ),
      ).toBe(true);
      expect(provider.toolResult).toContain('oauth-secret');
      const completion = store
        .listEvents(workspaceId, 0)
        .find(
          (event) =>
            event.type === 'tool.completed' && event.payload.toolName === 'browser_open',
        );
      const persisted = JSON.parse(String(completion?.payload.result ?? '{}')) as {
        error?: string;
      };
      expect(persisted.error).toBe('Browser action failed.');
      expect(JSON.stringify(completion)).not.toContain('oauth-secret');
      expect(JSON.stringify(completion)).not.toContain('password');
      expect(JSON.stringify(completion)).not.toContain('code=abc');
      expect(JSON.stringify(completion)).not.toContain('#fragment');
      expect(JSON.stringify(completion)).not.toContain('example.test');
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
