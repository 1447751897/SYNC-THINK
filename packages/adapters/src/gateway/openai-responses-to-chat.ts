/**
 * OpenAI-Responses-inbound translation: a kernel that only speaks the OpenAI
 * Responses API (Codex) talking to a Chat-Completions upstream (e.g. DeepSeek
 * official, which exposes no `/responses` endpoint at all).
 *
 * Two halves, both pure:
 *   1. `openaiResponsesToChat` — request body rewrite.
 *   2. `ChatStreamToResponsesEmitter` — consumes upstream `chat.completion.chunk`
 *      objects and emits the Responses SSE events the kernel expects.
 *
 * Fidelity rules that matter for a working tool loop:
 * - Responses `input` is a flat list of independent items; Chat is an interleaved
 *   `messages` array. `function_call` items are attached to the nearest preceding
 *   assistant message as `tool_calls`; `function_call_output` items become
 *   `role:'tool'` messages that follow them.
 * - `previous_response_id` continuation is WebSocket-only on HTTP Responses; the
 *   gateway already replays `function_call` + `function_call_output` pairs. A
 *   continuation id has no Chat equivalent and is dropped.
 * - `input_text` / `output_text` parts map to text; `input_image` → `image_url`.
 * - `max_output_tokens` → `max_tokens`; reasoning effort is dropped rather than
 *   risking a 400 on relays that do not accept it.
 */
import type {
  OpenAIChatRequest,
  OpenAIContentPart,
  OpenAIResponsesContentPart,
  OpenAIResponsesRequest,
  OpenAIToolDefinition,
  OpenAIWireMessage,
} from './wire-types.js';

/** Models that expose thinking through Chat `reasoning_content` (DeepSeek/Qwen style). */
function isReasoningChatModel(modelId: string): boolean {
  const tail = (modelId.split('/').pop() ?? modelId).toLowerCase();
  return /deepseek/.test(tail) || /(^|[-_.])think/.test(tail) || /reasoning/.test(tail);
}

/** Responses content → one plain string (text parts joined). */
function contentToText(content: string | OpenAIResponsesContentPart[] | undefined): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  // Codex 0.147 can hand a single content object instead of an array; treat it
  // as a one-element list rather than crashing the stream.
  const list = Array.isArray(content) ? content : [content as OpenAIResponsesContentPart];
  const parts: string[] = [];
  for (const part of list) {
    if (part && part.type === 'input_text' || part && part.type === 'output_text') {
      const text = (part as { text?: string }).text;
      if (typeof text === 'string') parts.push(text);
    }
    // function_call parts inside content are handled at item level in the input
    // list; image parts are handled by contentToParts for user turns.
  }
  return parts.join('');
}

