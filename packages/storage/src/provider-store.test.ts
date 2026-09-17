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
        capabilities: ['text', 'vision', 'web-search'],
        capabilitiesConfirmed: true,
      });
      expect(confirmed.capabilities).toEqual(['text', 'vision', 'web-search']);
      expect(confirmed.capabilitiesConfirmed).toBe(true);

      const listed = store.listModels(created.provider.id as ProviderId);
      expect(listed[0]?.capabilitiesConfirmed).toBe(true);
      expect(JSON.stringify(listed)).not.toContain('sk-');
    } finally {
      close();
    }
  });

  it('persists the per-model vision probe result and reason', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Vision probe metadata',
        baseUrl: 'https://vision-probe.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'key',
        credentialKind: 'api-key',
        storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      });
      const [model] = store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'probe-model', displayName: 'Probe model' }],
      });

      const failed = store.updateModelVisionProbe({
        modelId: model!.id,
        result: false,
        reason: '未识别测试图中的四位校验码',
      });
      expect(failed.visionCapability).toBe(false);
      expect(failed.visionProbeReason).toContain('未识别测试图');

      const reopened = store.getModel(model!.id)!;
      expect(reopened.visionCapability).toBe(false);
      expect(reopened.visionProbeReason).toContain('未识别测试图');

      const passed = store.updateModelVisionProbe({ modelId: model!.id, result: true, reason: null });
      expect(passed.visionCapability).toBe(true);
      expect(passed.visionProbeReason).toBeUndefined();
    } finally {
      close();
    }
  });

  it('keeps the vision probe result when the user confirms capability tags', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Vision probe survives confirmation',
        baseUrl: 'https://vision-confirm.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'key',
        credentialKind: 'api-key',
        storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      });
      const [model] = store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'vision-ok-model', displayName: 'Vision ok model' }],
      });

      store.updateModelVisionProbe({ modelId: model!.id, result: true, reason: null });

      // 用户认可标签集 —— 这一步曾经把实测结论一并清掉，导致视觉 fallback
      // 永远拿不到 `image === true`，整条副模型转写链路失效。
      const confirmed = store.updateModelCapabilities({
        modelId: model!.id,
        capabilities: ['text', 'vision', 'tool-calling'],
        capabilitiesConfirmed: true,
      });
      expect(confirmed.capabilitiesConfirmed).toBe(true);
      expect(confirmed.visionCapability).toBe(true);

      const reopened = store.getModel(model!.id)!;
      expect(reopened.visionCapability).toBe(true);

      // 显式 null 仍然可以清除 —— 只有调用方主动要求时才清。
      const cleared = store.updateModelCapabilities({
        modelId: model!.id,
        capabilities: ['text', 'vision'],
        capabilitiesConfirmed: true,
        visionCapability: null,
      });
      expect(cleared.visionCapability).toBeUndefined();
    } finally {
      close();
    }
  });

  it('persists the user manual image answer and keeps it across probes and rescans', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Manual vision override',
        baseUrl: 'https://manual-vision.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'key',
        credentialKind: 'api-key',
        storeHandle: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      });
      const [model] = store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'manual-vision-model', displayName: 'Manual vision model' }],
      });

      // 探针在中转站上跑不通（这张探针图根本没被读到）—— 用户手写的答案
      // 必须能在这种情形下把模型认定为有视觉能力。
      store.updateModelVisionProbe({
        modelId: model!.id,
        result: false,
        reason: '探测请求被拒绝 (HTTP 400)',
      });

      const manual = store.updateModelCapabilities({
        modelId: model!.id,
        capabilities: ['text', 'vision'],
        capabilitiesConfirmed: true,
        visionManualOverride: true,
      });
      expect(manual.visionManualOverride).toBe(true);
      // 手动答案与探针结论是两件独立的事实，互不覆盖。
      expect(manual.visionCapability).toBe(false);

      // 后续再保存能力、或探测再写一次，都不该冲掉它。
      const resaved = store.updateModelCapabilities({
        modelId: model!.id,
        capabilities: ['text', 'vision', 'tool-calling'],
        capabilitiesConfirmed: true,
      });
      expect(resaved.visionManualOverride).toBe(true);
      store.updateModelVisionProbe({ modelId: model!.id, result: true, reason: null });
      const reopened = store.getModel(model!.id)!;
      expect(reopened.visionManualOverride).toBe(true);
      expect(reopened.visionCapability).toBe(true);

      // 重新扫描（upsertModels）也不能冲掉手动答案。
      store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'manual-vision-model', displayName: 'Manual vision model' }],
      });
      expect(store.getModel(model!.id)!.visionManualOverride).toBe(true);

      // 显式 null 才清除，回到探针 / 已知表裁决。
      const cleared = store.updateModelCapabilities({
        modelId: model!.id,
        capabilities: ['text', 'vision'],
        capabilitiesConfirmed: true,
        visionManualOverride: null,
      });
      expect(cleared.visionManualOverride).toBeUndefined();
      expect(cleared.visionCapability).toBe(true);
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

      const [existingModel] = store.upsertModels({
        providerId: created.provider.id,
        protocol: 'openai-chat',
        models: [{ providerModelId: 'editable-model', displayName: 'Editable Model' }],
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
      expect(store.getModel(existingModel.id)?.protocol).toBe('openai-responses');
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

  it('updates a specific credential by id without touching other credentials', async () => {
    const { store, close } = await openStore();
    try {
      const created = store.createProvider({
        name: 'Scoped Keys',
        baseUrl: 'https://scoped.example/v1',
        protocol: 'openai-chat',
        supportsDiscovery: true,
        credentialGroupName: 'default',
        credentialLabel: 'primary',
        credentialKind: 'api-key',
        storeHandle: 'HANDLE-PRIMARY-001',
      });
      const secondary = store.addCredentialRef({
        credentialGroupId: created.credentialGroup.id,
        label: 'secondary',
        kind: 'api-key',
        storeHandle: 'HANDLE-SECONDARY-001',
      });

      const owned = store.getCredentialRefForProvider(created.provider.id, secondary.id);
      expect(owned?.storeHandle).toBe('HANDLE-SECONDARY-001');
      expect(store.getCredentialRefForProvider('missing-provider', secondary.id)).toBeUndefined();

      const rotated = store.updateCredentialRef({
        providerId: created.provider.id,
        credentialRefId: secondary.id,
        label: 'relay-b',
        storeHandle: 'HANDLE-SECONDARY-002',
      });
      expect(rotated.previousStoreHandle).toBe('HANDLE-SECONDARY-001');
      expect(rotated.credential.label).toBe('relay-b');
      expect(rotated.credential.storeHandle).toBe('HANDLE-SECONDARY-002');
      expect(store.getPrimaryCredentialRef(created.provider.id)?.storeHandle).toBe(
        'HANDLE-PRIMARY-001',
      );
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
