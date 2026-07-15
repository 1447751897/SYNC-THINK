import { connect, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteProviderStore,
} from '@sync-think/storage';
import {
  SecureStore,
  type SecureStoreBackend,
} from '@sync-think/secure-store';
import { Runtime, type RuntimeStateStore } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class TrackingBackend implements SecureStoreBackend {
  readonly name = 'tracking';
  readonly secrets = new Map<string, string>();
  readonly removed: string[] = [];

  async store(handle: string, plaintext: string): Promise<void> {
    this.secrets.set(handle, plaintext);
  }

  async retrieve(handle: string): Promise<string> {
    const secret = this.secrets.get(handle);
    if (!secret) throw Object.assign(new Error('secret not found'), { code: 'SECRET_NOT_FOUND' });
    return secret;
  }

  async remove(handle: string): Promise<void> {
    this.removed.push(handle);
    this.secrets.delete(handle);
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

class PostCommitFailingProviderStore extends SqliteProviderStore {
  failNextCatalogRead = false;

  override listProviders(): ReturnType<SqliteProviderStore['listProviders']> {
    if (this.failNextCatalogRead) {
      this.failNextCatalogRead = false;
      throw new Error('injected post-commit catalog failure');
    }
    return super.listProviders();
  }
}

function frameReader(socket: Socket) {
  let pending = Buffer.alloc(0);
  const queued: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queued.push(frame);
    }
  });
  return () => {
    const ready = queued.shift();
    return ready ? Promise.resolve(ready) : new Promise<Frame>((resolve) => waiters.push(resolve));
  };
}

