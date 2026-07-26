/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, forwardRef, useImperativeHandle } from 'react';

const runtime = {
  connect: vi.fn().mockResolvedValue({ snapshot: [] }),
  onEvent: vi.fn(() => vi.fn()),
  onOpenConversation: vi.fn((_listener: (conversationId: string) => void) => vi.fn()),
  notifyRendererReady: vi.fn(),
  sendConversationMessage: vi.fn().mockResolvedValue({
    threadId: 'thread-a',
    taskVersion: 0,
    conversationTitle: '首条消息',
  }),
  appendMessage: vi.fn().mockResolvedValue({ messageId: 'message-a', taskVersion: 1 }),
  renameConversation: vi.fn().mockResolvedValue({ conversation: { id: 'created-conversation' } }),
  setConversationPinned: vi.fn().mockResolvedValue({ conversation: { id: 'created-conversation' } }),
  setConversationArchived: vi.fn().mockResolvedValue({ conversation: { id: 'created-conversation' } }),
  setConversationExecutionMode: vi.fn().mockResolvedValue({ conversation: { id: 'created-conversation' } }),
  deleteConversation: vi.fn().mockResolvedValue({}),
  createConversation: vi.fn().mockResolvedValue({
    conversation: {
      id: 'created-conversation',
      workspaceId: 'ws-a',
      track: 'model',
      targetRef: 'model-a',
      title: '',
      executionMode: 'full-access',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    },
  }),
  listConversations: vi.fn().mockResolvedValue({ conversations: [] }),
  listGlobalAgents: vi.fn().mockResolvedValue({ agents: [] }),
  listTeams: vi.fn().mockResolvedValue({ teams: [] }),
  listProviders: vi.fn().mockResolvedValue({ providers: [] }),
  listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [] }),
};

const topBarProps: { current?: Record<string, unknown> } = {};
const chatViewProps: { current?: Record<string, unknown> } = {};
const sidebarProps: { current?: Record<string, unknown> } = {};
const newConversationDialogProps: { current?: Record<string, unknown> } = {};

const completeMock = vi.fn(async () => true);

vi.mock('../runtime-connection.js', () => ({
  startRuntimeConnection: ({ onConnected }: { onConnected(result: { snapshot: unknown[] }): void }) => {
    onConnected({ snapshot: [] });
    return vi.fn();
  },
}));

vi.mock('./TopBar.js', () => ({
  TopBar: (props: Record<string, unknown>) => {
    topBarProps.current = props;
    return createElement(
      'div',
      { 'data-testid': 'mock-topbar' },
      createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'mock-switch-workspace',
          onClick: () =>
            (props.onSelectWorkspace as ((id: string) => void) | undefined)?.('ws-b'),
        },
        '切换工作区',
      ),
    );
  },
}));
vi.mock('./ChatView.js', () => ({
  ChatView: (props: Record<string, unknown>) => {
    chatViewProps.current = props;
    return createElement('div', { 'data-testid': 'mock-chat-view' });
  },
}));
vi.mock('./Sidebar.js', () => ({
  Sidebar: (props: Record<string, unknown>) => {
    sidebarProps.current = props;
    const conversations = (props.conversations as Array<{ id: string; title?: string }>) ?? [];
    return createElement('div', {}, [
      createElement('button', {
        key: 'nav',
        type: 'button',
        'data-testid': 'nav-settings',
        onClick: () => (props.onSelectStage as ((stage: string) => void) | undefined)?.('settings'),
      }),
      createElement('button', {
        key: 'abilities',
        type: 'button',
        'data-testid': 'nav-abilities',
        onClick: () => (props.onSelectStage as ((stage: string) => void) | undefined)?.('abilities'),
      }),
      ...conversations.map((c) =>
        createElement(
          'button',
          {
            key: c.id,
            type: 'button',
            onClick: () =>
              (props.onOpenConversation as ((id: string) => void) | undefined)?.(c.id),
          },
          c.title || c.id,
        ),
      ),
      createElement(
        'button',
        {
          key: 'dup',
          type: 'button',
          'data-testid': 'mock-sidebar-duplicate',
          onClick: () => (props.onDuplicate as ((id: string) => void) | undefined)?.('conv-src'),
        },
        '模拟复制',
      ),
    ]);
  },
}));
vi.mock('./AgentLibrary.js', () => ({ AgentLibrary: () => null }));
vi.mock('./AbilitiesPage.js', () => ({
  AbilitiesPage: (props: Record<string, unknown>) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'mock-abilities-page',
        onClick: () => (props.onGoToAgents as (() => void) | undefined)?.(),
      },
      '能力中心',
    ),
}));
vi.mock('./TeamLibrary.js', () => ({ TeamLibrary: () => null }));
vi.mock('./NewConversationDialog.js', () => ({
  NewConversationDialog: (props: Record<string, unknown>) => {
    newConversationDialogProps.current = props;
    return createElement('div', { 'data-testid': 'mock-new-conversation-dialog' });
  },
}));
vi.mock('./ModelSettings.js', () => ({
  ModelSettings: forwardRef(function MockModelSettings(
    { onDirtyChange }: { onDirtyChange?(dirty: boolean): void },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      complete: () => completeMock(),
    }));
    return createElement(
      'button',
      { type: 'button', onClick: () => onDirtyChange?.(true) },
      '标记模型配置未保存',
    );
  }),
}));

