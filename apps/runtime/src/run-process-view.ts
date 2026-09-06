import type {
  ExecutionProcessStep,
  FileChangeItem,
  ProcessToolKind,
  RunProcessView,
  TaskPlanItem,
  TaskPlanView,
} from '@sync-think/protocol';
import {
  isToolResultFailure,
  projectDeniedToolCalls,
  toolEventPhase,
  matchesToolName,
  type Event,
  type RunId,
} from '@sync-think/shared';
import { projectEventContent } from './deferred-content-projection.js';
import { projectFileChangeContent } from './file-change-content.js';
import { paginateRunProcess } from './run-process-page.js';
import type { RunProcessPageRequest } from '@sync-think/protocol';
import type { DeferredContent } from '@sync-think/shared';

const TOOL_META: Record<string, { verb: string; kind: ProcessToolKind; zh: string }> = {
  read_file: { verb: 'Read', kind: 'read', zh: '读取文件' },
  write_file: { verb: 'Edit', kind: 'write', zh: '写入文件' },
  edit_file: { verb: 'Edit', kind: 'write', zh: '编辑文件' },
  file_write: { verb: 'Edit', kind: 'write', zh: '写入文件' },
  file_change: { verb: 'Edit', kind: 'write', zh: '编辑文件' },
  apply_patch: { verb: 'Edit', kind: 'write', zh: '编辑文件' },
  list_files: { verb: 'List', kind: 'list', zh: '列出文件' },
  run_command: { verb: 'Bash', kind: 'bash', zh: '执行命令' },
  command_execution: { verb: 'Bash', kind: 'bash', zh: '命令执行' },
  desktop_launch_app: { verb: 'Launch', kind: 'other', zh: '启动应用' },
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

/** Task-plan tools update the checklist projection; they are not execution steps. */
const TASK_PLAN_TOOL_NAMES = new Set(['update_task_plan', 'TaskCreate', 'TaskUpdate', 'TaskList']);

function shortText(value: string, max = 48): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `…${text.slice(-(max - 1))}`;
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
    asRecord(parseMaybeJson(asRecord(payload.toolCall)?.argumentsJson)) ??
    asRecord(parseMaybeJson(payload.argumentsJson))
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

const WRITE_FILE_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'file_write',
  'file_change',
  'apply_patch',
  'write',
  'edit',
]);

function isWriteFileTool(toolName: string): boolean {
  return matchesToolName(toolName.toLowerCase(), WRITE_FILE_TOOL_NAMES);
}

function fileChangeActionFromKind(kind: unknown): FileChangeItem['action'] {
  const raw =
    typeof kind === 'string'
      ? kind
      : kind && typeof kind === 'object' && typeof (kind as { type?: unknown }).type === 'string'
        ? (kind as { type: string }).type
        : '';
  const normalized = raw.toLowerCase();
  if (normalized === 'add' || normalized === 'create' || normalized === 'created') return 'created';
  if (normalized === 'delete' || normalized === 'remove' || normalized === 'deleted') {
    return 'deleted';
  }
  return 'edited';
}

function normalizeWritePathEntry(
  rec: Record<string, unknown> | undefined,
  fallbackPath?: string,
): { path: string; action: FileChangeItem['action']; preview?: string } | undefined {
  const path =
    (typeof rec?.path === 'string' && rec.path.trim()) ||
    (typeof rec?.file === 'string' && rec.file.trim()) ||
    (typeof rec?.file_path === 'string' && rec.file_path.trim()) ||
    fallbackPath?.trim() ||
    '';
  if (!path) return undefined;
  const preview =
    typeof rec?.diff === 'string'
      ? rec.diff
      : typeof rec?.unified_diff === 'string'
        ? rec.unified_diff
        : typeof rec?.unifiedDiff === 'string'
          ? rec.unifiedDiff
          : typeof rec?.content === 'string'
            ? rec.content
            : undefined;
  return {
    path,
    action: fileChangeActionFromKind(rec?.kind ?? rec?.type ?? rec),
    ...(preview ? { preview } : {}),
  };
}

