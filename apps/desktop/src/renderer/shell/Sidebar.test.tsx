/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  localStorage.clear();
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
  it('keeps the kernel logo and omits histories managed in the agent area', () => {
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

    expect(screen.queryByTestId('track-header-agent')).toBeNull();
    expect(screen.queryByTestId('track-header-team')).toBeNull();
    expect(screen.queryByTestId('conversation-c-agent')).toBeNull();
    expect(screen.queryByTestId('conversation-c-team')).toBeNull();
  });
});

describe('Sidebar conversation space isolation', () => {
  it('keeps direct, team and group history out of model recent chats and archives', () => {
    const group = conv({ id: 'c-group', track: 'agent', title: '研究群聊', collaborationKind: 'group' });
    renderSidebar({ conversations: [group, conv({ ...group, id: 'c-archived', archivedAt: '2026-09-29' }), conv({ id: 'c-model', track: 'model' })] });
    expect(screen.queryByTestId('conversation-c-group')).toBeNull();
    expect(screen.queryByTestId('conversation-c-archived')).toBeNull();
    expect(screen.getByTestId('conversation-c-model')).toBeTruthy();
  });
});

describe('Sidebar conversation row layout', () => {
  it('shows regular conversations directly, even with a previously collapsed model track', () => {
    const onOpenConversation = vi.fn();
    renderSidebar({
      nav: { ...INITIAL_NAV, expandedTracks: { ...INITIAL_NAV.expandedTracks, model: false } },
      onOpenConversation,
      conversations: [
        conv({ id: 'c-model', track: 'model', title: '模型侧标题', targetRef: 'gpt-4o' }),
        conv({ id: 'c-agent', track: 'agent', title: '智能体侧标题', targetRef: String(agent.id) }),
      ],
    });

    expect(screen.queryByTestId('track-header-model')).toBeNull();
    expect(screen.queryByText('模型对话')).toBeNull();
    const row = screen.getByTestId('conversation-c-model');
    expect(row.textContent).toContain('模型侧标题');
    expect(row.closest('.shell-tree-branch')).toBeNull();
    expect(row.closest('.shell-collapse')?.classList.contains('shell-collapse--open')).toBe(true);
    expect(screen.queryByTestId('conversation-sub-c-model')).toBeNull();
    fireEvent.click(row);
    expect(onOpenConversation).toHaveBeenCalledWith('c-model');
  });

  it('omits archived agent histories from the regular conversation archive', () => {
    renderSidebar({
      conversations: [
        conv({
          id: 'c-agent',
          track: 'agent',
          title: agent.name,
          targetRef: String(agent.id),
          archivedAt: '2026-09-23T00:00:00.000Z',
        }),
      ],
    });
    expect(screen.queryByTestId('archive-section-toggle')).toBeNull();
    expect(screen.queryByTestId('conversation-c-agent')).toBeNull();
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


it('switches to contacts and back without navigating away from the current chat', async () => {
  const onSelectStage = vi.fn();
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      runtime: {
        listGlobalAgentWorkspaceActivations: vi.fn().mockResolvedValue({ activations: [] }),
      },
    },
  });
  renderSidebar({ onSelectStage });
  fireEvent.click(screen.getAllByRole('button', { name: '智能体' })[0]!);
  await screen.findByRole('region', { name: '智能体聊天列表' });
  expect(screen.queryByTestId('nav-new-chat')).toBeNull();
  expect(localStorage.getItem('sync-think.sidebar-mode.v1')).toBe('agents');
  expect(onSelectStage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '会话' }));
  expect(screen.getByTestId('nav-new-chat')).toBeTruthy();
});


