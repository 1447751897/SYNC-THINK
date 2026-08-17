/**
 * Wire-level shapes for the open gateway's protocol translation.
 *
 * These describe the *provider wire format* as it appears on the HTTP boundary,
 * not our internal ProviderCallRequest. The gateway sits between a kernel that
 * speaks one dialect (e.g. Claude Code → Anthropic Messages) and an upstream
 * that speaks the other (e.g. an OpenAI-compatible relay), so translation has
 * to be faithful to the raw JSON on both sides.
 *
 * Deliberately permissive: unknown fields are preserved where a passthrough is
 * safe and dropped where a mistranslation would be worse than an omission.
 */

// ---------------------------------------------------------------------------
// Anthropic Messages
// ---------------------------------------------------------------------------

export interface AnthropicImageSource {
  type: 'base64' | 'url';
  media_type?: string;
  data?: string;
  url?: string;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string; cache_control?: unknown }
  | { type: 'thinking'; thinking?: string; signature?: string }
  | { type: 'redacted_thinking'; data?: string }
  | { type: 'image'; source: AnthropicImageSource }
  | { type: 'tool_use'; id: string; name: string; input?: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content?: string | AnthropicContentBlock[];
      is_error?: boolean;
    }
  | { type: string; [key: string]: unknown };

export interface AnthropicWireMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens?: number;
  system?: string | AnthropicContentBlock[];
  messages: AnthropicWireMessage[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: 'auto' | 'any' | 'tool' | 'none'; name?: string };
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  thinking?: { type?: string; budget_tokens?: number };
  metadata?: Record<string, unknown>;
}

/** Anthropic stop reasons the gateway maps in both directions. */
export type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'refusal';

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

export interface OpenAIToolCall {
  id?: string;
  index?: number;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } }
  | { type: string; [key: string]: unknown };

export interface OpenAIWireMessage {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
  /** Non-standard but widely used by reasoning relays (DeepSeek/Qwen style). */
  reasoning_content?: string;
}

export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIWireMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  tools?: OpenAIToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  reasoning_effort?: string;
}

/** OpenAI finish reasons the gateway maps in both directions. */
export type OpenAIFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter';

export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  /** DeepSeek-compatible non-standard cache reporting (openai-compatible relays). */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

export interface OpenAIStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: OpenAIFinishReason | null;
  }>;
  usage?: OpenAIUsage | null;
}

// ---------------------------------------------------------------------------
// OpenAI Responses API (the gateway's second upstream dialect)
// ---------------------------------------------------------------------------

export type OpenAIResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string; annotations?: unknown[] }
  | { type: 'input_image'; image_url: string | { url: string; detail?: string }; detail?: string }
  | { type: 'function_call'; call_id?: string; name?: string; arguments?: string }
  | { type: string; [key: string]: unknown };

export type OpenAIResponsesInputItem =
  | { role: 'user' | 'assistant' | 'system' | 'developer'; content: string | OpenAIResponsesContentPart[] }
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
      /**
       * HTTP Responses requires tool results to reference the item id of the
       * `function_call` they answer (`previous_response_id` continuation is
       * WebSocket-only). Omitted during a full in-context replay.
       */
      item_reference?: string;
    }
  | { type: 'function_call'; call_id: string; name: string; arguments: string; namespace?: string }
  | {
      type: 'custom_tool_call';
      call_id: string;
      name: string;
      input: string;
      namespace?: string;
    };

export interface OpenAIResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

/**
 * A namespace tool declaration (Codex 0.147+). The sub-tools live under a
 * `namespace` name (e.g. `mcp__sync_think_platform`); the model sees the
 * namespace wrapper and calls a sub-tool by its bare name. Chat upstreams have
 * no namespace concept, so the gateway flattens these into `function` tools
 * whose name is `{namespace}__{subToolName}` (the `/` separator is rejected by
 * DeepSeek's `^[a-zA-Z0-9_-]+$` function-name pattern) and maps calls back to a
 * `custom_tool_call` (name + namespace) on the way out.
 */
export interface OpenAIResponsesNamespaceTool {
  type: 'namespace';
  name: string;
  description?: string;
  tools?: OpenAIResponsesTool[];
}

export type OpenAIResponsesToolEntry = OpenAIResponsesTool | OpenAIResponsesNamespaceTool;

export type OpenAIResponsesToolChoice =
  | { type: 'auto' | 'none' | 'required' }
  | { type: 'function'; name: string };

