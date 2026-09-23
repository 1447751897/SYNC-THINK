export interface McpAuthConfig {
  key?: string;
  storeHandle?: string;
  authScheme: string;
}

export interface McpAuthConfigStatus {
  configured: boolean;
  authScheme: string;
}

export interface McpAuthSettingStore {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown): unknown;
}

function serverId(value: string): string {
  return String(value ?? '').trim();
}

function settingKey(id: string): string {
  return `mcp.auth.${id}`;
}

function authScheme(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'bearer';
}

function parseConfig(value: unknown): McpAuthConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const key = typeof record.key === 'string' ? record.key.trim() : '';
  const storeHandle = typeof record.storeHandle === 'string' ? record.storeHandle.trim() : '';
  if (!key && !storeHandle) return undefined;
  return key
    ? { key, authScheme: authScheme(record.authScheme) }
    : { storeHandle, authScheme: authScheme(record.authScheme) };
}

/** Read-through MCP auth configuration with legacy handle migration support. */
export class McpAuthConfigRepository {
  private readonly cache = new Map<string, McpAuthConfig>();

  constructor(private readonly settings?: McpAuthSettingStore) {}

  get(mcpServerId: string): McpAuthConfig | undefined {
    const id = serverId(mcpServerId);
    if (!id) return undefined;
    const cached = this.cache.get(id);
    if (cached) return { ...cached };
    const config = parseConfig(this.settings?.get(settingKey(id))?.value);
    if (!config) return undefined;
    this.cache.set(id, config);
    return { ...config };
  }

  savePlaintext(
    mcpServerId: string,
    key: string | undefined,
    requestedScheme: string | undefined,
  ): McpAuthConfigStatus {
    const id = serverId(mcpServerId);
    const previous = this.get(id);
    const normalizedKey = key?.trim() ?? '';
    if (!normalizedKey) {
      return {
        configured: Boolean(previous),
        authScheme: previous?.authScheme ?? authScheme(requestedScheme),
      };
    }
    const scheme = authScheme(requestedScheme ?? previous?.authScheme);
    const config = { key: normalizedKey, authScheme: scheme };
    this.settings?.set(settingKey(id), config);
    this.cache.set(id, config);
    return { configured: true, authScheme: scheme };
  }

  promoteLegacy(mcpServerId: string, key: string, scheme: string): void {
    const id = serverId(mcpServerId);
    const normalizedKey = key.trim();
    if (!id || !normalizedKey) return;
    const config = { key: normalizedKey, authScheme: authScheme(scheme) };
    this.cache.set(id, config);
    try {
      this.settings?.set(settingKey(id), config);
    } catch {
      // The in-memory value still lets this session display and use the key.
    }
  }

  clear(mcpServerId: string): void {
    const id = serverId(mcpServerId);
    if (!id) return;
    // The settings store has no delete; an empty record represents no config.
    this.settings?.set(settingKey(id), { key: '', authScheme: '' });
    this.cache.delete(id);
  }
}
