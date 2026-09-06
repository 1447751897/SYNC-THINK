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
import { DESCRIBE_IMAGE_INPUT_SCHEMA, DESCRIBE_IMAGE_TOOL_NAME } from '../describe-image-tool.js';
import {
  WINDOWS_OCR_INPUT_SCHEMA,
  WINDOWS_OCR_TOOL_DESCRIPTION,
  WINDOWS_OCR_TOOL_NAME,
} from '../windows-ocr.js';
import {
  CHAT_AGENT_TOOL_SCHEMAS,
  CHAT_BROWSER_TOOL_SCHEMAS,
  CHAT_DESKTOP_TOOL_SCHEMAS,
  CHAT_MCP_CATALOG_TOOL_SCHEMAS,
  CHAT_MCP_REGISTRY_TOOL_SCHEMAS,
  CHAT_NETWORK_TOOL_SCHEMAS,
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
  {
    name: 'ask_user_question',
    description:
      '向用户提问并等待回答（工具会挂起直到用户作答，回答作为工具结果返回）。需要用户确认、选择或补充信息时调用。推荐选项放第一位并在 label 末尾加「（推荐）」。规划模式的最终方案请用 plan_submit 提交，不要用本工具提交方案。',
    approval: 'never',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'question'],
            properties: {
              id: {
                type: 'string',
                description: 'Stable id for this question; echoed in the answer.',
              },
              question: { type: 'string', description: 'The specific question to ask the user.' },
              header: {
                type: 'string',
                description: 'Optional short heading, e.g. "Confirm" or "Choose Mode".',
              },
              detail: { type: 'string', description: 'Optional Markdown detail / full plan text.' },
              intent: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  kind: {
                    type: 'string',
                    description: "'plan-review' renders the plan review card.",
                  },
                  approve: {
                    type: 'string',
                    description: 'plan-review: the approve option label.',
                  },
                },
              },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label'],
                  properties: {
                    label: { type: 'string', description: 'Short user-facing option label.' },
                    description: {
                      type: 'string',
                      description: 'One sentence explaining the tradeoff or impact.',
                    },
                  },
                },
              },
              multi_select: {
                type: 'boolean',
                description: 'Whether the user may select more than one option. Defaults to false.',
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'plan_submit',
    description:
      '提交一份结构化执行方案（规划模式专用，§12.18）。完成只读调研后调用本工具提交方案：title 标题、goal 目标、scope 范围、assumptions 假设、decisions 已做决策、steps 步骤（每步 title/description/acceptanceChecks 验收标准、可选 expectedFiles）、risks 风险（description/mitigation）、finalAcceptanceChecks 总验收标准。提交成功后方案会显示给用户审批，简要总结要点并停止——不要继续执行任何改动。',
    approval: 'never',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'steps'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 200, description: '方案标题' },
        goal: { type: 'string', maxLength: 5000, description: '方案目标' },
        scope: {
          type: 'array',
          items: { type: 'string' },
          description: '改动范围（明确不做的事也列在这里）',
        },
        assumptions: {
          type: 'array',
          items: { type: 'string' },
          description: '前提假设',
        },
        decisions: {
          type: 'array',
          items: { type: 'string' },
          description: '已做出的关键决策',
        },
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'title', 'description', 'acceptanceChecks'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 128, description: '稳定步骤 id' },
              title: { type: 'string', maxLength: 500, description: '步骤标题' },
              description: { type: 'string', maxLength: 5000, description: '步骤描述' },
              expectedFiles: {
                type: 'array',
                items: { type: 'string' },
                description: '本步骤预计触动的文件',
              },
              acceptanceChecks: {
                type: 'array',
                minItems: 1,
                items: { type: 'string', maxLength: 2000 },
                description: '本步骤完成的验收标准（可验证、可自检）',
              },
            },
          },
        },
        risks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['description', 'mitigation'],
            properties: {
              description: { type: 'string', maxLength: 2000, description: '风险描述' },
              mitigation: { type: 'string', maxLength: 2000, description: '缓解措施' },
            },
          },
        },
        finalAcceptanceChecks: {
          type: 'array',
          items: { type: 'string', maxLength: 2000 },
          description: '方案整体完成的验收标准',
        },
      },
    },
  },
  {
    name: 'task_schedule',
    description:
      'Manage scheduled tasks (定时任务). Actions: "create" (name, instruction, target {kind:"agent",agentId} or {kind:"model",modelId}, rule {kind:"at",runAt} | {kind:"every",intervalMinutes≥5,firstRunAt?} | {kind:"random",windowStart,windowEnd,minTimes,maxTimes} | {kind:"cron",expression}, timeZone?) creates a task that fires by injecting the instruction into its own conversation; "list" returns all tasks; "cancel" (taskId) disables a task. Creating or cancelling requires approval outside full-access mode.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'cancel'] },
        name: { type: 'string', description: 'Task name (create).' },
        instruction: {
          type: 'string',
          description: 'Instruction injected to the task conversation when it fires (create).',
        },
        target: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['agent', 'model'] },
            agentId: { type: 'string' },
            modelId: { type: 'string' },
          },
        },
        rule: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['at', 'every', 'random', 'cron'] },
            runAt: { type: 'string' },
            intervalMinutes: { type: 'number' },
            firstRunAt: { type: 'string' },
            windowStart: { type: 'string' },
            windowEnd: { type: 'string' },
            minTimes: { type: 'number' },
            maxTimes: { type: 'number' },
            expression: { type: 'string' },
          },
        },
        timeZone: { type: 'string', description: 'IANA time zone, default UTC.' },
        taskId: { type: 'string', description: 'Task id to cancel.' },
      },
    },
  },
  {
    name: 'goal_manage',
    description:
      'Manage the active Goal mode objective only. Actions: "complete" (mark the objective achieved with evidence you gathered), "block" (reason — stop and wait for the user when an unresolvable obstacle blocks progress), "progress" (note — record a short progress note). Never use this for a task checklist; use the current kernel’s task/plan tools instead. This tool is omitted unless the user started Goal mode.',
    approval: 'never',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['complete', 'block', 'progress'] },
        reason: { type: 'string', description: 'Block reason or progress note (≤500 chars).' },
      },
    },
  },
];

