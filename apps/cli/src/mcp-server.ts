import { createInterface } from 'node:readline';
import {
  APPLICATION_TOOL_DEFINITIONS,
  getApplicationToolDefinition,
  type CommandType,
} from '@sync-think/protocol';
import { RuntimeCommandClient } from './runtime-command-client.js';

export interface SyncThinkMcpOptions {
  installId: string;
  helloSecret?: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface RuntimeCommandRequester {
  request(
    type: CommandType,
    payload: unknown,
    options?: { confirmationToken?: string },
  ): Promise<unknown>;
}

const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

function parseRequest(line: string): JsonRpcRequest {
  const value = JSON.parse(line) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON-RPC message must be an object');
  }
  const request = value as Partial<JsonRpcRequest>;
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    throw new Error('Invalid JSON-RPC request');
  }
  return request as JsonRpcRequest;
}

function writeResponse(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function errorResponse(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function requestedProtocolVersion(params: Record<string, unknown> | undefined): string {
  const requested = params?.protocolVersion;
  if (typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.has(requested)) return requested;
  return '2025-06-18';
}

async function handleRequest(
  request: JsonRpcRequest,
  client: RuntimeCommandRequester,
): Promise<JsonRpcResponse | undefined> {
  const id = request.id ?? null;
  if (
    request.method === 'notifications/initialized' ||
    request.method === 'notifications/cancelled'
  ) {
    return undefined;
  }
  if (request.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: requestedProtocolVersion(request.params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'sync-think', version: '0.0.1' },
        instructions: 'Operate the local SYNC-THINK workspace through its Runtime command gateway.',
      },
    };
  }
  if (request.method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }
  if (request.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: APPLICATION_TOOL_DEFINITIONS.map((definition) => ({
          name: definition.name,
          description: definition.description,
          inputSchema: {
            ...definition.inputSchema,
            properties: {
              ...definition.inputSchema.properties,
              _confirmationToken: {
                type: 'string',
                description:
                  'Single-use token returned by the first preview call for configuration changes.',
              },
            },
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint:
              definition.confirmation === 'none' &&
              definition.outputSensitivity === 'metadata-only',
            destructiveHint: definition.confirmation === 'configuration',
          },
        })),
      },
    };
  }
  if (request.method === 'tools/call') {
    const name = request.params?.name;
    const definition = typeof name === 'string' ? getApplicationToolDefinition(name) : undefined;
    if (!definition) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Unknown SYNC-THINK tool: ${String(name ?? '')}` }],
        },
      };
    }
    const args = request.params?.arguments;
    const argumentRecord =
      args && typeof args === 'object' && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : {};
    const { _confirmationToken, ...payload } = argumentRecord;
    if (
      _confirmationToken !== undefined &&
      (typeof _confirmationToken !== 'string' || _confirmationToken.trim().length === 0)
    ) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: '_confirmationToken must be a non-empty string' }],
        },
      };
    }
    try {
      const result = await client.request(
        definition.command,
        payload,
        typeof _confirmationToken === 'string'
          ? { confirmationToken: _confirmationToken.trim() }
          : {},
      );
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        },
      };
    }
  }
  if (request.id === undefined) return undefined;
  return errorResponse(id, -32601, `Method not found: ${request.method}`);
}

export async function runSyncThinkMcpServer(options: SyncThinkMcpOptions): Promise<void> {
  const client = new RuntimeCommandClient({
    installId: options.installId,
    appVersion: 'sync-think-mcp/0.0.1',
    helloSecret: options.helloSecret,
    callerSurface: 'mcp',
  });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const shutdown = () => input.close();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    for await (const line of input) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, 'utf8') > 1_048_576) {
        writeResponse(errorResponse(null, -32600, 'MCP message exceeds 1 MiB'));
        continue;
      }
      let request: JsonRpcRequest;
      try {
        request = parseRequest(line);
      } catch (error) {
        writeResponse(
          errorResponse(
            null,
            -32700,
            'Parse error',
            error instanceof Error ? error.message : String(error),
          ),
        );
        continue;
      }
      try {
        const response = await handleRequest(request, client);
        if (response) writeResponse(response);
      } catch (error) {
        if (request.id !== undefined) {
          writeResponse(
            errorResponse(
              request.id,
              -32603,
              'Internal error',
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      }
    }
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    client.close();
  }
}

export const mcpTestApi = {
  parseRequest,
  requestedProtocolVersion,
  handleRequest,
};
