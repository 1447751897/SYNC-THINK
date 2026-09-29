import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { clearOutboundProxyCache } from '@sync-think/adapters';
import { OpenGatewayManager } from './manager.js';
import { createGatewayUpstreamFetch, formatGatewayUpstreamError } from './upstream-fetch.js';

const servers: Server[] = [];
const managers: OpenGatewayManager[] = [];
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture port');
  return address.port;
}
function manager(fetchImpl?: typeof fetch) {
  const instance = new OpenGatewayManager({
    listCatalog: () => [],
    resolveProviderSecret: async () => undefined,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  managers.push(instance);
  return instance;
}
afterEach(async () => {
  for (const entry of managers.splice(0)) await entry.stop();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.unstubAllEnvs();
  clearOutboundProxyCache();
});

describe('gateway outbound transport', () => {
  it.each([
    ['codex', 'openai-responses', '/openai/v1/responses', '/v1/responses'],
    ['claude-code', 'anthropic-messages', '/anthropic/v1/messages', '/v1/messages'],
  ] as const)(
    'routes %s through the configured proxy without resolving the provider locally',
    async (kernel, protocol, inbound, endpoint) => {
      const captured: { url?: string; body: string; auth?: string }[] = [];
      const port = await listen(
        createServer(async (req, res) => {
          let body = '';
          for await (const chunk of req) body += String(chunk);
          captured.push({
            url: req.url,
            body,
            auth:
              typeof req.headers.authorization === 'string'
                ? req.headers.authorization
                : String(req.headers['x-api-key']),
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'fixture-response',
              object: 'response',
              status: 'completed',
              output: [],
              type: 'message',
              content: [],
              role: 'assistant',
            }),
          );
        }),
      );
      vi.stubEnv('SYNC_THINK_HTTP_PROXY', 'http://127.0.0.1:' + port);
      clearOutboundProxyCache();
      const gateway = manager();
      await gateway.applySetting({ enabled: true, port: 0 });
      const ticket = gateway.issueTicket(
        'fixture-run',
        {
          baseUrl: 'http://provider.invalid/v1',
          protocol,
          providerModelId: 'selected-model',
          apiKey: 'fixture-secret',
        },
        kernel,
      )!;
      const response = await fetch('http://127.0.0.1:' + gateway.status().port + inbound, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + ticket, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'kernel-default',
          stream: false,
          input: 'hello',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 16,
        }),
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(200);
      await response.text();
      expect(captured).toHaveLength(1);
      expect(captured[0].url).toBe('http://provider.invalid' + endpoint);
      expect(JSON.parse(captured[0].body).model).toBe('selected-model');
      expect(captured[0].auth).toContain('fixture-secret');
      expect(gateway.listLogs().entries[0].status).toBe('success');
    },
  );

  it('keeps loopback providers direct while a proxy is configured', async () => {
    const proxyCalls = vi.fn();
    const proxyPort = await listen(
      createServer((_, res) => {
        proxyCalls();
        res.writeHead(502);
        res.end();
      }),
    );
    const localPort = await listen(createServer((_, res) => res.end('local model')));
    vi.stubEnv('SYNC_THINK_HTTP_PROXY', 'http://127.0.0.1:' + proxyPort);
    clearOutboundProxyCache();
    const response = await createGatewayUpstreamFetch()('http://127.0.0.1:' + localPort, {
      signal: AbortSignal.timeout(5000),
    });
    expect(await response.text()).toBe('local model');
    expect(proxyCalls).not.toHaveBeenCalled();
  });

  it('keeps explicit transport overrides for controlled runtimes', async () => {
    const transport = vi.fn(
      async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    );
    const gateway = manager(transport);
    await gateway.applySetting({ enabled: true, port: 0 });
    const ticket = gateway.issueTicket(
      'fixture-run',
      {
        baseUrl: 'https://provider.invalid',
        protocol: 'openai-responses',
        providerModelId: 'chosen',
        apiKey: 'fixture-secret',
      },
      'codex',
    );
    const response = await fetch(
      'http://127.0.0.1:' + gateway.status().port + '/openai/v1/responses',
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + ticket },
        body: JSON.stringify({ model: 'chosen', input: 'hello', stream: false }),
      },
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(transport).toHaveBeenCalledOnce();
  });
});

describe('gateway transport diagnostics', () => {
  it('extracts nested DNS causes without exposing the nested message or secret', () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('secret-token at https://private/'), { code: 'ENOTFOUND' }),
    });
    const message = formatGatewayUpstreamError(error);
    expect(message).toContain('ENOTFOUND');
    expect(message).toContain('DNS');
    expect(message).not.toContain('secret-token');
    expect(message).not.toContain('private');
  });
  it('handles aggregate errors and cycles with bounded traversal', () => {
    const refused = Object.assign(new Error('private-address'), {
      code: 'ECONNREFUSED',
      cause: undefined as unknown,
    });
    refused.cause = refused;
    const error = new TypeError('fetch failed', {
      cause: new AggregateError([refused, Object.assign(new Error(), { code: 'ETIMEDOUT' })]),
    });
    expect(formatGatewayUpstreamError(error)).toContain('ECONNREFUSED');
    expect(formatGatewayUpstreamError(error)).toContain('ETIMEDOUT');
  });
  it('retains non-network errors while removing the upstream secret', () => {
    expect(
      formatGatewayUpstreamError(new Error('bad value fixture-secret'), ['fixture-secret']),
    ).toBe('bad value [redacted]');
    expect(formatGatewayUpstreamError(new TypeError('fetch failed'))).toContain('代理');
    expect(formatGatewayUpstreamError(new DOMException('timeout', 'TimeoutError'))).toContain(
      '请求超时',
    );
  });
});
