import { randomUUID } from 'node:crypto';
import type {
  ProviderMessage,
  ProviderToolCall,
  ProviderToolSchema,
} from '@sync-think/adapters';
import type { Event } from '@sync-think/shared';
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
    description: 'Run one executable without a shell in the bound project folder.',
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

export const CHAT_NETWORK_TOOL_NAMES = new Set(
  CHAT_NETWORK_TOOL_SCHEMAS.map((tool) => tool.name),
);

/** Tools that only observe the workspace (safe under「询问批准」). */
export const CHAT_READ_ONLY_TOOL_NAMES = new Set([
  'read_file',
  'list_files',
  'git_status',
  'git_diff',
  'web_search',
  'web_fetch',
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
  if (value === 'full-access' || value === 'full' || value === 'full_access' || value === 'unrestricted') {
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
  options: { networkEnabled?: boolean; includeProjectTools?: boolean } = {},
): readonly ProviderToolSchema[] {
  const includeProject = options.includeProjectTools !== false;
  const tools: ProviderToolSchema[] = includeProject ? [...CHAT_BUILT_IN_TOOL_SCHEMAS] : [];
  if (options.networkEnabled) {
    tools.push(...CHAT_NETWORK_TOOL_SCHEMAS);
  }
  return tools;
}

/** Mutating tools under「询问批准」需要用户点批准后才执行。 */
export function chatToolRequiresApproval(
  mode: string | undefined | null,
  toolName: string,
): boolean {
  return (
    normalizeChatExecutionMode(mode) === 'ask' && CHAT_MUTATING_TOOL_NAMES.has(toolName)
  );
}

/** Hard block (not used for ask anymore — ask waits for approval). */
export function isChatToolAllowed(
  mode: string | undefined | null,
  toolName: string,
  options: { networkEnabled?: boolean } = {},
): boolean {
  // All built-in project tools are allowed once the user has approved (ask)
  // or when mode is workspace/full-access.
  void mode;
  if (CHAT_BUILT_IN_TOOL_SCHEMAS.some((tool) => tool.name === toolName)) return true;
  if (options.networkEnabled && CHAT_NETWORK_TOOL_NAMES.has(toolName)) return true;
  return false;
}

export function chatToolDeniedMessage(
  mode: string | undefined | null,
  toolName: string,
  reason: 'denied' | 'blocked' = 'denied',
): string {
  const normalized = normalizeChatExecutionMode(mode);
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
  if (toolName === 'write_file') {
    const content = typeof args.content === 'string' ? args.content : '';
    const lines = content.split(/\r?\n/).length;
    return {
      title: path ? `写入文件 ${path}` : '写入文件',
      detail: content
        ? `约 ${lines} 行 · ${content.length} 字符`
        : '将修改项目内文件',
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
  return {
    title: toolName,
    detail: path || command || '需要你的批准',
    path,
    command,
  };
}

const MAX_HISTORY_MESSAGES = 40;
const TOOL_OUTPUT_LIMIT_BYTES = 200_000;

/**
 * Build multi-turn chat messages for the current thread from durable events.
 * Includes prior user/assistant turns so the model can "see" conversation context.
 */
export interface ChatImageInput {
  name?: string;
  mimeType?: string;
  dataUrl: string;
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

export function buildChatMessagesFromEvents(
  events: readonly Event[],
  threadId: string,
  latestUserText: string,
  latestImages?: readonly ChatImageInput[],
): ProviderMessage[] {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const messages: ProviderMessage[] = [];

  for (const event of ordered) {
    const eventThreadId =
      typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
    if (eventThreadId !== threadId) continue;

    if (event.type === 'message.appended') {
      const role = event.payload.role;
      const text = typeof event.payload.text === 'string' ? event.payload.text : '';
      if (!text.trim()) continue;
      if (role === 'user' || role === 'assistant' || role === 'system') {
        messages.push({ role, content: text });
      }
      continue;
    }

    if (event.type === 'run.completed') {
      const text =
        typeof event.payload.assistantText === 'string' ? event.payload.assistantText : '';
      if (text.trim()) {
        const last = messages[messages.length - 1];
        // Prefer explicit assistant message.appended when both exist.
        if (!(last?.role === 'assistant' && last.content === text)) {
          messages.push({ role: 'assistant', content: text });
        }
      }
    }
  }

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
      last?.role === 'user' &&
      typeof last.content === 'string' &&
      last.content === latestUserText;
    if (!lastIsSameUserText) {
      messages.push({ role: 'user', content: latestContent });
    }
  }

  if (messages.length > MAX_HISTORY_MESSAGES) {
    return messages.slice(messages.length - MAX_HISTORY_MESSAGES);
  }
  return messages;
}

export async function executeChatBuiltInTool(input: {
  workspaceRoot?: string;
  toolCall: ProviderToolCall;
  signal?: AbortSignal;
  networkEnabled?: boolean;
  fetchImpl?: typeof fetch;
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
      case 'write_file':
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
        const command = String(args.command ?? '');
        events = new TerminalProcessWorker().exec(
          {
            workingDir: workspaceRoot,
            action: {
              command,
              args: Array.isArray(args.args) ? args.args.map(String) : [],
              cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
            },
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

const WEB_FETCH_TIMEOUT_MS = 15_000;
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

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
    const response = await fetchFn(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'User-Agent': 'SyncThink-WebFetch/1.0',
      },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();
    const max = Math.min(Math.max(input.maxChars || 12_000, 500), 50_000);
    const text = contentType.includes('html')
      ? htmlToText(raw).slice(0, max)
      : raw.replace(/\s+/g, ' ').trim().slice(0, max);
    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      url: response.url || url.toString(),
      contentType,
      text,
      truncated: raw.length > max,
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
    return JSON.stringify({
      ok: false,
      error: failure.error.message,
      failureClass: failure.failureClass,
    });
  }
  if (!output) {
    return JSON.stringify({ ok: false, error: 'Tool worker returned no result' });
  }
  return JSON.stringify(output);
}
