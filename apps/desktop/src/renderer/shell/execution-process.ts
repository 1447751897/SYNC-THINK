import type { Event } from '@sync-think/shared';

export type ProcessStepStatus = 'running' | 'done' | 'error';
export type ProcessToolKind =
  'read' | 'list' | 'write' | 'bash' | 'git' | 'browser' | 'search' | 'mcp' | 'other';

export interface ExecutionProcessStep {
  id: string;
  /** Mixed label like `Read · package.json` */
  label: string;
  /** English-ish verb for NewMax-like titles */
  verb: string;
  /** Chinese action title, e.g. 读取文件 / 执行命令 */
  zh: string;
  toolName: string;
  kind: ProcessToolKind;
  status: ProcessStepStatus;
  path?: string;
  command?: string;
  url?: string;
  preview?: string;
  exitCode?: number;
  error?: string;
  count?: number;
  occurredAt?: string;
}

export interface FileChangeItem {
  path: string;
  action: 'created' | 'edited' | 'deleted';
  toolCallId?: string;
  preview?: string;
  /** Full pre-write content when a snapshot was taken (existing text file). */
  previousContent?: string;
  /** True when previousContent was truncated to bound the event payload. */
  previousTruncated?: boolean;
  /** Full post-write content when the written body was captured from the tool call. */
  content?: string;
}

/** NewMax-style model-authored task checklist (update_task_plan tool). */
export interface TaskPlanItem {
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TaskPlanView {
  items: TaskPlanItem[];
  completed: number;
  total: number;
}

export interface ExecutionProcessView {
  steps: ExecutionProcessStep[];
  fileChanges: FileChangeItem[];
  /** Latest task checklist authored via update_task_plan, if any. */
  taskPlan?: TaskPlanView;
  running: boolean;
  doneCount: number;
  errorCount: number;
  tokensIn?: number;
  tokensOut?: number;
  /** Wall-clock duration of the run in milliseconds, if start+end known. */
  durationMs?: number;
  /** Provider model id used for this run, e.g. gpt-5.5 / grok-4.5. */
  providerModelId?: string;
  /** Internal catalog model id when available. */
  modelId?: string;
  startedAt?: string;
  completedAt?: string;
}

const TOOL_META: Record<string, { verb: string; kind: ProcessToolKind; zh: string }> = {
  read_file: { verb: 'Read', kind: 'read', zh: '读取文件' },
  write_file: { verb: 'Edit', kind: 'write', zh: '写入文件' },
  edit_file: { verb: 'Edit', kind: 'write', zh: '编辑文件' },
  list_files: { verb: 'List', kind: 'list', zh: '列出文件' },
  run_command: { verb: 'Bash', kind: 'bash', zh: '执行命令' },
  git_status: { verb: 'Git', kind: 'git', zh: 'Git 状态' },
  git_diff: { verb: 'Git', kind: 'git', zh: 'Git diff' },
  browser_open: { verb: 'Browse', kind: 'browser', zh: '打开网页' },
  update_task_plan: { verb: 'Plan', kind: 'other', zh: '更新任务清单' },
  browser_navigate: { verb: 'Browse', kind: 'browser', zh: '打开网页' },
  browser_extract: { verb: 'Extract', kind: 'browser', zh: '提取网页' },
  browser_click: { verb: 'Click', kind: 'browser', zh: '点击网页' },
  browser_fill: { verb: 'Fill', kind: 'browser', zh: '填写' },
  browser_type: { verb: 'Type', kind: 'browser', zh: '输入文字' },
  browser_read: { verb: 'Read', kind: 'browser', zh: '读取页面' },
  browser_screenshot: { verb: 'Shot', kind: 'browser', zh: '页面截图' },
  search_web: { verb: 'Search', kind: 'search', zh: '搜索' },
  web_search: { verb: 'Search', kind: 'search', zh: '联网搜索' },
  web_fetch: { verb: 'Fetch', kind: 'browser', zh: '读取网页' },
};

function shortText(value: string, max = 48): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `…${text.slice(-(max - 1))}`;
}

