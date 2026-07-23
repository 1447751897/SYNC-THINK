/**
 * NewMax-style recent conversation projection.
 * Keeps model / agent / team as nested sections under one “最近对话” entry.
 * There are intentionally no date buckets: pinned conversations lead each section,
 * followed by the remaining conversations in last-active order.
 */

import type { TalkTrackId } from './product-shell-nav.js';

export interface RecentConversationItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly track: TalkTrackId;
  readonly pinned?: boolean;
  readonly status?: string;
  readonly updatedAt?: string;
  readonly createdAt?: string;
  readonly lastOpenedAt?: string;
  readonly parentTaskId?: string;
}

export interface RecentConversationSection {
  readonly track: TalkTrackId;
  readonly label: string;
  readonly items: readonly RecentConversationItem[];
  readonly pinnedCount: number;
  readonly totalCount: number;
}

export interface RecentConversationsModel {
  readonly query: string;
  readonly sections: readonly RecentConversationSection[];
  readonly totalCount: number;
  readonly filteredCount: number;
}

const TRACK_ORDER: readonly TalkTrackId[] = ['model', 'agent', 'team'];

export function sortKeyForConversation(item: RecentConversationItem): string {
  return item.lastOpenedAt || item.updatedAt || item.createdAt || '';
}

export function inferTalkTrack(input: {
  participationMode?: string | null;
  explicitTrack?: TalkTrackId | null;
}): TalkTrackId {
  if (input.explicitTrack) return input.explicitTrack;
  const mode = String(input.participationMode ?? '');
  if (mode === 'collaboration' || mode === 'automatic') return 'team';
  // Legacy tasks predate an explicit conversation track and remain agent-owned.
  return 'agent';
}

export function buildRecentConversationsModel(input: {
  items: readonly RecentConversationItem[];
  query?: string;
}): RecentConversationsModel {
  const query = (input.query ?? '').trim().toLowerCase();
  const filtered = query
    ? input.items.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          (item.subtitle ?? '').toLowerCase().includes(query),
      )
    : [...input.items];

  const sections = TRACK_ORDER.map((track): RecentConversationSection => {
    const items = filtered
      .filter((item) => item.track === track)
      .sort((a, b) => {
        const pinnedOrder = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        if (pinnedOrder !== 0) return pinnedOrder;
        return sortKeyForConversation(b).localeCompare(sortKeyForConversation(a));
      });
    return {
      track,
      label: trackSectionLabel(track),
      items,
      pinnedCount: items.filter((item) => item.pinned).length,
      totalCount: input.items.filter((item) => item.track === track).length,
    };
  });

  return {
    query,
    sections,
    totalCount: input.items.length,
    filteredCount: filtered.length,
  };
}

export function trackCreateLabel(track: TalkTrackId): string {
  if (track === 'model') return '新建模型对话';
  if (track === 'team') return '新建小队对话';
  return '新建智能体对话';
}

export function trackSectionLabel(track: TalkTrackId): string {
  if (track === 'model') return '模型对话';
  if (track === 'team') return '小队对话';
  return '智能体对话';
}
