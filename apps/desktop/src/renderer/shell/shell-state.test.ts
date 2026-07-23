import { describe, expect, it } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import {
  filterByWorkspace,
  filterConversationsByQuery,
  groupConversations,
  INITIAL_NAV,
  openConversation,
  partitionActiveArchived,
  selectStage,
  targetName,
  toggleSidebar,
  toggleTrack,
} from './shell-state.js';

function conv(
  partial: Partial<Omit<Conversation, 'id'>> & { id: string; track: Conversation['track'] },
): Conversation {
  return {
    targetRef: 'model-x',
    title: '',
    executionMode: 'workspace',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...partial,
  } as unknown as Conversation;
}

describe('shell nav state', () => {
  it('defaults to talk stage with all three tracks expanded', () => {
    expect(INITIAL_NAV.stage).toBe('talk');
    expect(INITIAL_NAV.expandedTracks).toEqual({ model: true, agent: true, team: true });
  });

  it('toggles a single track without touching the others', () => {
    const next = toggleTrack(INITIAL_NAV, 'agent');
    expect(next.expandedTracks).toEqual({ model: true, agent: false, team: true });
  });

  it('opening a conversation forces the talk stage', () => {
    const onSettings = selectStage(INITIAL_NAV, 'settings');
    const next = openConversation(onSettings, 'conv-1');
    expect(next.stage).toBe('talk');
    expect(next.selectedConversationId).toBe('conv-1');
  });

  it('sidebar starts expanded and toggles collapse without touching other state', () => {
    expect(INITIAL_NAV.sidebarCollapsed).toBe(false);
    const collapsed = toggleSidebar(INITIAL_NAV);
    expect(collapsed.sidebarCollapsed).toBe(true);
    expect(collapsed.stage).toBe(INITIAL_NAV.stage);
    expect(collapsed.expandedTracks).toEqual(INITIAL_NAV.expandedTracks);
    expect(toggleSidebar(collapsed).sidebarCollapsed).toBe(false);
  });
});

describe('conversation grouping', () => {
  it('filters by project tab: undefined shows all including 未归类', () => {
    const conversations = [
      conv({ id: 'c1', track: 'model', workspaceId: 'ws-a' as never }),
      conv({ id: 'c2', track: 'model', workspaceId: 'ws-b' as never }),
      conv({ id: 'c3', track: 'model' }), // 未归类
    ];
    expect(filterByWorkspace(conversations, undefined).map((c) => c.id)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
    expect(filterByWorkspace(conversations, 'ws-a').map((c) => c.id)).toEqual(['c1']);
    expect(filterByWorkspace(conversations, 'ws-none')).toEqual([]);
  });

  it('splits conversations by track preserving store order (pinned-first)', () => {
    const grouped = groupConversations([
      conv({ id: 'c1', track: 'model', pinnedAt: '2026-07-22T01:00:00.000Z' }),
      conv({ id: 'c2', track: 'agent' }),
      conv({ id: 'c3', track: 'model' }),
      conv({ id: 'c4', track: 'team' }),
    ]);
    expect(grouped.model.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(grouped.agent.map((c) => c.id)).toEqual(['c2']);
    expect(grouped.team.map((c) => c.id)).toEqual(['c4']);
  });

  it('partitions active vs archived conversations', () => {
    const { active, archived } = partitionActiveArchived([
      conv({ id: 'c1', track: 'model' }),
      conv({ id: 'c2', track: 'agent', archivedAt: '2026-07-22T02:00:00.000Z' }),
      conv({ id: 'c3', track: 'team' }),
    ]);
    expect(active.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(archived.map((c) => c.id)).toEqual(['c2']);
  });

  it('filters conversations by title / target name / targetRef', () => {
    const conversations = [
      conv({ id: 'c1', track: 'model', title: '重构登录页', targetRef: 'gpt-4o' }),
      conv({ id: 'c2', track: 'agent', title: '', targetRef: 'agent-writer' }),
      conv({ id: 'c3', track: 'team', title: '发布检查', targetRef: 'team-qa' }),
    ];
    const names = (c: Conversation) =>
      c.id === 'c2' ? '写手智能体' : c.id === 'c3' ? '质检小队' : '模型对话';
    expect(filterConversationsByQuery(conversations, '登录', names).map((c) => c.id)).toEqual([
      'c1',
    ]);
    expect(filterConversationsByQuery(conversations, '写手', names).map((c) => c.id)).toEqual([
      'c2',
    ]);
    expect(filterConversationsByQuery(conversations, 'team-qa', names).map((c) => c.id)).toEqual([
      'c3',
    ]);
    expect(filterConversationsByQuery(conversations, '  ', names)).toHaveLength(3);
  });

  it('resolves target display names per track with fallbacks', () => {
    const agents = [{ id: 'agent-1', name: '前端小张' }] as never[];
    const teams = [{ id: 'team-1', name: '交付小队' }] as never[];
    const modelNames = new Map([['model-x', 'Claude Sonnet']]);
    expect(targetName(conv({ id: 'a', track: 'agent', targetRef: 'agent-1' }), agents, teams)).toBe(
      '前端小张',
    );
    expect(targetName(conv({ id: 'b', track: 'team', targetRef: 'team-1' }), agents, teams)).toBe(
      '交付小队',
    );
    expect(targetName(conv({ id: 'c', track: 'agent', targetRef: 'agent-gone' }), agents, teams)).toBe(
      '智能体',
    );
    // Model refs resolve through the provider catalog — never show the raw id.
    expect(
      targetName(conv({ id: 'd', track: 'model', targetRef: 'model-x' }), agents, teams, modelNames),
    ).toBe('Claude Sonnet');
    expect(
      targetName(conv({ id: 'e', track: 'model', targetRef: 'model-unknown' }), agents, teams, modelNames),
    ).toBe('模型对话');
    expect(targetName(conv({ id: 'f', track: 'model', targetRef: 'model-x' }), agents, teams)).toBe(
      '模型对话',
    );
  });
});
