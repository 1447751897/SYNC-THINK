import type { ProviderAdapter, ProviderCallRequest, AdapterEvent } from '../types.js';
import {
  discoverAnthropicModels,
  type DiscoverAnthropicModelsOptions,
} from './discover-models.js';
import { streamAnthropicMessages } from './stream-messages.js';

export interface AnthropicMessagesAdapterOptions {
  fetchImpl?: DiscoverAnthropicModelsOptions['fetchImpl'];
  timeoutMs?: number;
  anthropicVersion?: string;
}

/**
 * Anthropic Messages adapter (Phase 1 / M1).
 * Real discovery via GET /models + streaming call via POST /messages (SSE).
 */
export class AnthropicMessagesAdapter implements ProviderAdapter {
  readonly protocol = 'anthropic-messages' as const;

  constructor(private readonly opts: AnthropicMessagesAdapterOptions = {}) {}

  async discoverModels(apiKey: string, baseUrl: string): Promise<string[]> {
    return discoverAnthropicModels({
      apiKey,
      baseUrl,
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
      anthropicVersion: this.opts.anthropicVersion,
    });
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    yield* streamAnthropicMessages(request, {
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: this.opts.timeoutMs,
      anthropicVersion: this.opts.anthropicVersion,
    });
  }
}
