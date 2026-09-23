import { describe, expect, it, vi } from 'vitest';
import { registerMcpRegistryHandlers, type McpRegistryHost } from './mcp-registry-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { servers: [] };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestMcpRegistry: request as McpRegistryHost<string>['requestMcpRegistry'],
  };
  registerMcpRegistryHandlers(host);
  return { handlers, host, order, request, response };
}

describe('MCP registry IPC boundary', () => {
  it('registers the registry lifecycle command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:mcp-register',
      'runtime:mcp-register-remote',
      'runtime:mcp-list',
      'runtime:mcp-set-enabled',
      'runtime:mcp-delete',
    ]);
  });

  it.each([
    [
      'runtime:mcp-register',
      {
        name: ' Local tools ',
        transport: 'local-stdio',
        endpoint: 'node server.js',
        key: ' secret ',
        tools: [{ name: ' inspect ', description: 'Inspect workspace' }],
      },
      'mcp.register',
      {
        name: 'Local tools',
        transport: 'local-stdio',
        endpoint: 'node server.js',
        key: 'secret',
        apiKey: undefined,
        authScheme: undefined,
        tools: [{ name: 'inspect', description: 'Inspect workspace', inputSchemaJson: undefined }],
        trusted: undefined,
        maxOutputBytes: undefined,
        timeoutMs: undefined,
        notes: undefined,
      },
    ],
    [
      'runtime:mcp-register-remote',
      {
        name: ' Remote tools ',
        endpoint: ' https://example.com/mcp ',
        apiKey: ' secret ',
        authScheme: ' bearer ',
        discoverTools: false,
      },
      'mcp.registerRemote',
      {
        name: 'Remote tools',
        endpoint: 'https://example.com/mcp',
        key: 'secret',
        apiKey: 'secret',
        authScheme: 'bearer',
        discoverTools: false,
        tools: undefined,
        trusted: undefined,
        maxOutputBytes: undefined,
        timeoutMs: undefined,
        notes: undefined,
      },
    ],
    ['runtime:mcp-list', { limit: 20 }, 'mcp.list', { limit: 20 }],
    [
      'runtime:mcp-set-enabled',
      { mcpServerId: ' server-1 ', enabled: false },
      'mcp.setEnabled',
      { mcpServerId: 'server-1', enabled: false },
    ],
    [
      'runtime:mcp-delete',
      { mcpServerId: ' server-1 ' },
      'mcp.delete',
      { mcpServerId: 'server-1' },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get('runtime:mcp-register')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime:mcp-register', { name: '' }],
    ['runtime:mcp-register-remote', { name: 'remote', endpoint: 'file:///tmp/server' }],
    ['runtime:mcp-list', { limit: Number.NaN }],
    ['runtime:mcp-set-enabled', { mcpServerId: 'server-1', enabled: 'yes' }],
    ['runtime:mcp-delete', {}],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(connectionFixture.handlers.get('runtime:mcp-list')!('trusted', {})).rejects.toBe(
      offline,
    );
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:mcp-delete')!('trusted', {
        mcpServerId: 'server-1',
      }),
    ).rejects.toBe(failure);
  });
});
