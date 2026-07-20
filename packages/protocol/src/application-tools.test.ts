import { describe, expect, it } from 'vitest';
import {
  APPLICATION_TOOL_DEFINITIONS,
  getApplicationToolDefinition,
} from './application-tools.js';

describe('SYNC-THINK application tool contract', () => {
  it('maps stable internal/external tool names to Runtime commands', () => {
    expect(getApplicationToolDefinition('sync_think.agent.list')).toMatchObject({
      command: 'agent.list',
      confirmation: 'none',
    });
    expect(getApplicationToolDefinition('sync_think.agent.create')).toMatchObject({
      command: 'agent.create',
      confirmation: 'configuration',
    });
    expect(getApplicationToolDefinition('sync_think.group.create')).toMatchObject({
      command: 'group.create',
      confirmation: 'configuration',
    });
    expect(getApplicationToolDefinition('sync_think.task.create')).toMatchObject({
      command: 'task.create',
      confirmation: 'none',
    });
    expect(getApplicationToolDefinition('sync_think.subtask.delegate')).toMatchObject({
      command: 'task.delegateSubtask',
      confirmation: 'none',
    });
    expect(getApplicationToolDefinition('sync_think.handoff.record')).toMatchObject({
      command: 'task.recordHandoff',
      confirmation: 'none',
    });
    expect(
      getApplicationToolDefinition('sync_think.group.member.update_responsibility'),
    ).toMatchObject({
      command: 'group.member.updateResponsibility',
      confirmation: 'configuration',
    });
    expect(getApplicationToolDefinition('sync_think.group.set_lead')).toMatchObject({
      command: 'group.setLead',
      confirmation: 'configuration',
    });
  });

  it('does not expose secret-reading commands and has unique names', () => {
    const names = APPLICATION_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((name) => /secret|api[_-]?key|credential\.reveal/i.test(name))).toBe(false);
    expect(
      APPLICATION_TOOL_DEFINITIONS.find((tool) => tool.name === 'sync_think.provider.list'),
    ).toMatchObject({ command: 'provider.list', outputSensitivity: 'metadata-only' });
  });

  it('publishes bounded JSON schemas that both MCP and in-app Agents can use', () => {
    const createTask = getApplicationToolDefinition('sync_think.task.create');
    expect(createTask?.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['workspaceId', 'title', 'goal'],
    });
    expect(createTask?.inputSchema.properties).toMatchObject({
      workspaceId: { type: 'string' },
      title: { type: 'string' },
      goal: { type: 'string' },
    });
    expect(getApplicationToolDefinition('sync_think.subtask.delegate')?.inputSchema).toMatchObject({
      required: ['workspaceId', 'parentTaskId', 'delegateAgentVersionId', 'title', 'goal'],
    });

    for (const tool of APPLICATION_TOOL_DEFINITIONS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/secret|api[_-]?key/i);
    }
  });
});
