import { describe, expect, it, vi } from 'vitest';
import {
  callRemoteMcpTool,
  discoverRemoteMcpTools,
  fetchRemoteSkillMd,
  parseRemoteHttpUrl,
  redactRemoteCapabilityError,
} from './remote-capability.js';

describe('remote capability transport', () => {
  it('normalizes GitHub blob URLs and fetches a bounded SKILL.md', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        'https://raw.githubusercontent.com/acme/repo/main/skills/demo/SKILL.md',
      );
      return new Response(
        '---\nname: remote-demo\ndescription: demo\nversion: 1.0.0\n---\nUse it.',
        {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        },
      );
    }) as unknown as typeof fetch;

    const result = await fetchRemoteSkillMd(
      'https://github.com/acme/repo/blob/main/skills/demo/SKILL.md',
      { fetchImpl },
    );

    expect(result.skillMd).toContain('name: remote-demo');
    expect(result.fetchedBytes).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('discovers remote MCP tools and sends the configured key without returning it', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer secret-canary');
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      bodies.push(body);
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: {
            tools: [
              {
                name: 'lookup',
                description: 'Lookup data',
                inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const tools = await discoverRemoteMcpTools('https://mcp.example.test/v1', {
      auth: { key: 'secret-canary', scheme: 'bearer' },
      fetchImpl,
    });

    expect(bodies.map((body) => body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
    ]);
    expect(tools).toEqual([
      {
        name: 'lookup',
        description: 'Lookup data',
        inputSchemaJson: JSON.stringify({
          type: 'object',
          properties: { query: { type: 'string' } },
        }),
      },
    ]);
    expect(JSON.stringify(tools)).not.toContain('secret-canary');
  });

  it('applies one timeout budget to the complete MCP handshake', async () => {
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return await new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (body.method === 'notifications/initialized') {
            resolve(new Response(null, { status: 202 }));
            return;
          }
          resolve(
            new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: body.method === 'tools/list' ? { tools: [] } : {},
              }),
              { status: 200 },
            ),
          );
        }, 15);
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('operation aborted', 'AbortError'));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      });
    }) as typeof fetch;

    await expect(
      discoverRemoteMcpTools('https://mcp.example.test/slow', {
        timeoutMs: 25,
        fetchImpl,
      }),
    ).rejects.toThrow(/abort/i);
  });

  it('accepts only absolute HTTP(S) URLs', () => {
    expect(parseRemoteHttpUrl('https://mcp.example.test/service').protocol).toBe('https:');
    expect(() => parseRemoteHttpUrl('file:///tmp/SKILL.md')).toThrow(/http/i);
    expect(() => parseRemoteHttpUrl('not-a-url')).toThrow(/URL/i);
    expect(() => parseRemoteHttpUrl('https://user:secret@mcp.example.test')).toThrow(/凭据/);
  });

  it('redacts supplied secrets even when a remote error echoes them as plain text', () => {
    const message = redactRemoteCapabilityError(
      new Error('remote rejected credential secret-canary in response body'),
      ['secret-canary'],
    );
    expect(message).toBe('remote rejected credential [REDACTED] in response body');
    expect(message).not.toContain('secret-canary');
  });

  it('rejects Skill HTTP errors and empty content', async () => {
    await expect(
      fetchRemoteSkillMd('https://skills.example.test/missing', {
        fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      fetchRemoteSkillMd('https://skills.example.test/empty', {
        fetchImpl: (async () => new Response('   ', { status: 200 })) as typeof fetch,
      }),
    ).rejects.toThrow(/为空/);
  });

  it('rejects both declared and actual Skill bodies above the byte limit', async () => {
    await expect(
      fetchRemoteSkillMd('https://skills.example.test/declared-large', {
        maxBytes: 8,
        fetchImpl: (async () =>
          new Response('small', {
            status: 200,
            headers: { 'content-length': '9' },
          })) as typeof fetch,
      }),
    ).rejects.toThrow(/超过 8 字节/);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('12345'));
        controller.enqueue(new TextEncoder().encode('6789'));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      fetchRemoteSkillMd('https://skills.example.test/actual-large', {
        maxBytes: 8,
        fetchImpl: (async () => new Response(body, { status: 200 })) as typeof fetch,
      }),
    ).rejects.toThrow(/超过 8 字节/);
    expect(cancelled).toBe(true);
  });

  it('keeps the timeout active while streaming the response body', async () => {
    let aborted = false;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => {
              aborted = true;
              controller.error(new DOMException('body aborted', 'AbortError'));
            },
            { once: true },
          );
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof fetch;

    await expect(
      fetchRemoteSkillMd('https://skills.example.test/slow-body', {
        timeoutMs: 10,
        fetchImpl,
      }),
    ).rejects.toThrow(/abort/i);
    expect(aborted).toBe(true);
  });

  it('initializes a remote session before tools/call and returns bounded text', async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      methods.push(String(body.method));
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), {
          status: 200,
          headers: { 'mcp-session-id': 'session-1' },
        });
      }
      expect(new Headers(init?.headers).get('mcp-session-id')).toBe('session-1');
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { content: [{ type: 'text', text: 'remote result' }] },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const called = await callRemoteMcpTool(
      'https://mcp.example.test/v1',
      'lookup',
      { q: 'status' },
      { fetchImpl },
    );

    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/call']);
    expect(called).toMatchObject({ ok: true, text: 'remote result', sessionId: 'session-1' });
  });
});
