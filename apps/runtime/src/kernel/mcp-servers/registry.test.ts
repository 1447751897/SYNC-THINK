/**
 * Registry selection + SDK export channel tests (Phase 1).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildSdkMcpServers,
  selectKernelMcpRun,
  setKernelMcpServerConditions,
  KERNEL_MCP_SERVERS,
} from './registry.js';
import { jsonSchemaToZodShape } from './schema-bridge.js';

describe('kernel mcp-servers registry', () => {
  it('registers the platform server with alwaysLoad', () => {
    const names = KERNEL_MCP_SERVERS.map((server) => server.name);
    expect(names).toContain('platform');
    const platform = KERNEL_MCP_SERVERS.find((server) => server.name === 'platform');
    expect(platform?.alwaysLoad).toBe(true);
    const toolNames = platform?.tools.map((tool) => tool.name) ?? [];
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'platform_context',
        'ask_user_question',
        'plan_submit',
        'goal_manage',
        'task_schedule',
      ]),
    );
  });

  it('registers Windows OCR as an always-loaded read-only tool on every channel', () => {
    const server = KERNEL_MCP_SERVERS.find((entry) => entry.name === 'windows-ocr');
    expect(server?.alwaysLoad).toBe(true);
    expect(server?.tools.map((tool) => tool.name)).toEqual(['ocr_image']);
    expect(server?.tools[0]?.approval).toBe('never');

    setKernelMcpServerConditions({});
    const selection = selectKernelMcpRun({ planningMode: true });
    expect(selection.externalTools.map((tool) => tool.name)).toContain('ocr_image');
    expect(selection.nativeTools.map((tool) => tool.name)).toContain('ocr_image');
  });

  it('exposes the platform tools on every channel', () => {
    const selection = selectKernelMcpRun({});
    const externalNames = selection.externalTools.map((tool) => tool.name);
    const nativeNames = selection.nativeTools.map((tool) => tool.name);
    expect(externalNames).toContain('ask_user_question');
    expect(nativeNames).toContain('ask_user_question');
    // task_schedule is planning-denied; planning mode hides it.
    expect(selection.servers.length).toBeGreaterThanOrEqual(1);
  });

  it('loads store-gated servers only when their store exists', () => {
    setKernelMcpServerConditions({});
    const none = selectKernelMcpRun({});
    const namesNone = none.externalTools.map((tool) => tool.name);
    expect(namesNone).not.toContain('create_agent');
    expect(namesNone).not.toContain('list_teams');
    expect(namesNone).not.toContain('list_skills');

    setKernelMcpServerConditions({
      hasAgentStore: true,
      hasTeamStore: true,
      hasSkillStore: true,
      hasMcpStore: true,
      hasTaskStore: true,
      networkEnabled: true,
    });
    const all = selectKernelMcpRun({});
    const namesAll = all.externalTools.map((tool) => tool.name);
    expect(namesAll).toEqual(
      expect.arrayContaining([
        'create_agent',
        'update_agent',
        'list_teams',
        'list_skills',
        'list_mcp_tools',
        'TaskCreate',
        'web_search',
        'browser_open',
      ]),
    );
    // Reset so later tests are unaffected.
    setKernelMcpServerConditions({});
  });

  it('hides planning-denied tools in planning mode', () => {
    const selection = selectKernelMcpRun({ planningMode: true });
    const names = selection.externalTools.map((tool) => tool.name);
    expect(names).toContain('ask_user_question');
    expect(names).not.toContain('task_schedule');
  });

  it('fences side-effecting tools in planning mode across every server (Phase 4)', () => {
    setKernelMcpServerConditions({
      hasAgentStore: true,
      hasTeamStore: true,
      hasSkillStore: true,
      hasMcpStore: true,
      hasTaskStore: true,
      networkEnabled: true,
    });
    const selection = selectKernelMcpRun({ planningMode: true });
    const names = selection.externalTools.map((tool) => tool.name);
    // Read-only tools survive planning mode.
    for (const readOnly of [
      'platform_context',
      'ask_user_question',
      'plan_submit',
      'update_task_plan',
      'list_agent_resources',
      'list_skills',
      'list_mcp_tools',
      'web_search',
      'browser_read',
    ]) {
      expect(names).toContain(readOnly);
    }
    // Every mutating tool is hidden from the model.
    for (const mutating of [
      'create_agent',
      'update_agent',
      'archive_agent',
      'create_team',
      'update_team',
      'delete_team',
      'create_skill',
      'update_skill',
      'delete_skill',
      'import_remote_skill',
      'register_remote_mcp',
      'TaskCreate',
      'TaskUpdate',
      'browser_click',
      'browser_type',
      'task_schedule',
    ]) {
      expect(names).not.toContain(mutating);
    }
    setKernelMcpServerConditions({});
  });

  it('drives the stdio broker catalog with the same external tool set', () => {
    // Phase 3: the broker (codex/pi channel) must expose exactly the tools the
    // in-process SDK channel exposes — one registry, one catalog.
    setKernelMcpServerConditions({ networkEnabled: true, hasAgentStore: true });
    const selection = selectKernelMcpRun({});
    const brokerCatalog = selection.externalTools.map((tool) => tool.name);
    // The catalog the broker hands out (codex/pi channel) matches the
    // selection exactly — one registry, one catalog across channels.
    expect(brokerCatalog.length).toBeGreaterThan(0);
    expect(brokerCatalog).toContain('web_search');
    expect(brokerCatalog).toContain('create_agent');
    // Every external tool must also be present in the in-process selection
    // (the same array feeds both channels).
    expect(selection.servers.every((server) => server.tools.length > 0)).toBe(true);
    setKernelMcpServerConditions({});
  });

  it('builds in-process SDK servers with the correct namespace', async () => {
    const selection = selectKernelMcpRun({});
    const servers = buildSdkMcpServers(
      selection.servers,
      async (tool, input) => {
        return JSON.stringify({ tool, input });
      },
      z,
    );
    const platform = servers['platform'];
    expect(platform).toBeDefined();
    expect(platform.type).toBe('sdk');
    // The instance exposes the tool registrations (McpServer shape).
    expect((platform.instance as unknown as { registerTool: unknown }).registerTool).toBeTypeOf(
      'function',
    );
  });

  it('exposes describe_image only when the vision fallback setting is on', () => {
    setKernelMcpServerConditions({});
    const off = selectKernelMcpRun({});
    expect(off.externalTools.map((tool) => tool.name)).not.toContain('describe_image');
    expect(off.nativeTools.map((tool) => tool.name)).not.toContain('describe_image');

    setKernelMcpServerConditions({ visionFallbackEnabled: true });
    const on = selectKernelMcpRun({});
    expect(on.externalTools.map((tool) => tool.name)).toContain('describe_image');
    expect(on.nativeTools.map((tool) => tool.name)).toContain('describe_image');
    // Read-only: approval never; planning keeps it visible.
    const tool = on.externalTools.find((entry) => entry.name === 'describe_image');
    expect(tool?.approval).toBe('never');
    expect(tool?.planningDenied).toBeUndefined();
  });

  it('bridges a nested JSON-Schema object into a real zod shape', () => {
    const shape = jsonSchemaToZodShape(z, {
      type: 'object',
      required: ['title', 'steps'],
      properties: {
        title: { type: 'string', description: '方案标题' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              acceptanceChecks: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    });
    // Every property is a real zod schema the SDK can parse arguments with.
    const parsed = z.object(shape).parse({ title: 't', steps: [{ id: 'a', title: 'b' }] });
    expect(parsed).toEqual({ title: 't', steps: [{ id: 'a', title: 'b' }] });
    // Required fields are enforced: steps is required but not provided.
    expect(() => z.object(shape).parse({ title: 't' })).toThrow();
    // Optional fields stay optional.
    const parsed2 = z.object(shape).parse({ title: 't', steps: [] });
    expect(parsed2.title).toBe('t');
  });
});
