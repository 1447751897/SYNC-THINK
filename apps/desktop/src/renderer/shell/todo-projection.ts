/**
 * 任务清单投影（对齐 DSH todo projection）。
 *
 * 从持久化事件流投影「当前有效任务清单」：
 *  - 任务工具调用（update_task_plan / TaskCreate / TaskUpdate / TaskList）携带
 *    完整快照，取最近一次；
 *  - run.started 清空（新轮计划），run 终态保留刚完成的清单（下一轮开始才清空）；
 *  - 事件流来自持久化存储 → 刷新 / 回放可恢复。
 */
import { matchesToolName, type Event } from '@sync-think/shared';
import type { TaskPlanItem, TaskPlanView } from './execution-process.js';

export interface TodoProjection {
  items: TaskPlanItem[];
  running: boolean;
  completed: number;
  total: number;
}

export interface TodoProjectionScope {
  threadId?: string;
  taskId?: string;
}

const TASK_PLAN_TOOL_NAMES = new Set(['update_task_plan', 'TaskCreate', 'TaskUpdate', 'TaskList']);

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

function extractToolName(payload: Record<string, unknown>): string {
  if (typeof payload.toolName === 'string' && payload.toolName) return payload.toolName;
  if (typeof payload.tool === 'string' && payload.tool) return payload.tool;
  if (typeof payload.name === 'string' && payload.name) return payload.name;
  const toolCall = isRecord(payload.toolCall) ? payload.toolCall : undefined;
  if (typeof toolCall?.name === 'string' && toolCall.name) return toolCall.name;
  return 'tool';
}

function extractToolCallId(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.toolCallId === 'string' && payload.toolCallId) return payload.toolCallId;
  const toolCall = isRecord(payload.toolCall) ? payload.toolCall : undefined;
  return typeof toolCall?.id === 'string' && toolCall.id ? toolCall.id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function extractArgs(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = payload.arguments ?? payload.args;
  if (isRecord(raw)) return raw;
  const direct = asRecord(parseMaybeJson(raw));
  if (direct) return direct;
  const toolCall = asRecord(payload.toolCall);
  if (!toolCall) return undefined;
  return asRecord(parseMaybeJson(toolCall.argumentsJson ?? toolCall.arguments ?? toolCall.args));
}

function normalizeItems(raw: unknown): TaskPlanItem[] | undefined {
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
  return items.length > 0 ? items : undefined;
}

/** 从单个工具事件 payload 提取任务清单快照（result 优先，回退 arguments）。 */
export function extractTodoSnapshot(payload: Record<string, unknown>): TaskPlanView | undefined {
  const result = asRecord(parseMaybeJson(payload.result ?? payload.output));
  if (result && result.ok === true) {
    const plan = asRecord(result.plan);
    if (plan) {
      const items = normalizeItems(plan.items);
      if (items)
        return {
          items,
          completed: items.filter((i) => i.status === 'completed').length,
          total: items.length,
        };
    }
  }
  const args = extractArgs(payload);
  if (!args) return undefined;
  const items = normalizeItems(args.items);
  if (!items) return undefined;
  return {
    items,
    completed: items.filter((i) => i.status === 'completed').length,
    total: items.length,
  };
}

const RUN_TERMINAL_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.paused']);

/**
 * 从事件流投影任务清单。events 需按 sequence 升序（自动排序）。
 * 返回 null 表示当前无有效清单（不渲染）。
 */
export function projectTodoFromEvents(
  events: readonly Event[],
  scope?: TodoProjectionScope,
): TodoProjection | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const scopedRunIds = new Set<string>();
  if (scope?.threadId || scope?.taskId) {
    const knownThreadIdsByRun = new Map<string, Set<string>>();
    for (const event of ordered) {
      if (!event.runId || !isRecord(event.payload)) continue;
      const eventThreadId =
        typeof event.payload.threadId === 'string' ? event.payload.threadId : undefined;
      if (!eventThreadId) continue;
      const runId = String(event.runId);
      const knownThreadIds = knownThreadIdsByRun.get(runId) ?? new Set<string>();
      knownThreadIds.add(eventThreadId);
      knownThreadIdsByRun.set(runId, knownThreadIds);
    }
    for (const event of ordered) {
      if (!event.runId) continue;
      const runId = String(event.runId);
      const knownThreadIds = knownThreadIdsByRun.get(runId);
      if (scope.threadId && knownThreadIds && knownThreadIds.size > 0) {
        if (knownThreadIds.has(scope.threadId)) scopedRunIds.add(runId);
        continue;
      }
      if (scope.taskId && event.taskId === scope.taskId) scopedRunIds.add(runId);
    }
  }
  const scopedEvents =
    scope?.threadId || scope?.taskId
      ? ordered.filter((event) => {
          if (event.runId) return scopedRunIds.has(String(event.runId));
          const eventThreadId =
            isRecord(event.payload) && typeof event.payload.threadId === 'string'
              ? event.payload.threadId
              : undefined;
          if (scope.threadId && eventThreadId) return eventThreadId === scope.threadId;
          return Boolean(scope.taskId && event.taskId === scope.taskId);
        })
      : ordered;
  let snapshot: TaskPlanView | undefined;
  let running = false;
  const toolNamesByCallId = new Map<string, string>();
  for (const event of scopedEvents) {
    if (event.type === 'run.started') {
      // 新轮开始：清空上一轮的计划（对齐 DSH turn/start）。
      snapshot = undefined;
      running = true;
      continue;
    }
    if (RUN_TERMINAL_TYPES.has(event.type)) {
      running = false;
      continue;
    }
    if (isToolEvent(event.type) && isRecord(event.payload)) {
      const toolCallId = extractToolCallId(event.payload);
      const extractedToolName = extractToolName(event.payload);
      if (toolCallId && extractedToolName !== 'tool') {
        toolNamesByCallId.set(toolCallId, extractedToolName);
      }
      const toolName =
        extractedToolName === 'tool' && toolCallId
          ? (toolNamesByCallId.get(toolCallId) ?? extractedToolName)
          : extractedToolName;
      // 归一化：内核经 MCP 调用时名字是 mcp__sync-think-platform__TaskCreate。
      if (matchesToolName(toolName, TASK_PLAN_TOOL_NAMES)) {
        const next = extractTodoSnapshot(event.payload);
        if (next) snapshot = next;
      }
    }
  }
  if (!snapshot) return null;
  return {
    items: snapshot.items,
    running,
    completed: snapshot.completed,
    total: snapshot.total,
  };
}

/** DSH 风格进度文案：「N 完成 · N 进行中 · N 待办」（零计数省略）。 */
export function todoProgressLabel(todo: TodoProjection): string {
  const done = todo.items.filter((item) => item.status === 'completed').length;
  const active = todo.items.filter((item) => item.status === 'in_progress').length;
  const pending = todo.items.length - done - active;
  return [
    ...(done > 0 ? [`${done} 完成`] : []),
    ...(active > 0 ? [`${active} 进行中`] : []),
    ...(pending > 0 ? [`${pending} 待办`] : []),
  ].join(' · ');
}