async function request(socket: Socket, next: () => Promise<Frame>, frame: Frame): Promise<Frame> {
  const response = next();
  socket.write(encodeFrame(frame));
  return response;
}

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function createFixture(options: { stateStore?: RuntimeStateStore } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-provider-compensation-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'sync-think.db');
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const providerStore = new PostCommitFailingProviderStore(connection.raw);
  const backend = new TrackingBackend();
  const installId = `provider-comp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const runtime = new Runtime({
    installId,
    allowNoToken: true,
    providerStore,
    secureStore: new SecureStore(backend),
    stateStore: options.stateStore,
  });
  await runtime.start();
  const socket = await connectRuntime(installId);
  const next = frameReader(socket);
  await request(socket, next, {
    id: 'hello',
    kind: 'request',
    type: '__hello',
    payload: {
      protocolVersion: 2,
      appVersion: '0.0.1',
      installId,
      nonce: 'provider-compensation-test',
      features: ['provider.create', 'provider.update', 'provider.importCcSwitch'],
    },
  });
  return { dir, connection, providerStore, backend, runtime, socket, next };
}

async function closeFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  fixture.socket.destroy();
  await fixture.runtime.stop();
  fixture.connection.raw.close();
}

function credentialRows(raw: Awaited<ReturnType<typeof openDatabaseAsync>>['raw']) {
  return raw.prepare('SELECT store_handle FROM credential_ref ORDER BY created_at ASC').all() as Array<{
    store_handle: string;
  }>;
}

function failingEventStore(): RuntimeStateStore {
  return {
    commitTransition() {
      throw new Error('injected provider event failure');
    },
    listEvents() {
      return [];
    },
    loadLatestCheckpoint() {
      return undefined;
    },
  };
}

describe('provider secret compensation boundary', () => {
  it('keeps a newly committed create secret when a later catalog read fails', async () => {
    const fixture = await createFixture();
    try {
      fixture.providerStore.failNextCatalogRead = true;
      const response = await request(fixture.socket, fixture.next, {
        id: 'create-post-commit-failure',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Committed Provider',
          baseUrl: 'https://committed.example/v1',
          protocol: 'openai-chat',
          apiKey: 'sk-COMMITTED_CREATE_SECRET_123456789',
          supportsDiscovery: false,
        },
      });
      expect(response.error).toBeDefined();
      const [credential] = credentialRows(fixture.connection.raw);
      expect(credential).toBeDefined();
      expect(fixture.backend.secrets.get(credential!.store_handle)).toBe(
        'sk-COMMITTED_CREATE_SECRET_123456789',
      );
      expect(fixture.backend.removed).not.toContain(credential!.store_handle);
    } finally {
      await closeFixture(fixture);
    }
  });

  it('keeps the committed rotated secret when a later catalog read fails', async () => {
    const fixture = await createFixture();
    try {
      const created = await request(fixture.socket, fixture.next, {
        id: 'create-before-rotate',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Rotated Provider',
          baseUrl: 'https://rotate.example/v1',
          protocol: 'openai-chat',
          apiKey: 'sk-OLD_ROTATION_SECRET_123456789',
          supportsDiscovery: false,
        },
      });
      const providerId = (created.payload as { provider: { providerId: string } }).provider.providerId;
      const oldHandle = credentialRows(fixture.connection.raw)[0]!.store_handle;

      fixture.providerStore.failNextCatalogRead = true;
      const response = await request(fixture.socket, fixture.next, {
        id: 'rotate-post-commit-failure',
        kind: 'request',
        type: 'provider.update',
        payload: {
          providerId,
          apiKey: 'sk-NEW_ROTATION_SECRET_123456789',
        },
      });
      expect(response.error).toBeDefined();
      const newHandle = credentialRows(fixture.connection.raw)[0]!.store_handle;
      expect(newHandle).not.toBe(oldHandle);
      expect(fixture.backend.secrets.get(newHandle)).toBe('sk-NEW_ROTATION_SECRET_123456789');
      expect(fixture.backend.removed).toContain(oldHandle);
      expect(fixture.backend.removed).not.toContain(newHandle);
    } finally {
      await closeFixture(fixture);
    }
  });

  it('keeps a committed CC Switch import secret when a later catalog read fails', async () => {
    const fixture = await createFixture();
    try {
      const ccDbPath = join(fixture.dir, 'cc-switch.db');
      const cc = await openDatabaseAsync({ path: ccDbPath });
      cc.raw.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          app_type TEXT NOT NULL,
          name TEXT NOT NULL,
          settings_config TEXT NOT NULL,
          meta TEXT,
          is_current INTEGER
        )
      `);
      cc.raw.prepare(
        `INSERT INTO providers (id, app_type, name, settings_config, meta, is_current)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        'cc-committed',
        'codex',
        'Imported Committed Provider',
        JSON.stringify({
          auth: { OPENAI_API_KEY: 'sk-COMMITTED_IMPORT_SECRET_123456789' },
          config: 'base_url = "https://import.example/v1"\nmodel = "gpt-import"',
        }),
        JSON.stringify({ apiFormat: 'openai_responses' }),
        1,
      );
      cc.raw.close();

      fixture.providerStore.failNextCatalogRead = true;
      const response = await request(fixture.socket, fixture.next, {
        id: 'import-post-commit-failure',
        kind: 'request',
        type: 'provider.importCcSwitch',
        payload: { dbPath: ccDbPath, sourceIds: ['cc-committed'] },
      });
      expect((response.payload as { failedCount: number }).failedCount).toBe(1);
      const [credential] = credentialRows(fixture.connection.raw);
      expect(credential).toBeDefined();
      expect(fixture.backend.secrets.get(credential!.store_handle)).toBe(
        'sk-COMMITTED_IMPORT_SECRET_123456789',
      );
      expect(fixture.backend.removed).not.toContain(credential!.store_handle);
    } finally {
      await closeFixture(fixture);
    }
  });

  it('keeps a newly committed create secret when durable event persistence fails', async () => {
    const fixture = await createFixture({ stateStore: failingEventStore() });
    try {
      const response = await request(fixture.socket, fixture.next, {
        id: 'create-event-failure',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Event Failure Provider',
          baseUrl: 'https://event-failure.example/v1',
          protocol: 'openai-chat',
          apiKey: 'sk-COMMITTED_EVENT_CREATE_SECRET_123456789',
          supportsDiscovery: false,
        },
      });
      expect(response.error).toBeDefined();
      const [credential] = credentialRows(fixture.connection.raw);
      expect(credential).toBeDefined();
      expect(fixture.backend.secrets.get(credential!.store_handle)).toBe(
        'sk-COMMITTED_EVENT_CREATE_SECRET_123456789',
      );
      expect(fixture.backend.removed).not.toContain(credential!.store_handle);
    } finally {
      await closeFixture(fixture);
    }
  });

  it('keeps the committed rotated secret when durable event persistence fails', async () => {
    const fixture = await createFixture({ stateStore: failingEventStore() });
    try {
      const seeded = fixture.providerStore.createProvider({
        name: 'Event Rotate Provider',
        baseUrl: 'https://event-rotate.example/v1',
        protocol: 'openai-chat',
        storeHandle: await new SecureStore(fixture.backend).storeSecret(
          'sk-OLD_EVENT_ROTATION_SECRET_123456789',
        ),
      });
      const oldHandle = seeded.credentialRef.storeHandle;
      const response = await request(fixture.socket, fixture.next, {
        id: 'rotate-event-failure',
        kind: 'request',
        type: 'provider.update',
        payload: {
          providerId: seeded.provider.id,
          apiKey: 'sk-NEW_EVENT_ROTATION_SECRET_123456789',
        },
      });
      expect(response.error).toBeDefined();
      const newHandle = credentialRows(fixture.connection.raw)[0]!.store_handle;
      expect(newHandle).not.toBe(oldHandle);
      expect(fixture.backend.secrets.get(newHandle)).toBe(
        'sk-NEW_EVENT_ROTATION_SECRET_123456789',
      );
      expect(fixture.backend.removed).toContain(oldHandle);
      expect(fixture.backend.removed).not.toContain(newHandle);
    } finally {
      await closeFixture(fixture);
    }
  });

  it('keeps a committed CC Switch import secret when durable event persistence fails', async () => {
    const fixture = await createFixture({ stateStore: failingEventStore() });
    try {
      const ccDbPath = join(fixture.dir, 'cc-switch-event-failure.db');
      const cc = await openDatabaseAsync({ path: ccDbPath });
      cc.raw.exec(`
        CREATE TABLE providers (
          id TEXT PRIMARY KEY,
          app_type TEXT NOT NULL,
          name TEXT NOT NULL,
          settings_config TEXT NOT NULL,
          meta TEXT,
          is_current INTEGER
        )
      `);
      cc.raw.prepare(
        `INSERT INTO providers (id, app_type, name, settings_config, meta, is_current)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        'cc-event-failure',
        'codex',
        'Imported Event Failure Provider',
        JSON.stringify({
          auth: { OPENAI_API_KEY: 'sk-COMMITTED_EVENT_IMPORT_SECRET_123456789' },
          config: 'base_url = "https://event-import.example/v1"\nmodel = "gpt-event-import"',
        }),
        JSON.stringify({ apiFormat: 'openai_responses' }),
        1,
      );
      cc.raw.close();

      const response = await request(fixture.socket, fixture.next, {
        id: 'import-event-failure',
        kind: 'request',
        type: 'provider.importCcSwitch',
        payload: { dbPath: ccDbPath, sourceIds: ['cc-event-failure'] },
      });
      expect((response.payload as { failedCount: number }).failedCount).toBe(1);
      const [credential] = credentialRows(fixture.connection.raw);
      expect(credential).toBeDefined();
      expect(fixture.backend.secrets.get(credential!.store_handle)).toBe(
        'sk-COMMITTED_EVENT_IMPORT_SECRET_123456789',
      );
      expect(fixture.backend.removed).not.toContain(credential!.store_handle);
    } finally {
      await closeFixture(fixture);
    }
  });
});