import { ShellApp } from './ShellApp.js';

beforeEach(() => {
  topBarProps.current = undefined;
  chatViewProps.current = undefined;
  sidebarProps.current = undefined;
  newConversationDialogProps.current = undefined;
  runtime.connect.mockResolvedValue({ snapshot: [] });
  runtime.onEvent.mockReturnValue(vi.fn());
  runtime.onOpenConversation.mockReturnValue(vi.fn());
  runtime.notifyRendererReady.mockReset();
  runtime.sendConversationMessage.mockResolvedValue({
    threadId: 'thread-a',
    taskVersion: 0,
    conversationTitle: '首条消息',
  });
  runtime.appendMessage.mockResolvedValue({ messageId: 'message-a', taskVersion: 1 });
  runtime.renameConversation.mockResolvedValue({ conversation: { id: 'created-conversation' } });
  runtime.setConversationPinned.mockResolvedValue({ conversation: { id: 'created-conversation' } });
  runtime.setConversationArchived.mockResolvedValue({ conversation: { id: 'created-conversation' } });
  runtime.setConversationExecutionMode.mockResolvedValue({ conversation: { id: 'created-conversation' } });
  runtime.deleteConversation.mockResolvedValue({});
  runtime.createConversation.mockResolvedValue({
    conversation: {
      id: 'created-conversation',
      workspaceId: 'ws-a',
      track: 'model',
      targetRef: 'model-a',
      title: '',
      executionMode: 'full-access',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    },
  });
  runtime.listConversations.mockResolvedValue({ conversations: [] });
  runtime.listGlobalAgents.mockResolvedValue({ agents: [] });
  runtime.listTeams.mockResolvedValue({ teams: [] });
  runtime.listProviders.mockResolvedValue({ providers: [] });
  runtime.listWorkspaces.mockResolvedValue({ workspaces: [] });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  completeMock.mockReset();
  completeMock.mockResolvedValue(true);
});

function installRuntime(): void {
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime },
  });
}

function openDirtySettings(): void {
  render(<ShellApp />);
  fireEvent.click(screen.getByTestId('nav-settings'));
  fireEvent.click(screen.getByRole('button', { name: '模型' }));
  fireEvent.click(screen.getByRole('button', { name: '标记模型配置未保存' }));
  expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
}

describe('ShellApp abilities navigation', () => {
  it('renders the real ability stage instead of the placeholder', async () => {
    installRuntime();
    render(<ShellApp />);
    fireEvent.click(screen.getByTestId('nav-abilities'));
    await waitFor(() => expect(screen.getByTestId('mock-abilities-page')).toBeTruthy());
    expect(screen.queryByText('能力 · 即将推出')).toBeNull();
  });
});

