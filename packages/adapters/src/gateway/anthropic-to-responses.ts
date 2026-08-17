/**
 * Anthropic-inbound translation for the OpenAI Responses API dialect: a kernel
 * that only speaks Anthropic Messages (Claude Code) talking to a Responses-only
 * upstream (e.g. a relay that serves `/v1/responses` without chat/completions).
 *
 * Two halves, both pure:
 *   1. `anthropicRequestToOpenAIResponses` — request body rewrite.
 *   2. `OpenAIResponsesStreamEmitter` — consumes `response.*` SSE events and
 *      emits the Anthropic SSE frames the kernel expects.
 *
 * Fidelity rules (mirroring the chat-completions translator):
 * - `tool_use` blocks become `function_call` items; `tool_result` blocks become
 *   `function_call_output` items (Responses has no user-side result blocks).
 * - `input_json_delta` carries function-call argument fragments verbatim:
 *   re-encoding partial JSON would corrupt it.
 * - Anthropic block indices are allocated as output kinds appear, keeping them
 *   monotonic even when the upstream interleaves reasoning / text / calls.
 */
import type {
  AnthropicContentBlock,
  AnthropicMessagesRequest,
  AnthropicStopReason,
  AnthropicWireMessage,
  OpenAIResponsesBody,
  OpenAIResponsesContentPart,
  OpenAIResponsesFunctionCallItem,
  OpenAIResponsesInputItem,
  OpenAIResponsesOutputItem,
  OpenAIResponsesRequest,
  OpenAIResponsesTool,
  OpenAIResponsesToolChoice,
  OpenAIResponseSseEvent,
  OpenAIResponsesUsage,
  SseFrame,
} from './wire-types.js';
import { flattenAnthropicSystem, thinkingBudgetToReasoningEffort } from './anthropic-to-openai.js';

// ---------------------------------------------------------------------------
// Request body translation
// ---------------------------------------------------------------------------

/** Anthropic tool_result content → the plain string Responses outputs expect. */
function toolResultText(content: string | AnthropicContentBlock[] | undefined): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text);
    } else if (block.type === 'image') {
      parts.push('[image omitted: tool results cannot carry images on Responses]');
    }
  }
  return parts.join('\n');
}

/** Anthropic image block → Responses `input_image` part (base64 → data URL). */
function imageBlockToPart(block: AnthropicContentBlock): OpenAIResponsesContentPart | undefined {
  const source = (block as { source?: { type?: string; media_type?: string; data?: string; url?: string } })
    .source;
  if (!source) return undefined;
  if (source.type === 'url' && source.url) {
    return { type: 'input_image', image_url: source.url };
  }
  if (source.data) {
    const mediaType = source.media_type ?? 'image/png';
    return { type: 'input_image', image_url: `data:${mediaType};base64,${source.data}` };
  }
  return undefined;
}

function convertUserItem(message: AnthropicWireMessage): OpenAIResponsesInputItem[] {
  const blocks =
    typeof message.content === 'string'
      ? message.content === ''
        ? []
        : [{ type: 'text', text: message.content } as AnthropicContentBlock]
      : message.content;
  const items: OpenAIResponsesInputItem[] = [];
  const parts: OpenAIResponsesContentPart[] = [];
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      const result = block as { tool_use_id: string; content?: string | AnthropicContentBlock[]; is_error?: boolean };
      const text = toolResultText(result.content);
      items.push({
        type: 'function_call_output',
        call_id: result.tool_use_id,
        output: result.is_error === true ? `Error: ${text}` : text,
      });
    } else if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push({ type: 'input_text', text: (block as { text: string }).text });
    } else if (block.type === 'image') {
      const part = imageBlockToPart(block);
      if (part) parts.push(part);
    }
  }
  if (parts.length > 0) {
    const onlyText = parts.every((part) => part.type === 'input_text');
    items.push({
      role: 'user',
      content: onlyText
        ? parts.map((part) => (part as { type: 'input_text'; text: string }).text).join('')
        : parts,
    });
  }
  return items;
}

