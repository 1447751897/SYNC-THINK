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

describe('user-requested team creation through an agent', () => {
  it.each(['我之前有一些人设草稿，你知道吗？我要创建一个小队', '帮我组建一个视频团队', '用现有智能体创建一个小说小队', 'Create a team with existing agents', '组队做视频', '帮我创建一个测试小队，复用执行者，并创建一个编辑智能体加入新小队'])('recognizes team intent: %s', text => expect(agentManagementIntent(text)).toBe('create-team'));
  it.each(['不要创建小队', '别组建团队', '不要建队', 'Do not build a team', '写小说', '创建视频分组', '```创建小队```'])('keeps ordinary conversation separate: %s', text => expect(agentManagementIntent(text)).toBe('none'));
  it('does not authorize a delegated agent to create teams', () => expect(agentManagementIntent('创建小队', true)).toBe('none'));
  it.each(['agent', 'team', 'model'] as const)('exposes a usable roster + creation path on %s', track => {
    setKernelMcpServerConditions({ hasAgentStore: true, hasTeamStore: true });
    const intent = agentManagementIntent('帮我创建一个小队');
    const native = toolsForExecutionMode('workspace', { includeAgentTools: true, conversationTrack: track, agentManagementIntent: intent }).map(tool => tool.name);
    const external = selectKernelMcpRun({ kernelId: 'codex', conversationTrack: track, agentManagementIntent: intent }).externalTools.map(tool => tool.name);
    for (const names of [native, external]) {
      for (const tool of ['list_agent_resources', 'list_teams', 'create_agent', 'create_team']) expect(names).toContain(tool);
      for (const tool of ['update_agent', 'update_team', 'delete_team', 'agent_run', 'agent_delegate']) expect(names).not.toContain(tool);
    }
  });
  it.each(['ask', 'workspace', 'full-access'] as const)('confirms team changes in %s', mode => {
    for (const tool of ['create_team', 'update_team', 'delete_team']) expect(chatToolRequiresApproval(mode, tool)).toBe(true);
  });
  it('limits update and deletion to the user-requested operation', () => {
    expect(agentManagementIntent('修改小队名称')).toBe('update-team');
    expect(agentManagementIntent('删除测试小队')).toBe('delete-team');
    expect(managementToolAllowed('update-team', 'create_agent')).toBe(false);
    expect(managementToolAllowed('delete-team', 'update_team')).toBe(false);
  });
});

it.each(['创建一个小队，不要创建新的智能体', '只用现有智能体创建一个小队', "Create a team, don't create agents", 'Create a team with existing agents only'])('keeps existing-only team requests usable without agent creation: %s', text => {
  const intent = agentManagementIntent(text);
  expect(intent).toBe('create-team-existing');
  expect(managementToolAllowed(intent, 'create_team')).toBe(true);
  expect(managementToolAllowed(intent, 'list_agent_resources')).toBe(true);
  expect(managementToolAllowed(intent, 'create_agent')).toBe(false);
});
it('keeps a team prohibition separate from an explicitly requested agent', () => {
  expect(agentManagementIntent('不要创建小队，帮我创建一个研究智能体')).toBe('create');
});

describe('management capability questions and mixed-language requests', () => {
  it.each([
    '你现在不能创建team嘛？', '能创建team？', '能创建小队吗', '可以创建智能体吗？',
    '你不能帮我创建一个team吗？', '你是否支持创建小队',
    'Can you create a team?', "Can't you create agents?",
    '为什么你不能创建team？', '为什么没有create_team？', '有没有 create_agent 工具？',
  ])('treats capability questions as inspection, not a mutation or prohibition: %s', text => {
    const intent = agentManagementIntent(text);
    expect(intent).toBe('inspect');
    for (const tool of ['list_agent_resources', 'list_teams']) expect(managementToolAllowed(intent, tool)).toBe(true);
    for (const tool of ['create_agent', 'update_agent', 'create_team', 'update_team', 'delete_team']) expect(managementToolAllowed(intent, tool)).toBe(false);
  });
  it.each(['创建team', '帮我创建一个team', '帮我创建一个 squad', 'Create 一个小队', '帮我创建一个team，可以吗？', '你现在不能创建team嘛？帮我创建一个小说小队'])('recognizes an actual mixed-language creation request: %s', text => expect(agentManagementIntent(text)).toBe('create-team'));
  it.each(['不要创建team', '不能自行创建team', '别创建 squad', 'Do not create 小队'])('keeps actual prohibitions intact: %s', text => expect(agentManagementIntent(text)).toBe('none'));
  it('never derives capability-query authority from a delegated instruction', () => expect(agentManagementIntent('能创建team？', true)).toBe('none'));
  it.each(['agent', 'team', 'model'] as const)('advertises only inspection on both native and external %s channels', track => {
    setKernelMcpServerConditions({ hasAgentStore: true, hasTeamStore: true });
    const intent = agentManagementIntent('你现在不能创建team嘛？');
    const native = toolsForExecutionMode('full-access', { includeAgentTools: true, conversationTrack: track, agentManagementIntent: intent }).map(tool => tool.name);
    const external = selectKernelMcpRun({ kernelId: 'codex', conversationTrack: track, agentManagementIntent: intent }).externalTools.map(tool => tool.name);
    for (const names of [native, external]) {
      for (const tool of ['list_agent_resources', 'list_teams']) expect(names).toContain(tool);
      for (const tool of ['create_agent', 'update_agent', 'create_team', 'update_team', 'delete_team', 'agent_run', 'agent_delegate']) expect(names).not.toContain(tool);
    }
  });
});


describe('host-owned direct-chat proposal catalog', () => {
  it.each(['agent', 'team', 'model'] as const)('does not disappear with wording or follow-ups on %s', track => {
    setKernelMcpServerConditions({ hasAgentStore: true, hasTeamStore: true });
    for (const text of ['那按刚才我们说的，我要一个分析项目的team，你帮我创建吧，如果有不懂的，我们先讨论', '现在呢？', '按刚才的方案创建吧', '不要创建任何东西，只告诉我支持哪些功能']) {
      const intent = agentManagementIntent(text);
      const native = toolsForExecutionMode('full-access', { includeAgentTools: true, conversationTrack: track, agentManagementIntent: intent, allowAgentDefinitionProposals: true }).map(tool => tool.name);
      const external = selectKernelMcpRun({ kernelId: 'codex', conversationTrack: track, agentManagementIntent: intent, allowAgentDefinitionProposals: true }).externalTools.map(tool => tool.name);
      for (const names of [native, external]) for (const tool of ['list_agent_resources', 'list_teams', 'create_agent', 'update_agent', 'create_team', 'update_team', 'delete_team']) expect(names).toContain(tool);
    }
  });
  it('a proposal entitlement is not permission to run or delegate work', () => {
    expect(managementToolAllowed('none', 'create_team', true)).toBe(true);
    expect(managementToolAllowed('none', 'agent_run', true)).toBe(false);
    expect(managementToolAllowed('none', 'agent_delegate', true)).toBe(false);
  });
});
