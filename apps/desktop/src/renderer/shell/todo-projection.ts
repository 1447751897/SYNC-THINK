import {
  extractTaskPlanSnapshot,
  projectTaskPlan,
  reduceTaskPlanEvents,
  type Event,
  type TaskPlanProjection,
  type TaskPlanScope,
  type TaskPlanState,
} from '@sync-think/shared';

export type TodoProjection = TaskPlanProjection;
export type TodoProjectionScope = TaskPlanScope;
export const extractTodoSnapshot = extractTaskPlanSnapshot;

export function projectTodoFromEvents(
  events: readonly Event[],
  scope?: TodoProjectionScope,
  initial?: TaskPlanState,
): TodoProjection | null {
  return projectTaskPlan(reduceTaskPlanEvents(events, scope, initial));
}

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
