import type { ProviderAdapter, ProviderCallRequest, AdapterEvent } from '../types.js';
import {
  discoverOpenAICompatibleModels,
  type DiscoverOpenAICompatibleModelsOptions,
} from './discover-models.js';
import { streamOpenAIChatCompletions } from './stream-chat.js';

export interface OpenAIChatAdapterOptions {
  fetchImpl?: DiscoverOpenAICompatibleModelsOptions['fetchImpl'];
  timeoutMs?: number;
}

/**
 * OpenAI-compatible Chat Completions adapter.
 * Real model discovery via GET /models + streaming call via POST /chat/completions.
 */
export class OpenAIChatAdapter implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;

  constructor(private readonly opts: OpenAIChatAdapterOptions = {}) {}

  async discoverModels(apiKey: string, baseUrl: string): Promise<string[]> {
    return discoverOpenAICompatibleModels({
      apiKey,
      baseUrl,
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
    });
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield* streamOpenAIChatCompletions(request, {
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
    });
  }
}
