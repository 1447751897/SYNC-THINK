import { describe, expect, it, vi } from 'vitest';
import { registerMcpToolHandlers, type McpToolHost } from './mcp-tool-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { ok: true };
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
    requestMcpTool: request as McpToolHost<string>['requestMcpTool'],
  };
  registerMcpToolHandlers(host);
  return { handlers, host, order, request, response };
}

describe('MCP tool operations IPC boundary', () => {
  it('registers the policy, execution and refresh command surface', () => {
    expect([...fixture().handlers.keys()]).toEqual([
      'runtime:mcp-policy-probe',
      'runtime:mcp-tool-request',
      'runtime:mcp-spawn-probe',
      'runtime:mcp-tool-call',
      'runtime:mcp-tools-refresh',
    ]);
  });

  it.each([
    ['runtime:mcp-policy-probe', undefined, 'mcp.policy.probe', {}],
    [
      'runtime:mcp-tool-request',
      { mcpServerId: ' server-1 ', toolName: ' inspect ', forceSensitive: true },
      'mcp.tool.request',
      {
        mcpServerId: 'server-1',
        toolName: 'inspect',
        argumentsJson: undefined,
        mode: undefined,
        forceSensitive: true,
        forceEnqueue: undefined,
        workspaceId: undefined,
        taskId: undefined,
      },
    ],
    ['runtime:mcp-spawn-probe', null, 'mcp.spawn.probe', {}],
    [
      'runtime:mcp-tool-call',
      {
        mcpServerId: ' server-1 ',
        toolName: ' inspect ',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
        runId: 'run-1',
        stepId: 'step-1',
        agentVersionId: 'agent-version-1',
        priorApprovalId: ' approval-1 ',
      },
      'mcp.tool.call',
      {
        mcpServerId: 'server-1',
        toolName: 'inspect',
        argumentsJson: undefined,
        mode: undefined,
        forceSensitive: undefined,
        forceEnqueue: undefined,
        executeIfAutoApproved: undefined,
        priorApprovalId: 'approval-1',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
        runId: 'run-1',
        stepId: 'step-1',
        agentVersionId: 'agent-version-1',
        maxOutputBytes: undefined,
        timeoutMs: undefined,
      },
    ],
    [
      'runtime:mcp-tools-refresh',
      { mcpServerId: ' server-1 ', maxTools: 64 },
      'mcp.tools.refresh',
      {
        mcpServerId: 'server-1',
        maxOutputBytes: undefined,
        timeoutMs: undefined,
        maxTools: 64,
      },
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
    await expect(handlers.get('runtime:mcp-tool-request')!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['runtime:mcp-policy-probe', { timeoutMs: Number.NaN }],
    ['runtime:mcp-tool-request', { toolName: '' }],
    ['runtime:mcp-spawn-probe', { trusted: 'yes' }],
    ['runtime:mcp-tool-call', { mcpServerId: 'server-1', toolName: 'inspect' }],
    ['runtime:mcp-tools-refresh', { mcpServerId: 'server-1', maxTools: 201 }],
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
    await expect(
      connectionFixture.handlers.get('runtime:mcp-policy-probe')!('trusted', {}),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get('runtime:mcp-tools-refresh')!('trusted', {
        mcpServerId: 'server-1',
      }),
    ).rejects.toBe(failure);
  });
});
