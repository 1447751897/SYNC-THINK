import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect, textFromEvents } from '../events.js';
import { OpenAIResponsesAdapter } from '../openai-responses-adapter.js';
import type { ProviderCallRequest } from '../types.js';
import { scrubSecrets } from './discover-models.js';
import { joinResponsesUrl, streamOpenAIResponses } from './stream-responses.js';

function req(overrides: Partial<ProviderCallRequest> = {}): ProviderCallRequest {
  return {
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'gpt-5-mini',
    apiKey: 'sk-TEST_RESPONSES_KEY_ABCDEFG_123456',
    systemPrompt: 'Be concise.',
    messages: [{ role: 'user', content: 'hello responses' }],
    stream: true,
    signal: new AbortController().signal,
    idempotencyKey: 'provider-call-responses-stable-key',
    ...overrides,
  } as ProviderCallRequest;
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  });
}

function reasoningFromEvents(events: Awaited<ReturnType<typeof collect>>): string {
  return events
    .filter((event) => event.type === 'reasoning-delta')
    .map((event) => (event.type === 'reasoning-delta' ? event.text : ''))
    .join('');
}

function assistantMessageText(
  events: Awaited<ReturnType<typeof collect>>,
  phase: 'commentary' | 'final_answer',
): string {
  return events
    .filter((event) => event.type === 'assistant-message-delta' && event.phase === phase)
    .map((event) => (event.type === 'assistant-message-delta' ? event.text : ''))
    .join('');
}

describe('joinResponsesUrl', () => {
  it('appends /responses once and normalizes host-only gateways to /v1', () => {
    expect(joinResponsesUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/responses',
    );
    expect(joinResponsesUrl('https://gateway.example')).toBe(
      'https://gateway.example/v1/responses',
    );
    expect(joinResponsesUrl('https://gateway.example/v1/responses')).toBe(
      'https://gateway.example/v1/responses',
    );
  });
});

