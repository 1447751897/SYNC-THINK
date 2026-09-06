import type { RunProcessView } from '@sync-think/protocol';

export interface ConversationReviewTarget {
  reviewScope: 'conversation';
  conversationId: string;
}
export type ReviewView = RunProcessView | ConversationReviewTarget;
export function isConversationReview(
  view: ReviewView | null | undefined,
): view is ConversationReviewTarget {
  return Boolean(view && 'reviewScope' in view && view.reviewScope === 'conversation');
}
export function reviewViewKey(view: ReviewView): string {
  return isConversationReview(view)
    ? 'conversation-review:' + view.conversationId
    : String(view.runId);
}
export function conversationReviewFromKey(key: string): ConversationReviewTarget | null {
  const prefix = 'conversation-review:';
  return key.startsWith(prefix) && key.length > prefix.length
    ? { reviewScope: 'conversation', conversationId: key.slice(prefix.length) }
    : null;
}