describe('main chat project navigation', () => {
  it('expands projects independently without switching the current workspace or exposing hidden entries', () => {
    const onSelectWorkspace = vi.fn();
    renderSidebar({
      workspaces: [
        { workspaceId: 'ws-a' as NonNullable<Conversation['workspaceId']>, name: '项目 A', folderPath: '/a', createdAt: agent.createdAt, updatedAt: agent.updatedAt },
        { workspaceId: 'ws-b' as NonNullable<Conversation['workspaceId']>, name: '项目 B', folderPath: '/b', createdAt: agent.createdAt, updatedAt: agent.updatedAt },
        { workspaceId: 'ws-hidden' as NonNullable<Conversation['workspaceId']>, name: '隐藏项目', hidden: true, createdAt: agent.createdAt, updatedAt: agent.updatedAt },
      ],
      onSelectWorkspace,
      conversations: [conv({ id: 'project-chat', workspaceId: 'ws-a' as Conversation['workspaceId'], track: 'model', title: '真实对话' })],
    });
    expect(screen.getByTestId('recent-section-toggle').textContent).toBe('项目 A');
    expect(screen.getByTestId('recent-section-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('真实对话')).toBeTruthy();
    expect(screen.queryByText('隐藏项目')).toBeNull();
    fireEvent.click(screen.getByTestId('sidebar-workspace-ws-b'));
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(screen.getByTestId('sidebar-workspace-ws-b').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('recent-section-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('toggles the same persisted appearance setting used by Settings', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '深色模式' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByRole('button', { name: '深色模式' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '浅色模式' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});


describe('developer component library navigation', () => {
  it('keeps developer-only previews out of the public sidebar', () => {
    renderSidebar();
    expect(screen.queryByTestId('nav-design-system')).toBeNull();
    expect(screen.queryByRole('button', { name: '组件库' })).toBeNull();
    expect(screen.getByTestId('nav-scheduled')).toBeTruthy();
    expect(screen.getByTestId('nav-settings')).toBeTruthy();
  });
});


describe('independent workspace conversation trees', () => {
  const workspaceProps = () => ({
    workspaces: ['a', 'b'].map(id => ({ workspaceId: ('ws-' + id) as NonNullable<Conversation['workspaceId']>, name: '项目 ' + id.toUpperCase(), createdAt: agent.createdAt, updatedAt: agent.updatedAt })),
    onSelectWorkspace: vi.fn(),
    conversations: [
      conv({ id: 'chat-a', workspaceId: 'ws-a' as Conversation['workspaceId'], track: 'model', title: 'A 的会话' }),
      conv({ id: 'chat-b', workspaceId: 'ws-b' as Conversation['workspaceId'], track: 'model', title: 'B 的会话' }),
      conv({ id: 'archive-b', workspaceId: 'ws-b' as Conversation['workspaceId'], track: 'model', title: 'B 的归档', archivedAt: agent.createdAt }),
    ],
  });
  it('keeps each conversation and archive in its owning branch', () => {
    renderSidebar(workspaceProps());
    fireEvent.click(screen.getByTestId('sidebar-workspace-ws-b'));
    const a = screen.getByTestId('sidebar-workspace-section-ws-a');
    const b = screen.getByTestId('sidebar-workspace-section-ws-b');
    expect(a.textContent).toContain('A 的会话');
    expect(a.textContent).not.toContain('B 的会话');
    expect(a.textContent).not.toContain('B 的归档');
    expect(b.textContent).toContain('B 的会话');
    expect(b.textContent).toContain('B 的归档');
    fireEvent.click(screen.getByTestId('recent-section-toggle'));
    expect(screen.getByTestId('recent-section-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('sidebar-workspace-ws-b').getAttribute('aria-expanded')).toBe('true');
  });
  it('persists expansion independently of the active workspace', () => {
    const props = workspaceProps();
    const view = renderSidebar(props);
    fireEvent.click(screen.getByTestId('sidebar-workspace-ws-b'));
    fireEvent.click(screen.getByTestId('recent-section-toggle'));
    view.unmount();
    renderSidebar(props);
    expect(screen.getByTestId('recent-section-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('sidebar-workspace-ws-b').getAttribute('aria-expanded')).toBe('true');
  });
  it('opens a conversation by its ID and creates drafts in the selected branch', () => {
    const onOpenConversation = vi.fn();
    const onNewConversation = vi.fn();
    renderSidebar({ ...workspaceProps(), onOpenConversation, onNewConversation });
    fireEvent.click(screen.getByTestId('sidebar-workspace-ws-b'));
    fireEvent.click(screen.getByTestId('conversation-chat-b'));
    expect(onOpenConversation).toHaveBeenCalledWith('chat-b');
    fireEvent.click(screen.getByTestId('recent-new-conversation-ws-b'));
    expect(onNewConversation).toHaveBeenCalledWith('model', 'ws-b');
  });
});


it('renders and toggles groups using their owning workspace, not the current workspace', () => {
  const group = (name: string, id: string) => ({ id, name, collapsed: false, conversationIds: ['chat-b'] });
  const onToggleGroupCollapsed = vi.fn();
  renderSidebar({
    workspaces: ['a', 'b'].map(id => ({ workspaceId: ('ws-' + id) as NonNullable<Conversation['workspaceId']>, name: id, createdAt: agent.createdAt, updatedAt: agent.updatedAt })),
    onSelectWorkspace: vi.fn(),
    conversations: [conv({ id: 'chat-b', workspaceId: 'ws-b' as Conversation['workspaceId'], track: 'model', title: 'B 的会话' })],
    workspaceGroups: { 'ws-a': { ...emptyConversationGroups(), model: [group('A 分组', 'a-group')] }, 'ws-b': { ...emptyConversationGroups(), model: [group('B 分组', 'b-group')] } },
    onToggleGroupCollapsed,
  });
  fireEvent.click(screen.getByTestId('sidebar-workspace-ws-b'));
  const branchB = screen.getByTestId('sidebar-workspace-section-ws-b');
  expect(branchB.textContent).toContain('B 分组');
  expect(branchB.textContent).not.toContain('A 分组');
  fireEvent.click(within(branchB).getByRole('button', { name: 'B 分组 1' }));
  expect(onToggleGroupCollapsed).toHaveBeenCalledWith('model', 'b-group', 'ws-b');
});
