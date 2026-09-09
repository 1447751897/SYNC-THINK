/**
 * Host platform tool channel regression:
 *
 * 1. The native (model-track) tool list must always include the host platform
 *    tools — ask_user_question / plan_submit / goal_manage / task_schedule /
 *    platform_context / task_list / agent_list — even for a pure chat with no
 *    bound workspace and no network (they used to vanish because `tools` were
 *    only assembled when a workspace/network/agent capability was present).
 * 2. The native tool loop must route these names into the unified executor
 *    (`CHAT_PLATFORM_HOST_TOOL_NAMES`); without it ask_user_question answered
 *    "unknown tool" instead of surfacing a question card.
 * 3. The kernel permission bridge auto-allows host platform tools
 *    (`isHostAutoApprovedMcpTool`) so an external kernel in non-full-access
 *    mode does not show an approval card before the question card.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAT_PLATFORM_HOST_TOOL_NAMES,
  nativePlatformToolSchemas,
} from '../src/kernel/platform-tools.js';
import { isHostAutoApprovedMcpTool } from '../src/runtime.js';

describe('host platform tool channel', () => {
  it('native schemas always include the host platform tools', () => {
    const schemas = nativePlatformToolSchemas({});
    const names = new Set(schemas.map((schema) => schema.name));
    // The four conversation-infrastructure tools must always be present on the
    // native channel (they used to vanish because `tools` were only assembled
    // when a workspace/network/agent capability was present).
    for (const tool of [
      'ask_user_question',
      'plan_submit',
      'task_schedule',
      'goal_manage',
      'ocr_image',
    ]) {
      expect(names.has(tool), `native list must expose ${tool}`).toBe(true);
    }
    // file_* and host-only inventory tools stay on the broker channel; native
    // keeps its own reader names (read_file / TaskList / list_agent_resources).
    expect(names.has('file_read')).toBe(false);
    expect(names.has('platform_context')).toBe(false);
    expect(names.has('task_list')).toBe(false);
    expect(names.has('agent_list')).toBe(false);
  });

  it('CHAT_PLATFORM_HOST_TOOL_NAMES covers every unified executor name', () => {
    expect([...CHAT_PLATFORM_HOST_TOOL_NAMES].sort()).toEqual([
      'agent_list',
      'ask_user_question',
      'describe_image',
      'generate_image',
      'goal_manage',
      'ocr_image',
      'plan_submit',
      'platform_context',
      'search_capability',
      'task_list',
      'task_schedule',
      'use_capability',
    ]);
  });

  it('isHostAutoApprovedMcpTool allows platform infra tools only', () => {
    // Approved host platform tools (approval: never on every channel).
    expect(isHostAutoApprovedMcpTool('mcp__platform__ask_user_question')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__platform__plan_submit')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__platform__goal_manage')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__platform__task_schedule')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__platform__platform_context')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__platform__task_list')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__platform__agent_list')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__windows-ocr__ocr_image')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__vision-fallback__describe_image')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__capability-broker__search_capability')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__capability-broker__use_capability')).toBe(true);
    expect(isHostAutoApprovedMcpTool('mcp__image-generation__generate_image')).toBe(true);
    // Side-effecting / workspace tools keep their approval cards.
    expect(isHostAutoApprovedMcpTool('mcp__platform__file_write')).toBe(false);
    expect(isHostAutoApprovedMcpTool('mcp__task-board__TaskCreate')).toBe(false);
    expect(isHostAutoApprovedMcpTool('mcp__agent-library__create_agent')).toBe(false);
    expect(isHostAutoApprovedMcpTool('mcp__web__web_search')).toBe(false);
    // Short names never match — the SDK passes the full mcp__ namespace.
    expect(isHostAutoApprovedMcpTool('ask_user_question')).toBe(false);
    expect(isHostAutoApprovedMcpTool('Read')).toBe(false);
  });
});
