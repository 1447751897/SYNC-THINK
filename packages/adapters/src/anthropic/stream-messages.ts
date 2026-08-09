import type { AdapterEvent, ProviderCallRequest, ProviderMessage } from '../types.js';
import { scrubSecrets, normalizeOpenAICompatibleBaseUrl } from '../openai/discover-models.js';
import { anthropicReasoningBodyFields } from '../reasoning.js';
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

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) return null;
  return { mediaType: match[1]!, data: match[2]! };
}

type AnthropicWireMessage = {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
};

function appendAnthropicMessage(
  out: AnthropicWireMessage[],
  message: AnthropicWireMessage,
): void {
  const previous = out.at(-1);
  if (!previous || previous.role !== message.role) {
    out.push(message);
    return;
  }

  const toBlocks = (
    content: AnthropicWireMessage['content'],
  ): Array<Record<string, unknown>> => {
    if (Array.isArray(content)) return content;
    return content ? [{ type: 'text', text: content }] : [];
  };
  previous.content = [...toBlocks(previous.content), ...toBlocks(message.content)];
}

function toAnthropicMessages(
  request: ProviderCallRequest,
): AnthropicWireMessage[] {
  const out: AnthropicWireMessage[] = [];
  for (const message of request.messages) {
    if (message.role === 'system') continue;
    const content = messageContentToString(message);
    if (message.role === 'tool' && message.toolCallId) {
      appendAnthropicMessage(out, {
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
        appendAnthropicMessage(out, { role: 'assistant', content: blocks });
        continue;
      }
    }
    // Multimodal user content (text + images as base64 source).
    if (Array.isArray(message.content) && message.role === 'user') {
      const blocks: Array<Record<string, unknown>> = [];
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          const url = part.imageUrl || part.imageRef || '';
          const parsed = parseDataUrl(url);
          if (parsed) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: parsed.mediaType,
                data: parsed.data,
              },
            });
          } else if (url.startsWith('http://') || url.startsWith('https://')) {
            blocks.push({
              type: 'image',
              source: { type: 'url', url },
            });
          }
        }
      }
      if (blocks.length > 0) {
        appendAnthropicMessage(out, { role: 'user', content: blocks });
        continue;
      }
    }
    if (!content && message.role !== 'assistant') continue;
    appendAnthropicMessage(out, {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }
  // Anthropic requires the conversation to start with a user turn.
  if (out.length === 0) {
    out.push({ role: 'user', content: '' });
  } else if (out[0]!.role !== 'user') {
    out.unshift({ role: 'user', content: '(context)' });
  }
  if (!request.promptCache?.key?.trim()) return out;

  // System and tools consume up to two of Anthropic's four cache breakpoints.
  // Use the remaining two for the latest stable conversation messages and
  // intentionally exclude the changing final user turn.
  for (const message of out.slice(0, -1).slice(-2)) {
    if (typeof message.content === 'string') {
      message.content = [
        {
          type: 'text',
          text: message.content,
          cache_control: { type: 'ephemeral' },
        },
      ];
      continue;
    }
    const block = message.content.at(-1);
    if (block) block.cache_control = { type: 'ephemeral' };
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

  // 推理字段先算出来:extended thinking 的 budget_tokens 必须小于 max_tokens,
  // 否则 Anthropic 会直接 4xx 拒绝。
  const reasoningFields = anthropicReasoningBodyFields(request.reasoningEffort);
  const thinkingBudget =
    typeof (reasoningFields.thinking as { budget_tokens?: number } | undefined)?.budget_tokens ===
    'number'
      ? (reasoningFields.thinking as { budget_tokens: number }).budget_tokens
      : 0;
  // 默认输出上限不能太小:之前的 1024 会让长回复以 stop_reason=max_tokens 截断
  // (表现为回复为空/工具调用被拦腰截断),这里默认 8192 并保证高于 thinking budget。
  const defaultMaxTokens = Math.max(8_192, thinkingBudget + 4_096);
  const body: Record<string, unknown> = {
    model: request.modelId,
    max_tokens: request.maxOutputTokens ?? defaultMaxTokens,
    messages: toAnthropicMessages(request),
    stream: true,
  };
  let systemPrompt: string | undefined;
  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    systemPrompt = request.systemPrompt;
  } else {
    // Promote leading system messages into Anthropic system field if present.
    const systemParts = request.messages
      .filter((m) => m.role === 'system')
      .map(messageContentToString)
      .filter((s) => s.length > 0);
    if (systemParts.length > 0) systemPrompt = systemParts.join('\n\n');
  }
  if (systemPrompt) {
    body.system = request.promptCache?.key?.trim()
      ? [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ]
      : systemPrompt;
  }
  if (request.temperature !== undefined) body.temperature = request.temperature;
  Object.assign(body, reasoningFields);
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    if (request.promptCache?.key?.trim()) {
      const tools = body.tools as Array<Record<string, unknown>>;
      tools[tools.length - 1]!.cache_control = { type: 'ephemeral' };
    }
    if (request.toolChoice) body.tool_choice = { type: request.toolChoice };
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

type AnthropicUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
};

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function mergeAnthropicUsage(
  previous: AnthropicUsage | undefined,
  next: AnthropicUsage,
): AnthropicUsage {
  const merged: AnthropicUsage = { ...(previous ?? {}) };
  for (const key of [
    'input_tokens',
    'output_tokens',
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
  ] as const) {
    const value = nonNegativeNumber(next[key]);
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function toUsageEvent(usage: AnthropicUsage): AdapterEvent {
  const ordinaryInputTokens = nonNegativeNumber(usage.input_tokens) ?? 0;
  const tokensOut = nonNegativeNumber(usage.output_tokens) ?? 0;
  const cachedTokensHit = nonNegativeNumber(usage.cache_read_input_tokens);
  const cachedTokensCreated = nonNegativeNumber(usage.cache_creation_input_tokens);
  const tokensIn = ordinaryInputTokens + (cachedTokensHit ?? 0) + (cachedTokensCreated ?? 0);
  return {
    type: 'usage',
    tokensIn,
    tokensOut,
    ...(cachedTokensHit !== undefined ? { cachedTokensHit } : {}),
    ...(cachedTokensCreated !== undefined ? { cachedTokensCreated } : {}),
    totalTokens: tokensIn + tokensOut,
  };
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
  usage?: AnthropicUsage;
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
      usage?: AnthropicUsage;
      stop_reason?: string | null;
    };
    usage?: AnthropicUsage;
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

  // Extended thinking / reasoning blocks (native Anthropic + compatible proxies).
  if (
    root.type === 'content_block_delta' &&
    (root.delta?.type === 'thinking_delta' || root.delta?.type === 'reasoning_delta') &&
    (typeof root.delta.text === 'string' ||
      typeof (root.delta as { thinking?: string }).thinking === 'string')
  ) {
    const text =
      typeof root.delta.text === 'string'
        ? root.delta.text
        : String((root.delta as { thinking?: string }).thinking ?? '');
    if (text.length > 0) return [{ type: 'reasoning-delta', text }];
  }
  if (
    root.type === 'content_block_start' &&
    (root.content_block?.type === 'thinking' || root.content_block?.type === 'reasoning') &&
    typeof root.content_block.text === 'string' &&
    root.content_block.text.length > 0
  ) {
    return [{ type: 'reasoning-delta', text: root.content_block.text }];
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
    const deltaUsage = root.usage ?? (root.message?.usage as AnthropicUsage | undefined);
    if (deltaUsage) {
      state.usage = mergeAnthropicUsage(state.usage, deltaUsage);
      return [toUsageEvent(state.usage)];
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

  if (root.type === 'message_start') {
    const startUsage = root.usage ?? root.message?.usage;
    if (startUsage) state.usage = mergeAnthropicUsage(state.usage, startUsage);
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
    usage?: AnthropicUsage;
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
    yield toUsageEvent(root.usage);
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