function convertAssistantItem(
  message: AnthropicWireMessage,
  itemIdByCallId?: ReadonlyMap<string, string>,
): OpenAIResponsesInputItem[] {
  const blocks =
    typeof message.content === 'string'
      ? message.content === ''
        ? []
        : [{ type: 'text', text: message.content } as AnthropicContentBlock]
      : message.content;
  const items: OpenAIResponsesInputItem[] = [];
  const parts: OpenAIResponsesContentPart[] = [];
  const flushText = (): void => {
    if (parts.length === 0) return;
    items.push({ role: 'assistant', content: parts.splice(0) });
  };
  for (const block of blocks) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push({ type: 'output_text', text: (block as { text: string }).text });
    } else if (block.type === 'tool_use') {
      const call = block as { id: string; name: string; input?: unknown };
      flushText();
      const itemId = itemIdByCallId?.get(call.id);
      items.push({
        type: 'function_call',
        ...(itemId ? { id: itemId } : {}),
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.input ?? {}),
      });
    }
    // thinking / redacted_thinking are provider-private; never replayed upstream.
  }
  flushText();
  return items;
}

function convertTools(
  tools: AnthropicMessagesRequest['tools'],
): OpenAIResponsesTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.input_schema ?? { type: 'object', properties: {} },
  }));
}

function convertToolChoice(
  choice: AnthropicMessagesRequest['tool_choice'],
): OpenAIResponsesToolChoice | undefined {
  if (!choice) return undefined;
  if (choice.type === 'auto') return { type: 'auto' };
  if (choice.type === 'none') return { type: 'none' };
  if (choice.type === 'any') return { type: 'required' };
  if (choice.type === 'tool' && choice.name) return { type: 'function', name: choice.name };
  return undefined;
}

export interface AnthropicToResponsesOptions {
  /** Provider-facing model string (already resolved by the gateway router). */
  targetModel: string;
  /**
   * Resolve the Responses *item* id that produced an earlier function call.
   * The gateway remembers each provider function-call item id; when resolvable
   * it is reused as the replayed call's `id` so relays that track items by id
   * keep stable identifiers across requests. Tool results are paired to their
   * calls by `call_id` inside the same request input (`item_reference` is NOT
   * emitted: some HTTP relays reject that field outright).
   */
  resolveFunctionItemId?(callId: string): string | undefined;
}

/**
 * Build the Responses `input` for one inbound Anthropic request.
 *
 * The full message history is always replayed as paired items: every
 * `function_call` (with `call_id`) is followed by its `function_call_output`
 * carrying the same `call_id`. This is the only tool-loop shape every stateless
 * HTTP Responses relay accepts: an output whose call has no matching replayed
 * `function_call` is rejected ("No tool call found for tool output with
 * call_id"), while the `item_reference` field itself is rejected by other
 * relays ("Unknown parameter: 'input[4].item_reference'"). The replayed
 * `function_call` may carry a stable `id` when the provider item id is known
 * (via `resolveFunctionItemId`); otherwise a deterministic synthetic id keeps
 * the id self-consistent, though nothing references it.
 */
function buildResponsesInput(
  request: AnthropicMessagesRequest,
  resolveFunctionItemId: ((callId: string) => string | undefined) | undefined,
): OpenAIResponsesInputItem[] {
  // Assign every historical tool_use a stable item id BEFORE converting, so the
  // replayed function_call carries a consistent id (used by relays that track
  // items by id; the pairing itself is done by call_id).
  const itemIdByCallId = new Map<string, string>();
  for (const message of request.messages) {
    if (message.role !== 'assistant') continue;
    const blocks =
      typeof message.content === 'string' ? [] : (message.content as AnthropicContentBlock[]);
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const call = block as { id: string };
        const resolved = resolveFunctionItemId?.(call.id);
        itemIdByCallId.set(call.id, resolved ?? `fc_replay_${call.id}`);
      }
    }
  }
  const input: OpenAIResponsesInputItem[] = [];
  for (const message of request.messages) {
    if (message.role === 'assistant') {
      input.push(...convertAssistantItem(message, itemIdByCallId));
    } else {
      input.push(...convertUserItem(message));
    }
  }
  return input;
}

