import type { GlobalAgent, KernelDetectionResult, Team } from '@sync-think/shared';
import type {
  CreateGlobalAgentPayload,
  UpdateGlobalAgentPayload,
  DeleteGlobalAgentPayload,
  CreateTeamPayload,
  UpdateTeamPayload,
  DeleteTeamPayload,
} from '@sync-think/protocol';
import type {
  ManagedKernelUpdateBridge,
  ManagedKernelUpdateSnapshot,
} from '../../kernel-update-contract.js';

export const capabilityViews = ['kernels', 'agents', 'teams'] as const;
export type CapabilityView = (typeof capabilityViews)[number];
export interface DemoRoster {
  agents: GlobalAgent[];
  teams: Team[];
}
export function parseCapabilityView(value: string | null): CapabilityView | null {
  return capabilityViews.find((view) => view === value) ?? null;
}

export const demoKernels: KernelDetectionResult[] = [
  {
    kernelId: 'native',
    name: 'SYNC-THINK',
    icon: 'native',
    capabilities: {
      permission: 'own',
      permissionBridge: false,
      pause: 'executor',
      compress: 'own',
      usageReport: true,
      protocols: [],
    },
    installed: true,
    executionSupported: true,
    version: null,
    executablePath: null,
    knownGood: true,
  },
  {
    kernelId: 'codex',
    name: 'Codex',
    icon: 'codex',
    capabilities: {
      permission: 'own',
      permissionBridge: false,
      pause: 'session',
      compress: 'own',
      usageReport: true,
      protocols: ['openai-chat'],
    },
    installed: true,
    executionSupported: true,
    version: '0.0.0-demo',
    executablePath: null,
    knownGood: true,
  },
  {
    kernelId: 'claude-code',
    name: 'Claude Code',
    icon: 'claude-code',
    capabilities: {
      permission: 'own',
      permissionBridge: true,
      pause: 'turn',
      compress: 'own',
      usageReport: true,
      protocols: ['anthropic-messages'],
    },
    installed: true,
    executionSupported: true,
    version: '0.0.0-demo',
    executablePath: null,
    knownGood: true,
  },
];
export const demoModels = ['SYNC-THINK', 'GPT', 'Claude', 'DeepSeek'].map((name) => ({
  modelId: name,
  displayName: name,
  providerName: '示例模型',
  contextWindow: name === 'Claude' ? 200000 : 128000,
}));
export const demoSkills = [
  {
    skillVersionId: 'demo-ui',
    name: '界面检查',
    version: '1.0',
    description: '核对页面布局与交互。',
  },
  {
    skillVersionId: 'demo-review',
    name: '代码审阅',
    version: '1.0',
    description: '检查文件变更与回归风险。',
  },
];
const timestamp = '2026-09-08T09:00:00.000Z';
function initialAgents(): GlobalAgent[] {
  return [
    {
      id: 'demo-agent',
      name: '界面检查助手',
      avatar: '界',
      description: '核对页面布局、交互状态与设计一致性。',
      persona: '先核对当前实现，再记录布局、交互与可访问性问题。',
      defaultModelId: 'GPT',
      skillIds: ['demo-ui'],
    },
    {
      id: 'demo-builder',
      name: '工程助手',
      avatar: '工',
      description: '实现功能、整理文件变更并补充测试。',
      persona: '遵循项目约定，保持改动范围清晰，完成后运行相关验证。',
      defaultModelId: 'Claude',
      skillIds: [],
    },
    {
      id: 'demo-reviewer',
      name: '代码审阅助手',
      avatar: '审',
      description: '检查行为回归、错误处理与缺失测试。',
      persona: '按严重程度列出可复现的问题，注明文件位置。',
      defaultModelId: 'DeepSeek',
      skillIds: ['demo-review'],
    },
  ].map((agent) => ({
    ...agent,
    id: agent.id as GlobalAgent['id'],
    defaultModelId: agent.defaultModelId as GlobalAgent['defaultModelId'],
    fallbackModelIds: [],
    mcpServerIds: ['demo-files'],
    reasoningEffort: 'auto',
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}
function initialTeams(agents: GlobalAgent[]): Team[] {
  return [
    {
      id: 'demo-team' as Team['id'],
      name: '产品协作小队',
      avatar: '队',
      mission: '共同完成产品界面交付：界面核对、功能实现与代码审阅。',
      strategy: 'serial',
      coordinatorAgentId: agents[0].id,
      members: agents.map((agent, index) => ({
        agentId: agent.id,
        memberOrder: index,
        role: ['coordinator', 'builder', 'reviewer'][index],
        title: ['界面核对', '功能实现', '交付审阅'][index],
        dependsOn: index ? [agents[index - 1].id] : [],
      })),
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

export function createWebsiteCapabilitySession() {
  let agents = initialAgents();
  let snapshot = { agents, teams: initialTeams(agents) };
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const requireAgent = (id: string) => {
    const agent = snapshot.agents.find((item) => item.id === id);
    if (!agent) throw new Error('示例智能体已移除。');
    return agent;
  };
  const teamMembers = (members: NonNullable<CreateTeamPayload['members']>) => {
    if (!members.length) throw new Error('小队至少需要一位成员。');
    if (new Set(members.map((member) => member.agentId)).size !== members.length)
      throw new Error('小队成员重复。');
    return members.map((member, memberOrder) => {
      requireAgent(member.agentId);
      return {
        ...member,
        memberOrder,
        role: member.role ?? 'builder',
        title: member.title ?? '',
        dependsOn: member.dependsOn ?? [],
      };
    });
  };
  const runtime = {
    listSkills: async () => ({ skills: demoSkills }),
    listMcpServers: async () => ({
      servers: [
        {
          mcpServerId: 'demo-files',
          name: '工作区文件',
          tools: [{ name: 'read_file' }, { name: 'list_files' }],
          trusted: true,
        },
      ],
    }),
    detectKernels: async () => ({ kernels: structuredClone(demoKernels) }),
    createGlobalAgent: async (payload: CreateGlobalAgentPayload) => {
      if (!payload.name.trim() || !payload.defaultModelId)
        throw new Error('请填写名称并选择模型。');
      const agent: GlobalAgent = {
        id: `demo-${crypto.randomUUID()}` as GlobalAgent['id'],
        name: payload.name,
        avatar: payload.avatar ?? '',
        persona: payload.persona ?? '',
        description: payload.description ?? '',
        defaultModelId: payload.defaultModelId,
        fallbackModelIds: payload.fallbackModelIds ?? [],
        skillIds: payload.skillIds ?? [],
        mcpServerIds: payload.mcpServerIds ?? [],
        reasoningEffort: payload.reasoningEffort ?? 'auto',
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      publish({ ...snapshot, agents: [...snapshot.agents, agent] });
      return { agent };
    },
    updateGlobalAgent: async ({ agentId, ...payload }: UpdateGlobalAgentPayload) => {
      const agent = { ...requireAgent(agentId), ...payload, updatedAt: timestamp };
      publish({
        ...snapshot,
        agents: snapshot.agents.map((item) => (item.id === agentId ? agent : item)),
      });
      return { agent };
    },
    deleteGlobalAgent: async ({ agentId }: DeleteGlobalAgentPayload) => {
      requireAgent(agentId);
      if (snapshot.teams.some((team) => team.members.some((member) => member.agentId === agentId)))
        throw new Error('该智能体仍在小队中，请先移除成员。');
      publish({ ...snapshot, agents: snapshot.agents.filter((item) => item.id !== agentId) });
    },
    createTeam: async (payload: CreateTeamPayload) => {
      if (!payload.name.trim()) throw new Error('请填写小队名称。');
      const team: Team = {
        id: `demo-${crypto.randomUUID()}` as Team['id'],
        name: payload.name,
        avatar: payload.avatar ?? '',
        mission: payload.mission ?? '',
        strategy: payload.strategy ?? 'serial',
        coordinatorAgentId: payload.coordinatorAgentId,
        members: teamMembers(payload.members ?? []),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      publish({ ...snapshot, teams: [...snapshot.teams, team] });
      return { team };
    },
    updateTeam: async ({ teamId, members, ...payload }: UpdateTeamPayload) => {
      const current = snapshot.teams.find((item) => item.id === teamId);
      if (!current) throw new Error('示例小队已移除。');
      const team = {
        ...current,
        ...payload,
        members: members ? teamMembers(members) : current.members,
        updatedAt: timestamp,
      };
      publish({
        ...snapshot,
        teams: snapshot.teams.map((item) => (item.id === teamId ? team : item)),
      });
      return { team };
    },
    deleteTeam: async ({ teamId }: DeleteTeamPayload) => {
      publish({ ...snapshot, teams: snapshot.teams.filter((item) => item.id !== teamId) });
    },
  };
  let updates: ManagedKernelUpdateSnapshot = {
    schemaVersion: 1,
    installerAvailable: true,
    checkedAt: timestamp,
    items: [
      {
        kernelId: 'codex',
        name: 'Codex',
        packageName: '@openai/codex',
        managedVersion: '0.0.0-demo',
        latestVersion: '0.0.0-demo',
        phase: 'up-to-date',
        errorCode: null,
      },
      {
        kernelId: 'claude-code',
        name: 'Claude Code',
        packageName: '@anthropic-ai/claude-code',
        managedVersion: '0.0.0-demo',
        latestVersion: '0.0.0-demo',
        phase: 'up-to-date',
        errorCode: null,
      },
    ],
  };
  const kernelUpdates: ManagedKernelUpdateBridge = {
    getState: async () => structuredClone(updates),
    checkForUpdates: async () => ({ ok: true, state: structuredClone(updates), errorCode: null }),
    installUpdate: async () => ({ ok: true, state: structuredClone(updates), errorCode: null }),
  };
  return {
    runtime,
    kernelUpdates,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    reset: () => {
      agents = initialAgents();
      updates = { ...updates, checkedAt: timestamp };
      publish({ agents, teams: initialTeams(agents) });
    },
  };
}
