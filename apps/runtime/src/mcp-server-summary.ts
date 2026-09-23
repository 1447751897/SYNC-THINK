import type { McpServerSummary } from '@sync-think/protocol';
import type { McpServerRecord } from '@sync-think/storage';

export interface McpServerAuthSummaryInput {
  key?: string;
  authScheme: string;
}

export function toMcpServerSummary(
  record: McpServerRecord,
  auth?: McpServerAuthSummaryInput,
): McpServerSummary {
  return {
    mcpServerId: record.id,
    name: record.name,
    transport: record.transport,
    endpoint: record.endpoint,
    tools: record.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchemaJson: tool.inputSchemaJson,
    })),
    trusted: record.trusted,
    enabled: record.enabled,
    maxOutputBytes: record.maxOutputBytes,
    timeoutMs: record.timeoutMs,
    notes: record.notes,
    ...(auth
      ? {
          authConfigured: true,
          authScheme: auth.authScheme,
          ...(record.transport === 'remote-http' && auth.key ? { authKey: auth.key } : {}),
        }
      : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
