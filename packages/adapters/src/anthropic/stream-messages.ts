import type { AdapterEvent, ProviderCallRequest, ProviderMessage } from '../types.js';
import { scrubSecrets, normalizeOpenAICompatibleBaseUrl } from '../openai/discover-models.js';
import type { FailureClass } from '@sync-think/shared';
import {
  closeResponseReader,
  createProviderCallControl,
  providerAbortEvent,
} from '../call-control.js';

export class AnthropicCallError extends Error {
  readonly failureClass: FailureClass;
  readonly status?: number;

  constructor(message: string, failureClass: FailureClass, status?: number) {
    super(message);
    this.name = 'AnthropicCallError';
    this.failureClass = failureClass;
    this.status = status;
  }
}

/** Join base URL to Anthropic Messages endpoint without doubling the path. */
export function joinMessagesUrl(baseUrl: string): string {
  let root: string;
  try {
    root = normalizeOpenAICompatibleBaseUrl(baseUrl);
  } catch {
    throw new AnthropicCallError('Base URL must not be empty', 'protocol');
  }
  if (/\/messages$/i.test(root)) return root;
  return `${root}/messages`;
}

function messageContentToString(message: ProviderMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}

function anthropicImageBlock(imageUrl: string): Record<string, unknown> {
  const match = imageUrl.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
  if (match) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] },
    };
  }
  return { type: 'image', source: { type: 'url', url: imageUrl } };
}

function toAnthropicMessages(
  request: ProviderCallRequest,
): Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }> {
  const out: Array<{
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
  }> = [];
  for (const message of request.messages) {
    if (message.role === 'system') continue;
    const content = messageContentToString(message);
    if (message.role === 'tool' && message.toolCallId) {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content }],
      });
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const blocks: Array<Record<string, unknown>> = [];
      if (content) blocks.push({ type: 'text', text: content });
      for (const part of message.content) {
        if (part.type !== 'tool-call' || !part.toolCall) continue;
        let parsedInput: unknown = {};
        try {
          parsedInput = JSON.parse(part.toolCall.argumentsJson) as unknown;
        } catch {
          parsedInput = {};
        }
        blocks.push({
          type: 'tool_use',
          id: part.toolCall.id,
          name: part.toolCall.name,
          input: parsedInput,
        });
      }
      if (blocks.length > 0) {
        out.push({ role: 'assistant', content: blocks });
        continue;
      }
    }
    const multimodalContent =
      message.role === 'user' && Array.isArray(message.content)
        ? message.content.flatMap((part) => {
            if (part.type === 'text' && part.text) return [{ type: 'text', text: part.text }];
            if (part.type === 'image' && part.imageUrl) return [anthropicImageBlock(part.imageUrl)];
            return [];
          })
        : undefined;
    if (!content && !multimodalContent?.length && message.role !== 'assistant') continue;
    out.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: multimodalContent?.length ? multimodalContent : content,
    });
  }
  // Anthropic requires the conversation to start with a user turn.
  if (out.length === 0) {
    out.push({ role: 'user', content: '' });
  } else if (out[0]!.role !== 'user') {
    out.unshift({ role: 'user', content: '(context)' });
  }
  return out;
}

function classifyHttpFailure(status: number, snippet: string): AnthropicCallError {
  if (status === 401 || status === 403) {
    return new AnthropicCallError(`Provider auth failed (${status})${snippet}`, 'auth', status);
  }
  if (status === 429) {
    return new AnthropicCallError(
      `Provider rate limited (${status})${snippet}`,
      'rate-limit',
      status,
    );
  }
  if (status >= 400 && status < 500) {
    return new AnthropicCallError(
      `Provider call rejected (${status})${snippet}`,
      'protocol',
      status,
    );
  }
  return new AnthropicCallError(`Provider call failed (${status})${snippet}`, 'transient', status);
}

export interface StreamAnthropicMessagesOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Anthropic API version header; defaults to 2023-06-01. */
  anthropicVersion?: string;
}

/**
 * Stream Anthropic Messages API (SSE).
 * Yields unified AdapterEvent values; never yields plaintext secrets.
 */
