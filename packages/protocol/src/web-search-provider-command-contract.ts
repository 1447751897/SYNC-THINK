import type {
  ListWebSearchProvidersPayload,
  ListWebSearchProvidersResponse,
  ReorderWebSearchProvidersPayload,
  ReorderWebSearchProvidersResponse,
  SaveWebSearchProviderPayload,
  SaveWebSearchProviderResponse,
  TestWebSearchProviderPayload,
  TestWebSearchProviderResponse,
} from './web-search.js';

/** Configuration and connectivity commands for external web-search providers. */
export interface WebSearchProviderCommandContract {
  'webSearch.providers.list': {
    request: ListWebSearchProvidersPayload;
    response: ListWebSearchProvidersResponse;
  };
  'webSearch.providers.save': {
    request: SaveWebSearchProviderPayload;
    response: SaveWebSearchProviderResponse;
  };
  'webSearch.providers.reorder': {
    request: ReorderWebSearchProvidersPayload;
    response: ReorderWebSearchProvidersResponse;
  };
  'webSearch.providers.test': {
    request: TestWebSearchProviderPayload;
    response: TestWebSearchProviderResponse;
  };
}

export type WebSearchProviderCommand = keyof WebSearchProviderCommandContract;
export type WebSearchProviderCommandRequest<K extends WebSearchProviderCommand> =
  WebSearchProviderCommandContract[K]['request'];
export type WebSearchProviderCommandResponse<K extends WebSearchProviderCommand> =
  WebSearchProviderCommandContract[K]['response'];
