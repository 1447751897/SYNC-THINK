import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { McpServerRecord, SqliteAgentStore, SqliteMcpStore } from '@sync-think/storage';
import type { RunId } from '@sync-think/shared';
import type { ProviderCallRequest, ProviderAdapter } from '@sync-think/adapters';
import { Runtime } from './runtime.js';
import { createDemoRun, type DemoRunState } from './demo-run.js';
import type { ContextSnapshot } from './context-snapshot.js';

function server(id: string, count = 1, enabled = true): McpServerRecord {
  return {
    id: id as McpServerRecord['id'], name: id, enabled, transport: 'local-stdio',
    endpoint: JSON.stringify({ command: 'fixture', args: [] }),
    tools: Array.from({ length: count }, (_, index) => ({ name: `tool-${index}`, description: 'Fixture tool', inputSchemaJson: '{"type":"object","properties":{}}' })),
    trusted: true, maxOutputBytes: 65536, timeoutMs: 15000, notes: '',
    createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z',
  };
}
interface Probe {
  prepareRunBinding(input: { runId: RunId; threadId: string; userText: string; track?: 'model' | 'agent' | 'team' }): { run: DemoRunState };
  resolveMcpServerIdsForRun(run: DemoRunState): string[];
  executeChatMcpCatalogTool(run: DemoRunState): string;
  buildDefaultProviderContextSnapshot(run: DemoRunState, options: { toolsEnabled: boolean; messages: []; toolAllowlist?: string[] }): ContextSnapshot;
  openProviderStream(run: DemoRunState, options: { toolsEnabled: boolean; messages: [] }): Promise<AsyncIterable<unknown> | undefined>;
  executeChatBoundMcpToolUnchecked(input: { run: DemoRunState; mcpServerId: string; toolName: string; toolCallId: string; argumentsJson?: string }): Promise<string>;
  scheduledAutomationThreads: Map<string, unknown>;
  collaborationThreadScopes: Map<string, unknown>;
}
const runtimes: Runtime[] = [];
function fixture(records: McpServerRecord[], agentStore?: SqliteAgentStore, demoProvider?: ProviderAdapter) {
  const store = {
    list: vi.fn(() => records),
    listEnabled: vi.fn(() => records.filter(record => record.enabled)),
    get: vi.fn((id: string) => records.find(record => record.id === id)),
    recordCall: vi.fn(),
  };
  const runtime = new Runtime({ installId: 'mcp-access-test', allowNoToken: true, mcpStore: store as unknown as SqliteMcpStore, agentStore, demoProvider });
  runtimes.push(runtime);
  const probe = runtime as unknown as Probe;
  const run = createDemoRun('mcp-access-run' as RunId, 'mcp-access-thread', 'Inspect MCP access', { track: 'model', mcpServerIds: ['context7'] });
  return { records, store, runtime, probe, run, schemas: () => probe.buildDefaultProviderContextSnapshot(run, { toolsEnabled: true, messages: [] }).providerRequest.tools?.filter(tool => tool.name.startsWith('mcp__')) ?? [], catalog: () => JSON.parse(probe.executeChatMcpCatalogTool(run)) };
}
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.stop(); });

