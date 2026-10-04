import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerRecord, SqliteMcpStore } from '@sync-think/storage';
import { Runtime } from './runtime.js';
import type { DemoRunState } from './demo-run.js';

function server(id: string, name: string, count: number, enabled = true): McpServerRecord {
  return {
    id: id as McpServerRecord['id'], name, enabled, transport: 'local-stdio',
    endpoint: JSON.stringify({ command: 'fixture', args: [], env: { TOKEN: 'private-fixture' } }),
    tools: Array.from({ length: count }, (_, index) => ({ name: `tool-${index}`, description: 'Fixture tool' })),
    trusted: true, maxOutputBytes: 65536, timeoutMs: 15000, notes: 'Private configuration',
    createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z',
  };
}

const runtimes: Runtime[] = [];
function fixture(records?: McpServerRecord[]) {
  const store = records ? {
    list: vi.fn(() => records),
    get: vi.fn((id: string) => records.find((record) => record.id === id)),
    setEnabled: vi.fn(),
  } : undefined;
  const runtime = new Runtime({ installId: 'mcp-discovery-test', allowNoToken: true, mcpStore: store as unknown as SqliteMcpStore });
  runtimes.push(runtime);
  return {
    store,
    query(ids: string[] = []) {
      const run = { mcpServerIds: ids } as unknown as DemoRunState;
      const result = (runtime as unknown as { executeChatMcpCatalogTool(run: DemoRunState): string }).executeChatMcpCatalogTool(run);
      return { run, result, catalog: JSON.parse(result) };
    },
  };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
});

describe('MCP discovery registry versus current-run bindings', () => {
  it('reports four enabled entries while preserving the one-server current-run allowlist', () => {
    const records = [server('context7', 'Context7', 2), server('boardui-a', 'BoardUI', 13), server('boardui-b', 'BoardUI', 13), server('github', 'GitHub', 0)];
    const { query, store } = fixture(records);
    const ids = ['context7'];
    const { catalog, run, result } = query(ids);
    expect(catalog).toMatchObject({ scope: 'current-run', registeredServerCount: 4, enabledServerCount: 4, serverCount: 1, toolCount: 2 });
    expect(catalog.servers.map((record: { mcpServerId: string }) => record.mcpServerId)).toEqual(['context7']);
    expect(catalog.registeredServers.filter((record: { name: string }) => record.name === 'BoardUI')).toHaveLength(2);
    expect(catalog.registeredServers.find((record: { mcpServerId: string }) => record.mcpServerId === 'boardui-a')).toMatchObject({ boundToCurrentRun: false, registeredToolCount: 13, reasons: ['not-bound-to-current-run'] });
    expect(catalog.registeredServers.find((record: { mcpServerId: string }) => record.mcpServerId === 'github')).toMatchObject({ registeredToolCount: 0, reasons: ['not-bound-to-current-run', 'no-registered-tools'] });
    expect(catalog.scopeNote).toContain('do not prove a live connection');
    expect(run.mcpServerIds).toBe(ids);
    expect(ids).toEqual(['context7']);
    expect(store!.setEnabled).not.toHaveBeenCalled();
    expect(result).not.toContain('private-fixture');
    expect(result).not.toContain('Private configuration');
    expect(store!.list).toHaveBeenCalledWith(500);
  });

  it('distinguishes disabled bound servers, enabled unbound servers, and missing tools', () => {
    const { catalog } = fixture([server('off', 'Off', 3, false), server('unbound', 'Unbound', 5), server('empty', 'Empty', 0)]).query(['off', 'empty', 'deleted']);
    expect(catalog).toMatchObject({ registeredServerCount: 3, enabledServerCount: 2, serverCount: 1, toolCount: 0 });
    expect(catalog.registeredServers).toEqual(expect.arrayContaining([
      expect.objectContaining({ mcpServerId: 'off', boundToCurrentRun: true, reasons: ['disabled'] }),
      expect.objectContaining({ mcpServerId: 'unbound', reasons: ['not-bound-to-current-run'] }),
      expect.objectContaining({ mcpServerId: 'empty', boundToCurrentRun: true, reasons: ['no-registered-tools'] }),
    ]));
  });

  it('does not confuse an empty current-run binding with an empty global registry', () => {
    const { catalog } = fixture([server('boardui', 'BoardUI', 13)]).query();
    expect(catalog).toMatchObject({ catalogState: 'no-enabled-servers-bound-to-current-run', registeredServerCount: 1, enabledServerCount: 1, serverCount: 0, toolCount: 0, servers: [] });
  });

  it('returns explicit zero inventory counts when storage is absent', () => {
    const { catalog } = fixture().query(['context7']);
    expect(catalog).toMatchObject({ catalogState: 'store-unavailable', scope: 'current-run', registeredServerCount: 0, enabledServerCount: 0, registeredServers: [], servers: [], serverCount: 0, toolCount: 0 });
  });

  it('reads fresh registry toggles on each lookup without granting newly added services', () => {
    const records = [server('bound', 'Bound', 2)];
    const { query } = fixture(records);
    expect(query(['bound']).catalog.enabledServerCount).toBe(1);
    records.push(server('new', 'New', 13));
    records[0]!.enabled = false;
    const { catalog } = query(['bound']);
    expect(catalog).toMatchObject({ registeredServerCount: 2, enabledServerCount: 1, serverCount: 0 });
    expect(catalog.registeredServers.find((record: { mcpServerId: string }) => record.mcpServerId === 'new').boundToCurrentRun).toBe(false);
  });
});
