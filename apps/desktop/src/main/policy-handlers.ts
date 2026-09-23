import type {
  PolicyCommand,
  PolicyCommandRequest,
  PolicyCommandResponse,
} from '@sync-think/protocol';
import { parsePolicyListPayload, parsePolicySavePayload } from '../orchestration-payloads.js';

export interface PolicyHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestPolicy<K extends PolicyCommand>(
    command: K,
    payload: PolicyCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<PolicyCommandResponse<K>>;
}

export function registerPolicyHandlers<Event>(host: PolicyHost<Event>): void {
  host.handle('runtime:policy-save', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPolicy('policy.save', parsePolicySavePayload(value));
  });

  host.handle('runtime:policy-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPolicy('policy.list', parsePolicyListPayload(value));
  });
}