/** Translate an Anthropic Messages request body into an OpenAI Responses body. */
export function anthropicRequestToOpenAIResponses(
  request: AnthropicMessagesRequest,
  options: AnthropicToResponsesOptions,
): OpenAIResponsesRequest {
  const input = buildResponsesInput(request, options.resolveFunctionItemId);
  const body: OpenAIResponsesRequest = {
    model: options.targetModel,
    input,
    stream: request.stream !== false,
  };
  const system = flattenAnthropicSystem(request.system);
  if (system) body.instructions = system;
  if (typeof request.max_tokens === 'number' && request.max_tokens > 0) {
    body.max_output_tokens = request.max_tokens;
  }
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  const tools = convertTools(request.tools);
  if (tools) body.tools = tools;
  const toolChoice = convertToolChoice(request.tool_choice);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;
  // Responses carries reasoning effort as a top-level parameter; map the
  // Anthropic thinking budget to the same low/medium/high ladder.
  const effort = thinkingBudgetToReasoningEffort(request.thinking?.budget_tokens);
  if (effort) body.reasoning = { effort: effort as 'low' | 'medium' | 'high' };
  return body;
}

// ---------------------------------------------------------------------------
// SSE stream translation
// ---------------------------------------------------------------------------

type ResponsesOpenBlock =
  | { kind: 'text'; anthropicIndex: number; started: boolean }
  | { kind: 'tool'; anthropicIndex: number; callId: string; name: string; started: boolean };

interface PendingResponsesToolCall {
  outputIndex: number;
  itemId?: string;
  callId?: string;
  name?: string;
  argumentFragments: string[];
  finalArguments?: string;
  emittedArgumentFragments: number;
  finalArgumentsEmitted: boolean;
  functionCallRecorded: boolean;
}

const toolStopReason = (): AnthropicStopReason => 'tool_use';

/**
 * Turns the Responses API SSE event stream into Anthropic SSE frames.
 *
 * Stateful by necessity: Anthropic requires an explicit
 * `message_start → content_block_start/delta/stop → message_delta →
 * message_stop` envelope, and block indices have to be allocated as output
 * items appear. Feed events in order, then call `finish()` exactly once.
 */
export class OpenAIResponsesStreamEmitter {
  private started = false;
  private closed = false;
  private nextAnthropicIndex = 0;
  /** output_index → open block (allocated when the item first produces output). */
  private readonly blocks = new Map<number, ResponsesOpenBlock>();
  private readonly blockByAnthropicIndex = new Map<number, ResponsesOpenBlock>();
  private readonly pendingToolCalls = new Map<number, PendingResponsesToolCall>();
  private readonly outputIndexByItemId = new Map<string, number>();
  /** Anthropic indices whose content_block_stop was already emitted. */
  private readonly closedIndexes = new Set<number>();
  /** Output item ids already surfaced by stream events (dedupe vs. completed). */
  private readonly emittedItemIds = new Set<string>();
  private readonly recordedFunctionCallIds = new Set<string>();
  /** Text deltas were streamed — the completed envelope must not replay them. */
  private streamedAnyText = false;
  private sawToolCall = false;
  private usage: OpenAIResponsesUsage | undefined;
  private stopReason: AnthropicStopReason = 'end_turn';

  constructor(
    private readonly messageId: string,
    private readonly model: string,
    private readonly onFunctionCall?: (callId: string, itemId?: string) => void,
  ) {}

