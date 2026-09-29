import { describe, expect, it } from 'vitest';
import {
  encodeJsonRpcMessage,
  extractToolCallText,
  extractToolsList,
  isJsonRpcResponse,
  JsonRpcStdioParser,
} from './jsonrpc-stdio.js';

describe('jsonrpc-stdio', () => {
  it('encodes MCP newline-delimited JSON', () => {
    const buf = encodeJsonRpcMessage({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const text = buf.toString('utf8');
    expect(text).toBe(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
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

  it('accepts legacy Content-Length responses', () => {
    const message = { jsonrpc: '2.0', id: 2, result: {} };
    const body = JSON.stringify(message);
    expect(new JsonRpcStdioParser().push(Buffer.from('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body))).toEqual([message]);
  });

  it('handles fragmented UTF-8, CRLF, blank lines and multiple messages', () => {
    const message = { jsonrpc: '2.0', id: 1, result: '你好' };
    const frame = Buffer.from(JSON.stringify(message) + '\r\n\n' + JSON.stringify(message) + '\n');
    const parser = new JsonRpcStdioParser();
    const out = [...frame].flatMap(byte => parser.push(Buffer.from([byte])));
    expect(out).toEqual([message, message]);
  });

  it('bounds complete and unterminated newline messages', () => {
    for (const suffix of ['', '\n']) {
      expect(() => new JsonRpcStdioParser(256).push(Buffer.from('{' + ' '.repeat(256) + suffix))).toThrow(/exceeds/);
    }
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

  it('preserves explicit readOnly metadata from tools/list', () => {
    const tools = extractToolsList({
      tools: [{ name: 'inspect', description: 'Inspect', readOnly: true }, { name: 'write' }],
    });
    expect(tools[0]).toMatchObject({ name: 'inspect', readOnly: true });
    expect(tools[1]).not.toHaveProperty('readOnly');
  });
});
