import { describe, expect, it } from 'vitest';
import { mcpTestApi } from './mcp-server.js';

describe('SYNC-THINK MCP stdio protocol', () => {
  it('parses newline JSON-RPC requests and negotiates supported versions', () => {
    expect(
      mcpTestApi.parseRequest(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      ),
    ).toMatchObject({ id: 1, method: 'tools/list' });
    expect(mcpTestApi.requestedProtocolVersion({ protocolVersion: '2024-11-05' })).toBe(
      '2024-11-05',
    );
    expect(mcpTestApi.requestedProtocolVersion({ protocolVersion: 'unknown' })).toBe('2025-06-18');
  });

  it('rejects malformed JSON-RPC envelopes', () => {
    expect(() => mcpTestApi.parseRequest('{')).toThrow();
    expect(() =>
      mcpTestApi.parseRequest(JSON.stringify({ jsonrpc: '1.0', method: 'tools/list' })),
    ).toThrow(/Invalid JSON-RPC/);
  });

  it('strips the MCP confirmation field and forwards it as Runtime frame metadata', async () => {
    const calls: unknown[][] = [];
    const client = {
      request: async (...args: unknown[]) => {
        calls.push(args);
        return { ok: true };
      },
    };

    const response = await mcpTestApi.handleRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'sync_think.agent.create',
          arguments: {
            name: 'Planner',
            _confirmationToken: 'confirm-123',
          },
        },
      },
      client,
    );

    expect(calls).toEqual([
      ['agent.create', { name: 'Planner' }, { confirmationToken: 'confirm-123' }],
    ]);
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 2 });
  });

  it('forwards collaboration tools to the same Runtime command gateway', async () => {
    const calls: unknown[][] = [];
    const client = {
      request: async (...args: unknown[]) => {
        calls.push(args);
        return { ok: true };
      },
    };

    await mcpTestApi.handleRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'sync_think.subtask.delegate',
          arguments: {
            workspaceId: 'workspace-1',
            parentTaskId: 'task-parent',
            delegateAgentVersionId: 'agent-worker',
            title: 'Focused task',
            goal: 'Implement parser',
          },
        },
      },
      client,
    );
    await mcpTestApi.handleRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'sync_think.handoff.record',
          arguments: {
            taskId: 'task-child',
            fromAgentVersionId: 'agent-worker',
            toAgentVersionId: 'agent-lead',
            summary: 'Done',
          },
        },
      },
      client,
    );

    expect(calls).toEqual([
      [
        'task.delegateSubtask',
        {
          workspaceId: 'workspace-1',
          parentTaskId: 'task-parent',
          delegateAgentVersionId: 'agent-worker',
          title: 'Focused task',
          goal: 'Implement parser',
        },
        { confirmationToken: undefined },
      ],
      [
        'task.recordHandoff',
        {
          taskId: 'task-child',
          fromAgentVersionId: 'agent-worker',
          toAgentVersionId: 'agent-lead',
          summary: 'Done',
        },
        { confirmationToken: undefined },
      ],
    ]);
  });
});
