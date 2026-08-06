import type {
  AdapterEvent,
  ProviderCallRequest,
  ProviderMessage,
  ProviderToolCall,
} from '../types.js';
import { normalizeOpenAICompatibleBaseUrl, scrubSecrets } from './discover-models.js';
import {
  normalizeReasoningEffort,
  shouldOmitReasoningEffort,
  wireReasoningEffort,
} from '../reasoning.js';
import {
  closeResponseReader,
  createProviderCallControl,
  providerAbortEvent,
} from '../call-control.js';
import { openAIPromptCacheBodyFields } from './prompt-cache.js';

export interface StreamOpenAIResponsesOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ResponsesParseState {
  sawTextDelta: boolean;
  finished: boolean;
  emittedToolCallIds: Set<string>;
}

export function joinResponsesUrl(baseUrl: string): string {
  const root = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (/\/responses$/i.test(root)) return root;
  return `${root}/responses`;
}

function messageContentToString(message: ProviderMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}

function toResponsesInput(request: ProviderCallRequest): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [];
  for (const message of request.messages) {
    const content = messageContentToString(message);
    if (message.role === 'system') continue;
    if (message.role === 'tool' && message.toolCallId) {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: content,
      });
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type !== 'tool-call' || !part.toolCall) continue;
        input.push({
          type: 'function_call',
          call_id: part.toolCall.id,
          name: part.toolCall.name,
          arguments: part.toolCall.argumentsJson,
        });
      }
      if (!content) continue;
    }
    if (message.role === 'user' && Array.isArray(message.content)) {
      const parts: Array<Record<string, unknown>> = [];
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          parts.push({ type: 'input_text', text: part.text });
        } else if (part.type === 'image') {
          const imageUrl = part.imageUrl || part.imageRef;
          if (imageUrl) parts.push({ type: 'input_image', image_url: imageUrl });
        }
      }
      if (parts.length > 0) {
        input.push({ role: 'user', content: parts });
        continue;
      }
    }
    if (!content && message.role !== 'assistant') continue;
    input.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
    });
  }
  return input;
}

function resolveInstructions(request: ProviderCallRequest): string | undefined {
  const sections = [request.systemPrompt?.trim() ?? ''];
  for (const message of request.messages) {
    if (message.role !== 'system') continue;
    const content = messageContentToString(message).trim();
    if (content) sections.push(content);
  }
  const instructions = sections.filter(Boolean).join('\n\n');
  return instructions || undefined;
}

function classifyHttpFailure(
  status: number,
  snippet: string,
): Extract<AdapterEvent, { type: 'error' }> {
  if (status === 401 || status === 403) {
    return {
      type: 'error',
      failureClass: 'auth',
      message: `Provider auth failed (${status})${snippet}`,
    };
  }
  if (status === 429) {
    return {
      type: 'error',
      failureClass: 'rate-limit',
      message: `Provider rate limited (${status})${snippet}`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      type: 'error',
      failureClass: 'protocol',
      message: `Provider Responses call rejected (${status})${snippet}`,
    };
  }
  return {
    type: 'error',
    failureClass: 'transient',
    message: `Provider Responses call failed (${status})${snippet}`,
  };
}

function responseErrorEvent(
  value: unknown,
  apiKey: string,
): Extract<AdapterEvent, { type: 'error' }> {
  const error =
    value && typeof value === 'object'
      ? (value as { error?: { message?: unknown; code?: unknown }; message?: unknown }).error
      : undefined;
  const rawMessage =
    typeof error?.message === 'string'
      ? error.message
      : value &&
          typeof value === 'object' &&
          typeof (value as { message?: unknown }).message === 'string'
        ? String((value as { message: string }).message)
        : 'Provider Responses error';
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const lower = rawMessage.toLowerCase();
  const failureClass = /rate.?limit|quota|429/.test(`${code} ${lower}`)
    ? 'rate-limit'
    : /auth|api.?key|unauthorized|forbidden|401|403/.test(`${code} ${lower}`)
      ? 'auth'
      : 'protocol';
  return {
    type: 'error',
    failureClass,
    message: scrubSecrets(rawMessage, [apiKey]),
  };
}

function extractOutputText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const typed = part as { type?: unknown; text?: unknown };
      if (
        (typed.type === 'output_text' || typed.type === 'text') &&
        typeof typed.text === 'string'
      ) {
        parts.push(typed.text);
      }
    }
  }
  return parts.join('');
}

