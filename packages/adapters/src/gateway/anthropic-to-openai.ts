/**
 * Anthropic-inbound translation: a kernel that only speaks Anthropic Messages
 * (Claude Code) talking to an OpenAI-compatible upstream.
 *
 * Two halves, both pure:
 *   1. `anthropicRequestToOpenAIChat` — request body rewrite.
 *   2. `AnthropicStreamEmitter` — consumes OpenAI `chat.completion.chunk`
 *      objects and emits the Anthropic SSE frames the kernel expects.
 *
 * Fidelity rules that matter for a working tool loop:
 * - `tool_use` blocks become assistant `tool_calls`; `tool_result` blocks become
 *   separate `role:'tool'` messages (OpenAI has no user-side result blocks).
 * - Anthropic block indices must stay monotonic across text/thinking/tool_use,
 *   because Claude Code keys partial JSON accumulation on `index`.
 * - `input_json_delta` carries the raw argument fragments verbatim: re-encoding
 *   partial JSON would corrupt it.
 */
import type {
  AnthropicContentBlock,
  AnthropicMessagesRequest,
  AnthropicStopReason,
  AnthropicWireMessage,
  OpenAIChatRequest,
  OpenAIContentPart,
  OpenAIFinishReason,
  OpenAIStreamChunk,
  OpenAIToolDefinition,
  OpenAIWireMessage,
  SseFrame,
} from './wire-types.js';

/** Models that reject `max_tokens` and `temperature` (o-series / gpt-5+). */
function isReasoningOnlyModel(modelId: string): boolean {
  const tail = (modelId.split('/').pop() ?? modelId).toLowerCase();
  return /^o[1-9](\b|[-.])/.test(tail) || /^gpt-5/.test(tail);
}

function blocksOf(content: string | AnthropicContentBlock[]): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  return content;
}

/** Flatten an Anthropic system field (string or block list) into one string. */
export function flattenAnthropicSystem(
  system: AnthropicMessagesRequest['system'],
): string | undefined {
  if (system === undefined) return undefined;
  if (typeof system === 'string') return system === '' ? undefined : system;
  const text = system
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n');
  return text === '' ? undefined : text;
}