describe('streamOpenAIResponses', () => {
  const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();

  afterEach(() => fetchMock.mockReset());

  it('streams output text, usage, and completion from Responses SSE', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'event: response.output_text.delta\n',
        'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
        'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":19,"input_tokens_details":{"cached_tokens":11,"cache_write_tokens":3},"output_tokens":7,"output_tokens_details":{"reasoning_tokens":5},"total_tokens":26}}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toBe('Hello world');
    expect(events).toContainEqual({
      type: 'usage',
      tokensIn: 19,
      tokensOut: 7,
      cachedTokensHit: 11,
      cachedTokensCreated: 3,
      reasoningTokens: 5,
      totalTokens: 26,
    });
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'stop' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init as { headers: Record<string, string> }).headers['Idempotency-Key']).toBe(
      'provider-call-responses-stable-key',
    );
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toMatchObject({ model: 'gpt-5-mini', stream: true, instructions: 'Be concise.' });
    expect(body.input[0]).toMatchObject({ role: 'user', content: 'hello responses' });
  });

  it('streams unphased Responses text as final_answer and deduplicates the phased terminal snapshot', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.output_text.delta","output_index":0,"delta":"第一段，"}\n\n',
        'data: {"type":"response.output_text.delta","output_index":0,"delta":"第二段。"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"id":"msg-final","type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"第一段，第二段。"}]}]}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    expect(assistantMessageText(events, 'final_answer')).toBe('第一段，第二段。');
    expect(events.filter((event) => event.type === 'text-delta')).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual([
      'assistant-message-start',
      'assistant-message-delta',
      'assistant-message-delta',
      'assistant-message-end',
      'finished',
    ]);
  });

  it('emits only the unseen suffix when an identifier-free delta is followed by a full snapshot', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"id":"msg-final","type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Hello world"}]}]}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    expect(assistantMessageText(events, 'final_answer')).toBe('Hello world');
    expect(
      events
        .filter((event) => event.type === 'assistant-message-delta')
        .map((event) => (event.type === 'assistant-message-delta' ? event.text : '')),
    ).toEqual(['Hello', ' world']);
  });

  it('deduplicates a completed final-answer snapshot when the gateway rewrites its item identity', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.output_item.added","output_index":7,"item":{"id":"msg-stream","type":"message","role":"assistant","phase":"final_answer","content":[]}}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg-stream","output_index":7,"delta":"第一段，"}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg-stream","output_index":7,"delta":"第二段。"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"id":"msg-snapshot","type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"第一段，第二段。"}]}]}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    expect(assistantMessageText(events, 'final_answer')).toBe('第一段，第二段。');
    expect(
      events
        .filter((event) => event.type === 'assistant-message-delta')
        .map((event) => (event.type === 'assistant-message-delta' ? event.text : '')),
    ).toEqual(['第一段，', '第二段。']);
    expect(events.filter((event) => event.type === 'assistant-message-start')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'assistant-message-end')).toHaveLength(1);
  });

  it('recovers a reasoning summary from the completed Responses payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"reasoning","summary":[{"type":"summary_text","text":"Checked the stream lifecycle."}]}]}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(reasoningFromEvents(events)).toBe('Checked the stream lifecycle.');
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'stop' });
  });

  it('does not duplicate a reasoning summary already emitted as deltas', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.reasoning_summary_text.delta","delta":"Already streamed."}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"reasoning","summary":[{"type":"summary_text","text":"Already streamed."}]}]}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(reasoningFromEvents(events)).toBe('Already streamed.');
    expect(events.filter((event) => event.type === 'reasoning-delta')).toHaveLength(1);
  });

  it('preserves Codex commentary and final-answer phases around tool calls', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg-commentary-1","type":"message","role":"assistant","phase":"commentary","content":[]}}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg-commentary-1","output_index":0,"delta":"先检查代码。"}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg-commentary-1","type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"先检查代码。"}]}}\n\n',
        'data: {"type":"response.function_call_arguments.done","call_id":"call-read","name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}"}\n\n',
        'data: {"type":"response.output_item.added","output_index":2,"item":{"id":"msg-commentary-2","type":"message","role":"assistant","phase":"commentary","content":[]}}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg-commentary-2","output_index":2,"delta":"读取后继续验证。"}\n\n',
        'data: {"type":"response.output_item.done","output_index":2,"item":{"id":"msg-commentary-2","type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"读取后继续验证。"}]}}\n\n',
        'data: {"type":"response.output_item.added","output_index":3,"item":{"id":"msg-final","type":"message","role":"assistant","phase":"final_answer","content":[]}}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg-final","output_index":3,"delta":"已经完成。"}\n\n',
        'data: {"type":"response.output_item.done","output_index":3,"item":{"id":"msg-final","type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"已经完成。"}]}}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    expect(assistantMessageText(events, 'commentary')).toBe('先检查代码。读取后继续验证。');
    expect(assistantMessageText(events, 'final_answer')).toBe('已经完成。');
    expect(events.map((event) => event.type)).toEqual([
      'assistant-message-start',
      'assistant-message-delta',
      'assistant-message-end',
      'tool-call',
      'assistant-message-start',
      'assistant-message-delta',
      'assistant-message-end',
      'assistant-message-start',
      'assistant-message-delta',
      'assistant-message-end',
      'finished',
    ]);
  });

  it('forwards provider-managed prompt cache identity without unsupported retention', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ status: 'completed', output: [] }),
    } as unknown as Response);

    await collect(
      streamOpenAIResponses(
        req({
          promptCache: {
            key: 'openai:gpt-5-mini:thread-123:epoch-456',
            retention: '24h',
          },
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.prompt_cache_key).toBe('openai:gpt-5-mini:thread-123:epoch-456');
    expect(body).not.toHaveProperty('prompt_cache_retention');
  });

  it('uses an implicit cache breakpoint for GPT-5.6 when content breakpoints are unavailable', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ status: 'completed', output: [] }),
    } as unknown as Response);

    await collect(
      streamOpenAIResponses(
        req({
          modelId: 'gpt-5.6-sol',
          messages: [
            { role: 'user', content: 'first question' },
            { role: 'assistant', content: 'first answer' },
            { role: 'user', content: 'next question' },
          ],
          tools: [{ name: 'read_file', inputSchema: { type: 'object' } }],
          toolChoice: 'none',
          promptCache: {
            key: 'thread-cache-key',
            retention: '24h',
            strategy: 'automatic',
          },
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.prompt_cache_key).toBe('thread-cache-key');
    expect(body.prompt_cache_options).toEqual({ mode: 'implicit', ttl: '30m' });
    expect(body).not.toHaveProperty('prompt_cache_retention');
    expect(body.instructions).toBe('Be concise.');
    expect(body.input[0]).toMatchObject({ role: 'user', content: 'first question' });
    expect(body.tool_choice).toBe('none');
    expect(body.tools).toHaveLength(1);
    expect(JSON.stringify(body.input)).not.toContain('prompt_cache_breakpoint');
  });

  it('serializes prior function calls and their local outputs for the next Responses turn', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ status: 'completed', output: [] }),
    } as unknown as Response);

    await collect(
      streamOpenAIResponses(
        req({
          messages: [
            { role: 'user', content: 'Read file' },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCall: {
                    id: 'call-previous',
                    name: 'read_file',
                    argumentsJson: '{"path":"README.md"}',
                  },
                },
              ],
            },
            { role: 'tool', toolCallId: 'call-previous', content: '{"content":"hello"}' },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(requestBody.input).toContainEqual({
      type: 'function_call',
      call_id: 'call-previous',
      name: 'read_file',
      arguments: '{"path":"README.md"}',
    });
    expect(requestBody.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'call-previous',
      output: '{"content":"hello"}',
    });
  });

  it('preserves Codex assistant phases and message/tool ordering in Responses history', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ status: 'completed', output: [] }),
    } as unknown as Response);

    await collect(
      streamOpenAIResponses(
        req({
          messages: [
            { role: 'user', content: '检查文件' },
            {
              role: 'assistant',
              phase: 'commentary',
              content: '我先读取关键文件。',
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCall: {
                    id: 'call-read',
                    name: 'read_file',
                    argumentsJson: '{"path":"README.md"}',
                  },
                },
              ],
            },
            { role: 'tool', toolCallId: 'call-read', content: '{"content":"hello"}' },
            {
              role: 'assistant',
              phase: 'final_answer',
              content: '读取完成。',
            },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(requestBody.input).toEqual([
      { role: 'user', content: '检查文件' },
      {
        role: 'assistant',
        phase: 'commentary',
        content: '我先读取关键文件。',
      },
      {
        type: 'function_call',
        call_id: 'call-read',
        name: 'read_file',
        arguments: '{"path":"README.md"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call-read',
        output: '{"content":"hello"}',
      },
      {
        role: 'assistant',
        phase: 'final_answer',
        content: '读取完成。',
      },
    ]);
  });

  it('serializes multimodal user images as Responses input_image parts', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ status: 'completed', output: [] }),
    } as unknown as Response);

    await collect(
      streamOpenAIResponses(
        req({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'describe this' },
                { type: 'image', imageUrl: 'data:image/png;base64,xx' },
              ],
            },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(requestBody.input[0]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'describe this' },
        { type: 'input_image', image_url: 'data:image/png;base64,xx' },
      ],
    });
  });

  it('parses a non-stream Responses JSON fallback', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () =>
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'solid response' }] }],
          usage: { input_tokens: 4, output_tokens: 3 },
        }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toBe('solid response');
    expect(events).toContainEqual({ type: 'usage', tokensIn: 4, tokensOut: 3 });
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'stop' });
  });

  it('extracts a reasoning summary from a non-stream Responses JSON fallback', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () =>
        JSON.stringify({
          status: 'completed',
          output: [
            {
              type: 'reasoning',
              content: [{ type: 'reasoning_text', text: 'Persist this summary.' }],
            },
          ],
        }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(reasoningFromEvents(events)).toBe('Persist this summary.');
    expect(events.at(-1)).toEqual({ type: 'finished', reason: 'stop' });
  });

  it('classifies completed assistant messages by phase without promoting reasoning to commentary', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () =>
        JSON.stringify({
          status: 'completed',
          output: [
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: [{ type: 'summary_text', text: 'Internal diagnostic summary.' }],
            },
            {
              id: 'commentary-1',
              type: 'message',
              role: 'assistant',
              phase: 'commentary',
              content: [{ type: 'output_text', text: '我先检查消息链路。' }],
            },
            {
              type: 'function_call',
              call_id: 'call-1',
              name: 'read_file',
              arguments: '{"path":"README.md"}',
            },
            {
              id: 'final-1',
              type: 'message',
              role: 'assistant',
              phase: 'final_answer',
              content: [{ type: 'output_text', text: '检查完成。' }],
            },
          ],
        }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );

    expect(reasoningFromEvents(events)).toBe('Internal diagnostic summary.');
    expect(assistantMessageText(events, 'commentary')).toBe('我先检查消息链路。');
    expect(assistantMessageText(events, 'final_answer')).toBe('检查完成。');
    expect(assistantMessageText(events, 'commentary')).not.toContain('Internal diagnostic summary.');
  });

  it('maps auth errors without leaking the API key', async () => {
    const secret = 'sk-LEAK_ME_RESPONSES_XYZ999';
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      body: null,
      text: async () => JSON.stringify({ error: { message: `bad key ${secret}` } }),
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req({ apiKey: secret }), {
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    );
    const error = events.find((event) => event.type === 'error');
    expect(error).toMatchObject({ type: 'error', failureClass: 'auth' });
    if (error?.type === 'error') {
      expect(error.message).not.toContain(secret);
      expect(scrubSecrets(error.message, [secret])).toBe(error.message);
    }
  });

  it('OpenAIResponsesAdapter.call delegates to Responses streaming', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.output_text.delta","delta":"via adapter"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const adapter = new OpenAIResponsesAdapter({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const events = await collect(adapter.call(req()));
    expect(textFromEvents(events)).toBe('via adapter');
  });
});
