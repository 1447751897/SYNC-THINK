import type {
  TaskCommand,
  TaskCommandRequest,
  TaskCommandResponse,
} from '@sync-think/protocol';
import {
  parseArchiveTaskPayload,
  parseCreateTaskPayload,
  parseListTasksPayload,
  parseOpenTaskPayload,
  parseSearchTasksPayload,
  parseUnarchiveTaskPayload,
} from '../task-payloads.js';
import { TASK_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface TaskHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestTask<K extends TaskCommand>(
    command: K,
    payload: TaskCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<TaskCommandResponse<K>>;
}

export function registerTaskHandlers<Event>(host: TaskHost<Event>): void {
  host.handle(TASK_RUNTIME_IPC_CHANNELS.create, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTask('task.create', parseCreateTaskPayload(value));
  });

  host.handle(TASK_RUNTIME_IPC_CHANNELS.list, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTask('task.list', parseListTasksPayload(value));
  });

  host.handle(TASK_RUNTIME_IPC_CHANNELS.open, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTask('task.open', parseOpenTaskPayload(value));
  });

  host.handle(TASK_RUNTIME_IPC_CHANNELS.search, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTask('task.search', parseSearchTasksPayload(value));
  });

  host.handle(TASK_RUNTIME_IPC_CHANNELS.archive, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTask('task.archive', parseArchiveTaskPayload(value));
  });

  host.handle(TASK_RUNTIME_IPC_CHANNELS.unarchive, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestTask('task.unarchive', parseUnarchiveTaskPayload(value));
  });
}
