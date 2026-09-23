import { describe, expect, it } from 'vitest';
import type { McpServerId } from '@sync-think/shared';
import type { McpServerRecord } from '@sync-think/storage';
import { toMcpServerSummary } from './mcp-server-summary.js';

const record: McpServerRecord = {
  id: 'mcp-fixture' as McpServerId,
  name: 'Fixture MCP',
  transport: 'remote-http',
  endpoint: 'https://mcp.example.test',
  tools: [
    {
      name: 'read_fixture',
      description: 'Read fixture data',
      readOnly: true,
      inputSchemaJson: '{"type":"object"}',
    },
  ],
  trusted: true,
  enabled: true,
  maxOutputBytes: 4096,
  timeoutMs: 30_000,
  notes: 'Fixture',
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T01:00:00.000Z',
};

describe('MCP server summary', () => {
  it('projects public fields without sharing tool objects', () => {
    const summary = toMcpServerSummary(record);

    summary.tools[0]!.description = 'mutated';
    expect(record.tools[0]!.description).toBe('Read fixture data');
    expect(summary).toMatchObject({
      mcpServerId: record.id,
      name: record.name,
      enabled: true,
    });
    expect(summary).not.toHaveProperty('authConfigured');
  });

  it('projects a remote authentication snapshot including its current key', () => {
    expect(toMcpServerSummary(record, { key: 'secret', authScheme: 'api-key' })).toMatchObject({
      authConfigured: true,
      authScheme: 'api-key',
      authKey: 'secret',
    });
  });

  it('does not expose an authentication key for a local stdio server', () => {
    const summary = toMcpServerSummary(
      { ...record, transport: 'local-stdio' },
      { key: 'secret', authScheme: 'bearer' },
    );

    expect(summary).toMatchObject({ authConfigured: true, authScheme: 'bearer' });
    expect(summary).not.toHaveProperty('authKey');
  });
});