export const GOAL_MANAGE_NO_ACTIVE_GOAL =
  'goal_manage: 当前对话没有进行中的目标。任务清单请使用当前内核的任务/计划工具，不要调用 goal_manage。goal_manage 仅在用户开启 Goal 模式后可用。';

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

/**
 * Host platform tools that every channel must EXECUTE through the runtime's
 * unified handler (`handlePlatformMcpToolCall`): the native tool loop routes
 * these names there, exactly like the external-kernel MCP path
 * (claude-code / codex / pi). Ask questions, submit plans, manage goals and
 * scheduled tasks use the same implementation on every kernel.
 */
export const CHAT_PLATFORM_HOST_TOOL_NAMES: ReadonlySet<string> = new Set([
  'platform_context',
  'ask_user_question',
  'plan_submit',
  'task_schedule',
  'goal_manage',
  'task_list',
  'agent_list',
  DESCRIBE_IMAGE_TOOL_NAME,
  WINDOWS_OCR_TOOL_NAME,
]);

/**
 * Tools that are NOT allowed during「规划模式」(planning mode). Planning runs
 * analyse read-only and submit an approvable plan; any write, command, browser
 * interaction or resource mutation is hard-blocked in the host executor — this
 * set is the single source of truth for both the catalog filter and the fence.
 */
export const PLANNING_MODE_DENIED_TOOLS: ReadonlySet<string> = new Set([
  // Workspace file writes.
  'file_write',
  'write_file',
  // Command execution.
  'run_command',
  // Task plan mutations.
  'TaskCreate',
  'TaskUpdate',
  // Agent mutations.
  'create_agent',
  'update_agent',
  'archive_agent',
  // Team mutations.
  'create_team',
  'update_team',
  'delete_team',
  // Skill mutations.
  'create_skill',
  'update_skill',
  'delete_skill',
  'import_remote_skill',
  // MCP registry mutations.
  'register_remote_mcp',
  // Browser interactions (side-effecting on a live page).
  'browser_click',
  'browser_type',
  // Browser workflow mutations.
  'browser_workflow_create_draft',
  'browser_workflow_execute',
  // Scheduled task mutations.
  'task_schedule',
]);

