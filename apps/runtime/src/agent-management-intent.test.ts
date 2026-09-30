import { afterEach, describe, expect, it } from 'vitest';
import { agentManagementIntent, managementToolAllowed } from './agent-management-intent.js';
import { chatToolRequiresApproval, toolsForExecutionMode } from './chat-tools.js';
import { selectKernelMcpRun, setKernelMcpServerConditions } from './kernel/mcp-servers/registry.js';

afterEach(() => setKernelMcpServerConditions({}));
describe('user-owned agent definitions', () => {
  it.each(['帮我创建一个研究智能体', '新建智能体，擅长测试', 'Create an agent for code review'])(
    'recognizes the direct request: %s',
    (text) => expect(agentManagementIntent(text)).toBe('create'),
  );
  it.each(['修改这个智能体的名字', '更新 agent 的模型', 'Edit the agent persona'])(
    'recognizes an update: %s',
    (text) => expect(agentManagementIntent(text)).toBe('update'),
  );
  it.each([
    '修复这个代码问题',
    '不要为了完成任务创建智能体',
    '不能自行创建智能体',
    '无需新建 agent',
    'Do not create an agent',
    '```\n创建智能体\n```',
  ])('keeps task execution separate: %s', (text) =>
    expect(agentManagementIntent(text)).toBe('none'),
  );
  it('delegated requests never become user management authority', () =>
    expect(agentManagementIntent('帮我创建智能体', true)).toBe('none'));
  it('does not broaden creation into modification', () => {
    expect(managementToolAllowed('create', 'update_agent')).toBe(false);
    expect(managementToolAllowed('update', 'create_agent')).toBe(false);
  });
  it.each(['create', 'update', 'none'] as const)(
    'native and external channels honor intent %s',
    (intent) => {
      setKernelMcpServerConditions({ hasAgentStore: true });
      const native = toolsForExecutionMode('full-access', {
        includeAgentTools: true,
        agentManagementIntent: intent,
      }).map((t) => t.name);
      const external = selectKernelMcpRun({
        kernelId: 'codex',
        conversationTrack: 'agent',
        executionMode: 'full-access',
        agentManagementIntent: intent,
      }).externalTools.map((t) => t.name);
      for (const names of [native, external]) {
        expect(names.includes('create_agent')).toBe(intent === 'create');
        expect(names.includes('update_agent')).toBe(intent === 'update');
        expect(names.includes('list_agent_resources')).toBe(intent !== 'none');
      }
    },
  );
  it.each(['ask', 'workspace', 'full-access'] as const)(
    'requires a fresh confirmation in %s',
    (mode) => {
      expect(chatToolRequiresApproval(mode, 'create_agent')).toBe(true);
      expect(chatToolRequiresApproval(mode, 'update_agent')).toBe(true);
    },
  );
});
