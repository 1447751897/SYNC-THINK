import type { AdapterEvent, ProviderCallRequest, ProviderMessage } from '../types.js';
import { scrubSecrets, normalizeOpenAICompatibleBaseUrl } from './discover-models.js';
import type { FailureClass } from '@sync-think/shared';
import {
  closeResponseReader,
  createProviderCallControl,
  providerAbortEvent,
} from '../call-control.js';
import { createOpenAIToolNameMap, type OpenAIToolNameMap } from './tool-name-map.js';

export class ProviderCallError extends Error {
  readonly failureClass: FailureClass;
  readonly status?: number;

  constructor(message: string, failureClass: FailureClass, status?: number) {
    super(message);
    this.name = 'ProviderCallError';
    this.failureClass = failureClass;
    this.status = status;
  }
}

export function joinChatCompletionsUrl(baseUrl: string): string {
  let root: string;
  try {
    root = normalizeOpenAICompatibleBaseUrl(baseUrl);
  } catch {
    throw new ProviderCallError('Base URL must not be empty', 'protocol');
  }
  if (/\/chat\/completions$/i.test(root)) return root;
  return `${root}/chat/completions`;
}

function toOpenAIMessages(
  request: ProviderCallRequest,
  toolNames: OpenAIToolNameMap,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    out.push({ role: 'system', content: request.systemPrompt });
  }
  for (const message of request.messages) {
    const content = messageContentToString(message);
    if (message.role === 'tool' && message.toolCallId) {
      out.push({ role: 'tool', tool_call_id: message.toolCallId, content });
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      const toolCalls = message.content
        .filter((part) => part.type === 'tool-call' && part.toolCall)
        .map((part) => ({
          id: part.toolCall!.id,
          type: 'function',
          function: {
            name: toolNames.toWireName(part.toolCall!.name),
            arguments: part.toolCall!.argumentsJson,
          },
        }));
      if (toolCalls.length > 0) {
        out.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
        continue;
      }
    }
    const multimodalContent: Array<Record<string, unknown>> | undefined =
      message.role === 'user' && Array.isArray(message.content)
        ? message.content.reduce<Array<Record<string, unknown>>>((parts, part) => {
            if (part.type === 'text' && part.text) parts.push({ type: 'text', text: part.text });
            if (part.type === 'image' && part.imageUrl) {
              parts.push({ type: 'image_url', image_url: { url: part.imageUrl } });
            }
            return parts;
          }, [])
        : undefined;
    if (!content && !multimodalContent?.length && message.role !== 'assistant') continue;
    out.push({
      role: message.role,
      content: multimodalContent?.length ? multimodalContent : content,
    });
  }
  return out;
}

function messageContentToString(message: ProviderMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}

function classifyHttpFailure(status: number, snippet: string): ProviderCallError {
  if (status === 401 || status === 403) {
    return new ProviderCallError(`Provider auth failed (${status})${snippet}`, 'auth', status);
  }
  if (status === 429) {
    return new ProviderCallError(
      `Provider rate limited (${status})${snippet}`,
      'rate-limit',
      status,
    );
  }
  if (status >= 400 && status < 500) {
    return new ProviderCallError(
      `Provider call rejected (${status})${snippet}`,
      'protocol',
      status,
    );
  }
  return new ProviderCallError(`Provider call failed (${status})${snippet}`, 'transient', status);
}

export interface StreamOpenAIChatOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Stream OpenAI-compatible Chat Completions (SSE).
 * Yields unified AdapterEvent values; never yields plaintext secrets.
 */
