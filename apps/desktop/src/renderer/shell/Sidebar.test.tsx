/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Conversation, GlobalAgent, Team } from '@sync-think/shared';
import { DialogProvider } from './Dialog.js';
import { Sidebar, type SidebarProps } from './Sidebar.js';
import { emptyConversationGroups, INITIAL_NAV } from './shell-state.js';

function conv(
  partial: Partial<Omit<Conversation, 'id'>> & { id: string; track: Conversation['track'] },
): Conversation {
  return {
    targetRef: '',
    title: '',
    executionMode: 'workspace',
    interactionMode: 'execute',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    ...partial,
  } as Conversation;
}

const agent: GlobalAgent = {
  id: 'agent-reviewer' as GlobalAgent['id'],
  name: '质量与复审官',
  avatar: '🧪',
  persona: '',
  description: '',
  defaultModelId: 'model-x' as GlobalAgent['defaultModelId'],
  fallbackModelIds: [],
  skillIds: [],
  mcpServerIds: [],
  reasoningEffort: 'auto',
  archived: false,
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
};

const team: Team = {
  id: 'team-ship' as Team['id'],
  name: '交付小队',
  avatar: '🚀',
  mission: '',
  strategy: 'serial',
  members: [],
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
};

function noop() {}

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    nav: INITIAL_NAV,
    width: 280,
    conversations: [],
    agents: [agent],
    teams: [team],
    modelNames: new Map(),
    groups: emptyConversationGroups(),
    activeWorkspaceId: 'ws-a',
    multiSelect: false,
    selectedIds: new Set(),
    onSelectStage: noop,
    onToggleTrack: noop,
    onToggleSidebar: noop,
    onOpenConversation: noop,
    onNewConversation: noop,
    onTogglePin: noop,
    onRename: noop,
    onArchive: noop,
    onDelete: noop,
    onCreateGroup: noop,
    onRenameGroup: noop,
    onDeleteGroup: noop,
    onToggleGroupCollapsed: noop,
    onMoveToGroup: noop,
    onToggleMultiSelect: noop,
    onToggleSelected: noop,
    onBulkArchive: noop,
    onBulkDelete: noop,
    onBulkMoveToGroup: noop,
    onResizeStart: noop,
    ...overrides,
  };
  return render(
    <DialogProvider>
      <Sidebar {...props} />
    </DialogProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Sidebar NewMax conversation loading', () => {
  it('shows the NewMax workspace list skeleton instead of 加载中', () => {
    renderSidebar({ bootState: 'loading', conversations: [] });
    expect(screen.getByTestId('sidebar-workspace-list-skeleton')).toBeTruthy();
    expect(screen.queryByText('加载中…')).toBeNull();
  });

  it('keeps retained conversations visible while refresh is still loading', () => {
    renderSidebar({
      bootState: 'loading',
      conversations: [conv({ id: 'c-model', track: 'model', title: '已缓存对话', targetRef: 'gpt-4o' })],
    });
    expect(screen.queryByTestId('sidebar-workspace-list-skeleton')).toBeNull();
    expect(screen.getByText('已缓存对话')).toBeTruthy();
  });
});

describe('Sidebar conversation identity marks', () => {
  it('shows the kernel logo, agent avatar, and team avatar before each title', () => {
    renderSidebar({
      conversations: [
        conv({ id: 'c-model', track: 'model', title: 'hi', targetRef: 'gpt-4o' }),
        conv({
          id: 'c-agent',
          track: 'agent',
          title: '你是哪个大模型',
          targetRef: String(agent.id),
        }),
        conv({
          id: 'c-team',
          track: 'team',
          title: '一起发布',
          targetRef: String(team.id),
        }),
      ],
      kernelOverrides: { 'c-model': 'codex' },
    });

    const modelMark = screen.getByTestId('conversation-identity-c-model');
    expect(modelMark.getAttribute('data-kind')).toBe('kernel');
    expect(modelMark.getAttribute('data-kernel')).toBe('codex');
    expect(modelMark.querySelector('[aria-label="GPT"]')).toBeTruthy();

    const agentMark = screen.getByTestId('conversation-identity-c-agent');
    expect(agentMark.getAttribute('data-kind')).toBe('agent');
    expect(agentMark.textContent).toContain('🧪');

    const teamMark = screen.getByTestId('conversation-identity-c-team');
    expect(teamMark.getAttribute('data-kind')).toBe('team');
    expect(teamMark.textContent).toContain('🚀');
  });
});
