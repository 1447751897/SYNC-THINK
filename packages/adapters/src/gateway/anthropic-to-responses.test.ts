import { describe, it, expect } from 'vitest';
import {
  OpenAIResponsesStreamEmitter,
  anthropicRequestToOpenAIResponses,
} from './anthropic-to-responses.js';
import type {
  AnthropicMessagesRequest,
  OpenAIResponseSseEvent,
  SseFrame,
} from './wire-types.js';

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
    payload: JSON.parse(frame.data) as Record<string, unknown>,
  }));
}

describe('anthropicRequestToOpenAIResponses', () => {
  it('maps system → instructions, model and max_tokens → max_output_tokens', () => {
    const body = anthropicRequestToOpenAIResponses(
      base({ system: 'be brief' }),
      { targetModel: 'gpt-5.6-luna' },
    );
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.instructions).toBe('be brief');
    expect(body.max_output_tokens).toBe(2048);
    expect(body.stream).toBe(true);
  });

  it('lifts tool_result blocks into function_call_output items before user text', () => {
    const body = anthropicRequestToOpenAIResponses(
      base({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: [{ type: 'text', text: '42' }],
              },
              { type: 'text', text: 'next' },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-5.6-luna' },
    );
    expect(body.input).toEqual([
      { type: 'function_call_output', call_id: 'toolu_1', output: '42' },
      { role: 'user', content: 'next' },
    ]);
  });

  it('marks failed tool results and replays assistant tool_use as a top-level function_call', () => {
    const body = anthropicRequestToOpenAIResponses(
      base({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_2',
                content: 'boom',
                is_error: true,
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I will check' },
              {
                type: 'tool_use',
                id: 'toolu_2',
                name: 'read_file',
                input: { path: 'a.txt' },
              },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-5.6-luna' },
    );
    expect(body.input[0]).toEqual({
      type: 'function_call_output',
      call_id: 'toolu_2',
      output: 'Error: boom',
    });
    expect(body.input[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'output_text', text: 'I will check' }],
    });
    expect(body.input[2]).toEqual({
      type: 'function_call',
      call_id: 'toolu_2',
      name: 'read_file',
      arguments: '{"path":"a.txt"}',
    });
  });

  it('continues from the provider response and sends only tool outputs plus new user content', () => {
    const body = anthropicRequestToOpenAIResponses(
      base({
        messages: [
          {
            role: 'user',
            content: 'run it',
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'Write-Output',
                input: { value: 'ok' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: 'ok',
              },
              { type: 'text', text: 'summarize the result' },
            ],
          },
        ],
      }),
      {
        targetModel: 'gpt-5.6-luna',
        resolveFunctionResponseId: (callId) =>
          callId === 'call_1' ? 'resp_tool_1' : undefined,
      },
    );

    expect(body.previous_response_id).toBe('resp_tool_1');
    expect(body.input).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      { role: 'user', content: 'summarize the result' },
    ]);
  });

  it('requires every tool result in one continuation batch to belong to the same response', () => {
    expect(() =>
      anthropicRequestToOpenAIResponses(
        base({
          messages: [
            { role: 'user', content: 'run both' },
            {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: 'call_1', name: 'one', input: {} },
                { type: 'tool_use', id: 'call_2', name: 'two', input: {} },
              ],
            },
            {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: 'call_1', content: 'one' },
                { type: 'tool_result', tool_use_id: 'call_2', content: 'two' },
              ],
            },
          ],
        }),
        {
          targetModel: 'gpt-5.6-luna',
          resolveFunctionResponseId: (callId) =>
            callId === 'call_1' ? 'resp_1' : 'resp_2',
        },
      ),
    ).toThrow(/same Responses response/i);
  });

  it('converts image blocks into input_image data URLs', () => {
    const body = anthropicRequestToOpenAIResponses(
      base({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is this?' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'aGk=' },
              },
            ],
          },
        ],
      }),
      { targetModel: 'gpt-5.6-luna' },
    );
    const item = body.input[0];
    expect(item).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'what is this?' },
        { type: 'input_image', image_url: 'data:image/png;base64,aGk=' },
      ],
    });
  });

  it('maps tools, tool_choice and thinking budget to the responses shape', () => {
    const body = anthropicRequestToOpenAIResponses(
      base({
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            input_schema: { type: 'object', properties: { path: { type: 'string' } } },
          },
        ],
        tool_choice: { type: 'tool', name: 'read_file' },
        thinking: { type: 'enabled', budget_tokens: 20000 },
      }),
      { targetModel: 'gpt-5.6-luna' },
    );
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', name: 'read_file' });
    expect(body.reasoning).toEqual({ effort: 'high' });
  });
});

