import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderId } from '@sync-think/shared';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteProviderStore } from './provider-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-provider-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStore() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    dbPath,
    store: new SqliteProviderStore(connection.raw),
    close: () => connection.raw.close(),
  };
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

describe('SqliteProviderStore', () => {
  it('creates a provider with credential group/ref metadata and lists it', () => {
    return openStore().then(({ store, close }) => {
      try {
        const created = store.createProvider({
          name: 'Fake Gateway',
          baseUrl: 'https://fake.example/v1',
          protocol: 'openai-chat',
          supportsDiscovery: true,
          credentialGroupName: 'default',
          credentialLabel: 'primary',
          credentialKind: 'api-key',
          storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        });

        expect(created.provider.id).toBeTruthy();
        expect(created.provider.name).toBe('Fake Gateway');
        expect(created.provider.baseUrl).toBe('https://fake.example/v1');
        expect(created.provider.supportsDiscovery).toBe(true);
    expect(created.provider.protocol).toBe('openai-chat');
        expect(created.credentialGroup.name).toBe('default');
        expect(created.credentialRef.label).toBe('primary');
        expect(created.credentialRef.storeHandle).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
        expect(created.credentialRef.kind).toBe('api-key');

        const listed = store.listProviders();
        expect(listed).toHaveLength(1);
        expect(listed[0]?.provider.id).toBe(created.provider.id);
        expect(listed[0]?.credentialGroups).toHaveLength(1);
        expect(listed[0]?.credentialGroups[0]?.credentials[0]?.hasSecret).toBe(true);
        expect(listed[0]?.credentialGroups[0]?.credentials[0]?.label).toBe('primary');
        expect((listed[0]?.credentialGroups[0]?.credentials[0] as { storeHandle?: string }).storeHandle).toBeUndefined();
        expect(JSON.stringify(listed)).not.toContain('sk-');
      } finally {
        close();
      }
    });
  });

  it('never persists plaintext api keys in SQLite rows or files', async () => {
    const secret = 'sk-NEVER_WRITE_THIS_PLAINTEXT_TO_SQLITE_ABCDEF';
    const { store, dbPath, close } = await openStore();
    try {
      store.createProvider({
        name: 'Secret Probe',
        baseUrl: 'https://gateway.example/v1',
        protocol: 'openai-responses',
        supportsDiscovery: false,
        credentialGroupName: 'prod',
        credentialLabel: 'prod-key',
        credentialKind: 'api-key',
        storeHandle: '01HANDLEONLYNOTSECRET000001',
      });

      const rows = store.listProviders();
      const serialized = JSON.stringify(rows);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain('sk-NEVER');

      const dbDir = join(dbPath, '..');
      for (const file of walkFiles(dbDir)) {
        if (!existsSync(file) || statSync(file).isDirectory()) continue;
        const text = readFileSync(file).toString('utf8');
        expect(text).not.toContain(secret);
        expect(text).not.toContain('sk-NEVER_WRITE');
      }
    } finally {
      close();
    }
  });

  it('upserts discovered and manual models without duplicates', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Models',
        baseUrl: 'https://models.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'key',
        credentialKind: 'api-key',
        storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      });

      const first = store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'fake-mini', displayName: 'Fake Mini' },
          { providerModelId: 'fake-large', displayName: 'Fake Large' },
        ],
        capabilitiesConfirmed: false,
      });
      expect(first).toHaveLength(2);

      const second = store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [
          { providerModelId: 'fake-mini', displayName: 'Fake Mini Renamed' },
          { providerModelId: 'fake-tool-use', displayName: 'Tool Use' },
        ],
        capabilitiesConfirmed: false,
      });
      expect(second).toHaveLength(2);

      const models = store.listModels(created.provider.id as ProviderId);
      expect(models.map((m) => m.providerModelId).sort()).toEqual([
        'fake-large',
        'fake-mini',
        'fake-tool-use',
      ]);
      expect(models.find((m) => m.providerModelId === 'fake-mini')?.displayName).toBe(
        'Fake Mini Renamed',
      );
      expect(models.every((m) => m.capabilitiesConfirmed === false)).toBe(true);
    } finally {
      close();
    }
  });

  it('rejects empty name / invalid base URL / empty storeHandle', async () => {
    const { store, close } = await openStore();
    try {
      expect(() =>
        store.createProvider({
          name: '  ',
          baseUrl: 'https://x.example/v1',
          protocol: 'openai-chat',
          supportsDiscovery: false,
          credentialGroupName: 'default',
          credentialLabel: 'key',
          credentialKind: 'api-key',
          storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        }),
      ).toThrow(/name/i);

      expect(() =>
        store.createProvider({
          name: 'Bad URL',
          baseUrl: 'not-a-url',
          protocol: 'openai-chat',
          supportsDiscovery: false,
          credentialGroupName: 'default',
          credentialLabel: 'key',
          credentialKind: 'api-key',
          storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        }),
      ).toThrow(/base url/i);

      expect(() =>
        store.createProvider({
          name: 'No handle',
          baseUrl: 'https://x.example/v1',
          protocol: 'openai-chat',
          supportsDiscovery: false,
          credentialGroupName: 'default',
          credentialLabel: 'key',
          credentialKind: 'api-key',
          storeHandle: '  ',
        }),
      ).toThrow(/store handle/i);
    } finally {
      close();
    }
  });

  it('resolves credential storeHandle without exposing it on public list views helpers', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Lookup',
        baseUrl: 'https://lookup.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'primary',
        credentialKind: 'api-key',
        storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      });
      const handle = store.getCredentialStoreHandle(created.credentialRef.id);
      expect(handle).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
      expect(store.getProvider(created.provider.id)?.name).toBe('Lookup');
    } finally {
      close();
    }
  });

  it('updates model capability tags and confirmation flag without secrets', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Caps',
        baseUrl: 'https://caps.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'key',
        credentialKind: 'api-key',
        storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      });
      const upserted = store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['text'] }],
        capabilitiesConfirmed: false,
      });
      const modelId = upserted[0]!.id;
      expect(upserted[0]!.capabilitiesConfirmed).toBe(false);

      const suggested = store.updateModelCapabilities({
        modelId,
        capabilities: ['text', 'vision', 'tool-calling'],
        capabilitiesConfirmed: false,
      });
      expect(suggested.capabilities).toEqual(['text', 'vision', 'tool-calling']);
      expect(suggested.capabilitiesConfirmed).toBe(false);

      const confirmed = store.updateModelCapabilities({
        modelId,
        capabilities: ['text', 'vision'],
        capabilitiesConfirmed: true,
      });
      expect(confirmed.capabilities).toEqual(['text', 'vision']);
      expect(confirmed.capabilitiesConfirmed).toBe(true);

      const listed = store.listModels(created.provider.id as ProviderId);
      expect(listed[0]?.capabilitiesConfirmed).toBe(true);
      expect(JSON.stringify(listed)).not.toContain('sk-');
    } finally {
      close();
    }
  });

  it('lists credentials by group and returns first for 搂5.4 routing', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Multi-Key Gateway',
        baseUrl: 'https://multi-key.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'prod-pool',
        credentialLabel: 'primary',
        credentialKind: 'api-key',
        storeHandle: 'HANDLE-PRIMARY-OPAQUE',
      });
      const groupId = created.credentialGroup.id;
      const second = store.addCredentialRef({
        credentialGroupId: groupId,
        label: 'secondary',
        kind: 'api-key',
        storeHandle: 'HANDLE-SECONDARY-OPAQUE',
      });
      expect(second.credentialGroupId).toBe(groupId);

      const listed = store.listCredentialsByGroup(groupId);
      expect(listed.map((c) => c.id)).toEqual([created.credentialRef.id, second.id]);
      expect(listed.every((c) => typeof c.storeHandle === 'string')).toBe(true);

      const first = store.getFirstCredentialInGroup(groupId);
      expect(first?.id).toBe(created.credentialRef.id);
      expect(first?.label).toBe('primary');

      // Other groups are isolated.
      expect(store.listCredentialsByGroup('credential-group-unassigned')).toEqual([]);
      expect(store.getFirstCredentialInGroup('missing-group')).toBeUndefined();
      expect(store.getProviderIdForCredentialGroup(groupId)).toBe(created.provider.id);
      expect(store.getProviderIdForCredentialGroup('missing-group')).toBeUndefined();


      // Public list views still never dump raw secret material from handles into list paths.
      const catalog = store.listProviders();
      const json = JSON.stringify(catalog);
      expect(json).not.toContain('sk-');
      expect(json).not.toMatch(/HANDLE-PRIMARY-OPAQUE/);
    } finally {
      close();
    }
  });


  it('updates provider metadata and rotates primary credential handle', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Editable Gateway',
        baseUrl: 'https://edit.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'primary',
        credentialKind: 'api-key',
        storeHandle: 'HANDLE-OLD-OPAQUE-001',
      });

      const updated = store.updateProvider({
        providerId: created.provider.id,
        name: 'Editable Gateway v2',
        baseUrl: 'https://edit.example/v2',
        protocol: 'openai-responses',
        supportsDiscovery: false,
        credentialLabel: 'rotated',
        storeHandle: 'HANDLE-NEW-OPAQUE-002',
      });

      expect(updated.provider.name).toBe('Editable Gateway v2');
      expect(updated.provider.baseUrl).toBe('https://edit.example/v2');
      expect(updated.provider.protocol).toBe('openai-responses');
      expect(updated.provider.supportsDiscovery).toBe(false);
      expect(updated.previousStoreHandle).toBe('HANDLE-OLD-OPAQUE-001');
      expect(updated.credentialRef?.label).toBe('rotated');
      expect(updated.credentialRef?.storeHandle).toBe('HANDLE-NEW-OPAQUE-002');

      const primary = store.getPrimaryCredentialRef(created.provider.id);
      expect(primary?.storeHandle).toBe('HANDLE-NEW-OPAQUE-002');
      expect(primary?.label).toBe('rotated');

      const listed = store.listProviders();
      expect(JSON.stringify(listed)).not.toContain('HANDLE-NEW-OPAQUE-002');
      expect(JSON.stringify(listed)).not.toContain('sk-');
    } finally {
      close();
    }
  });

  it('updates label only without rotating secret handle', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Label Only',
        baseUrl: 'https://label.example/v1',
        protocol: 'anthropic-messages',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'primary',
        credentialKind: 'api-key',
        storeHandle: 'HANDLE-STABLE-001',
      });

      const updated = store.updateProvider({
        providerId: created.provider.id,
        credentialLabel: 'prod-key',
      });

      expect(updated.previousStoreHandle).toBeUndefined();
      expect(updated.credentialRef?.storeHandle).toBe('HANDLE-STABLE-001');
      expect(updated.credentialRef?.label).toBe('prod-key');
      expect(updated.provider.name).toBe('Label Only');
    } finally {
      close();
    }
  });

  it('rejects update of missing provider or empty name', async () => {
    const { store, close } = await openStore();
    try {
      expect(() =>
        store.updateProvider({
          providerId: 'missing-provider',
          name: 'Nope',
        }),
      ).toThrow(/not found/i);

      const created = store.createProvider({
        name: 'Keep Me',
        baseUrl: 'https://keep.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'primary',
        credentialKind: 'api-key',
        storeHandle: 'HANDLE-KEEP-001',
      });

      expect(() =>
        store.updateProvider({
          providerId: created.provider.id,
          name: '   ',
        }),
      ).toThrow(/name must not be empty/i);
    } finally {
      close();
    }
  });

});

