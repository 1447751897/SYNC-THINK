import type { ProviderToolSchema } from '@sync-think/adapters';
import type { JsonValue } from '@sync-think/shared';
import {
  FileSystemWorker,
  GitProcessWorker,
  TerminalProcessWorker,
  PlaywrightBrowserWorker,
  WindowsDesktopWorker,
  type WorkerEvent,
  type WorkerJobOutput,
  type WorkerToken,
} from '@sync-think/workers';

export const EXECUTION_TOOL_SCHEMAS: readonly ProviderToolSchema[] = [
  {
    name: 'read_file',
    description: 'Read one UTF-8 text file relative to this task execution location.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string' } },
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories relative to this task execution location.',
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
    name: 'write_file',
    description: 'Atomically write one UTF-8 text file relative to this task execution location.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } },
    },
  },
  {
    name: 'run_command',
    description: 'Run one executable without a shell in this task execution location.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' }, maxItems: 128 },
        cwd: { type: 'string' },
      },
    },
  },
  {
    name: 'git_status',
    description: 'Read concise Git status for this task worktree.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'git_diff',
    description: 'Read an unstaged or staged Git diff in this task worktree.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { staged: { type: 'boolean' }, path: { type: 'string' } },
    },
  },
  {
    name: 'browser_navigate',
    description: 'Open a URL in the Browser Identity pinned to this task.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: { url: { type: 'string' } },
    },
  },
  {
    name: 'browser_extract',
    description: 'Read visible text from the current page in this task Browser Identity.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { selector: { type: 'string' } },
    },
  },
  {
    name: 'browser_click',
    description: 'Click one exact selector in the current task browser page.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['selector'],
      properties: { selector: { type: 'string' } },
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill one exact selector in the current task browser page.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['selector', 'text'],
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
    },
  },
  {
    name: 'desktop_list_windows',
    description: 'List visible top-level Windows application windows through UI Automation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { maxElements: { type: 'integer', minimum: 1, maximum: 200 } },
    },
  },
  {
    name: 'desktop_snapshot',
    description: 'Read a bounded accessible control tree from one exact Windows window title.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['windowTitle'],
      properties: {
        windowTitle: { type: 'string' },
        maxElements: { type: 'integer', minimum: 1, maximum: 500 },
        maxDepth: { type: 'integer', minimum: 1, maximum: 8 },
      },
    },
  },
  {
    name: 'desktop_invoke',
    description: 'Invoke one unique Windows UI Automation control by automation id or exact name.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['windowTitle'],
      properties: {
        windowTitle: { type: 'string' },
        automationId: { type: 'string' },
        name: { type: 'string' },
      },
    },
  },
  {
    name: 'desktop_fill',
    description: 'Set the value of one unique editable Windows UI Automation control.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['windowTitle', 'text'],
      properties: {
        windowTitle: { type: 'string' },
        automationId: { type: 'string' },
        name: { type: 'string' },
        text: { type: 'string' },
      },
    },
  },
];

const EXECUTION_TOOL_NAMES = new Set(EXECUTION_TOOL_SCHEMAS.map((tool) => tool.name));

export function isExecutionToolName(name: string): boolean {
  return EXECUTION_TOOL_NAMES.has(name);
}

