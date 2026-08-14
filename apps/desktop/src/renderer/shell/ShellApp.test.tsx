/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, forwardRef, useImperativeHandle } from 'react';
import type { Event, GlobalAgent, Team } from '@sync-think/shared';

const runtime = {
  connect: vi.fn().mockResolvedValue({ snapshot: [] }),
  onEvent: vi.fn((_listener: (event: Event) => void) => vi.fn()),
  onOpenConversation: vi.fn((_listener: (conversationId: string) => void) => vi.fn()),
  notifyRendererReady: vi.fn(),
  sendConversationMessage: vi.fn().mockResolvedValue({
    threadId: 'thread-a',
    taskVersion: 0,
    conversationTitle: '首条消息',
  }),
  appendMessage: vi.fn().mockResolvedValue({ messageId: 'message-a', taskVersion: 1 }),
  listSkills: vi.fn().mockResolvedValue({ skills: [] }),
  getSkill: vi.fn(),
  renameConversation: vi.fn().mockResolvedValue({ conversation: { id: 'created-conversation' } }),
  setConversationPinned: vi
    .fn()
    .mockResolvedValue({ conversation: { id: 'created-conversation' } }),
  setConversationArchived: vi
    .fn()
    .mockResolvedValue({ conversation: { id: 'created-conversation' } }),
  setConversationExecutionMode: vi
    .fn()
    .mockResolvedValue({ conversation: { id: 'created-conversation' } }),
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
  readProjectFile: vi.fn().mockResolvedValue({
    path: 'notes.txt',
    content: 'before',
    error: null,
    errorCode: null,
    mtimeMs: 10,
    size: 6,
  }),
  writeProjectFile: vi.fn(),
  watchProjectFile: vi.fn(() => ({
    ready: Promise.resolve({ subscriptionId: 'shell-file-watch' }),
    unsubscribe: vi.fn(async () => undefined),
  })),
};

const topBarProps: { current?: Record<string, unknown> } = {};
const chatViewProps: { current?: Record<string, unknown> } = {};
const terminalPaneProps: { current?: Record<string, unknown> } = {};
const sidebarProps: { current?: Record<string, unknown> } = {};
const newConversationDialogProps: { current?: Record<string, unknown> } = {};

const completeMock = vi.fn(async () => true);

function clickNewConversationResource(button?: HTMLElement): void {
  fireEvent.click(button ?? screen.getByTestId('conversation-tab-new'));
  fireEvent.click(screen.getByTestId('new-resource-conversation'));
}

