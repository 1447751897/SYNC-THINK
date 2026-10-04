import { describe, expect, it } from 'vitest';
import { missingScheduledTaskConfiguration, TASK_SCHEDULE_TOOL_DESCRIPTION, TASK_SCHEDULE_TOOL_INPUT_SCHEMA } from './scheduled-task-tool.js';
import { PLATFORM_MCP_TOOL_DEFINITIONS } from './kernel/platform-tools.js';
import { platformServer } from './kernel/mcp-servers/platform-server.js';
import { summarizeToolCallForApproval } from './chat-tools.js';

describe('complete scheduled task management on every kernel', () => {
  it('shares create/get/update/resources and execution settings between native and external catalogs', () => {
    const native = PLATFORM_MCP_TOOL_DEFINITIONS.find(tool => tool.name === 'task_schedule')!;
    const external = platformServer.tools.find(tool => tool.name === 'task_schedule')!;
    expect(native.inputSchema).toBe(TASK_SCHEDULE_TOOL_INPUT_SCHEMA);
    expect(external.inputSchema).toBe(native.inputSchema);
    expect(external.description).toBe(TASK_SCHEDULE_TOOL_DESCRIPTION);
    expect(TASK_SCHEDULE_TOOL_INPUT_SCHEMA.properties.action.enum).toEqual(['resources', 'create', 'list', 'get', 'update', 'cancel']);
    expect(TASK_SCHEDULE_TOOL_DESCRIPTION).toContain('ask the user to confirm');
    expect(TASK_SCHEDULE_TOOL_DESCRIPTION).toContain('Never cancel/recreate');
  });
  it.each([{}, { workspaceId: 'w' }, { automation: { conversation: { mode: 'new' } } }, { workspaceId: ' ', automation: { conversation: { mode: 'task' } } }])('requires explicit workspace and conversation choices: %j', input => {
    expect(missingScheduledTaskConfiguration(input).length).toBeGreaterThan(0);
  });
  it.each(['task', 'new', 'existing'])('accepts an explicitly selected %s conversation and global scope', mode => {
    expect(missingScheduledTaskConfiguration({ workspaceId: null, automation: { conversation: { mode } } })).toEqual([]);
  });
  it('summarizes model, workspace, conversation and editable instruction before approval', () => {
    const summary = summarizeToolCallForApproval('task_schedule', JSON.stringify({ action: 'update', taskId: 'task-1', patch: { instruction: 'Review yesterday', target: { kind: 'model', modelId: 'model-review' }, workspaceId: 'workspace-1', timeZone: 'Asia/Shanghai', automation: { conversation: { mode: 'new' } } } }));
    expect(summary.title).toBe('修改定时任务「task-1」');
    for (const value of ['model-review', 'workspace-1', '每次新建', 'Review yesterday', 'Asia/Shanghai']) expect(summary.detail).toContain(value);
  });
});
