/**
 * OpenAI-inbound translation: a kernel that only speaks OpenAI Chat Completions
 * (Codex) talking to an Anthropic Messages upstream.
 *
 * Mirror of anthropic-to-openai.ts:
 *   1. `openAIChatRequestToAnthropic` — request body rewrite.
 *   2. `OpenAIStreamEmitter` — consumes Anthropic SSE events and emits
 *      `chat.completion.chunk` payloads plus the terminating `[DONE]`.
 *
 * Fidelity rules:
 * - `system`/`developer` messages are hoisted into Anthropic's top-level
 *   `system` (Anthropic rejects a system role inside `messages`).
 * - Consecutive `role:'tool'` messages must collapse into ONE user turn holding
 *   several `tool_result` blocks, otherwise Anthropic rejects the sequence.
 * - `max_tokens` is mandatory on Anthropic, so a default is always supplied.
 */
import type {
  AnthropicContentBlock,
  AnthropicMessagesRequest,
  AnthropicStopReason,
  AnthropicWireMessage,
  OpenAIChatRequest,
  OpenAIFinishReason,
  OpenAIStreamChunk,
  OpenAIToolDefinition,
  OpenAIWireMessage,
  SseFrame,
} from './wire-types.js';

/** Anthropic requires max_tokens; use a generous default when none was sent. */
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 8_192;

function textOfOpenAIContent(content: OpenAIWireMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text?: string }).text ?? '')
    .join('');
}

/** Split a data URL into Anthropic's `{media_type, data}` shape. */
function parseDataUrl(url: string): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) return undefined;
  return { mediaType: match[1], data: match[2] };
}

function openAIContentToBlocks(content: OpenAIWireMessage['content']): AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  const blocks: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      blocks.push({ type: 'text', text: (part as { text: string }).text });
    } else if (part.type === 'image_url') {
      const url = (part as { image_url?: { url?: string } }).image_url?.url;
      if (!url) continue;
      const inline = parseDataUrl(url);
      blocks.push(
        inline
          ? { type: 'image', source: { type: 'base64', media_type: inline.mediaType, data: inline.data } }
          : { type: 'image', source: { type: 'url', url } },
      );
    }
  }
  return blocks;
}

function convertTools(
  tools: OpenAIToolDefinition[] | undefined,
): AnthropicMessagesRequest['tools'] {
  if (!tools || tools.length === 0) return undefined;
  return tools
    .filter((tool) => tool.type === 'function' && tool.function?.name)
    .map((tool) => ({
      name: tool.function.name,
      ...(tool.function.description ? { description: tool.function.description } : {}),
      input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
    }));
}

function convertToolChoice(
  choice: OpenAIChatRequest['tool_choice'],
): AnthropicMessagesRequest['tool_choice'] {
  if (choice === undefined) return undefined;
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  if (typeof choice === 'object' && choice.function?.name) {
    return { type: 'tool', name: choice.function.name };
  }
  return undefined;
}

export interface OpenAIToAnthropicOptions {
  /** Provider-facing model string (already resolved by the gateway router). */
  targetModel: string;
}

/** Translate an OpenAI Chat request body into an Anthropic Messages body. */
export function openAIChatRequestToAnthropic(
  request: OpenAIChatRequest,
  options: OpenAIToAnthropicOptions,
): AnthropicMessagesRequest {
  const systemParts: string[] = [];
  const messages: AnthropicWireMessage[] = [];

  const pushBlocks = (role: 'user' | 'assistant', blocks: AnthropicContentBlock[]): void => {
    if (blocks.length === 0) return;
    const last = messages[messages.length - 1];
    // Merge into the previous turn when the role repeats — Anthropic requires
    // strictly alternating roles, and tool results arrive as separate messages.
    if (last && last.role === role && Array.isArray(last.content)) {
      last.content.push(...blocks);
      return;
    }
    messages.push({ role, content: blocks });
  };

  for (const message of request.messages ?? []) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOfOpenAIContent(message.content);
      if (text !== '') systemParts.push(text);
      continue;
    }
    if (message.role === 'tool') {
      pushBlocks('user', [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id ?? '',
          content: textOfOpenAIContent(message.content),
        },
      ]);
      continue;
    }
    if (message.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      const text = textOfOpenAIContent(message.content);
      if (text !== '') blocks.push({ type: 'text', text });
      for (const call of message.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          // Malformed history args: keep the raw string so the model still sees it.
          input = { __raw: call.function?.arguments ?? '' };
        }
        blocks.push({
          type: 'tool_use',
          id: call.id ?? '',
          name: call.function?.name ?? '',
          input,
        });
      }
      pushBlocks('assistant', blocks);
      continue;
    }
    pushBlocks('user', openAIContentToBlocks(message.content));
  }

  const body: AnthropicMessagesRequest = {
    model: options.targetModel,
    max_tokens:
      request.max_completion_tokens ?? request.max_tokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
    messages,
    stream: request.stream !== false,
  };
  if (systemParts.length > 0) body.system = systemParts.join('\n\n');
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  if (typeof request.top_p === 'number') body.top_p = request.top_p;
  if (request.stop !== undefined) {
    body.stop_sequences = Array.isArray(request.stop) ? request.stop : [request.stop];
  }
  const tools = convertTools(request.tools);
  if (tools && tools.length > 0) body.tools = tools;
  const toolChoice = convertToolChoice(request.tool_choice);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;
  if (request.reasoning_effort) {
    const budget = reasoningEffortToThinkingBudget(request.reasoning_effort);
    if (budget !== undefined) {
      body.thinking = { type: 'enabled', budget_tokens: budget };
      // Anthropic requires max_tokens > budget_tokens.
      if ((body.max_tokens ?? 0) <= budget) body.max_tokens = budget + 4_096;
    }
  }
  return body;
}

