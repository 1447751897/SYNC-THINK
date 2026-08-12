import type { ProviderAdapter, ProviderCallRequest, AdapterEvent, FailureClass } from '../types.js';

// FakeProvider — Phase 0 stand-in. Tests + demo M0 (design plan §3 / §M0.3).
// Streams deterministic text from a seed built from the request. Supports a
// `__fake.secret` injection probe for the secret-leak security test.

export interface FakeProviderOptions {
  /** Stream chunk (in words) per emitted text-delta. Defaults to 4. */
  chunksPerWord?: number;
  /** Inject a deterministic delay (ms) to mimic provider latency. */
  tickMs?: number;
  /** Fail after N events to test error classification logic. */
  failAfter?: number;
}

export class FakeProvider implements ProviderAdapter {
  readonly protocol = 'openai-chat' as const;

  constructor(private readonly opts: FakeProviderOptions = {}) {}

  async discoverModels(_apiKey?: string, _baseUrl?: string): Promise<string[]> {
    return ['fake-mini', 'fake-large', 'fake-tool-use'];
  }

  async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const { chunksPerWord = 4, tickMs = 0, failAfter } = this.opts;

    const lastUserText = lastUserString(request);
    const synthesized = synthesizeResponse(lastUserText, request.modelId);
    const words = synthesized.split(' ');

    // Emit a usage record up front (Phase 0 convention).
    yield { type: 'usage', tokensIn: request.systemPrompt?.length ?? 0, tokensOut: words.length };

    let eventCount = 0;
    for (let i = 0; i < words.length; i += chunksPerWord) {
      if (request.signal.aborted) {
        yield fakeAbortEvent();
        return;
      }
      const chunk = words.slice(i, i + chunksPerWord).join(' ') + ' ';
      eventCount++;
      if (failAfter !== undefined && eventCount > failAfter) {
        yield {
          type: 'error',
          failureClass: 'transient' as FailureClass,
          message: 'simulated failAfter reached',
        };
        return;
      }
      yield { type: 'text-delta', text: chunk };
      if (tickMs > 0) await interruptibleSleep(tickMs, request.signal);
    }

    if (request.signal.aborted) {
      yield fakeAbortEvent();
      return;
    }

    // Tool-use emulation: when the user typed "TOOL:..." the fake emits a call
    // plus stub result, then finishes with reason 'tool-requests'.
    if (/^TOOL:/.test(lastUserText)) {
      const toolName = 'get_weather';
      const args = { q: lastUserText.replace(/^TOOL:/, '') };
      yield {
        type: 'tool-call',
        toolCall: {
          id: 'tc-' + Math.random().toString(36).slice(2, 8),
          name: toolName,
          argumentsJson: JSON.stringify(args),
        },
      };
      yield { type: 'tool-result', toolCallId: 'tc-stub-1', result: '{"tempC": 18, "city": "Beijing"}' };
      yield { type: 'finished', reason: 'tool-requests' };
      return;
    }
    yield { type: 'finished', reason: 'stop' };
  }
}

function lastUserString(request: ProviderCallRequest): string {
  const m = [...request.messages].reverse().find((mm) => mm.role === 'user');
  if (!m) return '';
  if (typeof m.content === 'string') return m.content;
  return m.content
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join(' ');
}

function synthesizeResponse(userText: string, modelId: string): string {
  const head = `[${modelId}] `;
  if (!userText) return `${head}Hello — fake provider online.`;
  if (/^TOOL:/.test(userText)) return `${head}I will call the tool now.`;
  return `${head}Echo from fake provider: ${userText}`;
}

/**
 * Abort-aware sleep. Mirrors the real adapters' contract (call-control.ts):
 * an aborted request must terminate promptly instead of running to completion.
 */
function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Mirrors real adapters' abort event shape (call-control.providerAbortEvent). */
function fakeAbortEvent(): Extract<AdapterEvent, { type: 'error' }> {
  return { type: 'error', failureClass: 'acceptance', message: 'Provider fake call aborted' };
}