describe('ShellApp settings modal', () => {
  it('keeps the modal open when model complete/test fails', async () => {
    installRuntime();
    completeMock.mockResolvedValue(false);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    openDirtySettings();

    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '关闭设置' })).toBeTruthy();
  });

  it('closes after model complete/test succeeds without discard confirm', async () => {
    installRuntime();
    completeMock.mockResolvedValue(true);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    openDirtySettings();

    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '关闭设置' })).toBeNull();
    });
  });

  it('asks once and stays open when dirty close is cancelled via the X button', () => {
    installRuntime();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    openDirtySettings();

    fireEvent.click(screen.getByRole('button', { name: '关闭设置' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      '当前有未提交的模型配置草稿，确认放弃并关闭设置吗？',
    );
    expect(screen.getByRole('button', { name: '关闭设置' })).toBeTruthy();
  });

  it('closes clean settings without confirmation', async () => {
    installRuntime();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ShellApp />);
    fireEvent.click(screen.getByTestId('nav-settings'));
    // Default section is general — complete gate is models-only.
    fireEvent.click(screen.getByRole('button', { name: '完成' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '关闭设置' })).toBeNull();
    });
  });
});

describe('ShellApp workspace context', () => {
  it('clears a selected conversation when switching workspaces', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [
        { workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' },
        { workspaceId: 'ws-b', name: 'B', folderPath: 'D:\\b' },
      ],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'conv-a',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'A 对话',
          executionMode: 'full-access',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        },
      ],
    });
    runtime.listProviders.mockResolvedValue({
      providers: [
        {
          providerId: 'provider-a',
          name: 'Provider A',
          enabled: true,
          models: [{ modelId: 'model-a', displayName: 'Model A' }],
        },
      ],
    });

    render(<ShellApp />);

    await waitFor(() => expect(screen.getByText('A 对话')).toBeTruthy());
    fireEvent.click(screen.getByText('A 对话'));
    await waitFor(() => expect(screen.getByTestId('mock-chat-view')).toBeTruthy());

    const selectWorkspace = topBarProps.current?.onSelectWorkspace as
      | ((workspaceId: string) => void)
      | undefined;
    expect(selectWorkspace).toBeTypeOf('function');
    selectWorkspace?.('ws-b');

    await waitFor(() => {
      expect(screen.queryByTestId('mock-chat-view')).toBeNull();
      // Empty state headline is now a time-of-day greeting, so assert on the
      // element rather than the copy.
      expect(screen.getByTestId('welcome-greeting')).toBeTruthy();
    });
  });

  it('opens a conversation tab on click and restores it after workspace switch', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [
        { workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' },
        { workspaceId: 'ws-b', name: 'B', folderPath: 'D:\\b' },
      ],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'conv-a',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'A 对话',
          executionMode: 'full-access',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        },
        {
          id: 'conv-b',
          workspaceId: 'ws-b',
          track: 'model',
          targetRef: 'model-a',
          title: 'B 对话',
          executionMode: 'full-access',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        },
      ],
    });

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByText('A 对话')).toBeTruthy());
    fireEvent.click(screen.getByText('A 对话'));
    await waitFor(() => expect(screen.getByTestId('conversation-tab-conv-a')).toBeTruthy());
    expect(screen.getByTestId('mock-chat-view')).toBeTruthy();

    const selectWorkspace = topBarProps.current?.onSelectWorkspace as
      | ((workspaceId: string) => void)
      | undefined;
    selectWorkspace?.('ws-b');
    await waitFor(() => expect(screen.queryByTestId('conversation-tab-conv-a')).toBeNull());

    selectWorkspace?.('ws-a');
    await waitFor(() => {
      expect(screen.getByTestId('conversation-tab-conv-a')).toBeTruthy();
      expect(screen.getByTestId('mock-chat-view')).toBeTruthy();
    });
  });

  it('closes a conversation tab without deleting the conversation', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'conv-a',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: '可关闭对话',
          executionMode: 'full-access',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        },
      ],
    });

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByText('可关闭对话')).toBeTruthy());
    fireEvent.click(screen.getByText('可关闭对话'));
    await waitFor(() => expect(screen.getByTestId('conversation-tab-conv-a')).toBeTruthy());

    fireEvent.click(screen.getByTestId('conversation-tab-close-conv-a'));
    await waitFor(() => {
      expect(screen.queryByTestId('conversation-tab-conv-a')).toBeNull();
      expect(screen.queryByTestId('mock-chat-view')).toBeNull();
      expect(screen.getByTestId('welcome-greeting')).toBeTruthy();
    });
    // Conversation remains in the sidebar list.
    expect(screen.getByText('可关闭对话')).toBeTruthy();
    expect(runtime.deleteConversation).not.toHaveBeenCalled();
  });
});