export async function* streamAnthropicMessages(
  request: ProviderCallRequest,
  options: StreamAnthropicMessagesOptions = {},
): AsyncIterable<AdapterEvent> {
  const apiKey = request.apiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    yield {
      type: 'error',
      failureClass: 'auth',
      message: 'API key is required for Anthropic messages',
    };
    return;
  }
  if (!request.modelId || request.modelId.trim().length === 0) {
    yield { type: 'error', failureClass: 'protocol', message: 'modelId is required' };
    return;
  }
  if (!request.idempotencyKey?.trim() || request.idempotencyKey.length > 256) {
    yield { type: 'error', failureClass: 'protocol', message: 'idempotencyKey is required' };
    return;
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    yield {
      type: 'error',
      failureClass: 'protocol',
      message: 'Fetch is not available in this runtime',
    };
    return;
  }

  const url = joinMessagesUrl(request.baseUrl);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const control = createProviderCallControl(request.signal, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const version = options.anthropicVersion ?? '2023-06-01';

  const body: Record<string, unknown> = {
    model: request.modelId,
    max_tokens: request.maxOutputTokens ?? 1024,
    messages: toAnthropicMessages(request),
    stream: true,
  };
  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    body.system = request.systemPrompt;
  } else {
    // Promote leading system messages into Anthropic system field if present.
    const systemParts = request.messages
      .filter((m) => m.role === 'system')
      .map(messageContentToString)
      .filter((s) => s.length > 0);
    if (systemParts.length > 0) body.system = systemParts.join('\n\n');
  }
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': version,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: control.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield providerAbortEvent(control, 'Anthropic messages call');
        return;
      }
      const raw = error instanceof Error ? error.message : 'network error';
      yield {
        type: 'error',
        failureClass: 'transient',
        message: `Anthropic messages network error: ${scrubSecrets(raw, [apiKey])}`,
      };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const snippetRaw = scrubSecrets(text.slice(0, 240), [apiKey]);
      const snippet = snippetRaw.length > 0 ? ` — ${snippetRaw}` : '';
      const err = classifyHttpFailure(response.status, snippet);
      yield {
        type: 'error',
        failureClass: err.failureClass,
        message: scrubSecrets(err.message, [apiKey]),
      };
      return;
    }

    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const text = await response.text();
      yield* emitFromJsonMessage(text, apiKey);
      return;
    }

    if (!response.body) {
      const text = await response.text();
      if (text.includes('data:')) {
        yield* emitFromSseText(text, apiKey);
      } else {
        yield* emitFromJsonMessage(text, apiKey);
      }
      return;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const parseState: AnthropicParseState = {
      toolBlocks: new Map(),
      emittedToolIds: new Set(),
      finished: false,
    };

    while (!parseState.finished) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          yield providerAbortEvent(control, 'Anthropic messages call');
          return;
        }
        throw error;
      }
      if (done) break;
      buffer += decoder.decode(value!, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        for (const event of parseSseLine(line, apiKey, parseState)) yield event;
        if (parseState.finished) break;
      }
    }

    if (!parseState.finished) {
      if (buffer.trim().length > 0) {
        for (const event of parseSseLine(buffer, apiKey, parseState)) yield event;
      }
      if (!parseState.finished) {
        for (const event of finishAnthropicStream(parseState)) yield event;
      }
    }
  } finally {
    control.cleanup();
    await closeResponseReader(reader);
  }
}

interface AnthropicToolBlock {
  id: string;
  name: string;
  argumentsJson: string;
  initialInput?: unknown;
}

interface AnthropicParseState {
  toolBlocks: Map<number, AnthropicToolBlock>;
  emittedToolIds: Set<string>;
  stopReason?: string;
  finished: boolean;
}

function parseSseLine(line: string, apiKey: string, state: AnthropicParseState): AdapterEvent[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return [];
  // Anthropic SSE uses both event: and data: lines; we only need data: payloads.
  if (!trimmed.startsWith('data:')) return [];
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') {
    return state.finished ? [] : finishAnthropicStream(state);
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return [];
  }
  return parseAnthropicStreamEvent(json, apiKey, state);
}

