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

  it('sends image parts as Responses input_image content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);
    await collect(
      streamOpenAIResponses(
        req({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Inspect this' },
                { type: 'image', imageUrl: 'data:image/png;base64,AQID' },
              ],
            },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.input[0].content).toEqual([
      { type: 'input_text', text: 'Inspect this' },
      { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
    ]);
  });

  it('streams output text, usage, and completion from Responses SSE', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'event: response.output_text.delta\n',
        'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
        'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":7,"output_tokens":2}}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(req(), { fetchImpl: fetchMock as unknown as typeof fetch }),
    );
    expect(textFromEvents(events)).toBe('Hello world');
    expect(events).toContainEqual({ type: 'usage', tokensIn: 7, tokensOut: 2 });
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

  it('maps dotted internal tool names to OpenAI-safe names and restores them on output', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: sseStream([
        'data: {"type":"response.function_call_arguments.done","call_id":"call-agent","name":"sync_think__agent__create","arguments":"{\\"name\\":\\"Reviewer\\"}"}\n\n',
        'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      ]),
      text: async () => '',
    } as unknown as Response);

    const events = await collect(
      streamOpenAIResponses(
        req({
          tools: [
            {
              name: 'sync_think.agent.create',
              description: 'Create an agent',
              inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          ],
          messages: [
            { role: 'user', content: 'Create a reviewer' },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolCall: {
                    id: 'call-previous',
                    name: 'sync_think.agent.create',
                    argumentsJson: '{"name":"Old"}',
                  },
                },
              ],
            },
          ],
        }),
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    );

    const requestBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(requestBody.tools[0].name).toBe('sync_think__agent__create');
    expect(requestBody.input).toContainEqual(
      expect.objectContaining({ name: 'sync_think__agent__create' }),
    );
    expect(events).toContainEqual({
      type: 'tool-call',
      toolCall: {
        id: 'call-agent',
        name: 'sync_think.agent.create',
        argumentsJson: '{"name":"Reviewer"}',
      },
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