function extractChangeList(
  source?: Record<string, unknown>,
): Array<{ path: string; action: FileChangeItem['action']; preview?: string }> {
  const changes = source?.changes ?? source?.files;
  if (Array.isArray(changes)) {
    return changes.flatMap((entry) => {
      const normalized = normalizeWritePathEntry(asRecord(entry));
      return normalized ? [normalized] : [];
    });
  }
  const map = asRecord(changes);
  if (!map) return [];
  return Object.entries(map).flatMap(([path, value]) => {
    const normalized = normalizeWritePathEntry(asRecord(value) ?? {}, path);
    return normalized ? [normalized] : [];
  });
}

function extractApplyPatchEntries(
  text?: string,
): Array<{ path: string; action: FileChangeItem['action'] }> {
  if (!text) return [];
  const entries: Array<{ path: string; action: FileChangeItem['action'] }> = [];
  const pattern = /^\*\*\*\s+(Add|Delete|Update)\s+File:\s+(.+?)\s*$/gm;
  for (const match of text.matchAll(pattern)) {
    const kind = match[1]?.toLowerCase();
    const path = match[2]?.trim();
    if (!path) continue;
    entries.push({
      path,
      action: kind === 'add' ? 'created' : kind === 'delete' ? 'deleted' : 'edited',
    });
  }
  return entries;
}

function extractWritePathEntries(
  args?: Record<string, unknown>,
  resultRaw?: unknown,
): Array<{ path: string; action: FileChangeItem['action']; preview?: string }> {
  const sources = [asRecord(parseMaybeJson(resultRaw)), args];
  for (const source of sources) {
    const entries = extractChangeList(source);
    if (entries.length > 0) return entries;
  }
  const patchText = [
    typeof args?.patch === 'string' ? args.patch : '',
    typeof args?.input === 'string' ? args.input : '',
    typeof args?.command === 'string' ? args.command : '',
    typeof resultRaw === 'string' ? resultRaw : '',
  ].join('\n');
  const patchEntries = extractApplyPatchEntries(patchText);
  if (patchEntries.length > 0) return patchEntries;
  const path =
    typeof args?.path === 'string'
      ? args.path
      : typeof args?.file === 'string'
        ? args.file
        : typeof args?.file_path === 'string'
          ? args.file_path
          : undefined;
  if (!path) return [];
  return [{ path, action: 'edited' }];
}

function recordWriteFileChanges(
  fileChanges: FileChangeItem[],
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown> | undefined,
  builtPath: string | undefined,
  summary: { created?: boolean; content?: string; preview?: string },
  payload: Record<string, unknown>,
): void {
  if (!isWriteFileTool(toolName)) return;
  const entries = extractWritePathEntries(args, payload.result ?? payload.output);
  const paths =
    entries.length > 0
      ? entries.map((entry) => (summary.created ? { ...entry, action: 'created' as const } : entry))
      : builtPath
        ? [
            {
              path: builtPath,
              action: summary.created ? ('created' as const) : ('edited' as const),
            },
          ]
        : [];
  const snapshot = snapshotFields(payload);
  for (const entry of paths) {
    const preview = entry.preview ?? summary.content ?? summary.preview;
    const already = fileChanges.find(
      (item) => item.path === entry.path && item.toolCallId === toolCallId,
    );
    if (already) {
      if (preview) already.preview = preview;
      already.action = entry.action;
      if (typeof summary.content === 'string') {
        already.content = summary.content;
      }
      if (snapshot.previousContent !== undefined)
        already.previousContent = snapshot.previousContent;
      if (snapshot.previousTruncated !== undefined) {
        already.previousTruncated = snapshot.previousTruncated;
      }
      continue;
    }
    fileChanges.push({
      path: entry.path,
      action: entry.action,
      toolCallId,
      preview,
      ...snapshot,
      ...(typeof summary.content === 'string' ? { content: summary.content } : {}),
    });
  }
}

