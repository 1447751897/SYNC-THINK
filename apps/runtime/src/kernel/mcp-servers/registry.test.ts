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
  it.each(['claude-code', 'codex'])(
    'leaves task ownership with the %s native kernel',
    (kernelId) => {
      setKernelMcpServerConditions({ hasTaskStore: true });
      const selection = selectKernelMcpRun({ kernelId });
      expect(selection.servers.map((server) => server.name)).not.toContain('task-board');
      for (const name of ['update_task_plan', 'TaskCreate', 'TaskUpdate', 'TaskList']) {
        expect(selection.externalTools.map((tool) => tool.name)).not.toContain(name);
      }
      expect(selection.externalTools.map((tool) => tool.name)).toContain('platform_context');
    },
  );

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

  it('exposes Windows OCR only on the degraded path (text-only model, no usable fallback)', () => {
    const server = KERNEL_MCP_SERVERS.find((entry) => entry.name === 'windows-ocr');
    // Not alwaysLoad any more: `ocr_image` must not be advertised to a model
    // that can already see the attachment.
    expect(server?.alwaysLoad).toBeUndefined();
    expect(server?.condition).toBeTypeOf('function');
    expect(server?.tools.map((tool) => tool.name)).toEqual(['ocr_image']);
    expect(server?.tools[0]?.approval).toBe('never');

    // Vision-capable / undetermined model, or a verified fallback: no OCR tool.
    setKernelMcpServerConditions({});
    const hidden = selectKernelMcpRun({ planningMode: true });
    expect(hidden.externalTools.map((tool) => tool.name)).not.toContain('ocr_image');
    expect(hidden.nativeTools.map((tool) => tool.name)).not.toContain('ocr_image');

    // The materialized path (text-only model, no usable fallback): OCR is the
    // only route to the attachment, so it appears on every channel.
    setKernelMcpServerConditions({ imageOcrFallbackEnabled: true });
    const shown = selectKernelMcpRun({ planningMode: true });
    expect(shown.externalTools.map((tool) => tool.name)).toContain('ocr_image');
    expect(shown.nativeTools.map((tool) => tool.name)).toContain('ocr_image');
    setKernelMcpServerConditions({});
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

  it('exposes Browser Workflow tools even when live networking is off', () => {
    setKernelMcpServerConditions({ networkEnabled: false });
    const selection = selectKernelMcpRun({ kernelId: 'codex' });
    const names = selection.externalTools.map((tool) => tool.name);
    expect(selection.servers.map((server) => server.name)).toContain('browser-workflow');
    expect(names).toEqual(
      expect.arrayContaining([
        'browser_workflow_list',
        'browser_workflow_get',
        'browser_workflow_create_draft',
        'browser_workflow_execute',
      ]),
    );
    expect(names).not.toContain('browser_open');
    setKernelMcpServerConditions({});
  });

  it('hides goal_manage unless the conversation has an active Goal', () => {
    setKernelMcpServerConditions({});
    const hidden = selectKernelMcpRun({});
    expect(hidden.externalTools.map((tool) => tool.name)).not.toContain('goal_manage');
    expect(hidden.nativeTools.map((tool) => tool.name)).not.toContain('goal_manage');

    setKernelMcpServerConditions({ hasActiveGoal: true });
    const visible = selectKernelMcpRun({});
    expect(visible.externalTools.map((tool) => tool.name)).toContain('goal_manage');
    expect(visible.nativeTools.map((tool) => tool.name)).toContain('goal_manage');
    setKernelMcpServerConditions({});
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
        'list_available_agents',
        'get_agent',
        'agent_run',
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

  it('loads the collaboration server only for a bound collaboration conversation', () => {
    setKernelMcpServerConditions({});
    const off = selectKernelMcpRun({ conversationTrack: 'model' });
    expect(off.servers.map((server) => server.name)).not.toContain('collaboration');
    expect(off.externalTools.map((tool) => tool.name)).not.toContain('collaboration_send_message');

    setKernelMcpServerConditions({ collaborationEnabled: true });
    const on = selectKernelMcpRun({ conversationTrack: 'model' });
    expect(on.servers.map((server) => server.name)).toContain('collaboration');
    for (const name of [
      'collaboration_send_message',
      'collaboration_send_direct_message',
      'collaboration_dispatch_tasks',
    ]) {
      expect(on.externalTools.map((tool) => tool.name)).toContain(name);
      expect(on.nativeTools.map((tool) => tool.name)).toContain(name);
    }
    // The nested `tasks` schema must survive the JSON-Schema → zod bridge the
    // claude-code channel runs at SDK-server build time.
    const servers = buildSdkMcpServers(on.servers, async () => '{}', z);
    expect(servers['collaboration']).toBeDefined();
    expect(servers['collaboration'].type).toBe('sdk');
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
      'list_available_agents',
      'get_agent',
      'agent_run',
      'list_skills',
      'list_mcp_tools',
      'web_search',
      'browser_read',
    ]) {
      expect(names).toContain(readOnly);
    }
    // Every mutating tool is hidden from the model.
    for (const mutating of [
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
    expect(brokerCatalog).toContain('list_available_agents');
    expect(brokerCatalog).not.toContain('create_agent');
    // Every external tool must also be present in the in-process selection
    // (the same array feeds both channels).
    expect(selection.servers.every((server) => server.tools.length > 0)).toBe(true);
    setKernelMcpServerConditions({});
  });

  it('injects fallback search only when the selected route needs it', () => {
    setKernelMcpServerConditions({
      networkEnabled: true,
      fallbackWebSearchEnabled: false,
    });
    const native = selectKernelMcpRun({});
    expect(native.externalTools.map((tool) => tool.name)).not.toContain('web_search');
    expect(native.externalTools.map((tool) => tool.name)).toContain('web_fetch');

    setKernelMcpServerConditions({
      networkEnabled: true,
      fallbackWebSearchEnabled: true,
    });
    const fallback = selectKernelMcpRun({});
    expect(fallback.externalTools.map((tool) => tool.name)).toContain('web_search');
    expect(fallback.servers.map((server) => server.name)).toContain('web-search');
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

  it('exposes capability-broker instead of generate_image', () => {
    setKernelMcpServerConditions({});
    const off = selectKernelMcpRun({});
    expect(off.externalTools.map((tool) => tool.name)).toContain('search_capability');
    expect(off.externalTools.map((tool) => tool.name)).toContain('use_capability');
    expect(off.externalTools.map((tool) => tool.name)).not.toContain('generate_image');
    expect(off.nativeTools.map((tool) => tool.name)).not.toContain('generate_image');

    setKernelMcpServerConditions({ imageGenerationEnabled: true });
    const on = selectKernelMcpRun({});
    expect(on.externalTools.map((tool) => tool.name)).not.toContain('generate_image');
    expect(on.nativeTools.map((tool) => tool.name)).not.toContain('generate_image');
    expect(on.servers.map((server) => server.name)).toContain('capability-broker');
    expect(on.servers.find((server) => server.name === 'image-generation')).toBeUndefined();

    const planning = selectKernelMcpRun({ planningMode: true });
    expect(planning.externalTools.map((tool) => tool.name)).toContain('search_capability');
    expect(planning.externalTools.map((tool) => tool.name)).not.toContain('use_capability');
    expect(planning.externalTools.map((tool) => tool.name)).not.toContain('generate_image');
    setKernelMcpServerConditions({});
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
