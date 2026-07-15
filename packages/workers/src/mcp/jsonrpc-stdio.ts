/**
 * MCP JSON-RPC over stdio (Content-Length framing, MCP-compatible subset).
 * Used by LocalStdioMcpWorker for real tools/call and tools/list after authz gates.
 *
 * Security: treat all server content as untrusted; size-limit and timeout enforced by caller.
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number | string | null;
  result: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure | Record<string, unknown>;

export interface McpDiscoveredTool {
  name: string;
  description: string;
  /** Opaque JSON schema string; never executed. */
  inputSchemaJson?: string;
}

export function encodeJsonRpcMessage(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  return Buffer.concat([header, body]);
}

/**
 * Incremental Content-Length frame parser.
 * Returns complete JSON message objects as they arrive.
 */
export class JsonRpcStdioParser {
  private buffer = Buffer.alloc(0);
  private maxMessageBytes: number;

  constructor(maxMessageBytes = 1_048_576) {
    this.maxMessageBytes = Math.max(256, maxMessageBytes);
  }

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: unknown[] = [];
    while (true) {
      const headerEnd = indexOfCrLfCrLf(this.buffer);
      if (headerEnd < 0) {
        // Guard unbounded header growth
        if (this.buffer.length > 16_384) {
          throw new Error('JSON-RPC header exceeds 16KB without terminator');
        }
        break;
      }
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        // Skip garbage line / advance past this header block
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      if (!Number.isFinite(len) || len < 0) {
        throw new Error('Invalid Content-Length');
      }
      if (len > this.maxMessageBytes) {
        throw new Error(
          `JSON-RPC message ${len}B exceeds max ${this.maxMessageBytes}B`,
        );
      }
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + len) break;
      const body = this.buffer.subarray(bodyStart, bodyStart + len).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + len);
      out.push(JSON.parse(body));
    }
    return out;
  }
}

function indexOfCrLfCrLf(buf: Buffer): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (
      buf[i] === 13 &&
      buf[i + 1] === 10 &&
      buf[i + 2] === 13 &&
      buf[i + 3] === 10
    ) {
      return i;
    }
  }
  return -1;
}

export function isJsonRpcResponse(msg: unknown): msg is JsonRpcSuccess | JsonRpcFailure {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return 'id' in m && ('result' in m || 'error' in m);
}

export function extractToolCallText(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result !== 'object') return String(result);
  const r = result as Record<string, unknown>;
  // MCP tools/call result shape: { content: [{type:'text', text}], isError? }
  if (Array.isArray(r.content)) {
    const parts: string[] = [];
    for (const item of r.content) {
      if (item && typeof item === 'object') {
        const it = item as Record<string, unknown>;
        if (typeof it.text === 'string') parts.push(it.text);
        else parts.push(JSON.stringify(item));
      } else {
        parts.push(String(item));
      }
    }
    const joined = parts.join('\n');
    if (r.isError === true) return `[isError] ${joined}`;
    return joined;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * Parse tools/list result into a size-bounded tool catalog.
 * All fields treated as untrusted metadata (never executed).
 */
export function extractToolsList(
  result: unknown,
  options?: { maxTools?: number; maxSchemaBytes?: number },
): McpDiscoveredTool[] {
  const maxTools = Math.max(1, Math.min(200, options?.maxTools ?? 64));
  const maxSchemaBytes = Math.max(256, Math.min(65_536, options?.maxSchemaBytes ?? 16_384));
  if (!result || typeof result !== 'object') return [];
  const toolsRaw = (result as { tools?: unknown }).tools;
  if (!Array.isArray(toolsRaw)) return [];
  const out: McpDiscoveredTool[] = [];
  for (const item of toolsRaw) {
    if (out.length >= maxTools) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name || name.length > 256) continue;
    const description =
      typeof rec.description === 'string' ? rec.description.trim().slice(0, 2000) : '';
    let inputSchemaJson: string | undefined;
    if (typeof rec.inputSchema === 'object' && rec.inputSchema !== null) {
      try {
        const json = JSON.stringify(rec.inputSchema);
        if (json.length <= maxSchemaBytes) inputSchemaJson = json;
        else inputSchemaJson = json.slice(0, maxSchemaBytes);
      } catch {
        // ignore bad schema
      }
    } else if (typeof rec.inputSchemaJson === 'string' && rec.inputSchemaJson.length <= maxSchemaBytes) {
      inputSchemaJson = rec.inputSchemaJson;
    }
    out.push({ name, description, inputSchemaJson });
  }
  return out;
}