function extractToolCalls(response: unknown): ProviderToolCall[] {
  if (!response || typeof response !== 'object') return [];
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return [];
  const calls: ProviderToolCall[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const typed = item as {
      type?: unknown;
      id?: unknown;
      call_id?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (typed.type !== 'function_call' || typeof typed.name !== 'string') continue;
    const id =
      typeof typed.call_id === 'string'
        ? typed.call_id
        : typeof typed.id === 'string'
          ? typed.id
          : `call-${calls.length + 1}`;
    calls.push({
      id,
      name: typed.name,
      argumentsJson: typeof typed.arguments === 'string' ? typed.arguments : '{}',
    });
  }
  return calls;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageEvent(response: unknown): AdapterEvent | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const usage = (response as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const typed = usage as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens_details?: {
      cached_tokens?: unknown;
      cache_write_tokens?: unknown;
    };
    output_tokens_details?: { reasoning_tokens?: unknown };
  };
  const cachedTokensHit = nonNegativeNumber(typed.input_tokens_details?.cached_tokens);
  const cachedTokensCreated = nonNegativeNumber(typed.input_tokens_details?.cache_write_tokens);
  const reasoningTokens = nonNegativeNumber(typed.output_tokens_details?.reasoning_tokens);
  const totalTokens = nonNegativeNumber(typed.total_tokens);
  return {
    type: 'usage',
    tokensIn: nonNegativeNumber(typed.input_tokens) ?? 0,
    tokensOut: nonNegativeNumber(typed.output_tokens) ?? 0,
    ...(cachedTokensHit !== undefined ? { cachedTokensHit } : {}),
    ...(cachedTokensCreated !== undefined ? { cachedTokensCreated } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function parseResponseEvent(
  value: unknown,
  apiKey: string,
  state: ResponsesParseState,
): AdapterEvent[] {
  if (!value || typeof value !== 'object') return [];
  const root = value as {
    type?: unknown;
    delta?: unknown;
    text?: unknown;
    response?: unknown;
    item?: unknown;
    name?: unknown;
    arguments?: unknown;
    call_id?: unknown;
    id?: unknown;
    error?: unknown;
    choices?: Array<{
      delta?: { content?: unknown };
      finish_reason?: unknown;
    }>;
  };

  if (root.error || root.type === 'error' || root.type === 'response.failed') {
    state.finished = true;
    return [responseErrorEvent(root.response ?? root, apiKey)];
  }

  if (
    root.type === 'response.reasoning_summary_text.delta' ||
    root.type === 'response.reasoning.delta' ||
    root.type === 'response.reasoning_text.delta'
  ) {
    if (typeof root.delta !== 'string' || root.delta.length === 0) return [];
    return [{ type: 'reasoning-delta', text: root.delta }];
  }

  if (root.type === 'response.output_text.delta' || root.type === 'response.refusal.delta') {
    if (typeof root.delta !== 'string' || root.delta.length === 0) return [];
    state.sawTextDelta = true;
    return [{ type: 'text-delta', text: root.delta }];
  }

  if (root.type === 'response.output_text.done') {
    if (state.sawTextDelta || typeof root.text !== 'string' || root.text.length === 0) return [];
    state.sawTextDelta = true;
    return [{ type: 'text-delta', text: root.text }];
  }

  if (root.type === 'response.function_call_arguments.done') {
    const id =
      typeof root.call_id === 'string'
        ? root.call_id
        : typeof root.id === 'string'
          ? root.id
          : 'function-call';
    if (state.emittedToolCallIds.has(id) || typeof root.name !== 'string') return [];
    state.emittedToolCallIds.add(id);
    return [
      {
        type: 'tool-call',
        toolCall: {
          id,
          name: root.name,
          argumentsJson: typeof root.arguments === 'string' ? root.arguments : '{}',
        },
      },
    ];
  }

  if (root.type === 'response.completed' || root.type === 'response.incomplete') {
    const response = root.response ?? root;
    const events: AdapterEvent[] = [];
    if (!state.sawTextDelta) {
      const text = extractOutputText(response);
      if (text) {
        state.sawTextDelta = true;
        events.push({ type: 'text-delta', text });
      }
    }
    for (const toolCall of extractToolCalls(response)) {
      if (state.emittedToolCallIds.has(toolCall.id)) continue;
      state.emittedToolCallIds.add(toolCall.id);
      events.push({ type: 'tool-call', toolCall });
    }
    const usage = usageEvent(response);
    if (usage) events.push(usage);
    state.finished = true;
    events.push({
      type: 'finished',
      reason:
        state.emittedToolCallIds.size > 0
          ? 'tool-requests'
          : root.type === 'response.incomplete'
            ? 'length'
            : 'stop',
    });
    return events;
  }

  // Compatibility for gateways that emit Chat Completions chunks at /responses.
  const choice = root.choices?.[0];
  if (choice) {
    const content = choice.delta?.content;
    if (typeof content === 'string' && content.length > 0) {
      state.sawTextDelta = true;
      return [{ type: 'text-delta', text: content }];
    }
    if (choice.finish_reason) {
      state.finished = true;
      return [
        {
          type: 'finished',
          reason: choice.finish_reason === 'length' ? 'length' : 'stop',
        },
      ];
    }
  }

  return [];
}

async function* emitFromJsonResponse(text: string, apiKey: string): AsyncIterable<AdapterEvent> {
  let response: unknown;
  try {
    response = JSON.parse(text);
  } catch {
    yield { type: 'error', failureClass: 'protocol', message: 'Provider returned non-JSON body' };
    return;
  }
  if (response && typeof response === 'object' && 'error' in response) {
    yield responseErrorEvent(response, apiKey);
    return;
  }
  const outputText = extractOutputText(response);
  if (outputText) yield { type: 'text-delta', text: outputText };
  const toolCalls = extractToolCalls(response);
  for (const toolCall of toolCalls) yield { type: 'tool-call', toolCall };
  const usage = usageEvent(response);
  if (usage) yield usage;
  const status =
    response && typeof response === 'object'
      ? (response as { status?: unknown }).status
      : undefined;
  yield {
    type: 'finished',
    reason: toolCalls.length > 0 ? 'tool-requests' : status === 'incomplete' ? 'length' : 'stop',
  };
}

export async function* streamOpenAIResponses(
  request: ProviderCallRequest,
  options: StreamOpenAIResponsesOptions = {},
): AsyncIterable<AdapterEvent> {
  const apiKey = request.apiKey;
  if (!apiKey?.trim()) {
    yield { type: 'error', failureClass: 'auth', message: 'API key is required for Responses' };
    return;
  }
  if (!request.modelId?.trim()) {
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

  const control = createProviderCallControl(request.signal, options.timeoutMs ?? 120_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const instructions = resolveInstructions(request);
  const input = toResponsesInput(request);
  const body: Record<string, unknown> = {
    model: request.modelId,
    input,
    stream: true,
    ...openAIPromptCacheBodyFields(request),
  };
  if (instructions) body.instructions = instructions;
  if (request.maxOutputTokens !== undefined) body.max_output_tokens = request.maxOutputTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  // Responses API uses nested `reasoning` config (o-series / gpt-5); the flat
  // chat-completions style `reasoning_effort` / `enable_thinking` is rejected.
  {
    const level = normalizeReasoningEffort(request.reasoningEffort);
    if (level && !shouldOmitReasoningEffort(level)) {
      body.reasoning = {
        effort: wireReasoningEffort(level),
        summary: 'auto',
      };
    }
  }
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
    if (request.toolChoice) body.tool_choice = request.toolChoice;
  }

  try {
    let response: Response;
    try {
      response = await fetchImpl(joinResponsesUrl(request.baseUrl), {
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
        yield providerAbortEvent(control, 'Provider Responses call');
        return;
      }
      const raw = error instanceof Error ? error.message : 'network error';
      yield {
        type: 'error',
        failureClass: 'transient',
        message: `Provider Responses network error: ${scrubSecrets(raw, [apiKey])}`,
      };
      return;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const scrubbed = scrubSecrets(text.slice(0, 240), [apiKey]);
      const snippet = scrubbed ? ` - ${scrubbed}` : '';
      const error = classifyHttpFailure(response.status, snippet);
      yield { ...error, message: scrubSecrets(error.message, [apiKey]) };
      return;
    }

    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('application/json') && !contentType.includes('text/event-stream')) {
      yield* emitFromJsonResponse(await response.text(), apiKey);
      return;
    }

    if (!response.body) {
      const text = await response.text();
      if (!text.includes('data:')) {
        yield* emitFromJsonResponse(text, apiKey);
        return;
      }
      const state: ResponsesParseState = {
        sawTextDelta: false,
        finished: false,
        emittedToolCallIds: new Set(),
      };
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          for (const event of parseResponseEvent(JSON.parse(data), apiKey, state)) yield event;
        } catch {
          // Ignore malformed keepalive/event fragments.
        }
      }
      if (!state.finished) yield { type: 'finished', reason: 'stop' };
      return;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponsesParseState = {
      sawTextDelta: false,
      finished: false,
      emittedToolCallIds: new Set(),
    };
    let buffer = '';
    while (!state.finished) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          yield providerAbortEvent(control, 'Provider Responses call');
          return;
        }
        throw error;
      }
      if (done) break;
      buffer += decoder.decode(value!, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') {
          state.finished = true;
          yield { type: 'finished', reason: 'stop' };
          break;
        }
        try {
          for (const event of parseResponseEvent(JSON.parse(data), apiKey, state)) yield event;
        } catch {
          // Ignore malformed keepalive/event fragments.
        }
        if (state.finished) break;
      }
    }
    if (!state.finished) {
      const remaining = buffer.trim();
      if (remaining.startsWith('data:')) {
        const data = remaining.slice(5).trim();
        if (data && data !== '[DONE]') {
          try {
            for (const event of parseResponseEvent(JSON.parse(data), apiKey, state)) yield event;
          } catch {
            // Ignore malformed tail.
          }
        }
      }
    }
    if (!state.finished) yield { type: 'finished', reason: 'stop' };
  } finally {
    control.cleanup();
    await closeResponseReader(reader);
  }
}
