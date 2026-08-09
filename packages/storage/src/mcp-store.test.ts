import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { runMigrations } from './scripts/migrate.js';
import { SqliteMcpStore } from './mcp-store.js';
import {
  DEFAULT_CONVERSATION_AGENT_ID,
  SqliteAgentStore,
} from './agent-store.js';
import type { ModelId } from '@sync-think/shared';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-mcp-store-'));
  tempDirs.push(dir);
  return join(dir, 'sync-think.db');
}

async function openStores() {
  const dbPath = makeDbPath();
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  return {
    mcpStore: new SqliteMcpStore(connection.raw),
    agentStore: new SqliteAgentStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

describe('SqliteMcpStore', () => {
  it('registers an MCP server stub with tool schemas (no execution)', async () => {
    const { mcpStore, close } = await openStores();
    try {
      const server = mcpStore.register({
        name: 'filesystem',
        transport: 'local-stdio',
        endpoint: 'npx @modelcontextprotocol/server-filesystem',
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            inputSchemaJson: '{"type":"object","properties":{"path":{"type":"string"}}}',
          },
          { name: 'list_dir', description: 'List a directory' },
        ],
        trusted: false,
        notes: 'stub — register does not spawn',
        now: '2026-07-12T06:00:00.000Z',
      });
      expect(server.name).toBe('filesystem');
      expect(server.transport).toBe('local-stdio');
      expect(server.tools).toHaveLength(2);
      expect(server.tools[0]!.name).toBe('read_file');
      expect(server.trusted).toBe(false);
      expect(server.enabled).toBe(true);
      expect(server.maxOutputBytes).toBe(65536);
      expect(mcpStore.list()).toHaveLength(1);
      expect(mcpStore.get(server.id)?.id).toBe(server.id);
    } finally {
      close();
    }
  });

  it('persists enablement and lists only enabled MCP servers', async () => {
    const { mcpStore, close } = await openStores();
    try {
      const first = mcpStore.register({
        name: 'filesystem',
        endpoint: 'stdio://filesystem',
        tools: [{ name: 'read_file', description: 'Read a file' }],
      });
      const second = mcpStore.register({
        name: 'search',
        endpoint: 'stdio://search',
        tools: [{ name: 'search', description: 'Search' }],
      });

      expect(mcpStore.setEnabled(first.id, true)?.enabled).toBe(true);
      expect(mcpStore.setEnabled(second.id, false)?.enabled).toBe(false);
      expect(mcpStore.listEnabled().map((server) => server.id)).toEqual([first.id]);
      expect(mcpStore.get(second.id)?.enabled).toBe(false);

      expect(mcpStore.setEnabled(first.id, false)?.enabled).toBe(false);
      expect(mcpStore.listEnabled()).toEqual([]);
    } finally {
      close();
    }
  });

  it('updates same name+endpoint in place (stable id)', async () => {
    const { mcpStore, close } = await openStores();
    try {
      const a = mcpStore.register({
        name: 'search',
        endpoint: 'http://127.0.0.1:3100',
        transport: 'remote-http',
        tools: [{ name: 'search', description: 'v1' }],
      });
      const b = mcpStore.register({
        name: 'search',
        endpoint: 'http://127.0.0.1:3100',
        transport: 'remote-http',
        tools: [
          { name: 'search', description: 'v2' },
          { name: 'fetch', description: 'fetch url' },
        ],
        trusted: true,
      });
      expect(b.id).toBe(a.id);
      expect(b.tools).toHaveLength(2);
      expect(b.trusted).toBe(true);
      expect(mcpStore.list()).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('clamps maxOutputBytes / timeoutMs to policy floors and ceilings', async () => {
    const { mcpStore, close } = await openStores();
    try {
      const low = mcpStore.register({
        name: 'tiny-policy',
        endpoint: 'stdio://tiny',
        tools: [{ name: 'echo', description: 'echo' }],
        maxOutputBytes: 100,
        timeoutMs: 50,
      });
      expect(low.maxOutputBytes).toBe(256);
      expect(low.timeoutMs).toBe(100);

      const mid = mcpStore.register({
        name: 'mid-policy',
        endpoint: 'stdio://mid',
        tools: [{ name: 'echo', description: 'echo' }],
        maxOutputBytes: 512,
        timeoutMs: 5000,
      });
      expect(mid.maxOutputBytes).toBe(512);
      expect(mid.timeoutMs).toBe(5000);

      const high = mcpStore.register({
        name: 'huge-policy',
        endpoint: 'stdio://huge',
        tools: [{ name: 'echo', description: 'echo' }],
        maxOutputBytes: 99_999_999,
        timeoutMs: 999_999,
      });
      expect(high.maxOutputBytes).toBe(1_048_576);
      expect(high.timeoutMs).toBe(120_000);
    } finally {
      close();
    }
  });

  it('agent updateBinding can set mcpServerIds allowlist (new version)', async () => {
    const { mcpStore, agentStore, close } = await openStores();
    try {
      const server = mcpStore.register({
        name: 'tools',
        tools: [{ name: 'ping', description: 'pong' }],
      });
      agentStore.ensureConversationAgent({
        defaultModelId: 'model-a' as ModelId,
      });
      const updated = agentStore.updateBinding({
        agentId: DEFAULT_CONVERSATION_AGENT_ID,
        defaultModelId: 'model-a' as ModelId,
        fallbackModelIds: [],
        mcpServerIds: [server.id],
      });
      expect(updated.mcpServerIds).toEqual([server.id]);
      expect(updated.version).toBe(2);
    } finally {
      close();
    }
  });
});
