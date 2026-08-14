/**
 * Platform tool catalog + in-process executors for the kernel MCP channel
 * (Slice 5). The catalog lives here (single source of truth); the broker sends
 * it to the MCP server at hello. Executors are pure — the runtime supplies
 * stores and context through `PlatformToolContext`, so this module is
 * unit-testable without the runtime.
 *
 * v1 scope (honest): workspace file I/O + inventory reads that run fully
 * in-process. Browser/desktop/skill/team-start tools need the desktop main
 * process / browser service and are documented as v2.
 */
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { PlatformMcpToolDefinition } from './mcp-broker.js';
import {
  CHAT_AGENT_TOOL_SCHEMAS,
  CHAT_BROWSER_TOOL_SCHEMAS,
  CHAT_DESKTOP_TOOL_SCHEMAS,
  CHAT_MCP_CATALOG_TOOL_SCHEMAS,
  CHAT_MCP_REGISTRY_TOOL_SCHEMAS,
  CHAT_PLAN_TOOL_SCHEMAS,
  CHAT_SKILL_TOOL_SCHEMAS,
  CHAT_TEAM_TOOL_SCHEMAS,
  chatToolRequiresApproval,
  normalizeChatExecutionMode,
} from '../chat-tools.js';

const MAX_FILE_READ_BYTES = 1 << 20; // 1 MiB
const MAX_WRITE_BYTES = 1 << 20;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 500;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.cache', 'build', 'out']);

export const PLATFORM_MCP_TOOL_DEFINITIONS: readonly PlatformMcpToolDefinition[] = [
  {
    name: 'platform_context',
    description:
      'Identify the SYNC-THINK platform, the workspace the kernel is bound to, and the platform tools available on this channel.',
    approval: 'never',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'file_read',
    description:
      'Read one UTF-8 text file relative to the bound workspace folder (max 1 MiB). Returns the raw file content.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root' },
      },
    },
  },
  {
    name: 'file_list',
    description: 'List files and directories relative to the bound workspace folder (one level).',
    approval: 'never',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Directory relative to the workspace root (default: root)',
        },
        maxEntries: { type: 'integer', minimum: 1, maximum: 500 },
      },
    },
  },
  {
    name: 'file_search',
    description:
      'Search file contents inside the bound workspace using a JavaScript regular expression. Returns matching lines as path:line. Ignores node_modules/.git/dist and other build artifacts automatically.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression source (no flags)' },
        path: {
          type: 'string',
          description: 'Subdirectory relative to the workspace root (default: whole workspace)',
        },
        caseInsensitive: {
          type: 'boolean',
          description: 'Match case-insensitively (default: false)',
        },
      },
    },
  },
  {
    name: 'file_write',
    description:
      'Write a UTF-8 text file relative to the bound workspace folder (max 1 MiB). Creates parent directories. Requires host approval outside full-access mode.',
    approval: 'ask-mode',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root' },
        content: { type: 'string', description: 'File content to write' },
      },
    },
  },
  {
    name: 'task_list',
    description: 'List the workspace task plan (tasks with status/priority/dependencies).',
    approval: 'never',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'agent_list',
    description: 'List the workspace agents and their current versions.',
    approval: 'never',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
/** Host-only workspace tools implemented by `executePlatformTool` itself. */
const PLATFORM_FILE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'platform_context',
  'file_read',
  'file_list',
  'file_search',
  'file_write',
  'task_list',
  'agent_list',
]);

/** True for the host-only file/inventory tools (not native chat tools). */
export function isPlatformFileToolName(name: string): boolean {
  return PLATFORM_FILE_TOOL_NAMES.has(name);
}

export interface PlatformToolCatalogOptions {
  executionMode?: string;
  networkEnabled?: boolean;
  includeAgentTools?: boolean;
  includeBrowserTools?: boolean;
  includeDesktopTools?: boolean;
  includeTaskTools?: boolean;
  includeMcpTools?: boolean;
  includeTeamTools?: boolean;
  includeSkillTools?: boolean;
}