/**
 * `run_command` 的参数是 `{command, args[], cwd}`——只读 `command` 会把
 * 「pnpm -s test」显示成「pnpm」，看不出在跑什么。命令行必须连参数一起还原。
 */
function formatCommandLine(command: string, args?: unknown): string {
  const head = command.trim();
  if (!Array.isArray(args)) return head;
  const tail = args
    .filter((arg): arg is string => typeof arg === 'string')
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .filter(Boolean);
  return [head, ...tail].filter(Boolean).join(' ');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function eventThreadId(event: Event): string | undefined {
  if (typeof event.payload.threadId === 'string') return event.payload.threadId;
  const run = asRecord(event.payload.run);
  return typeof run?.threadId === 'string' ? run.threadId : undefined;
}

function eventRunId(event: Event): string | undefined {
  if (event.runId) return String(event.runId);
  if (typeof event.payload.runId === 'string') return event.payload.runId;
  const run = asRecord(event.payload.run);
  return typeof run?.runId === 'string' ? run.runId : undefined;
}

function eventProviderModelId(event: Event): string | undefined {
  if (typeof event.payload.providerModelId === 'string' && event.payload.providerModelId) {
    return event.payload.providerModelId;
  }
  const run = asRecord(event.payload.run);
  return typeof run?.providerModelId === 'string' && run.providerModelId
    ? run.providerModelId
    : undefined;
}

function eventModelId(event: Event): string | undefined {
  if (typeof event.payload.modelId === 'string' && event.payload.modelId) {
    return event.payload.modelId;
  }
  const run = asRecord(event.payload.run);
  return typeof run?.modelId === 'string' && run.modelId ? run.modelId : undefined;
}

function isToolEvent(type: string): boolean {
  return (
    type === 'tool.requested' ||
    type === 'tool.completed' ||
    type === 'tool.failed' ||
    type === 'execution.tool.requested' ||
    type === 'execution.tool.completed' ||
    type === 'execution.tool.failed' ||
    type.startsWith('mcp.tool_') ||
    type.startsWith('mcp.')
  );
}

function toolMeta(name: string): { verb: string; kind: ProcessToolKind; zh: string } {
  if (TOOL_META[name]) return TOOL_META[name]!;
  if (name.startsWith('mcp.') || name.includes('__')) {
    return { verb: 'MCP', kind: 'mcp', zh: name };
  }
  return { verb: name, kind: 'other', zh: name };
}

function extractArgs(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return (
    asRecord(payload.arguments) ??
    asRecord(payload.args) ??
    asRecord(asRecord(payload.toolCall)?.arguments) ??
    asRecord(parseMaybeJson(asRecord(payload.toolCall)?.argumentsJson))
  );
}

function extractToolName(payload: Record<string, unknown>): string {
  if (typeof payload.toolName === 'string' && payload.toolName) return payload.toolName;
  if (typeof payload.tool === 'string' && payload.tool) return payload.tool;
  if (typeof payload.name === 'string' && payload.name) return payload.name;
  const toolCall = asRecord(payload.toolCall);
  if (typeof toolCall?.name === 'string' && toolCall.name) return toolCall.name;
  return 'tool';
}

function extractToolCallId(payload: Record<string, unknown>, eventId: string): string {
  if (typeof payload.toolCallId === 'string' && payload.toolCallId) return payload.toolCallId;
  if (typeof payload.callId === 'string' && payload.callId) return payload.callId;
  const toolCall = asRecord(payload.toolCall);
  if (typeof toolCall?.id === 'string' && toolCall.id) return toolCall.id;
  return eventId;
}

function buildLabel(
  toolName: string,
  args?: Record<string, unknown>,
): {
  label: string;
  verb: string;
  zh: string;
  kind: ProcessToolKind;
  path?: string;
  command?: string;
  url?: string;
} {
  const meta = toolMeta(toolName);
  const path =
    typeof args?.path === 'string'
      ? args.path
      : typeof args?.file === 'string'
        ? args.file
        : undefined;
  const command =
    typeof args?.command === 'string' ? formatCommandLine(args.command, args?.args) : undefined;
  const url = typeof args?.url === 'string' ? args.url : undefined;
  const query = typeof args?.query === 'string' ? args.query : undefined;
  const focus = path ?? command ?? url ?? query;
  const label = focus ? `${meta.verb} · ${shortText(String(focus), 52)}` : meta.verb;
  return { label, verb: meta.verb, zh: meta.zh, kind: meta.kind, path, command, url };
}

/** Prefer written body from tool args; result only carries status/bytes. */
function extractWriteContent(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  if (typeof args.content === 'string') return args.content;
  if (typeof args.text === 'string') return args.text;
  if (typeof args.body === 'string') return args.body;
  if (typeof args.new_string === 'string') return args.new_string;
  if (typeof args.newString === 'string') return args.newString;
  return undefined;
}

function clipContentPreview(content: string, maxLines = 200): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.length <= maxLines) return lines.join('\n');
  return `${lines.slice(0, maxLines).join('\n')}\n…（共 ${lines.length} 行）`;
}

