/**
 * Chat-Completions-inbound response translation: the upstream (e.g. DeepSeek
 * official) answers with `chat.completion.chunk` SSE frames, but Codex expects
 * the OpenAI Responses SSE event vocabulary (`response.output_text.delta`,
 * `response.function_call_arguments.delta`, `response.completed`, ...).
 *
 * Stateful by necessity: Responses emits an `output_item.added → deltas →
 * output_item.done` envelope per item, and `output_index` has to stay
 * monotonic across text and tool-call items. Feed chunks in order, then call
 * `finish()` exactly once (or `error()` for an upstream failure).
 *
 * Fidelity rules:
 * - Tool-call `arguments` fragments (`delta.tool_calls[].function.arguments`)
 *   are streamed verbatim as `response.function_call_arguments.delta` — partial
 *   JSON must never be re-encoded.
 * - `reasoning_content` is dropped: Responses has no Chat-compatible reasoning
 *   channel, and emitting unknown events risks the kernel rejecting the stream.
 * - The final `response.completed` carries the full `output` list plus usage.
 */
import type { ToolNamespaceEntry } from './openai-responses-to-chat.js';
import type {
  OpenAIFinishReason,
  OpenAIResponsesBody,
  OpenAIResponsesFunctionCallItem,
  OpenAIResponsesCustomToolCallItem,
  OpenAIResponsesOutputItem,
  OpenAIStreamChunk,
  OpenAIUsage,
  SseFrame,
} from './wire-types.js';

type ResponsesUsage = NonNullable<OpenAIResponsesBody['usage']>;

/** Sentinel for a bare sub-tool name shared by two namespaces (never restored). */
const AMBIGUOUS_NAMESPACE_ENTRY: ToolNamespaceEntry = {
  fullName: '',
  namespace: '',
  name: '',
};

interface ToolState {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  /** Set when `name` maps to a flattened namespace tool (`custom_tool_call`). */
  namespace?: string;
  /** Bare sub-tool name inside the namespace (when namespace is set). */
  customName?: string;
  argumentFragments: string[];
  emittedFragments: number;
  opened: boolean;
  done: boolean;
}

