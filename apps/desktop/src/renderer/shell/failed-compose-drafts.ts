import type { ComposeAttachment } from './compose-mention.js';

export interface FailedComposeDraft {
  readonly text: string;
  readonly attachments: readonly ComposeAttachment[];
}

const emptyDrafts: readonly FailedComposeDraft[] = Object.freeze([]);
const drafts = new Map<string, readonly FailedComposeDraft[]>();
const listeners = new Map<string, Set<() => void>>();

export function readFailedComposeDrafts(scope: string): readonly FailedComposeDraft[] {
  return drafts.get(scope) ?? emptyDrafts;
}

export function subscribeFailedComposeDrafts(scope: string, listener: () => void): () => void {
  const subscribers = listeners.get(scope) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(scope, subscribers);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(scope);
  };
}

export function rememberFailedComposeDraft(scope: string, draft: FailedComposeDraft): void {
  const snapshot = Object.freeze({
    text: draft.text,
    attachments: Object.freeze(
      draft.attachments.map((attachment) => Object.freeze({ ...attachment })),
    ),
  });
  drafts.set(scope, Object.freeze([...readFailedComposeDrafts(scope), snapshot]));
  for (const listener of listeners.get(scope) ?? []) listener();
}

export function takeFailedComposeDrafts(scope: string): readonly FailedComposeDraft[] {
  const current = readFailedComposeDrafts(scope);
  drafts.delete(scope);
  if (current.length) for (const listener of listeners.get(scope) ?? []) listener();
  return current;
}
