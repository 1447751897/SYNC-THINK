import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIChatAdapter } from './openai-chat-adapter.js';
import {
  discoverOpenAICompatibleModels,
  joinModelsUrl,
  normalizeOpenAICompatibleBaseUrl,
  ProviderDiscoveryError,
  scrubSecrets,
} from './discover-models.js';
import { OpenAIResponsesAdapter } from '../openai-responses-adapter.js';

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

function jsonResponse(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('joinModelsUrl', () => {
  it('appends /models once', () => {
    expect(joinModelsUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models');
    expect(joinModelsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/models');
    expect(joinModelsUrl('https://gw.example/v1/models')).toBe('https://gw.example/v1/models');
  });

  it('adds /v1 for host-only base URLs from CC Switch imports', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://www.kamenking.top')).toBe(
      'https://www.kamenking.top/v1',
    );
    expect(joinModelsUrl('https://www.kamenking.top')).toBe('https://www.kamenking.top/v1/models');
    expect(joinModelsUrl('https://www.kamenking.top/')).toBe('https://www.kamenking.top/v1/models');
  });
});

describe('scrubSecrets', () => {
  it('redacts sk- keys and bearer tokens', () => {
    const secret = 'sk-LIVE_SECRET_ABCDEFG_123456';
    expect(scrubSecrets(`auth ${secret} Bearer ${secret}`, [secret])).not.toContain(secret);
    expect(scrubSecrets(`Bearer abc.def-ghi`, [])).toBe('Bearer [REDACTED]');
  });
});

describe('discoverOpenAICompatibleModels', () => {
  const fetchMock = vi.fn<(...args: unknown[]) => Promise<FetchResponse>>();

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('returns model ids from OpenAI list shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
      }),
    );

    const models = await discoverOpenAICompatibleModels({
      apiKey: 'sk-TEST_KEY_FOR_DISCOVERY_001',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(models).toEqual(['gpt-4o-mini', 'gpt-4o']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init).toMatchObject({
      method: 'GET',
      headers: {
        Authorization: 'Bearer sk-TEST_KEY_FOR_DISCOVERY_001',
        Accept: 'application/json',
      },
    });
  });

  it('accepts models array gateway variant', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        models: [{ id: 'deepseek-chat' }, { model: 'deepseek-reasoner' }],
      }),
    );
    const models = await discoverOpenAICompatibleModels({
      apiKey: 'sk-xx',
      baseUrl: 'https://api.deepseek.com/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(models).toEqual(['deepseek-chat', 'deepseek-reasoner']);
  });

  it('maps 401 to auth failure without leaking the key', async () => {
    const secret = 'sk-LEAK_ME_IN_ERROR_BODY_999999';
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { message: `Invalid API key ${secret}` } }),
    );

    await expect(
      discoverOpenAICompatibleModels({
        apiKey: secret,
        baseUrl: 'https://api.openai.com/v1',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: 'ProviderDiscoveryError',
      failureClass: 'auth',
      status: 401,
    });

    try {
      await discoverOpenAICompatibleModels({
        apiKey: secret,
        baseUrl: 'https://api.openai.com/v1',
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(message).toMatch(/REDACTED|auth failed/i);
    }
  });

  it('maps 429 to rate-limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { error: { message: 'slow down' } }));
    await expect(
      discoverOpenAICompatibleModels({
        apiKey: 'sk-test',
        baseUrl: 'https://gw.example/v1',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ failureClass: 'rate-limit', status: 429 });
  });

  it('maps timeout abort to timeout failure', async () => {
    fetchMock.mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        if (signal?.aborted) {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    await expect(
      discoverOpenAICompatibleModels({
        apiKey: 'sk-test',
        baseUrl: 'https://gw.example/v1',
        fetchImpl: fetchMock as unknown as typeof fetch,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({
      failureClass: 'timeout',
      message: expect.stringMatching(/timed out/i),
    });
  });

  it('rejects non-JSON success body as protocol error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>not json</html>',
    });
    await expect(
      discoverOpenAICompatibleModels({
        apiKey: 'sk-test',
        baseUrl: 'https://gw.example/v1',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(ProviderDiscoveryError);
  });
});

describe('OpenAIChatAdapter.discoverModels', () => {
  it('delegates to OpenAI-compatible discovery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: [{ id: 'gpt-test-1' }, { id: 'gpt-test-2' }] }),
    );
    const adapter = new OpenAIChatAdapter({ fetchImpl: fetchMock as unknown as typeof fetch });
    await expect(
      adapter.discoverModels('sk-abc', 'https://proxy.example/v1'),
    ).resolves.toEqual(['gpt-test-1', 'gpt-test-2']);
    expect(adapter.protocol).toBe('openai-chat');
  });
});

describe('OpenAIResponsesAdapter.discoverModels', () => {
  it('uses the same OpenAI-compatible /models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: [{ id: 'o3-mini' }] }),
    );
    const adapter = new OpenAIResponsesAdapter({
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(
      adapter.discoverModels('sk-abc', 'https://api.openai.com/v1'),
    ).resolves.toEqual(['o3-mini']);
    expect(adapter.protocol).toBe('openai-responses');
  });
});

