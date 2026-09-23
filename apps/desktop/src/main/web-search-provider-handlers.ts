import {
  parseListWebSearchProvidersPayload,
  parseReorderWebSearchProvidersPayload,
  parseSaveWebSearchProviderPayload,
  parseTestWebSearchProviderPayload,
  type WebSearchProviderCommand,
  type WebSearchProviderCommandRequest,
  type WebSearchProviderCommandResponse,
} from '@sync-think/protocol';
import { WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface WebSearchProviderHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestWebSearchProvider<K extends WebSearchProviderCommand>(
    command: K,
    payload: WebSearchProviderCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<WebSearchProviderCommandResponse<K>>;
}

export function registerWebSearchProviderHandlers<Event>(
  host: WebSearchProviderHost<Event>,
): void {
  host.handle(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.list, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    const payload = parseListWebSearchProvidersPayload(value ?? {});
    if (!payload) throw new Error('Invalid web search providers list payload');
    return host.requestWebSearchProvider('webSearch.providers.list', payload);
  });

  host.handle(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.save, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    const payload = parseSaveWebSearchProviderPayload(value);
    if (!payload) throw new Error('Invalid web search provider save payload');
    return host.requestWebSearchProvider('webSearch.providers.save', payload);
  });

  host.handle(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.reorder, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    const payload = parseReorderWebSearchProvidersPayload(value);
    if (!payload) throw new Error('Invalid web search provider reorder payload');
    return host.requestWebSearchProvider('webSearch.providers.reorder', payload);
  });

  host.handle(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.test, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    const payload = parseTestWebSearchProviderPayload(value);
    if (!payload) throw new Error('Invalid web search provider test payload');
    return host.requestWebSearchProvider('webSearch.providers.test', payload);
  });
}