describe('ordinary chat global MCP access versus scoped allowlists', () => {
  it('prepares a new ordinary chat with every enabled, discovered server', () => {
    const f = fixture([server('context7', 2), server('boardui-a', 13), server('boardui-b', 13), server('github', 0), server('off', 1, false)]);
    const prepared = f.probe.prepareRunBinding({ runId: 'prepared-run' as RunId, threadId: 'prepared-thread', userText: 'hello' });
    expect(prepared.run.track).toBe('model');
    expect(prepared.run.mcpServerIds).toEqual(['context7', 'boardui-a', 'boardui-b']);
  });

  it('replaces the stale one-server default binding and exposes all 28 tools', () => {
    const f = fixture([server('context7', 2), server('boardui-a', 13), server('boardui-b', 13), server('github', 0)]);
    expect(f.schemas()).toHaveLength(28);
    expect(f.run.mcpServerIds).toEqual(['context7', 'boardui-a', 'boardui-b']);
    expect(f.catalog()).toMatchObject({ accessMode: 'global-enabled', registeredServerCount: 4, enabledServerCount: 4, serverCount: 3, toolCount: 28 });
    expect(f.catalog().registeredServers.find((row: { mcpServerId: string }) => row.mcpServerId === 'github').reasons).toEqual(['no-registered-tools']);
    expect(new Set(f.schemas().map(tool => tool.name)).size).toBe(28);
  });

  it('resolves the persisted default Conversation version by its owner, not its version ID', () => {
    const agentStore = { getVersion: vi.fn((id: string) => ({ id, agentId: id === 'default-v1' ? 'agent-default-conversation' : 'custom-agent' })) } as unknown as SqliteAgentStore;
    const f = fixture([server('context7'), server('boardui')], agentStore);
    f.run.agentVersionId = 'default-v1';
    expect(f.probe.resolveMcpServerIdsForRun(f.run)).toEqual(['context7', 'boardui']);
    f.run.agentVersionId = 'custom-v1';
    expect(f.probe.resolveMcpServerIdsForRun(f.run)).toEqual(['context7']);
  });

  it.each([
    { track: 'agent' as const }, { track: 'team' as const }, { globalAgentId: 'custom-agent' },
    { teamId: 'team-id' }, { delegationParentRunId: 'parent-run' as RunId }, { delegatedReadOnly: true },
    { agentVersionId: 'custom-version' }, { track: undefined },
  ])('retains an explicit empty scoped allowlist: %j', patch => {
    const f = fixture([server('boardui')]); Object.assign(f.run, patch, { mcpServerIds: [] });
    expect(f.schemas()).toEqual([]);
    expect(f.catalog()).toMatchObject({ accessMode: 'agent-allowlist', serverCount: 0 });
  });

  it.each(['collaborationThreadScopes', 'scheduledAutomationThreads'] as const)('does not broaden %s model tasks', scope => {
    const f = fixture([server('context7'), server('boardui')]);
    f.probe[scope].set(f.run.threadId, {});
    expect(f.probe.resolveMcpServerIdsForRun(f.run)).toEqual(['context7']);
    expect(f.catalog().accessMode).toBe('agent-allowlist');
  });

  it('refreshes existing chats on add, disable, and re-enable without mutating registry', () => {
    const f = fixture([server('context7')]);
    expect(f.schemas()).toHaveLength(1);
    f.records.push(server('new', 3)); f.records[0]!.enabled = false;
    expect(f.schemas()).toHaveLength(3); expect(f.run.mcpServerIds).toEqual(['new']);
    f.records[0]!.enabled = true;
    expect(f.schemas()).toHaveLength(4); expect(f.catalog().serverCount).toBe(2);
  });

  it('respects tools-disabled requests and an explicit tool allowlist', () => {
    const f = fixture([server('context7'), server('boardui')]);
    expect(f.probe.buildDefaultProviderContextSnapshot(f.run, { toolsEnabled: false, messages: [] }).providerRequest.tools?.some(tool => tool.name.startsWith('mcp__')) ?? false).toBe(false);
    const selected = f.schemas()[0]!.name;
    const snapshot = f.probe.buildDefaultProviderContextSnapshot(f.run, { toolsEnabled: true, messages: [], toolAllowlist: [selected] });
    expect(snapshot.providerRequest.tools?.map(tool => tool.name)).toEqual([selected]);
  });

  it('uses the same 28-tool policy in the native streaming provider path', async () => {
    const requests: ProviderCallRequest[] = [];
    const provider: ProviderAdapter = { protocol: 'openai-chat', discoverModels: async () => [], call: async function* (request: ProviderCallRequest) { requests.push(request); yield { type: 'finished' as const, reason: 'stop' as const }; } };
    const f = fixture([server('context7', 2), server('boardui-a', 13), server('boardui-b', 13)], undefined, provider);
    const stream = await f.probe.openProviderStream(f.run, { toolsEnabled: true, messages: [] });
    expect(stream).toBeDefined(); for await (const _event of stream!) { /* consume */ }
    expect(requests[0]?.tools?.filter(tool => tool.name.startsWith('mcp__'))).toHaveLength(28);
  });

  it('calls a newly enabled stdio server without extra binding and blocks it after disabling', async () => {
    const row = server('local-fixture');
    row.endpoint = JSON.stringify({ command: 'node', args: [fileURLToPath(new URL('../../../packages/workers/src/mcp/fixtures/mini-mcp-server.mjs', import.meta.url))] });
    row.tools = [{ name: 'echo', description: 'Read-only echo fixture', readOnly: true, inputSchemaJson: '{"type":"object","properties":{"text":{"type":"string"}}}' }];
    const f = fixture([row]); f.run.mcpServerIds = [];
    const call = { run: f.run, mcpServerId: row.id, toolName: 'echo', toolCallId: 'fixture-call', argumentsJson: '{"text":"MCP_AUTO_ACCESS_OK"}' };
    const result = JSON.parse(await f.probe.executeChatBoundMcpToolUnchecked(call));
    expect(result.ok).toBe(true); expect(JSON.stringify(result.result)).toContain('MCP_AUTO_ACCESS_OK');
    row.enabled = false;
    expect(JSON.parse(await f.probe.executeChatBoundMcpToolUnchecked(call)).ok).toBe(false);
    row.enabled = true; f.run.track = 'agent';
    expect(JSON.parse(await f.probe.executeChatBoundMcpToolUnchecked(call)).ok).toBe(false);
  });
});
