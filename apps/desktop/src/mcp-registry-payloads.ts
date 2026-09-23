import type {
  DeleteMcpServerPayload,
  ListMcpServersPayload,
  McpToolSchemaSummary,
  RegisterMcpServerPayload,
  RegisterRemoteMcpPayload,
  SetMcpServerEnabledPayload,
} from '@sync-think/protocol';
import { isRecord } from '@sync-think/shared/value-validation';

export function parseRegisterMcpServerPayload(value: unknown): RegisterMcpServerPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid register-mcp payload');
  const rec = value as Record<string, unknown>;
  if (typeof rec.name !== 'string' || rec.name.trim().length === 0) {
    throw new Error('Invalid register-mcp payload');
  }
  for (const key of ['key', 'apiKey'] as const) {
    if (rec[key] !== undefined && (typeof rec[key] !== 'string' || rec[key].length > 8192)) {
      throw new Error('Invalid register-mcp payload');
    }
  }
  if (
    typeof rec.key === 'string' &&
    typeof rec.apiKey === 'string' &&
    rec.key.trim() &&
    rec.apiKey.trim() &&
    rec.key.trim() !== rec.apiKey.trim()
  ) {
    throw new Error('Invalid register-mcp payload');
  }
  if (
    rec.authScheme !== undefined &&
    (typeof rec.authScheme !== 'string' || !rec.authScheme.trim() || rec.authScheme.length > 64)
  ) {
    throw new Error('Invalid register-mcp payload');
  }
  let tools: McpToolSchemaSummary[] | undefined;
  if (rec.tools !== undefined) {
    if (!Array.isArray(rec.tools)) throw new Error('Invalid register-mcp payload');
    tools = [];
    for (const t of rec.tools) {
      if (!t || typeof t !== 'object') throw new Error('Invalid register-mcp payload');
      const tool = t as Record<string, unknown>;
      if (typeof tool.name !== 'string' || !tool.name.trim()) {
        throw new Error('Invalid register-mcp payload');
      }
      tools.push({
        name: tool.name.trim(),
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchemaJson:
          typeof tool.inputSchemaJson === 'string' ? tool.inputSchemaJson : undefined,
      });
    }
  }
  return {
    name: rec.name.trim(),
    transport: typeof rec.transport === 'string' ? rec.transport : undefined,
    endpoint: typeof rec.endpoint === 'string' ? rec.endpoint : undefined,
    key: typeof rec.key === 'string' && rec.key.trim() ? rec.key.trim() : undefined,
    apiKey: typeof rec.apiKey === 'string' && rec.apiKey.trim() ? rec.apiKey.trim() : undefined,
    authScheme: typeof rec.authScheme === 'string' ? rec.authScheme.trim() : undefined,
    tools,
    trusted: typeof rec.trusted === 'boolean' ? rec.trusted : undefined,
    maxOutputBytes: typeof rec.maxOutputBytes === 'number' ? rec.maxOutputBytes : undefined,
    timeoutMs: typeof rec.timeoutMs === 'number' ? rec.timeoutMs : undefined,
    notes: typeof rec.notes === 'string' ? rec.notes : undefined,
  };
}

export function parseRegisterRemoteMcpPayload(value: unknown): RegisterRemoteMcpPayload {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Invalid register-remote-mcp payload');
  }
  if (typeof value.endpoint !== 'string' || !value.endpoint.trim()) {
    throw new Error('Invalid register-remote-mcp payload: endpoint required');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint.trim());
  } catch {
    throw new Error('Invalid register-remote-mcp payload: endpoint URL required');
  }
  if (
    (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error('Invalid register-remote-mcp payload: only http(s) URLs are supported');
  }
  for (const key of ['key', 'apiKey'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 8192)) {
      throw new Error('Invalid register-remote-mcp payload');
    }
  }
  if (
    value.authScheme !== undefined &&
    (typeof value.authScheme !== 'string' ||
      !value.authScheme.trim() ||
      value.authScheme.length > 64)
  ) {
    throw new Error('Invalid register-remote-mcp payload');
  }
  if (value.discoverTools !== undefined && typeof value.discoverTools !== 'boolean') {
    throw new Error('Invalid register-remote-mcp payload');
  }
  const key =
    typeof value.key === 'string' && value.key.trim()
      ? value.key.trim()
      : typeof value.apiKey === 'string' && value.apiKey.trim()
        ? value.apiKey.trim()
        : undefined;
  if (
    value.key !== undefined &&
    value.apiKey !== undefined &&
    typeof value.key === 'string' &&
    typeof value.apiKey === 'string' &&
    value.key.trim() &&
    value.apiKey.trim() &&
    value.key.trim() !== value.apiKey.trim()
  ) {
    throw new Error('Invalid register-remote-mcp payload');
  }
  return {
    name: value.name.trim(),
    endpoint: endpoint.toString(),
    ...(key ? { key } : {}),
    ...(typeof value.apiKey === 'string' && value.apiKey.trim()
      ? { apiKey: value.apiKey.trim() }
      : {}),
    authScheme: typeof value.authScheme === 'string' ? value.authScheme.trim() : undefined,
    discoverTools: value.discoverTools as boolean | undefined,
    tools: Array.isArray(value.tools)
      ? (value.tools as RegisterRemoteMcpPayload['tools'])
      : undefined,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  };
}

export function parseListMcpServersPayload(value: unknown): ListMcpServersPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new Error('Invalid list-mcp payload');
  const rec = value as Record<string, unknown>;
  if (rec.limit !== undefined && (typeof rec.limit !== 'number' || !Number.isFinite(rec.limit))) {
    throw new Error('Invalid list-mcp payload');
  }
  return { limit: rec.limit as number | undefined };
}

export function parseSetMcpServerEnabledPayload(value: unknown): SetMcpServerEnabledPayload {
  if (
    !isRecord(value) ||
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0 ||
    typeof value.enabled !== 'boolean'
  ) {
    throw new Error('Invalid set-mcp-enabled payload');
  }
  return { mcpServerId: value.mcpServerId.trim(), enabled: value.enabled };
}

export function parseDeleteMcpServerPayload(value: unknown): DeleteMcpServerPayload {
  if (
    !isRecord(value) ||
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0
  ) {
    throw new Error('Invalid delete-mcp-server payload');
  }
  return { mcpServerId: value.mcpServerId.trim() };
}
