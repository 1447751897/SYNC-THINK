import { describe, it, expect } from 'vitest';
import { ChatStreamToResponsesEmitter } from './chat-stream-to-responses.js';
import type { ToolNamespaceEntry } from './openai-responses-to-chat.js';
import type { OpenAIStreamChunk, SseFrame } from './wire-types.js';

function chunk(overrides: Partial<OpenAIStreamChunk> = {}): OpenAIStreamChunk {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    model: 'deepseek-v4-flash',
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    ...overrides,
  };
}

function decode(frames: SseFrame[]): Array<{ event?: string; payload: Record<string, any> }> {
  return frames.map((frame) => ({
    ...(frame.event ? { event: frame.event } : {}),
    payload: frame.data === '[DONE]' ? { done: true } : (JSON.parse(frame.data) as Record<string, any>),
  }));
}

describe('ChatStreamToResponsesEmitter', () => {
  it('emits created → text deltas → completed for a plain text stream', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_1', 'deepseek-v4-flash');
    const frames = emitter.push(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: '你' }, finish_reason: null }] }));
    frames.push(...emitter.push(chunk({ choices: [{ index: 0, delta: { content: '好' }, finish_reason: null }] })));
    frames.push(...emitter.push(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })));
    frames.push(...emitter.finish());
    const events = decode(frames);

    expect(events[0].event).toBe('response.created');
    expect(events[1].event).toBe('response.in_progress');
    expect(events[2].payload).toMatchObject({ type: 'response.output_item.added', item: { type: 'message', role: 'assistant' } });
    expect(events[3].payload).toMatchObject({ type: 'response.content_part.added', part: { type: 'output_text' } });
    expect(events[4].payload).toMatchObject({ type: 'response.output_text.delta', delta: '你' });
    expect(events[5].payload).toMatchObject({ type: 'response.output_text.delta', delta: '好' });
    expect(events[6].payload).toMatchObject({ type: 'response.output_text.done', text: '你好' });
    expect(events[7].payload).toMatchObject({ type: 'response.output_item.done', item: { type: 'message' } });

    const completed = events[events.length - 1];
    expect(completed.event).toBe('response.completed');
    expect(completed.payload).toMatchObject({
      response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '你好' }] }],
      },
    });
  });

  it('carries provider reasoning_content through as a reasoning output item', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_1', 'deepseek-v4-flash');
    const frames = emitter.push(
      chunk({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: '先设未知数' }, finish_reason: null }] }),
    );
    frames.push(
      ...emitter.push(
        chunk({ choices: [{ index: 0, delta: { reasoning_content: '再列方程' }, finish_reason: null }] }),
      ),
    );
    frames.push(
      ...emitter.push(chunk({ choices: [{ index: 0, delta: { content: '答案是42' }, finish_reason: null }] })),
    );
    frames.push(...emitter.push(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })));
    frames.push(...emitter.finish());
    const events = decode(frames);

    const reasoningAdded = events.find((e) => e.event === 'response.output_item.added');
    expect(reasoningAdded?.payload).toMatchObject({ item: { type: 'reasoning' } });
    const deltas = events
      .filter((e) => e.event === 'response.reasoning_summary_part.added')
      .map((e) => e.payload.part?.text)
      .filter((text) => Boolean(text));
    expect(deltas).toEqual(['先设未知数', '再列方程']);

    const completed = events[events.length - 1];
    expect(completed.payload.response.output).toEqual([
      { type: 'reasoning', id: expect.any(String), summary: [{ type: 'summary_text', text: '先设未知数再列方程' }] },
      { type: 'message', id: expect.any(String), role: 'assistant', content: [{ type: 'output_text', text: '答案是42', annotations: [] }] },
    ]);
  });

  it('translates tool_calls argument fragments verbatim', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_2', 'm');
    const frames = emitter.push(
      chunk({
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'shell_ls', arguments: '' } }] },
            finish_reason: null,
          },
        ],
      }),
    );
    frames.push(
      ...emitter.push(
        chunk({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: 'call_1', function: { arguments: '{"dir":"' } }] },
              finish_reason: null,
            },
          ],
        }),
      ),
    );
    frames.push(
      ...emitter.push(
        chunk({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '."}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      ),
    );
    frames.push(...emitter.finish());
    const events = decode(frames);

    const added = events.find((e) => e.payload.type === 'response.output_item.added');
    expect(added).toBeDefined();
    expect(added!.payload.item).toMatchObject({
      type: 'function_call',
      call_id: 'call_1',
      name: 'shell_ls',
    });

    const deltas = events
      .filter((e) => e.payload.type === 'response.function_call_arguments.delta')
      .map((e) => e.payload.delta);
    expect(deltas).toEqual(['{"dir":"', '."}']);

    const done = events.find((e) => e.payload.type === 'response.function_call_arguments.done');
    expect(done!.payload.arguments).toBe('{"dir":"."}');

    const completed = events[events.length - 1];
    expect(completed.event).toBe('response.completed');
    expect(completed.payload.response.output).toEqual([
      { type: 'function_call', id: expect.any(String), call_id: 'call_1', name: 'shell_ls', arguments: '{"dir":"."}' },
    ]);
  });

  it('emits custom_tool_call for a flattened namespace tool call', () => {
    const namespaceEntry = {
      fullName: 'mcp__sync_think_platform__platform_context',
      namespace: 'mcp__sync_think_platform',
      name: 'platform_context',
    };
    const emitter = new ChatStreamToResponsesEmitter('resp_ns', 'm', new Map([[namespaceEntry.fullName, namespaceEntry]]));
    const frames = emitter.push(
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_ns',
                  function: { name: 'mcp__sync_think_platform__platform_context', arguments: '{"k":"v"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    frames.push(...emitter.finish());
    const events = decode(frames);

    const added = events.find((e) => e.payload.type === 'response.output_item.added')!;
    expect(added.payload.item).toEqual({
      type: 'custom_tool_call',
      id: expect.any(String),
      call_id: 'call_ns',
      name: 'platform_context',
      namespace: 'mcp__sync_think_platform',
      input: '',
    });

    const delta = events.find((e) => e.payload.type === 'response.custom_tool_call_input.delta')!;
    expect(delta.payload.delta).toBe('{"k":"v"}');
    expect(delta.payload.call_id).toBe('call_ns');

    // Namespace tools have no function_call_arguments.done event.
    expect(events.find((e) => e.payload.type === 'response.function_call_arguments.done')).toBeUndefined();

    const done = events.find((e) => e.payload.type === 'response.output_item.done')!;
    expect(done.payload.item).toEqual({
      type: 'custom_tool_call',
      id: expect.any(String),
      call_id: 'call_ns',
      name: 'platform_context',
      namespace: 'mcp__sync_think_platform',
      input: '{"k":"v"}',
    });
  });

  it('keeps function_call for a tool name not in the namespace map', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_fn', 'm', new Map());
    const frames = emitter.push(
      chunk({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, id: 'call_fn', function: { name: 'shell_ls', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    frames.push(...emitter.finish());
    const events = decode(frames);
    const added = events.find((e) => e.payload.type === 'response.output_item.added')!;
    expect(added.payload.item.type).toBe('function_call');
    expect(events.find((e) => e.payload.type === 'response.custom_tool_call_input.delta')).toBeUndefined();
    expect(events.find((e) => e.payload.type === 'response.function_call_arguments.done')).toBeDefined();
  });

  it('restores a bare sub-tool name to its namespace when the upstream replies with a bare name', () => {
    const namespaceEntry = {
      fullName: 'mcp__sync_think_platform__platform_context',
      namespace: 'mcp__sync_think_platform',
      name: 'platform_context',
    };
    const emitter = new ChatStreamToResponsesEmitter(
      'resp_bare',
      'm',
      new Map([[namespaceEntry.fullName, namespaceEntry]]),
    );
    const frames = emitter.push(
      chunk({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, id: 'call_bare', function: { name: 'platform_context', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    frames.push(...emitter.finish());
    const events = decode(frames);
    const added = events.find((e) => e.payload.type === 'response.output_item.added')!;
    expect(added.payload.item).toMatchObject({
      type: 'custom_tool_call',
      name: 'platform_context',
      namespace: 'mcp__sync_think_platform',
    });
  });

  it('keeps function_call for an ambiguous bare name shared by two namespaces', () => {
    const shared: ToolNamespaceEntry = {
      fullName: 'ns_a__do_thing',
      namespace: 'ns_a',
      name: 'do_thing',
    };
    const other: ToolNamespaceEntry = {
      fullName: 'ns_b__do_thing',
      namespace: 'ns_b',
      name: 'do_thing',
    };
    const emitter = new ChatStreamToResponsesEmitter(
      'resp_amb',
      'm',
      new Map([
        [shared.fullName, shared],
        [other.fullName, other],
      ]),
    );
    const frames = emitter.push(
      chunk({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, id: 'call_amb', function: { name: 'do_thing', arguments: '{}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    frames.push(...emitter.finish());
    const events = decode(frames);
    const added = events.find((e) => e.payload.type === 'response.output_item.added')!;
    expect(added.payload.item.type).toBe('function_call');
    expect(added.payload.item.namespace).toBeUndefined();
  });

  it('closes a text item before opening a tool item (monotonic output)', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_3', 'm');
    const frames = emitter.push(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] }));
    frames.push(
      ...emitter.push(
        chunk({
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, id: 'call_2', function: { name: 'f', arguments: '{}' } }] },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      ),
    );
    frames.push(...emitter.finish());
    const events = decode(frames);
    const textDoneIndex = events.findIndex((e) => e.payload.type === 'response.output_text.done');
    const toolAddedIndex = events.findIndex((e) => e.payload.type === 'response.output_item.added' && e.payload.item?.type === 'function_call');
    expect(textDoneIndex).toBeGreaterThan(-1);
    expect(toolAddedIndex).toBeGreaterThan(textDoneIndex);
  });

  it('maps usage and incomplete finish reason into completed envelope', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_4', 'm');
    const frames = emitter.push(
      chunk({
        choices: [{ index: 0, delta: { role: 'assistant', content: 'x' }, finish_reason: null }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    frames.push(...emitter.push(chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })));
    frames.push(...emitter.finish());
    const events = decode(frames);
    const completed = events[events.length - 1];
    expect(completed.payload.response.status).toBe('incomplete');
    expect(completed.payload.response.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });

  it('error() emits response.failed', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_5', 'm');
    const events = decode(emitter.error('upstream exploded'));
    expect(events[0].event).toBe('response.failed');
    expect(events[0].payload.error.message).toBe('upstream exploded');
  });

  it('emits valid output_index order across mixed items', () => {
    const emitter = new ChatStreamToResponsesEmitter('resp_6', 'm');
    const frames = emitter.push(chunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'a' }, finish_reason: null }] }));
    frames.push(...emitter.push(chunk({ choices: [{ index: 0, delta: { content: 'b' }, finish_reason: null }] })));
    frames.push(...emitter.finish());
    const events = decode(frames);
    const textAdded = events.find((e) => e.payload.type === 'response.output_item.added')!;
    const completed = events[events.length - 1];
    expect(textAdded.payload.output_index).toBe(0);
    expect(completed.payload.response.output[0]).toMatchObject({ content: [{ type: 'output_text', text: 'ab' }] });
  });
});
