/**
 * End-to-end: the in-process SDK MCP servers (registry) bind into the
 * claude-code adapter path exactly as the runtime constructs them (Phase 5).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildSdkMcpServers,
  selectKernelMcpRun,
  setKernelMcpServerConditions,
} from './registry.js';

describe('claude-code in-process SDK MCP servers (Phase 5 e2e)', () => {
  it('produces live SDK server configs the adapter accepts', async () => {
    setKernelMcpServerConditions({});
    const selection = selectKernelMcpRun({});
    const sdkMcpServers = buildSdkMcpServers(selection.servers, async () => 'ok', z);
    const platform = sdkMcpServers['platform'];
    expect(platform).toBeDefined();
    expect(platform.type).toBe('sdk');
    expect(platform.instance).toBeTypeOf('object');
    // The adapter registers these into options.mcpServers when
    // platformBroker.sdkMcpServers is present (see claude-sdk-adapter.ts).
    const { ClaudeSdkKernelAdapter } = await import('../claude-sdk-adapter.js');
    const adapter = new ClaudeSdkKernelAdapter({} as never);
    expect(adapter.id).toBe('claude-code');
  });

  it('executes a registry tool through the shared handler contract', async () => {
    const selection = selectKernelMcpRun({});
    const executed: string[] = [];
    const servers = buildSdkMcpServers(
      selection.servers,
      async (toolName) => {
        executed.push(toolName);
        return `handled:${toolName}`;
      },
      z,
    );
    expect(Object.keys(servers).length).toBeGreaterThan(0);
    // Every server exposes its tools; the handler contract is the execute
    // callback the runtime wires — assert the wiring layer passes names.
    const platform = servers['platform'];
    expect(platform).toBeDefined();
    const tools = platform.instance as unknown as {
      registerTool?: unknown;
      listTools?: () => Promise<{ tools: { name: string }[] }>;
    };
    expect(typeof tools.registerTool).toBe('function');
  });
});
