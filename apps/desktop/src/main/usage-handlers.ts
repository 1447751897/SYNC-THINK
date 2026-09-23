import type { UsageCommand, UsageCommandRequest, UsageCommandResponse } from '@sync-think/protocol';
import { parseUsageSummaryPayload } from '../provider-payloads.js';

export interface UsageHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestUsage<K extends UsageCommand>(
    command: K,
    payload: UsageCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<UsageCommandResponse<K>>;
}

export function registerUsageHandlers<Event>(host: UsageHost<Event>): void {
  host.handle('runtime:usage-summary', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestUsage('usage.summary', parseUsageSummaryPayload(value));
  });
}
