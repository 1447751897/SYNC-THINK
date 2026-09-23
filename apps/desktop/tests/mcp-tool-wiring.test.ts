import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/mcp-tool-handlers.ts', import.meta.url),
  'utf8',
);
const runtimeClientSource = readFileSync(
  new URL('../src/main/runtime-client.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('MCP tool operations IPC wiring', () => {
  it('registers operations through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:mcp-policy-probe', 'mcp.policy.probe'],
      ['runtime:mcp-tool-request', 'mcp.tool.request'],
      ['runtime:mcp-spawn-probe', 'mcp.spawn.probe'],
      ['runtime:mcp-tool-call', 'mcp.tool.call'],
      ['runtime:mcp-tools-refresh', 'mcp.tools.refresh'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerMcpToolHandlers({');
    expect(mainSource).toContain('requestMcpTool:');
  });

  it('preserves long-running call and refresh timeout routing', () => {
    expect(runtimeClientSource).toContain("type === 'mcp.tools.refresh'");
    expect(runtimeClientSource).toContain("type === 'mcp.tool.call'");
    expect(runtimeClientSource).toContain('return MCP_REMOTE_REQUEST_TIMEOUT_MS');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:mcp-policy-probe',
      'runtime:mcp-tool-request',
      'runtime:mcp-spawn-probe',
      'runtime:mcp-tool-call',
      'runtime:mcp-tools-refresh',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('probeMcpPolicy(');
    expect(globalSource).toContain('requestMcpTool(');
    expect(globalSource).toContain('probeMcpSpawn(');
    expect(globalSource).toContain('callMcpTool(');
    expect(globalSource).toContain('refreshMcpTools(');
  });
});
