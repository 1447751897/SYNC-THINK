import type { ProviderAdapter, ProviderCallRequest, AdapterEvent } from './types.js';
import {
  discoverOpenAICompatibleModels,
  type DiscoverOpenAICompatibleModelsOptions,
} from './openai/discover-models.js';
import { streamOpenAIResponses } from './openai/stream-responses.js';

export interface OpenAIResponsesAdapterOptions {
  fetchImpl?: DiscoverOpenAICompatibleModelsOptions['fetchImpl'];
  timeoutMs?: number;
}

// Live OpenAI Responses adapter (TD-010).
// Real model discovery via GET /models + streaming generation via POST /responses.

export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly protocol = 'openai-responses' as const;

  constructor(private readonly opts: OpenAIResponsesAdapterOptions = {}) {}

  async discoverModels(apiKey: string, baseUrl: string): Promise<string[]> {
    return discoverOpenAICompatibleModels({
      apiKey,
      baseUrl,
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
    });
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield* streamOpenAIResponses(request, {
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
    });
  }
}
