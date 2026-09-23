import type {
  ProviderCatalogCommand,
  ProviderCatalogCommandRequest,
  ProviderCatalogCommandResponse,
} from '@sync-think/protocol';
import {
  parseCreateProviderPayload,
  parseDeleteProviderPayload,
  parseListProvidersPayload,
  parseReorderProvidersPayload,
  parseUpdateProviderPayload,
} from '../provider-catalog-payloads.js';
import { PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  createProviderPayloadFromClipboard,
  updateProviderPayloadFromClipboard,
} from './provider-clipboard.js';

export interface ProviderCatalogHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  readClipboardText(): string;
  requestProviderCatalog<K extends ProviderCatalogCommand>(
    command: K,
    payload: ProviderCatalogCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ProviderCatalogCommandResponse<K>>;
}

export function registerProviderCatalogHandlers<Event>(host: ProviderCatalogHost<Event>): void {
  host.handle(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.create, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCatalog(
      'provider.create',
      createProviderPayloadFromClipboard(parseCreateProviderPayload(value), () =>
        host.readClipboardText(),
      ),
    );
  });

  host.handle(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.update, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCatalog(
      'provider.update',
      updateProviderPayloadFromClipboard(parseUpdateProviderPayload(value), () =>
        host.readClipboardText(),
      ),
    );
  });

  host.handle(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.list, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCatalog('provider.list', parseListProvidersPayload(value));
  });

  host.handle(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.reorder, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCatalog('provider.reorder', parseReorderProvidersPayload(value));
  });

  host.handle(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.delete, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCatalog('provider.delete', parseDeleteProviderPayload(value));
  });
}
