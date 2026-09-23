import type {
  ScheduledTaskCommand,
  ScheduledTaskCommandRequest,
  ScheduledTaskCommandResponse,
} from '@sync-think/protocol';
import {
  parseCreateScheduledTaskPayload,
  parseDeleteScheduledTaskPayload,
  parseListScheduledTaskHistoryPayload,
  parseListScheduledTasksPayload,
  parseTriggerScheduledTaskPayload,
  parseUpdateScheduledTaskPayload,
} from '../team-payloads.js';

export interface ScheduledTaskHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestScheduledTask<K extends ScheduledTaskCommand>(
    command: K,
    payload: ScheduledTaskCommandRequest<NoInfer<K>>,
  ): Promise<ScheduledTaskCommandResponse<K>>;
}

export function registerScheduledTaskHandlers<Event>(host: ScheduledTaskHost<Event>): void {
  host.handle('runtime:scheduled-task-create', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestScheduledTask(
      'scheduledTask.create',
      parseCreateScheduledTaskPayload(value),
    );
  });

  host.handle('runtime:scheduled-task-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestScheduledTask('scheduledTask.list', parseListScheduledTasksPayload(value));
  });

  host.handle('runtime:scheduled-task-update', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestScheduledTask(
      'scheduledTask.update',
      parseUpdateScheduledTaskPayload(value),
    );
  });

  host.handle('runtime:scheduled-task-delete', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestScheduledTask(
      'scheduledTask.delete',
      parseDeleteScheduledTaskPayload(value),
    );
  });

  host.handle('runtime:scheduled-task-trigger', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestScheduledTask(
      'scheduledTask.trigger',
      parseTriggerScheduledTaskPayload(value),
    );
  });

  host.handle('runtime:scheduled-task-history', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestScheduledTask(
      'scheduledTask.history',
      parseListScheduledTaskHistoryPayload(value),
    );
  });
}
