import type { AdapterEvent, ProviderCallRequest, ProviderMessage } from '../types.js';
import { scrubSecrets, normalizeOpenAICompatibleBaseUrl } from './discover-models.js';
import type { FailureClass } from '@sync-think/shared';
import { closeResponseReader, createProviderCallControl, providerAbortEvent } from '../call-control.js';

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

function toOpenAIMessages(request: ProviderCallRequest): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  if (request.systemPrompt && request.systemPrompt.trim().length > 0) {
    out.push({ role: 'system', content: request.systemPrompt });
  }
  for (const message of request.messages) {
    const content = messageContentToString(message);
    if (!content && message.role !== 'assistant') continue;
    out.push({
      role: message.role === 'tool' ? 'tool' : message.role,
      content,
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
    return new ProviderCallError(`Provider rate limited (${status})${snippet}`, 'rate-limit', status);
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
    yield { type: 'error', failureClass: 'auth', message: 'API key is required for chat completion' };
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
    yield { type: 'error', failureClass: 'protocol', message: 'Fetch is not available in this runtime' };
    return;
  }

  const url = joinChatCompletionsUrl(request.baseUrl);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const control = createProviderCallControl(request.signal, timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const body = {
    model: request.modelId,
    messages: toOpenAIMessages(request),
    stream: true,
    ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
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
      yield* emitFromJsonCompletion(text, apiKey);
      return;
    }

    if (!response.body) {
      // Node fetch may expose body as ReadableStream; if missing, try text parse.
      const text = await response.text();
      if (text.includes('data:')) {
        yield* emitFromSseText(text, apiKey);
      } else {
        yield* emitFromJsonCompletion(text, apiKey);
      }
      return;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    let sawDelta = false;

    while (!finished) {
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
        const event = parseSseLine(line, apiKey);
        if (!event) continue;
        if (event.type === 'text-delta') sawDelta = true;
        yield event;
        if (event.type === 'finished' || event.type === 'error') {
          finished = true;
          break;
        }
      }
    }

    if (!finished) {
      // Flush remaining buffer.
      if (buffer.trim().length > 0) {
        const event = parseSseLine(buffer, apiKey);
        if (event) {
          if (event.type === 'text-delta') sawDelta = true;
          yield event;
          if (event.type === 'finished' || event.type === 'error') finished = true;
        }
      }
      if (!finished) {
        yield { type: 'finished', reason: sawDelta ? 'stop' : 'stop' };
      }
    }
  } finally {
    control.cleanup();
    await closeResponseReader(reader);
  }
}

function parseSseLine(line: string, apiKey: string): AdapterEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return undefined;
  if (!trimmed.startsWith('data:')) return undefined;
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') {
    return { type: 'finished', reason: 'stop' };
  }
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  return parseCompletionChunk(json, apiKey);
}

function parseCompletionChunk(json: unknown, apiKey: string): AdapterEvent | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const root = json as {
    error?: { message?: string; type?: string };
    choices?: Array<{
      delta?: { content?: string | null; role?: string };
      message?: { content?: string | null };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  if (root.error) {
    const msg = scrubSecrets(root.error.message ?? 'provider error', [apiKey]);
    return { type: 'error', failureClass: 'protocol', message: msg };
  }

  if (root.usage) {
    return {
      type: 'usage',
      tokensIn: root.usage.prompt_tokens ?? 0,
      tokensOut: root.usage.completion_tokens ?? 0,
    };
  }

  const choice = root.choices?.[0];
  if (!choice) return undefined;

  const deltaText = choice.delta?.content;
  if (typeof deltaText === 'string' && deltaText.length > 0) {
    return { type: 'text-delta', text: deltaText };
  }

  // Non-delta message content (some proxies).
  const messageText = choice.message?.content;
  if (typeof messageText === 'string' && messageText.length > 0) {
    return { type: 'text-delta', text: messageText };
  }

  if (choice.finish_reason) {
    const reason =
      choice.finish_reason === 'length'
        ? 'length'
        : choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call'
          ? 'tool-requests'
          : 'stop';
    return { type: 'finished', reason };
  }

  return undefined;
}

async function* emitFromSseText(text: string, apiKey: string): AsyncIterable<AdapterEvent> {
  let sawFinish = false;
  for (const line of text.split(/\r?\n/)) {
    const event = parseSseLine(line, apiKey);
    if (!event) continue;
    yield event;
    if (event.type === 'finished' || event.type === 'error') {
      sawFinish = true;
      break;
    }
  }
  if (!sawFinish) yield { type: 'finished', reason: 'stop' };
}

async function* emitFromJsonCompletion(text: string, apiKey: string): AsyncIterable<AdapterEvent> {
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
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
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
  const finish = root.choices?.[0]?.finish_reason;
  yield {
    type: 'finished',
    reason: finish === 'length' ? 'length' : 'stop',
  };
}