/** Responses content → Chat content parts (text + image_url; drops the rest). */
function contentToParts(content: string | OpenAIResponsesContentPart[] | undefined): OpenAIContentPart[] {
  if (content === undefined) return [];
  if (typeof content === 'string') return content === '' ? [] : [{ type: 'text', text: content }];
  const list = Array.isArray(content) ? content : [content as OpenAIResponsesContentPart];
  const parts: OpenAIContentPart[] = [];
  for (const part of list) {
    if (!part) continue;
    if (part.type === 'input_text' || part.type === 'output_text') {
      const text = (part as { text?: string }).text;
      if (typeof text === 'string' && text !== '') parts.push({ type: 'text', text });
    } else if (part.type === 'input_image') {
      const image = part as { image_url: string | { url: string; detail?: string }; detail?: string };
      const url = typeof image.image_url === 'string' ? image.image_url : image.image_url?.url;
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  return parts;
}

export interface ToolNamespaceEntry {
  /** The flattened name sent to the Chat upstream (`{namespace}__{subToolName}`). */
  fullName: string;
  /** The Responses namespace (e.g. `mcp__sync_think_platform`). */
  namespace: string;
  /** The bare sub-tool name inside the namespace (e.g. `platform_context`). */
  name: string;
}

/**
 * Chat `function.name` must match `^[a-zA-Z0-9_-]+$` (DeepSeek enforces it),
 * so a namespace tool cannot be flattened as `{namespace}/{subToolName}` — the
 * `/` is rejected with a 400. We join with `__` instead (both halves already
 * use underscores, so the map key stays unambiguous) and clamp the total length
 * to 64 chars (the OpenAI/DeepSeek function-name limit) by truncating the
 * sub-tool name. The reverse stream mapping only does exact map lookups, so a
 * truncated sub-name still round-trips back to the original `custom_tool_call`.
 */
function flattenNamespaceToolName(namespace: string, subName: string): string {
  const raw = `${namespace}__${subName}`;
  if (raw.length <= 64) return raw;
  const maxSub = 64 - namespace.length - 2; // `namespace` + `__` + `sub`
  return `${namespace}__${subName.slice(0, Math.max(1, maxSub))}`;
}

function convertTools(tools: OpenAIResponsesRequest['tools']): {
  definitions: OpenAIToolDefinition[] | undefined;
  namespaceMap: Map<string, ToolNamespaceEntry>;
} {
  const namespaceMap = new Map<string, ToolNamespaceEntry>();
  if (!tools || tools.length === 0) return { definitions: undefined, namespaceMap };
  const definitions: OpenAIToolDefinition[] = [];
  for (const tool of tools) {
    // Codex 0.147 declares platform MCP tools as a `namespace` wrapper whose
    // sub-tools share one namespace name. Chat upstreams (DeepSeek) have no
    // namespace concept, so flatten the sub-tools into `function` definitions
    // named `{namespace}__{subToolName}`; the reverse stream mapping rebuilds a
    // `custom_tool_call` (name + namespace) for these on the way back.
    if (tool.type === 'namespace') {
      if (typeof tool.name !== 'string' || tool.name.trim() === '') continue;
      const namespace = tool.name;
      for (const sub of tool.tools ?? []) {
        if (typeof sub.name !== 'string' || sub.name.trim() === '') continue;
        const fullName = flattenNamespaceToolName(namespace, sub.name);
        namespaceMap.set(fullName, { fullName, namespace, name: sub.name });
        definitions.push({
          type: 'function',
          function: {
            name: fullName,
            ...(sub.description ? { description: sub.description } : {}),
            parameters: sub.parameters ?? { type: 'object', properties: {} },
          },
        });
      }
      continue;
    }
    // Plain `function` tool (also survives Codex 0.147 empty-name entries: a
    // Chat upstream rejects `function` tools without a name, so drop them
    // instead of failing the whole request).
    if (typeof tool.name !== 'string' || tool.name.trim() === '') continue;
    definitions.push({
      type: 'function',
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.parameters ?? { type: 'object', properties: {} },
      },
    });
  }
  return { definitions: definitions.length > 0 ? definitions : undefined, namespaceMap };
}

function convertToolChoice(
  choice: OpenAIResponsesRequest['tool_choice'],
): OpenAIChatRequest['tool_choice'] {
  if (!choice) return undefined;
  if (choice.type === 'auto' || choice.type === 'none' || choice.type === 'required') {
    return choice.type;
  }
  if (choice.type === 'function' && choice.name) {
    return { type: 'function', function: { name: choice.name } };
  }
  return undefined;
}

export interface OpenAIResponsesToChatOptions {
  /** Provider-facing model string (already resolved by the gateway router). */
  targetModel: string;
}

/**
 * Translate an OpenAI Responses request body into an OpenAI Chat Completions
 * body. The Responses `input` item list is linearized back into Chat's
 * interleaved `messages` array.
 *
 * Also returns the namespace map built from `request.tools` (namespace wrappers
 * flattened into `{namespace}__{subToolName}` functions). Callers pass it to the
 * reverse `ChatStreamToResponsesEmitter` so a model reply for a flattened tool
 * is re-emitted as a `custom_tool_call` with the original namespace restored.
 */
export function openaiResponsesToChat(
  request: OpenAIResponsesRequest,
  options: OpenAIResponsesToChatOptions,
): { body: OpenAIChatRequest; toolNamespaceMap: Map<string, ToolNamespaceEntry> } {
  const messages: OpenAIWireMessage[] = [];
  if (request.instructions) {
    messages.push({ role: 'system', content: request.instructions });
  }

  // DeepSeek rejects an assistant message whose `tool_calls` are not each
  // answered by a `role:'tool'` message. Codex replays its full history in the
  // Responses `input`, which includes tool calls that never produced a result
  // (e.g. an `unsupported call` from a prior turn). Pre-scan the input so we can
  // drop those orphaned calls on replay instead of failing the whole request.
  const answeredCallIds = new Set<string>();
  for (const item of request.input) {
    if (
      item &&
      typeof item === 'object' &&
      'type' in item &&
      item.type === 'function_call_output'
    ) {
      answeredCallIds.add((item as { call_id: string }).call_id);
    }
  }

  // Index of the assistant message currently accumulating tool_calls, or -1.
  let assistantIndex = -1;
  for (const item of request.input) {
    if (item && typeof item === 'object' && 'type' in item) {
      if (item.type === 'function_call' || item.type === 'custom_tool_call') {
        // Codex emits namespace-tool invocations as function_call/custom_tool_call
        // with a top-level `namespace` (e.g. `mcp__sync_think_platform`). Chat
        // upstreams have no namespace, and a bare `platform_context` would teach
        // the model to reply with bare names that the reverse mapping cannot
        // restore. Re-flatten `{namespace}__{name}` so the whole history stays
        // consistent with the tool definitions sent in `body.tools`.
        const call = item as {
          call_id: string;
          name: string;
          arguments?: string;
          input?: string | Record<string, unknown>;
          namespace?: string;
        };
        // Orphaned tool call (no `function_call_output` in the replay): skip it
        // rather than emit an unanswered assistant `tool_calls` entry.
        if (!answeredCallIds.has(call.call_id)) continue;
        const callName = call.namespace
          ? flattenNamespaceToolName(call.namespace, call.name)
          : call.name;
        const rawArgs = item.type === 'custom_tool_call' ? call.input : call.arguments;
        const callArgs =
          typeof rawArgs === 'string'
            ? rawArgs
            : rawArgs !== undefined && rawArgs !== null
              ? JSON.stringify(rawArgs)
              : '';
        if (assistantIndex >= 0 && messages[assistantIndex]?.role === 'assistant') {
          const target = messages[assistantIndex];
          const calls = (target.tool_calls ??= []);
          calls.push({
            id: call.call_id,
            type: 'function',
            function: { name: callName, arguments: callArgs },
          });
        } else {
          assistantIndex = messages.length;
          messages.push({
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: call.call_id,
                type: 'function',
                function: { name: callName, arguments: callArgs },
              },
            ],
          });
        }
        continue;
      }
      if (item.type === 'function_call_output') {
        const output = item as { call_id: string; output: string };
        messages.push({
          role: 'tool',
          tool_call_id: output.call_id,
          content: output.output ?? '',
        });
        assistantIndex = -1; // a tool result terminates assistant accumulation
        continue;
      }
    }

    // Plain message item.
    const message = item as { role?: string; content?: string | OpenAIResponsesContentPart[] };
    const role = message.role ?? 'user';
    if (role === 'system' || role === 'developer') {
      const text = contentToText(message.content);
      const last = messages[messages.length - 1];
      if (text !== '' && last && last.role === 'system' && typeof last.content === 'string') {
        last.content = `${last.content}\n\n${text}`;
      } else if (text !== '') {
        messages.push({ role: 'system', content: text });
      }
      assistantIndex = -1;
      continue;
    }
    if (role === 'assistant') {
      const text = contentToText(message.content);
      assistantIndex = messages.length;
      messages.push({ role: 'assistant', content: text });
      continue;
    }
    // user
    const parts = contentToParts(message.content);
    assistantIndex = -1;
    if (parts.length === 0) continue;
    const onlyText = parts.every((part) => part.type === 'text');
    messages.push({
      role: 'user',
      content: onlyText
        ? parts.map((part) => (part as { text: string }).text).join('')
        : parts,
    });
  }

  const body: OpenAIChatRequest = {
    model: options.targetModel,
    messages,
    stream: request.stream !== false,
  };
  if (body.stream) body.stream_options = { include_usage: true };
  if (typeof request.max_output_tokens === 'number' && request.max_output_tokens > 0) {
    body.max_tokens = request.max_output_tokens;
  }
  if (typeof request.temperature === 'number') body.temperature = request.temperature;
  // Responses `reasoning.effort` → Chat `reasoning_effort` so thinking relays
  // (DeepSeek/Qwen) return reasoning_content, which the reverse stream mapping
  // surfaces back as a reasoning item. When Codex does not request an effort
  // (its model metadata omits supported_reasoning_levels for unknown models),
  // still enable thinking for known reasoning models so the UI can surface it.
  const effort =
    request.reasoning?.effort ?? (isReasoningChatModel(options.targetModel) ? 'high' : undefined);
  if (effort) body.reasoning_effort = effort;
  const { definitions: tools, namespaceMap } = convertTools(request.tools);
  if (tools) body.tools = tools;
  const toolChoice = convertToolChoice(request.tool_choice);
  if (toolChoice) body.tool_choice = toolChoice;
  return { body, toolNamespaceMap: namespaceMap };
}