export function fileChangeSequences(events: readonly Event[]): Map<string, number> {
  const sequences = new Map<string, number>();
  for (const event of events) {
    if (!isToolEvent(event.type)) continue;
    const callId = extractToolCallId(event.payload, event.id);
    sequences.set(callId, Math.max(sequences.get(callId) ?? 0, event.sequence));
  }
  return sequences;
}

function extractToolCallId(payload: Record<string, unknown>, eventId: string): string {
  if (typeof payload.toolCallId === 'string' && payload.toolCallId) return payload.toolCallId;
  if (typeof payload.callId === 'string' && payload.callId) return payload.callId;
  const toolCall = asRecord(payload.toolCall);
  if (typeof toolCall?.id === 'string' && toolCall.id) return toolCall.id;
  if (typeof payload.actionDigest === 'string' && payload.actionDigest) return payload.actionDigest;
  return eventId;
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
        : typeof args?.file_path === 'string'
          ? args.file_path
          : extractWritePathEntries(args)[0]?.path;
  const command =
    typeof args?.command === 'string' ? formatCommandLine(args.command, args?.args) : undefined;
  const url = typeof args?.url === 'string' ? args.url : undefined;
  const query = typeof args?.query === 'string' ? args.query : undefined;
  const application = typeof args?.application === 'string' ? args.application : undefined;
  const focus = path ?? command ?? url ?? query ?? application;
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

function clipContentPreview(content: string, maxLines = 200, maxChars = 12_000): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const lineClipped =
    lines.length <= maxLines
      ? lines.join('\n')
      : `${lines.slice(0, maxLines).join('\n')}\n... (${lines.length} lines total)`;
  if (lineClipped.length <= maxChars) return lineClipped;
  return `${lineClipped.slice(0, maxChars)}\n... (content truncated)`;
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
        preview: clipContentPreview(
          `找到 ${total} 项\n${names.join('\n')}${total > names.length ? '\n…' : ''}`,
          22,
        ),
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

  if (isWriteFileTool(toolName)) {
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
    const summary = body || (exitCode === undefined ? '命令已完成' : `退出码 ${exitCode}`);
    return {
      exitCode,
      preview: clipContentPreview(summary, 40),
    };
  }

  if (typeof parsed === 'string' && parsed.trim()) {
    return { preview: clipContentPreview(parsed, 30) };
  }
  if (obj) {
    try {
      const text = JSON.stringify(obj, null, 2);
      return { preview: clipContentPreview(text, 30, 1200) };
    } catch {
      return {};
    }
  }
  return {};
}

interface ProviderUsageProjection {
  tokensIn?: number;
  tokensOut?: number;
  cachedTokensHit?: number;
  cachedTokensCreated?: number;
}

function providerUsageNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function maximumUsageValue(
  current: number | undefined,
  next: number | undefined,
): number | undefined {
  if (next === undefined) return current;
  return current === undefined ? next : Math.max(current, next);
}

function sumUsageValues(
  usages: Iterable<ProviderUsageProjection>,
  field: keyof ProviderUsageProjection,
): number | undefined {
  let reported = false;
  let total = 0;
  for (const usage of usages) {
    const value = usage[field];
    if (value === undefined) continue;
    reported = true;
    total += value;
  }
  return reported ? total : undefined;
}

function occupancyCategoriesFromPayload(
  value: unknown,
): Array<{ name: string; tokens: number }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const categories: Array<{ name: string; tokens: number }> = [];
  for (const row of value) {
    const record = asRecord(row);
    const name = typeof record?.name === 'string' ? record.name.trim() : '';
    const tokens = providerUsageNumber(record?.tokens);
    if (!name || tokens === undefined) continue;
    categories.push({ name, tokens });
  }
  return categories.length > 0 ? categories : undefined;
}

