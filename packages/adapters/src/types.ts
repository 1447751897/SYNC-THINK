import type {
  FailureClass,
  ImageGenerationCount,
  ImageGenerationQuality,
  ImageGenerationSize,
  ProtocolFamily,
} from '@sync-think/shared';

// Re-export so adapters can narrow FailureClass values without importing shared.
export type { FailureClass };

// Adapter boundary — every Provider entry-point goes through this interface.
// Internal event shape is unified across protocols (TD-010). The Runtime never
// sees provider-specific JSON; adapters translate in/out.

export interface ProviderCallRequest {
  protocol: ProtocolFamily;
  baseUrl: string;
  modelId: string;
  /** Plaintext secret fetched from secure store; remains only in adapter scope. */
  apiKey: string;
  /** Stable scheduler key forwarded through compatible provider headers. */
  idempotencyKey: string;
  /** Cancels the underlying HTTP request and response stream. */
  signal: AbortSignal;
  systemPrompt?: string;
  /** Conversation turns (excluding the system prompt). */
  messages: ProviderMessage[];
  /** Optional tool schemas (§ capability = 'tool-calling'). */
  tools?: ProviderToolSchema[];
  /** Provider-hosted tools executed remotely without a local function result loop. */
  hostedTools?: Array<{
    type: 'web_search';
    searchContextSize?: 'low' | 'medium' | 'high';
  }>;
  /** Provider tool selection policy. `none` preserves tool schemas while forcing a text turn. */
  toolChoice?: 'auto' | 'none';
  /** Stopping criteria for cost control & determinism. */
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Optional reasoning / extended-thinking intensity.
   * Values: auto | off | low | medium | high | xhigh | max (provider-specific).
   * Adapters omit the field when auto/off/undefined.
   */
  reasoningEffort?: string;
  /** Provider-managed prompt cache identity. The application keeps the prompt prefix stable; cache bytes remain provider-side. */
  promptCache?: {
    key?: string;
    retention?: 'in_memory' | '24h';
    /** Let the adapter select automatic or explicit cache breakpoints supported by the provider. */
    strategy?: 'automatic' | 'explicit';
  };
  stream: boolean;
}

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | ProviderContentPart[];
  /** Responses-compatible assistant phase. Omitted for protocols without native phase support. */
  phase?: VisibleAssistantMessagePhase;
  /** For role = 'tool': the tool call id this is the result of. */
  toolCallId?: string;
}

export interface ProviderContentPart {
  type: 'text' | 'image' | 'tool-call' | 'tool-result';
  text?: string;
  imageUrl?: string;
  imageRef?: string;
  toolCall?: ProviderToolCall;
  toolResult?: string;
}

export interface ProviderToolSchema {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ProviderImageGenerationRequest {
  protocol: 'openai-images';
  baseUrl: string;
  modelId: string;
  /** Plaintext secret fetched from secure store; remains only in adapter scope. */
  apiKey: string;
  /** Stable scheduler key forwarded through compatible provider headers. */
  idempotencyKey: string;
  signal: AbortSignal;
  /**
   * Per-call local wall-clock limit. `null` disables the host timer entirely so
   * a long image/upscale job is bounded only by the provider and by user
   * cancellation through `signal`; `undefined` falls back to the adapter option.
   */
  timeoutMs?: number | null;
  prompt: string;
  count?: ImageGenerationCount;
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  background?: 'auto' | 'transparent' | 'opaque';
}

export interface ProviderUsage {
  /** Total input tokens reported by the provider, including cache reads/writes when applicable. */
  tokensIn: number;
  tokensOut: number;
  /** Input-prefix tokens served from the provider prompt cache. */
  cachedTokensHit?: number;
  /** Input-prefix tokens newly written to the provider prompt cache. */
  cachedTokensCreated?: number;
  /** Hidden/internal reasoning tokens when the provider reports them separately. */
  reasoningTokens?: number;
  /** Provider-reported total; normally tokensIn + tokensOut. */
  totalTokens?: number;
}

export interface ProviderGeneratedImage {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  revisedPrompt?: string;
}

export interface ProviderImageGenerationResult {
  images: ProviderGeneratedImage[];
}

export type VisibleAssistantMessagePhase = 'commentary' | 'final_answer';

// Unified adapter event stream. Adapters translate SSE/proprietary formats
// into events emitted on the AsyncIterable<AdapterEvent>.
export type AdapterEvent =
  | {
      type: 'assistant-message-start';
      phase: VisibleAssistantMessagePhase;
      itemId?: string;
    }
  | {
      type: 'assistant-message-delta';
      phase: VisibleAssistantMessagePhase;
      itemId?: string;
      text: string;
    }
  | {
      type: 'assistant-message-end';
      phase: VisibleAssistantMessagePhase;
      itemId?: string;
    }
  /** Legacy Provider text without native Codex phase metadata. */
  | { type: 'text-delta'; text: string }
  /** Extended thinking / reasoning channel — never mixed into assistant text. */
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; toolCall: ProviderToolCall }
  | { type: 'tool-result'; toolCallId: string; result: string }
  /** Provider-hosted tool lifecycle. The Runtime displays it but never executes it locally. */
  | { type: 'hosted-tool-call'; toolCall: ProviderToolCall }
  | { type: 'hosted-tool-result'; toolCallId: string; result: string }
  | { type: 'image-ready'; imageRef: string; mimeType: string }
  | ({ type: 'usage' } & ProviderUsage)
  | { type: 'finished'; reason: 'stop' | 'length' | 'tool-requests' | 'image' }
  | { type: 'error'; failureClass: FailureClass; message: string; diagnosticRefId?: string };

export interface AdapterResult {
  events: AdapterEvent[];
}

// The adapter interface every provider family must implement.
export interface ProviderAdapter {
  /** Declares which protocol family this adapter serves. */
  readonly protocol: ProtocolFamily;
  /** Returns the model IDs this provider reports as available. Best-effort. */
  discoverModels(apiKey: string, baseUrl: string): Promise<string[]>;
  /** Streams events back; for non-streaming calls the adapter synthesizes events. */
  call(request: ProviderCallRequest): AsyncIterable<AdapterEvent>;
  /** Typed image generation path for protocols that produce binary artifacts. */
  generateImages?(request: ProviderImageGenerationRequest): Promise<ProviderImageGenerationResult>;
}

// Error scrubbing rule: plaintext secret never leaves the adapter in diagnostics.
export interface ScrubFn {
  (str: string): string;
}
