import type {
  ActivityListExternalEventsPayload,
  ActivityListExternalEventsResponse,
  ActivityListRunsPayload,
  ActivityListRunsResponse,
  ActivityRetryAnchorPayload,
  ActivityRetryAnchorResponse,
} from './commands.js';

/** Activity Center read-model queries and retry-anchor resolution. */
export interface ActivityCommandContract {
  'activity.listRuns': {
    request: ActivityListRunsPayload;
    response: ActivityListRunsResponse;
  };
  'activity.listExternalEvents': {
    request: ActivityListExternalEventsPayload;
    response: ActivityListExternalEventsResponse;
  };
  'activity.retryAnchor': {
    request: ActivityRetryAnchorPayload;
    response: ActivityRetryAnchorResponse;
  };
}

export type ActivityCommand = keyof ActivityCommandContract;
export type ActivityCommandRequest<K extends ActivityCommand> =
  ActivityCommandContract[K]['request'];
export type ActivityCommandResponse<K extends ActivityCommand> =
  ActivityCommandContract[K]['response'];
