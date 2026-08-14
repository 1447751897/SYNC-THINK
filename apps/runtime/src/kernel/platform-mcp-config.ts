/**
 * Translate PlatformBrokerInfo into each kernel's MCP server registration
 * (Slice 5). The broker address + token are embedded in the server's env —
 * the kernel spawns the platform MCP server with them, and the server connects
 * back to the per-run broker. The config file is written to the temp dir and
 * the adapter deletes it after the run (token material must not persist).
 */
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { PlatformBrokerInfo } from '@sync-think/shared';

export const PLATFORM_MCP_SERVER_NAME = 'sync-think-platform';

function serverEnv(broker: PlatformBrokerInfo): Record<string, string> {
  return {
    ST_BROKER_HOST: broker.host,
    ST_BROKER_PORT: String(broker.port),
    ST_BROKER_TOKEN: broker.token,
    ST_WORKSPACE_DIR: broker.workspaceDir,
  };
}

/**
 * Claude Code `--mcp-config` JSON. CC 2.1.222 (verified) spawns the server,
 * lists tools and exposes them as mcp__sync-think-platform__<tool>.
 */
export function buildClaudeMcpConfigJson(broker: PlatformBrokerInfo): string {
  return JSON.stringify(
    {
      mcpServers: {
        [PLATFORM_MCP_SERVER_NAME]: {
          type: 'stdio',
          command: broker.command,
          args: broker.args,
          env: serverEnv(broker),
        },
      },
    },
    null,
    2,
  );
}

/**
 * codex `mcp_servers.<name>.*` config overrides. codex exec (0.145.0, verified)
 * has no --mcp-config flag; the -c dotted-path overrides register the server
 * for this invocation only without touching ~/.codex/config.toml.
 *
 * Values are TOML literal strings (single-quoted). Double quotes are rejected
 * by the cmd.exe shim whitelist (process.ts buildSafeCmdShimCommand), while
 * single quotes pass through — and codex's TOML parser accepts them.
 */
export function buildCodexMcpConfigArgs(broker: PlatformBrokerInfo): string[] {
  const server = PLATFORM_MCP_SERVER_NAME;
  const literal = (value: string): string => `'${value}'`;
  const literalArray = (values: readonly string[]): string =>
    `[${values.map((value) => literal(value)).join(',')}]`;
  return [
    `-c`, `mcp_servers.${server}.command=${literal(broker.command)}`,
    `-c`, `mcp_servers.${server}.args=${literalArray(broker.args)}`,
    `-c`, `mcp_servers.${server}.env.ST_BROKER_HOST=${literal(broker.host)}`,
    `-c`, `mcp_servers.${server}.env.ST_BROKER_PORT=${literal(String(broker.port))}`,
    `-c`, `mcp_servers.${server}.env.ST_BROKER_TOKEN=${literal(broker.token)}`,
    `-c`, `mcp_servers.${server}.env.ST_WORKSPACE_DIR=${literal(broker.workspaceDir)}`,
  ];
}

/** Write the CC mcp-config JSON to the temp dir; returns the file path. */
export async function writePlatformMcpConfig(broker: PlatformBrokerInfo): Promise<string> {
  const fileName = `sync-think-mcp-${randomBytes(6).toString('hex')}.json`;
  const configPath = join(tmpdir(), fileName);
  await writeFile(configPath, buildClaudeMcpConfigJson(broker), 'utf8');
  return configPath;
}

/** Best-effort cleanup of a temp mcp-config file (token material). */
export async function removePlatformMcpConfig(configPath: string | undefined): Promise<void> {
  if (!configPath) return;
  await rm(configPath, { force: true }).catch(() => undefined);
}
