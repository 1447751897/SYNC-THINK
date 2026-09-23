import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/mcp-registry-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('MCP registry IPC wiring', () => {
  it('registers lifecycle commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:mcp-register', 'mcp.register'],
      ['runtime:mcp-register-remote', 'mcp.registerRemote'],
      ['runtime:mcp-list', 'mcp.list'],
      ['runtime:mcp-set-enabled', 'mcp.setEnabled'],
      ['runtime:mcp-delete', 'mcp.delete'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerMcpRegistryHandlers({');
    expect(mainSource).toContain('requestMcpRegistry:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:mcp-register',
      'runtime:mcp-register-remote',
      'runtime:mcp-list',
      'runtime:mcp-set-enabled',
      'runtime:mcp-delete',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('registerMcpServer(');
    expect(globalSource).toContain('registerRemoteMcpServer(');
    expect(globalSource).toContain('listMcpServers(');
    expect(globalSource).toContain('setMcpServerEnabled(');
    expect(globalSource).toContain('deleteMcpServer(');
  });
});
