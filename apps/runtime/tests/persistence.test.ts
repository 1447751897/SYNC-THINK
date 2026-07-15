import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  SqliteEventCheckpointStore,
} from '@sync-think/storage';
import type { RunId, WorkspaceId } from '@sync-think/shared';
import {
  createRuntimeSecureStore,
  openPersistentRuntime,
  resolveRuntimeDatabasePath,
} from '../src/persistence.js';

const tempDirs: string[] = [];

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
      expect(store.loadLatestCheckpoint(checkpointRunId)).toMatchObject({
        lastEventSequence: 1,
        state: { threadVersions: [[threadId, 1]] },
      });
    } finally {
      connection.raw.close();
    }
  });
});
