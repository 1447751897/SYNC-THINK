import type { Event } from './types/event.js';
import { reduceTaskPlanEvents, type NativeTaskPlanItem, type TaskPlanScope } from './task-plan.js';

export interface TaskPlanHistoryRun {
  runId: string;
  sequence: number;
  updatedSequence: number;
  updatedAt: string;
  kernelId?: string;
  source: 'claude' | 'plan';
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'superseded';
  title: string;
  completed: number;
  total: number;
}

export interface TaskPlanHistorySelection extends TaskPlanHistoryRun {
  items: NativeTaskPlanItem[];
}

export interface TaskPlanHistorySnapshot {
  runs: TaskPlanHistoryRun[];
  nextBeforeSequence?: number;
  nextBeforeRunId?: string;
  selected?: TaskPlanHistorySelection;
}

export interface TaskPlanHistoryOptions {
  beforeSequence?: number;
  beforeRunId?: string;
  runId?: string;
}

function compareRunIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareRuns(
  left: Pick<TaskPlanHistoryRun, 'sequence' | 'runId'>,
  right: Pick<TaskPlanHistoryRun, 'sequence' | 'runId'>,
): number {
  return left.sequence - right.sequence || compareRunIds(left.runId, right.runId);
}

export function projectTaskPlanHistory(
  events: readonly Event[],
  scope?: TaskPlanScope,
  options: TaskPlanHistoryOptions = {},
): TaskPlanHistorySnapshot {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const boundaries = new Map<
    string,
    { sequence: number; kernelId?: string; status: TaskPlanHistoryRun['status'] }
  >();
  let activeRunId: string | undefined;
  for (const event of ordered) {
    if (!event.runId || (scope?.taskId && event.taskId !== scope.taskId)) continue;
    if (
      scope?.threadId &&
      typeof event.payload.threadId === 'string' &&
      event.payload.threadId !== scope.threadId
    )
      continue;
    const runId = String(event.runId);
    if (event.type === 'run.started') {
      const previous = activeRunId ? boundaries.get(activeRunId) : undefined;
      if (previous?.status === 'running') previous.status = 'superseded';
      boundaries.set(runId, {
        sequence: event.sequence,
        status: 'running',
        ...(typeof event.payload.kernelId === 'string'
          ? { kernelId: event.payload.kernelId.slice(0, 128) }
          : {}),
      });
      activeRunId = runId;
    } else if (
      ['run.completed', 'run.failed', 'run.cancelled', 'run.paused'].includes(event.type)
    ) {
      const boundary = boundaries.get(runId);
      if (boundary) boundary.status = event.type.slice(4) as TaskPlanHistoryRun['status'];
    }
  }
  const candidates = new Map<string, TaskPlanHistoryRun>();
  let selected: TaskPlanHistorySelection | undefined;
  reduceTaskPlanEvents(ordered, scope, undefined, {
    confirmedOnly: true,
    onSnapshot(state, event) {
      const runId = event.runId ? String(event.runId) : state.runId;
      if (!runId || !state.source || !state.items) return;
      const boundary = boundaries.get(runId);
      const previous = candidates.get(runId);
      const summary: TaskPlanHistoryRun = {
        runId,
        sequence: boundary?.sequence ?? previous?.sequence ?? event.sequence,
        updatedSequence: event.sequence,
        updatedAt: event.occurredAt,
        ...(boundary?.kernelId ? { kernelId: boundary.kernelId } : {}),
        source: state.source,
        status: boundary?.status ?? 'superseded',
        title: (state.items[0]?.title ?? '已清空任务清单').slice(0, 160).split('').join(''),
        completed: state.items.filter((item) => item.status === 'completed').length,
        total: state.items.length,
      };
      const inPage =
        options.beforeSequence === undefined ||
        summary.sequence < options.beforeSequence ||
        (summary.sequence === options.beforeSequence &&
          options.beforeRunId !== undefined &&
          compareRunIds(summary.runId, options.beforeRunId) < 0);
      if (inPage) {
        candidates.set(runId, summary);
        if (candidates.size > 11) {
          const oldest = [...candidates.values()].sort(compareRuns)[0]!;
          candidates.delete(oldest.runId);
        }
      }
      if (
        options.runId
          ? options.runId === runId
          : inPage && (!selected || compareRuns(summary, selected) >= 0)
      ) {
        selected = { ...summary, items: state.items };
      }
    },
  });
  const runs = [...candidates.values()].sort((left, right) => compareRuns(right, left));
  return {
    runs: runs.slice(0, 10),
    ...(runs.length > 10
      ? { nextBeforeSequence: runs[9]!.sequence, nextBeforeRunId: runs[9]!.runId }
      : {}),
    ...(selected ? { selected } : {}),
  };
}