/** Anthropic image block → OpenAI `image_url` part (base64 becomes a data URL). */
function imageBlockToPart(block: AnthropicContentBlock): OpenAIContentPart | undefined {
  const source = (block as { source?: { type?: string; media_type?: string; data?: string; url?: string } })
    .source;
  if (!source) return undefined;
  if (source.type === 'url' && source.url) {
    return { type: 'image_url', image_url: { url: source.url } };
  }
  if (source.data) {
    const mediaType = source.media_type ?? 'image/png';
    return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${source.data}` } };
  }
  return undefined;
}

/** Anthropic tool_result content → the plain string OpenAI tool messages need. */
function toolResultText(content: string | AnthropicContentBlock[] | undefined): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text);
    } else if (block.type === 'image') {
      // OpenAI tool messages are text-only; keep a marker instead of dropping silently.
      parts.push('[image omitted: tool results cannot carry images on OpenAI Chat]');
    }
  }
  return parts.join('\n');
}

function convertMessage(message: AnthropicWireMessage): OpenAIWireMessage[] {
  const blocks = blocksOf(message.content);
  if (message.role === 'assistant') {
    const textParts: string[] = [];
    const toolCalls: NonNullable<OpenAIWireMessage['tool_calls']> = [];
    for (const block of blocks) {
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        textParts.push((block as { text: string }).text);
      } else if (block.type === 'tool_use') {
        const call = block as { id: string; name: string; input?: unknown };
        toolCalls.push({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
        });
      }
      // thinking / redacted_thinking are provider-private; never replayed upstream.
    }
    const out: OpenAIWireMessage = { role: 'assistant' };
    if (textParts.length > 0) out.content = textParts.join('');
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    if (out.content === undefined && toolCalls.length === 0) out.content = '';
    return [out];
  }

  // User turn: tool_result blocks must be lifted into their own tool messages,
  // and OpenAI requires them to precede the remaining user content.
  const toolMessages: OpenAIWireMessage[] = [];
  const userParts: OpenAIContentPart[] = [];
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      const result = block as {
        tool_use_id: string;
        content?: string | AnthropicContentBlock[];
        is_error?: boolean;
      };
      const text = toolResultText(result.content);
      toolMessages.push({
        role: 'tool',
        tool_call_id: result.tool_use_id,
        content: result.is_error === true ? `Error: ${text}` : text,
      });
    } else if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      userParts.push({ type: 'text', text: (block as { text: string }).text });
    } else if (block.type === 'image') {
      const part = imageBlockToPart(block);
      if (part) userParts.push(part);
    }
  }
  if (userParts.length === 0) return toolMessages;
  const onlyText = userParts.every((part) => part.type === 'text');
  const userMessage: OpenAIWireMessage = {
    role: 'user',
    content: onlyText
      ? userParts.map((part) => (part as { text: string }).text).join('')
      : userParts,
  };
  return [...toolMessages, userMessage];
}

function convertTools(
  tools: AnthropicMessagesRequest['tools'],
): OpenAIToolDefinition[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    },
  }));
}

function convertToolChoice(
  choice: AnthropicMessagesRequest['tool_choice'],
): OpenAIChatRequest['tool_choice'] {
  if (!choice) return undefined;
  if (choice.type === 'auto') return 'auto';
  if (choice.type === 'none') return 'none';
  if (choice.type === 'any') return 'required';
  if (choice.type === 'tool' && choice.name) {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

/** Anthropic `thinking.budget_tokens` → the closest OpenAI reasoning effort. */
export function thinkingBudgetToReasoningEffort(budget: number | undefined): string | undefined {
  if (budget === undefined || !Number.isFinite(budget) || budget <= 0) return undefined;
  if (budget <= 4_096) return 'low';
  if (budget <= 16_384) return 'medium';
  return 'high';
}

export interface AnthropicToOpenAIOptions {
  /** Provider-facing model string (already resolved by the gateway router). */
  targetModel: string;
}

/** Translate an Anthropic Messages request body into an OpenAI Chat body. */
export function anthropicRequestToOpenAIChat(
  request: AnthropicMessagesRequest,
  options: AnthropicToOpenAIOptions,
): OpenAIChatRequest {
  const messages: OpenAIWireMessage[] = [];
  const system = flattenAnthropicSystem(request.system);
  if (system) messages.push({ role: 'system', content: system });
  for (const message of request.messages) messages.push(...convertMessage(message));

  const reasoningOnly = isReasoningOnlyModel(options.targetModel);
  const body: OpenAIChatRequest = {
    model: options.targetModel,
    messages,
    stream: request.stream !== false,
  };
  if (body.stream) body.stream_options = { include_usage: true };
  if (typeof request.max_tokens === 'number' && request.max_tokens > 0) {
    if (reasoningOnly) body.max_completion_tokens = request.max_tokens;
    else body.max_tokens = request.max_tokens;
  }
  // Reasoning-only models reject temperature/top_p overrides outright.
  if (!reasoningOnly) {
    if (typeof request.temperature === 'number') body.temperature = request.temperature;
    if (typeof request.top_p === 'number') body.top_p = request.top_p;
  }
  if (request.stop_sequences && request.stop_sequences.length > 0) {
    body.stop = request.stop_sequences;
  }
  const tools = convertTools(request.tools);
  if (tools) body.tools = tools;
  const toolChoice = convertToolChoice(request.tool_choice);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;
  const effort = thinkingBudgetToReasoningEffort(request.thinking?.budget_tokens);
  if (effort && reasoningOnly) body.reasoning_effort = effort;
  return body;
}

/** OpenAI finish_reason → Anthropic stop_reason. */
export function finishReasonToStopReason(
  reason: OpenAIFinishReason | null | undefined,
  sawToolCall: boolean,
): AnthropicStopReason {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  if (reason === 'stop') return sawToolCall ? 'tool_use' : 'end_turn';
  return sawToolCall ? 'tool_use' : 'end_turn';
}

type OpenBlock =
  | { kind: 'text'; index: number }
  | { kind: 'thinking'; index: number }
  | { kind: 'tool'; index: number; callIndex: number };

/**
 * Turns an OpenAI chunk stream into Anthropic SSE frames.
 *
 * Stateful by necessity: Anthropic requires an explicit
 * `message_start → content_block_start/delta/stop → message_delta →
 * message_stop` envelope, and block indices have to be allocated as content
 * kinds appear. Feed chunks in order, then call `finish()` exactly once.
 */
export class AnthropicStreamEmitter {
  private started = false;
  private nextIndex = 0;
  private current: OpenBlock | undefined;
  private readonly toolBlocks = new Map<number, OpenBlock & { kind: 'tool' }>();
  private sawToolCall = false;
  private finishReason: OpenAIFinishReason | null | undefined;
  private usage: { input: number; output: number; cacheRead: number } | undefined;
  private closed = false;

  constructor(
    private readonly messageId: string,
    private readonly model: string,
  ) {}

  /** Frames for one upstream chunk (empty array when nothing to emit). */
  push(chunk: OpenAIStreamChunk): SseFrame[] {
    const frames: SseFrame[] = [];
    if (!this.started) {
      this.started = true;
      frames.push(this.messageStartFrame());
    }
    if (chunk.usage) {
      this.usage = {
        input: numberOr(chunk.usage.prompt_tokens, 0),
        output: numberOr(chunk.usage.completion_tokens, 0),
        cacheRead: numberOr(chunk.usage.prompt_tokens_details?.cached_tokens, 0),
      };
    }
    const choice = chunk.choices?.[0];
    if (!choice) return frames;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return frames;

    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
    if (reasoning !== '') {
      frames.push(...this.openBlock({ kind: 'thinking', index: -1 }));
      frames.push({
        event: 'content_block_delta',
        data: JSON.stringify({
          type: 'content_block_delta',
          index: this.current?.index ?? 0,
          delta: { type: 'thinking_delta', thinking: reasoning },
        }),
      });
    }

    const text = typeof delta.content === 'string' ? delta.content : '';
    if (text !== '') {
      frames.push(...this.openBlock({ kind: 'text', index: -1 }));
      frames.push({
        event: 'content_block_delta',
        data: JSON.stringify({
          type: 'content_block_delta',
          index: this.current?.index ?? 0,
          delta: { type: 'text_delta', text },
        }),
      });
    }

    for (const call of delta.tool_calls ?? []) {
      const callIndex = typeof call.index === 'number' ? call.index : 0;
      let block = this.toolBlocks.get(callIndex);
      if (!block) {
        this.sawToolCall = true;
        frames.push(...this.closeCurrent());
        const index = this.nextIndex++;
        block = { kind: 'tool', index, callIndex };
        this.toolBlocks.set(callIndex, block);
        this.current = block;
        frames.push({
          event: 'content_block_start',
          data: JSON.stringify({
            type: 'content_block_start',
            index,
            content_block: {
              type: 'tool_use',
              id: call.id ?? `toolu_${this.messageId}_${callIndex}`,
              name: call.function?.name ?? '',
              input: {},
            },
          }),
        });
      }
      const args = call.function?.arguments;
      if (typeof args === 'string' && args !== '') {
        frames.push({
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            index: block.index,
            // Verbatim fragment — re-encoding partial JSON would corrupt it.
            delta: { type: 'input_json_delta', partial_json: args },
          }),
        });
      }
    }
    return frames;
  }

  /** Close any open block and emit `message_delta` + `message_stop`. */
  finish(): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    const frames: SseFrame[] = [];
    if (!this.started) {
      this.started = true;
      frames.push(this.messageStartFrame());
    }
    frames.push(...this.closeCurrent());
    frames.push({
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: {
          stop_reason: finishReasonToStopReason(this.finishReason, this.sawToolCall),
          stop_sequence: null,
        },
        usage: {
          input_tokens: this.usage?.input ?? 0,
          output_tokens: this.usage?.output ?? 0,
          ...(this.usage?.cacheRead ? { cache_read_input_tokens: this.usage.cacheRead } : {}),
        },
      }),
    });
    frames.push({ event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) });
    return frames;
  }

  /** Upstream error mid-stream: Anthropic clients expect an `error` event. */
  error(message: string, errorType = 'api_error'): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    return [
      {
        event: 'error',
        data: JSON.stringify({ type: 'error', error: { type: errorType, message } }),
      },
    ];
  }

  private messageStartFrame(): SseFrame {
    return {
      event: 'message_start',
      data: JSON.stringify({
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
    };
  }

  private openBlock(target: OpenBlock): SseFrame[] {
    if (this.current?.kind === target.kind) return [];
    const frames = this.closeCurrent();
    const index = this.nextIndex++;
    this.current = { ...target, index } as OpenBlock;
    frames.push({
      event: 'content_block_start',
      data: JSON.stringify({
        type: 'content_block_start',
        index,
        content_block:
          target.kind === 'thinking'
            ? { type: 'thinking', thinking: '' }
            : { type: 'text', text: '' },
      }),
    });
    return frames;
  }

  private closeCurrent(): SseFrame[] {
    if (!this.current) return [];
    const index = this.current.index;
    this.current = undefined;
    return [
      {
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index }),
      },
    ];
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
