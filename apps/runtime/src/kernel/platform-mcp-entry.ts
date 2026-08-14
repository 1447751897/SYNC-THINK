import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLATFORM_MCP_ENTRY = 'platform-mcp-server.mjs';

/**
 * Resolve the self-contained platform MCP server from supported layouts:
 * monorepo source/dist (`apps/mcp-server`) and packaged Runtime
 * (`resources/runtime/mcp-server`).
 */
export function resolvePlatformMcpServerEntry(
  runtimeModuleUrl: string | URL,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const candidates = [
    new URL(`../../mcp-server/${PLATFORM_MCP_ENTRY}`, runtimeModuleUrl),
    new URL(`../mcp-server/${PLATFORM_MCP_ENTRY}`, runtimeModuleUrl),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (exists(path)) return path;
  }
  return undefined;
}