export async function invokeExecutionTool(input: {
  name: string;
  arguments: Record<string, JsonValue>;
  executionRoot: string;
  browserProfilePath?: string;
  allowedSites?: string[];
  signal?: AbortSignal;
  beforeStart?: () => boolean;
  timeoutMs?: number;
  maxOutputBytes?: number;
}): Promise<string> {
  const token: WorkerToken = {
    token: `conversation-tool:${input.name}`,
    allowedRoot: input.executionRoot,
    timeoutMs: input.timeoutMs ?? 120_000,
    maxOutputBytes: input.maxOutputBytes ?? 24 * 1024,
    signal: input.signal,
    beforeStart: input.beforeStart,
  };
  const args = input.arguments;
  let events: AsyncIterable<WorkerEvent>;
  switch (input.name) {
    case 'read_file':
      events = new FileSystemWorker().exec(
        { workingDir: input.executionRoot, action: { kind: 'read', relative: stringArg(args, 'path') } },
        token,
      );
      break;
    case 'list_files':
      events = new FileSystemWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            kind: 'list',
            relative: optionalStringArg(args, 'path') ?? '.',
            maxEntries: optionalNumberArg(args, 'maxEntries'),
          },
        },
        token,
      );
      break;
    case 'write_file':
      events = new FileSystemWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            kind: 'write',
            relative: stringArg(args, 'path'),
            content: stringArg(args, 'content'),
          },
        },
        token,
      );
      break;
    case 'run_command': {
      const command = stringArg(args, 'command');
      events = new TerminalProcessWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            command,
            args: Array.isArray(args.args) ? args.args.map(String) : [],
            cwd: optionalStringArg(args, 'cwd'),
          },
        },
        { ...token, allowedCommands: [command] },
      );
      break;
    }
    case 'git_status':
      events = new GitProcessWorker().exec(
        { workingDir: input.executionRoot, action: { cmd: 'status' } },
        token,
      );
      break;
    case 'git_diff':
      events = new GitProcessWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            cmd: 'diff',
            staged: args.staged === true,
            relative: optionalStringArg(args, 'path'),
          },
        },
        token,
      );
      break;
    case 'browser_navigate':
    case 'browser_extract':
    case 'browser_click':
    case 'browser_fill': {
      if (!input.browserProfilePath) throw new Error('browser.profile_required');
      const kind = input.name.slice('browser_'.length) as 'navigate' | 'extract' | 'click' | 'fill';
      events = new PlaywrightBrowserWorker().exec(
        {
          workingDir: input.executionRoot,
          profilePath: input.browserProfilePath,
          allowedSites: input.allowedSites,
          action: {
            kind,
            url: optionalStringArg(args, 'url'),
            selector: optionalStringArg(args, 'selector'),
            text: typeof args.text === 'string' ? args.text : undefined,
          },
        },
        token,
      );
      break;
    }
    case 'desktop_list_windows':
      events = new WindowsDesktopWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            kind: 'list-windows',
            maxElements: optionalNumberArg(args, 'maxElements'),
          },
        },
        token,
      );
      break;
    case 'desktop_snapshot':
      events = new WindowsDesktopWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            kind: 'snapshot',
            windowTitle: stringArg(args, 'windowTitle'),
            maxElements: optionalNumberArg(args, 'maxElements'),
            maxDepth: optionalNumberArg(args, 'maxDepth'),
          },
        },
        token,
      );
      break;
    case 'desktop_invoke':
      events = new WindowsDesktopWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            kind: 'invoke',
            windowTitle: stringArg(args, 'windowTitle'),
            automationId: optionalStringArg(args, 'automationId'),
            name: optionalStringArg(args, 'name'),
          },
        },
        token,
      );
      break;
    case 'desktop_fill':
      events = new WindowsDesktopWorker().exec(
        {
          workingDir: input.executionRoot,
          action: {
            kind: 'fill',
            windowTitle: stringArg(args, 'windowTitle'),
            automationId: optionalStringArg(args, 'automationId'),
            name: optionalStringArg(args, 'name'),
            text: typeof args.text === 'string' ? args.text : '',
          },
        },
        token,
      );
      break;
    default:
      throw new Error(`execution.tool_unsupported:${input.name}`);
  }
  return collectWorkerResult(events);
}

async function collectWorkerResult(events: AsyncIterable<WorkerEvent>): Promise<string> {
  let output: WorkerJobOutput | undefined;
  for await (const event of events) {
    if (event.type === 'failed') throw new Error(event.error.message);
    if (event.type === 'completed') output = event.output;
  }
  if (!output) throw new Error('execution.tool_missing_result');
  return JSON.stringify(output);
}

function stringArg(args: Record<string, JsonValue>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`execution.tool_argument_invalid:${name}`);
  return value;
}

function optionalStringArg(args: Record<string, JsonValue>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function optionalNumberArg(args: Record<string, JsonValue>, name: string): number | undefined {
  const value = args[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