function toPlatformDefinition(
  schema: { name: string; description?: string; inputSchema: Record<string, unknown> },
  executionMode: string,
): PlatformMcpToolDefinition {
  return {
    name: schema.name,
    description: schema.description ?? schema.name,
    inputSchema: schema.inputSchema,
    approval: chatToolRequiresApproval(executionMode, schema.name)
      ? 'outside-full-access'
      : 'never',
  };
}

/**
 * Build the per-run host catalog from the authoritative chat tool schemas.
 *
 * Browser/desktop tools are intentionally NOT exposed to external kernels this
 * round: their host executors need the Browser/Desktop controller origin-grant
 * and risk fences, which are wired for the native loop only.
 */
export function buildPlatformMcpToolDefinitions(
  options: PlatformToolCatalogOptions = {},
): readonly PlatformMcpToolDefinition[] {
  const executionMode = normalizeChatExecutionMode(options.executionMode);
  const definitions = [...PLATFORM_MCP_TOOL_DEFINITIONS];
  const seen = new Set(definitions.map((definition) => definition.name));
  const add = (
    schemas: readonly {
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }[],
  ) => {
    for (const schema of schemas) {
      if (seen.has(schema.name)) continue;
      seen.add(schema.name);
      definitions.push(toPlatformDefinition(schema, executionMode));
    }
  };
  if (options.includeTaskTools) add(CHAT_PLAN_TOOL_SCHEMAS);
  if (options.includeAgentTools) add(CHAT_AGENT_TOOL_SCHEMAS);
  if (options.includeSkillTools) add(CHAT_SKILL_TOOL_SCHEMAS);
  if (options.includeTeamTools) add(CHAT_TEAM_TOOL_SCHEMAS);
  if (options.includeMcpTools) {
    add(CHAT_MCP_CATALOG_TOOL_SCHEMAS);
    add(CHAT_MCP_REGISTRY_TOOL_SCHEMAS);
  }
  if (options.networkEnabled && options.includeBrowserTools) add(CHAT_BROWSER_TOOL_SCHEMAS);
  if (options.includeDesktopTools) add(CHAT_DESKTOP_TOOL_SCHEMAS);
  return definitions;
}

/** Stores + context the executors need; supplied by the runtime. */
export interface PlatformToolContext {
  workspaceDir: string;
  runId?: string;
  threadId?: string;
  kernelId?: string;
  taskPlanStore?: {
    list(
      workspaceId: string,
      options?: { statuses?: readonly string[] },
    ): Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      dependsOn: string[];
    }>;
  };
  agentStore?: {
    listLatestVersions(): Array<{ agentId: string; name: string; version: string }>;
  };
  resolveWorkspaceId?: () => string;
  catalog?: readonly PlatformMcpToolDefinition[];
}

/** Root an input path inside the workspace; throws on escape attempts. */
export function resolveWithinWorkspace(workspaceDir: string, inputPath: string): string {
  const target = resolve(workspaceDir, inputPath);
  const root = resolve(workspaceDir);
  const relativePath = relative(root, target);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`path escapes the workspace: ${inputPath}`);
  }
  return target;
}

