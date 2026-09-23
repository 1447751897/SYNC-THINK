import type {
  ProviderBalanceCommand,
  ProviderBalanceCommandRequest,
  ProviderBalanceCommandResponse,
} from '@sync-think/protocol';
import { parseProviderBalancePayload } from '../provider-balance-payloads.js';
import { PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface ProviderBalanceHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestProviderBalance<K extends ProviderBalanceCommand>(
    command: K,
    payload: ProviderBalanceCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ProviderBalanceCommandResponse<K>>;
}

export function registerProviderBalanceHandlers<Event>(host: ProviderBalanceHost<Event>): void {
  host.handle(PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS.query, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderBalance('provider.balance', parseProviderBalancePayload(value));
  });
}
