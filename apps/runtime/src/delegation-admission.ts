import type { ConversationTrack, WorkspaceId } from '@sync-think/shared';
import {
  evaluateDynamicDelegation,
  normalizeCollaborationSettings,
  resolveAgentAssignment,
  type AgentAssignment,
  type AgentCatalogCandidate,
  type CollaborationSettings,
} from './collaboration-policy.js';
import {
  resolveDelegationStatusNotificationTimeoutSeconds,
  resolveDelegationTimeoutSeconds,
} from './delegation-timeout-policy.js';

export interface DelegationAdmissionPorts {
  getSettings(): unknown;
  /** The host supplies only Agents effective in this thread's workspace. */
  getCatalog(threadId: string): {
    workspaceId: WorkspaceId;
    candidates: readonly AgentCatalogCandidate[];
  };
}

export interface DelegationAdmissionRequest {
  threadId: string;
  toolName: string;
  argumentsJson: string;
  track?: ConversationTrack;
  depth?: number;
  childCount?: number;
  autoDelegationsThisTurn?: number;
}

type DelegationDenial = {
  ok: false;
  error: string;
  code?: 'AGENT_ID_REQUIRED' | 'AGENT_UNAVAILABLE' | 'AGENT_CAPABILITY_MISMATCH';
  limits?: CollaborationSettings;
  workspaceId?: WorkspaceId;
  agentId?: string;
  availableAgents?: Array<{ id: string; name: string; source?: 'builtin' | 'user' }>;
  suggestedDraft?: { task: string; reason: string };
};

export type DelegationAdmissionResult =
  | { ok: false; response: DelegationDenial }
  | {
      ok: true;
      task: string;
      parallelGroup?: string;
      background: boolean;
      timeoutSeconds: number;
      statusNotificationTimeoutSeconds: number;
      taskTokenBudget: number | null;
      workspaceId: WorkspaceId;
      assignment: AgentAssignment;
      candidate: AgentCatalogCandidate;
    };

/** Resolve admission without creating runs, mutating counters, or starting execution. */
export class DelegationAdmissionService {
  constructor(private readonly ports: DelegationAdmissionPorts) {}

  prepare(input: DelegationAdmissionRequest): DelegationAdmissionResult {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(input.argumentsJson || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      return { ok: false, response: { ok: false, error: 'agent_delegate: invalid JSON arguments.' } };
    }
    const task = typeof args.task === 'string' ? args.task.trim() : '';
    if (!task) {
      return { ok: false, response: { ok: false, error: 'agent_delegate: task is required.' } };
    }
    const parallelGroup =
      typeof args.parallelGroup === 'string' && args.parallelGroup.trim()
        ? args.parallelGroup.trim().slice(0, 80)
        : undefined;
    // Preserve error precedence: settings after task validation, catalog after budget and ID checks.
    const settings = normalizeCollaborationSettings(this.ports.getSettings());
    const background = input.toolName === 'agent_run';
    const timeoutSeconds = resolveDelegationTimeoutSeconds(background, args.timeoutSeconds);
    const statusNotificationTimeoutSeconds = resolveDelegationStatusNotificationTimeoutSeconds(
      background,
      args.statusTimeoutSeconds,
    );
    const admission = evaluateDynamicDelegation({
      track: input.track ?? 'model',
      settings: background ? { ...settings, dynamicSubagentsEnabled: true } : settings,
      state: {
        depth: input.depth ?? 0,
        childCount: input.childCount ?? 0,
        autoDelegationsThisTurn: input.autoDelegationsThisTurn ?? 0,
      },
      requestedTokenBudget:
        typeof args.tokenBudget === 'number' && Number.isFinite(args.tokenBudget)
          ? args.tokenBudget
          : null,
    });
    if (!admission.allowed) {
      return {
        ok: false,
        response: {
          ok: false,
          error: `agent_delegate: delegation rejected (${admission.reason}).`,
          limits: settings,
        },
      };
    }
    const requestedAgentId = typeof args.agentId === 'string' ? args.agentId.trim() : '';
    if (!requestedAgentId) {
      return {
        ok: false,
        response: {
          ok: false,
          code: 'AGENT_ID_REQUIRED',
          error: 'agent_delegate: agentId is required. Call list_available_agents first and choose an existing Agent.',
        },
      };
    }
    const { workspaceId, candidates } = this.ports.getCatalog(input.threadId);
    if (!candidates.some((candidate) => candidate.id === requestedAgentId)) {
      return {
        ok: false,
        response: {
          ok: false,
          code: 'AGENT_UNAVAILABLE',
          error: `agent_delegate: Agent ${requestedAgentId} is not active in workspace ${workspaceId}.`,
          workspaceId,
          availableAgents: candidates.map(({ id, name, source }) => ({ id, name, source })),
          suggestedDraft: {
            task,
            reason: '没有找到当前工作区已激活的指定 Agent；请先创建或激活一个已有 Agent。',
          },
        },
      };
    }
    const assignment = resolveAgentAssignment(
      {
        task,
        preferredAgentId: requestedAgentId,
        requiredSkillIds: Array.isArray(args.requiredSkillIds) ? args.requiredSkillIds.map(String) : [],
        requiredToolIds: Array.isArray(args.requiredToolIds) ? args.requiredToolIds.map(String) : [],
      },
      candidates,
    );
    if (!assignment) {
      return {
        ok: false,
        response: {
          ok: false,
          code: 'AGENT_CAPABILITY_MISMATCH',
          error: 'agent_delegate: the selected Agent does not satisfy the requested capabilities.',
          agentId: requestedAgentId,
          availableAgents: candidates.map(({ id, name }) => ({ id, name })),
        },
      };
    }
    return {
      ok: true,
      task,
      parallelGroup,
      background,
      timeoutSeconds,
      statusNotificationTimeoutSeconds,
      taskTokenBudget: admission.taskTokenBudget,
      workspaceId,
      assignment,
      candidate: candidates.find((candidate) => candidate.id === assignment.agentId)!,
    };
  }
}
