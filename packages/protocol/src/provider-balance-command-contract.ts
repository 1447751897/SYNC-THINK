import type { ProviderBalancePayload, ProviderBalanceResponse } from './commands.js';

/** Read-only provider account balance query. */
export interface ProviderBalanceCommandContract {
  'provider.balance': { request: ProviderBalancePayload; response: ProviderBalanceResponse };
}

export type ProviderBalanceCommand = keyof ProviderBalanceCommandContract;
export type ProviderBalanceCommandRequest<K extends ProviderBalanceCommand> =
  ProviderBalanceCommandContract[K]['request'];
export type ProviderBalanceCommandResponse<K extends ProviderBalanceCommand> =
  ProviderBalanceCommandContract[K]['response'];