function parseAnthropicStreamEvent(
  json: unknown,
  apiKey: string,
  state: AnthropicParseState,
): AdapterEvent[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as {
    type?: string;
    index?: number;
    error?: { message?: string; type?: string };
    delta?: {
      type?: string;
      text?: string;
      partial_json?: string;
      stop_reason?: string | null;
    };
    message?: {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string | null;
    };
    usage?: { input_tokens?: number; output_tokens?: number };
    content_block?: {
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    };
  };

  if (root.type === 'error' || root.error) {
    const msg = scrubSecrets(root.error?.message ?? 'provider error', [apiKey]);
    state.finished = true;
    return [{ type: 'error', failureClass: 'protocol', message: msg }];
  }

  if (root.type === 'content_block_delta' && root.delta?.type === 'text_delta' && root.delta.text) {
    return [{ type: 'text-delta', text: root.delta.text }];
  }

  if (root.type === 'content_block_start' && root.content_block?.type === 'tool_use') {
    const index = Number.isInteger(root.index) ? Number(root.index) : state.toolBlocks.size;
    state.toolBlocks.set(index, {
      id: root.content_block.id ?? `tool-use-${index + 1}`,
      name: root.content_block.name ?? '',
      argumentsJson: '',
      initialInput: root.content_block.input,
    });
    return [];
  }

  if (root.type === 'content_block_delta' && root.delta?.type === 'input_json_delta') {
    const index = Number.isInteger(root.index) ? Number(root.index) : 0;
    const block = state.toolBlocks.get(index);
    if (block) block.argumentsJson += root.delta.partial_json ?? '';
    return [];
  }

  if (root.type === 'content_block_stop') {
    const index = Number.isInteger(root.index) ? Number(root.index) : 0;
    const block = state.toolBlocks.get(index);
    if (!block || !block.name || state.emittedToolIds.has(block.id)) return [];
    state.emittedToolIds.add(block.id);
    return [
      {
        type: 'tool-call',
        toolCall: {
          id: block.id,
          name: block.name,
          argumentsJson:
            block.argumentsJson ||
            (block.initialInput === undefined ? '{}' : JSON.stringify(block.initialInput)),
        },
      },
    ];
  }

  // Some proxies emit OpenAI-like deltas inside Anthropic wrappers — ignore.

  if (root.type === 'message_delta') {
    if (root.delta?.stop_reason) state.stopReason = root.delta.stop_reason;
    if (root.usage) {
      return [
        {
          type: 'usage',
          tokensIn: root.usage.input_tokens ?? 0,
          tokensOut: root.usage.output_tokens ?? 0,
        },
      ];
    }
    // stop_reason arrives on message_delta; finished is emitted on message_stop.
    return [];
  }

  if (root.type === 'message_stop') {
    return finishAnthropicStream(state);
  }

  // Non-stream complete message object
  if (root.type === 'message' && root.message?.content) {
    // handled in emitFromJsonMessage primarily
    return [];
  }

  if (root.usage && root.type === 'message_start') {
    // ignore partial usage
    return [];
  }

  return [];
}

function finishAnthropicStream(state: AnthropicParseState): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  for (const block of state.toolBlocks.values()) {
    if (!block.name || state.emittedToolIds.has(block.id)) continue;
    state.emittedToolIds.add(block.id);
    events.push({
      type: 'tool-call',
      toolCall: {
        id: block.id,
        name: block.name,
        argumentsJson:
          block.argumentsJson ||
          (block.initialInput === undefined ? '{}' : JSON.stringify(block.initialInput)),
      },
    });
  }
  state.finished = true;
  events.push({
    type: 'finished',
    reason:
      state.emittedToolIds.size > 0 || state.stopReason === 'tool_use'
        ? 'tool-requests'
        : state.stopReason === 'max_tokens'
          ? 'length'
          : 'stop',
  });
  return events;
}

async function* emitFromSseText(text: string, apiKey: string): AsyncIterable<AdapterEvent> {
  const state: AnthropicParseState = {
    toolBlocks: new Map(),
    emittedToolIds: new Set(),
    finished: false,
  };
  for (const line of text.split(/\r?\n/)) {
    for (const event of parseSseLine(line, apiKey, state)) yield event;
    if (state.finished) break;
  }
  if (!state.finished) {
    for (const event of finishAnthropicStream(state)) yield event;
  }
}

async function* emitFromJsonMessage(text: string, apiKey: string): AsyncIterable<AdapterEvent> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    yield {
      type: 'error',
      failureClass: 'protocol',
      message: 'Provider returned non-JSON body',
    };
    return;
  }
  const root = json as {
    error?: { message?: string };
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string | null;
  };
  if (root.error) {
    yield {
      type: 'error',
      failureClass: 'protocol',
      message: scrubSecrets(root.error.message ?? 'provider error', [apiKey]),
    };
    return;
  }
  if (root.usage) {
    yield {
      type: 'usage',
      tokensIn: root.usage.input_tokens ?? 0,
      tokensOut: root.usage.output_tokens ?? 0,
    };
  }
  const textParts = (root.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);
  if (textParts.length > 0) {
    yield { type: 'text-delta', text: textParts.join('') };
  }
  const toolUses = (root.content ?? []).filter(
    (block) => block.type === 'tool_use' && typeof block.name === 'string',
  );
  for (const [index, block] of toolUses.entries()) {
    yield {
      type: 'tool-call',
      toolCall: {
        id: block.id ?? `tool-use-${index + 1}`,
        name: block.name!,
        argumentsJson: JSON.stringify(block.input ?? {}),
      },
    };
  }
  yield {
    type: 'finished',
    reason:
      toolUses.length > 0 || root.stop_reason === 'tool_use'
        ? 'tool-requests'
        : root.stop_reason === 'max_tokens'
          ? 'length'
          : 'stop',
  };
}