describe('ShellApp empty conversation compose', () => {
  it('creates a full-access model conversation and sends the first message', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [
        {
          workspaceId: 'ws-a',
          name: 'A',
          folderPath: 'D:\\a',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        },
      ],
    });
    runtime.listProviders.mockResolvedValue({
      providers: [
        {
          providerId: 'provider-a',
          name: 'Provider A',
          enabled: true,
          models: [{ modelId: 'model-a', displayName: 'Model A' }],
        },
      ],
    });

    render(<ShellApp />);

    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '从空态直接开始' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));

    await waitFor(() => expect(runtime.createConversation).toHaveBeenCalledTimes(1));
    expect(runtime.createConversation).toHaveBeenCalledWith({
      track: 'model',
      targetRef: 'model-a',
      workspaceId: 'ws-a',
      executionMode: 'full-access',
    });
    expect(runtime.sendConversationMessage).toHaveBeenCalledWith({
      conversationId: 'created-conversation',
      text: '从空态直接开始',
      modelId: 'model-a',
    });
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-a',
        expectedTaskVersion: 0,
        role: 'user',
        text: '从空态直接开始',
        modelId: 'model-a',
        networkEnabled: true,
      }),
    );
  });


  it('uses selected permission and reasoning for the first message', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listProviders.mockResolvedValue({
      providers: [
        {
          providerId: 'provider-a',
          name: 'Provider A',
          enabled: true,
          models: [{ modelId: 'model-a', displayName: 'Model A' }],
        },
      ],
    });

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
    fireEvent.click(screen.getByTitle('权限：完全访问'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /询问批准/ }));
    fireEvent.click(screen.getByTitle('推理强度：自动'));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '高' }));
    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '按当前参数发送' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));

    await waitFor(() => expect(runtime.createConversation).toHaveBeenCalledTimes(1));
    expect(runtime.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ executionMode: 'ask' }),
    );
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'high' }),
    );
  });

  it('clears a pending agent submission when the target picker is cancelled', async () => {
    installRuntime();
    window.localStorage.setItem('sync-think.lastConversationTrack', 'agent');
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '不要延迟发送' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());

    const close = newConversationDialogProps.current?.onClose as (() => void) | undefined;
    close?.();
    await waitFor(() => expect(screen.queryByTestId('mock-new-conversation-dialog')).toBeNull());

    // Re-open a plain picker through the agent welcome card and select a target.
    // Picking a target only prepares the draft — Runtime create waits until send.
    fireEvent.click(screen.getByTestId('welcome-track-agent'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());
    const pick = newConversationDialogProps.current?.onPick as
      | ((targetRef: string) => void)
      | undefined;
    pick?.('agent-a');

    await waitFor(() => expect(screen.queryByTestId('mock-new-conversation-dialog')).toBeNull());
    expect(runtime.createConversation).not.toHaveBeenCalled();
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('empty-compose-input')).toHaveProperty(
      'value',
      '不要延迟发送',
    );

    // First send is what materializes the conversation in Runtime / sidebar.
    fireEvent.click(screen.getByTestId('empty-compose-send'));
    await waitFor(() => expect(runtime.createConversation).toHaveBeenCalledTimes(1));
    expect(runtime.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        track: 'agent',
        targetRef: 'agent-a',
        workspaceId: 'ws-a',
      }),
    );
  });
});

