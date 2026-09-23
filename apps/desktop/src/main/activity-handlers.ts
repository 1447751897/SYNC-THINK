import type {
  ActivityCommand,
  ActivityCommandRequest,
  ActivityCommandResponse,
} from '@sync-think/protocol';
import {
  parseActivityListExternalEventsPayload,
  parseActivityListRunsPayload,
  parseActivityRetryAnchorPayload,
} from '../team-payloads.js';

export interface ActivityHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestActivity<K extends ActivityCommand>(
    command: K,
    payload: ActivityCommandRequest<NoInfer<K>>,
  ): Promise<ActivityCommandResponse<K>>;
}

export function registerActivityHandlers<Event>(host: ActivityHost<Event>): void {
  host.handle('runtime:activity-list-runs', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestActivity('activity.listRuns', parseActivityListRunsPayload(value));
  });

  host.handle('runtime:activity-list-external-events', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestActivity(
      'activity.listExternalEvents',
      parseActivityListExternalEventsPayload(value),
    );
  });

  host.handle('runtime:activity-retry-anchor', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestActivity('activity.retryAnchor', parseActivityRetryAnchorPayload(value));
  });
}
