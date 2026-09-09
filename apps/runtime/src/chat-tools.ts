import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type CommandSessionStore, type CommandSessionStart } from './command-sessions.js';
import type { ProviderMessage, ProviderToolCall, ProviderToolSchema } from '@sync-think/adapters';
import type {
  BrowserAutomationTaskSummary,
  BrowserProfileSummary,
  CreateBrowserWorkflowDraftPayload,
  CreateBrowserWorkflowDraftResponse,
  GetBrowserWorkflowResponse,
  ListBrowserWorkflowsPayload,
} from '@sync-think/protocol';
import { resolveBrowserClickTarget, type Event } from '@sync-think/shared';
import {
  CHAT_DESKTOP_MUTATING_TOOL_NAMES,
  CHAT_DESKTOP_TOOL_NAMES,
  CHAT_DESKTOP_TOOL_SCHEMAS,
} from './desktop-chat-tools.js';
import {
  parseCreateBrowserWorkflowDraftPayload,
  parseGetBrowserWorkflowPayload,
  parseListBrowserWorkflowsPayload,
} from './validation/browser-workflow.js';
import { DESCRIBE_IMAGE_TOOL_NAME } from './describe-image-tool.js';
import { GENERATE_IMAGE_TOOL_NAME } from './generate-image-tool.js';
import { SEARCH_CAPABILITY_TOOL_NAME, USE_CAPABILITY_TOOL_NAME } from './capability-broker.js';
import { WINDOWS_OCR_TOOL_NAME } from './windows-ocr.js';

export {
  CHAT_DESKTOP_MUTATING_TOOL_NAMES,
  CHAT_DESKTOP_TOOL_NAMES,
  CHAT_DESKTOP_TOOL_SCHEMAS,
  executeChatDesktopTool,
} from './desktop-chat-tools.js';
import {
  FileSystemWorker,
  GitProcessWorker,
  TerminalProcessWorker,
  type WorkerEvent,
  type WorkerJobOutput,
  type WorkerToken,
} from '@sync-think/workers';

export const CHAT_BUILT_IN_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'read_file',
    description: 'Read one UTF-8 text file relative to the bound project folder.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories relative to the bound project folder.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        maxEntries: { type: 'integer', minimum: 1, maximum: 500 },
      },
    },
  },
  {
    name: 'search_files',
    description:
      'Search file contents inside the bound project folder using a regular expression. Returns matching lines as path:line with optional surrounding context. Use this instead of running rg/grep — no shell needed. Ignores node_modules, .git, dist, and other build artifacts automatically.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression source (no flags)' },
        path: {
          type: 'string',
          description:
            'Subdirectory to search, relative to the project folder (default: whole project)',
        },
        caseInsensitive: {
          type: 'boolean',
          description: 'Match case-insensitively (default: false)',
        },
        globInclude: {
          type: 'string',
          description: 'Only search files matching this glob, e.g. "**/*.ts"',
        },
        globExclude: {
          type: 'string',
          description: 'Skip files matching this glob, e.g. "**/*.test.ts"',
        },
        contextLines: {
          type: 'integer',
          minimum: 0,
          maximum: 5,
          description: 'Context lines before/after each match (default: 0)',
        },
        maxResults: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Max matches to report (default: 50)',
        },
      },
    },
  },
  {
    name: 'write_file',
    description: 'Atomically write one UTF-8 text file relative to the bound project folder.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } },
    },
  },
  {
    name: 'run_command',
    description:
      'Run one non-interactive executable without a shell in the bound project folder. Waits up to waitMs (default 10000), then returns a sessionId if still running. A running result is not completion or failure. Use read_command to wait and collect output; use background=true for servers/watchers and verify readiness separately. No execution deadline unless timeoutMs is supplied. Use desktop_launch_app to open GUI applications.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' }, maxItems: 128 },
        cwd: { type: 'string' },
        waitMs: { type: 'integer', minimum: 0, maximum: 30_000, description: 'Time to wait for this response, independent of process lifetime.' },
        timeoutMs: { type: 'integer', minimum: 1, maximum: 2_147_483_647, description: 'Optional total execution deadline; omit for no deadline.' },
        background: { type: 'boolean', description: 'Return a session immediately for a long-lived command. Check its output/readiness before using it.' },
      },
    },
  },
  {
    name: 'read_command',
    description: 'Wait for an existing command and collect new stdout/stderr. A running status is normal for silent work or sleep. Reuse the same sessionId; do not relaunch the command. Sessions belong to this conversation and survive turns until process exit, cancellation, or Runtime shutdown.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        waitMs: { type: 'integer', minimum: 0, maximum: 30_000, description: 'Defaults to 30000. Zero reads current output without waiting.' },
      },
    },
  },
  {
    name: 'list_commands',
    description: 'List running and recently finished commands in this conversation, including their sessionId and status. Use after a turn boundary to find an existing server or long task.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'stop_command',
    description: 'Stop one command session owned by this conversation, including its child processes. Use when the command is no longer needed or the user requests cancellation.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['sessionId'],
      properties: { sessionId: { type: 'string' } },
    },
  },
  {
    name: 'git_status',
    description: 'Read concise Git status for the bound project repository.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'git_diff',
    description: 'Read an unstaged or staged Git diff without external diff helpers.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { staged: { type: 'boolean' }, path: { type: 'string' } },
    },
  },
];

/**
 * Agent-management tools — let the chat model create Agent Library entries.
 * create_agent is gated: full-access executes immediately; any other mode
 * suspends on a user approval card first (see agentToolRequiresApproval).
 */
export const CHAT_AGENT_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'list_agent_resources',
    description:
      'List resources needed to create a SYNC-THINK agent: available model ids, approved skill versions (id/name/version), and existing agent names. ALWAYS call this before create_agent so you fill in valid ids.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'create_agent',
    description:
      'Create a new agent in the SYNC-THINK Agent Library. In full-access mode it is created immediately; in other permission modes the user must approve first (an approval card is shown). Call list_agent_resources first to get valid model ids and approved skill version ids.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Agent display name (non-empty)' },
        avatar: {
          type: 'string',
          description:
            'Optional avatar: a single emoji or short decorative text (≤ 8 chars), or a small data:image data URL. Purely cosmetic.',
        },
        description: {
          type: 'string',
          description: 'Short description shown in the Agent Library',
        },
        persona: {
          type: 'string',
          description: 'System instructions / persona the agent will follow',
        },
        defaultModelId: {
          type: 'string',
          description:
            'Model id from list_agent_resources. Defaults to the current conversation model when omitted.',
        },
        skillIds: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description:
            'Approved skill version ids (preferred) or skill names (resolved to the latest approved version). Max 8.',
        },
        reasoningEffort: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
        },
      },
    },
  },
  {
    name: 'update_agent',
    description:
      'Update an existing agent in the SYNC-THINK Agent Library (name / persona / description / default model / skill bindings / reasoning effort). In full-access mode it executes immediately; in other permission modes the user must approve first (an approval card is shown). Resolve the target by exact agent id (preferred) or unique agent name. Call list_agent_resources first to see existing agents, valid model ids and approved skill versions. Only pass fields you want to change; skillIds is FULL-REPLACE semantics.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agent'],
      properties: {
        agent: {
          type: 'string',
          description: 'Target agent: exact agent id (preferred) or unique agent name.',
        },
        name: {
          type: 'string',
          description: 'New display name (must not collide with another agent)',
        },
        avatar: {
          type: 'string',
          description:
            'New avatar: a single emoji or short decorative text (≤ 8 chars), or a small data:image data URL. Pass "" to clear.',
        },
        description: { type: 'string', description: 'New short description' },
        persona: { type: 'string', description: 'New system instructions / persona' },
        defaultModelId: {
          type: 'string',
          description: 'New model id from list_agent_resources.',
        },
        skillIds: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description:
            'FULL replacement of skill bindings: approved skill version ids (preferred) or skill names. Pass [] to remove all. Omit to keep current bindings. Max 8.',
        },
        reasoningEffort: {
          type: 'string',
          enum: ['auto', 'low', 'medium', 'high'],
        },
      },
    },
  },
  {
    name: 'archive_agent',
    description:
      'Archive (soft-delete) an agent in the SYNC-THINK Agent Library. The agent is hidden from the active list but can be restored from the Agent Library UI — nothing is hard-deleted. In full-access mode it executes immediately; in other permission modes the user must approve first. The agent bound to the CURRENT conversation cannot be archived. Resolve the target by exact agent id (preferred) or unique agent name.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['agent'],
      properties: {
        agent: {
          type: 'string',
          description: 'Target agent: exact agent id (preferred) or unique agent name.',
        },
        reason: {
          type: 'string',
          description: 'Optional short reason shown on the approval card and audit event.',
        },
      },
    },
  },
];

/**
 * Skill-management tools — let the chat model manage the Skill capability
 * center. Mutations share the create_agent permission gate: full-access
 * executes immediately; other modes suspend on a user approval card.
 */
export const CHAT_SKILL_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'list_skills',
    description:
      'List installed SYNC-THINK skills (name, version, skillVersionId, allowed-tools, approval state). ALWAYS call this before create_skill / update_skill / delete_skill so you reference real skillVersionId values.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'read_skill',
    description:
      'Read the full SKILL.md source of one installed skill version. Use before update_skill so your new version is based on the current content.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['skillVersionId'],
      properties: {
        skillVersionId: {
          type: 'string',
          description: 'Exact skill version id (or unique skill name — latest version).',
        },
      },
    },
  },
  {
    name: 'create_skill',
    description:
      'Create a new skill in the SYNC-THINK capability center by importing a complete SKILL.md (frontmatter with name/description/version + body). In full-access mode it imports immediately; in other permission modes the user must approve first. Importing only parses text — scripts are never executed. If allowed-tools expands vs a previous version, a separate permission approval is enqueued automatically.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['skillMd'],
      properties: {
        skillMd: {
          type: 'string',
          description:
            'Full SKILL.md source: YAML frontmatter (name, description, version, optional allowed-tools) followed by the markdown body with the skill instructions.',
        },
      },
    },
  },
  {
    name: 'import_remote_skill',
    description:
      'Fetch a remote SKILL.md over HTTP(S) and import it into the capability center as a market version. The source is parsed only; scripts are never executed. Use the returned skillVersionId when binding it to an Agent.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute HTTP(S) URL of SKILL.md' },
        originRef: { type: 'string', description: 'Optional stable source reference' },
        skillId: { type: 'string', description: 'Optional existing Skill family id' },
      },
    },
  },
  {
    name: 'update_skill',
    description:
      'Update an existing skill by importing a NEW version of its SKILL.md (same frontmatter name, bumped version). Old versions are kept — agents stay pinned to their equipped version until rebound. Call read_skill first and base your edit on the current source. Approval-gated outside full-access.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['skillMd'],
      properties: {
        skillMd: {
          type: 'string',
          description:
            'Full new SKILL.md source. Keep the same frontmatter name as the skill being updated and bump the version.',
        },
      },
    },
  },
  {
    name: 'delete_skill',
    description:
      'Uninstall one skill version from the capability center. Fails when the version is still equipped by an agent or referenced by pending approvals — report that to the user instead of retrying. Approval-gated outside full-access.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['skillVersionId'],
      properties: {
        skillVersionId: {
          type: 'string',
          description: 'Exact skill version id from list_skills.',
        },
        reason: { type: 'string', description: 'Optional short reason for the approval card.' },
      },
    },
  },
];

/**
 * MCP catalog introspection is a Runtime-local read-only tool. It lets the
 * model answer "currently available MCP tools" from the enabled registry
 * instead of guessing from the prompt or requiring one server to be pinned.
 */
export const CHAT_MCP_CATALOG_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'list_mcp_tools',
    description:
      'List enabled MCP servers and their currently registered tools in SYNC-THINK. Use this when the user asks which MCP tools are installed, enabled, or available.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

/** Mutating remote MCP registry tool, separated from read-only catalog lookup. */
export const CHAT_MCP_REGISTRY_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'register_remote_mcp',
    description:
      'Register public metadata for a remote HTTP MCP service in SYNC-THINK. Never ask for or pass an API key in this tool; after registration, direct the user to configure the key in the capability center password field.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'endpoint'],
      properties: {
        name: { type: 'string', description: 'Display name' },
        endpoint: { type: 'string', description: 'Absolute HTTP(S) MCP endpoint' },
        trusted: { type: 'boolean', description: 'Whether output is trusted (default false)' },
      },
    },
  },
];

export const CHAT_MCP_CATALOG_TOOL_NAMES = new Set(
  CHAT_MCP_CATALOG_TOOL_SCHEMAS.map((tool) => tool.name),
);
export const CHAT_MCP_REGISTRY_TOOL_NAMES = new Set(
  CHAT_MCP_REGISTRY_TOOL_SCHEMAS.map((tool) => tool.name),
);

/**
 * Team-management tools — let the chat model manage the Team Library.
 * Mutations share the create_agent permission gate: full-access executes
 * immediately; other modes suspend on a user approval card.
 */
