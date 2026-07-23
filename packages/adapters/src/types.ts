import type { ProtocolFamily, FailureClass } from '@sync-think/shared';

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
  /** Stopping criteria for cost control & determinism. */
  maxOutputTokens?: number;
  temperature?: number;
  /**
   * Optional reasoning / extended-thinking intensity.
   * Values: auto | off | low | medium | high | xhigh | max (provider-specific).
   * Adapters omit the field when auto/off/undefined.
   */
  reasoningEffort?: string;
  stream: boolean;
}

export interface ProviderMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | ProviderContentPart[];
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

// Unified adapter event stream. Adapters translate SSE/proprietary formats
// into events emitted on the AsyncIterable<AdapterEvent>.
export type AdapterEvent =
  | { type: 'text-delta'; text: string }
  /** Extended thinking / reasoning channel — never mixed into assistant text. */
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; toolCall: ProviderToolCall }
  | { type: 'tool-result'; toolCallId: string; result: string }
  | { type: 'image-ready'; imageRef: string; mimeType: string }
  | { type: 'usage'; tokensIn: number; tokensOut: number }
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
}

// Error scrubbing rule: plaintext secret never leaves the adapter in diagnostics.
export interface ScrubFn {
  (str: string): string;
}
