import type {
  ReorderWebSearchProvidersPayload,
  SaveWebSearchProviderPayload,
  WebSearchProviderId,
  WebSearchProviderSummary,
} from '@sync-think/protocol';
import type { ResolvedWebSearchProvider } from './web-search-service.js';

const WEB_SEARCH_PROVIDER_IDS = [
  'tavily',
  'exa',
  'brave',
  'serpapi',
  'serper',
  'bing',
  'google',
  'firecrawl',
  'metaso',
  'doubao',
] as const satisfies readonly WebSearchProviderId[];

interface SettingStoreLike {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown, now?: string): unknown;
}

interface SecureStoreLike {
  storeSecret(value: string): Promise<string>;
  retrieveSecret(handle: string): Promise<string>;
  removeSecret(handle: string): Promise<unknown>;
}

interface PersistedWebSearchProvider {
  id: WebSearchProviderId;
  enabled: boolean;
  priority: number;
  apiKeyHandle?: string;
  secretKeyHandle?: string;
  engineId?: string;
  endpoint?: string;
  updatedAt?: string;
}

interface PersistedWebSearchConfig {
  version: 1;
  providers: PersistedWebSearchProvider[];
}

export const WEB_SEARCH_CONFIG_SETTING_KEY = 'web.search.providers';

export const WEB_SEARCH_PROVIDER_CATALOG: ReadonlyArray<
  Pick<WebSearchProviderSummary, 'id' | 'name' | 'description' | 'requiresEngineId'>
> = [
  {
    id: 'tavily',
    name: 'Tavily',
    description: '面向 AI 的联网搜索，返回摘要清晰、适合模型直接引用的结果。',
  },
  {
    id: 'exa',
    name: 'Exa',
    description: '语义与关键词搜索，适合技术资料、论文和深度研究。',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    description: '独立网页索引，覆盖通用网页、新闻与技术内容。',
  },
  {
    id: 'serpapi',
    name: 'SerpAPI',
    description: '通过 Google 搜索结果接口提供稳定的结构化网页结果。',
  },
  {
    id: 'serper',
    name: 'Serper',
    description: '轻量快速的 Google 搜索 API，适合通用关键词查询。',
  },
  {
    id: 'bing',
    name: 'Bing Web Search',
    description: 'Microsoft Bing 网页搜索结果接口。',
  },
  {
    id: 'google',
    name: 'Google Programmable Search',
    description: 'Google 可编程搜索，需要 API Key 和搜索引擎 ID。',
    requiresEngineId: true,
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: '搜索并提取可供模型读取的网页内容。',
  },
  {
    id: 'metaso',
    name: '秘塔搜索',
    description: '面向中文内容的联网搜索服务。',
  },
  {
    id: 'doubao',
    name: '豆包联网搜索',
    description: '火山引擎联网搜索服务，适合中文网页检索。',
  },
];

export class WebSearchConfigStore {
  constructor(
    private readonly settings: SettingStoreLike,
    private readonly secrets: SecureStoreLike,
  ) {}

  list(includeDisabled = true): WebSearchProviderSummary[] {
    const config = this.read();
    return WEB_SEARCH_PROVIDER_CATALOG.map((catalog, index) => {
      const row =
        config.providers.find((provider) => provider.id === catalog.id) ??
        defaultProvider(catalog.id, index);
      return {
        ...catalog,
        enabled: row.enabled,
        configured:
          Boolean(row.apiKeyHandle) && (!catalog.requiresEngineId || Boolean(row.engineId)),
        priority: row.priority,
        ...(row.engineId ? { engineId: row.engineId } : {}),
        ...(row.endpoint ? { endpoint: row.endpoint } : {}),
        ...(row.updatedAt ? { updatedAt: row.updatedAt } : {}),
      };
    })
      .filter((provider) => includeDisabled || provider.enabled)
      .sort((left, right) => left.priority - right.priority);
  }

  hasEnabledProvider(): boolean {
    return this.list(false).some((provider) => provider.configured);
  }

  async resolveEnabled(): Promise<ResolvedWebSearchProvider[]> {
    const config = this.read();
    const rows = config.providers
      .filter((provider) => provider.enabled && provider.apiKeyHandle)
      .sort((left, right) => left.priority - right.priority);
    const resolved: ResolvedWebSearchProvider[] = [];
    for (const row of rows) {
      const catalog = WEB_SEARCH_PROVIDER_CATALOG.find((provider) => provider.id === row.id);
      if (catalog?.requiresEngineId && !row.engineId) continue;
      const apiKey = (await this.secrets.retrieveSecret(row.apiKeyHandle!)).trim();
      if (!apiKey) continue;
      const secretKey = row.secretKeyHandle
        ? (await this.secrets.retrieveSecret(row.secretKeyHandle)).trim()
        : undefined;
      resolved.push({
        id: row.id,
        apiKey,
        ...(secretKey ? { secretKey } : {}),
        ...(row.engineId ? { engineId: row.engineId } : {}),
        ...(row.endpoint ? { endpoint: row.endpoint } : {}),
      });
    }
    return resolved;
  }

