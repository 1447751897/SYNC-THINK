/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Conversation, GlobalAgent, Team } from '@sync-think/shared';
import type { DesktopUpdateSnapshot } from '../../desktop-update-contract.js';
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
  // 只有更新徽标的用例会注入 preload bridge，用例之间不能互相看到。
  Object.defineProperty(window, 'syncThink', { configurable: true, value: undefined });
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

describe('Sidebar conversation row layout', () => {
  it('stacks the agent name over the title, and keeps model rows single-line', () => {
    renderSidebar({
      conversations: [
        conv({ id: 'c-model', track: 'model', title: '模型侧标题', targetRef: 'gpt-4o' }),
        conv({ id: 'c-agent', track: 'agent', title: '智能体侧标题', targetRef: String(agent.id) }),
      ],
    });

    // Agent track: identity name on top, conversation title standing in for the
    // (not yet carried) message summary underneath.
    expect(screen.getByTestId('conversation-c-agent').textContent).toContain(agent.name);
    expect(screen.getByTestId('conversation-sub-c-agent').textContent).toBe('智能体侧标题');

    // Model track stays single-line — its title already is the identity.
    expect(screen.getByTestId('conversation-c-model').textContent).toContain('模型侧标题');
    expect(screen.queryByTestId('conversation-sub-c-model')).toBeNull();
  });

  it('drops the second line when the title repeats the identity name', () => {
    renderSidebar({
      conversations: [
        conv({ id: 'c-agent', track: 'agent', title: agent.name, targetRef: String(agent.id) }),
      ],
    });
    expect(screen.queryByTestId('conversation-sub-c-agent')).toBeNull();
  });
});

const updateSnapshot: DesktopUpdateSnapshot = {
  schemaVersion: 1,
  phase: 'available',
  configured: true,
  currentVersion: '0.1.0-rc.5',
  channel: 'latest',
  availableVersion: '0.1.0-rc.6',
  releaseNotes: null,
  progressPercent: null,
  checkedAt: null,
  downloadedAt: null,
  errorCode: null,
};

function installUpdateBridge(state: DesktopUpdateSnapshot) {
  let listener: ((snapshot: DesktopUpdateSnapshot) => void) | undefined;
  const updates = {
    getState: vi.fn().mockResolvedValue(state),
    subscribeState: vi.fn((next: (snapshot: DesktopUpdateSnapshot) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    }),
  };
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { updates } });
  return { push: (next: DesktopUpdateSnapshot) => listener?.(next) };
}

describe('Sidebar update badge', () => {
  it('says nothing about updates when no preload bridge is present', () => {
    renderSidebar();

    expect(screen.queryByTestId('sidebar-update-badge')).toBeNull();
    expect(screen.getByTestId('sidebar-settings-box').getAttribute('title')).toBe('设置');
  });

  it('hangs the pending version on the settings entry without blocking it', async () => {
    const onSelectStage = vi.fn();
    installUpdateBridge(updateSnapshot);
    renderSidebar({ onSelectStage });

    const badge = await screen.findByTestId('sidebar-update-badge');
    expect(badge.textContent).toBe('v0.1.0-rc.6');
    expect(screen.getByTestId('sidebar-settings-box').getAttribute('title')).toBe(
      '设置 · 可更新到 v0.1.0-rc.6',
    );

    // 徽标只是提示：点它应当和点设置入口一样打开设置，而不是变成另一个入口。
    fireEvent.click(badge);
    expect(onSelectStage).toHaveBeenCalledWith('settings');
  });

  it('withdraws the badge as soon as the feed reports the build is current', async () => {
    const bridge = installUpdateBridge(updateSnapshot);
    renderSidebar();

    expect(await screen.findByTestId('sidebar-update-badge')).toBeTruthy();

    act(() => bridge.push({ ...updateSnapshot, phase: 'up-to-date' }));

    await waitFor(() => expect(screen.queryByTestId('sidebar-update-badge')).toBeNull());
    expect(screen.getByTestId('sidebar-settings-box').getAttribute('title')).toBe('设置');
  });
});

it('keeps primary navigation readable and search presented as an available action', () => {
  renderSidebar();
  for (const id of [
    'nav-new-chat',
    'nav-search',
    'nav-scheduled',
    'nav-activity',
    'nav-browser',
    'nav-agents',
    'nav-teams',
    'nav-abilities',
  ]) {
    const button = screen.getByTestId(id);
    expect(button.classList.contains('text-text')).toBe(true);
    expect(button.classList.contains('opacity-70')).toBe(false);
  }
  const search = screen.getByTestId('nav-search');
  expect(search.title).toBe('搜索');
  fireEvent.click(search);
  expect(screen.getByPlaceholderText('搜索对话…')).toBeTruthy();
});
