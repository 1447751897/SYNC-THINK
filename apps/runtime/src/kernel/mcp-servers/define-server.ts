/**
 * Kernel MCP server registry framework (Phase 1).
 *
 * The single source of truth for every self-developed kernel tool. One server
 * per capability domain; each server declares its tools with a JSON-Schema
 * input (reused from `chat-tools.ts`), an approval tier and a planning-mode
 * flag. The runtime consumes this registry through three export channels:
 *
 *   A · claude-code  → `createSdkMcpServer` (in-process, no subprocess)
 *   B · codex / pi   → stdio MCP protocol shell (registry-driven)
 *   C · native       → provider tool schemas (derived)
 *
 * Naming: external kernels see `mcp__<server>__<tool>`; the native channel
 * keeps short names via the derived alias map.
 */
import type { ProviderToolSchema } from '@sync-think/adapters';

/** Approval tiers (mirror the existing broker semantics). */
export type ToolApproval = 'never' | 'ask-mode' | 'outside-full-access';

export interface KernelMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 'never' = executes without a card in every mode. */
  approval: ToolApproval;
  /** Planning mode: side-effecting tools are hidden + fenced. */
  planningDenied?: boolean;
  /** Kernel allow-list: default all; `kernels: ['native']` = host-only. */
  kernels?: readonly ('claude-code' | 'codex' | 'pi' | 'native')[];
}

export interface KernelMcpServerDefinition {
  name: string;
  version: string;
  /** Load unconditionally (no store / capability dependency). */
  alwaysLoad?: boolean;
  /** Load predicate evaluated per-run by the runtime. */
  condition?: () => boolean;
  /** True when this server must never reach an external kernel. */
  hostOnly?: boolean;
  /**
   * True when tools stay off the model catalog and are invoked only through
   * `capability-broker` (`search_capability` / `use_capability`). Host still
   * executes the underlying tool by short name.
   */
  deferred?: boolean;
  tools: readonly KernelMcpToolDefinition[];
}

export interface KernelMcpRegistryOptions {
  executionMode?: string;
  networkEnabled?: boolean;
  planningMode?: boolean;
  hasAgentStore?: boolean;
  hasTaskStore?: boolean;
  hasMcpStore?: boolean;
  hasSkillStore?: boolean;
  hasTeamStore?: boolean;
}

/** Shared tool schema type — keep the import of ProviderToolSchema honest. */
export type { ProviderToolSchema };

/**
 * Select the servers that apply to a run given the current capability flags.
 * Planning mode filters side-effecting tools out of the visible catalog (the
 * executor fence re-checks anyway — this keeps them out of the model's sight).
 */
export function selectKernelMcpServers(
  servers: readonly KernelMcpServerDefinition[],
  options: KernelMcpRegistryOptions = {},
): KernelMcpServerDefinition[] {
  return servers
    .filter((server) => {
      if (server.deferred) return false;
      if (server.alwaysLoad) return true;
      if (server.condition) {
        try {
          if (!server.condition()) return false;
        } catch {
          return false;
        }
      }
      return true;
    })
    .map((server) => {
      if (!options.planningMode) return server;
      return {
        ...server,
        tools: server.tools.filter((tool) => !tool.planningDenied),
      };
    });
}
