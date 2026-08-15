import { describe, it, expect } from 'vitest';
import {
  AnthropicStreamEmitter,
  anthropicRequestToOpenAIChat,
  finishReasonToStopReason,
  flattenAnthropicSystem,
  thinkingBudgetToReasoningEffort,
} from './anthropic-to-openai.js';
import type { AnthropicMessagesRequest, OpenAIStreamChunk, SseFrame } from './wire-types.js';

function base(overrides: Partial<AnthropicMessagesRequest> = {}): AnthropicMessagesRequest {
  return {
    model: 'claude-sonnet-4',
    max_tokens: 2048,
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
    ...overrides,
  };
}

/** Decode emitter frames into `{event, payload}` for readable assertions. */
function decode(frames: SseFrame[]): Array<{ event?: string; payload: Record<string, unknown> }> {
  return frames.map((frame) => ({
    ...(frame.event ? { event: frame.event } : {}),
    payload: frame.data === '[DONE]' ? { done: true } : (JSON.parse(frame.data) as Record<string, unknown>),
  }));
}

describe('flattenAnthropicSystem', () => {
  it('accepts strings, block lists and empty values', () => {
    expect(flattenAnthropicSystem('be brief')).toBe('be brief');
    expect(
      flattenAnthropicSystem([
        { type: 'text', text: 'a', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\n\nb');
    expect(flattenAnthropicSystem(undefined)).toBeUndefined();
    expect(flattenAnthropicSystem('')).toBeUndefined();
  });
});

describe('anthropicRequestToOpenAIChat', () => {
  it('hoists system into a system message and targets the resolved model', () => {
    const body = anthropicRequestToOpenAIChat(base({ system: 'be brief' }), {
      targetModel: 'gpt-4o-mini',
    });
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be brief' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_tokens).toBe(2048);
  });

  it('uses max_completion_tokens and drops temperature for gpt-5 / o-series', () => {
    const body = anthropicRequestToOpenAIChat(base({ temperature: 0.7 }), {
      targetModel: 'gpt-5.6-luna',
    });
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();

    const o3 = anthropicRequestToOpenAIChat(base({ temperature: 0.7 }), { targetModel: 'o3-mini' });
    expect(o3.max_completion_tokens).toBe(2048);
    expect(o3.temperature).toBeUndefined();
  });

  it('keeps temperature for ordinary chat models', () => {
    const body = anthropicRequestToOpenAIChat(base({ temperature: 0.3, top_p: 0.9 }), {
      targetModel: 'gpt-4o',
    });
    expect(body.temperature).toBe(0.3);
    expect(body.top_p).toBe(0.9);
  });

  it('converts tool_use blocks into assistant tool_calls', () => {
    const body = anthropicRequestToOpenAIChat(
      base({
        messages: [
          { role: 'user', content: 'read a file' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'sure' },
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.ts' } },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-4o' },
    );
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: 'sure',
      tool_calls: [
        {
          id: 'toolu_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
        },
      ],
    });
  });

  it('lifts tool_result blocks into role:tool messages before remaining user text', () => {
    const body = anthropicRequestToOpenAIChat(
      base({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body' },
              { type: 'text', text: 'now summarize' },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-4o' },
    );
    expect(body.messages).toEqual([
      { role: 'tool', tool_call_id: 'toolu_1', content: 'file body' },
      { role: 'user', content: 'now summarize' },
    ]);
  });

  it('marks error tool results so the model sees the failure', () => {
    const body = anthropicRequestToOpenAIChat(
      base({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_9', content: 'ENOENT', is_error: true },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-4o' },
    );
    expect(body.messages[0]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_9',
      content: 'Error: ENOENT',
    });
  });

  it('turns base64 image blocks into data URLs and keeps remote URLs', () => {
    const body = anthropicRequestToOpenAIChat(
      base({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
              { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-4o' },
    );
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ]);
  });

  it('never replays thinking blocks upstream', () => {
    const body = anthropicRequestToOpenAIChat(
      base({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'private', signature: 'sig' },
              { type: 'text', text: 'answer' },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-4o' },
    );
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'answer' });
    expect(JSON.stringify(body)).not.toContain('private');
  });

  it('translates tool definitions and every tool_choice variant', () => {
    const tools: AnthropicMessagesRequest['tools'] = [
      {
        name: 'read_file',
        description: 'read',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
    const auto = anthropicRequestToOpenAIChat(base({ tools, tool_choice: { type: 'auto' } }), {
      targetModel: 'gpt-4o',
    });
    expect(auto.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'read',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ]);
    expect(auto.tool_choice).toBe('auto');
    expect(
      anthropicRequestToOpenAIChat(base({ tools, tool_choice: { type: 'any' } }), {
        targetModel: 'gpt-4o',
      }).tool_choice,
    ).toBe('required');
    expect(
      anthropicRequestToOpenAIChat(base({ tools, tool_choice: { type: 'none' } }), {
        targetModel: 'gpt-4o',
      }).tool_choice,
    ).toBe('none');
    expect(
      anthropicRequestToOpenAIChat(
        base({ tools, tool_choice: { type: 'tool', name: 'read_file' } }),
        { targetModel: 'gpt-4o' },
      ).tool_choice,
    ).toEqual({ type: 'function', function: { name: 'read_file' } });
  });

  it('maps a thinking budget onto reasoning_effort for reasoning models only', () => {
    expect(thinkingBudgetToReasoningEffort(2_000)).toBe('low');
    expect(thinkingBudgetToReasoningEffort(12_000)).toBe('medium');
    expect(thinkingBudgetToReasoningEffort(30_000)).toBe('high');
    expect(thinkingBudgetToReasoningEffort(undefined)).toBeUndefined();

    const reasoning = anthropicRequestToOpenAIChat(
      base({ thinking: { type: 'enabled', budget_tokens: 20_000 } }),
      { targetModel: 'gpt-5.6-luna' },
    );
    expect(reasoning.reasoning_effort).toBe('high');
    const plain = anthropicRequestToOpenAIChat(
      base({ thinking: { type: 'enabled', budget_tokens: 20_000 } }),
      { targetModel: 'gpt-4o' },
    );
    expect(plain.reasoning_effort).toBeUndefined();
  });

  it('passes stop sequences through and honours stream:false', () => {
    const body = anthropicRequestToOpenAIChat(
      base({ stop_sequences: ['STOP'], stream: false }),
      { targetModel: 'gpt-4o' },
    );
    expect(body.stop).toEqual(['STOP']);
    expect(body.stream).toBe(false);
    expect(body.stream_options).toBeUndefined();
  });
});

describe('finishReasonToStopReason', () => {
  it('maps every finish reason, treating a tool call as tool_use', () => {
    expect(finishReasonToStopReason('tool_calls', true)).toBe('tool_use');
    expect(finishReasonToStopReason('length', false)).toBe('max_tokens');
    expect(finishReasonToStopReason('content_filter', false)).toBe('refusal');
    expect(finishReasonToStopReason('stop', false)).toBe('end_turn');
    // Relays often send finish_reason:'stop' even after emitting tool calls.
    expect(finishReasonToStopReason('stop', true)).toBe('tool_use');
    expect(finishReasonToStopReason(null, false)).toBe('end_turn');
  });
});

describe('AnthropicStreamEmitter', () => {
  const chunk = (partial: Partial<OpenAIStreamChunk>): OpenAIStreamChunk => ({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    model: 'gpt-5.6-luna',
    ...partial,
  });

  it('emits a full text envelope with usage', () => {
    const emitter = new AnthropicStreamEmitter('msg_1', 'gpt-5.6-luna');
    const frames = [
      ...emitter.push(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] })),
      ...emitter.push(chunk({ choices: [{ index: 0, delta: { content: 'He' } }] })),
      ...emitter.push(chunk({ choices: [{ index: 0, delta: { content: 'llo' } }] })),
      ...emitter.push(
        chunk({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } },
        }),
      ),
      ...emitter.finish(),
    ];
    const decoded = decode(frames);
    expect(decoded.map((entry) => entry.event)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect((decoded[0].payload as { message: { id: string } }).message.id).toBe('msg_1');
    expect(decoded[2].payload.delta).toEqual({ type: 'text_delta', text: 'He' });
    expect(decoded[5].payload).toMatchObject({
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4 },
    });
  });

  it('streams tool calls as tool_use blocks with verbatim input_json_delta', () => {
    const emitter = new AnthropicStreamEmitter('msg_2', 'gpt-5.6-luna');
    const frames = [
      ...emitter.push(chunk({ choices: [{ index: 0, delta: { content: 'ok' } }] })),
      ...emitter.push(
        chunk({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '' } },
                ],
              },
            },
          ],
        }),
      ),
      ...emitter.push(
        chunk({
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] } },
          ],
        }),
      ),
      ...emitter.push(
        chunk({
          choices: [
            { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } },
          ],
        }),
      ),
      ...emitter.push(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })),
      ...emitter.finish(),
    ];
    const decoded = decode(frames);
    // Text block (index 0) must be closed before the tool block (index 1) opens.
    const starts = decoded.filter((entry) => entry.event === 'content_block_start');
    expect(starts[0].payload).toMatchObject({ index: 0, content_block: { type: 'text' } });
    expect(starts[1].payload).toMatchObject({
      index: 1,
      content_block: { type: 'tool_use', id: 'call_1', name: 'read_file' },
    });
    const jsonDeltas = decoded.filter(
      (entry) =>
        entry.event === 'content_block_delta' &&
        (entry.payload.delta as { type?: string }).type === 'input_json_delta',
    );
    expect(jsonDeltas.map((entry) => (entry.payload.delta as { partial_json: string }).partial_json)).toEqual([
      '{"pa',
      'th":"a.ts"}',
    ]);
    expect(jsonDeltas.every((entry) => entry.payload.index === 1)).toBe(true);
    const messageDelta = decoded.find((entry) => entry.event === 'message_delta');
    expect((messageDelta?.payload.delta as { stop_reason: string }).stop_reason).toBe('tool_use');
  });

  it('allocates one block per parallel tool call', () => {
    const emitter = new AnthropicStreamEmitter('msg_3', 'gpt-4o');
    const frames = emitter.push(
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'a', arguments: '{}' } },
                { index: 1, id: 'call_b', function: { name: 'b', arguments: '{}' } },
              ],
            },
          },
        ],
      }),
    );
    const starts = decode(frames).filter((entry) => entry.event === 'content_block_start');
    expect(starts.map((entry) => entry.payload.index)).toEqual([0, 1]);
  });

  it('maps reasoning_content to a thinking block', () => {
    const emitter = new AnthropicStreamEmitter('msg_4', 'deepseek-r1');
    const frames = [
      ...emitter.push(chunk({ choices: [{ index: 0, delta: { reasoning_content: 'weighing' } }] })),
      ...emitter.push(chunk({ choices: [{ index: 0, delta: { content: 'answer' } }] })),
    ];
    const decoded = decode(frames);
    const starts = decoded.filter((entry) => entry.event === 'content_block_start');
    expect(starts[0].payload).toMatchObject({ index: 0, content_block: { type: 'thinking' } });
    expect(starts[1].payload).toMatchObject({ index: 1, content_block: { type: 'text' } });
    expect(decoded[2].payload.delta).toEqual({ type: 'thinking_delta', thinking: 'weighing' });
  });

  it('emits message_start once even for an empty upstream stream', () => {
    const emitter = new AnthropicStreamEmitter('msg_5', 'gpt-4o');
    const decoded = decode(emitter.finish());
    expect(decoded.map((entry) => entry.event)).toEqual([
      'message_start',
      'message_delta',
      'message_stop',
    ]);
    expect(emitter.finish()).toEqual([]);
  });

  it('emits an Anthropic error event and then goes silent', () => {
    const emitter = new AnthropicStreamEmitter('msg_6', 'gpt-4o');
    const decoded = decode(emitter.error('upstream 503', 'overloaded_error'));
    expect(decoded[0]).toEqual({
      event: 'error',
      payload: { type: 'error', error: { type: 'overloaded_error', message: 'upstream 503' } },
    });
    expect(emitter.finish()).toEqual([]);
  });
});