function summarizeResult(
  toolName: string,
  resultRaw: unknown,
  args?: Record<string, unknown>,
): { preview?: string; exitCode?: number; created?: boolean; content?: string } {
  const parsed = parseMaybeJson(resultRaw);
  const obj = asRecord(parsed);

  if (toolName === 'list_files') {
    const entries =
      (Array.isArray(obj?.entries) && obj.entries) ||
      (Array.isArray(obj?.items) && obj.items) ||
      (Array.isArray(obj?.files) && obj.files) ||
      (Array.isArray(parsed) ? parsed : undefined);
    if (entries) {
      const names = entries
        .slice(0, 20)
        .map((item) => {
          if (typeof item === 'string') return item;
          const rec = asRecord(item);
          return typeof rec?.name === 'string'
            ? rec.name
            : typeof rec?.path === 'string'
              ? rec.path
              : JSON.stringify(item);
        })
        .filter(Boolean);
      const total =
        typeof obj?.count === 'number'
          ? obj.count
          : typeof obj?.total === 'number'
            ? obj.total
            : entries.length;
      return {
        preview: `找到 ${total} 项\n${names.join('\n')}${total > names.length ? '\n…' : ''}`,
      };
    }
  }

  if (toolName === 'read_file') {
    const content =
      typeof obj?.content === 'string'
        ? obj.content
        : typeof obj?.text === 'string'
          ? obj.text
          : typeof parsed === 'string'
            ? parsed
            : undefined;
    if (content) {
      return {
        preview: clipContentPreview(content, 40),
        content,
      };
    }
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const created = obj?.created === true || obj?.isNew === true;
    const bytes =
      typeof obj?.bytes === 'number'
        ? obj.bytes
        : typeof obj?.size === 'number'
          ? obj.size
          : undefined;
    // NewMax shows the written body itself, not just "已写入".
    const content = extractWriteContent(args);
    if (content !== undefined) {
      return {
        preview: clipContentPreview(content, 200),
        content,
        created,
      };
    }
    return {
      preview: created
        ? bytes
          ? `已创建（${bytes} bytes）`
          : '已创建'
        : bytes
          ? `已写入（${bytes} bytes）`
          : '已写入',
      created,
    };
  }

  if (toolName === 'run_command') {
    const exitCode =
      typeof obj?.exitCode === 'number'
        ? obj.exitCode
        : typeof obj?.code === 'number'
          ? obj.code
          : undefined;
    const stdout =
      typeof obj?.stdout === 'string'
        ? obj.stdout
        : typeof obj?.output === 'string'
          ? obj.output
          : '';
    const stderr = typeof obj?.stderr === 'string' ? obj.stderr : '';
    const body = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n').trim();
    const head = body
      ? body.split(/\r?\n/).slice(0, 40).join('\n')
      : exitCode === undefined
        ? '命令已完成'
        : `退出码 ${exitCode}`;
    return {
      exitCode,
      preview: body && body.split(/\r?\n/).length > 40 ? `${head}\n…` : head,
    };
  }

  if (typeof parsed === 'string' && parsed.trim()) {
    const lines = parsed.split(/\r?\n/);
    return {
      preview: lines.length > 30 ? `${lines.slice(0, 30).join('\n')}\n…` : parsed,
    };
  }
  if (obj) {
    try {
      const text = JSON.stringify(obj, null, 2);
      return { preview: text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text };
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Project NewMax-style "执行过程" steps + file changes + token usage.
 */
export function projectExecutionProcess(
  events: readonly Event[],
  options: { threadId?: string; runId?: string } = {},
): ExecutionProcessView {
  const { threadId, runId } = options;
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const byId = new Map<string, ExecutionProcessStep>();
  const order: string[] = [];
  const fileChanges: FileChangeItem[] = [];
  let taskPlan: TaskPlanView | undefined;
  /** write_file body often only appears on tool.requested args, not on completed result. */
  const writeContentByCall = new Map<string, string>();
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let startedAt: string | undefined;
  let completedAt: string | undefined;
  let providerModelId: string | undefined;
  let modelId: string | undefined;

  for (const event of ordered) {
    if (runId && eventRunId(event) !== runId) continue;
    const eventThread = eventThreadId(event);
    if (threadId && eventThread && eventThread !== threadId) continue;

    if (event.type === 'run.started') {
      startedAt = event.occurredAt;
      providerModelId = eventProviderModelId(event) ?? providerModelId;
      modelId = eventModelId(event) ?? modelId;
      continue;
    }
    if (
      event.type === 'run.completed' ||
      event.type === 'run.failed' ||
      event.type === 'run.cancelled' ||
      event.type === 'run.paused'
    ) {
      completedAt = event.occurredAt;
      providerModelId = eventProviderModelId(event) ?? providerModelId;
      modelId = eventModelId(event) ?? modelId;
      continue;
    }

    if (event.type === 'provider.usage') {
      if (typeof event.payload.tokensIn === 'number') tokensIn = event.payload.tokensIn;
      if (typeof event.payload.tokensOut === 'number') tokensOut = event.payload.tokensOut;
      // Some adapters use input/output naming.
      if (tokensIn === undefined && typeof event.payload.inputTokens === 'number') {
        tokensIn = event.payload.inputTokens;
      }
      if (tokensOut === undefined && typeof event.payload.outputTokens === 'number') {
        tokensOut = event.payload.outputTokens;
      }
      providerModelId = eventProviderModelId(event) ?? providerModelId;
      modelId = eventModelId(event) ?? modelId;
      // Do NOT treat mid-run provider.usage as completion — tool loops emit usage
      // every round and would make the process look finished while still spinning.
      continue;
    }

    if (!isToolEvent(event.type)) continue;
    if (!runId && threadId && eventThread && eventThread !== threadId) continue;

    const payload = event.payload;
    const toolCallId = extractToolCallId(payload, event.id);
    const toolName = extractToolName(payload);

    // Task-plan tools are pure UI signals: project the checklist, keep them
    // out of the tool step list (they would be noise there). update_task_plan
    // covers legacy runs; TaskCreate/TaskUpdate/TaskList are the persisted
    // NewMax-style tools (their results echo the same plan snapshot).
    if (
      toolName === 'update_task_plan' ||
      toolName === 'TaskCreate' ||
      toolName === 'TaskUpdate' ||
      toolName === 'TaskList'
    ) {
      const parsedPlan = extractTaskPlan(payload);
      if (parsedPlan) taskPlan = parsedPlan;
      continue;
    }

    const args = extractArgs(payload);
    const built = buildLabel(toolName, args);
    const writeBody = extractWriteContent(args);
    if (writeBody !== undefined) {
      writeContentByCall.set(toolCallId, writeBody);
    }
    const argsForSummary =
      writeBody !== undefined
        ? args
        : writeContentByCall.has(toolCallId)
          ? { ...(args ?? {}), content: writeContentByCall.get(toolCallId) }
          : args;

    const requested =
      event.type.endsWith('.requested') ||
      event.type === 'tool.requested' ||
      event.type === 'execution.tool.requested' ||
      event.type === 'mcp.tool_requested';
    const failed =
      event.type.endsWith('.failed') ||
      event.type === 'tool.failed' ||
      event.type === 'execution.tool.failed' ||
      event.type === 'mcp.tool_failed';
    const completed =
      event.type.endsWith('.completed') ||
      event.type === 'tool.completed' ||
      event.type === 'execution.tool.completed' ||
      event.type === 'mcp.tool_completed';

    const existing = byId.get(toolCallId);
    if (!existing) {
      order.push(toolCallId);
      const resultSummary =
        completed || failed
          ? summarizeResult(
              toolName,
              payload.result ?? payload.output ?? payload.error,
              argsForSummary,
            )
          : {};
      const resultFailed =
        completed && isToolResultFailure(payload.result ?? payload.output, resultSummary);
      byId.set(toolCallId, {
        id: toolCallId,
        label: built.label,
        verb: built.verb,
        zh: built.zh,
        toolName,
        kind: built.kind,
        status: failed || resultFailed ? 'error' : completed ? 'done' : 'running',
        path: built.path,
        command: built.command,
        url: built.url,
        preview: resultSummary.preview,
        exitCode: resultSummary.exitCode,
        error:
          failed && typeof payload.error === 'string'
            ? payload.error
            : failed && typeof payload.errorMessage === 'string'
              ? payload.errorMessage
              : resultFailed
                ? (extractToolResultError(payload.result ?? payload.output) ??
                  resultSummary.preview)
                : undefined,
        occurredAt: event.occurredAt,
      });
      if (completed && (toolName === 'write_file' || toolName === 'edit_file') && built.path) {
        fileChanges.push({
          path: built.path,
          action: resultSummary.created ? 'created' : 'edited',
          toolCallId,
          preview: resultSummary.content ?? resultSummary.preview,
          ...snapshotFields(payload),
          ...(typeof resultSummary.content === 'string' && resultSummary.content.length > 0
            ? { content: resultSummary.content }
            : {}),
        });
      }
      continue;
    }

    if (failed) {
      existing.status = 'error';
      existing.error =
        typeof payload.error === 'string'
          ? payload.error
          : typeof payload.errorMessage === 'string'
            ? payload.errorMessage
            : existing.error;
    } else if (completed) {
      const summary = summarizeResult(toolName, payload.result ?? payload.output, argsForSummary);
      const resultFailed = isToolResultFailure(payload.result ?? payload.output, summary);
      existing.status = existing.status === 'error' || resultFailed ? 'error' : 'done';
      existing.preview = summary.preview ?? existing.preview;
      existing.exitCode = summary.exitCode ?? existing.exitCode;
      if (resultFailed && !existing.error) {
        existing.error =
          extractToolResultError(payload.result ?? payload.output) ?? existing.preview;
      }
      if (
        (toolName === 'write_file' || toolName === 'edit_file') &&
        (existing.path || built.path)
      ) {
        const path = existing.path || built.path!;
        const contentPreview = summary.content ?? summary.preview;
        const already = fileChanges.find(
          (item) => item.path === path && item.toolCallId === toolCallId,
        );
        if (already) {
          if (contentPreview) already.preview = contentPreview;
          if (summary.created) already.action = 'created';
          if (typeof summary.content === 'string' && summary.content.length > 0) {
            already.content = summary.content;
          }
        } else {
          fileChanges.push({
            path,
            action: summary.created ? 'created' : 'edited',
            toolCallId,
            preview: contentPreview,
            ...snapshotFields(payload),
            ...(typeof summary.content === 'string' && summary.content.length > 0
              ? { content: summary.content }
              : {}),
          });
        }
      }
    } else if (requested) {
      existing.status =
        existing.status === 'done' || existing.status === 'error' ? existing.status : 'running';
    }

    // Prefer richer labels/args if a later event carries them.
    if (built.path) existing.path = built.path;
    if (built.command) existing.command = built.command;
    if (built.url) existing.url = built.url;
    existing.label = built.label || existing.label;
    existing.verb = built.verb || existing.verb;
    existing.zh = built.zh || existing.zh;
    existing.toolName = toolName || existing.toolName;
    existing.kind = built.kind || existing.kind;
    existing.occurredAt = event.occurredAt;
  }

  // Merge adjacent identical labels (read-only / same command) into ×N.
  const raw = order.map((id) => byId.get(id)!).filter(Boolean);
  const steps: ExecutionProcessStep[] = [];
  for (const step of raw) {
    const prev = steps[steps.length - 1];
    const sameKey =
      prev &&
      prev.toolName === step.toolName &&
      (prev.path ?? prev.command ?? prev.url ?? prev.label) ===
        (step.path ?? step.command ?? step.url ?? step.label) &&
      prev.status === step.status &&
      prev.status !== 'error';
    if (sameKey && prev) {
      prev.count = (prev.count ?? 1) + 1;
      const base = prev.label.replace(/ ×\d+$/, '');
      prev.label = `${base} ×${prev.count}`;
      prev.preview = step.preview ?? prev.preview;
      prev.occurredAt = step.occurredAt ?? prev.occurredAt;
      continue;
    }
    steps.push({ ...step, count: 1 });
  }

  // Dedupe file changes by path (keep last action).
  const changeByPath = new Map<string, FileChangeItem>();
  for (const change of fileChanges) {
    changeByPath.set(change.path, change);
  }

  let durationMs: number | undefined;
  if (startedAt && completedAt) {
    const start = Date.parse(startedAt);
    const end = Date.parse(completedAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      durationMs = end - start;
    }
  }

  return {
    steps,
    fileChanges: [...changeByPath.values()],
    taskPlan,
    running: steps.some((step) => step.status === 'running'),
    doneCount: steps.filter((step) => step.status === 'done').length,
    errorCount: steps.filter((step) => step.status === 'error').length,
    tokensIn,
    tokensOut,
    durationMs,
    providerModelId,
    modelId,
    startedAt,
    completedAt,
  };
}

/**
 * Forward the pre-write snapshot carried on tool.completed payloads
 * (captured by the runtime write_file executor) into FileChangeItem fields.
 */
function snapshotFields(
  payload: Record<string, unknown>,
): { previousContent?: string; previousTruncated?: boolean } {
  if (typeof payload.previousContent !== 'string' || payload.previousContent.length === 0) {
    return {};
  }
  return {
    previousContent: payload.previousContent,
    ...(payload.previousTruncated === true ? { previousTruncated: true } : {}),
  };
}

/**
 * Parse the checklist from an update_task_plan tool event.
 * Prefers the executed result (`{ok:true, plan:{...}}` on tool.completed);
 * falls back to the request arguments so the capsule updates as soon as the
 * call is streamed, before the round-trip completes.
 */
function extractTaskPlan(payload: Record<string, unknown>): TaskPlanView | undefined {
  const fromResult = (() => {
    const parsed = parseMaybeJson(payload.result ?? payload.output);
    const obj = asRecord(parsed);
    if (obj?.ok !== true) return undefined;
    const plan = asRecord(obj.plan);
    return plan ? normalizeTaskPlanItems(plan.items) : undefined;
  })();
  if (fromResult) return fromResult;
  const args = extractArgs(payload);
  return args ? normalizeTaskPlanItems(args.items) : undefined;
}

function normalizeTaskPlanItems(raw: unknown): TaskPlanView | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items: TaskPlanItem[] = [];
  for (const entry of raw.slice(0, 20)) {
    const rec = asRecord(entry);
    const title = typeof rec?.title === 'string' ? rec.title.trim() : '';
    if (!title) continue;
    const status =
      rec?.status === 'in_progress' || rec?.status === 'completed' ? rec.status : 'pending';
    items.push({ title, status });
  }
  if (items.length === 0) return undefined;
  return {
    items,
    completed: items.filter((item) => item.status === 'completed').length,
    total: items.length,
  };
}

function isToolResultFailure(resultRaw: unknown, summary: { exitCode?: number }): boolean {
  if (typeof summary.exitCode === 'number' && summary.exitCode !== 0) return true;
  const parsed = parseMaybeJson(resultRaw);
  const obj = asRecord(parsed);
  if (obj && obj.ok === false) return true;
  if (typeof resultRaw === 'string' && /"ok"\s*:\s*false/.test(resultRaw)) return true;
  return false;
}

function extractToolResultError(resultRaw: unknown): string | undefined {
  const parsed = parseMaybeJson(resultRaw);
  const obj = asRecord(parsed);
  if (typeof obj?.error === 'string' && obj.error.trim()) return obj.error;
  if (typeof obj?.message === 'string' && obj.message.trim()) return obj.message;
  return undefined;
}

/** Compact NewMax-style count: 647.9k / 1.2M / 842. */
export function formatCompactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (n >= 1000) {
    const thousands = n / 1000;
    // Keep one decimal for values like 647.9k (NewMax style), drop trailing .0.
    return `${thousands.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(n));
}

/** Compact duration: 51s / 1m 12s / 840ms. */
export function formatCompactDuration(ms?: number): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

/**
 * Compact footer metric like `51s · 647.9k`.
 * Falls back to token-only / duration-only when one side is missing.
 */
export function formatCompactRunMetrics(options: {
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
}): string | undefined {
  const duration = formatCompactDuration(options.durationMs);
  const totalTokens =
    options.tokensIn !== undefined || options.tokensOut !== undefined
      ? (options.tokensIn ?? 0) + (options.tokensOut ?? 0)
      : undefined;
  const tokens = totalTokens !== undefined ? formatCompactCount(totalTokens) : undefined;
  if (duration && tokens) return `${duration} · ${tokens}`;
  if (duration) return duration;
  if (tokens) return tokens;
  return undefined;
}

export function formatTokenUsage(tokensIn?: number, tokensOut?: number): string | undefined {
  if (tokensIn === undefined && tokensOut === undefined) return undefined;
  if (tokensIn !== undefined && tokensOut !== undefined) {
    return `${formatCompactCount(tokensIn + tokensOut)} · in ${formatCompactCount(tokensIn)} / out ${formatCompactCount(tokensOut)}`;
  }
  if (tokensOut !== undefined) return `${formatCompactCount(tokensOut)} out`;
  return `${formatCompactCount(tokensIn!)} in`;
}

/** Clock label for footer, e.g. 18:36. */
export function formatMessageClock(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** Full absolute time for hover, e.g. 2026/7/25 18:36:52. */
export function formatMessageAbsoluteTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** Friendly model label for footer / hover. */
export function formatRunModelLabel(options: {
  providerModelId?: string;
  modelId?: string;
  catalogName?: string;
}): string | undefined {
  const catalog = options.catalogName?.trim();
  if (catalog) return catalog;
  const provider = options.providerModelId?.trim();
  if (provider) {
    // z-ai/glm-5.2 → GLM-5.2-ish short form: keep as-is but strip vendor prefix noise lightly
    const bare = provider.includes('/') ? provider.slice(provider.lastIndexOf('/') + 1) : provider;
    return bare;
  }
  return options.modelId?.trim() || undefined;
}
