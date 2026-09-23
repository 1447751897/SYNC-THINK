import type {
  ArchiveTaskPayload,
  ArchiveTaskResponse,
  CreateTaskPayload,
  CreateTaskResponse,
  ListTasksPayload,
  ListTasksResponse,
  OpenTaskPayload,
  OpenTaskResponse,
  SearchTasksPayload,
  SearchTasksResponse,
  UnarchiveTaskPayload,
  UnarchiveTaskResponse,
} from './commands.js';

/** Task directory lifecycle RPCs, excluding execution-mode policy. */
export interface TaskCommandContract {
  'task.create': {
    request: CreateTaskPayload;
    response: CreateTaskResponse;
  };
  'task.list': {
    request: ListTasksPayload;
    response: ListTasksResponse;
  };
  'task.open': {
    request: OpenTaskPayload;
    response: OpenTaskResponse;
  };
  'task.search': {
    request: SearchTasksPayload;
    response: SearchTasksResponse;
  };
  'task.archive': {
    request: ArchiveTaskPayload;
    response: ArchiveTaskResponse;
  };
  'task.unarchive': {
    request: UnarchiveTaskPayload;
    response: UnarchiveTaskResponse;
  };
}

export type TaskCommand = keyof TaskCommandContract;
export type TaskCommandRequest<K extends TaskCommand> = TaskCommandContract[K]['request'];
export type TaskCommandResponse<K extends TaskCommand> = TaskCommandContract[K]['response'];
