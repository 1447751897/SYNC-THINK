import type { GlobalAgent, WorkspaceId } from '@sync-think/shared';
import type {
  WorkspaceSummary,
  SetGlobalAgentWorkspaceActivationPayload,
  UpdateGlobalAgentPayload,
} from '@sync-think/protocol';
import { runtimeWorkspaceId } from './projectless-scope.js';

/** Layout scopes and the internal inbox are not workspace activation targets. */
export function agentActivationWorkspaces(workspaces: readonly WorkspaceSummary[]) {
  return workspaces.filter(
    (workspace) => runtimeWorkspaceId(workspace.workspaceId) && workspace.name !== '__inbox__',
  );
}

type ActivationApi = {
  setGlobalAgentWorkspaceActivation(
    payload: SetGlobalAgentWorkspaceActivationPayload,
  ): Promise<unknown>;
  updateGlobalAgent(payload: UpdateGlobalAgentPayload): Promise<unknown>;
};

/** Seed every other workspace BEFORE narrowing a global identity. A failed seed
 * leaves the global scope intact; scope is the commit point. Never copy persona,
 * model or write-policy from a stale UI snapshot while changing availability. */
export async function setAgentWorkspaceActive(
  api: ActivationApi,
  agent: GlobalAgent,
  workspaces: readonly WorkspaceSummary[],
  workspaceId: string,
  active: boolean,
): Promise<void> {
  const activationWorkspaces = agentActivationWorkspaces(workspaces);
  if (!activationWorkspaces.some((workspace) => workspace.workspaceId === workspaceId)) {
    throw new Error('请选择一个真实工作区；不绑定工作区的对话使用全局智能体。');
  }
  if ((agent.availabilityScope ?? 'global') === 'global') {
    for (const workspace of activationWorkspaces) {
      if (String(workspace.workspaceId) === workspaceId) continue;
      await api.setGlobalAgentWorkspaceActivation({
        agentId: agent.id,
        workspaceId: workspace.workspaceId,
        active: true,
      });
    }
  }
  await api.setGlobalAgentWorkspaceActivation({
    agentId: agent.id,
    workspaceId: workspaceId as WorkspaceId,
    active,
  });
  if ((agent.availabilityScope ?? 'global') === 'global') {
    await api.updateGlobalAgent({ agentId: agent.id, availabilityScope: 'workspace' });
  }
}

export async function setAgentGloballyActive(
  api: ActivationApi,
  agent: GlobalAgent,
  workspaces: readonly WorkspaceSummary[],
  active: boolean,
): Promise<void> {
  // On disable clear explicit activations before restricting scope, preserving a
  // global agent's effective state until all writes have succeeded.
  for (const workspace of agentActivationWorkspaces(workspaces)) {
    await api.setGlobalAgentWorkspaceActivation({
      agentId: agent.id,
      workspaceId: workspace.workspaceId,
      active,
    });
  }
  await api.updateGlobalAgent({
    agentId: agent.id,
    availabilityScope: active ? 'global' : 'workspace',
  });
}
