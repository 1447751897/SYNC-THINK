/**
 * Kernel MCP server registry — the single source of truth for every
 * self-developed kernel tool (Phase 1/5 plan).
 *
 *   A · claude-code → `createSdkMcpServer` (in-process SDK server)
 *   B · codex / pi  → stdio MCP protocol shell (Phase 3)
 *   C · native      → provider tool schemas (derived, unchanged semantics)
 *
 * A server participates in a run when its `condition` passes; planning mode
 * filters `planningDenied` tools out of the visible catalog. The `hostOnly`
 * flag (desktop-automation) keeps a server away from every external kernel.
 */
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';
import { platformServer } from './platform-server.js';
import { agentLibraryServer } from './agent-library-server.js';
import { teamLibraryServer } from './team-library-server.js';
import { skillCenterServer } from './skill-center-server.js';
import { mcpDirectoryServer } from './mcp-directory-server.js';
import { taskBoardServer } from './task-board-server.js';
import { webFetchServer, webSearchServer } from './web-server.js';
import { browserServer } from './browser-server.js';
import { visionFallbackServer } from './vision-fallback-server.js';
import { imageGenerationServer } from './image-generation-server.js';
import { capabilityBrokerServer } from './capability-broker-server.js';
import { windowsOcrServer } from './windows-ocr-server.js';
import { jsonSchemaToZodShape, type ZodFactory } from './schema-bridge.js';

export type { KernelMcpServerDefinition, KernelMcpToolDefinition } from './define-server.js';

/**
 * Registered servers, in load order (alwaysLoad first, then capability-gated).
 *
 * Store-backed servers declare a `condition` that the runtime supplies per run
 * (hasAgentStore / hasTaskStore / ...). The condition functions are defined
 * here as mutable slots so the runtime can inject the actual store presence
 * flags — the registry itself stays dependency-free.
 */
export interface KernelMcpServerConditions {
  hasAgentStore?: boolean;
  hasTaskStore?: boolean;
  hasMcpStore?: boolean;
  hasSkillStore?: boolean;
  hasTeamStore?: boolean;
  networkEnabled?: boolean;
  /** A configured external provider is needed because this run has no native search route. */
  fallbackWebSearchEnabled?: boolean;
  /** Settings > 模型 > 图片识别 Fallback switched on. */
  visionFallbackEnabled?: boolean;
  /** Settings > 模型 > 图像生成 has an enabled OpenAI Images provider. */
  imageGenerationEnabled?: boolean;
  /** True only when this conversation has an active Goal-mode objective. */
  hasActiveGoal?: boolean;
}

let currentConditions: KernelMcpServerConditions = {};

/** Inject the current capability flags (called by the runtime before each run). */
export function setKernelMcpServerConditions(conditions: KernelMcpServerConditions): void {
  currentConditions = {
    ...conditions,
    // Backward-compatible default for direct registry callers. Runtime route
    // selection always passes this explicitly.
    fallbackWebSearchEnabled:
      conditions.fallbackWebSearchEnabled ?? conditions.networkEnabled ?? false,
  };
}

const storeCondition = (key: keyof KernelMcpServerConditions) => (): boolean =>
  currentConditions[key] === true;

/** Registered servers, in load order (alwaysLoad first, then capability-gated). */
export const KERNEL_MCP_SERVERS: readonly KernelMcpServerDefinition[] = [
  platformServer,
  windowsOcrServer,
  capabilityBrokerServer,
  {
    ...agentLibraryServer,
    condition: storeCondition('hasAgentStore'),
  },
  {
    ...teamLibraryServer,
    condition: storeCondition('hasTeamStore'),
  },
  {
    ...skillCenterServer,
    condition: storeCondition('hasSkillStore'),
  },
  {
    ...mcpDirectoryServer,
    condition: storeCondition('hasMcpStore'),
  },
  {
    ...taskBoardServer,
    condition: storeCondition('hasTaskStore'),
  },
  {
    ...visionFallbackServer,
    condition: storeCondition('visionFallbackEnabled'),
  },
  {
    ...imageGenerationServer,
    condition: storeCondition('imageGenerationEnabled'),
  },
  {
    ...webSearchServer,
    condition: storeCondition('fallbackWebSearchEnabled'),
  },
  {
    ...webFetchServer,
    condition: storeCondition('networkEnabled'),
  },
  {
    ...browserServer,
    condition: storeCondition('networkEnabled'),
  },
];