/** True when the tool is a planning-mode write/side-effect tool. */
export function isPlanningDeniedTool(name: string): boolean {
  return PLANNING_MODE_DENIED_TOOLS.has(name);
}

/**
 * Native 内核的模型工具目录：把平台工具（ask_user_question / task_schedule /
 * goal_manage 等）并入 native 的 provider tools。跳过 host-only 文件工具
 * （file_read 等）——native 有等价的内置文件工具（read_file 等），避免
 * 同一能力双名暴露；task_list/agent_list 等重名由 extraTools 去重吸收。
 */
export function nativePlatformToolSchemas(
  options: {
    planningMode?: boolean;
    /** 设置 > 模型 > 图片识别 Fallback 开关：把 describe_image 并入 native 目录。 */
    visionFallbackEnabled?: boolean;
    /** False when this conversation has no active Goal. */
    includeGoalManage?: boolean;
  } = {},
): import('@sync-think/adapters').ProviderToolSchema[] {
  const definitions = buildPlatformMcpToolDefinitions({
    planningMode: options.planningMode,
    includeGoalManage: options.includeGoalManage,
  });
  const extra = [
    {
      name: WINDOWS_OCR_TOOL_NAME,
      description: WINDOWS_OCR_TOOL_DESCRIPTION,
      inputSchema: WINDOWS_OCR_INPUT_SCHEMA,
    },
    ...(options.visionFallbackEnabled
      ? [
          {
            name: DESCRIBE_IMAGE_TOOL_NAME,
            description:
              '用视觉模型理解工作区中的一张图片（PNG / JPEG / GIF / WebP）。' +
              '传入工作区内的图片路径；宿主会调用你配置的视觉模型描述图片并返回文字结果。' +
              '仅当图片识别 Fallback 已启用时可用。',
            inputSchema: DESCRIBE_IMAGE_INPUT_SCHEMA,
          },
        ]
      : []),
  ];
  return [...definitions, ...extra]
    .filter((definition) => !PLATFORM_FILE_TOOL_NAMES.has(definition.name))
    .map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
    }));
}

export interface PlatformToolCatalogOptions {
  executionMode?: string;
  networkEnabled?: boolean;
  /** False when the kernel/model pair uses provider-native keyword search. */
  includeWebSearchTools?: boolean;
  includeAgentTools?: boolean;
  includeBrowserTools?: boolean;
  includeDesktopTools?: boolean;
  includeTaskTools?: boolean;
  includeMcpTools?: boolean;
  includeTeamTools?: boolean;
  includeSkillTools?: boolean;
  /** Planning mode: drop all side-effecting tools from the catalog. */
  planningMode?: boolean;
  /** False hides Goal-mode bookkeeping. Default keeps the tool for back-compat catalogs. */
  includeGoalManage?: boolean;
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
 * Browser tools ARE exposed to external kernels when 联网 is on and
 * includeBrowserTools is set: the external-kernel path reuses the Browser
 * Worker's origin-grant / approval fences (see executeExternalKernelBrowserTool).
 * Desktop tools stay host-only for now.
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
  if (options.networkEnabled) {
    add(
      options.includeWebSearchTools === false
        ? CHAT_NETWORK_TOOL_SCHEMAS.filter((schema) => schema.name !== 'web_search')
        : CHAT_NETWORK_TOOL_SCHEMAS,
    );
  }
  if (options.networkEnabled && options.includeBrowserTools) add(CHAT_BROWSER_TOOL_SCHEMAS);
  if (options.includeDesktopTools) add(CHAT_DESKTOP_TOOL_SCHEMAS);
  const catalog = options.planningMode
    ? definitions.filter((definition) => !isPlanningDeniedTool(definition.name))
    : definitions;
  if (options.includeGoalManage === false) {
    return catalog.filter((definition) => definition.name !== 'goal_manage');
  }
  return catalog;
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
