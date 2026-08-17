import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPlatformMcpToolDefinitions,
  executePlatformTool,
  resolveWithinWorkspace,
} from './platform-tools.js';
import {
  buildClaudeMcpConfigJson,
  buildCodexMcpConfigArgs,
  PLATFORM_MCP_SERVER_NAME,
} from './platform-mcp-config.js';
import type { PlatformBrokerInfo } from '@sync-think/shared';

function makeBroker(overrides: Partial<PlatformBrokerInfo> = {}): PlatformBrokerInfo {
  return {
    host: '127.0.0.1',
    port: 49152,
    token: 'test-token-abc',
    workspaceDir: 'C:/workspace',
    command: 'C:/node/node.exe',
    args: ['D:/sync-think/apps/mcp-server/platform-mcp-server.mjs'],
    ...overrides,
  };
}

describe('platform tools', () => {
  it('builds a per-run catalog from authoritative chat schemas and approval rules', () => {
    const definitions = buildPlatformMcpToolDefinitions({
      executionMode: 'workspace',
      networkEnabled: true,
      includeAgentTools: true,
      includeBrowserTools: true,
      includeDesktopTools: true,
      includeTaskTools: true,
      includeMcpTools: true,
      includeSkillTools: true,
      includeTeamTools: true,
    });
    const byName = new Map(definitions.map((definition) => [definition.name, definition]));
    expect(byName.has('create_agent')).toBe(true);
    expect(byName.has('browser_open')).toBe(true);
    expect(byName.has('desktop_list_windows')).toBe(true);
    expect(byName.get('create_agent')?.approval).toBe('outside-full-access');
    expect(byName.get('file_write')?.approval).toBe('ask-mode');
    expect(byName.get('list_skills')?.inputSchema).toBeDefined();
  });

  it('does not expose optional tools when their run capabilities are disabled', () => {
    const names = buildPlatformMcpToolDefinitions().map((definition) => definition.name);
    expect(names).toEqual(
      expect.arrayContaining(['platform_context', 'file_read', 'file_write', 'task_list', 'agent_list']),
    );
    expect(names).not.toContain('browser_open');
    expect(names).not.toContain('desktop_list_windows');
    expect(names).not.toContain('create_agent');
  });

  it('exposes browser tools only when 联网 is enabled, even if includeBrowserTools is set', () => {
    const names = buildPlatformMcpToolDefinitions({
      executionMode: 'workspace',
      includeBrowserTools: true,
      includeTaskTools: true,
      includeAgentTools: true,
    }).map((definition) => definition.name);
    // networkEnabled is false → browser_open/click/type/read/screenshot stay out.
    expect(names).not.toContain('browser_open');
    expect(names).not.toContain('browser_click');
    expect(names).not.toContain('browser_type');
    expect(names).not.toContain('browser_read');
    expect(names).not.toContain('browser_screenshot');
  });

  it('serves platform_context identity', async () => {
    const content = await executePlatformTool('platform_context', {}, {
      workspaceDir: 'C:/workspace',
      kernelId: 'codex',
      runId: 'run-1',
      threadId: 'thread-1',
    });
    const parsed = JSON.parse(content);
    expect(parsed.platform).toBe('sync-think');
    expect(parsed.kernelId).toBe('codex');
    expect(parsed.tools).toContain('file_write');
  });

  it('reads, lists and searches workspace files', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sync-think-pt-'));
    writeFileSync(join(workspaceDir, 'demo.txt'), 'alpha line\nbeta line\n');
    mkdirSync(join(workspaceDir, 'nested'));
    writeFileSync(join(workspaceDir, 'nested', 'other.md'), 'gamma alpha');

    const read = await executePlatformTool('file_read', { path: 'demo.txt' }, { workspaceDir });
    expect(read).toContain('beta line');

    const list = JSON.parse(
      await executePlatformTool('file_list', { path: '.' }, { workspaceDir }),
    );
    expect(list.entries.map((entry: { name: string }) => entry.name)).toEqual(
      expect.arrayContaining(['demo.txt', 'nested']),
    );

    const search = JSON.parse(
      await executePlatformTool(
        'file_search',
        { pattern: 'alpha', path: 'nested' },
        { workspaceDir },
      ),
    );
    expect(search.matches).toHaveLength(1);
    expect(search.matches[0].path).toBe('nested/other.md');
  });

  it('writes files and rejects workspace escapes', async () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sync-think-pt-'));
    const result = JSON.parse(
      await executePlatformTool(
        'file_write',
        { path: 'sub/out.txt', content: 'hello' },
        { workspaceDir },
      ),
    );
    expect(result.ok).toBe(true);
    expect(readFileSync(join(workspaceDir, 'sub', 'out.txt'), 'utf8')).toBe('hello');

    await expect(
      executePlatformTool('file_read', { path: '../secret.txt' }, { workspaceDir }),
    ).rejects.toThrow(/escapes the workspace/);
  });

  it('resolveWithinWorkspace rejects absolute and escaping paths', () => {
    expect(() => resolveWithinWorkspace('C:/ws', 'C:/Windows/system32')).toThrow(
      /escapes the workspace/,
    );
    expect(() => resolveWithinWorkspace('C:/ws', 'a/../../b')).toThrow(/escapes the workspace/);
    expect(resolveWithinWorkspace('C:/ws', 'a/b.txt')).toBe('C:\\ws\\a\\b.txt');
  });
});

describe('platform mcp config builders', () => {
  it('builds a claude --mcp-config JSON with the broker env', () => {
    const json = buildClaudeMcpConfigJson(makeBroker());
    const parsed = JSON.parse(json) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = parsed.mcpServers[PLATFORM_MCP_SERVER_NAME];
    expect(server.command).toBe('C:/node/node.exe');
    expect(server.args[0]).toContain('platform-mcp-server.mjs');
    expect(server.env.ST_BROKER_TOKEN).toBe('test-token-abc');
    expect(server.env.ST_BROKER_PORT).toBe('49152');
  });

  it('builds codex -c overrides with single-quoted TOML (cmd-shim-safe)', () => {
    const args = buildCodexMcpConfigArgs(makeBroker());
    // Every value must be single-quoted TOML — double quotes are rejected by
    // the cmd.exe shim whitelist.
    const joined = args.join(' ');
    expect(joined).not.toContain('"');
    expect(joined).toContain(`mcp_servers.${PLATFORM_MCP_SERVER_NAME}.command='C:/node/node.exe'`);
    expect(joined).toContain(`args=['D:/sync-think/apps/mcp-server/platform-mcp-server.mjs']`);
    expect(joined).toContain(`env.ST_BROKER_TOKEN='test-token-abc'`);
    expect(args).toHaveLength(12); // 6 keys × (flag + value)
  });
});
