import { describe, expect, it, vi } from 'vitest';
import type { SavePolicyPayload } from '@sync-think/protocol';
import type { AgentId, AgentVersionId, TaskId, WorkspaceId } from '@sync-think/shared';
import { ErrorCode } from '@sync-think/shared';
import { PolicyScopeBoundaryError } from './errors.js';
import { PolicyScopeService, type PolicyScopePorts } from './policy-scope-service.js';

const workspaceId = 'workspace-a' as WorkspaceId;
const taskId = 'task-a' as TaskId;
const agentId = 'agent-a' as AgentId;
const approvalVersionId = 'agent-version-approval' as AgentVersionId;

function ports(overrides: Partial<PolicyScopePorts> = {}): PolicyScopePorts {
  return {
    installId: 'install-a',
    getWorkspace: (id) => (id === workspaceId ? { id } : undefined),
    getTask: (id) => (id === taskId ? { workspaceId } : undefined),
    getLatestAgentVersion: (id) => (id === agentId ? { id } : undefined),
    getAgentVersion: (id) => (id === approvalVersionId ? { role: 'approval' } : undefined),
    ...overrides,
  };
}

function savePayload(overrides: Partial<SavePolicyPayload> = {}): SavePolicyPayload {
  return {
    workspaceId,
    scopeType: 'workspace',
    scopeId: workspaceId,
    approvalMode: 'full',
    ...overrides,
  };
}

describe('policy scope service', () => {
  it('validates supported save scopes and exact approval delegates', () => {
    const service = new PolicyScopeService(ports());
    expect(() => service.validateSaveScope(savePayload())).not.toThrow();
    expect(() =>
      service.validateSaveScope(
        savePayload({
          scopeType: 'task',
          scopeId: taskId,
          rules: [
            {
              action: 'command_execution',
              approvalMode: 'delegate',
              delegateAgentVersionId: approvalVersionId,
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects mismatched, unsupported, and non-approval scopes', () => {
    const service = new PolicyScopeService(ports());
    for (const payload of [
      savePayload({ scopeType: 'user', scopeId: 'another-install' }),
      savePayload({ scopeType: 'project', scopeId: 'another-workspace' }),
      savePayload({ scopeType: 'run', scopeId: 'run-a' }),
      savePayload({
        rules: [
          {
            action: 'command_execution',
            approvalMode: 'delegate',
            delegateAgentVersionId: 'missing-version' as AgentVersionId,
          },
        ],
      }),
    ]) {
      expect(() => service.validateSaveScope(payload)).toThrow(PolicyScopeBoundaryError);
    }
  });

  it('builds ordered applicable scopes after validating optional targets', () => {
    const service = new PolicyScopeService(ports());
    expect(service.buildApplicableScopes({ workspaceId, taskId, agentId })).toEqual([
      { scopeType: 'user', scopeId: 'install-a' },
      { scopeType: 'workspace', scopeId: workspaceId },
      { scopeType: 'project', scopeId: workspaceId },
      { scopeType: 'task', scopeId: taskId },
      { scopeType: 'agent', scopeId: agentId },
    ]);
  });

  it('distinguishes unavailable stores from missing records', () => {
    const unavailable = new PolicyScopeService(ports({ getWorkspace: undefined }));
    try {
      unavailable.requireWorkspace(workspaceId);
      throw new Error('expected boundary error');
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyScopeBoundaryError);
      expect((error as PolicyScopeBoundaryError).code).toBe(ErrorCode.STORAGE_WRITE_FAILED);
    }

    const missing = new PolicyScopeService(ports({ getTask: () => undefined }));
    try {
      missing.requireTask(workspaceId, taskId);
      throw new Error('expected boundary error');
    } catch (error) {
      expect((error as PolicyScopeBoundaryError).code).toBe(ErrorCode.TASK_NOT_FOUND);
    }
  });

  it('queries task applicability through the narrow policy port', () => {
    const hasApplicablePolicies = vi.fn(() => true);
    const service = new PolicyScopeService(ports({ hasApplicablePolicies }));
    expect(service.hasApplicablePolicyForTask({ id: taskId, workspaceId })).toBe(true);
    expect(hasApplicablePolicies).toHaveBeenCalledWith([
      { scopeType: 'user', scopeId: 'install-a' },
      { scopeType: 'workspace', scopeId: workspaceId },
      { scopeType: 'project', scopeId: workspaceId },
      { scopeType: 'task', scopeId: taskId },
    ]);
  });
});
