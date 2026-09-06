import type { Event } from './types/event.js';
import { normalizeToolName } from './tool-name.js';

export const TASK_PLAN_TOOL_NAMES = new Set([
  'update_task_plan',
  'update_plan',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
]);

export interface NativeTaskPlanItem {
  id?: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TaskPlanProjection {
  items: NativeTaskPlanItem[];
  running: boolean;
  completed: number;
  total: number;
}

export interface TaskPlanScope {
  threadId?: string;
  taskId?: string;
}

export interface TaskPlanState {
  sequence: number;
  runId?: string;
  source?: 'claude' | 'plan';
  items: NativeTaskPlanItem[] | null;
  running: boolean;
  pending: Record<
    string,
    { name: string; args: Record<string, unknown>; previousItems?: NativeTaskPlanItem[] | null }
  >;
}

const TERMINAL_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.paused']);

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return record(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeItem(
  value: unknown,
  previous?: NativeTaskPlanItem,
): NativeTaskPlanItem | undefined {
  const item = record(value);
  if (!item) return undefined;
  const text = string(item.title ?? item.subject ?? item.content ?? item.step) ?? previous?.title;
  if (!text) return undefined;
  const [title = '', ...details] = text.split(/\r?\n/);
  const description =
    typeof item.description === 'string'
      ? item.description.trim()
      : details.join('\n').trim() || previous?.description;
  const rawStatus = item.status ?? previous?.status;
  const status =
    rawStatus === 'completed'
      ? 'completed'
      : rawStatus === 'in_progress' || rawStatus === 'inProgress'
        ? 'in_progress'
        : 'pending';
  const id = string(item.id) ?? previous?.id;
  return {
    ...(id ? { id } : {}),
    title: title.trim(),
    ...(description ? { description } : {}),
    status,
  };
}

function normalizeItems(
  raw: unknown,
  previous: NativeTaskPlanItem[] | null = null,
): NativeTaskPlanItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((entry) => {
    const id = string(record(entry)?.id);
    const item = normalizeItem(
      entry,
      id ? previous?.find((candidate) => candidate.id === id) : undefined,
    );
    return item ? [item] : [];
  });
}

export function extractTaskPlanSnapshot(
  payload: Record<string, unknown>,
): Omit<TaskPlanProjection, 'running'> | undefined {
  const output = record(payload.structuredResult ?? payload.result ?? payload.output);
  if (payload.failed === true || output?.ok === false || output?.success === false)
    return undefined;
  const toolCall = record(payload.toolCall);
  const args = record(
    payload.arguments ??
      payload.args ??
      payload.argumentsJson ??
      toolCall?.argumentsJson ??
      toolCall?.arguments,
  );
  const items = normalizeItems(record(output?.plan)?.items ?? args?.items ?? args?.plan);
  return items
    ? {
        items,
        completed: items.filter((item) => item.status === 'completed').length,
        total: items.length,
      }
    : undefined;
}

export function reduceTaskPlanEvents(
  events: readonly Event[],
  scope?: TaskPlanScope,
  initial?: TaskPlanState,
  options?: {
    confirmedOnly?: boolean;
    onSnapshot?: (state: TaskPlanState, event: Event) => void;
  },
): TaskPlanState {
  const state: TaskPlanState = initial
    ? {
        ...initial,
        items: initial.items?.map((item) => ({ ...item })) ?? null,
        pending: { ...initial.pending },
      }
    : { sequence: 0, items: null, running: false, pending: {} };
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const threads = new Map<string, string>();
  for (const event of ordered) {
    const threadId = string(record(event.payload)?.threadId);
    if (event.runId && threadId) threads.set(String(event.runId), threadId);
  }
  for (const event of ordered) {
    if (event.sequence <= (initial?.sequence ?? 0)) continue;
    const payload = record(event.payload) ?? {};
    const threadId =
      string(payload.threadId) ?? (event.runId ? threads.get(String(event.runId)) : undefined);
    if (
      scope?.threadId && threadId
        ? threadId !== scope.threadId
        : scope?.taskId
          ? event.taskId !== scope.taskId
          : scope?.threadId
            ? String(event.runId) !== state.runId
            : false
    )
      continue;
    state.sequence = event.sequence;
    if (event.type === 'run.started') {
      if (state.source !== 'claude' || payload.kernelId !== 'claude-code') {
        state.items = null;
        state.source = undefined;
      }
      state.pending = {};
      state.runId = event.runId ? String(event.runId) : undefined;
      state.running = true;
      continue;
    }
    if (TERMINAL_TYPES.has(event.type)) {
      if (!state.runId || !event.runId || state.runId === String(event.runId)) {
        state.running = false;
        state.pending = {};
      }
      continue;
    }
    if (!event.type.includes('tool') && !event.type.startsWith('mcp.')) continue;
    const toolCall = record(payload.toolCall);
    const callId = string(payload.toolCallId ?? toolCall?.id);
    const callKey = `${event.runId ?? state.runId ?? ''}:${callId ?? ''}`;
    const pending = state.pending[callKey];
    const rawName =
      string(payload.toolName ?? payload.tool ?? payload.name ?? toolCall?.name) ?? pending?.name;
    if (!rawName) continue;
    const name = normalizeToolName(rawName);
    if (!TASK_PLAN_TOOL_NAMES.has(name)) continue;
    const requested = event.type.endsWith('requested');
    const args =
      (!requested ? pending?.args : undefined) ??
      record(
        payload.arguments ??
          payload.args ??
          payload.argumentsJson ??
          toolCall?.argumentsJson ??
          toolCall?.arguments ??
          toolCall?.args,
      ) ??
      {};
    if (requested) {
      if (payload.partial === true) continue;
      if (callId) state.pending[callKey] = { name: rawName, args, previousItems: state.items };
      if (!options?.confirmedOnly && (name === 'update_plan' || name === 'update_task_plan')) {
        const snapshot = extractTaskPlanSnapshot(payload);
        if (snapshot) {
          state.items = snapshot.items;
          state.source = 'plan';
        }
      }
      continue;
    }
    if (
      options?.confirmedOnly &&
      !event.type.endsWith('completed') &&
      event.type !== 'mcp.tool_called'
    )
      continue;
    if (callId) delete state.pending[callKey];
    const output = record(payload.structuredResult ?? payload.result ?? payload.output);
    if (
      event.type.endsWith('failed') ||
      payload.failed === true ||
      payload.isError === true ||
      output?.ok === false ||
      output?.success === false
    ) {
      if (
        !options?.confirmedOnly &&
        pending &&
        (name === 'update_task_plan' || name === 'update_plan')
      )
        state.items = pending.previousItems ?? null;
      continue;
    }
    const snapshot = extractTaskPlanSnapshot({ ...payload, arguments: args });
    if (snapshot) {
      state.items = snapshot.items;
      state.source = 'plan';
      options?.onSnapshot?.(state, event);
      continue;
    }
    if (rawName.startsWith('mcp__')) continue;
    if (name === 'TodoWrite') {
      const items = normalizeItems(output?.newTodos ?? args.todos);
      if (items) {
        state.items = items;
        state.source = 'claude';
        options?.onSnapshot?.(state, event);
      }
    } else if (name === 'TaskList') {
      const items = normalizeItems(output?.tasks, state.items);
      if (items) {
        state.items = items;
        state.source = 'claude';
        options?.onSnapshot?.(state, event);
      }
    } else if (name === 'TaskCreate' || name === 'TaskGet') {
      const task = record(output?.task);
      const id = string(task?.id);
      if (!id) continue;
      const previous = state.items?.find((item) => item.id === id);
      const item = normalizeItem({ ...(name === 'TaskCreate' ? args : {}), ...task }, previous);
      if (!item) continue;
      state.items = previous
        ? state.items!.map((current) => (current.id === id ? item : current))
        : [...(state.items ?? []), item];
      state.source = 'claude';
      options?.onSnapshot?.(state, event);
    } else if (name === 'TaskUpdate' && output?.success === true) {
      const id = string(output.taskId ?? args.taskId);
      if (!id) continue;
      if (options?.confirmedOnly && !state.items?.some((item) => item.id === id)) continue;
      const status = record(output.statusChange)?.to ?? args.status;
      state.items = (state.items ?? []).flatMap((previous) => {
        if (previous.id !== id) return [previous];
        if (status === 'deleted') return [];
        const item = normalizeItem({ ...args, status, id }, previous);
        return item ? [item] : [previous];
      });
      state.source = 'claude';
      options?.onSnapshot?.(state, event);
    }
  }
  return state;
}

export function projectTaskPlan(state: TaskPlanState): TaskPlanProjection | null {
  if (!state.items?.length) return null;
  return {
    items: state.items,
    running: state.running,
    completed: state.items.filter((item) => item.status === 'completed').length,
    total: state.items.length,
  };
}