vi.mock('../runtime-connection.js', () => ({
  startRuntimeConnection: ({
    onConnected,
  }: {
    onConnected(result: { snapshot: unknown[] }): void;
  }) => {
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
          onClick: () => (props.onSelectWorkspace as ((id: string) => void) | undefined)?.('ws-b'),
        },
        '切换工作区',
      ),
    );
  },
}));
vi.mock('./ChatView.js', () => ({
  ChatView: (props: Record<string, unknown>) => {
    chatViewProps.current = props;
    return createElement('div', {
      'data-testid': 'mock-chat-view',
      'data-conversation-id': (props.conversation as { id?: string } | undefined)?.id,
    });
  },
}));
vi.mock('./TerminalPane.js', () => ({
  TerminalPane: (props: Record<string, unknown>) => {
    terminalPaneProps.current = props;
    return createElement('div', { 'data-testid': 'mock-terminal-pane' });
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
        onClick: () =>
          (props.onSelectStage as ((stage: string) => void) | undefined)?.('abilities'),
      }),
      ...conversations.map((c) =>
        createElement(
          'button',
          {
            key: c.id,
            type: 'button',
            onClick: () => (props.onOpenConversation as ((id: string) => void) | undefined)?.(c.id),
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

import { EmptyTalk, ShellApp } from './ShellApp.js';
import {
  createWorkspacePaneLayout,
  focusPane,
  openFileInPane,
  paneConversationIds,
  splitPaneWithConversation,
} from './pane-layout.js';
import { clearFilePaneSession } from './FilePane.js';

beforeEach(() => {
  topBarProps.current = undefined;
  chatViewProps.current = undefined;
  terminalPaneProps.current = undefined;
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
  runtime.listSkills.mockReset().mockResolvedValue({ skills: [] });
  runtime.getSkill.mockReset();
  runtime.renameConversation.mockResolvedValue({ conversation: { id: 'created-conversation' } });
  runtime.setConversationPinned.mockResolvedValue({ conversation: { id: 'created-conversation' } });
  runtime.setConversationArchived.mockResolvedValue({
    conversation: { id: 'created-conversation' },
  });
  runtime.setConversationExecutionMode.mockResolvedValue({
    conversation: { id: 'created-conversation' },
  });
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
  runtime.readProjectFile.mockResolvedValue({
    path: 'notes.txt',
    content: 'before',
    error: null,
    errorCode: null,
    mtimeMs: 10,
    size: 6,
  });
  runtime.writeProjectFile.mockReset();
  runtime.watchProjectFile.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  completeMock.mockReset();
  completeMock.mockResolvedValue(true);
  clearFilePaneSession('D:\\a', 'notes.txt');
  clearFilePaneSession('D:\\b', 'notes.txt');
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
  it('centers and restores a dragged position without transform-based text rasterization', async () => {
    installRuntime();
    window.localStorage.setItem('sync-think-settings-pos', JSON.stringify({ dx: 18.4, dy: -9.2 }));

    render(<ShellApp />);
    fireEvent.click(screen.getByTestId('nav-settings'));

    const closeButton = screen.getByRole('button', { name: '关闭设置' });
    const positioner = closeButton.closest<HTMLElement>('.settings-modal-positioner');
    expect(positioner).toBeTruthy();
    await waitFor(() => {
      expect(positioner?.style.transform).toBe('');
      expect(positioner?.style.left).toBe('18px');
      expect(positioner?.style.right).toBe('-18px');
      expect(positioner?.style.top).toBe('-9px');
      expect(positioner?.style.bottom).toBe('9px');
    });
  });

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
    expect(confirmSpy).toHaveBeenCalledWith('当前有未提交的模型配置草稿，确认放弃并关闭设置吗？');
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
  it('keeps same-path file drafts and dirty markers isolated by workspace', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [
        { workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' },
        { workspaceId: 'ws-b', name: 'B', folderPath: 'D:\\b' },
      ],
    });
    runtime.readProjectFile.mockImplementation(async ({ root }: { root: string }) => ({
      path: 'notes.txt',
      content: root === 'D:\\a' ? 'A before' : 'B before',
      error: null,
      errorCode: null,
      mtimeMs: root === 'D:\\a' ? 10 : 20,
      size: 8,
    }));
    const layoutA = openFileInPane(createWorkspacePaneLayout('ws-a'), 'notes.txt');
    const layoutB = openFileInPane(createWorkspacePaneLayout('ws-b'), 'notes.txt');
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.workspacePaneLayouts',
      JSON.stringify({ version: 1, workspaces: { 'ws-a': layoutA, 'ws-b': layoutB } }),
    );

    render(<ShellApp />);
    const editorA = await screen.findByTestId('file-pane-editor');
    expect((editorA as HTMLTextAreaElement).value).toBe('A before');
    fireEvent.change(editorA, { target: { value: 'A draft' } });
    await waitFor(() => expect(screen.getByTestId('file-tab-dirty-notes.txt')).toBeTruthy());

    const selectWorkspace = topBarProps.current?.onSelectWorkspace as (id: string) => void;
    act(() => selectWorkspace('ws-b'));
    await waitFor(() => {
      expect((screen.getByTestId('file-pane-editor') as HTMLTextAreaElement).value).toBe(
        'B before',
      );
      expect(screen.queryByTestId('file-tab-dirty-notes.txt')).toBeNull();
    });

    act(() => selectWorkspace('ws-a'));
    await waitFor(() => {
      expect((screen.getByTestId('file-pane-editor') as HTMLTextAreaElement).value).toBe('A draft');
      expect(screen.getByTestId('file-tab-dirty-notes.txt')).toBeTruthy();
    });
  });

  it('restores each workspace pane tree and focus independently', async () => {
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
          id: 'a1',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'A1',
          executionMode: 'full-access',
        },
        {
          id: 'a2',
          workspaceId: 'ws-a',
          track: 'agent',
          targetRef: 'agent-a',
          title: 'A2',
          executionMode: 'full-access',
        },
        {
          id: 'b1',
          workspaceId: 'ws-b',
          track: 'model',
          targetRef: 'model-a',
          title: 'B1',
          executionMode: 'full-access',
        },
      ],
    });
    const baseA = createWorkspacePaneLayout('ws-a', ['a1', 'a2'], 'a1');
    const layoutA = splitPaneWithConversation(baseA, baseA.focusedPaneId, 'horizontal', 'a2');
    const layoutB = createWorkspacePaneLayout('ws-b', ['b1'], 'b1');
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.workspacePaneLayouts',
      JSON.stringify({ version: 1, workspaces: { 'ws-a': layoutA, 'ws-b': layoutB } }),
    );

    render(<ShellApp />);
    await waitFor(() => expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(2));

    const selectWorkspace = topBarProps.current?.onSelectWorkspace as (id: string) => void;
    selectWorkspace('ws-b');
    await waitFor(() => expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(1));
    selectWorkspace('ws-a');
    await waitFor(() => expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(2));
  });

  it('shows a loadable parked surface instead of a blank third conversation pane', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    const conversations = ['c1', 'c2', 'c3'].map((id) => ({
      id,
      workspaceId: 'ws-a',
      track: 'model' as const,
      targetRef: `model-${id}`,
      title: id.toUpperCase(),
      executionMode: 'full-access',
    }));
    runtime.listConversations.mockResolvedValue({ conversations });
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const split = splitPaneWithConversation(initial, initial.focusedPaneId, 'horizontal', 'c2');
    const nested = splitPaneWithConversation(split, split.focusedPaneId, 'vertical', 'c3');
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.workspacePaneLayouts',
      JSON.stringify({ version: 1, workspaces: { 'ws-a': nested } }),
    );

    render(<ShellApp />);

    await waitFor(() => expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(2));
    const parked = screen.getByTestId('parked-conversation-c2');
    expect(parked.textContent).toContain('点击加载');
    fireEvent.click(parked);
    await waitFor(() => {
      expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(2);
      expect(document.querySelector('[data-conversation-id="c2"]')).toBeTruthy();
      expect(screen.queryByTestId('parked-conversation-c2')).toBeNull();
      expect(screen.getAllByTestId(/^parked-conversation-/)).toHaveLength(1);
    });
    const stored = JSON.parse(
      window.localStorage.getItem('sync-think.workspacePaneLayouts') ?? '{}',
    );
    expect(paneConversationIds(stored.workspaces['ws-a'])).toEqual(['c1', 'c2', 'c3']);
    expect(document.querySelectorAll('.shell-workspace-pane')).toHaveLength(3);
  });

  it('moves a conversation across panes through the native drag payload and collapses the empty source pane', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'c1',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'C1',
          executionMode: 'full-access',
        },
        {
          id: 'c2',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'C2',
          executionMode: 'full-access',
        },
      ],
    });
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const split = splitPaneWithConversation(initial, initial.focusedPaneId, 'horizontal', 'c2');
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.workspacePaneLayouts',
      JSON.stringify({ version: 1, workspaces: { 'ws-a': split } }),
    );

    const payloads = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn((type: string, value: string) => payloads.set(type, value)),
      getData: vi.fn((type: string) => payloads.get(type) ?? ''),
    };

    render(<ShellApp />);
    await waitFor(() => expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(2));

    const sourceTab = screen.getByTestId('conversation-tab-c1');
    const targetTab = screen.getByTestId('conversation-tab-c2');
    const targetPane = targetTab.closest<HTMLElement>('[data-testid^="workspace-pane-"]');
    const targetDropSurface = targetPane?.firstElementChild as HTMLElement | null;
    expect(targetDropSurface).toBeTruthy();

    fireEvent.dragStart(sourceTab, { dataTransfer });
    await waitFor(() => {
      expect(dataTransfer.setData).toHaveBeenCalledWith(
        'application/x-sync-think-pane-resource',
        JSON.stringify({ type: 'conversation', id: 'c1' }),
      );
    });
    fireEvent.dragOver(targetDropSurface!, { dataTransfer });
    await waitFor(() =>
      expect(targetDropSurface?.querySelector('.shell-pane-drop-overlay')).toBeTruthy(),
    );
    fireEvent.drop(targetDropSurface!, { dataTransfer });

    await waitFor(() => expect(document.querySelectorAll('.shell-workspace-pane')).toHaveLength(1));
    expect(screen.getByTestId('conversation-tab-c1')).toBeTruthy();
    expect(screen.getByTestId('conversation-tab-c2')).toBeTruthy();
    const stored = JSON.parse(
      window.localStorage.getItem('sync-think.workspacePaneLayouts') ?? '{}',
    );
    expect(paneConversationIds(stored.workspaces['ws-a'])).toEqual(['c2', 'c1']);
  });

  it('opens a terminal in the focused pane and persists only its cwd in the layout', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'c1',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'C1',
          executionMode: 'full-access',
        },
      ],
    });
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.workspacePaneLayouts',
      JSON.stringify({
        version: 1,
        workspaces: { 'ws-a': createWorkspacePaneLayout('ws-a', ['c1'], 'c1') },
      }),
    );

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('mock-chat-view')).toBeTruthy());
    act(() => (topBarProps.current?.onOpenTerminal as (() => void) | undefined)?.());
    await waitFor(() => expect(screen.getByTestId('mock-terminal-pane')).toBeTruthy());

    let stored = JSON.parse(window.localStorage.getItem('sync-think.workspacePaneLayouts') ?? '{}');
    const terminal = Object.values(stored.workspaces['ws-a'].panes)
      .flatMap((pane) => (pane as { tabs: unknown[] }).tabs)
      .find((tab) => (tab as { type?: string }).type === 'terminal') as {
      terminalId: string;
      cwd: string;
    };
    expect(terminal.cwd).toBe('');
    expect(terminalPaneProps.current).not.toHaveProperty('output');

    act(() =>
      (terminalPaneProps.current?.onCwdChange as ((cwd: string) => void) | undefined)?.('src'),
    );
    await waitFor(() => {
      stored = JSON.parse(window.localStorage.getItem('sync-think.workspacePaneLayouts') ?? '{}');
      const updated = Object.values(stored.workspaces['ws-a'].panes)
        .flatMap((pane) => (pane as { tabs: Array<{ terminalId?: string; cwd?: string }> }).tabs)
        .find((tab) => tab.terminalId === terminal.terminalId);
      expect(updated?.cwd).toBe('src');
    });
  });

  it('writes a recursive pane snapshot when splitting an open conversation', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'c1',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'C1',
          executionMode: 'full-access',
        },
        {
          id: 'c2',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: 'C2',
          executionMode: 'full-access',
        },
      ],
    });
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.openConversationTabs',
      JSON.stringify({ 'ws-a': ['c1', 'c2'] }),
    );
    window.localStorage.setItem(
      'sync-think.selectedConversationByWorkspace',
      JSON.stringify({ 'ws-a': 'c1' }),
    );

    render(<ShellApp />);
    await waitFor(() => expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(1));
    fireEvent.click(screen.getByTitle('向右分屏'));
    await waitFor(() => expect(screen.getAllByTestId('mock-chat-view')).toHaveLength(2));

    const stored = JSON.parse(
      window.localStorage.getItem('sync-think.workspacePaneLayouts') ?? '{}',
    );
    expect(stored.workspaces['ws-a'].root).toMatchObject({
      type: 'split',
      direction: 'horizontal',
    });
  });

  it('starts a new draft from the pane whose new button was used', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockResolvedValue({
      conversations: [
        {
          id: 'model-chat',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: '模型对话',
          executionMode: 'full-access',
        },
        {
          id: 'agent-chat',
          workspaceId: 'ws-a',
          track: 'agent',
          targetRef: 'agent-b',
          title: '智能体对话',
          executionMode: 'full-access',
        },
      ],
    });
    const initial = createWorkspacePaneLayout('ws-a', ['model-chat', 'agent-chat'], 'model-chat');
    const firstPaneId = initial.focusedPaneId;
    const split = splitPaneWithConversation(initial, firstPaneId, 'horizontal', 'agent-chat');
    const layout = focusPane(split, firstPaneId);
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.workspacePaneLayouts',
      JSON.stringify({ version: 1, workspaces: { 'ws-a': layout } }),
    );

    render(<ShellApp />);
    await waitFor(() => expect(screen.getAllByTestId('conversation-tab-new')).toHaveLength(2));

    const newButtons = screen.getAllByTestId('conversation-tab-new');
    clickNewConversationResource(newButtons[1]);
    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '沿用右侧智能体' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));

    await waitFor(() => expect(runtime.createConversation).toHaveBeenCalledTimes(1));
    expect(runtime.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        track: 'agent',
        targetRef: 'agent-b',
        workspaceId: 'ws-a',
      }),
    );
  });

  it('keeps existing conversations visible while a local new-conversation row is active', async () => {
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
          title: '已有对话',
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
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.openConversationTabs',
      JSON.stringify({ 'ws-a': ['conv-a'] }),
    );
    window.localStorage.setItem(
      'sync-think.selectedConversationByWorkspace',
      JSON.stringify({ 'ws-a': 'conv-a' }),
    );

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('mock-chat-view')).toBeTruthy());
    clickNewConversationResource();

    const draft = await waitFor(() => {
      const conversations =
        (sidebarProps.current?.conversations as Array<{ id: string; title: string }>) ?? [];
      const item = conversations.find((conversation) => conversation.id.startsWith('draft:'));
      expect(item).toMatchObject({ title: '新对话' });
      return item!;
    });
    expect(screen.getAllByText('已有对话')).not.toHaveLength(0);
    expect(screen.getByTestId('conversation-tab-conv-a')).toBeTruthy();
    expect(screen.getByTestId(`conversation-tab-${draft.id}`)).toBeTruthy();
    expect(screen.getByTestId('empty-compose')).toBeTruthy();

    fireEvent.click(
      within(screen.getByTestId('conversation-tab-conv-a')).getByRole('button', {
        name: '已有对话',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('mock-chat-view')).toBeTruthy());
    expect(
      ((sidebarProps.current?.conversations as Array<{ id: string }>) ?? []).some(
        (conversation) => conversation.id === draft.id,
      ),
    ).toBe(true);

    fireEvent.click(
      within(screen.getByTestId(`conversation-tab-${draft.id}`)).getByRole('button', {
        name: '新对话',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());

    clickNewConversationResource();
    expect(
      ((sidebarProps.current?.conversations as Array<{ id: string }>) ?? []).filter(
        (conversation) => conversation.id.startsWith('draft:'),
      ),
    ).toHaveLength(1);
  });

  it('replaces the local draft tab after the first successful turn and closes drafts locally', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockImplementation(async () => ({
      conversations:
        runtime.createConversation.mock.calls.length === 0
          ? []
          : [
              {
                id: 'created-conversation',
                workspaceId: 'ws-a',
                track: 'model',
                targetRef: 'model-a',
                title: '首条消息',
                executionMode: 'full-access',
                createdAt: '2026-07-25T00:00:00.000Z',
                updatedAt: '2026-07-25T00:00:00.000Z',
              },
            ],
    }));
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
    const onNewConversation = sidebarProps.current?.onNewConversation as (() => void) | undefined;
    act(() => onNewConversation?.());
    const draft = await waitFor(() => {
      const conversations = (sidebarProps.current?.conversations as Array<{ id: string }>) ?? [];
      return conversations.find((conversation) => conversation.id.startsWith('draft:'))!;
    });

    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '把草稿转正' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));

    await waitFor(() =>
      expect(screen.getByTestId('conversation-tab-created-conversation')).toBeTruthy(),
    );
    expect(screen.queryByTestId(`conversation-tab-${draft.id}`)).toBeNull();
    expect(
      ((sidebarProps.current?.conversations as Array<{ id: string }>) ?? []).some((conversation) =>
        conversation.id.startsWith('draft:'),
      ),
    ).toBe(false);

    act(() => onNewConversation?.());
    const disposableDraft = await waitFor(() => {
      const conversations = (sidebarProps.current?.conversations as Array<{ id: string }>) ?? [];
      return conversations.find((conversation) => conversation.id.startsWith('draft:'))!;
    });
    fireEvent.click(screen.getByTestId(`conversation-tab-close-${disposableDraft.id}`));
    await waitFor(() =>
      expect(screen.queryByTestId(`conversation-tab-${disposableDraft.id}`)).toBeNull(),
    );
    expect(runtime.deleteConversation).not.toHaveBeenCalled();
  });

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
      ((workspaceId: string) => void) | undefined;
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
      ((workspaceId: string) => void) | undefined;
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