export interface OpenAIResponsesRequest {
  model: string;
  instructions?: string;
  input: OpenAIResponsesInputItem[];
  previous_response_id?: string;
  tools?: OpenAIResponsesToolEntry[];
  tool_choice?: OpenAIResponsesToolChoice;
  max_output_tokens?: number;
  temperature?: number;
  reasoning?: { effort?: 'low' | 'medium' | 'high' };
  stream?: boolean;
}

/** A function call item as it appears in responses output (stream or final). */
export interface OpenAIResponsesFunctionCallItem {
  type: 'function_call';
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
}

/**
 * A namespaced tool call (Codex 0.147+). Model calls a sub-tool inside a
 * namespace: `name` is the bare sub-tool name, `namespace` is the enclosing
 * namespace (e.g. `mcp__sync_think_platform`), `input` is the JSON arguments.
 */
export interface OpenAIResponsesCustomToolCallItem {
  type: 'custom_tool_call';
  id?: string;
  call_id?: string;
  name?: string;
  namespace?: string;
  input?: string;
}

export interface OpenAIResponsesOutputTextPart {
  type: 'output_text';
  text: string;
  annotations?: unknown[];
}

export interface OpenAIResponsesMessageItem {
  type: 'message';
  id?: string;
  role?: 'assistant';
  content?: OpenAIResponsesOutputTextPart[];
}

/** Responses reasoning item carrying the provider's thinking summary. */
export interface OpenAIResponsesReasoningItem {
  type: 'reasoning';
  id?: string;
  summary?: Array<{ type: 'summary_text'; text?: string }>;
}

export type OpenAIResponsesOutputItem =
  | OpenAIResponsesMessageItem
  | OpenAIResponsesFunctionCallItem
  | OpenAIResponsesCustomToolCallItem
  | OpenAIResponsesReasoningItem;

export interface OpenAIResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
}

/** The response envelope a completed (non-streaming) call returns. */
export interface OpenAIResponsesBody {
  id?: string;
  object?: string;
  model?: string;
  status?: string;
  output?: OpenAIResponsesOutputItem[];
  usage?: OpenAIResponsesUsage;
  error?: { code?: string; message?: string };
}

/** The SSE event payloads the responses API emits while streaming. */
export type OpenAIResponseSseEvent =
  | { type: 'response.created'; response?: OpenAIResponsesBody }
  | { type: 'response.in_progress'; response?: OpenAIResponsesBody }
  | { type: 'response.output_item.added'; output_index?: number; item?: OpenAIResponsesOutputItem }
  | { type: 'response.content_part.added'; item_id?: string; output_index?: number; part?: OpenAIResponsesOutputTextPart }
  | { type: 'response.output_text.delta'; delta?: string; item_id?: string; output_index?: number }
  | { type: 'response.output_text.done'; text?: string; item_id?: string; output_index?: number }
  | { type: 'response.reasoning_summary_part.added'; item_id?: string; output_index?: number; summary_index?: number; part?: { type?: string; text?: string } }
  | { type: 'response.reasoning_summary_part.done'; item_id?: string; output_index?: number; summary_index?: number; part?: { type?: string; text?: string } }
  | { type: 'response.function_call_arguments.delta'; delta?: string; item_id?: string; output_index?: number }
  | {
      type: 'response.custom_tool_call_input.delta';
      delta?: string;
      item_id?: string;
      call_id?: string;
      output_index?: number;
    }
  | {
      type: 'response.function_call_arguments.done';
      arguments?: string;
      call_id?: string;
      id?: string;
      item_id?: string;
      name?: string;
      output_index?: number;
    }
  | { type: 'response.output_item.done'; output_index?: number; item?: OpenAIResponsesOutputItem }
  | { type: 'response.completed'; response?: OpenAIResponsesBody }
  | { type: 'response.failed'; response?: OpenAIResponsesBody & { error?: { message?: string } } }
  | { type: 'response.error'; message?: string; code?: string };

/** One `event:`/`data:` pair the gateway writes to its own SSE response. */
export interface SseFrame {
  event?: string;
  data: string;
}

/** Serialize an SSE frame (Anthropic sends `event:` lines, OpenAI does not). */
export function encodeSseFrame(frame: SseFrame): string {
  const head = frame.event ? `event: ${frame.event}\n` : '';
  return `${head}data: ${frame.data}\n\n`;
}