describe('OpenAIResponsesStreamEmitter', () => {
  function stream(events: OpenAIResponseSseEvent[]): Array<{ event?: string; payload: Record<string, unknown> }> {
    const emitter = new OpenAIResponsesStreamEmitter('msg_1', 'gpt-5.6-luna');
    const frames: SseFrame[] = [];
    for (const event of events) frames.push(...emitter.push(event));
    frames.push(...emitter.finish());
    return decode(frames);
  }

  it('emits a complete Anthropic envelope for a text stream', () => {
    const out = stream([
      { type: 'response.created' },
      { type: 'response.in_progress' },
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', output_index: 0, delta: '你' },
      { type: 'response.output_text.delta', output_index: 0, delta: '好' },
      { type: 'response.output_text.done', output_index: 0, text: '你好' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '你好' }] } },
      { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 2 } } },
    ]);
    expect(out[0].event).toBe('message_start');
    expect(out[1].event).toBe('content_block_start');
    expect(out[1].payload).toMatchObject({ index: 0, content_block: { type: 'text' } });
    const deltas = out.filter((f) => f.event === 'content_block_delta');
    expect(deltas.map((d) => (d.payload.delta as { text?: string }).text)).toEqual(['你', '好']);
    expect(out.at(-2)?.event).toBe('message_delta');
    expect(out.at(-2)?.payload).toMatchObject({
      delta: { stop_reason: 'end_turn' },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    expect(out.at(-1)?.event).toBe('message_stop');
  });

  it('translates function_call items with verbatim argument fragments', () => {
    const recorded: string[] = [];
    const emitter = new OpenAIResponsesStreamEmitter(
      'msg_1',
      'gpt-5.6-luna',
      (callId) => recorded.push(callId),
    );
    const frames: SseFrame[] = [];
    const events: OpenAIResponseSseEvent[] = [
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_item_1',
          call_id: 'call_1',
          name: 'read_file',
        },
      },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"pa' },
      { type: 'response.function_call_arguments.delta', output_index: 0, delta: 'th":"a.txt"}' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_item_1',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"a.txt"}',
        },
      },
      { type: 'response.completed', response: { status: 'completed', output: [] } },
    ];
    for (const event of events) frames.push(...emitter.push(event));
    frames.push(...emitter.finish());
    const out = decode(frames);
    const start = out.find((f) => f.event === 'content_block_start')!;
    expect(start.payload).toMatchObject({
      index: 0,
      content_block: { type: 'tool_use', id: 'call_1', name: 'read_file' },
    });
    expect(recorded).toContain('call_1');
    const args = out.filter((f) => f.event === 'content_block_delta').map(
      (f) => (f.payload.delta as { partial_json?: string }).partial_json,
    );
    expect(args).toEqual(['{"pa', 'th":"a.txt"}']);
    expect(out.find((f) => f.event === 'message_delta')?.payload).toMatchObject({
      delta: { stop_reason: 'tool_use' },
    });
  });

  it('buffers argument deltas until a relay supplies the function identity in the done event', () => {
    const recorded: string[] = [];
    const emitter = new OpenAIResponsesStreamEmitter(
      'msg_1',
      'gpt-5.6-luna',
      (callId) => recorded.push(callId),
    );

    expect(
      emitter.push({
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_item_late',
        },
      }),
    ).toEqual([]);
    expect(
      emitter.push({
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_item_late',
        output_index: 0,
        delta: '{"path":"late.txt"}',
      }),
    ).toEqual([]);

    const frames = emitter.push({
      type: 'response.function_call_arguments.done',
      item_id: 'fc_item_late',
      output_index: 0,
      call_id: 'call_late',
      name: 'read_file',
      arguments: '{"path":"late.txt"}',
    } as unknown as OpenAIResponseSseEvent);
    const out = decode(frames);

    expect(out.map((frame) => frame.event)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
    ]);
    expect(out[1].payload).toMatchObject({
      index: 0,
      content_block: {
        type: 'tool_use',
        id: 'call_late',
        name: 'read_file',
      },
    });
    expect(out[2].payload).toMatchObject({
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"path":"late.txt"}',
      },
    });
    expect(recorded).toEqual(['call_late']);
  });

  it('emits done-only function arguments once and never surfaces an empty tool name', () => {
    const emitter = new OpenAIResponsesStreamEmitter('msg_1', 'gpt-5.6-luna');
    const frames: SseFrame[] = [];
    frames.push(
      ...emitter.push({
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_item_done_only',
        },
      }),
    );
    frames.push(
      ...emitter.push({
        type: 'response.function_call_arguments.done',
        item_id: 'fc_item_done_only',
        call_id: 'call_done_only',
        name: 'write_file',
        arguments: '{"path":"done.txt","content":"ok"}',
      } as unknown as OpenAIResponseSseEvent),
    );
    frames.push(
      ...emitter.push({
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_item_done_only',
          call_id: 'call_done_only',
          name: 'write_file',
          arguments: '{"path":"done.txt","content":"ok"}',
        },
      }),
    );
    frames.push(
      ...emitter.push({
        type: 'response.completed',
        response: { status: 'completed', output: [] },
      }),
    );

    const out = decode(frames);
    const starts = out.filter((frame) => frame.event === 'content_block_start');
    const argumentDeltas = out.filter(
      (frame) =>
        frame.event === 'content_block_delta' &&
        (frame.payload.delta as { type?: string }).type === 'input_json_delta',
    );
    expect(starts).toHaveLength(1);
    expect(starts[0].payload).toMatchObject({
      content_block: {
        type: 'tool_use',
        id: 'call_done_only',
        name: 'write_file',
      },
    });
    expect(
      (starts[0].payload.content_block as { name?: string }).name,
    ).not.toBe('');
    expect(argumentDeltas).toHaveLength(1);
    expect(argumentDeltas[0].payload).toMatchObject({
      delta: {
        partial_json: '{"path":"done.txt","content":"ok"}',
      },
    });
  });

  it('replays a non-streaming completed response (output carried in the envelope)', () => {
    const out = stream([
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] },
            {
              type: 'function_call',
              id: 'fc_item_9',
              call_id: 'call_9',
              name: 'lookup',
              arguments: '{"q":"x"}',
            },
          ],
          usage: { input_tokens: 5, output_tokens: 3 },
        },
      },
    ]);
    const blocks = out.filter((f) => f.event === 'content_block_start');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].payload.content_block).toMatchObject({ type: 'text' });
    expect(blocks[1].payload.content_block).toMatchObject({
      type: 'tool_use',
      id: 'call_9',
      name: 'lookup',
    });
    const text = out.find(
      (f) => f.event === 'content_block_delta' && (f.payload.delta as { type?: string }).type === 'text_delta',
    );
    expect(text?.payload.delta).toMatchObject({ text: 'done' });
    expect(out.at(-1)?.event).toBe('message_stop');
  });

  it('does not replay items the stream already emitted when completed carries the full output', () => {
    const emitter = new OpenAIResponsesStreamEmitter('msg_1', 'gpt-5.6-luna');
    const frames: SseFrame[] = [];
    frames.push(
      ...emitter.push({
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', role: 'assistant', content: [] },
      }),
    );
    frames.push(
      ...emitter.push({
        type: 'response.output_text.delta',
        item_id: 'item_1',
        output_index: 0,
        delta: 'pong',
      }),
    );
    frames.push(
      ...emitter.push({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'pong' }],
            },
          ],
        },
      }),
    );
    frames.push(...emitter.finish());
    const out = decode(frames);
    const textDeltas = out.filter(
      (f) => f.event === 'content_block_delta' && (f.payload.delta as { type?: string }).type === 'text_delta',
    );
    expect(textDeltas.map((d) => (d.payload.delta as { text?: string }).text)).toEqual(['pong']);
    // Each block: exactly one start and one stop.
    expect(out.filter((f) => f.event === 'content_block_start')).toHaveLength(1);
    expect(out.filter((f) => f.event === 'content_block_stop')).toHaveLength(1);
  });

  it('emits an error frame for response.failed', () => {
    const emitter = new OpenAIResponsesStreamEmitter('msg_1', 'gpt-5.6-luna');
    const frames = emitter.push({
      type: 'response.failed',
      response: { status: 'failed', error: { message: 'upstream blew up' } },
    });
    const out = decode(frames);
    expect(out[0].event).toBe('error');
    expect(out[0].payload).toMatchObject({ error: { message: 'upstream blew up' } });
  });

  it('emits a minimal envelope when the stream ends without content', () => {
    const emitter = new OpenAIResponsesStreamEmitter('msg_1', 'gpt-5.6-luna');
    const frames = emitter.push({ type: 'response.created' });
    frames.push(...emitter.finish());
    const out = decode(frames);
    expect(out[0].event).toBe('message_start');
    expect(out.at(-1)?.event).toBe('message_stop');
    expect(out.filter((f) => f.event === 'content_block_start')).toHaveLength(0);
  });
});
