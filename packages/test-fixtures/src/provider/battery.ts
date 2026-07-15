// Provider contract-test battery (TD-010). Each scenario is a recorded SSE
// fixture + an expectation over the parsed AdapterEvent stream.

export interface ProviderToolCallFixture {
  id: string;
  name: string;
  argumentsJson: string;
}

export type ProviderMessageFixture = {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCallId?: string;
};

export type AdapterEventFixture =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCall: ProviderToolCallFixture }
  | { type: 'tool-result'; toolCallId: string; result: string }
  | { type: 'image-ready'; imageRef: string; mimeType: string }
  | { type: 'usage'; tokensIn: number; tokensOut: number }
  | { type: 'finished'; reason: 'stop' | 'length' | 'tool-requests' | 'image' }
  | { type: 'error'; failureClass: string; message: string; diagnosticRefId?: string };

export interface ProviderScenario {
  id: string;
  protocol: 'openai-responses' | 'openai-chat' | 'openai-images' | 'anthropic-messages';
  /** Recorded SSE lines (raw bytes preserved as lines). */
  recordedSse: string[];
  /** Expected adapter events (subset match). */
  expected: Partial<AdapterEventFixture>[] | 'error';
  notes?: string;
}

export interface ChatRequestScenario {
  id: string;
  messages: ProviderMessageFixture[];
}

export const PROVIDER_BATTERY: ProviderScenario[] = [
  // === OpenAI Chat Completions streaming ===
  {
    id: 'openai-chat-stream-text',
    protocol: 'openai-chat',
    recordedSse: [
      `data: {"choices":[{"delta":{"content":"Hello"}}]}`,
      `data: {"choices":[{"delta":{"content":", world"}}]}`,
      `data: {"choices":[{"finish_reason":"stop","delta":{}}]}`,
      `data: [DONE]`,
    ],
    expected: [{ type: 'text-delta', text: 'Hello' }, { type: 'text-delta', text: ', world' }, { type: 'finished', reason: 'stop' }],
    notes: 'Standard streaming text from a gateway that respects OpenAI delta format.',
  },
  {
    id: 'openai-chat-rate-limit',
    protocol: 'openai-chat',
    recordedSse: [`data: {"error":{"type":"rate_limit_exceeded","message":"Too many requests"}}`],
    expected: 'error',
    notes: 'A 429-class provider error must surface as failureClass rate-limit.',
  },
  {
    id: 'openai-chat-tool-call',
    protocol: 'openai-chat',
    recordedSse: [
      `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"toa_123","function":{"name":"calc","arguments":"{\\"q\\":\\"2+2\\"}"}}]}}]}`,
      `data: {"choices":[{"finish_reason":"tool_calls","delta":{}}]}`,
      `data: [DONE]`,
    ],
    expected: [
      { type: 'tool-call', toolCall: { id: 'toa_123', name: 'calc', argumentsJson: '{"q":"2+2"}' } },
      { type: 'finished', reason: 'tool-requests' },
    ],
    notes: 'Function-tool call, fully streamed in a single delta for Phase 1 fixture.',
  },
  // === OpenAI Images ===
  {
    id: 'openai-images-create',
    protocol: 'openai-images',
    recordedSse: [`data: {"data":[{"b64_json":"iVBORw0KGgo="}]}`],
    expected: [{ type: 'image-ready', imageRef: 'b64:iVBORw0KGgo=', mimeType: 'image/png' }],
    notes: 'Image generation is non-streaming; wrapper emits image-ready.',
  },
  // === Anthropic Messages streaming ===
  {
    id: 'anthropic-messages-text',
    protocol: 'anthropic-messages',
    recordedSse: [
      `event: content_block_delta`,
      `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}`,
      `event: message_stop`,
      `data: {"type":"message_stop"}`,
    ],
    expected: [{ type: 'text-delta', text: 'Hi' }, { type: 'finished', reason: 'stop' }],
    notes: 'Anthropic SSE uses event/data lines — adapter must parse both.',
  },
  // === Gateway quirks ===
  {
    id: 'gateway-quirk-nonstandard-path',
    protocol: 'openai-chat',
    recordedSse: [`HTTP/1.1 200 ... ignored`],
    expected: 'error',
    notes: 'Gateway that serves at /v2/chat requires baseUrl-aware routing.',
  },
];

export const CHAT_REQUEST_FIXTURES: ChatRequestScenario[] = [
  { id: 'single-turn', messages: [{ role: 'user', content: 'Hello' }] },
  { id: 'multi-turn', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'What is 2+2?' }] },
  { id: 'tool-then-result', messages: [{ role: 'user', content: 'TOOL:weather Beijing' }] },
];