export async function* streamOpenAIChatCompletions(
  request: ProviderCallRequest,
  options: StreamOpenAIChatOptions = {},
): AsyncIterable<AdapterEvent> {
  const apiKey = request.apiKey;
  if (!apiKey || apiKey.trim().length === 0) {
    yield {
      type: 'error',
      failureClass: 'auth',
      message: 'API key is required for chat completion',
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

  const url = joinChatCompletionsUrl(request.baseUrl);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const control = createProviderCallControl(request.signal, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const toolNames = createOpenAIToolNameMap(request);

  const body = {
    model: request.modelId,
    messages: toOpenAIMessages(request, toolNames),
    stream: true,
    ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: 'function',
            function: {
              name: toolNames.toWireName(tool.name),
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
        }
      : {}),
  };

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: control.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield providerAbortEvent(control, 'Provider chat call');
        return;
      }
      const raw = error instanceof Error ? error.message : 'network error';
      yield {
        type: 'error',
        failureClass: 'transient',
        message: `Provider chat network error: ${scrubSecrets(raw, [apiKey])}`,
      };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const snippetRaw = scrubSecrets(text.slice(0, 240), [apiKey]);
      const snippet = snippetRaw.length > 0 ? ` ? ${snippetRaw}` : '';
      const err = classifyHttpFailure(response.status, snippet);
      yield {
        type: 'error',
        failureClass: err.failureClass,
        message: scrubSecrets(err.message, [apiKey]),
      };
      return;
    }

    // Non-stream JSON fallback (some gateways ignore stream:true).
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      const text = await response.text();
      yield* emitFromJsonCompletion(text, apiKey, toolNames);
      return;
    }

    if (!response.body) {
      // Node fetch may expose body as ReadableStream; if missing, try text parse.
      const text = await response.text();
      if (text.includes('data:')) {
        yield* emitFromSseText(text, apiKey, toolNames);
      } else {
        yield* emitFromJsonCompletion(text, apiKey, toolNames);
      }
      return;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const parseState: ChatParseState = {
      toolCalls: new Map(),
      emitted: new Set(),
      finished: false,
    };

    while (!parseState.finished) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          yield providerAbortEvent(control, 'Provider chat call');
          return;
        }
        throw error;
      }
      if (done) break;
      buffer += decoder.decode(value!, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        for (const event of parseSseLine(line, apiKey, parseState)) {
          yield toolNames.restoreEvent(event);
        }
        if (parseState.finished) break;
      }
    }

    if (!parseState.finished) {
      // Flush remaining buffer.
      if (buffer.trim().length > 0) {
        for (const event of parseSseLine(buffer, apiKey, parseState)) {
          yield toolNames.restoreEvent(event);
        }
      }
      if (!parseState.finished) {
        for (const event of finishChatStream(parseState, 'stop')) {
          yield toolNames.restoreEvent(event);
        }
      }
    }
  } finally {
    control.cleanup();
    await closeResponseReader(reader);
  }
}

type ChatToolCall = Extract<AdapterEvent, { type: 'tool-call' }>['toolCall'];

interface ChatParseState {
  toolCalls: Map<number, ChatToolCall>;
  emitted: Set<string>;
  finished: boolean;
}

function parseSseLine(line: string, apiKey: string, state: ChatParseState): AdapterEvent[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return [];
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') {
    return state.finished
      ? []
      : finishChatStream(state, state.toolCalls.size > 0 ? 'tool-requests' : 'stop');
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return [];
  }
  return parseCompletionChunk(json, apiKey, state);
}

