/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  shouldRenderRecentConversationEmptyState,
  shouldShowSidebarWorkspaceListSkeleton,
} from './sidebar-newmax-loading.js';

describe('shouldShowSidebarWorkspaceListSkeleton', () => {
  it('shows the skeleton when NewMax has no workspace yet', () => {
    expect(
      shouldShowSidebarWorkspaceListSkeleton({
        activeWorkspaceId: null,
        switchContentWorkspaceId: null,
        switchProjectsWorkspaceId: null,
        isLoadingConversations: false,
        archivedLoaded: true,
        isLoadingArchived: false,
      }),
    ).toBe(true);
  });

  it('shows the skeleton while loading with no retained conversations', () => {
    expect(
      shouldShowSidebarWorkspaceListSkeleton({
        activeWorkspaceId: 'ws-a',
        switchContentWorkspaceId: 'ws-a',
        switchProjectsWorkspaceId: 'ws-a',
        isLoadingConversations: true,
        conversationCount: 0,
        archivedLoaded: true,
        isLoadingArchived: false,
      }),
    ).toBe(true);
  });

  it('keeps the retained list visible during refresh', () => {
    expect(
      shouldShowSidebarWorkspaceListSkeleton({
        activeWorkspaceId: 'ws-a',
        switchContentWorkspaceId: 'ws-a',
        switchProjectsWorkspaceId: 'ws-a',
        isLoadingConversations: true,
        conversationCount: 3,
        archivedLoaded: true,
        isLoadingArchived: false,
      }),
    ).toBe(false);
  });
});

describe('shouldRenderRecentConversationEmptyState', () => {
  it('hides the empty label while conversations are loading', () => {
    expect(
      shouldRenderRecentConversationEmptyState({
        conversationCount: 0,
        isSyncingCCHistory: false,
        isLoadingConversations: true,
        activeWorkspaceId: 'ws-a',
        switchContentWorkspaceId: 'ws-a',
        switchProjectsWorkspaceId: 'ws-a',
      }),
    ).toBe(false);
  });

  it('shows the empty label only after load finishes with no rows', () => {
    expect(
      shouldRenderRecentConversationEmptyState({
        conversationCount: 0,
        isSyncingCCHistory: false,
        isLoadingConversations: false,
        activeWorkspaceId: 'ws-a',
        switchContentWorkspaceId: 'ws-a',
        switchProjectsWorkspaceId: 'ws-a',
      }),
    ).toBe(true);
  });
});
