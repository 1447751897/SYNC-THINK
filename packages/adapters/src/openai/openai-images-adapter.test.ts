import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';

import {
  OpenAIImagesAdapter,
  ProviderImageGenerationError,
  joinImagesGenerationUrl,
} from './openai-images-adapter.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);

function request(overrides: Partial<Parameters<OpenAIImagesAdapter['generateImages']>[0]> = {}) {
  return {
    protocol: 'openai-images' as const,
    baseUrl: 'https://gateway.test/v1',
    modelId: 'image-model',
    apiKey: 'sk-secret-value',
    idempotencyKey: 'run:step:1',
    signal: new AbortController().signal,
    prompt: 'Draw a calm blue lake',
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenAIImagesAdapter', () => {
  it('posts a base64 image request and decodes ordered images', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return jsonResponse({
        data: [
          { b64_json: PNG.toString('base64'), revised_prompt: 'clean lake' },
          { b64_json: JPEG.toString('base64') },
        ],
      });
    });
    const adapter = new OpenAIImagesAdapter({ fetchImpl: fetchMock as typeof fetch });

    const result = await adapter.generateImages(
      request({
        count: 2,
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        background: 'transparent',
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.test/v1/images/generations');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk-secret-value',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'run:step:1',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'image-model',
      prompt: 'Draw a calm blue lake',
      n: 2,
      response_format: 'b64_json',
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
      background: 'transparent',
    });
    expect(result.images.map((image) => image.mimeType)).toEqual(['image/png', 'image/jpeg']);
    expect(Buffer.from(result.images[0]!.bytes)).toEqual(PNG);
    expect(result.images[0]!.revisedPrompt).toBe('clean lake');
  });

  it.each([
    ['host root', 'https://gateway.test', 'https://gateway.test/v1/images/generations'],
    ['v1 root', 'https://gateway.test/v1/', 'https://gateway.test/v1/images/generations'],
    ['images root', 'https://gateway.test/v1/images', 'https://gateway.test/v1/images/generations'],
    [
      'generation endpoint',
      'https://gateway.test/v1/images/generations',
      'https://gateway.test/v1/images/generations',
    ],
  ])('joins the %s safely', (_label, baseUrl, expected) => {
    expect(joinImagesGenerationUrl(baseUrl)).toBe(expected);
  });

  it('runs the real fetch path against an OpenAI-compatible HTTP fixture', async () => {
    const requests: Array<{
      url: string;
      authorization: string;
      idempotencyKey: string;
      body: Record<string, unknown>;
    }> = [];
    const server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        requests.push({
          url: incoming.url ?? '',
          authorization: String(incoming.headers.authorization ?? ''),
          idempotencyKey: String(incoming.headers['idempotency-key'] ?? ''),
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        });
        if (requests.length === 1) {
          response.writeHead(503, { 'content-type': 'text/plain' });
          response.end('fixture outage');
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            data: [
              { b64_json: PNG.toString('base64'), revised_prompt: 'fixture prompt' },
              { b64_json: JPEG.toString('base64') },
            ],
          }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('fixture server did not bind');
      const adapter = new OpenAIImagesAdapter({
        timeoutMs: 2_000,
        maxRetries: 1,
        retryBaseDelayMs: 0,
      });
      const result = await adapter.generateImages(
        request({
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          count: 2,
          size: '1024x1024',
          quality: 'high',
        }),
      );

      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({
        url: '/v1/images/generations',
        authorization: 'Bearer sk-secret-value',
        idempotencyKey: 'run:step:1',
        body: {
          model: 'image-model',
          prompt: 'Draw a calm blue lake',
          n: 2,
          response_format: 'b64_json',
          size: '1024x1024',
          quality: 'high',
        },
      });
      expect(requests[1]!.idempotencyKey).toBe(requests[0]!.idempotencyKey);
      expect(result.images.map((image) => image.mimeType)).toEqual(['image/png', 'image/jpeg']);
      expect(Buffer.from(result.images[0]!.bytes)).toEqual(PNG);
      expect(Buffer.from(result.images[1]!.bytes)).toEqual(JPEG);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('retries transient HTTP failures with the same idempotency key', async () => {
    const calls: RequestInit[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      if (calls.length === 1) return new Response('temporary outage', { status: 503 });
      return jsonResponse({ data: [{ b64_json: PNG.toString('base64') }] });
    });
    const adapter = new OpenAIImagesAdapter({
      fetchImpl: fetchMock as typeof fetch,
      maxRetries: 1,
      retryBaseDelayMs: 0,
    });

    const result = await adapter.generateImages(request());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      calls.map((init) => (init.headers as Record<string, string>)['Idempotency-Key']),
    ).toEqual(['run:step:1', 'run:step:1']);
    expect(result.images).toHaveLength(1);
  });

  it('does not retry protocol failures even when retries are configured', async () => {
    const fetchMock = vi.fn(async () => new Response('invalid request', { status: 400 }));
    const adapter = new OpenAIImagesAdapter({
      fetchImpl: fetchMock as typeof fetch,
      maxRetries: 4,
      retryBaseDelayMs: 0,
    });

    await expect(adapter.generateImages(request())).rejects.toMatchObject({
      failureClass: 'protocol',
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate-limit'],
    [400, 'protocol'],
    [503, 'transient'],
  ])('classifies HTTP %s as %s and scrubs secrets', async (status, failureClass) => {
    const fetchMock = vi.fn(async () => new Response(`failure for sk-secret-value`, { status }));
    const adapter = new OpenAIImagesAdapter({ fetchImpl: fetchMock as typeof fetch });

    const error = await adapter.generateImages(request()).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ProviderImageGenerationError);
    expect(error).toMatchObject({ failureClass, status });
    expect(String(error)).not.toContain('sk-secret-value');
  });

  it('rejects non-JSON and remote-URL-only responses', async () => {
    const responses = [
      new Response('<html>bad gateway</html>', { status: 200 }),
      jsonResponse({ data: [{ url: 'https://cdn.test/temporary.png' }] }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const adapter = new OpenAIImagesAdapter({ fetchImpl: fetchMock as typeof fetch });

    await expect(adapter.generateImages(request())).rejects.toMatchObject({
      failureClass: 'protocol',
    });
    await expect(adapter.generateImages(request())).rejects.toThrow(/remote URL/i);
  });

  it('rejects invalid base64 and unsupported image bytes', async () => {
    const responses = [
      jsonResponse({ data: [{ b64_json: '***' }] }),
      jsonResponse({ data: [{ b64_json: Buffer.from('not-an-image').toString('base64') }] }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const adapter = new OpenAIImagesAdapter({ fetchImpl: fetchMock as typeof fetch });

    await expect(adapter.generateImages(request())).rejects.toThrow(/invalid base64/i);
    await expect(adapter.generateImages(request())).rejects.toThrow(/unsupported format/i);
  });

  it('bounds the requested image count before network access', async () => {
    const fetchMock = vi.fn();
    const adapter = new OpenAIImagesAdapter({ fetchImpl: fetchMock as typeof fetch });

    await expect(adapter.generateImages(request({ count: 5 as never }))).rejects.toMatchObject({
      failureClass: 'acceptance',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'size', value: '2048x2048' },
    { field: 'quality', value: 'ultra' },
  ])('rejects invalid $field before network access', async ({ field, value }) => {
    const fetchMock = vi.fn();
    const adapter = new OpenAIImagesAdapter({ fetchImpl: fetchMock as typeof fetch });

    await expect(
      adapter.generateImages(request({ [field]: value } as never)),
    ).rejects.toMatchObject({ failureClass: 'acceptance' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies network failures and timeouts without exposing credentials', async () => {
    const network = new OpenAIImagesAdapter({
      fetchImpl: vi.fn(async () => {
        throw new Error('socket sk-secret-value closed');
      }) as unknown as typeof fetch,
    });
    const networkError = await network.generateImages(request()).catch((value: unknown) => value);
    expect(networkError).toMatchObject({ failureClass: 'transient' });
    expect(String(networkError)).not.toContain('sk-secret-value');

    const timeout = new OpenAIImagesAdapter({
      timeoutMs: 5,
      fetchImpl: vi.fn(
        async (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              { once: true },
            );
          }),
      ) as unknown as typeof fetch,
    });
    await expect(timeout.generateImages(request())).rejects.toMatchObject({
      failureClass: 'timeout',
    });
  });
});
