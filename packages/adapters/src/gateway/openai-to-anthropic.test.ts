import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ANTHROPIC_MAX_TOKENS,
  OpenAIStreamEmitter,
  openAIChatRequestToAnthropic,
  reasoningEffortToThinkingBudget,
  stopReasonToFinishReason,
} from './openai-to-anthropic.js';
import type { OpenAIChatRequest, SseFrame } from './wire-types.js';

function base(overrides: Partial<OpenAIChatRequest> = {}): OpenAIChatRequest {
  return {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
    ...overrides,
  };
}

function decode(frames: SseFrame[]): Array<Record<string, unknown> | '[DONE]'> {
  return frames.map((frame) =>
    frame.data === '[DONE]' ? '[DONE]' : (JSON.parse(frame.data) as Record<string, unknown>),
  );
}

describe('openAIChatRequestToAnthropic', () => {
  it('hoists system and developer messages into the top-level system field', () => {
    const body = openAIChatRequestToAnthropic(
      base({
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'developer', content: 'use tools' },
          { role: 'user', content: 'hi' },
        ],
      }),
      { targetModel: 'claude-sonnet-4' },
    );
    expect(body.system).toBe('be brief\n\nuse tools');
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
    expect(body.model).toBe('claude-sonnet-4');
  });

  it('always supplies max_tokens because Anthropic requires it', () => {
    expect(openAIChatRequestToAnthropic(base(), { targetModel: 'claude-sonnet-4' }).max_tokens).toBe(
      DEFAULT_ANTHROPIC_MAX_TOKENS,
    );
    expect(
      openAIChatRequestToAnthropic(base({ max_tokens: 500 }), { targetModel: 'claude-sonnet-4' })
        .max_tokens,
    ).toBe(500);
    expect(
      openAIChatRequestToAnthropic(base({ max_completion_tokens: 900 }), {
        targetModel: 'claude-sonnet-4',
      }).max_tokens,
    ).toBe(900);
  });

  it('converts assistant tool_calls into tool_use blocks with parsed input', () => {
    const body = openAIChatRequestToAnthropic(
      base({
        messages: [
          { role: 'user', content: 'read' },
          {
            role: 'assistant',
            content: 'sure',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
              },
            ],
          },
        ],
      }),
      { targetModel: 'claude-sonnet-4' },
    );
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'sure' },
        { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.ts' } },
      ],
    });
  });

  it('keeps malformed history arguments instead of dropping the call', () => {
    const body = openAIChatRequestToAnthropic(
      base({
        messages: [
          {
            role: 'assistant',
            tool_calls: [{ id: 'call_x', function: { name: 'f', arguments: '{"broken' } }],
          },
        ],
      }),
      { targetModel: 'claude-sonnet-4' },
    );
    expect(body.messages[0].content).toEqual([
      { type: 'tool_use', id: 'call_x', name: 'f', input: { __raw: '{"broken' } },
    ]);
  });

  it('collapses consecutive tool messages into one user turn', () => {
    const body = openAIChatRequestToAnthropic(
      base({
        messages: [
          { role: 'tool', tool_call_id: 'call_a', content: 'result a' },
          { role: 'tool', tool_call_id: 'call_b', content: 'result b' },
          { role: 'user', content: 'summarize' },
        ],
      }),
      { targetModel: 'claude-sonnet-4' },
    );
    // Anthropic rejects repeated user turns, so all three must merge.
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_a', content: 'result a' },
        { type: 'tool_result', tool_use_id: 'call_b', content: 'result b' },
        { type: 'text', text: 'summarize' },
      ],
    });
  });

  it('splits data URL images back into base64 sources', () => {
    const body = openAIChatRequestToAnthropic(
      base({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,ZZZ' } },
              { type: 'image_url', image_url: { url: 'https://example.com/b.png' } },
            ],
          },
        ],
      }),
      { targetModel: 'claude-sonnet-4' },
    );
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'ZZZ' } },
      { type: 'image', source: { type: 'url', url: 'https://example.com/b.png' } },
    ]);
  });

  it('translates tool definitions and tool_choice variants', () => {
    const tools: OpenAIChatRequest['tools'] = [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'read',
          parameters: { type: 'object', properties: { path: { type: 'string' } } },
        },
      },
    ];
    const body = openAIChatRequestToAnthropic(base({ tools, tool_choice: 'required' }), {
      targetModel: 'claude-sonnet-4',
    });
    expect(body.tools).toEqual([
      {
        name: 'read_file',
        description: 'read',
        input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'any' });
    expect(
      openAIChatRequestToAnthropic(base({ tools, tool_choice: 'auto' }), {
        targetModel: 'c',
      }).tool_choice,
    ).toEqual({ type: 'auto' });
    expect(
      openAIChatRequestToAnthropic(base({ tools, tool_choice: 'none' }), {
        targetModel: 'c',
      }).tool_choice,
    ).toEqual({ type: 'none' });
    expect(
      openAIChatRequestToAnthropic(
        base({ tools, tool_choice: { type: 'function', function: { name: 'read_file' } } }),
        { targetModel: 'c' },
      ).tool_choice,
    ).toEqual({ type: 'tool', name: 'read_file' });
  });

  it('maps reasoning_effort to a thinking budget and raises max_tokens above it', () => {
    expect(reasoningEffortToThinkingBudget('low')).toBe(4_096);
    expect(reasoningEffortToThinkingBudget('medium')).toBe(12_288);
    expect(reasoningEffortToThinkingBudget('high')).toBe(24_576);
    expect(reasoningEffortToThinkingBudget('weird')).toBeUndefined();

    const body = openAIChatRequestToAnthropic(
      base({ reasoning_effort: 'high', max_tokens: 1_000 }),
      { targetModel: 'claude-sonnet-4' },
    );
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 24_576 });
    expect(body.max_tokens).toBe(24_576 + 4_096);
  });

  it('normalizes stop into stop_sequences', () => {
    expect(
      openAIChatRequestToAnthropic(base({ stop: 'END' }), { targetModel: 'c' }).stop_sequences,
    ).toEqual(['END']);
    expect(
      openAIChatRequestToAnthropic(base({ stop: ['A', 'B'] }), { targetModel: 'c' }).stop_sequences,
    ).toEqual(['A', 'B']);
  });
});

