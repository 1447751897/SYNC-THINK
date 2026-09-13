import type { ConversationTrack } from '@sync-think/shared';
import {
  capabilitiesForConversationTrack,
  DEFAULT_COLLABORATION_SETTINGS,
  evaluateDynamicDelegation,
  normalizeCollaborationSettings,
  type CollaborationSettings,
} from '@sync-think/protocol';

export {
  capabilitiesForConversationTrack,
  DEFAULT_COLLABORATION_SETTINGS,
  evaluateDynamicDelegation,
  normalizeCollaborationSettings,
};
export type { CollaborationSettings };

export interface AgentCatalogCandidate {
  id: string;
  name: string;
  /** Agent Library avatar (emoji or short text); kept so delegated cards reuse it. */
  avatar?: string;
  persona?: string;
  description?: string;
  skillIds?: readonly string[];
  mcpServerIds?: readonly string[];
  archived?: boolean;
}

export interface AgentAssignmentRequest {
  task: string;
  requiredSkillIds?: readonly string[];
  requiredToolIds?: readonly string[];
  preferredAgentId?: string;
}

export interface AgentAssignment {
  kind: 'existing' | 'temporary';
  agentId?: string;
  score: number;
  reason: string;
  temporaryProfile?: { name: string; persona: string; task: string };
}

/** Pick a frozen existing Agent from catalog summaries, or produce a run-local profile. */
export function resolveAgentAssignment(
  request: AgentAssignmentRequest,
  candidates: readonly AgentCatalogCandidate[],
): AgentAssignment {
  const task = request.task.trim().toLocaleLowerCase();
  const requiredSkills = new Set((request.requiredSkillIds ?? []).map(String));
  const requiredTools = new Set((request.requiredToolIds ?? []).map(String));
  const eligible = candidates.filter((candidate) => {
    if (candidate.archived) return false;
    const skills = new Set(candidate.skillIds ?? []);
    const tools = new Set(candidate.mcpServerIds ?? []);
    return [...requiredSkills].every((skill) => skills.has(skill)) &&
      [...requiredTools].every((tool) => tools.has(tool));
  });
  const ranked = eligible
    .map((candidate) => {
      const profile = `${candidate.name} ${candidate.persona ?? ''} ${candidate.description ?? ''}`
        .toLocaleLowerCase();
      const taskWords = task.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2);
      const keywordScore = taskWords.reduce((score, word) => score + (profile.includes(word) ? 1 : 0), 0);
      const preferredScore = request.preferredAgentId === candidate.id ? 100 : 0;
      return { candidate, score: preferredScore + keywordScore };
    })
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  const best = ranked[0];
  if (best) {
    return {
      kind: 'existing',
      agentId: best.candidate.id,
      score: best.score,
      reason: '命中已存在 Agent 的硬能力条件，并按任务文本完成候选排序。',
    };
  }
  return {
    kind: 'temporary',
    score: 0,
    reason: '没有同时满足硬能力条件的现有 Agent，只创建当前 Run 有效的临时配置。',
    temporaryProfile: {
      name: '临时任务 Agent',
      persona: '只围绕当前任务工作，完成后返回结构化结果，不写入全局 Agent Library。',
      task: request.task.trim(),
    },
  };
}

const AGENT_LIBRARY_TOOLS = new Set([
  'list_agent_resources',
  'create_agent',
  'update_agent',
  'archive_agent',
  'create_skill',
  'update_skill',
  'delete_skill',
  'import_remote_skill',
  'register_remote_mcp',
  'create_team',
  'update_team',
  'delete_team',
]);

/** Structured denial for a collaboration tool on a given conversation track. */
export interface CollaborationToolDenial {
  /** Mirrors DelegationDecision.reason so tool dispatch and admission never drift. */
  reason: 'track' | 'disabled';
  /** Ready-to-publish error text for the chat tool result. */
  error: string;
}

const DELEGATE_TOOL_NAMES = new Set(['agent_delegate', 'delegate_agent']);

/**
 * Single authority for "may this tool run on this conversation track?".
 * Returns the exact denial (reason + user-facing error), or null when the tool is
 * allowed, so the runtime tool dispatch path and the delegation admission path
 * cannot drift apart.
 */
export function resolveCollaborationToolDenial(input: {
  track: ConversationTrack;
  toolName: string;
  settings?: CollaborationSettings;
}): CollaborationToolDenial | null {
  const settings = input.settings ?? DEFAULT_COLLABORATION_SETTINGS;
  const capabilities = capabilitiesForConversationTrack(input.track, settings);
  if (input.track !== 'model' && AGENT_LIBRARY_TOOLS.has(input.toolName)) {
    return {
      reason: 'track',
      error:
        input.track === 'team'
          ? 'Team 对话只允许使用已冻结的 Team 内部执行链路。'
          : 'Agent 对话只允许通过普通任务清单派发任务，不能创建或管理动态协作 Agent。',
    };
  }
  if (DELEGATE_TOOL_NAMES.has(input.toolName) && !capabilities.canCreateDynamicSubagent) {
    return input.track === 'model'
      ? {
          reason: 'disabled',
          error:
            'agent_delegate: delegation rejected (disabled). 模型对话的动态子 Agent 委派当前已关闭，可在「设置 > 智能体协作」中开启。',
        }
      : {
          reason: 'track',
          error:
            'agent_delegate: delegation rejected (track). 只有模型对话可以派发动态子 Agent。',
        };
  }
  if (input.toolName === 'agent_message' && !capabilities.canMessagePeerAgents) {
    return {
      reason: 'track',
      error: 'agent_message: delegation rejected (track). Agent 之间的直接对话当前已关闭。',
    };
  }
  if (
    input.track === 'agent' &&
    (input.toolName === 'TaskCreate' || input.toolName === 'TaskUpdate') &&
    settings.allowAgentTaskDispatch !== true
  ) {
    return {
      reason: 'disabled',
      error:
        'Agent 对话的任务派发当前已关闭，可在「设置 > 智能体协作」中允许当前 Agent 派发任务。',
    };
  }
  return null;
}

/** Boolean wrapper over {@link resolveCollaborationToolDenial}. */
export function isCollaborationToolAllowed(input: {
  track: ConversationTrack;
  toolName: string;
  settings?: CollaborationSettings;
}): boolean {
  return resolveCollaborationToolDenial(input) === null;
}

/**
 * Built-in tools a delegated child Run may call. Every other tool must be an MCP
 * tool that explicitly declares `readOnly: true`.
 */
export const DELEGATED_READONLY_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_files',
  'search_files',
  'git_status',
  'git_diff',
  'web_search',
  'web_fetch',
]);

/**
 * Single read-only gate for delegated children: a built-in catalog tool from the
 * allowlist, or an MCP tool that explicitly declared `readOnly: true`. An MCP tool
 * that omits the flag (or sets it false) counts as mutating and is refused.
 */
export function isDelegatedReadOnlyTool(
  toolName: string,
  explicitReadOnly?: boolean,
): boolean {
  return DELEGATED_READONLY_TOOLS.has(toolName) || explicitReadOnly === true;
}
