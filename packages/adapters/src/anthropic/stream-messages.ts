import type { AdapterEvent, ProviderCallRequest, ProviderMessage } from '../types.js';
import { scrubSecrets, normalizeOpenAICompatibleBaseUrl } from '../openai/discover-models.js';
import type { FailureClass } from '@sync-think/shared';
import { closeResponseReader, createProviderCallControl, providerAbortEvent } from '../call-control.js';

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

function toAnthropicMessages(
  request: ProviderCallRequest,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of request.messages) {
    if (message.role === 'system' || message.role === 'tool') continue;
    const content = messageContentToString(message);
    if (!content && message.role !== 'assistant') continue;
    out.push({
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
  return out;
}

function classifyHttpFailure(status: number, snippet: string): AnthropicCallError {
  if (status === 401 || status === 403) {
    return new AnthropicCallError(`Provider auth failed (${status})${snippet}`, 'auth', status);
  }
  if (status === 429) {
    return new AnthropicCallError(`Provider rate limited (${status})${snippet}`, 'rate-limit', status);
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
    yield { type: 'error', failureClass: 'auth', message: 'API key is required for Anthropic messages' };
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
    let finished = false;
    let sawDelta = false;

    while (!finished) {
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
  // Anthropic SSE uses both event: and data: lines; we only need data: payloads.
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
  return parseAnthropicStreamEvent(json, apiKey);
}

function parseAnthropicStreamEvent(json: unknown, apiKey: string): AdapterEvent | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const root = json as {
    type?: string;
    error?: { message?: string; type?: string };
    delta?: { type?: string; text?: string; stop_reason?: string | null };
    message?: {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string | null;
    };
    usage?: { input_tokens?: number; output_tokens?: number };
    content_block?: { type?: string; text?: string };
  };

  if (root.type === 'error' || root.error) {
    const msg = scrubSecrets(root.error?.message ?? 'provider error', [apiKey]);
    return { type: 'error', failureClass: 'protocol', message: msg };
  }

  if (root.type === 'content_block_delta' && root.delta?.type === 'text_delta' && root.delta.text) {
    return { type: 'text-delta', text: root.delta.text };
  }

  // Some proxies emit OpenAI-like deltas inside Anthropic wrappers — ignore.

  if (root.type === 'message_delta') {
    if (root.usage) {
      return {
        type: 'usage',
        tokensIn: root.usage.input_tokens ?? 0,
        tokensOut: root.usage.output_tokens ?? 0,
      };
    }
    // stop_reason arrives on message_delta; finished is emitted on message_stop.
    return undefined;
  }

  if (root.type === 'message_stop') {
    return { type: 'finished', reason: 'stop' };
  }

  // Non-stream complete message object
  if (root.type === 'message' && root.message?.content) {
    // handled in emitFromJsonMessage primarily
    return undefined;
  }

  if (root.usage && root.type === 'message_start') {
    // ignore partial usage
    return undefined;
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
    content?: Array<{ type?: string; text?: string }>;
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
  yield {
    type: 'finished',
    reason: root.stop_reason === 'max_tokens' ? 'length' : 'stop',
  };
}
