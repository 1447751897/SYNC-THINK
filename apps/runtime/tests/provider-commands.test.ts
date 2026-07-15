import { describe, expect, it, afterEach } from 'vitest';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { FakeProvider, OpenAIChatAdapter } from '@sync-think/adapters';
import { openPersistentRuntime } from '../src/persistence.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
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
      features: ['provider.create', 'provider.list', 'provider.discoverModels', 'provider.addModels', 'provider.probeCapabilities', 'provider.confirmCapabilities'],
    },
  });
  expect(resp.payload).toMatchObject({ ok: true });
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, name.name);
    if (name.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

describe('provider commands', () => {
  it('creates provider with secure key, discovers fake models, lists without secrets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-provider-cmd-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-prov-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secret = 'sk-TEST_PLAINTEXT_NEVER_IN_DB_OR_RESPONSE_XYZ123456';

    const session = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
      secureStoreKeyPath: secureKey,
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    try {
      const sock = await connectRuntime(installId);
      const reader = createFrameReader(sock);
      await hello(sock, reader, installId);

      const created = await writeAndRead(sock, reader, {
        id: 'prov-create',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Fake Gateway',
          baseUrl: 'https://fake.gateway/v1',
          protocol: 'openai-chat',
          apiKey: secret,
          supportsDiscovery: true,
          credentialGroupName: 'default',
          credentialLabel: 'primary',
        },
      });

      expect(created.error).toBeUndefined();
      const createPayload = created.payload as {
        provider: {
          providerId: string;
          name: string;
          models: Array<{ providerModelId: string }>;
          credentials: Array<{ hasSecret: boolean; label: string }>;
        };
        secretStored: boolean;
        discoveredModelCount: number;
      };
      expect(createPayload.secretStored).toBe(true);
      expect(createPayload.provider.name).toBe('Fake Gateway');
      expect((createPayload.provider as { protocol?: string }).protocol).toBe('openai-chat');
      expect(createPayload.discoveredModelCount).toBe(3);
      expect(createPayload.provider.models.map((m) => m.providerModelId).sort()).toEqual([
        'fake-large',
        'fake-mini',
        'fake-tool-use',
      ]);
      expect(createPayload.provider.credentials[0]?.hasSecret).toBe(true);
      expect(JSON.stringify(created)).not.toContain(secret);
      expect(JSON.stringify(created)).not.toContain('sk-TEST');

      const listed = await writeAndRead(sock, reader, {
        id: 'prov-list',
        kind: 'request',
        type: 'provider.list',
        payload: {},
      });
      expect(listed.error).toBeUndefined();
      const listPayload = listed.payload as {
        providers: Array<{ name: string; models: unknown[]; credentials: unknown[] }>;
      };
      expect(listPayload.providers).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain(secret);

      // SQLite and vault directory must not contain plaintext key in clear form on DB files
      for (const file of walkFiles(dir)) {
        if (!existsSync(file) || statSync(file).isDirectory()) continue;
        // skip encrypted vault binaries may coincidentally contain substrings - check text-ish files
        if (file.endsWith('.db') || file.endsWith('.json') || file.endsWith('.log')) {
          const text = readFileSync(file).toString('utf8');
          expect(text).not.toContain(secret);
        }
      }

      // Manual model add
      const added = await writeAndRead(sock, reader, {
        id: 'prov-add',
        kind: 'request',
        type: 'provider.addModels',
        payload: {
          providerId: createPayload.provider.providerId,
          protocol: 'openai-chat',
          models: [{ providerModelId: 'manual-extra', displayName: 'Manual Extra' }],
        },
      });
      expect(added.error).toBeUndefined();
      const addPayload = added.payload as { models: Array<{ providerModelId: string }> };
      expect(addPayload.models.some((m) => m.providerModelId === 'manual-extra')).toBe(true);

      sock.destroy();
    } finally {
      await session.close();
    }
  }, 20_000);

  it('rejects create without api key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-provider-bad-'));
    tempDirs.push(dir);
    const installId = `test-prov-bad-${Date.now()}`;
    const session = await openPersistentRuntime({
      dbPath: join(dir, 'sync-think.db'),
      installId,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'key.bin'),
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();
    try {
      const sock = await connectRuntime(installId);
      const reader = createFrameReader(sock);
      await hello(sock, reader, installId);
      const resp = await writeAndRead(sock, reader, {
        id: 'bad',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'X',
          baseUrl: 'https://x.example/v1',
          protocol: 'openai-chat',
          apiKey: '',
        },
      });
      expect(resp.error?.code).toBe('protocol.frame_malformed');
      sock.destroy();
    } finally {
      await session.close();
    }
  }, 15_000);

  it('creates provider and discovers real model ids via OpenAI-compatible adapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-provider-real-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'sync-think.db');
    const secureKey = join(dir, 'secure', 'key.bin');
    const installId = `test-prov-real-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secret = 'sk-REAL_DISCOVERY_SECRET_NEVER_ECHO_7788';

    const fetchMock = async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://gateway.example/v1/models');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${secret}`);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, { id: 'deepseek-chat' }],
          }),
      } as Response;
    };

    const session = await openPersistentRuntime({
      dbPath,
      installId,
      allowNoToken: true,
      secureStoreKeyPath: secureKey,
      // Demo stream still Fake; discovery must use protocol adapter.
      demoProvider: new FakeProvider(),
      discoveryByProtocol: {
        'openai-chat': new OpenAIChatAdapter({ fetchImpl: fetchMock }),
      },
    });
    await session.runtime.start();

    try {
      const sock = await connectRuntime(installId);
      const reader = createFrameReader(sock);
      await hello(sock, reader, installId);

      const created = await writeAndRead(sock, reader, {
        id: 'prov-create-real',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Live Gateway',
          baseUrl: 'https://gateway.example/v1',
          protocol: 'openai-chat',
          apiKey: secret,
          supportsDiscovery: true,
        },
      });

      expect(created.error).toBeUndefined();
      const createPayload = created.payload as {
        provider: { providerId: string; models: Array<{ providerModelId: string }> };
        discoveredModelCount: number;
      };
      expect(createPayload.discoveredModelCount).toBe(3);
      expect(createPayload.provider.models.map((m) => m.providerModelId).sort()).toEqual([
        'deepseek-chat',
        'gpt-4o',
        'gpt-4o-mini',
      ]);
      // Must not fall back to FakeProvider model ids.
      expect(createPayload.provider.models.some((m) => m.providerModelId.startsWith('fake-'))).toBe(
        false,
      );
      expect(JSON.stringify(created)).not.toContain(secret);

      const rediscovered = await writeAndRead(sock, reader, {
        id: 'prov-discover-real',
        kind: 'request',
        type: 'provider.discoverModels',
        payload: { providerId: createPayload.provider.providerId },
      });
      expect(rediscovered.error).toBeUndefined();
      const discoverPayload = rediscovered.payload as {
        discoveredIds: string[];
        source: string;
        protocol?: string;
        previousModelCount?: number;
        addedIds?: string[];
      };
      expect(discoverPayload.source).toBe('adapter');
      expect(discoverPayload.protocol).toBe('openai-chat');
      expect(typeof discoverPayload.previousModelCount).toBe('number');
      expect(discoverPayload.discoveredIds).toEqual(
        expect.arrayContaining(['gpt-4o-mini', 'gpt-4o', 'deepseek-chat']),
      );
      expect(JSON.stringify(rediscovered)).not.toContain(secret);

      sock.destroy();
    } finally {
      await session.close();
    }
  }, 20_000);

  it('surfaces auth failure from discovery without leaking secrets', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-provider-auth-'));
    tempDirs.push(dir);
    const installId = `test-prov-auth-${Date.now()}`;
    const secret = 'sk-AUTH_FAIL_SECRET_SHOULD_NOT_LEAK_001';

    const fetchMock = async () =>
      ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: `bad key ${secret}` } }),
      }) as Response;

    const session = await openPersistentRuntime({
      dbPath: join(dir, 'sync-think.db'),
      installId,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'key.bin'),
      demoProvider: new FakeProvider(),
      discoveryByProtocol: {
        'openai-chat': new OpenAIChatAdapter({ fetchImpl: fetchMock }),
      },
    });
    await session.runtime.start();
    try {
      const sock = await connectRuntime(installId);
      const reader = createFrameReader(sock);
      await hello(sock, reader, installId);

      // Create still succeeds (discovery best-effort on create).
      const created = await writeAndRead(sock, reader, {
        id: 'c1',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Auth Gate',
          baseUrl: 'https://auth.example/v1',
          protocol: 'openai-chat',
          apiKey: secret,
          supportsDiscovery: true,
        },
      });
      expect(created.error).toBeUndefined();
      const providerId = (created.payload as { provider: { providerId: string } }).provider
        .providerId;

      const discovered = await writeAndRead(sock, reader, {
        id: 'd1',
        kind: 'request',
        type: 'provider.discoverModels',
        payload: { providerId },
      });
      expect(discovered.error?.code).toBe('provider.auth_failed');
      expect(JSON.stringify(discovered)).not.toContain(secret);
      expect(JSON.stringify(discovered)).not.toContain('sk-AUTH');

      const diags = await writeAndRead(sock, reader, {
        id: 'd-list',
        kind: 'request',
        type: 'diagnostics.list',
        payload: { limit: 20 },
      });
      expect(diags.error).toBeUndefined();
      const diagPayload = diags.payload as {
        diagnostics: Array<{ summary: string; failureClass?: string; detail: Record<string, unknown> }>;
      };
      const discoveryDiag = diagPayload.diagnostics.find((d) =>
        /Discovery failed/i.test(d.summary),
      );
      expect(discoveryDiag).toBeTruthy();
      expect(discoveryDiag?.failureClass).toBe('auth');
      expect(JSON.stringify(diags)).not.toContain(secret);
      expect(JSON.stringify(diags)).not.toContain('sk-AUTH');

      sock.destroy();
    } finally {
      await session.close();
    }
  }, 20_000);


  it('probes capabilities as suggestions then confirms user edits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-think-provider-caps-'));
    tempDirs.push(dir);
    const installId = `test-prov-caps-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secret = 'sk-CAPS_PROBE_SECRET_NEVER_IN_EVENTS_9911';
    const session = await openPersistentRuntime({
      dbPath: join(dir, 'sync-think.db'),
      installId,
      allowNoToken: true,
      secureStoreKeyPath: join(dir, 'key.bin'),
      demoProvider: new FakeProvider(),
    });
    await session.runtime.start();

    try {
      const sock = await connectRuntime(installId);
      const reader = createFrameReader(sock);
      await hello(sock, reader, installId);

      const created = await writeAndRead(sock, reader, {
        id: 'caps-create',
        kind: 'request',
        type: 'provider.create',
        payload: {
          name: 'Caps Gateway',
          baseUrl: 'https://caps.example/v1',
          protocol: 'openai-chat',
          apiKey: secret,
          supportsDiscovery: true,
        },
      });
      expect(created.error).toBeUndefined();
      const createPayload = created.payload as {
        provider: { providerId: string; models: Array<{ modelId: string; providerModelId: string }> };
      };
      const providerId = createPayload.provider.providerId;

      // Ensure a known model id for heuristics
      await writeAndRead(sock, reader, {
        id: 'caps-add',
        kind: 'request',
        type: 'provider.addModels',
        payload: {
          providerId,
          protocol: 'openai-chat',
          models: [{ providerModelId: 'gpt-4o', displayName: 'GPT-4o' }],
        },
      });

      const probed = await writeAndRead(sock, reader, {
        id: 'caps-probe',
        kind: 'request',
        type: 'provider.probeCapabilities',
        payload: { providerId },
      });
      expect(probed.error).toBeUndefined();
      const probePayload = probed.payload as {
        applied: boolean;
        suggestions: Array<{
          providerModelId: string;
          capabilities: string[];
          capabilitiesConfirmed: boolean;
          source: string;
        }>;
      };
      expect(probePayload.applied).toBe(true);
      const gpt = probePayload.suggestions.find((s) => s.providerModelId === 'gpt-4o');
      expect(gpt).toBeTruthy();
      expect(gpt!.capabilitiesConfirmed).toBe(false);
      expect(gpt!.capabilities).toEqual(expect.arrayContaining(['text', 'vision', 'tool-calling']));
      expect(gpt!.source).toBe('heuristic');
      expect(JSON.stringify(probed)).not.toContain(secret);

      const listed = await writeAndRead(sock, reader, {
        id: 'caps-list',
        kind: 'request',
        type: 'provider.list',
        payload: {},
      });
      const listPayload = listed.payload as {
        providers: Array<{
          models: Array<{
            modelId: string;
            providerModelId: string;
            capabilities: string[];
            capabilitiesConfirmed: boolean;
          }>;
        }>;
      };
      const listedGpt = listPayload.providers[0]!.models.find((m) => m.providerModelId === 'gpt-4o')!;
      expect(listedGpt.capabilitiesConfirmed).toBe(false);
      expect(listedGpt.capabilities).toEqual(expect.arrayContaining(['text', 'vision']));

      const confirmed = await writeAndRead(sock, reader, {
        id: 'caps-confirm',
        kind: 'request',
        type: 'provider.confirmCapabilities',
        payload: {
          modelId: listedGpt.modelId,
          capabilities: ['text', 'vision'],
          confirmed: true,
        },
      });
      expect(confirmed.error).toBeUndefined();
      const confirmPayload = confirmed.payload as {
        model: { capabilities: string[]; capabilitiesConfirmed: boolean; providerModelId: string };
      };
      expect(confirmPayload.model.capabilitiesConfirmed).toBe(true);
      expect(confirmPayload.model.capabilities).toEqual(['text', 'vision']);
      expect(JSON.stringify(confirmed)).not.toContain(secret);

      const listed2 = await writeAndRead(sock, reader, {
        id: 'caps-list2',
        kind: 'request',
        type: 'provider.list',
        payload: {},
      });
      const list2 = listed2.payload as {
        providers: Array<{ models: Array<{ providerModelId: string; capabilitiesConfirmed: boolean; capabilities: string[] }> }>;
      };
      const gpt2 = list2.providers[0]!.models.find((m) => m.providerModelId === 'gpt-4o')!;
      expect(gpt2.capabilitiesConfirmed).toBe(true);
      expect(gpt2.capabilities).toEqual(['text', 'vision']);

      sock.destroy();
    } finally {
      await session.close();
    }
  }, 20_000);

});
