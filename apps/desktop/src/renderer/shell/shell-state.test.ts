import { describe, expect, it } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import {
  buildTrackTree,
  closeConversationTab,
  createConversationGroup,
  deleteConversationGroup,
  emptyConversationGroups,
  filterByWorkspace,
  filterConversationsByQuery,
  groupConversations,
  INITIAL_NAV,
  moveConversationToGroup,
  openConversation,
  openConversationTab,
  partitionActiveArchived,
  pruneOpenTabs,
  rememberWorkspaceSelection,
  renameConversationGroup,
  reorderConversationTab,
  resolveWorkspaceSelection,
  selectStage,
  resolveConversationRowMark,
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

describe('targetName for agent track', () => {
  it('resolves agent name from library and falls back safely', () => {
    const agentConv = conv({ id: 'c-agent', track: 'agent', targetRef: 'agent-pirate' });
    expect(
      targetName(
        agentConv,
        [
          {
            id: 'agent-pirate' as never,
            name: '海盗船长',
            avatar: '🏴‍☠️',
            persona: '啊哈',
            description: '',
            defaultModelId: 'model-1' as never,
            fallbackModelIds: [],
            skillIds: [],
            mcpServerIds: [],
            reasoningEffort: 'auto',
            archived: false,
            createdAt: '2026-07-22T00:00:00.000Z',
            updatedAt: '2026-07-22T00:00:00.000Z',
          },
        ],
        [],
      ),
    ).toBe('海盗船长');
    expect(targetName(agentConv, [], [])).toBe('智能体');
  });
});

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

describe('open conversation tabs', () => {
  it('opens a tab without reordering on re-focus', () => {
    const once = openConversationTab({}, 'ws-a', 'c1');
    expect(once).toEqual({ 'ws-a': ['c1'] });
    const twice = openConversationTab(once, 'ws-a', 'c2');
    expect(twice).toEqual({ 'ws-a': ['c1', 'c2'] });
    expect(openConversationTab(twice, 'ws-a', 'c1')).toBe(twice);
  });

  it('closes a tab and prefers the right neighbour as next selection', () => {
    const tabs = { 'ws-a': ['c1', 'c2', 'c3'] };
    const closed = closeConversationTab(tabs, 'ws-a', 'c2');
    expect(closed.tabs).toEqual({ 'ws-a': ['c1', 'c3'] });
    expect(closed.nextSelectedId).toBe('c3');
  });

  it('clears the workspace entry when the last tab closes', () => {
    const closed = closeConversationTab({ 'ws-a': ['c1'] }, 'ws-a', 'c1');
    expect(closed.tabs).toEqual({});
    expect(closed.nextSelectedId).toBeUndefined();
  });

  it('prunes deleted conversation ids from open tabs', () => {
    const tabs = { 'ws-a': ['c1', 'gone'], 'ws-b': ['gone-only'] };
    const pruned = pruneOpenTabs(tabs, new Set(['c1']));
    expect(pruned).toEqual({ 'ws-a': ['c1'] });
  });

  it('restores the remembered open tab when switching workspaces', () => {
    const tabs = { 'ws-a': ['a1', 'a2'], 'ws-b': ['b1'] };
    const selected = { 'ws-a': 'a1', 'ws-b': 'b1' };
    expect(resolveWorkspaceSelection(tabs, selected, 'ws-a')).toBe('a1');
    expect(resolveWorkspaceSelection(tabs, { 'ws-a': 'missing' }, 'ws-a')).toBe('a2');
    expect(resolveWorkspaceSelection(tabs, {}, 'ws-b')).toBe('b1');
    expect(resolveWorkspaceSelection(tabs, {}, 'ws-empty')).toBeUndefined();
  });

  it('remembers and clears per-workspace selection', () => {
    const once = rememberWorkspaceSelection({}, 'ws-a', 'c1');
    expect(once).toEqual({ 'ws-a': 'c1' });
    expect(rememberWorkspaceSelection(once, 'ws-a', undefined)).toEqual({});
  });

  it('reorders open tabs by dragging one onto another', () => {
    const tabs = { 'ws-a': ['c1', 'c2', 'c3'] };
    expect(reorderConversationTab(tabs, 'ws-a', 'c1', 'c3')).toEqual({
      'ws-a': ['c2', 'c3', 'c1'],
    });
    expect(reorderConversationTab(tabs, 'ws-a', 'c3', 'c1')).toEqual({
      'ws-a': ['c3', 'c1', 'c2'],
    });
    expect(reorderConversationTab(tabs, 'ws-a', 'c2', 'c2')).toBe(tabs);
  });
});

describe('conversation grouping', () => {
  it('filters by workspace: no 全部 — undefined yields empty; only matching workspace', () => {
    const conversations = [
      conv({ id: 'c1', track: 'model', workspaceId: 'ws-a' as never }),
      conv({ id: 'c2', track: 'model', workspaceId: 'ws-b' as never }),
      conv({ id: 'c3', track: 'model' }), // 未归类
    ];
    expect(filterByWorkspace(conversations, undefined)).toEqual([]);
    expect(filterByWorkspace(conversations, 'ws-a').map((c) => c.id)).toEqual(['c1']);
    expect(filterByWorkspace(conversations, 'ws-none')).toEqual([]);
  });

  it('builds track tree with groups and ungrouped residual', () => {
    const conversations = [
      conv({ id: 'c1', track: 'model' }),
      conv({ id: 'c2', track: 'model' }),
      conv({ id: 'c3', track: 'model' }),
    ];
    let groups = emptyConversationGroups();
    groups = createConversationGroup(groups, 'model', 'Sync-think', 'g1');
    groups = moveConversationToGroup(groups, 'model', 'c1', 'g1');
    groups = moveConversationToGroup(groups, 'model', 'c2', 'g1');
    const tree = buildTrackTree(conversations, groups.model);
    expect(tree.groups).toHaveLength(1);
    expect(tree.groups[0]!.conversations.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(tree.ungrouped.map((c) => c.id)).toEqual(['c3']);
    groups = renameConversationGroup(groups, 'model', 'g1', 'Main');
    expect(groups.model[0]!.name).toBe('Main');
    groups = deleteConversationGroup(groups, 'model', 'g1');
    expect(buildTrackTree(conversations, groups.model).ungrouped).toHaveLength(3);
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
    const modelNames = new Map([
      ['model-x', 'Claude Sonnet'],
      ['grok-4.5', 'Grok 4.5'],
    ]);
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
    // Unknown / stale model ids keep a model-like label, never the track name.
    expect(
      targetName(conv({ id: 'e', track: 'model', targetRef: 'model-unknown' }), agents, teams, modelNames),
    ).toBe('model-unknown');
    expect(targetName(conv({ id: 'f', track: 'model', targetRef: 'model-x' }), agents, teams)).toBe(
      'model-x',
    );
    expect(
      targetName(conv({ id: 'g', track: 'model', targetRef: 'z-ai/glm-5.2' }), agents, teams),
    ).toBe('glm-5.2');
    // Compose model override wins over the conversation's original targetRef.
    expect(
      targetName(
        conv({ id: 'h', track: 'model', targetRef: 'model-x' }),
        agents,
        teams,
        modelNames,
        { h: 'grok-4.5' },
      ),
    ).toBe('Grok 4.5');
    expect(
      targetName(
        conv({ id: 'i', track: 'model', targetRef: 'model-x' }),
        agents,
        teams,
        modelNames,
        new Map([['i', 'grok-4.5']]),
      ),
    ).toBe('Grok 4.5');
    // Agent/team tracks ignore model overrides — identity stays the agent/team.
    expect(
      targetName(
        conv({ id: 'j', track: 'agent', targetRef: 'agent-1' }),
        agents,
        teams,
        modelNames,
        { j: 'grok-4.5' },
      ),
    ).toBe('前端小张');
  });

  it('resolves a kernel mark for model chats and avatars for agent/team chats', () => {
    const agents = [{ id: 'agent-1', name: '质量与复审官', avatar: '🧪' }] as never[];
    const teams = [{ id: 'team-1', name: '交付小队', avatar: '🚀' }] as never[];

    expect(
      resolveConversationRowMark(conv({ id: 'm1', track: 'model' }), agents, teams),
    ).toEqual({ kind: 'kernel', kernelId: 'native' });
    expect(
      resolveConversationRowMark(conv({ id: 'm2', track: 'model' }), agents, teams, {
        m2: 'codex',
      }),
    ).toEqual({ kind: 'kernel', kernelId: 'codex' });
    expect(
      resolveConversationRowMark(
        conv({ id: 'a1', track: 'agent', targetRef: 'agent-1' }),
        agents,
        teams,
        { a1: 'codex' },
      ),
    ).toEqual({ kind: 'agent', name: '质量与复审官', avatar: '🧪' });
    expect(
      resolveConversationRowMark(
        conv({ id: 't1', track: 'team', targetRef: 'team-1' }),
        agents,
        teams,
      ),
    ).toEqual({ kind: 'team', name: '交付小队', avatar: '🚀' });
    expect(
      resolveConversationRowMark(
        conv({ id: 'missing', track: 'agent', targetRef: 'gone' }),
        agents,
        teams,
      ),
    ).toEqual({ kind: 'agent', name: '智能体', avatar: undefined });
  });
});