/** External kernels that receive MCP tool namespaces (host-only excluded). */
export const EXTERNAL_KERNEL_IDS = ['claude-code', 'codex', 'pi'] as const;

/** All registered server names (for catalog plumbing). */
export function kernelMcpServerNames(): readonly string[] {
  return KERNEL_MCP_SERVERS.map((server) => server.name);
}

export interface KernelMcpRunSelection {
  /** Servers selected for this run (planning-filtered, capability-gated). */
  servers: readonly KernelMcpServerDefinition[];
  /** Tools visible to an external kernel (claude-code / codex / pi). */
  externalTools: readonly KernelMcpToolDefinition[];
  /** Tools visible to the native channel. */
  nativeTools: readonly KernelMcpToolDefinition[];
}

/**
 * Select servers + tools for one run.
 *
 * Call `setKernelMcpServerConditions` first to inject the store-presence flags
 * the server `condition` closures read. `hostOnly` servers appear only on the
 * native channel. The returned arrays share the definition objects — callers
 * must not mutate them.
 */
export function selectKernelMcpRun(options: {
  kernelId?: string;
  executionMode?: string;
  networkEnabled?: boolean;
  planningMode?: boolean;
}): KernelMcpRunSelection {
  const servers: KernelMcpServerDefinition[] = [];
  const externalTools: KernelMcpToolDefinition[] = [];
  const nativeTools: KernelMcpToolDefinition[] = [];
  for (const server of KERNEL_MCP_SERVERS) {
    if (server.name === 'task-board' && (options.kernelId === 'claude-code' || options.kernelId === 'codex')) continue;
    if (!server.alwaysLoad) {
      const condition = server.condition;
      if (condition) {
        try {
          if (!condition()) continue;
        } catch {
          continue;
        }
      }
    }
    // Deferred servers stay off the model catalog; capability-broker searches
    // them and the host executes the underlying short name.
    if (server.deferred) continue;
    const visibleTools = (
      options.planningMode
        ? server.tools.filter((tool) => !tool.planningDenied)
        : server.tools
    ).filter((tool) => tool.name !== 'goal_manage' || currentConditions.hasActiveGoal === true);
    if (visibleTools.length === 0) continue;
    servers.push(server);
    nativeTools.push(...visibleTools);
    if (!server.hostOnly) {
      externalTools.push(
        ...visibleTools.filter(
          (tool) => !tool.kernels || tool.kernels.some((kernel) => kernel !== 'native'),
        ),
      );
    }
  }
  return { servers, externalTools, nativeTools };
}

/**
 * Export channel A — claude-code in-process SDK server.
 *
 * Each selected server becomes a `McpSdkServerConfigWithInstance` registered
 * under its own name; the SDK exposes tools as `mcp__<server>__<tool>`.
 * Tool calls are bounded by the SDK's MCP tool-call timeout (default
 * effectively unbounded) and run fully in-process — no subprocess, no broker,
 * no token material on disk.
 */
export function buildSdkMcpServers(
  selection: readonly KernelMcpServerDefinition[],
  execute: (tool: string, input: Record<string, unknown>) => Promise<string>,
  z: ZodFactory,
): Record<string, McpSdkServerConfigWithInstance> {
  const servers: Record<string, McpSdkServerConfigWithInstance> = {};
  for (const server of selection) {
    if (server.deferred) continue;
    const tools: SdkMcpToolDefinition[] = server.tools.map((toolDef) => ({
      name: toolDef.name,
      description: toolDef.description,
      // Real zod schema (not a fake zod-like marker): the SDK's
      // validateToolInput parses tool arguments through this shape at call
      // time. A fake marker lacks the full zod protocol and fails with
      // `l._parse is not a function` the moment the model calls the tool.
      inputSchema: jsonSchemaToZodShape(z, toolDef.inputSchema) as never,
      handler: async (args: unknown) => {
        const content = await execute(toolDef.name, (args ?? {}) as Record<string, unknown>);
        return { content: [{ type: 'text', text: content }] };
      },
    }));
    // `alwaysLoad: true` (SDK 0.3.x): without it the CLI's tool search may
    // defer the server's tools behind its search index, so the model never sees
    // `mcp__<server>__<tool>` in its tool list — the exact symptom observed on
    // claude-code (ask_user_question "not showing up"). NewMax's ask-user
    // server does the same (`alwaysLoad: true` in its factory).
    servers[server.name] = createSdkMcpServer({
      name: server.name,
      version: server.version,
      tools,
      alwaysLoad: true,
    });
  }
  return servers;
}