/**
 * Project NewMax-style "执行过程" steps + file changes + token usage.
 */
export function projectRunProcess(
  runId: RunId,
  events: readonly Event[],
  page?: RunProcessPageRequest,
): RunProcessView {
  return paginateRunProcess(projectRunProcessSnapshot(runId, events), page);
}

export function projectRunProcessSnapshot(runId: RunId, events: readonly Event[]): RunProcessView {
  const threadId: string | undefined = undefined;
  const ordered = events
    .filter(
      (event) =>
        (!runId || eventRunId(event) === runId) &&
        (!threadId || !eventThreadId(event) || eventThreadId(event) === threadId),
    )
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
  const deniedToolCalls = projectDeniedToolCalls(ordered);
  const byId = new Map<string, ExecutionProcessStep>();
  const order: string[] = [];
  const fileChanges: FileChangeItem[] = [];
  let taskPlan: TaskPlanView | undefined;
  const toolArgumentsByCall = new Map<string, Record<string, unknown>>();
  const toolNameByCall = new Map<string, string>();
  const providerUsageByRequest = new Map<string, ProviderUsageProjection>();
  /** Max event sequence per requestId — used to pick the last request as the context watermark. */
  const usageRequestSequence = new Map<string, number>();
  let occupancyUsedTokens: number | undefined;
  let occupancyWindowTokens: number | undefined;
  let occupancyCategories: Array<{ name: string; tokens: number }> | undefined;
  let startedAt: string | undefined;
  let completedAt: string | undefined;
  let providerModelId: string | undefined;
  let modelId: string | undefined;
  let terminalStepError: string | undefined;

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
      if (
        event.type === 'run.paused' &&
        !['no_fallback_configured', 'fallback_exhausted', 'recovery_expired'].includes(
          String(event.payload.reason),
        )
      )
        continue;
      completedAt = event.occurredAt;
      terminalStepError =
        event.type === 'run.cancelled'
          ? '运行已取消，工具未报告完成'
          : event.type === 'run.completed'
            ? '运行已结束，工具未报告执行结果'
            : '运行已停止，工具未报告完成';
      providerModelId = eventProviderModelId(event) ?? providerModelId;
      modelId = eventModelId(event) ?? modelId;
      continue;
    }

    if (event.type === 'kernel.context_occupancy') {
      const usedTokens = providerUsageNumber(event.payload.usedTokens);
      if (usedTokens !== undefined) occupancyUsedTokens = usedTokens;
      const windowTokens = providerUsageNumber(event.payload.windowTokens);
      if (windowTokens !== undefined) occupancyWindowTokens = windowTokens;
      const categories = occupancyCategoriesFromPayload(event.payload.categories);
      if (categories) occupancyCategories = categories;
      continue;
    }

    if (event.type === 'provider.usage') {
      const requestId =
        typeof event.payload.requestId === 'string' && event.payload.requestId.length > 0
          ? event.payload.requestId
          : event.id;
      const current = providerUsageByRequest.get(requestId) ?? {};
      const nextTokensIn =
        providerUsageNumber(event.payload.tokensIn) ??
        providerUsageNumber(event.payload.inputTokens);
      const nextTokensOut =
        providerUsageNumber(event.payload.tokensOut) ??
        providerUsageNumber(event.payload.outputTokens);
      providerUsageByRequest.set(requestId, {
        tokensIn: maximumUsageValue(current.tokensIn, nextTokensIn),
        tokensOut: maximumUsageValue(current.tokensOut, nextTokensOut),
        cachedTokensHit: maximumUsageValue(
          current.cachedTokensHit,
          providerUsageNumber(event.payload.cachedTokensHit),
        ),
        cachedTokensCreated: maximumUsageValue(
          current.cachedTokensCreated,
          providerUsageNumber(event.payload.cachedTokensCreated),
        ),
      });
      usageRequestSequence.set(
        requestId,
        Math.max(usageRequestSequence.get(requestId) ?? 0, event.sequence),
      );
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
    const extractedToolName = extractToolName(payload);
    if (extractedToolName !== 'tool') toolNameByCall.set(toolCallId, extractedToolName);
    const toolName =
      extractedToolName === 'tool'
        ? (toolNameByCall.get(toolCallId) ?? extractedToolName)
        : extractedToolName;

    // Task-plan tools are pure UI signals: project the checklist, keep them
    // out of the tool step list (they would be noise there). The persisted
    // NewMax-style tools echo the current plan in their result; legacy
    // update_task_plan carries it in the request arguments/result as before.
    // Kernels reach these tools through MCP, so the wire name arrives as
    // mcp__sync-think-platform__TaskCreate — normalize before matching.
    if (matchesToolName(toolName, TASK_PLAN_TOOL_NAMES)) {
      const parsedPlan = extractTaskPlan(payload);
      if (parsedPlan) taskPlan = parsedPlan;
      continue;
    }

    const args = extractArgs(payload) ?? toolArgumentsByCall.get(toolCallId);
    if (args) toolArgumentsByCall.set(toolCallId, args);
    const built = buildLabel(toolName, args);
    const argsForSummary = args;
    const phase = toolEventPhase(event.type);
    const requested = phase === 'requested';
    const failed =
      phase === 'failed' ||
      (phase === 'completed' &&
        (deniedToolCalls.has(toolCallId) ||
          isToolResultFailure(payload.result ?? payload.output, {}, payload)));
    const completed = phase === 'completed';

    const displayEvent = projectEventContent(event);
    const displayPayload = displayEvent.payload;
    const detailsRef = displayEvent.displayPayloadRef;
    const outputRef = displayPayload.resultRef as DeferredContent | undefined;
    const argumentsRef = displayPayload.argumentsRef as DeferredContent | undefined;
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
        completed && isToolResultFailure(payload.result ?? payload.output, resultSummary, payload);
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
        ...(outputRef ? { outputRef } : {}),
        ...(detailsRef ? { detailsRef } : {}),
        ...(argumentsRef ? { argumentsRef } : {}),
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
        sequence: event.sequence,
        startedAt: event.occurredAt,
        ...(completed || failed ? { completedAt: event.occurredAt } : {}),
        occurredAt: event.occurredAt,
      });
      if (completed && !failed && !resultFailed) {
        recordWriteFileChanges(
          fileChanges,
          toolName,
          toolCallId,
          argsForSummary,
          built.path,
          resultSummary,
          payload,
        );
      }
      continue;
    }

    if (outputRef) existing.outputRef = outputRef;
    if (detailsRef) existing.detailsRef = detailsRef;
    if (argumentsRef) existing.argumentsRef = argumentsRef;
    if (failed) {
      existing.status = 'error';
      existing.completedAt = event.occurredAt;
      existing.error =
        typeof payload.error === 'string'
          ? payload.error
          : typeof payload.errorMessage === 'string'
            ? payload.errorMessage
            : existing.error;
    } else if (completed) {
      const summary = summarizeResult(toolName, payload.result ?? payload.output, argsForSummary);
      const resultFailed = isToolResultFailure(payload.result ?? payload.output, summary, payload);
      existing.status = existing.status === 'error' || resultFailed ? 'error' : 'done';
      existing.completedAt = event.occurredAt;
      existing.preview = summary.preview ?? existing.preview;
      existing.exitCode = summary.exitCode ?? existing.exitCode;
      if (resultFailed && !existing.error) {
        existing.error =
          extractToolResultError(payload.result ?? payload.output) ?? existing.preview;
      }
      if (!resultFailed && !deniedToolCalls.has(toolCallId)) {
        recordWriteFileChanges(
          fileChanges,
          toolName,
          toolCallId,
          argsForSummary,
          existing.path || built.path,
          summary,
          payload,
        );
      }
    } else if (requested) {
      existing.status =
        existing.status === 'done' || existing.status === 'error' ? existing.status : 'running';
      existing.sequence = Math.min(existing.sequence ?? event.sequence, event.sequence);
      if (!existing.startedAt || event.sequence <= (existing.sequence ?? event.sequence)) {
        existing.startedAt = event.occurredAt;
      }
    }

    // Prefer richer labels/args if a later event carries them.
    if (built.path) existing.path = built.path;
    if (built.command) existing.command = built.command;
    if (built.url) existing.url = built.url;
    const titleDetail = existing.path ?? existing.command ?? existing.url;
    // Tool identity (verb/name/kind) is established by the event that STARTED
    // the step. Completion events carry no tool name (extractToolName falls
    // back to the generic "tool") and must never overwrite the identity with
    // that fallback — otherwise an mcp__foo step degrades to a bare "tool".
    const identityComesFromStart = requested && built.kind !== 'other' && built.verb !== 'tool';
    if (identityComesFromStart) {
      existing.verb = built.verb || existing.verb;
      existing.zh = built.zh || existing.zh;
      existing.toolName = toolName || existing.toolName;
      existing.kind = built.kind || existing.kind;
    }
    if (titleDetail) {
      existing.label = `${existing.verb ?? built.verb} ? ${shortText(titleDetail, 52)}`;
    } else if (requested && built.label !== built.verb) {
      existing.label = built.label || existing.label;
    }
    existing.occurredAt = event.occurredAt;
  }

  for (const step of byId.values()) {
    const denied = deniedToolCalls.get(step.id);
    if (denied) {
      step.status = 'error';
      step.error = denied.error;
      step.completedAt = denied.occurredAt;
    } else if (terminalStepError && step.status === 'running') {
      step.status = 'error';
      step.error = terminalStepError;
      step.completedAt = completedAt;
    }
  }

  // Merge adjacent identical labels (read-only / same command) into ×N.
  const raw = order.map((id) => byId.get(id)!).filter(Boolean);
  const steps: ExecutionProcessStep[] = [];
  for (const step of raw) {
    const prev = steps[steps.length - 1];
    const sameKey =
      prev &&
      !prev.detailsRef &&
      !step.detailsRef &&
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
      prev.sequence = Math.min(
        prev.sequence ?? Number.POSITIVE_INFINITY,
        step.sequence ?? Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(prev.sequence)) prev.sequence = undefined;
      if (!prev.startedAt || (step.startedAt && step.startedAt < prev.startedAt)) {
        prev.startedAt = step.startedAt;
      }
      if (step.completedAt && (!prev.completedAt || step.completedAt > prev.completedAt)) {
        prev.completedAt = step.completedAt;
      }
      prev.occurredAt = step.occurredAt ?? prev.occurredAt;
      continue;
    }
    steps.push({ ...step, count: 1 });
  }

  // Dedupe file changes by path (keep last action).
  const changeByPath = new Map<string, FileChangeItem>();
  const changeSequences = fileChangeSequences(ordered);
  for (const change of fileChanges) {
    const previous = changeByPath.get(change.path);
    if (
      !previous ||
      (changeSequences.get(change.toolCallId ?? '') ?? 0) >=
        (changeSequences.get(previous.toolCallId ?? '') ?? 0)
    )
      changeByPath.set(change.path, change);
  }

  const usageRows = [...providerUsageByRequest.values()];
  const tokensIn = sumUsageValues(usageRows, 'tokensIn');
  const tokensOut = sumUsageValues(usageRows, 'tokensOut');
  const cachedTokensHit = sumUsageValues(usageRows, 'cachedTokensHit');
  const cachedTokensCreated = sumUsageValues(usageRows, 'cachedTokensCreated');

  // Context watermark: last billed request input, unless the kernel reported
  // a live occupancy snapshot (Claude /context, Codex tokenUsage.last).
  let contextWatermarkTokens: number | undefined;
  let lastRequestUsage:
    | {
        tokensIn?: number;
        tokensOut?: number;
        cachedTokensHit?: number;
        cachedTokensCreated?: number;
      }
    | undefined;
  let lastRequestId: string | undefined;
  let lastRequestSequence = -1;
  for (const [requestId, sequence] of usageRequestSequence) {
    if (sequence > lastRequestSequence) {
      lastRequestSequence = sequence;
      lastRequestId = requestId;
    }
  }
  if (lastRequestId !== undefined) {
    const last = providerUsageByRequest.get(lastRequestId);
    if (last?.tokensIn !== undefined) {
      contextWatermarkTokens = last.tokensIn;
    }
    // 单次请求口径的明细（最后一次请求），供 footer 展示真实占用/缓存/输出，
    // 与「计费累计」（求和）区分，避免工具循环重发导致的虚高。
    if (last) {
      lastRequestUsage = {
        tokensIn: last.tokensIn,
        tokensOut: last.tokensOut,
        cachedTokensHit: last.cachedTokensHit,
        cachedTokensCreated: last.cachedTokensCreated,
      };
    }
  }
  if (occupancyUsedTokens !== undefined) {
    contextWatermarkTokens = occupancyUsedTokens;
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
    runId,
    steps: steps.map((step) => {
      const limit = Math.max(16, Math.floor(98304 / (12 * Math.max(1, steps.length))));
      return {
        ...step,
        ...(step.command && step.argumentsRef
          ? { command: clipContentPreview(step.command, 40, 2048) }
          : {}),
        ...(step.preview ? { preview: clipContentPreview(step.preview, 200, limit) } : {}),
        ...(step.error ? { error: clipContentPreview(step.error, 200, limit) } : {}),
      };
    }),
    fileChanges: projectFileChangeContent(
      [...changeByPath.values()].map((change) => ({
        ...change,
        ...(change.preview ? { preview: clipContentPreview(change.preview) } : {}),
      })),
      ordered,
    ),
    taskPlan,
    running: steps.some((step) => step.status === 'running'),
    doneCount: steps.filter((step) => step.status === 'done').length,
    errorCount: steps.filter((step) => step.status === 'error').length,
    tokensIn,
    tokensOut,
    cachedTokensHit,
    cachedTokensCreated,
    ...(contextWatermarkTokens !== undefined ? { contextWatermarkTokens } : {}),
    ...(occupancyWindowTokens !== undefined
      ? { contextOccupancyWindowTokens: occupancyWindowTokens }
      : {}),
    ...(occupancyCategories !== undefined
      ? { contextOccupancyCategories: occupancyCategories }
      : {}),
    ...(lastRequestUsage !== undefined ? { lastRequestUsage } : {}),
    durationMs,
    providerModelId,
    modelId,
    startedAt,
    completedAt,
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

function extractToolResultError(resultRaw: unknown): string | undefined {
  const parsed = parseMaybeJson(resultRaw);
  const obj = asRecord(parsed);
  if (typeof obj?.error === 'string' && obj.error.trim()) return obj.error;
  if (typeof obj?.message === 'string' && obj.message.trim()) return obj.message;
  return undefined;
}

/**
 * Forward the pre-write snapshot carried on tool.completed payloads
 * (captured by the chat write_file executor) into FileChangeItem fields.
 */
function snapshotFields(payload: Record<string, unknown>): {
  previousContent?: string;
  previousTruncated?: boolean;
} {
  if (typeof payload.previousContent !== 'string') {
    return {};
  }
  return {
    previousContent: payload.previousContent,
    ...(payload.previousTruncated === true ? { previousTruncated: true } : {}),
  };
}