  async resolveForTest(input: {
    providerId: WebSearchProviderId;
    apiKey?: string;
    secretKey?: string;
    engineId?: string;
    endpoint?: string;
  }): Promise<ResolvedWebSearchProvider | undefined> {
    const row = this.read().providers.find((provider) => provider.id === input.providerId);
    const apiKey =
      input.apiKey?.trim() ||
      (row?.apiKeyHandle ? (await this.secrets.retrieveSecret(row.apiKeyHandle)).trim() : '');
    if (!apiKey) return undefined;
    const secretKey =
      input.secretKey?.trim() ||
      (row?.secretKeyHandle ? (await this.secrets.retrieveSecret(row.secretKeyHandle)).trim() : '');
    return {
      id: input.providerId,
      apiKey,
      ...(secretKey ? { secretKey } : {}),
      ...(input.engineId?.trim() || row?.engineId
        ? { engineId: input.engineId?.trim() || row?.engineId }
        : {}),
      ...(input.endpoint?.trim() || row?.endpoint
        ? { endpoint: input.endpoint?.trim() || row?.endpoint }
        : {}),
    };
  }

  async save(payload: SaveWebSearchProviderPayload): Promise<WebSearchProviderSummary> {
    const config = this.read();
    const index = config.providers.findIndex((provider) => provider.id === payload.providerId);
    const previous =
      index >= 0
        ? config.providers[index]!
        : defaultProvider(payload.providerId, WEB_SEARCH_PROVIDER_IDS.indexOf(payload.providerId));
    let apiKeyHandle = payload.clearApiKey ? undefined : previous.apiKeyHandle;
    let secretKeyHandle = payload.clearSecretKey ? undefined : previous.secretKeyHandle;
    const createdHandles: string[] = [];
    try {
      if (payload.apiKey?.trim()) {
        apiKeyHandle = await this.secrets.storeSecret(payload.apiKey.trim());
        createdHandles.push(apiKeyHandle);
      }
      if (payload.secretKey?.trim()) {
        secretKeyHandle = await this.secrets.storeSecret(payload.secretKey.trim());
        createdHandles.push(secretKeyHandle);
      }
      const now = new Date().toISOString();
      const next: PersistedWebSearchProvider = {
        id: payload.providerId,
        enabled: payload.enabled,
        priority: previous.priority,
        ...(apiKeyHandle ? { apiKeyHandle } : {}),
        ...(secretKeyHandle ? { secretKeyHandle } : {}),
        ...(payload.engineId?.trim() || previous.engineId
          ? { engineId: payload.engineId?.trim() || previous.engineId }
          : {}),
        ...(payload.endpoint?.trim() || previous.endpoint
          ? { endpoint: payload.endpoint?.trim() || previous.endpoint }
          : {}),
        updatedAt: now,
      };
      if (index >= 0) config.providers[index] = next;
      else config.providers.push(next);
      this.settings.set(WEB_SEARCH_CONFIG_SETTING_KEY, config, now);
      await this.removeReplacedSecrets(previous, next);
      return this.list().find((provider) => provider.id === payload.providerId)!;
    } catch (error) {
      await Promise.all(
        createdHandles.map((handle) => this.secrets.removeSecret(handle).catch(() => undefined)),
      );
      throw error;
    }
  }

  reorder(payload: ReorderWebSearchProvidersPayload): WebSearchProviderSummary[] {
    const config = this.read();
    const byId = new Map(config.providers.map((provider) => [provider.id, provider]));
    config.providers = payload.providerIds.map((id, priority) => ({
      ...(byId.get(id) ?? defaultProvider(id, priority)),
      priority,
    }));
    this.settings.set(WEB_SEARCH_CONFIG_SETTING_KEY, config);
    return this.list();
  }

  private read(): PersistedWebSearchConfig {
    const value = this.settings.get(WEB_SEARCH_CONFIG_SETTING_KEY)?.value;
    const record = objectValue(value);
    const stored = Array.isArray(record.providers)
      ? record.providers
          .map(parseProvider)
          .filter((row): row is PersistedWebSearchProvider => Boolean(row))
      : [];
    const byId = new Map(stored.map((provider) => [provider.id, provider]));
    return {
      version: 1,
      providers: WEB_SEARCH_PROVIDER_IDS.map(
        (id, priority) => byId.get(id) ?? defaultProvider(id, priority),
      ),
    };
  }

  private async removeReplacedSecrets(
    previous: PersistedWebSearchProvider,
    next: PersistedWebSearchProvider,
  ): Promise<void> {
    for (const handle of [previous.apiKeyHandle, previous.secretKeyHandle]) {
      if (handle && handle !== next.apiKeyHandle && handle !== next.secretKeyHandle) {
        await this.secrets.removeSecret(handle).catch(() => undefined);
      }
    }
  }
}

function defaultProvider(id: WebSearchProviderId, priority: number): PersistedWebSearchProvider {
  return { id, enabled: false, priority };
}

function parseProvider(value: unknown): PersistedWebSearchProvider | undefined {
  const record = objectValue(value);
  if (
    typeof record.id !== 'string' ||
    !WEB_SEARCH_PROVIDER_IDS.includes(record.id as WebSearchProviderId)
  ) {
    return undefined;
  }
  const priority =
    typeof record.priority === 'number' && Number.isFinite(record.priority)
      ? Math.max(0, Math.trunc(record.priority))
      : WEB_SEARCH_PROVIDER_IDS.indexOf(record.id as WebSearchProviderId);
  return {
    id: record.id as WebSearchProviderId,
    enabled: record.enabled === true,
    priority,
    ...(stringValue(record.apiKeyHandle) ? { apiKeyHandle: stringValue(record.apiKeyHandle) } : {}),
    ...(stringValue(record.secretKeyHandle)
      ? { secretKeyHandle: stringValue(record.secretKeyHandle) }
      : {}),
    ...(stringValue(record.engineId) ? { engineId: stringValue(record.engineId) } : {}),
    ...(stringValue(record.endpoint) ? { endpoint: stringValue(record.endpoint) } : {}),
    ...(stringValue(record.updatedAt) ? { updatedAt: stringValue(record.updatedAt) } : {}),
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