describe('ShellApp duplicate conversation', () => {
  it('copies config, title and group membership but not messages', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    const sourceConversation = {
      id: 'conv-src',
      workspaceId: 'ws-a',
      track: 'model' as const,
      targetRef: 'model-a',
      title: '原标题',
      executionMode: 'ask',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    };
    runtime.listConversations.mockResolvedValue({ conversations: [sourceConversation] });
    window.localStorage.setItem(
      'sync-think.activeWorkspaceId',
      'ws-a',
    );
    window.localStorage.setItem(
      'sync-think.conversationGroups',
      JSON.stringify({
        version: 2,
        workspaces: {
          'ws-a': {
            model: [
              {
                id: 'grp-a',
                name: '分组 A',
                collapsed: false,
                conversationIds: ['conv-src'],
              },
            ],
            agent: [],
            team: [],
          },
        },
      }),
    );
    runtime.createConversation.mockResolvedValue({
      conversation: {
        id: 'conv-dup',
        workspaceId: 'ws-a',
        track: 'model',
        targetRef: 'model-a',
        title: '原标题（副本）',
        executionMode: 'ask',
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
      },
    });

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('mock-sidebar-duplicate')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-sidebar-duplicate'));

    await waitFor(() => expect(runtime.createConversation).toHaveBeenCalledTimes(1));
    expect(runtime.createConversation).toHaveBeenCalledWith({
      track: 'model',
      targetRef: 'model-a',
      workspaceId: 'ws-a',
      title: '原标题（副本）',
      executionMode: 'ask',
    });
    // Message history is intentionally not copied — only prepare/append when a
    // real first message is sent, which duplicate skips entirely.
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
    expect(runtime.appendMessage).not.toHaveBeenCalled();
    expect(runtime.renameConversation).not.toHaveBeenCalled();

    // The duplicate inherits the source's group membership.
    const stored = JSON.parse(
      window.localStorage.getItem('sync-think.conversationGroups') ?? '{}',
    );
    expect(stored.workspaces['ws-a'].model[0].conversationIds).toContain('conv-dup');
  });
});

describe('ShellApp deep links', () => {
  function captureOpenConversationListener(): (conversationId: string) => void {
    const listeners: Array<(conversationId: string) => void> = [];
    runtime.onOpenConversation.mockImplementation((listener: (id: string) => void) => {
      listeners.push(listener);
      return vi.fn();
    });
    return (id: string) => listeners.forEach((l) => l(id));
  }

  it('announces renderer readiness so main can flush cold-start links', () => {
    installRuntime();
    captureOpenConversationListener();
    render(<ShellApp />);
    expect(runtime.notifyRendererReady).toHaveBeenCalled();
  });

  it('opens a cross-workspace conversation and switches the active workspace', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [
        { workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' },
        { workspaceId: 'ws-b', name: 'B', folderPath: 'D:\\b' },
      ],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'conv-b',
          workspaceId: 'ws-b',
          track: 'model',
          targetRef: 'model-b',
          title: 'B 对话',
          executionMode: 'full-access',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        },
      ],
    });
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');

    const dispatch = captureOpenConversationListener();
    render(<ShellApp />);
    await waitFor(() => expect(runtime.listConversations).toHaveBeenCalled());

    dispatch('conv-b');

    // Active workspace switched to the conversation's workspace, and the
    // conversation is now selected on the talk stage.
    expect(window.localStorage.getItem('sync-think.activeWorkspaceId')).toBe('ws-b');
    await waitFor(() => expect(screen.getByTestId('mock-chat-view')).toBeTruthy());
    expect(chatViewProps.current?.conversation).toMatchObject({ id: 'conv-b' });
  });

  it('holds a deep link for a conversation not present yet without crashing', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockResolvedValue({ conversations: [] });

    const dispatch = captureOpenConversationListener();
    render(<ShellApp />);
    await waitFor(() => expect(runtime.listConversations).toHaveBeenCalled());

    // Link arrives for a conversation the renderer has not loaded yet.
    expect(() => dispatch('conv-missing')).not.toThrow();
    expect(screen.queryByTestId('mock-chat-view')).toBeNull();
    expect(window.localStorage.getItem('sync-think.activeWorkspaceId')).toBe('ws-a');
  });
});