  /** Frames for one upstream SSE event (empty array when nothing to emit). */
  push(event: OpenAIResponseSseEvent): SseFrame[] {
    if (this.closed) return [];
    switch (event.type) {
      case 'response.created':
      case 'response.in_progress':
        return [];
      case 'response.output_item.added':
        this.recordEmittedItem(event.item);
        return this.onOutputItemAdded(event);
      case 'response.content_part.added': {
        if (typeof event.item_id === 'string') this.emittedItemIds.add(event.item_id);
        const part = event.part;
        if (part?.type === 'output_text') {
          return this.openBlock(event.output_index);
        }
        return [];
      }
      case 'response.output_text.delta': {
        if (typeof event.item_id === 'string') this.emittedItemIds.add(event.item_id);
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta === '') return [];
        this.streamedAnyText = true;
        const frames = this.openBlock(event.output_index);
        frames.push(...this.textDeltaFrame(event.output_index, delta));
        return frames;
      }
      case 'response.output_text.done':
        return this.closeBlock(event.output_index);
      case 'response.function_call_arguments.delta': {
        const delta = typeof event.delta === 'string' ? event.delta : '';
        if (delta === '') return [];
        const outputIndex = this.resolveToolOutputIndex(event);
        if (outputIndex === undefined) return [];
        const pending = this.ensurePendingToolCall(outputIndex);
        this.recordToolItemId(pending, event.item_id);
        pending.argumentFragments.push(delta);
        return this.flushPendingToolCall(outputIndex);
      }
      case 'response.function_call_arguments.done': {
        const outputIndex = this.resolveToolOutputIndex(event);
        if (outputIndex === undefined) return [];
        const pending = this.ensurePendingToolCall(outputIndex);
        this.recordToolItemId(pending, event.item_id ?? event.id);
        this.mergePendingToolIdentity(pending, {
          callId: event.call_id,
          name: event.name,
        });
        if (typeof event.arguments === 'string') {
          pending.finalArguments = event.arguments;
        }
        return this.flushPendingToolCall(outputIndex);
      }
      case 'response.output_item.done':
        this.recordEmittedItem(event.item);
        return this.onOutputItemDone(event);
      case 'response.completed':
        return this.complete(event.response);
      case 'response.failed': {
        const message = event.response?.error?.message ?? 'upstream response failed';
        return this.error(message);
      }
      case 'response.error':
        return this.error(event.message ?? 'upstream error');
      default:
        return [];
    }
  }

  /** Close any open block and emit `message_delta` + `message_stop`. */
  finish(): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    const frames: SseFrame[] = [];
    if (!this.started) frames.push(...this.startMessage());
    frames.push(...this.closeAllBlocks());
    frames.push(this.messageDeltaFrame());
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

  // -- internals -------------------------------------------------------------

  private startMessage(): SseFrame[] {
    if (this.started) return [];
    this.started = true;
    return [
      {
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
      },
    ];
  }

  private recordEmittedItem(item: OpenAIResponsesOutputItem | undefined): void {
    if (!item) return;
    if (item.type === 'function_call') {
      this.recordFunctionCall(item as OpenAIResponsesFunctionCallItem);
    }
    const id =
      item.type === 'function_call'
        ? (item as OpenAIResponsesFunctionCallItem).id ??
          (item as OpenAIResponsesFunctionCallItem).call_id
        : undefined;
    if (typeof id === 'string' && id !== '') this.emittedItemIds.add(id);
  }

  private recordFunctionCall(call: OpenAIResponsesFunctionCallItem): void {
    if (call.call_id) this.recordFunctionCallId(call.call_id, call.id);
  }

  private recordFunctionCallId(callId: string, itemId?: string): void {
    if (this.recordedFunctionCallIds.has(callId)) return;
    this.recordedFunctionCallIds.add(callId);
    this.onFunctionCall?.(callId, itemId);
  }

  private onOutputItemAdded(
    event: Extract<OpenAIResponseSseEvent, { type: 'response.output_item.added' }>,
  ): SseFrame[] {
    const item = event.item;
    if (!item) return [];
    if (item.type === 'function_call') {
      const call = item as OpenAIResponsesFunctionCallItem;
      const outputIndex = event.output_index;
      if (outputIndex === undefined) return [];
      const pending = this.ensurePendingToolCall(outputIndex);
      this.recordToolItemId(pending, call.id);
      this.mergePendingToolIdentity(pending, {
        callId: call.call_id,
        name: call.name,
      });
      if (typeof call.arguments === 'string' && call.arguments !== '') {
        pending.finalArguments = call.arguments;
      }
      return this.flushPendingToolCall(outputIndex);
    }
    return [];
  }

  private onOutputItemDone(
    event: Extract<OpenAIResponseSseEvent, { type: 'response.output_item.done' }>,
  ): SseFrame[] {
    const item = event.item;
    if (!item) return [];
    if (item.type === 'function_call') {
      const call = item as OpenAIResponsesFunctionCallItem;
      const outputIndex =
        event.output_index ??
        (call.id ? this.outputIndexByItemId.get(call.id) : undefined);
      if (outputIndex === undefined) return [];
      const pending = this.ensurePendingToolCall(outputIndex);
      this.recordToolItemId(pending, call.id);
      this.mergePendingToolIdentity(pending, {
        callId: call.call_id,
        name: call.name,
      });
      if (typeof call.arguments === 'string') {
        pending.finalArguments = call.arguments;
      }
      const frames = this.flushPendingToolCall(outputIndex);
      frames.push(...this.closeBlock(outputIndex));
      return frames;
    }
    return this.closeBlock(event.output_index);
  }

  private ensureToolBlock(
    outputIndex: number | undefined,
    seed: { callId: string; name: string },
  ): SseFrame[] {
    if (outputIndex === undefined) return [];
    const existing = this.blocks.get(outputIndex);
    if (existing?.kind === 'tool') {
      if (!existing.started) {
        existing.started = true;
        return this.startToolBlockFrame(outputIndex, existing);
      }
      return [];
    }
    const block: ResponsesOpenBlock = {
      kind: 'tool',
      anthropicIndex: -1,
      callId: seed.callId,
      name: seed.name,
      started: false,
    };
    this.blocks.set(outputIndex, block);
    // index allocated at first frame so start always precedes deltas.
    block.anthropicIndex = this.nextAnthropicIndex++;
    this.blockByAnthropicIndex.set(block.anthropicIndex, block);
    block.started = true;
    return this.startToolBlockFrame(outputIndex, block);
  }

  private startToolBlockFrame(
    outputIndex: number,
    block: Extract<ResponsesOpenBlock, { kind: 'tool' }>,
  ): SseFrame[] {
    const frames: SseFrame[] = this.startMessage();
    frames.push(
      this.blockStartFrame(block.anthropicIndex, {
        type: 'tool_use',
        id: block.callId,
        name: block.name,
        input: {},
      }),
    );
    void outputIndex;
    return frames;
  }

  private ensurePendingToolCall(outputIndex: number): PendingResponsesToolCall {
    const existing = this.pendingToolCalls.get(outputIndex);
    if (existing) return existing;
    const pending: PendingResponsesToolCall = {
      outputIndex,
      argumentFragments: [],
      emittedArgumentFragments: 0,
      finalArgumentsEmitted: false,
      functionCallRecorded: false,
    };
    this.pendingToolCalls.set(outputIndex, pending);
    return pending;
  }

  private recordToolItemId(
    pending: PendingResponsesToolCall,
    itemId: string | undefined,
  ): void {
    if (!itemId) return;
    pending.itemId = itemId;
    this.outputIndexByItemId.set(itemId, pending.outputIndex);
    this.maybeRecordPendingFunctionCall(pending);
  }

  private mergePendingToolIdentity(
    pending: PendingResponsesToolCall,
    identity: { callId?: string; name?: string },
  ): void {
    if (identity.callId) pending.callId = identity.callId;
    if (identity.name) pending.name = identity.name;
    this.maybeRecordPendingFunctionCall(pending);
  }

  private maybeRecordPendingFunctionCall(pending: PendingResponsesToolCall): void {
    if (pending.functionCallRecorded || !pending.callId) return;
    pending.functionCallRecorded = true;
    this.recordFunctionCallId(pending.callId, pending.itemId);
  }

  private resolveToolOutputIndex(event: {
    output_index?: number;
    item_id?: string;
    call_id?: string;
  }): number | undefined {
    if (event.output_index !== undefined) return event.output_index;
    if (event.item_id) {
      const outputIndex = this.outputIndexByItemId.get(event.item_id);
      if (outputIndex !== undefined) return outputIndex;
    }
    if (event.call_id) {
      for (const pending of this.pendingToolCalls.values()) {
        if (pending.callId === event.call_id) return pending.outputIndex;
      }
    }
    return undefined;
  }

  private flushPendingToolCall(outputIndex: number): SseFrame[] {
    const pending = this.pendingToolCalls.get(outputIndex);
    if (!pending?.callId || !pending.name) return [];
    this.sawToolCall = true;
    this.maybeRecordPendingFunctionCall(pending);
    const frames = this.ensureToolBlock(outputIndex, {
      callId: pending.callId,
      name: pending.name,
    });
    if (pending.argumentFragments.length > 0) {
      while (pending.emittedArgumentFragments < pending.argumentFragments.length) {
        const fragment = pending.argumentFragments[pending.emittedArgumentFragments++];
        frames.push(...this.inputJsonDeltaFrame(outputIndex, fragment));
      }
      return frames;
    }
    if (
      !pending.finalArgumentsEmitted &&
      pending.finalArguments !== undefined &&
      pending.finalArguments !== ''
    ) {
      frames.push(...this.inputJsonDeltaFrame(outputIndex, pending.finalArguments));
      pending.finalArgumentsEmitted = true;
    }
    return frames;
  }

  private openBlock(outputIndex: number | undefined): SseFrame[] {
    if (outputIndex === undefined) return [];
    const existing = this.blocks.get(outputIndex);
    if (existing?.kind === 'text') {
      if (!existing.started) {
        existing.started = true;
        const frames: SseFrame[] = this.startMessage();
        frames.push(
          this.blockStartFrame(existing.anthropicIndex, { type: 'text', text: '' }),
        );
        return frames;
      }
      return [];
    }
    const block: ResponsesOpenBlock = { kind: 'text', anthropicIndex: -1, started: false };
    this.blocks.set(outputIndex, block);
    block.anthropicIndex = this.nextAnthropicIndex++;
    this.blockByAnthropicIndex.set(block.anthropicIndex, block);
    block.started = true;
    const frames: SseFrame[] = this.startMessage();
    frames.push(this.blockStartFrame(block.anthropicIndex, { type: 'text', text: '' }));
    return frames;
  }

  private textDeltaFrame(outputIndex: number | undefined, delta: string): SseFrame[] {
    const block = outputIndex === undefined ? undefined : this.blocks.get(outputIndex);
    if (!block) return [];
    return [
      {
        event: 'content_block_delta',
        data: JSON.stringify({
          type: 'content_block_delta',
          index: block.anthropicIndex,
          delta: { type: 'text_delta', text: delta },
        }),
      },
    ];
  }

  private inputJsonDeltaFrame(outputIndex: number | undefined, fragment: string): SseFrame[] {
    const block = outputIndex === undefined ? undefined : this.blocks.get(outputIndex);
    if (!block || block.kind !== 'tool') return [];
    return [
      {
        event: 'content_block_delta',
        data: JSON.stringify({
          type: 'content_block_delta',
          index: block.anthropicIndex,
          // Verbatim fragment — re-encoding partial JSON would corrupt it.
          delta: { type: 'input_json_delta', partial_json: fragment },
        }),
      },
    ];
  }

  private closeBlock(outputIndex: number | undefined): SseFrame[] {
    const block = outputIndex === undefined ? undefined : this.blocks.get(outputIndex);
    if (!block || !block.started) return [];
    return this.blockStopFrame(block.anthropicIndex);
  }

  private closeAllBlocks(): SseFrame[] {
    const frames: SseFrame[] = [];
    for (const block of this.blocks.values()) {
      if (block.started) frames.push(...this.blockStopFrame(block.anthropicIndex));
    }
    return frames;
  }

  private blockStopFrame(index: number): SseFrame[] {
    if (this.closedIndexes.has(index)) return [];
    this.closedIndexes.add(index);
    return [
      {
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index }),
      },
    ];
  }

  private blockStartFrame(index: number, contentBlock: Record<string, unknown>): SseFrame {
    return {
      event: 'content_block_start',
      data: JSON.stringify({ type: 'content_block_start', index, content_block: contentBlock }),
    };
  }

  private messageDeltaFrame(): SseFrame {
    return {
      event: 'message_delta',
      data: JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: this.stopReason, stop_sequence: null },
        usage: {
          input_tokens: this.usage?.input_tokens ?? 0,
          output_tokens: this.usage?.output_tokens ?? 0,
        },
      }),
    };
  }

  private complete(response: OpenAIResponsesBody | undefined): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    const frames: SseFrame[] = [];
    if (!this.started) frames.push(...this.startMessage());
    // Replay any output items that never produced stream events (e.g. an
    // upstream that only emits response.completed with the full output).
    if (response?.output) {
      for (const item of response.output) {
        if (item.type === 'function_call') {
          const call = item as OpenAIResponsesFunctionCallItem;
          const knownOutputIndex =
            call.id ? this.outputIndexByItemId.get(call.id) : undefined;
          if (knownOutputIndex !== undefined) {
            const pending = this.ensurePendingToolCall(knownOutputIndex);
            this.recordToolItemId(pending, call.id);
            this.mergePendingToolIdentity(pending, {
              callId: call.call_id,
              name: call.name,
            });
            if (typeof call.arguments === 'string') {
              pending.finalArguments = call.arguments;
            }
            frames.push(...this.flushPendingToolCall(knownOutputIndex));
          } else {
            this.recordFunctionCall(call);
          }
        }
        // The upstream streamed this item already (some relays emit both the
        // live events and the completed envelope) — replaying it would duplicate
        // every block. Match on the item id / call id the stream surfaced.
        const itemId =
          item.type === 'function_call'
            ? (item as OpenAIResponsesFunctionCallItem).id ?? (item as OpenAIResponsesFunctionCallItem).call_id
            : undefined;
        if (typeof itemId === 'string' && itemId !== '' && this.emittedItemIds.has(itemId)) {
          continue;
        }
        if (item.type === 'message') {
          // Message items carry no id in the final envelope; when the stream
          // already surfaced the text, the completed output is a full replay.
          if (this.streamedAnyText) continue;
          for (const part of item.content ?? []) {
            if (part.type === 'output_text' && part.text) {
              // Find or allocate a text block for this item (no index info in
              // the final envelope — allocate by occurrence order).
              const block: ResponsesOpenBlock = {
                kind: 'text',
                anthropicIndex: this.nextAnthropicIndex++,
                started: true,
              };
              this.blockByAnthropicIndex.set(block.anthropicIndex, block);
              frames.push(this.blockStartFrame(block.anthropicIndex, { type: 'text', text: '' }));
              frames.push({
                event: 'content_block_delta',
                data: JSON.stringify({
                  type: 'content_block_delta',
                  index: block.anthropicIndex,
                  delta: { type: 'text_delta', text: part.text },
                }),
              });
              frames.push(...this.blockStopFrame(block.anthropicIndex));
            }
          }
        } else if (item.type === 'function_call') {
          const call = item as OpenAIResponsesFunctionCallItem;
          this.sawToolCall = true;
          const block: ResponsesOpenBlock = {
            kind: 'tool',
            anthropicIndex: this.nextAnthropicIndex++,
            callId: call.call_id ?? call.id ?? '',
            name: call.name ?? '',
            started: true,
          };
          frames.push(
            this.blockStartFrame(block.anthropicIndex, {
              type: 'tool_use',
              id: block.callId,
              name: block.name,
              input: {},
            }),
          );
          const args = call.arguments;
          if (typeof args === 'string' && args !== '') {
            frames.push({
              event: 'content_block_delta',
              data: JSON.stringify({
                type: 'content_block_delta',
                index: block.anthropicIndex,
                delta: { type: 'input_json_delta', partial_json: args },
              }),
            });
          }
          frames.push(...this.blockStopFrame(block.anthropicIndex));
        }
      }
    }
    frames.push(...this.closeAllBlocks());
    if (response?.usage) this.usage = response.usage;
    this.stopReason = this.sawToolCall ? toolStopReason() : 'end_turn';
    if (response?.status === 'incomplete') this.stopReason = 'max_tokens';
    frames.push(this.messageDeltaFrame());
    frames.push({ event: 'message_stop', data: JSON.stringify({ type: 'message_stop' }) });
    return frames;
  }
}
