import type { WorkspaceSummary } from '@sync-think/protocol';
import type { WorkspaceId } from '@sync-think/shared';
/** Renderer-only layout scope. Never send this ID to Runtime as a workspace binding. */
export const PROJECTLESS_SCOPE = '__projectless__';
export const PROJECTLESS_NAME = '不绑定工作区';
export const runtimeWorkspaceId = (id?: string) =>
  id && id !== PROJECTLESS_SCOPE ? (id as WorkspaceId) : undefined;
export const projectlessWorkspace: WorkspaceSummary = {
  workspaceId: PROJECTLESS_SCOPE as WorkspaceId,
  name: PROJECTLESS_NAME,
  icon: '☁',
  createdAt: '',
  updatedAt: '',
};
export function projectConversationScopes<T extends { workspaceId?: string }>(
  conversations: readonly T[],
  workspaces: readonly WorkspaceSummary[],
): T[] {
  const internal = new Set(
    workspaces
      .filter((workspace) => workspace.name === '__inbox__')
      .map((workspace) => String(workspace.workspaceId)),
  );
  return conversations.map((conversation) =>
    !conversation.workspaceId || internal.has(conversation.workspaceId)
      ? { ...conversation, workspaceId: PROJECTLESS_SCOPE }
      : conversation,
  );
}
export function projectWorkspaceScopes(
  workspaces: readonly WorkspaceSummary[],
): WorkspaceSummary[] {
  return [
    ...workspaces.filter(
      (workspace) => workspace.name !== '__inbox__' && workspace.workspaceId !== PROJECTLESS_SCOPE,
    ),
    projectlessWorkspace,
  ];
}

export function runtimeConversation<T extends { workspaceId?: string }>(conversation: T): T {
  return conversation.workspaceId === PROJECTLESS_SCOPE
    ? { ...conversation, workspaceId: undefined }
    : conversation;
}