/** Execute one platform tool; returns the MCP text content. */
export async function executePlatformTool(
  tool: string,
  toolInput: Record<string, unknown>,
  ctx: PlatformToolContext,
): Promise<string> {
  switch (tool) {
    case 'platform_context': {
      return JSON.stringify(
        {
          ok: true,
          platform: 'sync-think',
          kernelId: ctx.kernelId ?? null,
          runId: ctx.runId ?? null,
          threadId: ctx.threadId ?? null,
          workspaceDir: ctx.workspaceDir,
          tools: buildPlatformMcpToolDefinitions().map((definition) => definition.name),
        },
        null,
        0,
      );
    }
    case 'file_read': {
      const path = stringArg(toolInput.path);
      if (!path) throw new Error('file_read requires a path');
      const filePath = resolveWithinWorkspace(ctx.workspaceDir, path);
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error(`not a file: ${path}`);
      if (info.size > MAX_FILE_READ_BYTES) throw new Error(`file too large to read: ${path}`);
      return readFile(filePath, 'utf8');
    }
    case 'file_list': {
      const path = typeof toolInput.path === 'string' && toolInput.path ? toolInput.path : '.';
      const maxEntries = clampInt(toolInput.maxEntries, 1, MAX_LIST_ENTRIES, MAX_LIST_ENTRIES);
      const dirPath = resolveWithinWorkspace(ctx.workspaceDir, path);
      const entries = await readdir(dirPath, { withFileTypes: true });
      const items = entries.slice(0, maxEntries).map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
      return JSON.stringify({
        ok: true,
        path: relative(ctx.workspaceDir, dirPath),
        entries: items,
      });
    }
    case 'file_search': {
      const pattern = stringArg(toolInput.pattern);
      if (!pattern) throw new Error('file_search requires a pattern');
      let flags = 'g';
      if (toolInput.caseInsensitive === true) flags += 'i';
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, flags);
      } catch {
        throw new Error(`invalid pattern: ${pattern}`);
      }
      const base = typeof toolInput.path === 'string' && toolInput.path ? toolInput.path : '.';
      const basePath = resolveWithinWorkspace(ctx.workspaceDir, base);
      const matches: Array<{ path: string; line: number; text: string }> = [];
      // Result paths are workspace-relative (matches the native search_files).
      await walkSearch(ctx.workspaceDir, basePath, regex, matches, 0);
      if (matches.length > MAX_SEARCH_RESULTS) matches.length = MAX_SEARCH_RESULTS;
      return JSON.stringify({ ok: true, matches });
    }
    case 'file_write': {
      const path = stringArg(toolInput.path);
      const content = typeof toolInput.content === 'string' ? toolInput.content : '';
      if (!path) throw new Error('file_write requires a path');
      if (content.length > MAX_WRITE_BYTES) throw new Error('file content exceeds 1 MiB');
      const filePath = resolveWithinWorkspace(ctx.workspaceDir, path);
      const parent = dirname(filePath);
      await writeFile(filePath, content, { encoding: 'utf8', flag: 'w' }).catch(async (error) => {
        // Best-effort parent creation for nested paths (native chat tools do the same).
        const { mkdir } = await import('node:fs/promises');
        await mkdir(parent, { recursive: true });
        await writeFile(filePath, content, { encoding: 'utf8', flag: 'w' });
        void error;
      });
      return JSON.stringify({
        ok: true,
        path: relative(ctx.workspaceDir, filePath),
        bytes: content.length,
      });
    }
    case 'task_list': {
      if (!ctx.taskPlanStore) throw new Error('task plan store unavailable');
      const workspaceId = ctx.resolveWorkspaceId ? ctx.resolveWorkspaceId() : '';
      const tasks = ctx.taskPlanStore.list(workspaceId);
      return JSON.stringify({ ok: true, tasks });
    }
    case 'agent_list': {
      if (!ctx.agentStore) throw new Error('agent store unavailable');
      const agents = ctx.agentStore.listLatestVersions();
      return JSON.stringify({ ok: true, agents });
    }
    default:
      throw new Error(`unknown platform tool: ${tool}`);
  }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function walkSearch(
  root: string,
  dirPath: string,
  regex: RegExp,
  matches: Array<{ path: string; line: number; text: string }>,
  depth: number,
): Promise<void> {
  if (depth > 24) return;
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkSearch(root, fullPath, regex, matches, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    if (matches.length >= MAX_SEARCH_RESULTS) return;
    const isBinary = await looksBinary(fullPath);
    if (isBinary) continue;
    const content = await readFile(fullPath, 'utf8').catch(() => null);
    if (content === null) continue;
    regex.lastIndex = 0;
    if (!regex.test(content)) continue;
    const lines = content.split('\n');
    for (let index = 0; index < lines.length && matches.length < MAX_SEARCH_RESULTS; index++) {
      const line = lines[index];
      if (line.length > 4_000) continue;
      if (line.match(new RegExp(regex.source, regex.flags.replace('g', '')))) {
        matches.push({
          path: relative(root, fullPath).split(sep).join('/'),
          line: index + 1,
          text: line.trim().slice(0, 300),
        });
      }
    }
  }
}

async function looksBinary(filePath: string): Promise<boolean> {
  const handle = await import('node:fs/promises')
    .then((m) => m.open(filePath, 'r'))
    .catch(() => null);
  if (!handle) return true;
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buffer, 0, 512, 0);
    for (let index = 0; index < bytesRead; index++) {
      if (buffer[index] === 0) return true;
    }
    return false;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