/** OpenAI `reasoning_effort` → Anthropic extended-thinking budget. */
export function reasoningEffortToThinkingBudget(effort: string): number | undefined {
  switch (effort.toLowerCase()) {
    case 'minimal':
    case 'low':
      return 4_096;
    case 'medium':
      return 12_288;
    case 'high':
    case 'max':
      return 24_576;
    default:
      return undefined;
  }
}

/** Anthropic stop_reason → OpenAI finish_reason. */
export function stopReasonToFinishReason(
  reason: AnthropicStopReason | string | null | undefined,
): OpenAIFinishReason {
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'max_tokens') return 'length';
  if (reason === 'refusal') return 'content_filter';
  return 'stop';
}

interface AnthropicSseEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  message?: { id?: string; model?: string; usage?: Record<string, unknown> };
  usage?: Record<string, unknown>;
  error?: { type?: string; message?: string };
}

/**
 * Turns an Anthropic SSE event stream into OpenAI `chat.completion.chunk`
 * frames. Anthropic block indices are remapped onto OpenAI's flat
 * `tool_calls[].index` numbering (0,1,2… per tool call, not per block).
 */
export class OpenAIStreamEmitter {
  private roleSent = false;
  private nextToolIndex = 0;
  private readonly toolIndexByBlock = new Map<number, number>();
  private stopReason: string | undefined;
  private usage:
    | { input: number; prompt: number; completion: number; cached: number }
    | undefined;
  private closed = false;
  private readonly created = Math.floor(Date.now() / 1000);

  constructor(
    private readonly completionId: string,
    private readonly model: string,
  ) {}

  /** Frames for one Anthropic SSE event (empty when nothing maps across). */
  push(event: AnthropicSseEvent): SseFrame[] {
    const frames: SseFrame[] = [];
    if (this.closed) return frames;
    switch (event.type) {
      case 'message_start': {
        this.captureUsage(event.message?.usage);
        if (!this.roleSent) {
          this.roleSent = true;
          frames.push(this.chunk({ role: 'assistant', content: '' }));
        }
        return frames;
      }
      case 'content_block_start': {
        const block = event.content_block;
        if (block?.type === 'tool_use') {
          const toolIndex = this.nextToolIndex++;
          this.toolIndexByBlock.set(event.index ?? 0, toolIndex);
          frames.push(
            this.chunk({
              tool_calls: [
                {
                  index: toolIndex,
                  id: block.id ?? `call_${this.completionId}_${toolIndex}`,
                  type: 'function',
                  function: { name: block.name ?? '', arguments: '' },
                },
              ],
            }),
          );
        }
        return frames;
      }
      case 'content_block_delta': {
        const delta = event.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          frames.push(this.chunk({ content: delta.text }));
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          frames.push(this.chunk({ reasoning_content: delta.thinking }));
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const toolIndex = this.toolIndexByBlock.get(event.index ?? 0) ?? 0;
          frames.push(
            this.chunk({
              tool_calls: [
                { index: toolIndex, function: { arguments: delta.partial_json } },
              ],
            }),
          );
        }
        return frames;
      }
      case 'message_delta': {
        if (event.delta?.stop_reason) this.stopReason = event.delta.stop_reason;
        this.captureUsage(event.usage);
        return frames;
      }
      case 'error': {
        return this.error(event.error?.message ?? 'upstream error');
      }
      default:
        // ping / content_block_stop / message_stop need no OpenAI counterpart;
        // termination is emitted by finish().
        return frames;
    }
  }

  /** Emit the terminating finish_reason chunk, usage chunk and `[DONE]`. */
  finish(): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    const frames: SseFrame[] = [];
    if (!this.roleSent) {
      this.roleSent = true;
      frames.push(this.chunk({ role: 'assistant', content: '' }));
    }
    frames.push(
      this.rawChunk({
        choices: [
          { index: 0, delta: {}, finish_reason: stopReasonToFinishReason(this.stopReason) },
        ],
      }),
    );
    if (this.usage) {
      frames.push(
        this.rawChunk({
          choices: [],
          usage: {
            prompt_tokens: this.usage.prompt,
            completion_tokens: this.usage.completion,
            total_tokens: this.usage.prompt + this.usage.completion,
            ...(this.usage.cached
              ? { prompt_tokens_details: { cached_tokens: this.usage.cached } }
              : {}),
          },
        }),
      );
    }
    frames.push({ data: '[DONE]' });
    return frames;
  }

  /** Upstream failure: OpenAI clients read an `error` payload then `[DONE]`. */
  error(message: string): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    return [
      { data: JSON.stringify({ error: { message, type: 'upstream_error' } }) },
      { data: '[DONE]' },
    ];
  }

  private captureUsage(usage: Record<string, unknown> | undefined): void {
    if (!usage) return;
    const input = numberOr(usage.input_tokens, this.usage?.input ?? 0);
    const cached = numberOr(usage.cache_read_input_tokens, this.usage?.cached ?? 0);
    const prompt = input + cached;
    const completion = numberOr(usage.output_tokens, this.usage?.completion ?? 0);
    this.usage = { input, prompt, completion, cached };
  }

  private chunk(delta: NonNullable<NonNullable<OpenAIStreamChunk['choices']>[number]['delta']>): SseFrame {
    return this.rawChunk({ choices: [{ index: 0, delta, finish_reason: null }] });
  }

  private rawChunk(partial: Partial<OpenAIStreamChunk>): SseFrame {
    const payload: OpenAIStreamChunk = {
      id: this.completionId,
      object: 'chat.completion.chunk',
      created: this.created,
      model: this.model,
      ...partial,
    };
    return { data: JSON.stringify(payload) };
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
