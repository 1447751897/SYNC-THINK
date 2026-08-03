import { connect, type Socket } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import {
  EVENT_PAYLOAD_ENVELOPE_KEY,
  EventPayloadSidecarStore,
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteMessageStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import {
  ulid,
  type EventId,
  type MessageId,
  type RunId,
  type WorkspaceId,
} from '@sync-think/shared';
import {
  createRuntimeSecureStore,
  openPersistentRuntime,
  resolveRuntimeEventPayloadSidecarRoot,
  resolveRuntimeDatabasePath,
  RUNTIME_EVENT_PAYLOAD_PROJECTION_BUILDER,
} from '../src/persistence.js';

const tempDirs: string[] = [];

function runtimeStateStore(session: Awaited<ReturnType<typeof openPersistentRuntime>>) {
  return (session.runtime as unknown as { stateStore: SqliteEventCheckpointStore }).stateStore;
}

function eventDraft(id: string, type: string, payload: Record<string, unknown>) {
  return {
    id: id as EventId,
    workspaceId: 'workspace-sidecar' as WorkspaceId,
    category: type === 'context.packet.built' ? ('context' as const) : ('system' as const),
    type,
    occurredAt: '2026-08-02T12:00:00.000Z',
    payload,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
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

async function sendFrame(socket: Socket, frame: Frame): Promise<Frame> {
  const response = new Promise<Frame>((resolve, reject) => {
    socket.once('data', (chunk: Buffer) => {
      try {
        const decoded = decodeFrames(chunk);
        if (decoded.frames.length !== 1 || decoded.remaining.length !== 0) {
          reject(new Error('expected exactly one complete response frame'));
          return;
        }
        resolve(decoded.frames[0]);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
  socket.write(encodeFrame(frame));
  return response;
}

describe('persistent Runtime bootstrap', () => {
  it('selects Windows DPAPI for production and keeps XorDev explicit to tests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-secure-selection-'));
    tempDirs.push(dir);
    const bridge = {
      protect: async (plaintext: Buffer) => plaintext.toString('base64'),
      unprotect: async (ciphertext: string) => Buffer.from(ciphertext, 'base64'),
    };

    const production = createRuntimeSecureStore({
      platform: 'win32',
      legacyKeyPath: join(dir, 'legacy', 'dev-key.bin'),
      vaultDirectory: join(dir, 'dpapi'),
      dpapiBridge: bridge,
    });
    expect(production.getBackendName()).toBe('windows-dpapi');

    const explicitTestStore = createRuntimeSecureStore({
      platform: 'win32',
      secureStoreKeyPath: join(dir, 'test-only', 'key.bin'),
      dpapiBridge: bridge,
    });
    expect(explicitTestStore.getBackendName()).toBe('xor-dev');
  });

  it('resolves an explicit path before the platform data directory', () => {
    expect(
      resolveRuntimeDatabasePath(
        {
          SYNC_THINK_DB_PATH: 'D:\\custom-data\\state.db',
          LOCALAPPDATA: 'D:\\ignored',
        },
        'D:\\home',
      ),
    ).toBe('D:\\custom-data\\state.db');
    expect(
      resolveRuntimeDatabasePath({ LOCALAPPDATA: 'D:\\local-data' }, 'D:\\home'),
    ).toBe(join('D:\\local-data', 'SYNC-THINK', 'sync-think.db'));
  });

  it('migrates and injects a durable state store into the production Runtime path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-runtime-bootstrap-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'nested', 'sync-think.db');
    const installId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bootstrapWorkspaceId = 'workspace-bootstrap' as WorkspaceId;
    const checkpointRunId = `runtime-${installId}` as RunId;
    let workspaceId = '' as WorkspaceId;
    let threadId = '';
    const session = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
      workspaceId: bootstrapWorkspaceId,
      checkpointRunId,
    });
    await session.runtime.start();
    const socket = await connectRuntime(installId);

    try {
      const hello = await sendFrame(socket, {
        id: 'hello',
        kind: 'request',
        type: '__hello',
        payload: {
          protocolVersion: 2,
          appVersion: '0.0.1',
          installId,
          nonce: 'bootstrap-test-nonce',
          features: ['workspace.create', 'task.create', 'task.appendMessage'],
        },
      });
      expect(hello.payload).toMatchObject({ ok: true });

      const workspace = await sendFrame(socket, {
        id: 'workspace-create',
        kind: 'request',
        type: 'workspace.create',
        payload: {
          folderPath: dir,
          name: 'Bootstrap workspace',
        },
      });
      workspaceId = (workspace.payload as { workspaceId: WorkspaceId }).workspaceId;

      const task = await sendFrame(socket, {
        id: 'task-create',
        kind: 'request',
        type: 'task.create',
        payload: {
          workspaceId,
          title: 'Bootstrap task',
          goal: 'Verify durable production Runtime state',
        },
      });
      threadId = (task.payload as { threadId: string }).threadId;

      const append = await sendFrame(socket, {
        id: 'append',
        kind: 'request',
        type: 'task.appendMessage',
        payload: {
          threadId,
          expectedTaskVersion: 0,
          role: 'user',
          text: 'persist through production bootstrap',
        },
      });
      expect(append.payload).toMatchObject({ taskVersion: 1 });
    } finally {
      socket.destroy();
      await session.close();
    }

    const connection = await openDatabaseAsync({ path: dbPath });
    try {
      const store = new SqliteEventCheckpointStore(connection.raw);
      expect(store.listEvents(workspaceId, 0)).toEqual([
        expect.objectContaining({ type: 'message.appended', sequence: 1 }),
      ]);
      // A single non-terminal event is recovered by replay and does not force a snapshot.
      expect(store.loadLatestCheckpoint(checkpointRunId)).toBeUndefined();
    } finally {
      connection.raw.close();
    }
  });

  it('repairs task versions from durable messages without requiring message events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-runtime-message-floor-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    await runMigrations(dbPath);
    const setup = await openDatabaseAsync({ path: dbPath });
    let taskId = '';
    try {
      const workspaceStore = new SqliteWorkspaceStore(setup.raw);
      const messageStore = new SqliteMessageStore(setup.raw);
      const workspace = workspaceStore.createWorkspace({ name: 'Message floor bootstrap' });
      const task = workspaceStore.createTask({
        workspaceId: workspace.id,
        title: 'Lagging durable task',
        goal: 'Repair before Runtime becomes ready',
      });
      taskId = task.taskId;
      messageStore.appendMessage({
        id: ulid() as MessageId,
        threadId: task.threadId,
        role: 'user',
        sequence: 7,
        blocks: [{ type: 'text', text: 'durable without a matching event' }],
        createdAt: '2026-08-02T09:00:00.000Z',
      });
      setup.raw.prepare('UPDATE task SET version = 2 WHERE id = ?').run(task.taskId);
    } finally {
      setup.raw.close();
    }

    const session = await openPersistentRuntime({
      dbPath,
      installId: `message-floor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
    });
    await session.close();

    const verification = await openDatabaseAsync({ path: dbPath });
    try {
      const row = verification.raw
        .prepare('SELECT version FROM task WHERE id = ?')
        .get(taskId) as { version: number };
      expect(row.version).toBe(7);
      expect(
        verification.raw
          .prepare("SELECT COUNT(*) AS count FROM event WHERE type = 'message.appended'")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      verification.raw.close();
    }
  });

  it('keeps Event payload sidecar writes disabled by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-runtime-sidecar-default-off-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = 'sidecar-default-off';
    const payload = {
      threadId: 'thread-default-off',
      packetId: 'packet-default-off',
      summaries: ['inline-body'.repeat(8_192)],
    };
    const sidecarRoot = resolveRuntimeEventPayloadSidecarRoot(dbPath, installId);
    const session = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
    });
    try {
      runtimeStateStore(session).commitTransition({
        events: [eventDraft('event-default-off', 'context.packet.built', payload)],
      });
    } finally {
      await session.close();
    }

    const connection = await openDatabaseAsync({ path: dbPath });
    try {
      const row = connection.raw
        .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
        .get('event-default-off') as { payloadJson: string };
      expect(JSON.parse(row.payloadJson)).toEqual(payload);
      expect(existsSync(sidecarRoot)).toBe(false);
    } finally {
      connection.raw.close();
    }
  });

  it('externalizes only large context packets with the fixed projection and hydrates after restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-runtime-sidecar-opt-in-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = 'sidecar-opt-in';
    const sidecarRoot = resolveRuntimeEventPayloadSidecarRoot(dbPath, installId);
    expect(sidecarRoot).not.toBe(resolveRuntimeEventPayloadSidecarRoot(dbPath, 'other-install'));
    expect(sidecarRoot).not.toBe(
      resolveRuntimeEventPayloadSidecarRoot(join(dir, 'other.db'), installId),
    );
    expect(RUNTIME_EVENT_PAYLOAD_PROJECTION_BUILDER).toEqual({
      id: 'context-packet-query-v1',
      version: 1,
    });

    const largeContextPayload = {
      threadId: 'thread-sidecar',
      packetId: 'packet-sidecar',
      proofHash: 'proof-sidecar',
      modelId: 'model-sidecar',
      providerModelId: 'provider-model-sidecar',
      tokenEstimate: 70_000,
      summaries: ['externalized-body'.repeat(8_192)],
      nestedPrivateData: { ignoredByProjection: true },
    };
    const smallContextPayload = {
      threadId: 'thread-small',
      packetId: 'packet-small',
      summaries: ['small'],
    };
    const largeOtherPayload = {
      body: 'not-allowlisted'.repeat(8_192),
    };
    const first = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
      eventPayloadSidecar: { enabled: true },
    });
    try {
      runtimeStateStore(first).commitTransition({
        events: [
          eventDraft('event-large-context', 'context.packet.built', largeContextPayload),
          eventDraft('event-small-context', 'context.packet.built', smallContextPayload),
          eventDraft('event-large-other', 'provider.usage', largeOtherPayload),
        ],
      });
    } finally {
      await first.close();
    }

    const connection = await openDatabaseAsync({ path: dbPath });
    let externalizedRelativePath = '';
    try {
      const rows = connection.raw
        .prepare('SELECT id, payload_json AS payloadJson FROM event ORDER BY sequence ASC')
        .all() as Array<{ id: string; payloadJson: string }>;
      const byId = new Map(rows.map((row) => [row.id, JSON.parse(row.payloadJson)]));
      const envelope = byId.get('event-large-context') as Record<string, unknown>;
      expect(envelope.projection).toEqual({
        threadId: 'thread-sidecar',
        packetId: 'packet-sidecar',
        proofHash: 'proof-sidecar',
        modelId: 'model-sidecar',
        providerModelId: 'provider-model-sidecar',
        tokenEstimate: 70_000,
      });
      const reference = envelope[EVENT_PAYLOAD_ENVELOPE_KEY] as { relativePath: string };
      externalizedRelativePath = reference.relativePath;
      expect(existsSync(join(sidecarRoot, reference.relativePath))).toBe(true);
      expect(byId.get('event-small-context')).toEqual(smallContextPayload);
      expect(byId.get('event-large-other')).toEqual(largeOtherPayload);
    } finally {
      connection.raw.close();
    }

    const restarted = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
      eventPayloadSidecar: { enabled: true },
    });
    try {
      expect(runtimeStateStore(restarted).listAllEvents(0).map((event) => event.payload)).toEqual([
        largeContextPayload,
        smallContextPayload,
        largeOtherPayload,
      ]);
      expect(existsSync(join(sidecarRoot, externalizedRelativePath))).toBe(true);
    } finally {
      await restarted.close();
    }
  });

  it('keeps legacy inline rows and unrelated sidecar blobs unchanged during Runtime startup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-runtime-sidecar-no-governance-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const installId = 'sidecar-no-governance';
    const sidecarRoot = resolveRuntimeEventPayloadSidecarRoot(dbPath, installId);
    await runMigrations(dbPath);
    const legacyPayload = {
      threadId: 'thread-legacy-inline',
      packetId: 'packet-legacy-inline',
      summaries: ['legacy-inline'.repeat(8_192)],
    };
    const setup = await openDatabaseAsync({ path: dbPath });
    let originalPayloadJson = '';
    try {
      const inlineStore = new SqliteEventCheckpointStore(setup.raw);
      inlineStore.commitTransition({
        events: [eventDraft('event-legacy-inline', 'context.packet.built', legacyPayload)],
      });
      originalPayloadJson = (
        setup.raw
          .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
          .get('event-legacy-inline') as { payloadJson: string }
      ).payloadJson;
    } finally {
      setup.raw.close();
    }
    const orphanEnvelope = new EventPayloadSidecarStore(sidecarRoot).writePayloadJson(
      JSON.stringify({ orphan: 'leave-for-explicit-gc' }),
    );
    const orphanReference = orphanEnvelope[EVENT_PAYLOAD_ENVELOPE_KEY];
    const orphanPath = join(sidecarRoot, orphanReference.relativePath);

    const session = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
      eventPayloadSidecar: { enabled: true },
    });
    try {
      expect(runtimeStateStore(session).listAllEvents(0)[0]?.payload).toEqual(legacyPayload);
    } finally {
      await session.close();
    }

    const verification = await openDatabaseAsync({ path: dbPath });
    try {
      const row = verification.raw
        .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
        .get('event-legacy-inline') as { payloadJson: string };
      expect(row.payloadJson).toBe(originalPayloadJson);
      expect(existsSync(orphanPath)).toBe(true);
    } finally {
      verification.raw.close();
    }
  });

  it.each(['missing', 'corrupt'] as const)(
    'fails closed when an externalized Event payload blob is %s',
    async (failureMode) => {
      const dir = mkdtempSync(join(tmpdir(), `sync-think-runtime-sidecar-${failureMode}-`));
      tempDirs.push(dir);
      const dbPath = join(dir, 'sync-think.db');
      const installId = `sidecar-${failureMode}`;
      const sidecarRoot = resolveRuntimeEventPayloadSidecarRoot(dbPath, installId);
      const writer = await openPersistentRuntime({
        dbPath,
        installId,
        allowNoToken: true,
        secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
        eventPayloadSidecar: { enabled: true },
      });
      try {
        runtimeStateStore(writer).commitTransition({
          events: [
            eventDraft('event-broken-sidecar', 'context.packet.built', {
              threadId: 'thread-broken-sidecar',
              packetId: 'packet-broken-sidecar',
              summaries: ['payload-to-break'.repeat(8_192)],
            }),
          ],
        });
      } finally {
        await writer.close();
      }

      const inspection = await openDatabaseAsync({ path: dbPath });
      let blobPath = '';
      try {
        const row = inspection.raw
          .prepare('SELECT payload_json AS payloadJson FROM event WHERE id = ?')
          .get('event-broken-sidecar') as { payloadJson: string };
        const envelope = JSON.parse(row.payloadJson) as Record<string, unknown>;
        const reference = envelope[EVENT_PAYLOAD_ENVELOPE_KEY] as { relativePath: string };
        blobPath = join(sidecarRoot, reference.relativePath);
      } finally {
        inspection.raw.close();
      }
      expect(readFileSync(blobPath).byteLength).toBeGreaterThan(0);
      if (failureMode === 'missing') rmSync(blobPath);
      else writeFileSync(blobPath, 'corrupt');

      await expect(
        openPersistentRuntime({
          dbPath,
          installId,
          allowNoToken: true,
          secureStoreKeyPath: join(dir, 'secure-store', 'test-key.bin'),
          eventPayloadSidecar: { enabled: true },
        }),
      ).rejects.toMatchObject({ code: `event-payload.${failureMode}` });
    },
  );

});