export const CHAT_TEAM_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'list_teams',
    description:
      'List teams in the SYNC-THINK Team Library: team id, name, mission, strategy, coordinator, and the member roster (agent id/name, title, role, dependencies). ALWAYS call this (plus list_agent_resources for agent ids) before create_team / update_team / delete_team so you reference real ids.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'create_team',
    description:
      'Create a new team in the SYNC-THINK Team Library. Members must reference EXISTING agents (exact agent id preferred, or unique agent name) — call list_agent_resources first. In full-access mode it is created immediately; in other permission modes the user must approve first (an approval card is shown).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Team display name (non-empty)' },
        mission: { type: 'string', description: 'Team mission shown in the Team Library' },
        strategy: {
          type: 'string',
          enum: ['serial', 'parallel'],
          description: 'Execution strategy: serial (default) or parallel.',
        },
        coordinatorAgent: {
          type: 'string',
          description:
            'Optional coordinator: exact agent id or unique agent name. Must also be a member.',
        },
        members: {
          type: 'array',
          maxItems: 8,
          description: 'Team roster. Each member references an existing agent. Max 8.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['agent'],
            properties: {
              agent: {
                type: 'string',
                description: 'Member agent: exact agent id (preferred) or unique agent name.',
              },
              title: {
                type: 'string',
                description: 'Member title shown in the roster (e.g. 前端负责人)',
              },
              role: { type: 'string', description: 'Member role keyword (defaults to "member")' },
              dependsOn: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Agents this member waits for (ids or names; each must also be a member).',
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'update_team',
    description:
      'Update an existing team in the SYNC-THINK Team Library (name / mission / strategy / coordinator / member roster). Resolve the target by exact team id (preferred) or unique team name — call list_teams first. members is FULL-REPLACE semantics: pass the complete final roster. In full-access mode it executes immediately; in other permission modes the user must approve first.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['team'],
      properties: {
        team: {
          type: 'string',
          description: 'Target team: exact team id (preferred) or unique team name.',
        },
        name: { type: 'string', description: 'New display name' },
        mission: { type: 'string', description: 'New mission' },
        strategy: { type: 'string', enum: ['serial', 'parallel'] },
        coordinatorAgent: {
          type: 'string',
          description: 'New coordinator (agent id or unique name; must be a member).',
        },
        members: {
          type: 'array',
          maxItems: 8,
          description:
            'FULL replacement roster. Pass [] to remove all members. Omit to keep the current roster. Max 8.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['agent'],
            properties: {
              agent: { type: 'string' },
              title: { type: 'string' },
              role: { type: 'string' },
              dependsOn: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
  {
    name: 'delete_team',
    description:
      'Delete a team from the SYNC-THINK Team Library. Fails when the team still has a running/historical run or is referenced by conversations — report that to the user instead of retrying. The team of the CURRENT conversation cannot be deleted. Resolve the target by exact team id (preferred) or unique team name. Approval-gated outside full-access.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['team'],
      properties: {
        team: {
          type: 'string',
          description: 'Target team: exact team id (preferred) or unique team name.',
        },
        reason: {
          type: 'string',
          description: 'Optional short reason shown on the approval card and audit event.',
        },
      },
    },
  },
];

export const CHAT_TEAM_TOOL_NAMES = new Set(CHAT_TEAM_TOOL_SCHEMAS.map((tool) => tool.name));

/**
 * Task-plan tool — the model maintains an explicit NewMax-style todo list for
 * the current run. Pure UI signal: executing it never touches the workspace,
 * so it is always allowed and never approval-gated. The composer capsule
 * renders the latest plan instead of dumping every tool invocation.
 */
export const CHAT_PLAN_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'update_task_plan',
    description:
      'Maintain the user-visible task checklist for THIS run. Call it when a request needs 2+ distinct steps: once at the start with all steps (first step in_progress), then again whenever a step completes or plans change (send the FULL list each time, including descriptions, not a diff). Give each step a short imperative title (≤40 chars) AND a concrete description of its scope, target files/modules, checks or expected output. Avoid vague steps such as "test functionality" without saying what to test. Do NOT use it for single-step answers.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'status'],
            properties: {
              title: { type: 'string', description: 'Short imperative step title' },
              description: {
                type: 'string',
                maxLength: 400,
                description:
                  'Concrete scope, target files/modules, checks or expected output for this step; preserve it on status updates.',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
              },
            },
          },
        },
      },
    },
  },
  {
    name: 'TaskCreate',
    description:
      'Create one persisted task in the current workspace checklist (NewMax-style). Returns the created task with its id. Use for multi-step work that should survive across conversations; keep titles short and imperative.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Short imperative task title (≤80 chars)' },
        description: { type: 'string', description: 'Optional detail' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Default medium',
        },
        dependsOn: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task ids this task depends on (optional DAG edges)',
        },
      },
    },
  },
  {
    name: 'TaskUpdate',
    description:
      'Update an existing persisted task (status, priority, title, order). Lifecycle timestamps follow status transitions automatically (in_progress sets actual start, completed/cancelled sets actual end). Returns the updated task.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: { type: 'string', description: 'Task id returned by TaskCreate/TaskList' },
        title: { type: 'string' },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        sortOrder: { type: 'number', description: 'Position in the checklist (ascending)' },
      },
    },
  },
  {
    name: 'TaskList',
    description:
      'List the current workspace task checklist (persisted, ordered). Returns every task with id/title/status/priority/dependencies. Call this before TaskUpdate to resolve task ids; also useful to plan the next step.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        statuses: {
          type: 'array',
          items: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
          description: 'Optional status filter',
        },
      },
    },
  },
];

export const CHAT_PLAN_TOOL_NAMES = new Set(CHAT_PLAN_TOOL_SCHEMAS.map((tool) => tool.name));
export const CHAT_TASK_PLAN_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList']);

/**
 * Persisted task-plan execution (NewMax-style). Each result echoes a `plan`
 * snapshot ({items, completed, total}) so the renderer capsule keeps working
 * through the same tool.completed event extraction as update_task_plan.
 */
export interface ChatTaskPlanSnapshot {
  items: ChatPlanItem[];
  completed: number;
  total: number;
}

function toSnapshot(
  store: {
    list(
      workspaceId: string,
      options?: { statuses?: readonly string[] },
    ): Array<{
      id: string;
      title: string;
      description?: string;
      status: string;
      priority: string;
      dependsOn: string[];
    }>;
  },
  workspaceId: string,
): ChatTaskPlanSnapshot {
  const rows = store.list(workspaceId, { statuses: ['pending', 'in_progress', 'completed'] });
  const items: ChatTaskPlanSnapshot['items'] = rows.map((row) => ({
    title: row.title,
    ...(row.description?.trim() ? { description: row.description.trim() } : {}),
    status: row.status === 'in_progress' || row.status === 'completed' ? row.status : 'pending',
  }));
  return {
    items,
    completed: items.filter((item) => item.status === 'completed').length,
    total: items.length,
  };
}

function fail(tool: string, message: string): string {
  return JSON.stringify({ ok: false, error: `${tool}: ${message}` });
}

function readJson(argumentsJson: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(argumentsJson || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function executeTaskCreateTool(
  argumentsJson: string,
  workspaceId: string,
  store: {
    create(input: {
      workspaceId: string;
      title: string;
      description?: string;
      priority?: string;
      status?: string;
      dependsOn?: readonly string[];
    }): { id: string; title: string; status: string; priority: string; dependsOn: string[] };
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
  },
): string {
  const args = readJson(argumentsJson);
  if (!args || typeof args.title !== 'string' || !args.title.trim()) {
    return fail('TaskCreate', 'title is required.');
  }
  if (!workspaceId) return fail('TaskCreate', 'no active workspace.');
  const task = store.create({
    workspaceId,
    title: args.title.trim().slice(0, 80),
    description: typeof args.description === 'string' ? args.description.trim().slice(0, 400) : '',
    priority: args.priority === 'low' || args.priority === 'high' ? args.priority : 'medium',
    dependsOn: Array.isArray(args.dependsOn)
      ? args.dependsOn.filter((v): v is string => typeof v === 'string').slice(0, 20)
      : undefined,
  });
  return JSON.stringify({
    ok: true,
    task: {
      taskId: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dependsOn: task.dependsOn,
    },
    plan: toSnapshot(store, workspaceId),
  });
}

export function executeTaskUpdateTool(
  argumentsJson: string,
  store: {
    update(input: {
      taskId: string;
      title?: string;
      status?: string;
      priority?: string;
      sortOrder?: number;
    }):
      | { id: string; title: string; status: string; priority: string; dependsOn: string[] }
      | undefined;
    get(taskId: string): { workspaceId: string } | undefined;
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
  },
): string {
  const args = readJson(argumentsJson);
  if (!args || typeof args.taskId !== 'string' || !args.taskId.trim()) {
    return fail('TaskUpdate', 'taskId is required.');
  }
  const existing = store.get(args.taskId.trim());
  if (!existing) return fail('TaskUpdate', `task not found: ${args.taskId}`);
  const updated = store.update({
    taskId: args.taskId.trim(),
    title:
      typeof args.title === 'string' && args.title.trim()
        ? args.title.trim().slice(0, 80)
        : undefined,
    status:
      args.status === 'pending' ||
      args.status === 'in_progress' ||
      args.status === 'completed' ||
      args.status === 'cancelled'
        ? args.status
        : undefined,
    priority:
      args.priority === 'low' || args.priority === 'high'
        ? args.priority
        : args.priority === 'medium'
          ? 'medium'
          : undefined,
    sortOrder:
      typeof args.sortOrder === 'number' && Number.isFinite(args.sortOrder)
        ? Math.trunc(args.sortOrder)
        : undefined,
  });
  if (!updated) return fail('TaskUpdate', 'update failed.');
  return JSON.stringify({
    ok: true,
    task: {
      taskId: updated.id,
      title: updated.title,
      status: updated.status,
      priority: updated.priority,
      dependsOn: updated.dependsOn,
    },
    plan: toSnapshot(store, existing.workspaceId),
  });
}

export function executeTaskListTool(
  argumentsJson: string,
  workspaceId: string,
  store: {
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
  },
): string {
  const args = readJson(argumentsJson);
  const statuses = Array.isArray(args?.statuses)
    ? args.statuses.filter(
        (v): v is string =>
          typeof v === 'string' &&
          (v === 'pending' || v === 'in_progress' || v === 'completed' || v === 'cancelled'),
      )
    : undefined;
  if (!workspaceId) return fail('TaskList', 'no active workspace.');
  const rows = store.list(workspaceId, statuses ? { statuses } : undefined);
  return JSON.stringify({
    ok: true,
    tasks: rows.map((row) => ({
      taskId: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      dependsOn: row.dependsOn,
    })),
    plan: toSnapshot(store, workspaceId),
  });
}

/**
 * Browser Automation Studio tools operate on local Workflow metadata. They are
 * independent from live browsing/network access: list/get are read-only, while
 * create only creates an AI-source Draft that still needs recording and review.
 */
export const CHAT_BROWSER_WORKFLOW_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'browser_workflow_list',
    description:
      'List real Browser Automation tasks stored in SYNC-THINK, together with available Browser Profiles. Use this when the user asks which browser automation tasks/workflows exist.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: { type: 'string', description: 'Optional Browser Profile id filter.' },
        status: {
          type: 'string',
          enum: ['draft', 'pending_review', 'enabled', 'disabled', 'failed'],
        },
        query: { type: 'string', description: 'Optional name/instruction/URL search text.' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'browser_workflow_get',
    description:
      'Get one Browser Automation task with its current Draft and published immutable WorkflowVersion when present.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: { type: 'string', description: 'Exact automation task id.' },
      },
    },
  },
  {
    name: 'browser_workflow_create_draft',
    description:
      'Create an AI-source Browser Automation Draft. This does NOT record browser actions or publish a workflow; the user must record it in Browser Automation, submit it for review, and approve it before publishing.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'instruction', 'startUrl'],
      properties: {
        profileId: {
          type: 'string',
          description: 'Optional Browser Profile id. Defaults to the default Profile.',
        },
        name: { type: 'string', description: 'Automation task title.' },
        instruction: {
          type: 'string',
          description: 'Natural-language goal that the recording should accomplish.',
        },
        startUrl: { type: 'string', description: 'Absolute http(s) recording start URL.' },
      },
    },
  },
  {
    name: 'browser_workflow_execute',
    description:
      'Execute a published Browser Automation Workflow (an approved Version) against its Profile. Each navigation origin must already have a workflow-scope approval grant; if a grant is missing the tool returns approval-required before any browser side effect. If the Workflow references variables, pass their values in the variables object; if any variable is missing the tool returns the list of required variable names before any browser side effect. The steps replay on the persistent Profile page.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: {
        taskId: {
          type: 'string',
          description:
            'Exact automation task id. The latest published Version of this task is executed.',
        },
        variables: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional variable values for variable-marked recorded inputs (e.g. {"keyword":"cat names"}).',
        },
      },
    },
  },
];

export const CHAT_BROWSER_WORKFLOW_TOOL_NAMES = new Set(
  CHAT_BROWSER_WORKFLOW_TOOL_SCHEMAS.map((tool) => tool.name),
);

export const CHAT_BROWSER_WORKFLOW_MUTATING_TOOL_NAMES = new Set(['browser_workflow_create_draft']);

export interface ChatBrowserWorkflowService {
  listProfiles(): readonly BrowserProfileSummary[];
  listWorkflows(input: ListBrowserWorkflowsPayload): BrowserAutomationTaskSummary[];
  getWorkflow(input: { taskId: string }): GetBrowserWorkflowResponse;
  createDraft(input: CreateBrowserWorkflowDraftPayload): CreateBrowserWorkflowDraftResponse;
}

