import type {
  CreateScheduledTaskPayload,
  CreateScheduledTaskResponse,
  DeleteScheduledTaskPayload,
  DeleteScheduledTaskResponse,
  ListScheduledTaskHistoryPayload,
  ListScheduledTaskHistoryResponse,
  ListScheduledTasksPayload,
  ListScheduledTasksResponse,
  TriggerScheduledTaskPayload,
  TriggerScheduledTaskResponse,
  UpdateScheduledTaskPayload,
  UpdateScheduledTaskResponse,
} from './commands.js';

/** Scheduled Task catalog, lifecycle and execution-history RPCs. */
export interface ScheduledTaskCommandContract {
  'scheduledTask.create': {
    request: CreateScheduledTaskPayload;
    response: CreateScheduledTaskResponse;
  };
  'scheduledTask.list': {
    request: ListScheduledTasksPayload;
    response: ListScheduledTasksResponse;
  };
  'scheduledTask.update': {
    request: UpdateScheduledTaskPayload;
    response: UpdateScheduledTaskResponse;
  };
  'scheduledTask.delete': {
    request: DeleteScheduledTaskPayload;
    response: DeleteScheduledTaskResponse;
  };
  'scheduledTask.trigger': {
    request: TriggerScheduledTaskPayload;
    response: TriggerScheduledTaskResponse;
  };
  'scheduledTask.history': {
    request: ListScheduledTaskHistoryPayload;
    response: ListScheduledTaskHistoryResponse;
  };
}

export type ScheduledTaskCommand = keyof ScheduledTaskCommandContract;
export type ScheduledTaskCommandRequest<K extends ScheduledTaskCommand> =
  ScheduledTaskCommandContract[K]['request'];
export type ScheduledTaskCommandResponse<K extends ScheduledTaskCommand> =
  ScheduledTaskCommandContract[K]['response'];
