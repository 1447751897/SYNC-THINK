import { useEffect, useSyncExternalStore } from 'react';
import type { CollaborationRosterSummary } from '@sync-think/shared';

/**
 * Sidebar-wide cache of collaboration rosters (faces, busy flag, latest line).
 * One `list` request serves every row; `collaboration.updated` pushes trigger a
 * debounced refetch. Rows subscribe by conversation id.
 */
let rosters = new Map<string, CollaborationRosterSummary>();
const listeners = new Set<() => void>();
let users = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let loading = false;
let dirty = false;
let unsubscribe: (() => void) | undefined;

async function refresh() {
  const api = window.syncThink?.runtime;
  if (!api?.collaboration) return;
  if (loading) { dirty = true; return; }
  loading = true;
  try {
    const response = await api.collaboration({ action: 'list' });
    rosters = new Map((response.rosters ?? []).map((roster) => [roster.conversationId, roster]));
    for (const listener of listeners) listener();
  } catch { /* keep the last good roster; the next push retries */ }
  finally {
    loading = false;
    if (dirty) { dirty = false; schedule(); }
  }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = undefined; void refresh(); }, 250);
}

function retain() {
  if (users++ > 0) return;
  unsubscribe = window.syncThink?.runtime.onEvent?.((event) => {
    if (event.type === 'collaboration.updated') schedule();
  });
  void refresh();
}

function release() {
  if (--users > 0) return;
  unsubscribe?.(); unsubscribe = undefined;
  clearTimeout(timer); timer = undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Roster for one collaboration conversation; `undefined` for ordinary chats. */
export function useCollaborationRoster(conversationId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    retain();
    return release;
  }, [enabled]);
  return useSyncExternalStore(subscribe, () => (enabled ? rosters.get(conversationId) : undefined));
}

/** Test seam: seed or clear the cache without a runtime. */
export function setCollaborationRostersForTest(next: readonly CollaborationRosterSummary[]) {
  rosters = new Map(next.map((roster) => [roster.conversationId, roster]));
  for (const listener of listeners) listener();
}