describe('ShellApp pane visibility activity', () => {
  it.each(['stage', 'draft', 'settings'] as const)(
    'does not mark active pane conversations seen while hidden by %s',
    async (mode) => {
      installRuntime();
      let onEvent: ((event: Event) => void) | undefined;
      runtime.onEvent.mockImplementation((listener: (event: Event) => void) => {
        onEvent = listener;
        return vi.fn();
      });
      runtime.listWorkspaces.mockResolvedValue({
        workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
      });
      runtime.listConversations.mockResolvedValue({
        conversations: [
          {
            id: 'conv-a',
            workspaceId: 'ws-a',
            taskId: 'task-a',
            track: 'model',
            targetRef: 'model-a',
            title: '后台任务',
            executionMode: 'full-access',
          },
        ],
      });
      window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
      window.localStorage.setItem(
        'sync-think.openConversationTabs',
        JSON.stringify({ 'ws-a': ['conv-a'] }),
      );

      render(<ShellApp />);
      await waitFor(() => expect(screen.getByTestId('mock-chat-view')).toBeTruthy());

      if (mode === 'stage') {
        fireEvent.click(screen.getByTestId('nav-abilities'));
        await waitFor(() => expect(screen.getByTestId('mock-abilities-page')).toBeTruthy());
      } else if (mode === 'draft') {
        clickNewConversationResource();
        await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
      } else {
        fireEvent.click(screen.getByTestId('nav-settings'));
        await waitFor(() => expect(screen.getByRole('button', { name: '关闭设置' })).toBeTruthy());
      }

      await act(async () => {
        onEvent?.({
          id: 'event-2' as Event['id'],
          workspaceId: 'ws-a' as Event['workspaceId'],
          taskId: 'task-a' as Event['taskId'],
          category: 'run',
          type: 'run.completed',
          sequence: 2,
          occurredAt: '2026-07-28T08:00:02.000Z',
          payload: {},
        });
      });

      expect(window.localStorage.getItem('sync-think.conversationLastSeen')).toBeNull();
    },
  );
});

