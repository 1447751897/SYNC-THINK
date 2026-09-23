import type { UsageSummaryPayload, UsageSummaryResponse } from './commands.js';

/** Usage reporting RPCs bind each command to its request and response payload. */
export interface UsageCommandContract {
  'usage.summary': {
    request: UsageSummaryPayload;
    response: UsageSummaryResponse;
  };
}

export type UsageCommand = keyof UsageCommandContract;
export type UsageCommandRequest<K extends UsageCommand> = UsageCommandContract[K]['request'];
export type UsageCommandResponse<K extends UsageCommand> = UsageCommandContract[K]['response'];