function usageToResponses(usage: OpenAIUsage | null | undefined): ResponsesUsage | undefined {
  if (!usage) return undefined;
  return {
    ...(typeof usage.prompt_tokens === 'number' ? { input_tokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === 'number' ? { output_tokens: usage.completion_tokens } : {}),
    ...(typeof usage.total_tokens === 'number' ? { total_tokens: usage.total_tokens } : {}),
    ...(usage.prompt_tokens_details
      ? {
          input_tokens_details: {
            ...(typeof usage.prompt_tokens_details.cached_tokens === 'number'
              ? { cached_tokens: usage.prompt_tokens_details.cached_tokens }
              : {}),
          },
        }
      : {}),
    ...(usage.completion_tokens_details
      ? {
          output_tokens_details: {
            ...(typeof usage.completion_tokens_details.reasoning_tokens === 'number'
              ? { reasoning_tokens: usage.completion_tokens_details.reasoning_tokens }
              : {}),
          },
        }
      : {}),
  };
}

function statusForFinishReason(
  reason: OpenAIFinishReason | null | undefined,
): 'completed' | 'incomplete' {
  if (reason === 'length' || reason === 'content_filter') return 'incomplete';
  return 'completed';
}

/**
 * Turns an OpenAI Chat stream into OpenAI Responses SSE frames.
 */
export class ChatStreamToResponsesEmitter {
  private started = false;
  private closed = false;
  private nextOutputIndex = 0;
  private usage: ResponsesUsage | undefined;
  private finishReason: OpenAIFinishReason | null | undefined;

  // Current text item (streamed content deltas before any tool call).
  private textItemId = '';
  private textOutputIndex = -1;
  private textBuffer = '';
  private textStarted = false;
  private textDone = false;

  /** Provider reasoning (DeepSeek/Qwen `reasoning_content`) → a reasoning item. */
  private reasoningItemId = '';
  private reasoningOutputIndex = -1;
  private reasoningBuffer = '';
  private reasoningStarted = false;
  private reasoningDone = false;

  /** chat tool_call.index → accumulated tool item state. */
  private readonly tools = new Map<number, ToolState>();

  constructor(
    private readonly responseId: string,
    private readonly model: string,
    private readonly toolNamespaceMap: ReadonlyMap<string, ToolNamespaceEntry> = new Map(),
  ) {
    // Reverse index for the DeepSeek quirk: it often replies to a flattened
    // `{namespace}__{name}` tool definition with the bare `{name}` (e.g.
    // `platform_context`). Without this fallback the tool call would be emitted
    // as a plain `function_call` and Codex could not route it to the MCP
    // namespace server (unsupported call). Ambiguous bare names (same sub-tool
    // in two namespaces) are skipped so we never mis-route a call.
    const byName = new Map<string, ToolNamespaceEntry>();
    for (const entry of toolNamespaceMap.values()) {
      const existing = byName.get(entry.name);
      if (existing === undefined) byName.set(entry.name, entry);
      else byName.set(entry.name, AMBIGUOUS_NAMESPACE_ENTRY);
    }
    this.bareNameMap = byName;
  }

  private readonly bareNameMap: ReadonlyMap<string, ToolNamespaceEntry>;

  /** Frames for one upstream chunk (empty array when nothing to emit). */
  push(chunk: OpenAIStreamChunk): SseFrame[] {
    if (this.closed) return [];
    const frames: SseFrame[] = [];
    if (!this.started) {
      this.started = true;
      frames.push(...this.createdFrames());
    }
    if (chunk.usage) {
      this.usage = usageToResponses(chunk.usage);
    }
    const choice = chunk.choices?.[0];
    if (!choice) return frames;
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) return frames;

    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
    if (reasoning !== '') {
      frames.push(...this.openReasoningIfNeeded());
      this.reasoningBuffer += reasoning;
      frames.push(this.reasoningDeltaFrame(reasoning));
    }

    const text = typeof delta.content === 'string' ? delta.content : '';
    if (text !== '') {
      frames.push(...this.closeReasoning());
      frames.push(...this.openTextIfNeeded());
      this.textBuffer += text;
      frames.push(this.textDeltaFrame(text));
    }

    for (const call of delta.tool_calls ?? []) {
      const callIndex = typeof call.index === 'number' ? call.index : 0;
      const state = this.ensureTool(callIndex);
      if (call.id) state.callId = call.id;
      if (call.function?.name) {
        state.name = call.function.name;
        let entry = this.toolNamespaceMap.get(state.name);
        if (!entry) {
          const bare = this.bareNameMap.get(state.name);
          if (bare && bare !== AMBIGUOUS_NAMESPACE_ENTRY) entry = bare;
        }
        if (entry && entry !== AMBIGUOUS_NAMESPACE_ENTRY) {
          state.namespace = entry.namespace;
          state.customName = entry.name;
        }
      }
      const args = call.function?.arguments;
      if (typeof args === 'string' && args !== '') {
        state.argumentFragments.push(args);
      }
      // Responses keeps output monotonic: a text item must be closed before a
      // function_call item opens. Tool argument fragments only stream once the
      // call's name has arrived (a Responses item needs its name at open time).
      if (state.name !== '') {
        frames.push(...this.closeReasoning());
        frames.push(...this.closeText());
        frames.push(...this.flushToolDeltas(state));
      }
    }
    return frames;
  }

  /** Close every open item and emit `response.completed`. */
  finish(): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    const frames: SseFrame[] = [];
    if (!this.started) frames.push(...this.createdFrames());
    frames.push(...this.closeReasoning());
    frames.push(...this.closeText());
    for (const state of this.tools.values()) frames.push(...this.closeTool(state));
    frames.push(this.completedFrame());
    return frames;
  }

  /** Upstream failure mid-stream: Responses clients expect `response.failed`. */
  error(message: string): SseFrame[] {
    if (this.closed) return [];
    this.closed = true;
    return [
      frame('response.failed', {
        type: 'response.failed',
        response: { id: this.responseId, model: this.model, status: 'failed' },
        error: { code: 'upstream_error', message },
      }),
    ];
  }

  // -- internals -------------------------------------------------------------

  private createdFrames(): SseFrame[] {
    const base: OpenAIResponsesBody = {
      id: this.responseId,
      object: 'response',
      status: 'in_progress',
      model: this.model,
      output: [],
    };
    return [
      frame('response.created', { type: 'response.created', response: base }),
      frame('response.in_progress', { type: 'response.in_progress', response: base }),
    ];
  }

  private openReasoningIfNeeded(): SseFrame[] {
    if (this.reasoningStarted) return [];
    this.reasoningStarted = true;
    this.reasoningItemId = `rs_${this.responseId}_${this.nextOutputIndex}`;
    this.reasoningOutputIndex = this.nextOutputIndex++;
    return [
      frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: this.reasoningOutputIndex,
        item: { type: 'reasoning', id: this.reasoningItemId, summary: [] },
      }),
      frame('response.reasoning_summary_part.added', {
        type: 'response.reasoning_summary_part.added',
        item_id: this.reasoningItemId,
        output_index: this.reasoningOutputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text: '' },
      }),
    ];
  }

  private reasoningDeltaFrame(delta: string): SseFrame {
    return frame('response.reasoning_summary_part.added', {
      type: 'response.reasoning_summary_part.added',
      item_id: this.reasoningItemId,
      output_index: this.reasoningOutputIndex,
      summary_index: 0,
      part: { type: 'summary_text', text: delta },
    });
  }

  private closeReasoning(): SseFrame[] {
    if (!this.reasoningStarted || this.reasoningDone) return [];
    this.reasoningDone = true;
    return [
      frame('response.reasoning_summary_part.done', {
        type: 'response.reasoning_summary_part.done',
        item_id: this.reasoningItemId,
        output_index: this.reasoningOutputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text: this.reasoningBuffer },
      }),
      frame('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: this.reasoningOutputIndex,
        item: {
          type: 'reasoning',
          id: this.reasoningItemId,
          summary: [{ type: 'summary_text', text: this.reasoningBuffer }],
        },
      }),
    ];
  }

  private openTextIfNeeded(): SseFrame[] {
    if (this.textStarted) return [];
    this.textStarted = true;
    this.textItemId = `msg_${this.responseId}_${this.nextOutputIndex}`;
    this.textOutputIndex = this.nextOutputIndex++;
    return [
      frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: this.textOutputIndex,
        item: {
          type: 'message',
          id: this.textItemId,
          role: 'assistant',
          content: [],
        },
      }),
      frame('response.content_part.added', {
        type: 'response.content_part.added',
        item_id: this.textItemId,
        output_index: this.textOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      }),
    ];
  }

  private textDeltaFrame(delta: string): SseFrame {
    return frame('response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: this.textItemId,
      output_index: this.textOutputIndex,
      content_index: 0,
      delta,
    });
  }

  private closeText(): SseFrame[] {
    if (!this.textStarted || this.textDone) return [];
    this.textDone = true;
    return [
      frame('response.output_text.done', {
        type: 'response.output_text.done',
        item_id: this.textItemId,
        output_index: this.textOutputIndex,
        content_index: 0,
        text: this.textBuffer,
      }),
      frame('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: this.textOutputIndex,
        item: {
          type: 'message',
          id: this.textItemId,
          role: 'assistant',
          content: [{ type: 'output_text', text: this.textBuffer, annotations: [] }],
        },
      }),
    ];
  }

  private ensureTool(callIndex: number): ToolState {
    const existing = this.tools.get(callIndex);
    if (existing) return existing;
    const outputIndex = this.nextOutputIndex++;
    const state: ToolState = {
      outputIndex,
      itemId: `fc_${this.responseId}_${outputIndex}`,
      callId: '',
      name: '',
      argumentFragments: [],
      emittedFragments: 0,
      opened: false,
      done: false,
    };
    this.tools.set(callIndex, state);
    return state;
  }

  private flushToolDeltas(state: ToolState): SseFrame[] {
    const frames: SseFrame[] = [];
    if (!state.name) return frames; // wait for the name before opening the item
    if (!state.opened) frames.push(this.outputItemAddedToolFrame(state));
    while (state.emittedFragments < state.argumentFragments.length) {
      const fragment = state.argumentFragments[state.emittedFragments++];
      frames.push(this.toolArgumentsDeltaFrame(state, fragment));
    }
    return frames;
  }

  private outputItemAddedToolFrame(state: ToolState): SseFrame {
    state.opened = true;
    if (state.namespace) {
      return frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: state.outputIndex,
        item: {
          type: 'custom_tool_call',
          id: state.itemId,
          call_id: state.callId,
          name: state.customName ?? state.name,
          namespace: state.namespace,
          input: '',
        },
      });
    }
    return frame('response.output_item.added', {
      type: 'response.output_item.added',
      output_index: state.outputIndex,
      item: {
        type: 'function_call',
        id: state.itemId,
        call_id: state.callId,
        name: state.name,
        arguments: '',
      },
    });
  }

  private toolArgumentsDeltaFrame(state: ToolState, delta: string): SseFrame {
    if (state.namespace) {
      return frame('response.custom_tool_call_input.delta', {
        type: 'response.custom_tool_call_input.delta',
        item_id: state.itemId,
        call_id: state.callId,
        output_index: state.outputIndex,
        delta,
      });
    }
    return frame('response.function_call_arguments.delta', {
      type: 'response.function_call_arguments.delta',
      item_id: state.itemId,
      output_index: state.outputIndex,
      delta,
    });
  }

  private closeTool(state: ToolState): SseFrame[] {
    if (state.done || !state.name) return [];
    const frames: SseFrame[] = [];
    if (!state.opened) frames.push(this.outputItemAddedToolFrame(state));
    while (state.emittedFragments < state.argumentFragments.length) {
      const fragment = state.argumentFragments[state.emittedFragments++];
      frames.push(this.toolArgumentsDeltaFrame(state, fragment));
    }
    // `custom_tool_call` items carry their final input in `output_item.done` and
    // have no `arguments.done` event (Codex 0.147 only wires the input deltas).
    if (!state.namespace) {
      frames.push(
        frame('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          arguments: state.argumentFragments.join(''),
        }),
      );
    }
    frames.push(
      frame('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: state.outputIndex,
        item: this.completedToolItem(state),
      }),
    );
    state.done = true;
    return frames;
  }

  private completedToolItem(state: ToolState):
    | OpenAIResponsesFunctionCallItem
    | OpenAIResponsesCustomToolCallItem {
    if (state.namespace) {
      return {
        type: 'custom_tool_call',
        id: state.itemId,
        call_id: state.callId,
        name: state.customName ?? state.name,
        namespace: state.namespace,
        input: state.argumentFragments.join(''),
      };
    }
    return {
      type: 'function_call',
      id: state.itemId,
      call_id: state.callId,
      name: state.name,
      arguments: state.argumentFragments.join(''),
    };
  }

  private completedFrame(): SseFrame {
    const output: OpenAIResponsesOutputItem[] = [];
    if (this.reasoningStarted && this.reasoningBuffer.trim()) {
      output.push({
        type: 'reasoning',
        id: this.reasoningItemId,
        summary: [{ type: 'summary_text', text: this.reasoningBuffer }],
      });
    }
    if (this.textStarted) {
      output.push({
        type: 'message',
        id: this.textItemId,
        role: 'assistant',
        content: [{ type: 'output_text', text: this.textBuffer, annotations: [] }],
      });
    }
    for (const state of this.tools.values()) {
      if (state.name) output.push(this.completedToolItem(state));
    }
    const response: OpenAIResponsesBody = {
      id: this.responseId,
      object: 'response',
      status: statusForFinishReason(this.finishReason),
      model: this.model,
      output,
      ...(this.usage ? { usage: this.usage } : {}),
    };
    return frame('response.completed', { type: 'response.completed', response });
  }
}

function frame(event: string, data: unknown): SseFrame {
  return { event, data: JSON.stringify(data) };
}
