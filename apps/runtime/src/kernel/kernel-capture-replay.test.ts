/**
 * Adapter mapping verified against a real captured Claude turn.
 *
 * `claude-2.1.222-partial-capture.jsonl` was captured from the real CLI on
 * 2026-08-14 (see .data/kernel-capture/cc-capture.mjs) and only trimmed for
 * size + session id. Every line in it except the transport-level
 * `control_response` is exactly one `SDKMessage` — the CLI's stream-json output
 * is the serialized form of the same objects the SDK hands to consumers — so
 * the capture keeps proving the mapper against genuine shapes after the
 * migration off the CLI:
 *   stream_event content_block_delta (thinking_delta / input_json_delta / text_delta)
 *   assistant messages (tool_use + usage)
 *   top-level `user` tool_result (string content form)
 *
 * The `control_response` line is dropped here because it belongs to the wire
 * protocol the SDK now owns; it never reaches a consumer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { KernelEvent, KernelRequest } from '@sync-think/shared';
import { ClaudeSdkKernelAdapter } from './claude-sdk-adapter.js';

const capturePath = fileURLToPath(
  new URL('./fixtures/claude-2.1.222-partial-capture.jsonl', import.meta.url),
);

/** Load the capture as the SDKMessage sequence a consumer would observe. */
function loadCapturedMessages(): SDKMessage[] {
  return readFileSync(capturePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { type: string })
    .filter((message) => message.type !== 'control_response')
    .map((message) => message as unknown as SDKMessage);
}

/** Replay a fixed SDKMessage sequence through the SDK's query() seam. */
function replayQuery(messages: SDKMessage[]) {
  return ((params: { options?: Options }) => {
    void params;
    async function* iterate(): AsyncGenerator<SDKMessage, void> {
      for (const message of messages) yield message;
    }
    const iterator = iterate();
    const handle: Partial<Query> = {
      next: () => iterator.next(),
      return: (value?: unknown) => iterator.return(value as never),
      throw: (error?: unknown) => iterator.throw(error),
      [Symbol.asyncIterator]() {
        return this as AsyncGenerator<SDKMessage, void>;
      },
      interrupt: async () => undefined,
      close: () => undefined,
    };
    return handle as Query;
  }) as never;
}

function makeRequest(overrides: Partial<KernelRequest> = {}): KernelRequest {
  return {
    kernelId: 'claude-code',
    model: 'capture-model',
    providerModelId: 'capture-model',
    userText: 'replay the captured turn',
    contextWindow: 200_000,
    effectiveContextWindow: 200_000,
    contextWindowSource: 'configured',
    credential: { reuseLocalLogin: true },
    systemContext: '',
    platformTools: [],
    permissionMode: 'workspace',
    workspaceDir: process.cwd(),
    ...overrides,
  };
}

describe('kernel adapters against real captured CLI streams', () => {
  it('maps claude 2.1.222 partial text, reasoning and the echoed tool_result exactly once', async () => {
    const adapter = new ClaudeSdkKernelAdapter({ query: replayQuery(loadCapturedMessages()) });

    const events: KernelEvent[] = [];
    for await (const event of adapter.start(makeRequest())) {
      events.push(event);
      if (event.type === 'terminal') break;
    }
    await adapter.cancel().catch(() => undefined);

    // Text arrives as stream_event deltas; the whole-message echo must not
    // duplicate it (this run streamed exactly one text delta: "alpha").
    const deltas = events.filter((event) => event.type === 'delta');
    expect(deltas).toEqual([{ type: 'delta', text: 'alpha' }]);

    // Thinking becomes diagnostic reasoning, never chat text.
    const reasoning = events.filter((event) => event.type === 'reasoning');
    expect(reasoning.length).toBeGreaterThan(0);

    // Tool arguments come from the complete assistant message (never partial JSON).
    const toolCall = events.find((event) => event.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolId: 'toolu_VHGuuy3wlJam7wNSw5zWpu',
      name: 'Read',
      partial: false,
    });
    expect(JSON.parse((toolCall as { argsJson: string }).argsJson).file_path).toContain('note.txt');

    // The echoed user tool_result closes the timeline (string content form).
    const toolResult = events.find((event) => event.type === 'tool-result');
    expect(toolResult).toMatchObject({
      type: 'tool-result',
      toolId: 'toolu_VHGuuy3wlJam7wNSw5zWpu',
      isError: false,
    });
    expect((toolResult as { output: string }).output).toContain('alpha');

    expect(events.at(-1)).toMatchObject({ type: 'terminal', status: 'completed' });
  }, 20_000);
});
