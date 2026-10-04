import { describe, expect, it } from 'vitest';
import { parseMcpImport, stdioConfig, isManagedMcpServer } from './mcp-config.js';
import type { McpServerSummary } from '@sync-think/protocol';
describe('MCP config import', () => {
  it('preserves structured stdio args and env without a shell command round trip', () => {
    const value = parseMcpImport(
      JSON.stringify({
        mcpServers: {
          boardui: {
            command: 'npx',
            args: ['-y', 'boardui@latest', 'mcp', 'with spaces'],
            env: { MODE: 'qa' },
            disabled: true,
            description: '组件库',
          },
        },
      }),
    )[0]!;
    expect(value).toMatchObject({
      name: 'boardui',
      transport: 'local-stdio',
      notes: '组件库',
      enabled: false,
    });
    expect(stdioConfig(value.endpoint)).toEqual({
      command: 'npx',
      args: ['-y', 'boardui@latest', 'mcp', 'with spaces'],
      env: { MODE: 'qa' },
    });
  });
  it('imports HTTP credentials separately from the endpoint', () => {
    const value = parseMcpImport(
      '{"mcpServers":{"api":{"url":"https://example.com/mcp","headers":{"Authorization":"Bearer SECRET"}}}}',
    )[0]!;
    expect(value).toMatchObject({
      transport: 'remote-http',
      endpoint: 'https://example.com/mcp',
      key: 'SECRET',
      authScheme: 'bearer',
    });
  });
  it.each([
    '{}',
    '{"mcpServers":[]}',
    '{"mcpServers":{}}',
    '{"mcpServers":{"a":{"command":"node","args":[5]}}}',
    '{"mcpServers":{"a":{"command":"node","env":{"BAD KEY":"x"}}}}',
    '{"mcpServers":{"a":{"url":"file:///foo"}}}',
    '{"mcpServers":{"a":{"url":"https://example.com/mcp","headers":{"X-Unsupported":"x"}}}}',
    '{"mcpServers":{"a":{"type":"sse","url":"https://example.com/sse"}}}',
  ])('rejects invalid or unsupported config before any writes: %s', (text) =>
    expect(() => parseMcpImport(text)).toThrow(),
  );
  it('recognizes managed adapters by explicit provenance, never by a platform-looking name', () => {
    expect(isManagedMcpServer({ name: 'GitHub', notes: '' } as McpServerSummary)).toBe(false);
    expect(isManagedMcpServer({ notes: 'SYNC-THINK connector: douyin' } as McpServerSummary)).toBe(
      true,
    );
  });
  it('does not crash the card when an old structured endpoint is malformed', () =>
    expect(stdioConfig('{bad')).toEqual({ command: '{bad', args: [] }));
});
