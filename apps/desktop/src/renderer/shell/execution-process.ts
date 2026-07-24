import type { Event } from '@sync-think/shared';

export type ProcessStepStatus = 'running' | 'done' | 'error';
export type ProcessToolKind =
  | 'read'
  | 'list'
  | 'write'
  | 'bash'
  | 'git'
  | 'browser'
  | 'search'
  | 'mcp'
  | 'other';

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
}

export interface ExecutionProcessView {
  steps: ExecutionProcessStep[];
  fileChanges: FileChangeItem[];
  running: boolean;
  doneCount: number;
  errorCount: number;
  tokensIn?: number;
  tokensOut?: number;
}

const TOOL_META: Record<
  string,
  { verb: string; kind: ProcessToolKind; zh: string }
> = {
  read_file: { verb: 'Read', kind: 'read', zh: '读取文件' },
  write_file: { verb: 'Edit', kind: 'write', zh: '写入文件' },
  edit_file: { verb: 'Edit', kind: 'write', zh: '编辑文件' },
  list_files: { verb: 'List', kind: 'list', zh: '列出文件' },
  run_command: { verb: 'Bash', kind: 'bash', zh: '执行命令' },
  git_status: { verb: 'Git', kind: 'git', zh: 'Git 状态' },
  git_diff: { verb: 'Git', kind: 'git', zh: 'Git diff' },
  browser_navigate: { verb: 'Browse', kind: 'browser', zh: '打开网页' },
  browser_extract: { verb: 'Extract', kind: 'browser', zh: '提取网页' },
  browser_click: { verb: 'Click', kind: 'browser', zh: '点击' },
  browser_fill: { verb: 'Fill', kind: 'browser', zh: '填写' },
  search_web: { verb: 'Search', kind: 'search', zh: '搜索' },
};

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
  return typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
}

function eventRunId(event: Event): string | undefined {
  if (event.runId) return String(event.runId);
  if (typeof event.payload.runId === 'string') return event.payload.runId;
  const run = asRecord(event.payload.run);
  return typeof run?.runId === 'string' ? run.runId : undefined;
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

function buildLabel(toolName: string, args?: Record<string, unknown>): {
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
  const command = typeof args?.command === 'string' ? args.command : undefined;
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
  /** write_file body often only appears on tool.requested args, not on completed result. */
  const writeContentByCall = new Map<string, string>();
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  for (const event of ordered) {
    if (runId && eventRunId(event) !== runId) continue;

    if (event.type === 'provider.usage') {
      const eventThread = eventThreadId(event);
      if (threadId && eventThread && eventThread !== threadId) continue;
      if (typeof event.payload.tokensIn === 'number') tokensIn = event.payload.tokensIn;
      if (typeof event.payload.tokensOut === 'number') tokensOut = event.payload.tokensOut;
      // Some adapters use input/output naming.
      if (tokensIn === undefined && typeof event.payload.inputTokens === 'number') {
        tokensIn = event.payload.inputTokens;
      }
      if (tokensOut === undefined && typeof event.payload.outputTokens === 'number') {
        tokensOut = event.payload.outputTokens;
      }
      continue;
    }

    if (!isToolEvent(event.type)) continue;
    if (!runId && threadId && eventThreadId(event) && eventThreadId(event) !== threadId) continue;

    const payload = event.payload;
    const toolCallId = extractToolCallId(payload, event.id);
    const toolName = extractToolName(payload);
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
      byId.set(toolCallId, {
        id: toolCallId,
        label: built.label,
        verb: built.verb,
        zh: built.zh,
        toolName,
        kind: built.kind,
        status: failed ? 'error' : completed ? 'done' : 'running',
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
              : undefined,
        occurredAt: event.occurredAt,
      });
      if (
        completed &&
        (toolName === 'write_file' || toolName === 'edit_file') &&
        built.path
      ) {
        fileChanges.push({
          path: built.path,
          action: resultSummary.created ? 'created' : 'edited',
          toolCallId,
          preview: resultSummary.content ?? resultSummary.preview,
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
      existing.status = existing.status === 'error' ? 'error' : 'done';
      const summary = summarizeResult(
        toolName,
        payload.result ?? payload.output,
        argsForSummary,
      );
      existing.preview = summary.preview ?? existing.preview;
      existing.exitCode = summary.exitCode ?? existing.exitCode;
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
        } else {
          fileChanges.push({
            path,
            action: summary.created ? 'created' : 'edited',
            toolCallId,
            preview: contentPreview,
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

  return {
    steps,
    fileChanges: [...changeByPath.values()],
    running: steps.some((step) => step.status === 'running'),
    doneCount: steps.filter((step) => step.status === 'done').length,
    errorCount: steps.filter((step) => step.status === 'error').length,
    tokensIn,
    tokensOut,
  };
}

export function formatTokenUsage(tokensIn?: number, tokensOut?: number): string | undefined {
  if (tokensIn === undefined && tokensOut === undefined) return undefined;
  if (tokensIn !== undefined && tokensOut !== undefined) {
    return `${tokensIn + tokensOut} tokens · in ${tokensIn} / out ${tokensOut}`;
  }
  if (tokensOut !== undefined) return `${tokensOut} tokens out`;
  return `${tokensIn} tokens in`;
}