export function executeChatBrowserWorkflowTool(input: {
  toolName: string;
  argumentsJson: string;
  service: ChatBrowserWorkflowService;
}): string {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(input.argumentsJson || '{}');
    } catch {
      return JSON.stringify({
        ok: false,
        error: `${input.toolName}: invalid JSON arguments.`,
      });
    }

    if (input.toolName === 'browser_workflow_list') {
      const payload = parseListBrowserWorkflowsPayload(raw);
      if (!payload) {
        return JSON.stringify({
          ok: false,
          error: 'browser_workflow_list: invalid arguments.',
        });
      }
      const tasks = input.service.listWorkflows(payload);
      const profiles = input.service.listProfiles();
      return JSON.stringify({
        ok: true,
        tasks,
        profiles,
        taskCount: tasks.length,
        note: 'These are stored Browser automation tasks, not open browser windows or recording sessions.',
      });
    }

    if (input.toolName === 'browser_workflow_get') {
      const payload = parseGetBrowserWorkflowPayload(raw);
      if (!payload) {
        return JSON.stringify({
          ok: false,
          error: 'browser_workflow_get: taskId is required.',
        });
      }
      return JSON.stringify({
        ok: true,
        ...input.service.getWorkflow(payload),
      });
    }

    if (input.toolName === 'browser_workflow_create_draft') {
      const profiles = input.service.listProfiles();
      const rawRecord =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      const requestedProfileId =
        typeof rawRecord.profileId === 'string' ? rawRecord.profileId.trim() : '';
      const defaultProfile = profiles.find((profile) => profile.isDefault) ?? profiles[0];
      const profileId = requestedProfileId || defaultProfile?.id;
      if (!profileId) {
        return JSON.stringify({
          ok: false,
          error:
            'browser_workflow_create_draft: no Browser Profile is available. Create a Profile first.',
        });
      }
      const payload = parseCreateBrowserWorkflowDraftPayload({
        ...rawRecord,
        profileId,
        source: 'ai',
      });
      if (!payload) {
        return JSON.stringify({
          ok: false,
          error:
            'browser_workflow_create_draft: name, instruction, and an absolute http(s) startUrl are required.',
        });
      }
      const created = input.service.createDraft(payload);
      return JSON.stringify({
        ok: true,
        ...created,
        nextStep:
          'Open Browser Automation, record the workflow, then submit it for review before publishing.',
      });
    }

    return JSON.stringify({
      ok: false,
      error: `Unknown Browser Workflow tool: ${input.toolName}`,
    });
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Browser Workflow tool failed.',
    });
  }
}

/**
 * Browser tools drive a visible system Edge/Chrome through the Runtime-owned
 * Browser Worker. The Renderer webview only mirrors browser_open URLs as a
 * preview; it is not part of the automation authority path.
 */
export const CHAT_BROWSER_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'browser_open',
    description:
      'Open an http(s) URL in the visible Sync-Think system-browser Profile. This also supplies the URL to the right-side preview. Use browser_read to inspect the live page and browser_click/browser_type to operate it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to display' },
      },
    },
  },
  {
    name: 'browser_click',
    description:
      'Click a visible element on the current system-browser Page. Provide a CSS selector, visible text (or Playwright a:has-text("...") / text=...), or x/y viewport coordinates. The Page must already be opened with browser_open. Use browser_read afterwards to verify the result.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector, or a Playwright text locator such as a:has-text("Open") / text=Open',
        },
        text: {
          type: 'string',
          description: 'Visible link/button text to click when CSS is unknown or ambiguous',
        },
        x: {
          type: 'integer',
          minimum: 0,
          description: 'Viewport X coordinate (with y, when no selector or text)',
        },
        y: {
          type: 'integer',
          minimum: 0,
          description: 'Viewport Y coordinate (with x, when no selector or text)',
        },
      },
    },
  },
  {
    name: 'browser_type',
    description:
      'Fill an input, textarea, or contentEditable element on the current system-browser Page. The Page must already be opened with browser_open.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['selector', 'text'],
      properties: {
        selector: { type: 'string', description: 'CSS selector of the editable element' },
        text: { type: 'string', description: 'Text to type (replaces current value)' },
      },
    },
  },
  {
    name: 'browser_read',
    description:
      'Read the current system-browser Page: returns title, URL, bounded visible text, and link/button/input summaries. Optional CSS selector narrows the result. This sees persistent logged-in and JavaScript-rendered state.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        selector: {
          type: 'string',
          description: 'Optional CSS selector; omit to read the whole page',
        },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description:
      'Capture a PNG of the current system-browser Page under the bound project .sync-think/screenshots directory. Returns an embedUrl for markdown. Requires a bound project folder and an open Page.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
];

export const CHAT_BROWSER_TOOL_NAMES = new Set(CHAT_BROWSER_TOOL_SCHEMAS.map((tool) => tool.name));

/** Browser command tools that operate an already-open Page (not browser_open). */
export const CHAT_BROWSER_COMMAND_TOOL_NAMES = new Set([
  'browser_click',
  'browser_type',
  'browser_read',
  'browser_screenshot',
]);

/** Browser Worker result retained for the Provider is capped to roughly 64KB. */
export const BROWSER_COMMAND_RESULT_MAX_CHARS = 64_000;

/** Hard timeout for one Browser Worker action. */
export const BROWSER_COMMAND_TIMEOUT_MS = 30_000;

export interface ChatBrowserCommand {
  action: 'browser_click' | 'browser_type' | 'browser_read' | 'browser_screenshot';
  args: Record<string, unknown>;
}

/**
 * Validate arguments for commands that operate an already-open Browser Page.
 */
export function validateChatBrowserCommand(
  toolName: string,
  argumentsJson: string,
): { ok: true; command: ChatBrowserCommand } | { ok: false; error: string } {
  if (!CHAT_BROWSER_COMMAND_TOOL_NAMES.has(toolName)) {
    return { ok: false, error: `${toolName}: not a browser command tool.` };
  }
  let parsed: Record<string, unknown>;
  try {
    const raw = JSON.parse(argumentsJson || '{}') as unknown;
    parsed =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return { ok: false, error: `${toolName}: invalid JSON arguments.` };
  }

  if (toolName === 'browser_click') {
    const selector = typeof parsed.selector === 'string' ? parsed.selector.trim() : '';
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    const x =
      typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? Math.round(parsed.x) : undefined;
    const y =
      typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? Math.round(parsed.y) : undefined;
    const target = resolveBrowserClickTarget({
      ...(selector ? { selector } : {}),
      ...(text ? { text } : {}),
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
    });
    if (!target.css && !target.text && (target.x === undefined || target.y === undefined)) {
      return {
        ok: false,
        error:
          'browser_click: provide a CSS selector, visible text, or both x and y viewport coordinates.',
      };
    }
    if ((target.css?.length ?? 0) > 500) {
      return { ok: false, error: 'browser_click: selector too long (max 500 chars).' };
    }
    if ((target.text?.length ?? 0) > 200) {
      return { ok: false, error: 'browser_click: text too long (max 200 chars).' };
    }
    if (target.x !== undefined && (target.x < 0 || target.x > 20_000)) {
      return { ok: false, error: 'browser_click: x out of range.' };
    }
    if (target.y !== undefined && (target.y < 0 || target.y > 20_000)) {
      return { ok: false, error: 'browser_click: y out of range.' };
    }
    return {
      ok: true,
      command: {
        action: 'browser_click',
        args: {
          ...(target.css ? { selector: target.css } : {}),
          ...(target.text ? { text: target.text } : {}),
          ...(target.x !== undefined ? { x: target.x } : {}),
          ...(target.y !== undefined ? { y: target.y } : {}),
        },
      },
    };
  }

  if (toolName === 'browser_type') {
    const selector = typeof parsed.selector === 'string' ? parsed.selector.trim() : '';
    const text = typeof parsed.text === 'string' ? parsed.text : undefined;
    if (!selector) return { ok: false, error: 'browser_type: selector is required.' };
    if (selector.length > 500) {
      return { ok: false, error: 'browser_type: selector too long (max 500 chars).' };
    }
    if (text === undefined) return { ok: false, error: 'browser_type: text is required.' };
    if (text.length > 4_000) {
      return { ok: false, error: 'browser_type: text too long (max 4000 chars).' };
    }
    return { ok: true, command: { action: 'browser_type', args: { selector, text } } };
  }

  if (toolName === 'browser_read') {
    const selector = typeof parsed.selector === 'string' ? parsed.selector.trim() : '';
    if (selector.length > 500) {
      return { ok: false, error: 'browser_read: selector too long (max 500 chars).' };
    }
    return {
      ok: true,
      command: { action: 'browser_read', args: selector ? { selector } : {} },
    };
  }

  // browser_screenshot: no arguments.
  return { ok: true, command: { action: 'browser_screenshot', args: {} } };
}

export function validateChatBrowserOpen(
  argumentsJson: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson || '{}');
  } catch {
    return { ok: false, error: 'browser_open: invalid JSON arguments.' };
  }
  const url = String((parsed as { url?: unknown })?.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'browser_open: only absolute http(s) URLs are allowed.' };
  }
  if (url.length > 2048) {
    return { ok: false, error: 'browser_open: URL too long (max 2048 chars).' };
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { ok: false, error: 'browser_open: only absolute http(s) URLs are allowed.' };
    }
  } catch {
    return { ok: false, error: 'browser_open: invalid URL.' };
  }
  return { ok: true, url };
}

/** Compatibility wrapper used by existing validation tests and callers. */
export function executeChatBrowserTool(argumentsJson: string): string {
  const validated = validateChatBrowserOpen(argumentsJson);
  if (!validated.ok) return JSON.stringify({ ok: false, error: validated.error });
  return JSON.stringify({
    ok: true,
    url: validated.url,
    note: 'Validated for the Runtime Browser Worker.',
  });
}

export interface ChatPlanItem {
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/**
 * Execute update_task_plan: validate + normalize the checklist. The result is
 * echoed back through tool.completed so the renderer can project the latest
 * plan into the composer capsule. No side effects beyond the event stream.
 */
export function executeChatPlanTool(argumentsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson || '{}');
  } catch {
    return JSON.stringify({ ok: false, error: 'update_task_plan: invalid JSON arguments.' });
  }
  const rawItems = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return JSON.stringify({
      ok: false,
      error: 'update_task_plan: items must be a non-empty array.',
    });
  }
  const items: ChatPlanItem[] = [];
  for (const raw of rawItems.slice(0, 20)) {
    const rec = raw as { title?: unknown; description?: unknown; status?: unknown };
    const title = typeof rec?.title === 'string' ? rec.title.trim().slice(0, 80) : '';
    if (!title) continue;
    const status =
      rec.status === 'in_progress' || rec.status === 'completed' ? rec.status : 'pending';
    const description =
      typeof rec.description === 'string' ? rec.description.trim().slice(0, 400) : '';
    items.push({ title, ...(description ? { description } : {}), status });
  }
  if (items.length === 0) {
    return JSON.stringify({ ok: false, error: 'update_task_plan: no valid items.' });
  }
  const completed = items.filter((item) => item.status === 'completed').length;
  return JSON.stringify({ ok: true, plan: { items, completed, total: items.length } });
}

export const CHAT_SKILL_TOOL_NAMES = new Set(CHAT_SKILL_TOOL_SCHEMAS.map((tool) => tool.name));

export const CHAT_AGENT_TOOL_NAMES = new Set(CHAT_AGENT_TOOL_SCHEMAS.map((tool) => tool.name));

/** Agent tools that mutate the Agent Library (approval-gated outside full-access). */
export const CHAT_AGENT_MUTATING_TOOL_NAMES = new Set([
  'create_agent',
  'update_agent',
  'archive_agent',
  'create_skill',
  'update_skill',
  'delete_skill',
  'import_remote_skill',
  'register_remote_mcp',
  'create_team',
  'update_team',
  'delete_team',
]);

/** Network tools — only exposed when Compose 联网 is on for this turn. */
export const CHAT_NETWORK_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'web_search',
    description:
      'Search the public web for up-to-date information. Returns a short list of titles, URLs, and snippets. Use when the user asks about current events, facts you are unsure about, or anything that needs live internet data.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query in natural language' },
        limit: { type: 'integer', minimum: 1, maximum: 8 },
        provider: {
          type: 'string',
          enum: [
            'auto',
            'tavily',
            'exa',
            'brave',
            'serpapi',
            'serper',
            'bing',
            'google',
            'firecrawl',
            'metaso',
            'doubao',
          ],
          description: 'Optional configured provider; auto follows the saved priority order',
        },
        allowed_domains: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string' },
          description: 'Only return results from these domains',
        },
        blocked_domains: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string' },
          description: 'Exclude results from these domains',
        },
      },
    },
  },
  {
    name: 'web_fetch',
    description:
      'Fetch a public HTTP(S) page and return plain text (HTML tags stripped). Use after web_search to read a specific result, or when the user provides a URL.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL' },
        maxChars: { type: 'integer', minimum: 500, maximum: 50_000 },
      },
    },
  },
];

export const CHAT_NETWORK_TOOL_NAMES = new Set(CHAT_NETWORK_TOOL_SCHEMAS.map((tool) => tool.name));

/** Tools that only observe the workspace (safe under「询问批准」). */
export const CHAT_READ_ONLY_TOOL_NAMES = new Set([
  'read_file',
  'list_files',
  'search_files',
  'git_status',
  'git_diff',
  'web_search',
  'web_fetch',
  'list_agent_resources',
  'list_skills',
  'read_skill',
  'list_mcp_tools',
  'list_teams',
  'update_task_plan',
  'browser_workflow_list',
  'browser_workflow_get',
  // Browser panel tools: the page is operated in front of the user (visible,
  // stoppable), so click/type/read/screenshot are display-class, not gated.
  'browser_open',
  'browser_click',
  'browser_type',
  'browser_read',
  'browser_screenshot',
]);

/** Tools that mutate the workspace or execute commands. */
export const CHAT_MUTATING_TOOL_NAMES = new Set(['write_file', 'run_command']);

export type ChatExecutionMode = 'ask' | 'workspace' | 'full-access';

