/**
 * Copied from NewMax percentages-BXMCSKIN-CUsm43rF.js:
 * shouldRenderRecentConversationEmptyState / shouldShowSidebarWorkspaceListSkeleton.
 */
export function shouldRenderRecentConversationEmptyState({
  conversationCount,
  isSyncingCCHistory,
  isLoadingConversations,
  activeWorkspaceId,
  switchContentWorkspaceId,
  switchProjectsWorkspaceId,
}: {
  conversationCount: number;
  isSyncingCCHistory: boolean;
  isLoadingConversations: boolean;
  activeWorkspaceId: string | null;
  switchContentWorkspaceId: string | null;
  switchProjectsWorkspaceId: string | null;
}): boolean {
  return (
    conversationCount === 0 &&
    !isSyncingCCHistory &&
    !isLoadingConversations &&
    activeWorkspaceId !== null &&
    switchContentWorkspaceId === activeWorkspaceId &&
    switchProjectsWorkspaceId === activeWorkspaceId
  );
}

export function shouldShowSidebarWorkspaceListSkeleton({
  activeWorkspaceId,
  switchContentWorkspaceId,
  switchProjectsWorkspaceId,
  isLoadingConversations,
  conversationCount = 0,
  projectCount = 0,
  archivedLoaded,
  isLoadingArchived,
}: {
  activeWorkspaceId: string | null;
  switchContentWorkspaceId: string | null;
  switchProjectsWorkspaceId: string | null;
  isLoadingConversations: boolean;
  conversationCount?: number;
  projectCount?: number;
  archivedLoaded: boolean;
  isLoadingArchived: boolean;
}): boolean {
  if (activeWorkspaceId === null) return true;
  const hasRetainedWorkspaceListContent = conversationCount > 0 || projectCount > 0;
  return (
    switchContentWorkspaceId !== activeWorkspaceId ||
    switchProjectsWorkspaceId !== activeWorkspaceId ||
    !archivedLoaded ||
    (Boolean(isLoadingConversations) && !hasRetainedWorkspaceListContent) ||
    (Boolean(isLoadingArchived) && !hasRetainedWorkspaceListContent)
  );
}

export const SIDEBAR_WORKSPACE_SKELETON_ROW_WIDTHS = ['72%', '56%', '80%'] as const;