function parseCompletionChunk(
  json: unknown,
  apiKey: string,
  state: ChatParseState,
): AdapterEvent[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as {
    error?: { message?: string; type?: string };
    choices?: Array<{
      delta?: {
        content?: string | null;
        role?: string;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  if (root.error) {
    const msg = scrubSecrets(root.error.message ?? 'provider error', [apiKey]);
    state.finished = true;
    return [{ type: 'error', failureClass: 'protocol', message: msg }];
  }

  if (root.usage) {
    return [
      {
        type: 'usage',
        tokensIn: root.usage.prompt_tokens ?? 0,
        tokensOut: root.usage.completion_tokens ?? 0,
      },
    ];
  }

  const choice = root.choices?.[0];
  if (!choice) return [];
  for (const part of choice.delta?.tool_calls ?? []) {
    const index = Number.isInteger(part.index) ? Number(part.index) : state.toolCalls.size;
    const previous = state.toolCalls.get(index) ?? {
      id: part.id ?? `tool-call-${index + 1}`,
      name: '',
      argumentsJson: '',
    };
    state.toolCalls.set(index, {
      id: part.id ?? previous.id,
      name: `${previous.name}${part.function?.name ?? ''}`,
      argumentsJson: `${previous.argumentsJson}${part.function?.arguments ?? ''}`,
    });
  }
  for (const [index, part] of (choice.message?.tool_calls ?? []).entries()) {
    state.toolCalls.set(index, {
      id: part.id ?? `tool-call-${index + 1}`,
      name: part.function?.name ?? '',
      argumentsJson: part.function?.arguments ?? '{}',
    });
  }

  const deltaText = choice.delta?.content;
  if (typeof deltaText === 'string' && deltaText.length > 0) {
    return [{ type: 'text-delta', text: deltaText }];
  }

  // Non-delta message content (some proxies).
  const messageText = choice.message?.content;
  if (typeof messageText === 'string' && messageText.length > 0) {
    return [{ type: 'text-delta', text: messageText }];
  }

  if (choice.finish_reason) {
    const reason =
      choice.finish_reason === 'length'
        ? 'length'
        : choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call'
          ? 'tool-requests'
          : 'stop';
    return finishChatStream(state, reason);
  }

  return [];
}

function finishChatStream(
  state: ChatParseState,
  reason: 'stop' | 'length' | 'tool-requests',
): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  for (const call of [...state.toolCalls.values()]) {
    if (state.emitted.has(call.id) || !call.name) continue;
    state.emitted.add(call.id);
    events.push({
      type: 'tool-call',
      toolCall: { ...call, argumentsJson: call.argumentsJson || '{}' },
    });
  }
  state.finished = true;
  events.push({ type: 'finished', reason: state.emitted.size > 0 ? 'tool-requests' : reason });
  return events;
}

async function* emitFromSseText(
  text: string,
  apiKey: string,
  toolNames: OpenAIToolNameMap,
): AsyncIterable<AdapterEvent> {
  const state: ChatParseState = { toolCalls: new Map(), emitted: new Set(), finished: false };
  for (const line of text.split(/\r?\n/)) {
    for (const event of parseSseLine(line, apiKey, state)) yield toolNames.restoreEvent(event);
    if (state.finished) break;
  }
  if (!state.finished) {
    for (const event of finishChatStream(state, 'stop')) yield toolNames.restoreEvent(event);
  }
}

async function* emitFromJsonCompletion(
  text: string,
  apiKey: string,
  toolNames: OpenAIToolNameMap,
): AsyncIterable<AdapterEvent> {
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
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
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
      tokensIn: root.usage.prompt_tokens ?? 0,
      tokensOut: root.usage.completion_tokens ?? 0,
    };
  }
  const content = root.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.length > 0) {
    yield { type: 'text-delta', text: content };
  }
  const toolCalls = root.choices?.[0]?.message?.tool_calls ?? [];
  for (const [index, call] of toolCalls.entries()) {
    if (!call.function?.name) continue;
    yield toolNames.restoreEvent({
      type: 'tool-call',
      toolCall: {
        id: call.id ?? `tool-call-${index + 1}`,
        name: call.function.name,
        argumentsJson: call.function.arguments ?? '{}',
      },
    });
  }
  const finish = root.choices?.[0]?.finish_reason;
  yield {
    type: 'finished',
    reason:
      toolCalls.length > 0 || finish === 'tool_calls' || finish === 'function_call'
        ? 'tool-requests'
        : finish === 'length'
          ? 'length'
          : 'stop',
  };
}
