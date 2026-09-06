import { describe, expect, it } from 'vitest';
import {
  inspectMcpLaunch,
  mcpAvailability,
  resolveMcpVisual,
} from './mcp-identity.js';

describe('mcp identity', () => {
  it('resolves GitHub and Context7 instead of a generic server mark', () => {
    expect(resolveMcpVisual({ name: 'GitHub', endpoint: 'MCP_GITHUB_COMMAND' })).toEqual({
      id: 'github',
      kind: 'mark',
      mark: 'github',
    });
    expect(resolveMcpVisual({ name: 'context7', endpoint: 'https://mcp.context7.com/mcp' })).toEqual({
      id: 'context7',
      kind: 'favicon',
      src: 'https://www.google.com/s2/favicons?domain=context7.com&sz=64',
    });
  });

  it('treats bare MCP_* command tokens as unresolved environment variables', () => {
    expect(inspectMcpLaunch({ transport: 'local-stdio', endpoint: 'MCP_GITHUB_COMMAND' })).toEqual({
      kind: 'unresolved-env',
      label: '命令未配置',
    });
    expect(
      inspectMcpLaunch({
        transport: 'local-stdio',
        endpoint: 'npx -y @modelcontextprotocol/server-github',
      }).kind,
    ).toBe('ready');
    expect(inspectMcpLaunch({ transport: 'remote-http', endpoint: 'https://mcp.context7.com/mcp' }).kind).toBe(
      'ready',
    );
  });

  it('does not treat an unused GitHub env command as callable', () => {
    const github = mcpAvailability({
      enabled: false,
      trusted: true,
      tools: [],
      transport: 'local-stdio',
      endpoint: 'MCP_GITHUB_COMMAND',
      problemCount: 0,
    });
    expect(github).toEqual({ callable: false, issue: true, label: '命令未配置' });

    const context7 = mcpAvailability({
      enabled: true,
      trusted: true,
      tools: [{}, {}],
      transport: 'remote-http',
      endpoint: 'https://mcp.context7.com/mcp',
      problemCount: 0,
    });
    expect(context7).toEqual({ callable: true, issue: false, label: '2 个工具' });
  });
});
