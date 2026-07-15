import { describe, expect, it } from 'vitest';
import {
  encodeJsonRpcMessage,
  extractToolCallText,
  extractToolsList,
  isJsonRpcResponse,
  JsonRpcStdioParser,
} from './jsonrpc-stdio.js';

describe('jsonrpc-stdio', () => {
  it('encodes Content-Length frame', () => {
    const buf = encodeJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const text = buf.toString('utf8');
    expect(text).toMatch(/^Content-Length: \d+\r\n\r\n/);
    expect(text).toContain('"method":"ping"');
  });

  it('parses framed messages', () => {
    const parser = new JsonRpcStdioParser();
    const msg = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    const frame = encodeJsonRpcMessage(msg);
    const out = parser.push(frame);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(msg);
  });

  it('extracts MCP tool content text', () => {
    expect(
      extractToolCallText({ content: [{ type: 'text', text: 'PONG' }], isError: false }),
    ).toBe('PONG');
  });

  it('detects responses', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', method: 'x' })).toBe(false);
  });

  it('extracts tools/list catalog with schema bounds', () => {
    const tools = extractToolsList({
      tools: [
        {
          name: 'echo',
          description: 'Echo',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
        { name: '', description: 'skip empty' },
        { name: 'ping', description: 'Ping' },
      ],
    });
    expect(tools).toHaveLength(2);
    expect(tools[0]!.name).toBe('echo');
    expect(tools[0]!.inputSchemaJson).toMatch(/text/);
    expect(tools[1]!.name).toBe('ping');
  });
});