/** Normalize conversation.executionMode strings (incl. legacy aliases). */
export function normalizeChatExecutionMode(mode: string | undefined | null): ChatExecutionMode {
  const value = (mode ?? 'workspace').trim().toLowerCase();
  if (value === 'ask' || value === 'read-only' || value === 'readonly' || value === 'read_only') {
    return 'ask';
  }
  if (
    value === 'full-access' ||
    value === 'full' ||
    value === 'full_access' ||
    value === 'unrestricted'
  ) {
    return 'full-access';
  }
  return 'workspace';
}

/**
 * Tools exposed to the model for the bound project.
 * 「询问批准」仍暴露写/命令工具——执行前会挂起等人确认，而不是直接隐藏。
 * networkEnabled 时追加 web_search / web_fetch（不依赖项目文件夹）。
 */
export function toolsForExecutionMode(
  _mode: string | undefined | null,
  options: {
    networkEnabled?: boolean;
    /** False when keyword search is provided by the model host or unavailable. */
    includeWebSearchTools?: boolean;
    includeProjectTools?: boolean;
    /** Agent-management tools (create_agent / list_agent_resources). */
    includeAgentTools?: boolean;
    /** Built-in Computer Use tools backed by Windows UI Automation. */
    includeDesktopTools?: boolean;
    /** Local Browser Automation task/Draft tools. */
    includeBrowserWorkflowTools?: boolean;
    /** Runtime-local enabled MCP catalog introspection. */
    includeMcpCatalogTools?: boolean;
    /** Remote MCP registry mutation tool. */
    includeMcpRegistryTools?: boolean;
    /** Extra provider tools (e.g. MCP schemas) appended after built-ins. */
    extraTools?: readonly ProviderToolSchema[];
  } = {},
): readonly ProviderToolSchema[] {
  const includeProject = options.includeProjectTools !== false;
  const tools: ProviderToolSchema[] = includeProject ? [...CHAT_BUILT_IN_TOOL_SCHEMAS] : [];
  // Task-plan tool is always available — pure UI signal, no workspace access.
  tools.push(...CHAT_PLAN_TOOL_SCHEMAS);
  if (options.includeBrowserWorkflowTools) {
    tools.push(...CHAT_BROWSER_WORKFLOW_TOOL_SCHEMAS);
  }
  if (options.networkEnabled) {
    tools.push(
      ...(options.includeWebSearchTools === false
        ? CHAT_NETWORK_TOOL_SCHEMAS.filter((tool) => tool.name !== 'web_search')
        : CHAT_NETWORK_TOOL_SCHEMAS),
    );
    // Browser panel tool rides on the same 联网 switch — it displays public
    // pages, so it should not exist when the user has networking off.
    tools.push(...CHAT_BROWSER_TOOL_SCHEMAS);
  }
  if (options.includeAgentTools) {
    tools.push(...CHAT_AGENT_TOOL_SCHEMAS);
    tools.push(...CHAT_SKILL_TOOL_SCHEMAS);
    tools.push(...CHAT_TEAM_TOOL_SCHEMAS);
  }
  if (options.includeMcpCatalogTools) {
    tools.push(...CHAT_MCP_CATALOG_TOOL_SCHEMAS);
  }
  if (options.includeMcpRegistryTools) {
    tools.push(...CHAT_MCP_REGISTRY_TOOL_SCHEMAS);
  }
  if (options.includeDesktopTools) {
    tools.push(...CHAT_DESKTOP_TOOL_SCHEMAS);
  }
  if (options.extraTools && options.extraTools.length > 0) {
    const seen = new Set(tools.map((t) => t.name));
    for (const tool of options.extraTools) {
      const name = String(tool.name ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      tools.push(tool);
    }
  }
  return tools;
}

/** Build provider tool schemas from MCP server registry rows. */
export function mcpToolsToProviderSchemas(
  servers: readonly {
    id: string;
    name: string;
    tools: readonly {
      name: string;
      description?: string;
      inputSchemaJson?: string;
    }[];
  }[],
  options: { maxTools?: number } = {},
): {
  tools: ProviderToolSchema[];
  /** Map provider tool name → { mcpServerId, toolName } for dispatch. */
  dispatch: Map<string, { mcpServerId: string; toolName: string }>;
} {
  const maxTools = Math.min(Math.max(options.maxTools ?? 16, 0), 32);
  const tools: ProviderToolSchema[] = [];
  const dispatch = new Map<string, { mcpServerId: string; toolName: string }>();
  const usedNames = new Set<string>();

  for (const server of servers) {
    if (tools.length >= maxTools) break;
    for (const tool of server.tools) {
      if (tools.length >= maxTools) break;
      const toolName = String(tool.name ?? '').trim();
      if (!toolName) continue;
      // Prefer mcp__{serverId}__{tool} to avoid colliding with built-ins.
      let providerName = `mcp__${server.id}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (usedNames.has(providerName) || providerName.length > 64) {
        providerName = `mcp_${tools.length}_${toolName}`
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 64);
      }
      if (usedNames.has(providerName)) continue;
      usedNames.add(providerName);

      let inputSchema: Record<string, unknown> = {
        type: 'object',
        additionalProperties: true,
        properties: {},
      };
      if (tool.inputSchemaJson) {
        try {
          const parsed = JSON.parse(tool.inputSchemaJson) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            inputSchema = parsed as Record<string, unknown>;
          }
        } catch {
          // keep default schema
        }
      }
      tools.push({
        name: providerName,
        description:
          tool.description?.trim() ||
          `MCP tool ${toolName} from server ${server.name || server.id}`,
        inputSchema,
      });
      dispatch.set(providerName, { mcpServerId: server.id, toolName });
    }
  }
  return { tools, dispatch };
}

/** Parse mcp__serverId__toolName style names (also accepts plain names via dispatch map). */
export function parseMcpProviderToolName(
  name: string,
): { mcpServerId: string; toolName: string } | undefined {
  const raw = String(name ?? '').trim();
  if (!raw.startsWith('mcp__')) return undefined;
  const rest = raw.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  if (sep <= 0) return undefined;
  const mcpServerId = rest.slice(0, sep);
  const toolName = rest.slice(sep + 2);
  if (!mcpServerId || !toolName) return undefined;
  return { mcpServerId, toolName };
}

/** Mutating desktop/workspace tools in ask mode require explicit approval. */
export function chatToolRequiresApproval(
  mode: string | undefined | null,
  toolName: string,
): boolean {
  const normalized = normalizeChatExecutionMode(mode);
  if (CHAT_BROWSER_WORKFLOW_MUTATING_TOOL_NAMES.has(toolName)) {
    return normalized === 'ask';
  }
  if (CHAT_AGENT_MUTATING_TOOL_NAMES.has(toolName)) {
    // Agent Library mutations require approval outside full-access.
    return normalized !== 'full-access';
  }
  if (CHAT_DESKTOP_MUTATING_TOOL_NAMES.has(toolName)) {
    return normalized === 'ask';
  }
  return normalized === 'ask' && CHAT_MUTATING_TOOL_NAMES.has(toolName);
}

/**
 * Host platform infrastructure tools: always allowed on every permission mode.
 * These are the tools the host itself runs (ask the user, submit a plan,
 * manage goals/tasks, list platform context) — they are approval:never in the
 * platform catalog and their executors already carry their own user-facing
 * cards / fences. Gating them behind isChatToolAllowed would deny ask_user_question
 * outside full-access (observed: "当前权限不允许执行工具 ask_user_question" in
 * ask/workspace modes), so the model could never ask the user a question.
 */
export const HOST_PLATFORM_ALWAYS_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'platform_context',
  'ask_user_question',
  'plan_submit',
  'goal_manage',
  'task_list',
  'agent_list',
  'task_schedule',
  DESCRIBE_IMAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  SEARCH_CAPABILITY_TOOL_NAME,
  USE_CAPABILITY_TOOL_NAME,
  WINDOWS_OCR_TOOL_NAME,
]);

/** Hard block (not used for ask anymore — ask waits for approval). */
export function isChatToolAllowed(
  mode: string | undefined | null,
  toolName: string,
  options: {
    networkEnabled?: boolean;
    desktopEnabled?: boolean;
    browserWorkflowEnabled?: boolean;
  } = {},
): boolean {
  // All built-in project tools are allowed once the user has approved (ask)
  // or when mode is workspace/full-access.
  void mode;
  // Host platform infrastructure tools are exempt from the permission gate —
  // their executors surface their own cards (ask_user_question → ask card).
  if (HOST_PLATFORM_ALWAYS_ALLOWED_TOOLS.has(toolName)) return true;
  if (CHAT_BUILT_IN_TOOL_SCHEMAS.some((tool) => tool.name === toolName)) return true;
  if (options.networkEnabled && CHAT_NETWORK_TOOL_NAMES.has(toolName)) return true;
  // Agent tools: create_agent is gated by chatToolRequiresApproval (approval card
  // outside full-access); once approved — or in full-access — it is allowed.
  if (CHAT_AGENT_TOOL_NAMES.has(toolName)) return true;
  // Skill tools share the same gate (mutations approval-gated outside full-access).
  if (CHAT_SKILL_TOOL_NAMES.has(toolName)) return true;
  // Team tools share the same gate (mutations approval-gated outside full-access).
  if (CHAT_TEAM_TOOL_NAMES.has(toolName)) return true;
  if (CHAT_MCP_CATALOG_TOOL_NAMES.has(toolName)) return true;
  if (CHAT_MCP_REGISTRY_TOOL_NAMES.has(toolName)) return true;
  // Task-plan tool: pure UI signal, always allowed.
  if (CHAT_PLAN_TOOL_NAMES.has(toolName)) return true;
  // Browser Automation Studio tools are local and do not depend on networking.
  if (options.browserWorkflowEnabled && CHAT_BROWSER_WORKFLOW_TOOL_NAMES.has(toolName)) return true;
  // Browser panel tool: gated by the same 联网 switch as web tools.
  if (options.networkEnabled && CHAT_BROWSER_TOOL_NAMES.has(toolName)) return true;
  // Desktop tools exist only while the built-in Computer Use plugin is enabled.
  if (options.desktopEnabled && CHAT_DESKTOP_TOOL_NAMES.has(toolName)) return true;
  // MCP tools exposed as mcp__server__tool are allowed when bound on the run.
  if (parseMcpProviderToolName(toolName)) return true;
  return false;
}

export function chatToolDeniedMessage(
  mode: string | undefined | null,
  toolName: string,
  reason: 'denied' | 'blocked' = 'denied',
): string {
  const normalized = normalizeChatExecutionMode(mode);
  if (toolName === 'browser_workflow_create_draft') {
    return reason === 'denied'
      ? '用户拒绝了创建浏览器自动化草稿。不要重试；把任务名称、目标和起始网址整理给用户，让其手动到「浏览器自动化」创建。'
      : '当前权限为「询问批准」，创建浏览器自动化草稿需要用户确认后才能执行。';
  }
  if (CHAT_DESKTOP_MUTATING_TOOL_NAMES.has(toolName)) {
    const action =
      toolName === 'desktop_launch_app'
        ? '启动桌面应用'
        : toolName === 'desktop_set_value'
          ? '修改桌面控件内容'
          : toolName === 'desktop_invoke_element'
            ? '触发桌面控件'
            : '聚焦桌面控件';
    return reason === 'denied'
      ? `用户拒绝了${action}。不要重试同一动作；说明原计划并等待用户指示。`
      : `当前权限为「询问批准」，${action}需要用户确认后才能执行。`;
  }
  if (CHAT_AGENT_MUTATING_TOOL_NAMES.has(toolName)) {
    const action =
      toolName === 'update_agent'
        ? '修改智能体'
        : toolName === 'archive_agent'
          ? '归档智能体'
          : toolName === 'create_skill'
            ? '创建 Skill'
            : toolName === 'update_skill'
              ? '更新 Skill'
              : toolName === 'delete_skill'
                ? '卸载 Skill'
                : toolName === 'import_remote_skill'
                  ? '导入远端 Skill'
                  : toolName === 'register_remote_mcp'
                    ? '注册远端 MCP'
                    : toolName === 'create_team'
                      ? '创建小队'
                      : toolName === 'update_team'
                        ? '修改小队'
                        : toolName === 'delete_team'
                          ? '删除小队'
                          : '创建智能体';
    if (reason === 'denied') {
      if (toolName === 'update_agent') {
        return '用户拒绝了修改智能体。不要重试；把变更草案（改了哪些字段、Skill 绑定前后对比）整理给用户，让其手动到「智能体库」修改。';
      }
      if (toolName === 'archive_agent') {
        return '用户拒绝了归档智能体。不要重试；说明你原本想归档的对象和理由，由用户自行到「智能体库」处理。';
      }
      if (
        toolName === 'create_skill' ||
        toolName === 'update_skill' ||
        toolName === 'import_remote_skill'
      ) {
        return '用户拒绝了写入 Skill。不要重试；把完整 SKILL.md 草案贴给用户，让其手动到「能力中心」导入。';
      }
      if (toolName === 'register_remote_mcp') {
        return '用户拒绝了注册远端 MCP。不要重试；把服务名称和端点整理给用户，让其手动到「能力中心」注册。';
      }
      if (toolName === 'delete_skill') {
        return '用户拒绝了卸载 Skill。不要重试；说明你原本想卸载的版本和理由，由用户自行到「能力中心」处理。';
      }
      if (toolName === 'create_team') {
        return '用户拒绝了创建小队。不要重试；把小队草案（名称/使命/策略/成员分工）整理给用户，让其手动到「小队库」创建。';
      }
      if (toolName === 'update_team') {
        return '用户拒绝了修改小队。不要重试；把变更草案（改了哪些字段、成员前后对比）整理给用户，让其手动到「小队库」修改。';
      }
      if (toolName === 'delete_team') {
        return '用户拒绝了删除小队。不要重试；说明你原本想删除的小队和理由，由用户自行到「小队库」处理。';
      }
      return '用户拒绝了创建智能体。不要重试；可以把智能体草案（名称/人设/模型/Skill）整理给用户，让其手动到「智能体库」创建。';
    }
    return `当前权限模式下，${action}需要用户先批准。`;
  }
  if (normalized === 'ask' && CHAT_MUTATING_TOOL_NAMES.has(toolName)) {
    return reason === 'denied'
      ? `用户拒绝了 ${toolName}。请改用只读方式，或请用户切换到「为我批准」。`
      : `当前权限为「询问批准」，${toolName} 需要用户确认后才能执行。`;
  }
  return `当前权限不允许执行工具 ${toolName}。`;
}

export function summarizeToolCallForApproval(
  toolName: string,
  argumentsJson: string,
): { title: string; detail: string; path?: string; command?: string } {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argumentsJson || '{}') as Record<string, unknown>;
  } catch {
    args = {};
  }
  const path =
    typeof args.path === 'string'
      ? args.path
      : typeof args.file === 'string'
        ? args.file
        : undefined;
  const command = typeof args.command === 'string' ? args.command : undefined;
  if (toolName === 'browser_workflow_create_draft') {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const startUrl = typeof args.startUrl === 'string' ? args.startUrl.trim() : '';
    let site = startUrl;
    try {
      site = new URL(startUrl).hostname || startUrl;
    } catch {
      // Keep the bounded raw value for a useful approval summary.
    }
    return {
      title: name ? `创建浏览器自动化草稿「${name}」` : '创建浏览器自动化草稿',
      detail: [
        site ? `站点：${site.slice(0, 120)}` : '',
        '仅创建草稿，仍需录制、提交审核并批准后才会发布',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'write_file') {
    const content = typeof args.content === 'string' ? args.content : '';
    const lines = content.split(/\r?\n/).length;
    return {
      title: path ? `写入文件 ${path}` : '写入文件',
      detail: content ? `约 ${lines} 行 · ${content.length} 字符` : '将修改项目内文件',
      path,
    };
  }
  if (toolName === 'run_command') {
    const argList = Array.isArray(args.args) ? args.args.map(String).join(' ') : '';
    const full = [command, argList].filter(Boolean).join(' ').trim();
    return {
      title: '执行命令',
      detail: full || '将在项目目录运行命令',
      command: full || command,
    };
  }
  if (toolName === 'create_agent') {
    const agentName = typeof args.name === 'string' ? args.name.trim() : '';
    const model =
      typeof args.defaultModelId === 'string' && args.defaultModelId.trim()
        ? args.defaultModelId.trim()
        : '当前对话模型';
    const skillCount = Array.isArray(args.skillIds) ? args.skillIds.length : 0;
    const personaText = typeof args.persona === 'string' ? args.persona.trim() : '';
    const personaBrief = personaText
      ? `人设：${personaText.length > 120 ? `${personaText.slice(0, 119)}…` : personaText}`
      : '';
    return {
      title: agentName ? `创建智能体「${agentName}」` : '创建智能体',
      detail: [
        `模型：${model}`,
        skillCount > 0 ? `Skill：${skillCount} 个` : 'Skill：无',
        personaBrief,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'update_agent') {
    const target = typeof args.agent === 'string' ? args.agent.trim() : '';
    const changed: string[] = [];
    if (typeof args.name === 'string') changed.push(`名称 → ${args.name.trim() || '（空）'}`);
    if (typeof args.persona === 'string') {
      const p = args.persona.trim();
      changed.push(`人设 → ${p.length > 60 ? `${p.slice(0, 59)}…` : p || '（清空）'}`);
    }
    if (typeof args.description === 'string') changed.push('简介');
    if (typeof args.defaultModelId === 'string' && args.defaultModelId.trim()) {
      changed.push(`模型 → ${args.defaultModelId.trim()}`);
    }
    if (Array.isArray(args.skillIds)) changed.push(`Skill 绑定 → ${args.skillIds.length} 个`);
    if (typeof args.reasoningEffort === 'string')
      changed.push(`推理力度 → ${args.reasoningEffort}`);
    return {
      title: target ? `修改智能体「${target}」` : '修改智能体',
      detail: changed.length > 0 ? `变更：${changed.join(' · ')}` : '未指定任何变更字段',
    };
  }
  if (toolName === 'archive_agent') {
    const target = typeof args.agent === 'string' ? args.agent.trim() : '';
    const reasonText = typeof args.reason === 'string' ? args.reason.trim() : '';
    return {
      title: target ? `归档智能体「${target}」` : '归档智能体',
      detail: [
        '软删除，可在智能体库恢复',
        reasonText
          ? `理由：${reasonText.length > 80 ? `${reasonText.slice(0, 79)}…` : reasonText}`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'create_skill' || toolName === 'update_skill') {
    const source = typeof args.skillMd === 'string' ? args.skillMd : '';
    const nameMatch = /^name:\s*(.+)$/m.exec(source);
    const versionMatch = /^version:\s*(.+)$/m.exec(source);
    const toolsMatch = /^allowed-tools:\s*(.+)$/m.exec(source);
    const skillName = nameMatch?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
    const version = versionMatch?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
    const lines = source.split(/\r?\n/).length;
    const verb = toolName === 'create_skill' ? '创建' : '更新';
    return {
      title: skillName ? `${verb} Skill「${skillName}」` : `${verb} Skill`,
      detail: [
        version ? `版本 ${version}` : '',
        `${lines} 行 · ${source.length} 字符`,
        toolsMatch ? `工具声明：${toolsMatch[1]!.trim().slice(0, 60)}` : '未声明工具权限',
        '仅解析文本，不执行脚本',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'import_remote_skill') {
    const url = typeof args.url === 'string' ? args.url.trim() : '';
    return {
      title: '导入远端 Skill',
      detail: [url ? `来源：${url.slice(0, 160)}` : '', '下载后只解析 SKILL.md，不执行脚本']
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'register_remote_mcp') {
    const name = typeof args.name === 'string' ? args.name.trim() : '';
    const endpoint = typeof args.endpoint === 'string' ? args.endpoint.trim() : '';
    return {
      title: name ? `注册远端 MCP「${name}」` : '注册远端 MCP',
      detail: [endpoint ? `端点：${endpoint.slice(0, 160)}` : '', '仅注册公开元数据，不接收密钥']
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'create_team') {
    const teamName = typeof args.name === 'string' ? args.name.trim() : '';
    const memberCount = Array.isArray(args.members) ? args.members.length : 0;
    const strategy = args.strategy === 'parallel' ? '并行' : '串行';
    const missionText = typeof args.mission === 'string' ? args.mission.trim() : '';
    const missionBrief = missionText
      ? `使命：${missionText.length > 120 ? `${missionText.slice(0, 119)}…` : missionText}`
      : '';
    return {
      title: teamName ? `创建小队「${teamName}」` : '创建小队',
      detail: [`策略：${strategy}`, `成员：${memberCount} 个`, missionBrief]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'update_team') {
    const target = typeof args.team === 'string' ? args.team.trim() : '';
    const changed: string[] = [];
    if (typeof args.name === 'string') changed.push(`名称 → ${args.name.trim() || '（空）'}`);
    if (typeof args.mission === 'string') {
      const m = args.mission.trim();
      changed.push(`使命 → ${m.length > 60 ? `${m.slice(0, 59)}…` : m || '（清空）'}`);
    }
    if (typeof args.strategy === 'string') {
      changed.push(`策略 → ${args.strategy === 'parallel' ? '并行' : '串行'}`);
    }
    if (typeof args.coordinatorAgent === 'string') changed.push('协调人');
    if (Array.isArray(args.members)) changed.push(`成员 → ${args.members.length} 个`);
    return {
      title: target ? `修改小队「${target}」` : '修改小队',
      detail: changed.length > 0 ? `变更：${changed.join(' · ')}` : '未指定任何变更字段',
    };
  }
  if (toolName === 'delete_team') {
    const target = typeof args.team === 'string' ? args.team.trim() : '';
    const reasonText = typeof args.reason === 'string' ? args.reason.trim() : '';
    return {
      title: target ? `删除小队「${target}」` : '删除小队',
      detail: [
        '仍被对话引用或已有运行记录时会被拒绝',
        reasonText
          ? `理由：${reasonText.length > 80 ? `${reasonText.slice(0, 79)}…` : reasonText}`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (toolName === 'delete_skill') {
    const versionId = typeof args.skillVersionId === 'string' ? args.skillVersionId.trim() : '';
    const reasonText = typeof args.reason === 'string' ? args.reason.trim() : '';
    return {
      title: '卸载 Skill 版本',
      detail: [
        versionId ? `版本 ID：${versionId.slice(0, 40)}` : '',
        '被智能体装备或待审批引用时会被拒绝',
        reasonText
          ? `理由：${reasonText.length > 80 ? `${reasonText.slice(0, 79)}…` : reasonText}`
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  // Kernel native built-ins (claude-code / codex SDK tools): these names are
  // PascalCase (Bash / Write / Read / Edit / MultiEdit / NotebookEdit / WebFetch)
  // and carry their own argument shapes. Without this branch an approval card
  // for `Bash` showed only "需要你的批准" — the user could not tell what command
  // or file was involved, so approving was blind.
  const kernelNativePath =
    typeof args.file_path === 'string'
      ? args.file_path
      : typeof args.notebook_path === 'string'
        ? args.notebook_path
        : typeof args.path === 'string'
          ? args.path
          : typeof args.file === 'string'
            ? args.file
            : undefined;
  const kernelNativeCommand =
    typeof args.command === 'string' && args.command.trim()
      ? args.command.trim()
      : typeof args.args === 'string'
        ? args.args
        : undefined;
  if (toolName === 'Bash' || toolName === 'run_command') {
    const argList = Array.isArray(args.args) ? args.args.map(String).join(' ') : '';
    const full = [kernelNativeCommand, argList].filter(Boolean).join(' ').trim();
    return {
      title: '执行命令',
      detail: full || '将在工作区运行命令',
      command: full || kernelNativeCommand,
    };
  }
  if (
    toolName === 'Write' ||
    toolName === 'Edit' ||
    toolName === 'MultiEdit' ||
    toolName === 'NotebookEdit'
  ) {
    const content = typeof args.content === 'string' ? args.content : '';
    const lines = content.split(/\r?\n/).length;
    const isDelete = toolName === 'MultiEdit' && args.old_string === '';
    return {
      title: `${isDelete ? '删除' : '写入/修改'}文件 ${kernelNativePath ?? '（未指定路径）'}`,
      detail: content ? `约 ${lines} 行 · ${content.length} 字符` : '将修改文件内容',
      path: kernelNativePath,
    };
  }
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
    return {
      title: `${toolName} ${kernelNativePath ?? ''}`.trim() || toolName,
      detail: '读取文件 / 目录（只读操作）',
      path: kernelNativePath,
    };
  }
  if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    const url = typeof args.url === 'string' ? args.url : undefined;
    return {
      title: url ? `${toolName} ${url.slice(0, 120)}` : toolName,
      detail: url ? `抓取 ${url.slice(0, 200)}` : '联网搜索 / 抓取页面',
    };
  }
  return {
    title: toolName,
    detail: path || command || '需要你的批准',
    path,
    command,
  };
}

const MAX_HISTORY_MESSAGES = 40;
const TOOL_OUTPUT_LIMIT_BYTES = 200_000;

/** Keep the newest N chat turns after a compact boundary. */
export const COMPACT_KEEP_RECENT_MESSAGES = 8;
/**
 * NewMax preventive compact ratio.
 * Source: NewMax app.asar `PREVENTIVE_COMPACT_WINDOW_RATIO=0.7`
 * and help docs ("约七成").
 */
export const COMPACT_AUTO_THRESHOLD = 0.7;
/** Soft estimate: ~4 chars per token for local occupancy checks. */
export const COMPACT_CHARS_PER_TOKEN = 4;
/**
 * NewMax preventive compact: collapse old tool outputs when they exceed this size.
 * Keeps a short head+tail so the model still sees structure without the full dump.
 */
export const COMPACT_TOOL_OUTPUT_FOLD_CHARS = 2_000;
/** Always keep the newest N tool results verbatim when folding. */
export const COMPACT_TOOL_OUTPUT_KEEP_RECENT = 2;

/**
 * Claude Code / NewMax compact summary prompt.
 * NewMax submits `/compact` to the long-lived CLI session; Claude Code then asks
 * the model for a structured summary (not a local truncation). We mirror that
 * prompt so SYNC-THINK can do the same via the bound provider.
 */
export const COMPACT_SUMMARY_SYSTEM_PROMPT = [
  'You are a helpful AI assistant tasked with summarizing conversations for context compaction.',
  'Respond with TEXT ONLY. Do NOT call any tools.',
  'Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.',
  'You already have all the context you need in the conversation below.',
].join('\n');

export const COMPACT_SUMMARY_USER_PROMPT_PREFIX = `Your task is to create a detailed summary of this conversation. This summary will be placed at the start of a continuing session; newer messages that build on this context will follow after your summary (you do not see them here). Summarize thoroughly so that someone reading only your summary and then the newer messages can fully understand what happened and continue the work.

Your summary should include the following sections:

1. Primary Request and Intent: Capture the user's explicit requests and intents in detail
2. Key Technical Concepts: List important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include important code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List errors encountered and how they were fixed.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. Preserve any security-relevant instructions or constraints verbatim so they remain in effect after compaction.
7. Pending Tasks: Outline any pending tasks.
8. Work Completed: Describe what was accomplished by the end of this portion.
9. Context for Continuing Work: Summarize any context, decisions, or state that would be needed to understand and continue the work in subsequent messages.

CRITICAL:
- Respond with TEXT ONLY. Do NOT call any tools.
- Be precise and thorough.
- Preserve security-relevant instructions and constraints verbatim.

Conversation to summarize:
`;

/** Instruction attached after the model summary so the next turn can resume cleanly. */
export const COMPACT_RESUME_INSTRUCTION =
  'Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.';

/**
 * Build multi-turn chat messages for the current thread from durable events.
 * Includes prior user/assistant turns so the model can "see" conversation context.
 */
export interface ChatImageInput {
  name?: string;
  mimeType?: string;
  dataUrl: string;
}

export interface CompactHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  sequence: number;
  messageId?: string;
}

export interface CompactThreadHistoryResult {
  /** Messages after the latest compact boundary (or all, if never compacted). */
  messages: CompactHistoryMessage[];
  /** Sequence of the latest context.compacted event, if any. */
  lastCompactSequence?: number;
  /** Estimated tokens currently represented by the retained transcript. */
  estimatedTokens: number;
  /** True when occupancy is at/above the auto-compact threshold. */
  shouldAutoCompact: boolean;
}

export interface BuildCompactSummaryInput {
  messages: readonly CompactHistoryMessage[];
  /** Keep this many newest turns verbatim after the summary. */
  keepRecent?: number;
  contextWindow?: number;
}

export interface BuildCompactSummaryResult {
  /** System/assistant summary text that replaces earlier history. */
  summaryText: string;
  /** Newest turns kept verbatim after the summary. */
  keptMessages: CompactHistoryMessage[];
  /** How many earlier messages were folded into the summary. */
  foldedCount: number;
  beforeTokens: number;
  afterTokens: number;
}

function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / COMPACT_CHARS_PER_TOKEN));
}

function estimateMessagesTokens(messages: readonly CompactHistoryMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokensFromText(message.content), 0);
}

function truncateForSummary(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Collect durable chat turns for a thread, honoring the latest compact boundary.
 * Tool outputs are not currently embedded as full chat turns here; they live in
 * tool events and are already truncated when re-fed during a live tool loop.
 */
/**
 * Minimum real reduction required before writing a compact boundary.
 * Prevents "success" that only clamps the display while occupancy grows.
 */
export const COMPACT_MIN_REDUCTION_RATIO = 0.9;

export function collectThreadChatHistory(
  events: readonly Event[],
  threadId: string,
  options: { contextWindow?: number; usedTokens?: number } = {},
): CompactThreadHistoryResult {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  let lastCompactSequence: number | undefined;
  let lastCompactSummary: string | undefined;

  for (const event of ordered) {
    const eventThreadId =
      typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
    if (eventThreadId !== threadId) continue;
    if (event.type !== 'context.compacted') continue;
    lastCompactSequence = event.sequence;
    if (typeof event.payload.summaryText === 'string' && event.payload.summaryText.trim()) {
      lastCompactSummary = event.payload.summaryText.trim();
    }
  }

  const messages: CompactHistoryMessage[] = [];
  if (lastCompactSummary) {
    messages.push({
      role: 'system',
      content: lastCompactSummary,
      sequence: lastCompactSequence ?? 0,
    });
  }

  for (const event of ordered) {
    const eventThreadId =
      typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
    if (eventThreadId !== threadId) continue;
    if (lastCompactSequence !== undefined && event.sequence <= lastCompactSequence) continue;

    if (event.type === 'message.appended') {
      const role = event.payload.role;
      const text = typeof event.payload.text === 'string' ? event.payload.text : '';
      if (!text.trim()) continue;
      // Compact markers are UI notices — never re-feed them into the transcript.
      if (event.payload.compact === true) continue;
      if (role === 'user' || role === 'assistant' || role === 'system') {
        messages.push({
          role,
          content: text,
          sequence: event.sequence,
          messageId:
            typeof event.payload.messageId === 'string' ? event.payload.messageId : undefined,
        });
      }
      continue;
    }

    if (event.type === 'run.completed') {
      const text =
        typeof event.payload.assistantText === 'string' ? event.payload.assistantText : '';
      if (!text.trim()) continue;
      const last = messages[messages.length - 1];
      if (!(last?.role === 'assistant' && last.content === text)) {
        messages.push({
          role: 'assistant',
          content: text,
          sequence: event.sequence,
        });
      }
    }
  }

  const estimatedTokens = estimateMessagesTokens(messages);
  const contextWindow =
    typeof options.contextWindow === 'number' && options.contextWindow > 0
      ? options.contextWindow
      : undefined;
  // Prefer the client ring's real usage when provided; fall back to transcript estimate.
  const occupancyTokens =
    typeof options.usedTokens === 'number' &&
    Number.isFinite(options.usedTokens) &&
    options.usedTokens >= 0
      ? Math.round(options.usedTokens)
      : estimatedTokens;
  const shouldAutoCompact =
    contextWindow !== undefined
      ? occupancyTokens / contextWindow >= COMPACT_AUTO_THRESHOLD
      : messages.length > MAX_HISTORY_MESSAGES;

  return {
    messages,
    lastCompactSequence,
    estimatedTokens,
    shouldAutoCompact,
  };
}

/** True when afterTokens is a real reduction (not just display clamp). */
export function isMeaningfulCompactReduction(
  beforeTokens: number,
  afterTokens: number,
  minRatio: number = COMPACT_MIN_REDUCTION_RATIO,
): boolean {
  if (beforeTokens <= 0) return false;
  if (afterTokens <= 0) return false;
  return afterTokens <= beforeTokens * minRatio;
}

/**
 * Split history into (older → summarize) and (recent → keep verbatim).
 * Matches Claude Code / NewMax compact: summarize earlier turns, keep recent.
 */
export function splitHistoryForCompact(
  messages: readonly CompactHistoryMessage[],
  keepRecent: number = COMPACT_KEEP_RECENT_MESSAGES,
): {
  older: CompactHistoryMessage[];
  keptMessages: CompactHistoryMessage[];
  foldedCount: number;
  beforeTokens: number;
} {
  const keep = Math.max(1, keepRecent);
  const beforeTokens = estimateMessagesTokens(messages);
  if (messages.length <= keep) {
    return {
      older: [],
      keptMessages: [...messages],
      foldedCount: 0,
      beforeTokens,
    };
  }
  const cut = messages.length - keep;
  return {
    older: messages.slice(0, cut),
    keptMessages: messages.slice(cut),
    foldedCount: cut,
    beforeTokens,
  };
}

/** Format older turns as plain transcript text for the model summarizer. */
export function formatTranscriptForCompactSummary(
  messages: readonly CompactHistoryMessage[],
): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === 'system' && message.content.includes('[context compact]')) {
      // Nested compact boundaries: keep a short note only.
      lines.push('System: [previous compact summary omitted]');
      continue;
    }
    const role =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    // Cap very long tool dumps so the summarizer request itself fits.
    const body = truncateForSummary(message.content, message.role === 'assistant' ? 4000 : 3000);
    if (!body) continue;
    lines.push(`${role}: ${body}`);
  }
  return lines.join('\n\n');
}

/**
 * Build the user message sent to the model for NewMax/Claude-style compact.
 */
export function buildCompactSummaryUserPrompt(
  olderMessages: readonly CompactHistoryMessage[],
): string {
  const transcript = formatTranscriptForCompactSummary(olderMessages);
  return `${COMPACT_SUMMARY_USER_PROMPT_PREFIX}\n${transcript}`;
}

/**
 * Wrap a model-generated summary into the durable compact boundary text that
 * subsequent provider history will inject as a system message.
 */
/** Soft cap so a verbose 9-section model summary cannot bloat short threads. */
export const COMPACT_MODEL_SUMMARY_MAX_CHARS = 12_000;

export function wrapModelCompactSummary(modelSummary: string): string {
  let body = modelSummary.replace(/\s+$/g, '').trim();
  if (!body) return '';
  if (body.length > COMPACT_MODEL_SUMMARY_MAX_CHARS) {
    body = `${body.slice(0, COMPACT_MODEL_SUMMARY_MAX_CHARS - 1)}…`;
  }
  return [
    '[context compact]',
    'Earlier conversation was compacted by the model to free context window space.',
    'Preserve goals, decisions, constraints, and unfinished work from the summary below.',
    '',
    body,
    '',
    COMPACT_RESUME_INSTRUCTION,
  ].join('\n');
}

/**
 * Local fallback compact (used only when the model summarizer is unavailable).
 * NewMax/Claude primary path is model-generated summary; this is a degraded path.
 */
export function buildLocalCompactSummary(
  input: BuildCompactSummaryInput,
): BuildCompactSummaryResult {
  const keepRecent = Math.max(1, input.keepRecent ?? COMPACT_KEEP_RECENT_MESSAGES);
  const split = splitHistoryForCompact(input.messages, keepRecent);
  if (split.foldedCount <= 0) {
    return {
      summaryText: '',
      keptMessages: split.keptMessages,
      foldedCount: 0,
      beforeTokens: split.beforeTokens,
      afterTokens: split.beforeTokens,
    };
  }

  const lines: string[] = [
    '[context compact]',
    'Earlier conversation was compacted to free context window space.',
    'Preserve goals, decisions, constraints, and unfinished work from the summary below.',
    '',
    '## Compacted history',
  ];

  for (const message of split.older) {
    const role =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    // Fold long tool dumps / logs aggressively in the summary section.
    const maxChars = message.role === 'assistant' ? 280 : 220;
    const body = truncateForSummary(message.content, maxChars);
    if (!body) continue;
    lines.push(`- ${role}: ${body}`);
  }

  const summaryText = lines.join('\n').trim();
  const afterTokens =
    estimateTokensFromText(summaryText) + estimateMessagesTokens(split.keptMessages);

  // Reject local summaries that do not actually free context. Callers must treat
  // empty summaryText as "do not write a compact boundary".
  if (!isMeaningfulCompactReduction(split.beforeTokens, afterTokens)) {
    return {
      summaryText: '',
      keptMessages: split.keptMessages,
      foldedCount: 0,
      beforeTokens: split.beforeTokens,
      afterTokens: split.beforeTokens,
    };
  }

  return {
    summaryText,
    keptMessages: split.keptMessages,
    foldedCount: split.foldedCount,
    beforeTokens: split.beforeTokens,
    afterTokens,
  };
}

/** Estimate tokens after applying a summary + kept recent turns. */
export function estimateCompactAfterTokens(
  summaryText: string,
  keptMessages: readonly CompactHistoryMessage[],
): number {
  return estimateTokensFromText(summaryText) + estimateMessagesTokens(keptMessages);
}

/**
 * NewMax preventive compact: fold a single long tool output to head…tail.
 * Returns original text when already short enough.
 */
export function foldToolOutputText(
  text: string,
  maxChars: number = COMPACT_TOOL_OUTPUT_FOLD_CHARS,
): { text: string; folded: boolean; originalChars: number } {
  const original = typeof text === 'string' ? text : '';
  const originalChars = original.length;
  if (originalChars <= maxChars) {
    return { text: original, folded: false, originalChars };
  }
  const headBudget = Math.max(200, Math.floor(maxChars * 0.55));
  const tailBudget = Math.max(120, maxChars - headBudget - 80);
  const head = original.slice(0, headBudget).trimEnd();
  const tail = original.slice(-tailBudget).trimStart();
  const omitted = originalChars - head.length - tail.length;
  const foldedText = [
    head,
    '',
    `[… tool output folded: omitted ${omitted} chars; full output was ${originalChars} chars …]`,
    '',
    tail,
  ].join('\n');
  return { text: foldedText, folded: true, originalChars };
}

export interface FoldToolMessagesResult {
  messages: ProviderMessage[];
  foldedCount: number;
  charsSaved: number;
}

/**
 * Fold long tool-role messages in a multi-turn chat transcript.
 * Keeps the newest `keepRecent` tool results verbatim (NewMax-style).
 */
export function foldLongToolOutputsInMessages(
  messages: readonly ProviderMessage[],
  options: {
    maxChars?: number;
    keepRecent?: number;
  } = {},
): FoldToolMessagesResult {
  const maxChars = options.maxChars ?? COMPACT_TOOL_OUTPUT_FOLD_CHARS;
  const keepRecent = Math.max(0, options.keepRecent ?? COMPACT_TOOL_OUTPUT_KEEP_RECENT);

  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'tool') toolIndexes.push(i);
  }
  const protect = new Set(toolIndexes.slice(-keepRecent));

  let foldedCount = 0;
  let charsSaved = 0;
  const next: ProviderMessage[] = messages.map((message, index) => {
    if (message.role !== 'tool') return message;
    if (protect.has(index)) return message;
    const content = typeof message.content === 'string' ? message.content : '';
    const folded = foldToolOutputText(content, maxChars);
    if (!folded.folded) return message;
    foldedCount += 1;
    charsSaved += Math.max(0, folded.originalChars - folded.text.length);
    return { ...message, content: folded.text };
  });

  return { messages: next, foldedCount, charsSaved };
}

/**
 * Apply the latest compact boundary while building provider messages.
 * Falls back to the previous hard slice when no compact event exists.
 */
export function buildChatMessagesFromEvents(
  events: readonly Event[],
  threadId: string,
  latestUserText: string,
  latestImages?: readonly ChatImageInput[],
): ProviderMessage[] {
  const history = collectThreadChatHistory(events, threadId);
  const messages: ProviderMessage[] = history.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  // Ensure the latest user turn is present (appendMessage may not be in the
  // in-memory snapshot yet when prepareRunBinding runs in the same transition).
  // When images are attached, ALWAYS upgrade/replace the trailing user turn with
  // multimodal parts — even if durable history already has the plain text.
  const latestContent = userContentWithImages(latestUserText, latestImages);
  const last = messages[messages.length - 1];
  const hasImages = Boolean(latestImages && latestImages.length > 0);

  if (hasImages) {
    if (last?.role === 'user') {
      messages[messages.length - 1] = { role: 'user', content: latestContent };
    } else {
      messages.push({ role: 'user', content: latestContent });
    }
  } else {
    const lastIsSameUserText =
      last?.role === 'user' && typeof last.content === 'string' && last.content === latestUserText;
    if (!lastIsSameUserText) {
      messages.push({ role: 'user', content: latestContent });
    }
  }

  // Safety cap for never-compacted long threads.
  if (messages.length > MAX_HISTORY_MESSAGES) {
    return messages.slice(messages.length - MAX_HISTORY_MESSAGES);
  }
  return messages;
}

function userContentWithImages(
  text: string,
  images: readonly ChatImageInput[] | undefined,
): ProviderMessage['content'] {
  if (!images || images.length === 0) return text;
  const parts: Array<{ type: 'text'; text: string } | { type: 'image'; imageUrl: string }> = [];
  if (text.trim()) parts.push({ type: 'text', text });
  for (const image of images) {
    if (!image?.dataUrl || !image.dataUrl.startsWith('data:image/')) continue;
    parts.push({ type: 'image', imageUrl: image.dataUrl });
  }
  if (parts.length === 0) return text || '';
  if (parts.length === 1 && parts[0]!.type === 'text') return parts[0]!.text;
  return parts;
}

/**
 * Pre-write snapshot captured by executeChatBuiltInTool when a write_file call
 * overwrites an existing text file. Carried separately from the tool result so
 * the provider transcript (which echoes the full result) stays clean.
 */
export interface ChatWriteSnapshot {
  /** Full pre-write content (existing UTF-8 text file only). */
  previousContent?: string;
  /** True when previousContent was truncated to SNAPSHOT_MAX_BYTES. */
  previousTruncated?: boolean;
}

const SNAPSHOT_MAX_BYTES = 512 * 1024;
const SNAPSHOT_MAX_FILE_BYTES = 1024 * 1024;

/**
 * Best-effort pre-write snapshot: reads an existing file before it is
 * overwritten. Binary or oversized files are skipped (UI degrades to
 * "no diff available"). Never throws — snapshot failure must not block the write.
 */
async function captureWriteSnapshot(
  workspaceRoot: string,
  relativePath: string,
): Promise<ChatWriteSnapshot> {
  try {
    const absolute = resolve(workspaceRoot, relativePath);
    if (!absolute.startsWith(resolve(workspaceRoot))) return {};
    const fileStat = await stat(absolute);
    if (!fileStat.isFile() || fileStat.size > SNAPSHOT_MAX_FILE_BYTES) return {};
    const content = await readFile(absolute, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > SNAPSHOT_MAX_BYTES) {
      return {
        previousContent: content.slice(0, Math.max(0, Math.floor((SNAPSHOT_MAX_BYTES / 4) * 0.9))),
        previousTruncated: true,
      };
    }
    return { previousContent: content };
  } catch {
    // ENOENT (created file), directory, permission error, or non-text bytes — no snapshot.
    return {};
  }
}

export async function executeChatBuiltInTool(input: {
  workspaceRoot?: string;
  threadId?: string;
  runId?: string;
  commandSessions?: CommandSessionStore;
  toolCall: ProviderToolCall;
  signal?: AbortSignal;
  networkEnabled?: boolean;
  fetchImpl?: typeof fetch;
  /** Runtime-owned provider router; omitted only by isolated legacy tests. */
  webSearch?: (input: {
    query: string;
    limit: number;
    providerId?: string;
    allowedDomains?: string[];
    blockedDomains?: string[];
    signal?: AbortSignal;
  }) => Promise<string>;
  /** Optional out-parameter receiving the pre-write snapshot of a write_file call. */
  snapshotOut?: ChatWriteSnapshot;
}): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(input.toolCall.argumentsJson || '{}') as Record<string, unknown>;
  } catch {
    return JSON.stringify({ ok: false, error: 'Invalid tool arguments JSON' });
  }

  if (CHAT_NETWORK_TOOL_NAMES.has(input.toolCall.name)) {
    if (!input.networkEnabled) {
      return JSON.stringify({
        ok: false,
        error: '联网已关闭。请用户打开 Compose 底栏「联网」后再试。',
      });
    }
    try {
      if (input.toolCall.name === 'web_search') {
        if (input.webSearch) {
          return await input.webSearch({
            query: String(args.query ?? ''),
            limit: typeof args.limit === 'number' ? args.limit : 5,
            ...(typeof args.provider === 'string' && args.provider !== 'auto'
              ? { providerId: args.provider }
              : {}),
            ...(Array.isArray(args.allowed_domains)
              ? {
                  allowedDomains: args.allowed_domains.filter(
                    (value): value is string => typeof value === 'string',
                  ),
                }
              : {}),
            ...(Array.isArray(args.blocked_domains)
              ? {
                  blockedDomains: args.blocked_domains.filter(
                    (value): value is string => typeof value === 'string',
                  ),
                }
              : {}),
            signal: input.signal,
          });
        }
        return await executeWebSearch({
          query: String(args.query ?? ''),
          limit: typeof args.limit === 'number' ? args.limit : 5,
          signal: input.signal,
          fetchImpl: input.fetchImpl,
        });
      }
      return await executeWebFetch({
        url: String(args.url ?? ''),
        maxChars: typeof args.maxChars === 'number' ? args.maxChars : 12_000,
        signal: input.signal,
        fetchImpl: input.fetchImpl,
      });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Network tool failed',
      });
    }
  }

  const workspaceRoot = input.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return JSON.stringify({
      ok: false,
      error: 'No project folder is bound; filesystem tools are unavailable.',
    });
  }

  const token: WorkerToken = {
    token: randomUUID(),
    allowedRoot: workspaceRoot,
    timeoutMs: input.toolCall.name === 'run_command' ? 120_000 : 30_000,
    maxOutputBytes: TOOL_OUTPUT_LIMIT_BYTES,
    signal: input.signal,
  };

  try {
    if (input.commandSessions && input.threadId) {
      const scope = { threadId: input.threadId, workspaceRoot };
      if (input.toolCall.name === 'run_command') {
        return JSON.stringify(await input.commandSessions.start(scope, parseCommandStart(args), {
          runId: input.runId ?? input.threadId, callId: input.toolCall.id, signal: input.signal,
        }));
      }
      if (input.toolCall.name === 'list_commands') {
        return JSON.stringify({ ok: true, sessions: input.commandSessions.list(scope) });
      }
      if (input.toolCall.name === 'read_command' || input.toolCall.name === 'stop_command') {
        if (typeof args.sessionId !== 'string' || !args.sessionId) throw new Error('sessionId is required');
        if (input.toolCall.name === 'stop_command') {
          const session = await input.commandSessions.stop(scope, args.sessionId);
          return JSON.stringify({ ok: true, session });
        }
        if (args.waitMs !== undefined && typeof args.waitMs !== 'number') throw new Error('waitMs must be a number');
        return JSON.stringify(await input.commandSessions.read(scope, args.sessionId, args.waitMs, input.signal));
      }
    }
    let events: AsyncIterable<WorkerEvent>;
    switch (input.toolCall.name) {
      case 'read_file':
        events = new FileSystemWorker().exec(
          {
            workingDir: workspaceRoot,
            action: { kind: 'read', relative: String(args.path ?? '') },
          },
          token,
        );
        break;
      case 'list_files':
        events = new FileSystemWorker().exec(
          {
            workingDir: workspaceRoot,
            action: {
              kind: 'list',
              relative: typeof args.path === 'string' ? args.path : '.',
              maxEntries: typeof args.maxEntries === 'number' ? args.maxEntries : undefined,
            },
          },
          token,
        );
        break;
      case 'search_files':
        events = new FileSystemWorker().exec(
          {
            workingDir: workspaceRoot,
            action: {
              kind: 'search',
              relative: typeof args.path === 'string' ? args.path : '.',
              pattern: String(args.pattern ?? ''),
              caseInsensitive: args.caseInsensitive === true,
              globInclude: typeof args.globInclude === 'string' ? args.globInclude : undefined,
              globExclude: typeof args.globExclude === 'string' ? args.globExclude : undefined,
              contextLines: typeof args.contextLines === 'number' ? args.contextLines : undefined,
              maxResults: typeof args.maxResults === 'number' ? args.maxResults : undefined,
            },
          },
          { ...token, timeoutMs: 60_000 },
        );
        break;
      case 'write_file':
        // Snapshot the pre-write content before the worker overwrites the file.
        if (input.snapshotOut) {
          const snapshot = await captureWriteSnapshot(workspaceRoot, String(args.path ?? ''));
          if (snapshot.previousContent !== undefined) {
            input.snapshotOut.previousContent = snapshot.previousContent;
            input.snapshotOut.previousTruncated = snapshot.previousTruncated;
          }
        }
        events = new FileSystemWorker().exec(
          {
            workingDir: workspaceRoot,
            action: {
              kind: 'write',
              relative: String(args.path ?? ''),
              content: String(args.content ?? ''),
            },
          },
          token,
        );
        break;
      case 'run_command': {
        const action = parseCommandStart(args);
        if (action.background || action.waitMs !== undefined) {
          throw new Error('Command session host is required for background execution or bounded waits');
        }
        const command = action.command;
        // Do NOT pre-block by basename (rg/fd/…). Try real execution first so
        // absolute paths and installed tools work. ENOENT is handled below with
        // a recovery hint via toolResultMeta / loop guard.
        events = new TerminalProcessWorker({ timeoutMs: action.timeoutMs }).exec(
          {
            workingDir: workspaceRoot,
            action,
          },
          { ...token, allowedCommands: [command] },
        );
        break;
      }
      case 'git_status':
        events = new GitProcessWorker().exec(
          { workingDir: workspaceRoot, action: { cmd: 'status' } },
          token,
        );
        break;
      case 'git_diff':
        events = new GitProcessWorker().exec(
          {
            workingDir: workspaceRoot,
            action: {
              cmd: 'diff',
              staged: args.staged === true,
              relative: typeof args.path === 'string' ? args.path : undefined,
            },
          },
          token,
        );
        break;
      default:
        return JSON.stringify({
          ok: false,
          error: `Unsupported tool: ${input.toolCall.name}`,
        });
    }

    return await collectWorkerResult(events);
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Tool execution failed',
    });
  }
}

function parseCommandStart(args: Record<string, unknown>): CommandSessionStart {
  if (typeof args.command !== 'string' || !args.command.trim()) throw new Error('command is required');
  if (args.args !== undefined && (!Array.isArray(args.args) || !args.args.every((arg) => typeof arg === 'string'))) {
    throw new Error('args must be an array of strings');
  }
  if (args.cwd !== undefined && typeof args.cwd !== 'string') throw new Error('cwd must be a string');
  if (args.background !== undefined && typeof args.background !== 'boolean') throw new Error('background must be a boolean');
  for (const field of ['waitMs', 'timeoutMs'] as const) {
    const value = args[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) ||
      value < (field === 'waitMs' ? 0 : 1) || value > (field === 'waitMs' ? 30_000 : 2_147_483_647))) {
      throw new Error(`Invalid ${field}`);
    }
  }
  return {
    command: args.command,
    args: Array.isArray(args.args) ? args.args.map(String) : undefined,
    cwd: args.cwd,
    background: args.background,
    waitMs: typeof args.waitMs === 'number' ? args.waitMs : undefined,
    timeoutMs: typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined,
  };
}

const WEB_FETCH_TIMEOUT_MS = 30_000;
const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const WEB_FETCH_MAX_REDIRECTS = 5;
const WEB_SEARCH_TIMEOUT_MS = 12_000;
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
]);

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  // IPv4 private / link-local / loopback
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 local / ULA
  if (host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  return false;
}

function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  if (!url.hostname || isPrivateOrLocalHost(url.hostname)) {
    throw new Error('Private or local hosts are blocked');
  }
  return url;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function extractHtmlDocument(html: string): { title?: string; text: string } {
  const title = decodeHtmlEntities(
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ') ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim();
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(?:svg|canvas|template)\b[\s\S]*?<\/(?:svg|canvas|template)>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, ' ');
  const main =
    withoutNoise.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    withoutNoise.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    withoutNoise;
  const text = decodeHtmlEntities(
    main
      .replace(/<(?:br|hr)\s*\/?\s*>/gi, '\n')
      .replace(/<\/(?:p|div|section|article|main|h[1-6]|li|tr|blockquote)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { ...(title ? { title } : {}), text };
}

async function fetchPublicPage(
  fetchFn: typeof fetch,
  initialUrl: URL,
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  let url = initialUrl;
  for (let redirects = 0; redirects <= WEB_FETCH_MAX_REDIRECTS; redirects++) {
    const response = await fetchFn(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/json,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.3',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SyncThink/1.0',
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, url };
    const location = response.headers.get('location');
    if (!location) throw new Error(`Redirect response ${response.status} has no Location header`);
    if (redirects === WEB_FETCH_MAX_REDIRECTS) throw new Error('Too many redirects');
    url = assertPublicHttpUrl(new URL(location, url).toString());
  }
  throw new Error('Too many redirects');
}

async function readLimitedResponseText(
  response: Response,
  contentType: string,
): Promise<{ raw: string; byteTruncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { raw: await response.text(), byteTruncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let byteTruncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = WEB_FETCH_MAX_BYTES - total;
      if (remaining <= 0) {
        byteTruncated = true;
        await reader.cancel();
        break;
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) {
        byteTruncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1] ?? 'utf-8';
  let decoder = new TextDecoder('utf-8');
  try {
    decoder = new TextDecoder(charset);
  } catch {
    // Keep UTF-8 when the declared charset is unsupported by this runtime.
  }
  return { raw: decoder.decode(bytes), byteTruncated };
}

async function executeWebFetch(input: {
  url: string;
  maxChars: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const url = assertPublicHttpUrl(input.url.trim());
  const fetchFn = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const fetched = await fetchPublicPage(fetchFn, url, controller.signal);
    const response = fetched.response;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/(?:text|html|json|xml|javascript|xhtml)/i.test(contentType)) {
      return JSON.stringify({
        ok: false,
        status: response.status,
        url: fetched.url.toString(),
        contentType,
        error: 'The URL returned binary content; use the browser or download flow instead.',
      });
    }
    const { raw, byteTruncated } = await readLimitedResponseText(response, contentType);
    const max = Math.min(Math.max(input.maxChars || 12_000, 500), 50_000);
    const document =
      contentType.includes('html') || /^\s*<!doctype html|^\s*<html/i.test(raw)
        ? extractHtmlDocument(raw)
        : {
            text: raw
              .replace(/[ \t]+/g, ' ')
              .replace(/\n{3,}/g, '\n\n')
              .trim(),
          };
    const text = document.text.slice(0, max);
    const looksLikeClientRenderedApp =
      contentType.includes('html') &&
      text.length === 0 &&
      /<script\b[^>]*\bsrc\s*=|type=["']module["']/i.test(raw);
    if (looksLikeClientRenderedApp) {
      return JSON.stringify({
        ok: false,
        code: 'RENDER_REQUIRED',
        status: response.status,
        url: response.url || fetched.url.toString(),
        contentType,
        error:
          'This page is rendered by JavaScript and has no readable server HTML. Use browser_open followed by browser_read for the rendered page.',
        browserRequired: true,
      });
    }
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      url: response.url || fetched.url.toString(),
      contentType,
      ...(document.title ? { title: document.title } : {}),
      text,
      truncated: byteTruncated || document.text.length > max,
    });
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

async function executeWebSearch(input: {
  query: string;
  limit: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const query = input.query.trim();
  if (!query) {
    return JSON.stringify({ ok: false, error: 'query is required' });
  }
  const limit = Math.min(Math.max(input.limit || 5, 1), 8);
  const fetchFn = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // DuckDuckGo Instant Answer API — no key; good enough for Compose 联网 MVP.
    const endpoint = new URL('https://api.duckduckgo.com/');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('format', 'json');
    endpoint.searchParams.set('no_html', '1');
    endpoint.searchParams.set('skip_disambig', '1');
    const response = await fetchFn(endpoint.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'SyncThink-WebSearch/1.0' },
    });
    if (!response.ok) {
      return JSON.stringify({
        ok: false,
        error: `Search provider HTTP ${response.status}`,
        query,
      });
    }
    const data = (await response.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      Heading?: string;
      RelatedTopics?: Array<
        | { Text?: string; FirstURL?: string }
        | { Name?: string; Topics?: Array<{ Text?: string; FirstURL?: string }> }
      >;
      Results?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || data.AbstractSource || 'Summary',
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }
    const pushTopic = (topic: { Text?: string; FirstURL?: string } | undefined) => {
      if (!topic?.Text || !topic.FirstURL) return;
      if (results.length >= limit) return;
      if (results.some((r) => r.url === topic.FirstURL)) return;
      const text = topic.Text;
      const dash = text.indexOf(' - ');
      results.push({
        title: dash > 0 ? text.slice(0, dash) : text.slice(0, 80),
        url: topic.FirstURL,
        snippet: dash > 0 ? text.slice(dash + 3) : text,
      });
    };
    for (const item of data.Results ?? []) pushTopic(item);
    for (const item of data.RelatedTopics ?? []) {
      if (!item) continue;
      if ('Topics' in item && Array.isArray(item.Topics)) {
        for (const sub of item.Topics) pushTopic(sub);
      } else {
        pushTopic(item as { Text?: string; FirstURL?: string });
      }
      if (results.length >= limit) break;
    }
    return JSON.stringify({
      ok: true,
      query,
      provider: 'duckduckgo-instant',
      results: results.slice(0, limit),
      note:
        results.length === 0
          ? 'No instant-answer results. Try web_fetch on a known URL, or rephrase the query.'
          : undefined,
    });
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}

async function collectWorkerResult(events: AsyncIterable<WorkerEvent>): Promise<string> {
  let output: WorkerJobOutput | undefined;
  let failure: Extract<WorkerEvent, { type: 'failed' }> | undefined;
  for await (const event of events) {
    if (event.type === 'failed') failure = event;
    if (event.type === 'completed') output = event.output;
  }
  if (failure) {
    const message = failure.error.message;
    const looksMissingBinary = /ENOENT|not found|is not recognized|不是内部或外部命令/i.test(
      message,
    );
    return JSON.stringify({
      ok: false,
      error: message,
      failureClass: failure.failureClass,
      code: looksMissingBinary ? 'COMMAND_UNAVAILABLE' : undefined,
      hint: looksMissingBinary
        ? 'This executable is not available. Prefer built-in tools search_files / list_files / read_file / git_* instead of retrying.'
        : undefined,
    });
  }
  if (!output) {
    return JSON.stringify({ ok: false, error: 'Tool worker returned no result' });
  }
  return JSON.stringify(output);
}

/**
 * Recovery hint after a real ENOENT / missing-binary failure.
 * Prefer built-in tools; do not invent absolute-path bans.
 */
export function unavailableExternalCommandHint(command: string): string | undefined {
  const base = command
    .trim()
    .replace(/^["']|["']$/g, '')
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase()
    .replace(/\.exe$/i, '');
  if (!base) return undefined;
  if (base === 'rg' || base === 'ripgrep') {
    return (
      'rg/ripgrep is not available (ENOENT). ' +
      'Use built-in list_files + read_file to explore the project, ' +
      'or run_command with Windows findstr only for narrow text search. ' +
      'Do not call rg again unless you know it is installed on PATH.'
    );
  }
  return undefined;
}

export type ToolLoopOutcomeKind = 'continue' | 'force_final';

export interface ToolLoopGuardInput {
  /** 1-based tool-loop round index after increment. */
  toolLoopRound: number;
  maxToolRounds: number;
  /** JSON result strings from the just-finished tool batch. */
  completedResults: readonly { toolCallId: string; content: string; pendingCommand?: boolean }[];
  /** Fingerprints already seen in earlier rounds (mutated by caller via return). */
  seenFingerprints?: ReadonlySet<string>;
  /** Consecutive no-progress rounds before this batch. */
  stagnantRounds?: number;
}

export interface ToolLoopGuardResult {
  kind: ToolLoopOutcomeKind;
  /** Reason shown to the model when forcing a final answer. */
  reason?: string;
  /** Updated fingerprint set including this batch. */
  seenFingerprints: Set<string>;
  /** Updated stagnant round counter. */
  stagnantRounds: number;
  /** How many tools in this batch failed. */
  failedCount: number;
  /** How many tools in this batch look like missing-binary failures. */
  unavailableCount: number;
}

function toolResultMeta(content: string): {
  ok: boolean;
  unavailable: boolean;
  fingerprint: string;
} {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const ok = parsed.ok !== false;
    const error = typeof parsed.error === 'string' ? parsed.error : '';
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    const unavailable =
      code === 'COMMAND_UNAVAILABLE' ||
      /ENOENT|not found|is not recognized|不是内部或外部命令|not available in this runtime|not installed/i.test(
        error,
      );
    const command = typeof parsed.command === 'string' ? parsed.command : '';
    const message = typeof parsed.message === 'string' ? parsed.message.slice(0, 80) : '';
    // Include path / relative / args / content hash so reading different files
    // does not look like "no progress" (same ok+message fingerprint).
    const path =
      typeof parsed.path === 'string'
        ? parsed.path
        : typeof parsed.relative === 'string'
          ? parsed.relative
          : '';
    const argList = Array.isArray(parsed.args) ? parsed.args.map(String).join(' ') : '';
    const body =
      typeof parsed.content === 'string'
        ? parsed.content
        : typeof parsed.stdout === 'string'
          ? parsed.stdout
          : typeof parsed.text === 'string'
            ? parsed.text
            : '';
    const bodyHash = body ? `${body.length}:${body.slice(0, 24)}:${body.slice(-16)}` : '';
    const fingerprint = [
      ok ? 'ok' : 'err',
      code || '',
      command,
      path,
      argList.slice(0, 80),
      error.slice(0, 40),
      message,
      bodyHash,
    ].join(':');
    return { ok, unavailable, fingerprint };
  } catch {
    const unavailable = /ENOENT|not found|not recognized/i.test(content);
    return {
      ok: !/error|failed|ok":false/i.test(content),
      unavailable,
      fingerprint: content.slice(0, 96),
    };
  }
}

/**
 * Decide whether the tool loop should continue or force a final user-facing reply.
 * Stops empty thrash: repeated missing binaries, repeated identical failures, or
 * hitting the hard round cap.
 */
export function evaluateToolLoopGuard(input: ToolLoopGuardInput): ToolLoopGuardResult {
  const maxToolRounds = Math.max(1, input.maxToolRounds);
  const seen = new Set(input.seenFingerprints ?? []);
  let failedCount = 0;
  let unavailableCount = 0;
  let newFingerprints = 0;

  for (const item of input.completedResults) {
    if (item.pendingCommand) continue;
    const meta = toolResultMeta(item.content);
    if (!meta.ok) failedCount += 1;
    if (meta.unavailable) unavailableCount += 1;
    if (!seen.has(meta.fingerprint)) {
      seen.add(meta.fingerprint);
      newFingerprints += 1;
    }
  }

  const batchSize = input.completedResults.filter((item) => !item.pendingCommand).length;
  const allFailed = batchSize > 0 && failedCount === batchSize;
  const prevStagnant = Math.max(0, input.stagnantRounds ?? 0);
  // A batch with no new fingerprints (or all failures of already-seen kinds) is stagnant.
  const batchStagnant =
    batchSize > 0 && (newFingerprints === 0 || (allFailed && newFingerprints <= 1));
  const stagnantRounds = batchStagnant ? prevStagnant + 1 : 0;

  if (batchSize === 0 && input.completedResults.some((item) => item.pendingCommand)) {
    return { kind: 'continue', seenFingerprints: seen, stagnantRounds: 0, failedCount, unavailableCount };
  }

  if (input.toolLoopRound >= maxToolRounds) {
    return {
      kind: 'force_final',
      reason:
        `已达到工具轮次上限（${maxToolRounds}）。请停止继续调用工具，` +
        `根据已有结果直接给用户完整答复；若信息仍不足，说明缺什么并给出可执行的下一步建议。`,
      seenFingerprints: seen,
      stagnantRounds,
      failedCount,
      unavailableCount,
    };
  }

  // First all-unavailable batch: allow one recovery round with tools still on.
  // Only force_final after a second stagnant unavailable batch (stagnantRounds >= 2).
  if (unavailableCount > 0 && unavailableCount === batchSize && stagnantRounds >= 2) {
    return {
      kind: 'force_final',
      reason:
        '连续多轮工具因命令不可用而失败（例如 rg 未安装）。' +
        '不要再重试相同命令。请根据已有 list_files / read_file 结果直接答复用户；' +
        '若无法完成“写入智能体库”等未暴露的能力，请明确说明产品边界并给出配置草案。',
      seenFingerprints: seen,
      stagnantRounds,
      failedCount,
      unavailableCount,
    };
  }

  // Soft hint on first all-unavailable batch — still continue so the model can
  // switch to list_files / read_file while tools remain available.
  if (unavailableCount > 0 && unavailableCount === batchSize && stagnantRounds === 1) {
    return {
      kind: 'continue',
      reason:
        '本轮命令不可用。请改用 list_files / read_file / git_status / git_diff，不要重试相同缺失命令。',
      seenFingerprints: seen,
      stagnantRounds,
      failedCount,
      unavailableCount,
    };
  }

  if (stagnantRounds >= 3) {
    return {
      kind: 'force_final',
      reason:
        '连续多轮工具调用没有新的有效进展（重复失败或重复相同结果）。' +
        '请停止工具循环，汇总已有发现并直接回复用户；不要再发起同类搜索。',
      seenFingerprints: seen,
      stagnantRounds,
      failedCount,
      unavailableCount,
    };
  }

  return {
    kind: 'continue',
    seenFingerprints: seen,
    stagnantRounds,
    failedCount,
    unavailableCount,
  };
}

/** User-visible nudge injected before the forced final model turn. */
export function buildForceFinalToolLoopMessage(reason: string): string {
  return [
    '[system tool-loop guard]',
    reason,
    "Respond in the user's language. Do not call tools in this turn.",
  ].join('\n');
}

export function resolveToolLoopProviderPolicy(
  toolsEnabled: boolean,
  forceFinalAnswer: boolean,
): { toolsEnabled: boolean; toolChoice?: 'none' } {
  return {
    toolsEnabled,
    ...(toolsEnabled && forceFinalAnswer ? { toolChoice: 'none' as const } : {}),
  };
}