describe('stopReasonToFinishReason', () => {
  it('maps every Anthropic stop reason', () => {
    expect(stopReasonToFinishReason('tool_use')).toBe('tool_calls');
    expect(stopReasonToFinishReason('max_tokens')).toBe('length');
    expect(stopReasonToFinishReason('refusal')).toBe('content_filter');
    expect(stopReasonToFinishReason('end_turn')).toBe('stop');
    expect(stopReasonToFinishReason(undefined)).toBe('stop');
  });
});

describe('OpenAIStreamEmitter', () => {
  it('emits a role chunk, text deltas, finish_reason, usage and [DONE]', () => {
    const emitter = new OpenAIStreamEmitter('chatcmpl-1', 'claude-sonnet-4');
    const frames = [
      ...emitter.push({
        type: 'message_start',
        message: { id: 'msg_1', usage: { input_tokens: 10, output_tokens: 0 } },
      }),
      ...emitter.push({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      ...emitter.push({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hi' },
      }),
      ...emitter.push({ type: 'content_block_stop', index: 0 }),
      ...emitter.push({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      ...emitter.push({ type: 'message_stop' }),
      ...emitter.finish(),
    ];
    const decoded = decode(frames);
    expect(decoded[0]).toMatchObject({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    });
    expect(decoded[1]).toMatchObject({ choices: [{ delta: { content: 'Hi' } }] });
    expect(decoded[2]).toMatchObject({ choices: [{ finish_reason: 'stop' }] });
    expect(decoded[3]).toMatchObject({
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    expect(decoded[4]).toBe('[DONE]');
  });

  it('remaps Anthropic block indices onto flat tool_call indices', () => {
    const emitter = new OpenAIStreamEmitter('chatcmpl-2', 'claude-sonnet-4');
    const frames = [
      // Block 0 is text; the two tool_use blocks are 1 and 2 but must become 0 and 1.
      ...emitter.push({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      ...emitter.push({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_a', name: 'read_file' },
      }),
      ...emitter.push({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"path"' },
      }),
      ...emitter.push({
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'toolu_b', name: 'write_file' },
      }),
      ...emitter.push({
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"body"' },
      }),
      ...emitter.push({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
      ...emitter.finish(),
    ];
    const decoded = decode(frames);
    const toolFrames = decoded.filter(
      (entry): entry is Record<string, unknown> =>
        entry !== '[DONE]' &&
        Array.isArray((entry as { choices?: unknown[] }).choices) &&
        Boolean(
          (
            (entry as { choices: Array<{ delta?: { tool_calls?: unknown } }> }).choices[0]?.delta
              ?.tool_calls
          ),
        ),
    );
    const calls = toolFrames.map(
      (entry) =>
        (entry as { choices: Array<{ delta: { tool_calls: Array<Record<string, unknown>> } }> })
          .choices[0].delta.tool_calls[0],
    );
    expect(calls[0]).toMatchObject({ index: 0, id: 'toolu_a', function: { name: 'read_file' } });
    expect(calls[1]).toMatchObject({ index: 0, function: { arguments: '{"path"' } });
    expect(calls[2]).toMatchObject({ index: 1, id: 'toolu_b', function: { name: 'write_file' } });
    expect(calls[3]).toMatchObject({ index: 1, function: { arguments: '{"body"' } });
    const finishFrame = decoded.find(
      (entry) =>
        entry !== '[DONE]' &&
        (entry as { choices?: Array<{ finish_reason?: string | null }> }).choices?.[0]
          ?.finish_reason === 'tool_calls',
    );
    expect(finishFrame).toBeDefined();
  });

  it('maps thinking deltas to reasoning_content', () => {
    const emitter = new OpenAIStreamEmitter('chatcmpl-3', 'claude-sonnet-4');
    const frames = emitter.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'weighing' },
    });
    const decoded = decode(frames) as Array<{
      choices: Array<{ delta: { reasoning_content?: string } }>;
    }>;
    // First frame is the synthetic role chunk only if message_start arrived;
    // here the delta itself is the payload.
    expect(decoded[decoded.length - 1].choices[0].delta.reasoning_content).toBe('weighing');
  });

  it('ignores ping and unknown events', () => {
    const emitter = new OpenAIStreamEmitter('chatcmpl-4', 'claude-sonnet-4');
    expect(emitter.push({ type: 'ping' })).toEqual([]);
    expect(emitter.push({ type: 'something_new' })).toEqual([]);
  });

  it('converts an Anthropic error event into an error payload plus [DONE]', () => {
    const emitter = new OpenAIStreamEmitter('chatcmpl-5', 'claude-sonnet-4');
    const decoded = decode(
      emitter.push({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }),
    );
    expect(decoded[0]).toEqual({ error: { message: 'busy', type: 'upstream_error' } });
    expect(decoded[1]).toBe('[DONE]');
    expect(emitter.finish()).toEqual([]);
  });

  it('still terminates cleanly when the upstream sent nothing', () => {
    const emitter = new OpenAIStreamEmitter('chatcmpl-6', 'claude-sonnet-4');
    const decoded = decode(emitter.finish());
    expect(decoded[0]).toMatchObject({ choices: [{ delta: { role: 'assistant' } }] });
    expect(decoded[1]).toMatchObject({ choices: [{ finish_reason: 'stop' }] });
    expect(decoded[2]).toBe('[DONE]');
  });
});