describe('ShellApp empty conversation compose', () => {
  it('keeps @ keyboard focus inside the EmptyTalk pane that opened the menu', async () => {
    const props = {
      hasWorkspace: true,
      models: [],
      agents: [],
      teams: [],
      draft: '',
      selectedModelId: '',
      sending: false,
      onDraftChange: vi.fn(),
      onModelChange: vi.fn(),
      onSend: vi.fn(async () => true),
      onOpenWorkspaceMenu: vi.fn(),
      onPickTrack: vi.fn(),
    };
    render(
      <div>
        <EmptyTalk {...props} />
        <EmptyTalk {...props} />
      </div>,
    );

    const inputs = screen.getAllByTestId('empty-compose-input');
    fireEvent.change(inputs[0]!, { target: { value: '@', selectionStart: 1 } });
    fireEvent.change(inputs[1]!, { target: { value: '@', selectionStart: 1 } });
    const dialogs = await screen.findAllByRole('dialog', { name: '添加上下文和设置' });
    const secondEnable = within(dialogs[1]!).getByRole('button', { name: '开启联网搜索' });

    fireEvent.keyDown(inputs[1]!, { key: 'Tab' });

    expect(document.activeElement).toBe(secondEnable);
  });

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
        skillVersionIds: [],
      }),
    );
  });

  it('keeps Agent/Team owners across model changes and carries explicit workspace picks into ChatView', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [{ workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' }],
    });
    runtime.listConversations.mockImplementation(async () => ({
      conversations:
        runtime.createConversation.mock.calls.length === 0
          ? []
          : [
              {
                id: 'created-conversation',
                workspaceId: 'ws-a',
                track: 'agent',
                targetRef: 'agent-a',
                title: '带 Skill 开始',
                executionMode: 'full-access',
              },
            ],
    }));
    runtime.listProviders.mockResolvedValue({
      providers: [
        {
          providerId: 'provider-a',
          name: 'Provider A',
          enabled: true,
          models: [
            { modelId: 'model-a', displayName: 'Model A' },
            { modelId: 'model-b', displayName: 'Model B' },
          ],
        },
      ],
    });
    runtime.listGlobalAgents.mockResolvedValue({
      agents: [
        {
          id: 'agent-a',
          name: 'Agent A',
          avatar: 'A',
          persona: '',
          description: '',
          defaultModelId: 'model-a',
          fallbackModelIds: [],
          skillIds: ['skill-a', 'skill-b'],
          mcpServerIds: [],
          reasoningEffort: 'auto',
          archived: false,
        },
      ],
    });
    runtime.listTeams.mockResolvedValue({
      teams: [
        {
          id: 'team-a',
          name: 'Team A',
          description: '',
          memberAgentIds: ['agent-a'],
          members: [{ agentId: 'agent-a' }],
          coordinatorAgentId: 'agent-a',
          executionPolicy: 'parallel',
          archived: false,
        },
      ],
    });
    runtime.listSkills.mockResolvedValue({
      skills: [
        {
          skillVersionId: 'skill-a',
          skillId: 'family-a',
          name: 'Review',
          description: 'Review this turn',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-a',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:00.000Z',
        },
        {
          skillVersionId: 'skill-b',
          skillId: 'family-b',
          name: 'Research',
          description: 'Research this turn',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-b',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:01.000Z',
        },
      ],
    });

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
    fireEvent.click(screen.getByTestId('welcome-track-agent'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());
    await act(async () => {
      await (newConversationDialogProps.current?.onPick as (targetRef: string) => Promise<void>)(
        'agent-a',
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );
    fireEvent.click(screen.getByTitle(/切换模型/));
    const provider = await screen.findByTestId('model-provider-Provider A');
    provider.focus();
    fireEvent.keyDown(provider, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByText('Model B'));
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );
    fireEvent.click(screen.getByTestId('welcome-track-model'));
    await waitFor(() => {
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8');
      expect((screen.getByTestId('turn-skill-trigger') as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(screen.getByTestId('welcome-track-agent'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());
    await act(async () => {
      await (newConversationDialogProps.current?.onPick as (targetRef: string) => Promise<void>)(
        'agent-a',
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    fireEvent.click(await screen.findByTestId('turn-skill-option-skill-b'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');
    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '带 Skill 开始' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));

    await waitFor(() =>
      expect(runtime.appendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'model-b',
          skillVersionIds: ['skill-b'],
          text: '带 Skill 开始',
        }),
      ),
    );
    expect(runtime.sendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'created-conversation',
        modelId: 'model-b',
      }),
    );
    expect(runtime.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ track: 'agent', targetRef: 'agent-a' }),
    );
    expect(
      JSON.parse(window.localStorage.getItem('sync-think.conversationModelOverrides') ?? '{}')[
        'created-conversation'
      ],
    ).toBe('model-b');
    expect(runtime.getSkill).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('mock-chat-view')).toBeTruthy());
    expect(chatViewProps.current?.initialSkillVersionIds).toEqual(['skill-b']);
    clickNewConversationResource(await screen.findByTestId('conversation-tab-new'));
    await screen.findByTestId('empty-compose');
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );

    fireEvent.click(screen.getByTestId('welcome-track-team'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());
    await act(async () => {
      await (newConversationDialogProps.current?.onPick as (targetRef: string) => Promise<void>)(
        'team-a',
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );
    fireEvent.click(screen.getByTitle(/切换模型/));
    const teamProvider = await screen.findByTestId('model-provider-Provider A');
    teamProvider.focus();
    fireEvent.keyDown(teamProvider, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByText('Model A'));
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );
  });

  it('keeps a temporary welcome workspace Skill selection when the catalog refreshes unchanged', async () => {
    installRuntime();
    runtime.listSkills.mockResolvedValue({
      skills: [
        {
          skillVersionId: 'skill-a',
          skillId: 'family-a',
          name: 'Review',
          description: '',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-a',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:00.000Z',
        },
        {
          skillVersionId: 'skill-b',
          skillId: 'family-b',
          name: 'Research',
          description: '',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-b',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:01.000Z',
        },
      ],
    });
    const agent = {
      id: 'agent-a',
      name: 'Agent A',
      avatar: 'A',
      persona: '',
      description: '',
      defaultModelId: 'model-a',
      fallbackModelIds: [],
      skillIds: ['skill-a', 'skill-b'],
      mcpServerIds: [],
      reasoningEffort: 'auto',
      archived: false,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    } as unknown as GlobalAgent;
    const callbacks = {
      onDraftChange: vi.fn(),
      onModelChange: vi.fn(),
      onSend: vi.fn(async () => true),
      onOpenWorkspaceMenu: vi.fn(),
      onPickTrack: vi.fn(),
    };
    const { rerender } = render(
      <EmptyTalk
        hasWorkspace
        models={[]}
        agents={[agent]}
        teams={[]}
        draft=""
        selectedModelId=""
        draftTrack="agent"
        draftTargetRef="agent-a"
        sending={false}
        {...callbacks}
      />,
    );

    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8');
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    fireEvent.click(await screen.findByTestId('turn-skill-option-skill-b'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');

    rerender(
      <EmptyTalk
        hasWorkspace
        models={[]}
        agents={[{ ...agent, skillIds: [...agent.skillIds] }]}
        teams={[]}
        draft=""
        selectedModelId=""
        draftTrack="agent"
        draftTargetRef="agent-a"
        sending={false}
        {...callbacks}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8'),
    );
  });

  it('keeps a Team draft when its effective owner changes with the same Skill IDs', async () => {
    installRuntime();
    runtime.listSkills.mockResolvedValue({
      skills: [
        {
          skillVersionId: 'skill-a',
          skillId: 'family-a',
          name: 'Review',
          description: '',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-a',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:00.000Z',
        },
        {
          skillVersionId: 'skill-b',
          skillId: 'family-b',
          name: 'Research',
          description: '',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-b',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:01.000Z',
        },
      ],
    });
    const teamAgents = [
      { id: 'agent-a', name: 'Agent A', skillIds: ['skill-a', 'skill-b'] },
      { id: 'agent-b', name: 'Agent B', skillIds: ['skill-a', 'skill-b'] },
    ] as unknown as GlobalAgent[];
    const team = {
      id: 'team-a',
      coordinatorAgentId: 'agent-a',
      members: [{ agentId: 'agent-a' }, { agentId: 'agent-b' }],
    } as unknown as Team;
    const callbacks = {
      onDraftChange: vi.fn(),
      onModelChange: vi.fn(),
      onSend: vi.fn(async () => true),
      onOpenWorkspaceMenu: vi.fn(),
      onPickTrack: vi.fn(),
    };
    const { rerender } = render(
      <EmptyTalk
        hasWorkspace
        models={[]}
        agents={teamAgents}
        teams={[team]}
        draft=""
        selectedModelId=""
        draftTrack="team"
        draftTargetRef="team-a"
        sending={false}
        {...callbacks}
      />,
    );

    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8');
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    fireEvent.click(await screen.findByTestId('turn-skill-option-skill-b'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');

    rerender(
      <EmptyTalk
        hasWorkspace
        models={[]}
        agents={teamAgents}
        teams={[{ ...team, coordinatorAgentId: teamAgents[1]!.id }]}
        draft=""
        selectedModelId=""
        draftTrack="team"
        draftTargetRef="team-a"
        sending={false}
        {...callbacks}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8'),
    );
  });

  it('retains the welcome Skill selection when the first append fails', async () => {
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
    runtime.listGlobalAgents.mockResolvedValue({
      agents: [
        {
          id: 'agent-a',
          name: 'Agent A',
          defaultModelId: 'model-a',
          fallbackModelIds: [],
          skillIds: ['skill-a'],
          mcpServerIds: [],
          reasoningEffort: 'auto',
          archived: false,
        },
      ],
    });
    runtime.listSkills.mockResolvedValue({
      skills: [
        {
          skillVersionId: 'skill-a',
          skillId: 'family-a',
          name: 'Review',
          description: '',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-a',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:00.000Z',
        },
      ],
    });
    runtime.appendMessage.mockRejectedValueOnce(new Error('append failed'));

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
    fireEvent.click(screen.getByTestId('welcome-track-agent'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());
    await act(async () => {
      await (newConversationDialogProps.current?.onPick as (targetRef: string) => Promise<void>)(
        'agent-a',
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    fireEvent.click(await screen.findByTestId('turn-skill-option-skill-a'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');
    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '失败后重试' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));

    expect((await screen.findByRole('alert')).textContent).toContain('append failed');
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');
  });

  it('keeps a newer workspace Skill selection when an older first append succeeds', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [
        { workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' },
        { workspaceId: 'ws-b', name: 'B', folderPath: 'D:\\b' },
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
    runtime.listGlobalAgents.mockResolvedValue({
      agents: [
        {
          id: 'agent-a',
          name: 'Agent A',
          defaultModelId: 'model-a',
          fallbackModelIds: [],
          skillIds: ['skill-a'],
          mcpServerIds: [],
          reasoningEffort: 'auto',
          archived: false,
        },
      ],
    });
    runtime.listSkills.mockResolvedValue({
      skills: [
        {
          skillVersionId: 'skill-a',
          skillId: 'family-a',
          name: 'Review',
          description: '',
          version: '1.0.0',
          allowedTools: [],
          contentFingerprint: 'fingerprint-a',
          hasScripts: false,
          warnings: [],
          createdAt: '2026-07-29T00:00:00.000Z',
        },
      ],
    });
    let resolveAppend!: (value: { messageId: string; taskVersion: number }) => void;
    runtime.appendMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAppend = resolve;
        }),
    );

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('empty-compose')).toBeTruthy());
    fireEvent.click(screen.getByTestId('welcome-track-agent'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());
    await act(async () => {
      await (newConversationDialogProps.current?.onPick as (targetRef: string) => Promise<void>)(
        'agent-a',
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8'),
    );
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    fireEvent.click(await screen.findByTestId('turn-skill-option-skill-a'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');
    fireEvent.change(screen.getByTestId('empty-compose-input'), {
      target: { value: '工作区 A 的首条消息' },
    });
    fireEvent.click(screen.getByTestId('empty-compose-send'));
    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('mock-switch-workspace'));
    await waitFor(() => {
      expect(window.localStorage.getItem('sync-think.activeWorkspaceId')).toBe('ws-b');
      expect((screen.getByTestId('turn-skill-trigger') as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId('welcome-track-agent'));
    await waitFor(() => expect(screen.getByTestId('mock-new-conversation-dialog')).toBeTruthy());
    await act(async () => {
      await (newConversationDialogProps.current?.onPick as (targetRef: string) => Promise<void>)(
        'agent-a',
      );
    });
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('0/8');
    fireEvent.click(screen.getByTestId('turn-skill-trigger'));
    fireEvent.click(await screen.findByTestId('turn-skill-option-skill-a'));
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');

    await act(async () => {
      resolveAppend({ messageId: 'message-a', taskVersion: 1 });
    });

    await waitFor(() => expect(runtime.createConversation).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem('sync-think.activeWorkspaceId')).toBe('ws-b');
    expect(screen.getByTestId('turn-skill-trigger').textContent).toContain('1/8');
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
    fireEvent.click(screen.getByTitle('切换模型，思考强度：自动'));
    fireEvent.click(await screen.findByTestId('model-reasoning-trigger'));
    fireEvent.click(await screen.findByTestId('model-reasoning-option-high'));
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
    expect(
      JSON.parse(window.localStorage.getItem('sync-think.conversationReasoningEfforts') ?? '{}'),
    ).toEqual(expect.objectContaining({ 'created-conversation': 'high' }));
  });

  it('opens network search from @ and carries the choice into the first conversation', async () => {
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
    const input = await screen.findByTestId('empty-compose-input');
    expect(screen.getByTestId('empty-compose').closest('.shell-chat-column')).toBeTruthy();
    expect(screen.queryByTitle(/联网已开/)).toBeNull();
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    const enableNetwork = await screen.findByRole('button', { name: '开启联网搜索' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(document.activeElement).toBe(enableNetwork);
    fireEvent.keyDown(enableNetwork, { key: 'Tab', shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: '', selectionStart: 0 } });
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    fireEvent.click(await screen.findByRole('button', { name: '关闭联网搜索' }));
    fireEvent.change(input, { target: { value: '不要联网', selectionStart: 4 } });
    fireEvent.click(screen.getByTestId('empty-compose-send'));

    await waitFor(() => expect(runtime.appendMessage).toHaveBeenCalledTimes(1));
    expect(runtime.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ networkEnabled: undefined, reasoningEffort: 'auto' }),
    );
    expect(
      JSON.parse(window.localStorage.getItem('sync-think.conversationNetworkEnabled') ?? '{}'),
    ).toEqual(expect.objectContaining({ 'created-conversation': false }));
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
      ((targetRef: string) => void) | undefined;
    pick?.('agent-a');

    await waitFor(() => expect(screen.queryByTestId('mock-new-conversation-dialog')).toBeNull());
    expect(runtime.createConversation).not.toHaveBeenCalled();
    expect(runtime.sendConversationMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('empty-compose-input')).toHaveProperty('value', '不要延迟发送');

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
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
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
    const stored = JSON.parse(window.localStorage.getItem('sync-think.conversationGroups') ?? '{}');
    expect(stored.workspaces['ws-a'].model[0].conversationIds).toContain('conv-dup');
  });

  it('keeps newer pane edits and workspace selection when a delayed duplicate completes', async () => {
    installRuntime();
    runtime.listWorkspaces.mockResolvedValue({
      workspaces: [
        { workspaceId: 'ws-a', name: 'A', folderPath: 'D:\\a' },
        { workspaceId: 'ws-b', name: 'B', folderPath: 'D:\\b' },
      ],
    });
    const source = {
      id: 'conv-src',
      workspaceId: 'ws-a',
      track: 'model' as const,
      targetRef: 'model-a',
      title: '源对话',
      executionMode: 'full-access',
    };
    const sibling = {
      id: 'conv-a2',
      workspaceId: 'ws-a',
      track: 'model' as const,
      targetRef: 'model-a',
      title: 'A2',
      executionMode: 'full-access',
    };
    const conversationB = {
      id: 'conv-b1',
      workspaceId: 'ws-b',
      track: 'model' as const,
      targetRef: 'model-b',
      title: 'B1',
      executionMode: 'full-access',
    };
    const duplicateResult = {
      conversation: {
        ...source,
        id: 'conv-dup',
        title: '源对话（副本）',
      },
    };
    runtime.listConversations.mockResolvedValue({
      conversations: [source, sibling, conversationB],
    });
    let resolveCreate!: (value: typeof duplicateResult) => void;
    runtime.createConversation.mockImplementationOnce(
      () =>
        new Promise<typeof duplicateResult>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const layoutA = createWorkspacePaneLayout('ws-a', ['conv-src', 'conv-a2'], 'conv-src');
    const layoutB = createWorkspacePaneLayout('ws-b', ['conv-b1'], 'conv-b1');
    window.localStorage.setItem('sync-think.activeWorkspaceId', 'ws-a');
    window.localStorage.setItem(
      'sync-think.workspacePaneLayouts',
      JSON.stringify({ version: 1, workspaces: { 'ws-a': layoutA, 'ws-b': layoutB } }),
    );

    render(<ShellApp />);
    await waitFor(() => expect(screen.getByTestId('mock-sidebar-duplicate')).toBeTruthy());
    fireEvent.click(screen.getByTestId('mock-sidebar-duplicate'));
    await waitFor(() => expect(runtime.createConversation).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle('向右分屏'));
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem('sync-think.workspacePaneLayouts') ?? '{}',
      );
      expect(stored.workspaces['ws-a'].root.type).toBe('split');
    });
    const selectWorkspace = topBarProps.current?.onSelectWorkspace as (id: string) => void;
    act(() => selectWorkspace('ws-b'));
    runtime.listConversations.mockResolvedValue({
      conversations: [source, sibling, conversationB, duplicateResult.conversation],
    });

    await act(async () => {
      resolveCreate(duplicateResult);
    });

    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem('sync-think.workspacePaneLayouts') ?? '{}',
      );
      expect(stored.workspaces['ws-a'].root.type).toBe('split');
      expect(paneConversationIds(stored.workspaces['ws-a'])).toContain('conv-dup');
      expect(window.localStorage.getItem('sync-think.activeWorkspaceId')).toBe('ws-b');
      expect(
        (sidebarProps.current?.nav as { selectedConversationId?: string }).selectedConversationId,
      ).toBe('conv-b1');
    });
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
