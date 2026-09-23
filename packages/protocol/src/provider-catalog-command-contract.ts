import type {
  CreateProviderPayload,
  CreateProviderResponse,
  DeleteProviderPayload,
  DeleteProviderResponse,
  ListProvidersPayload,
  ListProvidersResponse,
  ReorderProvidersPayload,
  ReorderProvidersResponse,
  UpdateProviderPayload,
  UpdateProviderResponse,
} from './commands.js';

/** Provider directory lifecycle RPCs, excluding credentials, models and live probes. */
export interface ProviderCatalogCommandContract {
  'provider.create': { request: CreateProviderPayload; response: CreateProviderResponse };
  'provider.update': { request: UpdateProviderPayload; response: UpdateProviderResponse };
  'provider.list': { request: ListProvidersPayload; response: ListProvidersResponse };
  'provider.reorder': { request: ReorderProvidersPayload; response: ReorderProvidersResponse };
  'provider.delete': { request: DeleteProviderPayload; response: DeleteProviderResponse };
}

export type ProviderCatalogCommand = keyof ProviderCatalogCommandContract;
export type ProviderCatalogCommandRequest<K extends ProviderCatalogCommand> =
  ProviderCatalogCommandContract[K]['request'];
export type ProviderCatalogCommandResponse<K extends ProviderCatalogCommand> =
  ProviderCatalogCommandContract[K]['response'];
