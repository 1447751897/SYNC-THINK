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

/**
 * Serialize one value as a TOML **literal** string for a codex `-c key=value`
 * override.
 *
 * Single quotes, not `JSON.stringify`: on Windows the kernel executable is a
 * `.cmd` shim, so the whole argv goes through `buildSafeCmdShimCommand`, whose
 * whitelist rejects `"` outright (process-runner.ts SAFE_CMD_SHIM_METACHARS).
 * A double-quoted value therefore fails the spawn with "kernel args contain
 * unsafe shell metacharacters" before codex is ever reached — every `-c` value
 * on the codex command line must use this helper.
 *
 * TOML literal strings have no escape mechanism, so a value containing `'`
 * cannot be represented. That is unrepresentable rather than merely awkward:
 * emitting it raw would produce invalid TOML and codex would fail to parse its
 * own config. Callers must reject such values instead of shipping bad config.
 */
export function tomlLiteral(value: string): string {
  if (value.includes("'")) {
    throw new Error(
      `codex -c value cannot contain a single quote (TOML literal strings have no escapes): ${value}`,
    );
  }
  return `'${value}'`;
}

/** TOML literal string array (`['a','b']`) for a codex `-c key=value` override. */
export function tomlLiteralArray(values: readonly string[]): string {
  return `[${values.map((value) => tomlLiteral(value)).join(',')}]`;
}

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
 * codex `mcp_servers.<name>.*` config overrides. codex app-server (0.145.0,
 * verified) receives the server object in thread/start config without touching
 * ~/.codex/config.toml.
 *
 * Values are TOML literal strings (single-quoted). Double quotes are rejected
 * by the cmd.exe shim whitelist; the app-server path keeps values in the
 * JSON-RPC config object.
 */
export function buildCodexMcpConfigArgs(broker: PlatformBrokerInfo): string[] {
  const server = PLATFORM_MCP_SERVER_NAME;
  return [
    `-c`, `mcp_servers.${server}.command=${tomlLiteral(broker.command)}`,
    `-c`, `mcp_servers.${server}.args=${tomlLiteralArray(broker.args)}`,
    `-c`, `mcp_servers.${server}.env.ST_BROKER_HOST=${tomlLiteral(broker.host)}`,
    `-c`, `mcp_servers.${server}.env.ST_BROKER_PORT=${tomlLiteral(String(broker.port))}`,
    `-c`, `mcp_servers.${server}.env.ST_BROKER_TOKEN=${tomlLiteral(broker.token)}`,
    `-c`, `mcp_servers.${server}.env.ST_WORKSPACE_DIR=${tomlLiteral(broker.workspaceDir)}`,
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
