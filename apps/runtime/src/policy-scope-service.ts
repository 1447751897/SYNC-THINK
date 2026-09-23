import type { ListPoliciesPayload, PolicyScopeRef, SavePolicyPayload } from '@sync-think/protocol';
import {
  ErrorCode,
  type AgentId,
  type AgentVersionId,
  type TaskId,
  type WorkspaceId,
} from '@sync-think/shared';
import { PolicyScopeBoundaryError } from './errors.js';

export interface PolicyScopePorts {
  installId: string;
  getWorkspace?: (workspaceId: WorkspaceId) => unknown;
  getTask?: (taskId: TaskId) => { workspaceId: WorkspaceId } | undefined;
  getLatestAgentVersion?: (agentId: AgentId) => unknown;
  getAgentVersion?: (agentVersionId: AgentVersionId) => { role: string } | undefined;
  hasApplicablePolicies?: (scopes: readonly PolicyScopeRef[]) => boolean;
}

export class PolicyScopeService {
  constructor(private readonly ports: PolicyScopePorts) {}

  validateSaveScope(payload: SavePolicyPayload): void {
    this.requireWorkspace(payload.workspaceId);
    for (const rule of payload.rules ?? []) {
      if (!rule.delegateAgentVersionId) continue;
      const delegate = this.ports.getAgentVersion?.(rule.delegateAgentVersionId);
      if (!delegate || delegate.role.trim().toLowerCase() !== 'approval') {
        throw new PolicyScopeBoundaryError(
          ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
          'Policy delegate AgentVersion is not an exact approval Agent version',
        );
      }
    }

    switch (payload.scopeType) {
      case 'user':
        if (payload.scopeId !== this.ports.installId) {
          throw new PolicyScopeBoundaryError(
            ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            'User policy scope must match the Runtime install',
          );
        }
        return;
      case 'workspace':
      case 'project':
        if (payload.scopeId !== payload.workspaceId) {
          throw new PolicyScopeBoundaryError(
            ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
            'Workspace policy scope must match the workspace context',
          );
        }
        return;
      case 'task':
        this.requireTask(payload.workspaceId, payload.scopeId as TaskId);
        return;
      case 'agent':
        this.requireAgent(payload.scopeId as AgentId);
        return;
      case 'workflow':
      case 'run':
        throw new PolicyScopeBoundaryError(
          ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
          `Policy scope is not supported yet: ${payload.scopeType}`,
        );
    }
  }

  buildApplicableScopes(payload: ListPoliciesPayload): PolicyScopeRef[] {
    this.requireWorkspace(payload.workspaceId);
    const scopes = this.baseScopes(payload.workspaceId);
    if (payload.taskId) {
      this.requireTask(payload.workspaceId, payload.taskId);
      scopes.push({ scopeType: 'task', scopeId: payload.taskId });
    }
    if (payload.agentId) {
      this.requireAgent(payload.agentId);
      scopes.push({ scopeType: 'agent', scopeId: payload.agentId });
    }
    return scopes;
  }

  hasApplicablePolicyForTask(task: { id: TaskId; workspaceId: WorkspaceId }): boolean {
    return (
      this.ports.hasApplicablePolicies?.([
        ...this.baseScopes(task.workspaceId),
        { scopeType: 'task', scopeId: task.id },
      ]) === true
    );
  }

  requireWorkspace(workspaceId: WorkspaceId): void {
    if (!this.ports.getWorkspace) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.STORAGE_WRITE_FAILED,
        'Workspace store is not configured on this Runtime',
      );
    }
    if (!this.ports.getWorkspace(workspaceId)) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.WORKSPACE_NOT_FOUND,
        `Workspace not found: ${workspaceId}`,
      );
    }
  }

  requireTask(workspaceId: WorkspaceId, taskId: TaskId): void {
    const task = this.ports.getTask?.(taskId);
    if (!task || task.workspaceId !== workspaceId) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.TASK_NOT_FOUND,
        `Task not found in workspace ${workspaceId}: ${taskId}`,
      );
    }
  }

  requireAgent(agentId: AgentId): void {
    if (!this.ports.getLatestAgentVersion) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.STORAGE_WRITE_FAILED,
        'Agent store is not configured on this Runtime',
      );
    }
    if (!this.ports.getLatestAgentVersion(agentId)) {
      throw new PolicyScopeBoundaryError(
        ErrorCode.PROTOCOL_UNEXPECTED_REQUEST,
        `Agent not found: ${agentId}`,
      );
    }
  }

  private baseScopes(workspaceId: WorkspaceId): PolicyScopeRef[] {
    return [
      { scopeType: 'user', scopeId: this.ports.installId },
      { scopeType: 'workspace', scopeId: workspaceId },
      { scopeType: 'project', scopeId: workspaceId },
    ];
  }
}
