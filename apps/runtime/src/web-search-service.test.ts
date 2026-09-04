import { describe, expect, it, vi } from 'vitest';
import { searchWebWithProviders, type ResolvedWebSearchProvider } from './web-search-service.js';

function providers(): ResolvedWebSearchProvider[] {
  return [
    { id: 'brave', apiKey: 'brave-secret' },
    { id: 'tavily', apiKey: 'tavily-secret' },
  ];
}

describe('searchWebWithProviders', () => {
  it('fails over in priority order and returns structured source metadata', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://api.search.brave.com/')) {
        return new Response('rate limited', { status: 429 });
      }
      if (url === 'https://api.tavily.com/search') {
        return Response.json({
          results: [
            {
              title: 'OpenAI Codex',
              url: 'https://developers.openai.com/codex/',
              content: 'Official Codex documentation.',
            },
          ],
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const result = await searchWebWithProviders({
      query: 'OpenAI Codex official',
      limit: 5,
      providers: providers(),
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
    });

    expect(result).toEqual({
      ok: true,
      query: 'OpenAI Codex official',
      providerId: 'tavily',
      attemptedProviderIds: ['brave', 'tavily'],
      failedProviderIds: ['brave'],
      results: [
        {
          title: 'OpenAI Codex',
          url: 'https://developers.openai.com/codex/',
          snippet: 'Official Codex documentation.',
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('honors an explicit provider without silently trying another one', async () => {
    const fetchImpl = vi.fn(async () => new Response('bad key', { status: 401 }));

    const result = await searchWebWithProviders({
      query: 'fixture',
      limit: 3,
      providerId: 'brave',
      providers: providers(),
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
    });

    expect(result.ok).toBe(false);
    expect(result.attemptedProviderIds).toEqual(['brave']);
    expect(result.failedProviderIds).toEqual(['brave']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('scrubs provider credentials from network failure messages', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('request failed: api_key=brave-secret&secret=secondary-secret');
    });

    const result = await searchWebWithProviders({
      query: 'fixture',
      providers: [{ id: 'brave', apiKey: 'brave-secret', secretKey: 'secondary-secret' }],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(JSON.stringify(result)).not.toContain('brave-secret');
    expect(JSON.stringify(result)).not.toContain('secondary-secret');
  });

  it('fails over when a provider responds without any usable URLs', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith('https://api.search.brave.com/')) {
        return Response.json({ web: { results: [] } });
      }
      return Response.json({
        results: [{ title: 'Fallback', url: 'https://example.com/', content: 'Found later.' }],
      });
    });

    const result = await searchWebWithProviders({
      query: 'fallback fixture',
      providers: providers(),
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: 'tavily',
      attemptedProviderIds: ['brave', 'tavily'],
      failedProviderIds: ['brave'],
    });
  });

  it('reports a configuration error immediately when no provider is enabled', async () => {
    const result = await searchWebWithProviders({
      query: 'fixture',
      limit: 3,
      providers: [],
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'SEARCH_PROVIDER_NOT_CONFIGURED',
      attemptedProviderIds: [],
    });
  });

  it('parses the no-key DuckDuckGo HTML fallback', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          `
      <div class="result results_links results_links_deep web-result">
        <h2 class="result__title">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example docs</a>
        </h2>
        <a class="result__snippet">An example search result.</a>
      </div>
    `,
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
    );

    const result = await searchWebWithProviders({
      query: 'example docs',
      providers: [{ id: 'duckduckgo', apiKey: '' }],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: 'duckduckgo',
      results: [{ title: 'Example docs', url: 'https://example.com/docs' }],
    });
  });

  it('parses Bing RSS as a no-key search route with clean source URLs', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe('https://www.bing.com/search');
      expect(url.searchParams.get('q')).toBe('OpenAI official');
      expect(url.searchParams.get('format')).toBe('rss');
      return new Response(
        `<?xml version="1.0" encoding="utf-8"?>
          <rss><channel><item>
            <title>OpenAI &amp; API</title>
            <link>https://openai.com/api/</link>
            <description>Official &lt;strong&gt;API&lt;/strong&gt; documentation.</description>
          </item></channel></rss>`,
        { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } },
      );
    });

    const result = await searchWebWithProviders({
      query: 'OpenAI official',
      providers: [{ id: 'bing-rss', apiKey: '' }],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: 'bing-rss',
      results: [
        {
          title: 'OpenAI & API',
          url: 'https://openai.com/api/',
          snippet: 'Official API documentation.',
        },
      ],
    });
  });

  it('falls through a failed no-key endpoint instead of leaving search pending', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://html.duckduckgo.com/')) {
        throw new TypeError('fetch failed');
      }
      return new Response(
        '<rss><channel><item><title>Fallback result</title><link>https://example.com/</link><description>Recovered.</description></item></channel></rss>',
        { status: 200, headers: { 'content-type': 'text/xml' } },
      );
    });

    const result = await searchWebWithProviders({
      query: 'fallback fixture',
      providers: [
        { id: 'duckduckgo', apiKey: '' },
        { id: 'bing-rss', apiKey: '' },
      ],
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      overallTimeoutMs: 2_000,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: 'bing-rss',
      attemptedProviderIds: ['duckduckgo', 'bing-rss'],
      failedProviderIds: ['duckduckgo'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('signs Volcengine Doubao searches in AK/SK mode without exposing the secret', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        'https://mercury.volcengineapi.com/?Action=WebSearch&Version=2025-01-01',
      );
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^HMAC-SHA256 Credential=access-key\//);
      expect(headers.Authorization).toContain('/cn-beijing/volc_torchlight_api/request');
      expect(headers.Authorization).not.toContain('secret-key');
      expect(headers['X-Date']).toMatch(/^\d{8}T\d{6}Z$/);
      expect(headers['X-Traffic-Tag']).toBe('skill_web_search_common');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        Query: '火山引擎',
        SearchType: 'web',
        NeedSummary: true,
      });
      return Response.json({
        Result: {
          WebResults: [
            { Title: '火山引擎', Url: 'https://www.volcengine.com/', Summary: '云服务' },
          ],
        },
      });
    });

    const result = await searchWebWithProviders({
      query: '火山引擎',
      providers: [{ id: 'doubao', apiKey: 'access-key', secretKey: 'secret-key' }],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: 'doubao',
      results: [{ title: '火山引擎', url: 'https://www.volcengine.com/' }],
    });
  });

  it('uses NewMax-compatible Doubao API-key transport fields', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://open.feedcoopapi.com/search_api/web_search');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer api-key');
      expect(headers['X-Traffic-Tag']).toBe('skill_web_search_common');
      expect(JSON.parse(String(init?.body))).toEqual({
        Query: '新闻',
        SearchType: 'web',
        Count: 5,
        NeedSummary: true,
      });
      return Response.json({
        Result: {
          WebResults: [{ Title: '今日新闻', Url: 'https://example.com/news', Snippet: '摘要' }],
        },
      });
    });

    const result = await searchWebWithProviders({
      query: '新闻',
      providers: [{ id: 'doubao', apiKey: 'api-key' }],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: 'doubao',
      results: [{ title: '今日新闻', url: 'https://example.com/news', snippet: '摘要' }],
    });
  });

  it('parses NewMax-compatible Metaso references and Firecrawl v2 web results', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === 'https://metaso.cn/api/open/search/v2') {
        return Response.json({
          errCode: 0,
          data: {
            references: [
              { title: '秘塔结果', url: 'https://example.com/metaso', text: '中文摘要' },
            ],
          },
        });
      }
      return Response.json({
        success: true,
        data: {
          web: [
            {
              title: 'Firecrawl result',
              url: 'https://example.com/firecrawl',
              description: 'Crawled summary',
            },
          ],
        },
      });
    });

    const metaso = await searchWebWithProviders({
      query: '中文资料',
      providers: [{ id: 'metaso', apiKey: 'metaso-key' }],
      fetchImpl: fetchImpl as typeof fetch,
    });
    const firecrawl = await searchWebWithProviders({
      query: 'crawl docs',
      providers: [{ id: 'firecrawl', apiKey: 'firecrawl-key' }],
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(metaso).toMatchObject({
      ok: true,
      results: [{ title: '秘塔结果', url: 'https://example.com/metaso' }],
    });
    expect(firecrawl).toMatchObject({
      ok: true,
      results: [{ title: 'Firecrawl result', url: 'https://example.com/firecrawl' }],
    });
  });

  it('keeps the provider deadline active while a response body is stalled', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      return {
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
              once: true,
            });
          }),
      } as Response;
    });

    const result = await searchWebWithProviders({
      query: 'stalled body',
      providers: [{ id: 'brave', apiKey: 'brave-secret' }],
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 100,
      overallTimeoutMs: 500,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'SEARCH_PROVIDER_FAILED',
      attemptedProviderIds: ['brave'],
      failedProviderIds: ['brave'],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
