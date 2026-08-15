/**
 * Incremental SSE reader shared by both gateway translators.
 *
 * The gateway is a *proxy*: it reads an upstream SSE body and re-emits a
 * translated SSE body, so it needs a parser that survives arbitrary chunk
 * boundaries (a `data:` line can be split mid-token) and tolerates both
 * dialects — Anthropic sends `event:` + `data:` pairs, OpenAI sends bare
 * `data:` lines terminated by `[DONE]`.
 */

/** One parsed SSE message (comment/heartbeat lines are dropped). */
export interface SseMessage {
  event?: string;
  data: string;
}

export class SseLineReader {
  private buffer = '';
  private pendingEvent: string | undefined;
  private pendingData: string[] = [];

  /** Feed a decoded chunk; returns every complete message it contains. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];
    // Normalize CRLF so a \r\n\r\n boundary is treated like \n\n.
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      const rawLine = this.buffer.slice(0, index).replace(/\r$/, '');
      this.buffer = this.buffer.slice(index + 1);
      const message = this.consumeLine(rawLine);
      if (message) out.push(message);
      index = this.buffer.indexOf('\n');
    }
    return out;
  }

  /**
   * Flush a trailing message the upstream ended without a blank line after.
   * Real providers terminate properly, but relay stations often do not.
   */
  flush(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buffer.length > 0) {
      const message = this.consumeLine(this.buffer.replace(/\r$/, ''));
      this.buffer = '';
      if (message) out.push(message);
    }
    const tail = this.finishMessage();
    if (tail) out.push(tail);
    return out;
  }

  private consumeLine(line: string): SseMessage | undefined {
    if (line === '') return this.finishMessage();
    // `:` prefix = comment / heartbeat.
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      this.pendingEvent = value;
      return undefined;
    }
    if (field === 'data') {
      this.pendingData.push(value);
      return undefined;
    }
    // id / retry / unknown fields are irrelevant to translation.
    return undefined;
  }

  private finishMessage(): SseMessage | undefined {
    if (this.pendingData.length === 0 && this.pendingEvent === undefined) return undefined;
    const data = this.pendingData.join('\n');
    const event = this.pendingEvent;
    this.pendingEvent = undefined;
    this.pendingData = [];
    if (data === '') return undefined;
    return event === undefined ? { data } : { event, data };
  }
}

/** Parse an SSE payload as JSON; returns undefined for `[DONE]` / malformed. */
export function parseSseJson<T = Record<string, unknown>>(data: string): T | undefined {
  const trimmed = data.trim();
  if (trimmed === '' || trimmed === '[DONE]') return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return undefined;
  }
}
