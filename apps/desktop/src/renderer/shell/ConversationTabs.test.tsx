/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import { ConversationTabs, calculatePaneTabWidth } from './ConversationTabs.js';

afterEach(cleanup);

const conversations = [
  { id: 'c1', title: '对话一', track: 'model' },
  { id: 'c2', title: '对话二', track: 'agent' },
] as unknown as Conversation[];

describe('ConversationTabs NewMax tab track', () => {
  it('shares the 58-172px measured width rule across every resource tab', () => {
    expect(calculatePaneTabWidth(760, 5)).toBe(141);
    expect(calculatePaneTabWidth(2400, 5)).toBe(172);
    expect(calculatePaneTabWidth(260, 8)).toBe(58);
  });

  it('uses one common resource-tab class and width variable', () => {
    const { container } = render(
      <ConversationTabs
        conversations={conversations}
        openIds={['c1', 'c2']}
        activeId="c1"
        fileTabs={[{ id: 'file:readme', path: 'README.md' }]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onSelectFile={vi.fn()}
        onCloseFile={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    expect(screen.getByTestId('conversation-tab-c1').classList.contains('shell-pane-tab')).toBe(
      true,
    );
    expect(screen.getByTestId('file-tab-README.md').classList.contains('shell-pane-tab')).toBe(
      true,
    );
    expect(
      (
        container.querySelector('.shell-conversation-tabs__scroller') as HTMLElement
      ).style.getPropertyValue('--shell-pane-tab-width'),
    ).toBe('172px');
  });
});

describe('ConversationTabs pane actions', () => {
  it('searches, selects and closes open conversations from the fixed tab manager', async () => {
    const manyConversations = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index + 1}`,
      title: `对话${index + 1}`,
      track: 'model',
    })) as unknown as Conversation[];
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ConversationTabs
        conversations={manyConversations}
        openIds={manyConversations.map((conversation) => String(conversation.id))}
        activeId="c1"
        onSelect={onSelect}
        onClose={onClose}
        onNew={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '窗格更多操作' }));
    const menu = await screen.findByTestId('conversation-tab-manager');
    fireEvent.change(within(menu).getByRole('searchbox', { name: '搜索已打开的对话' }), {
      target: { value: '对话6' },
    });
    expect(within(menu).queryByRole('button', { name: '切换到 对话1' })).toBeNull();
    fireEvent.click(within(menu).getByRole('button', { name: '切换到 对话6' }));
    expect(onSelect).toHaveBeenCalledWith('c6');

    fireEvent.click(screen.getByRole('button', { name: '窗格更多操作' }));
    fireEvent.click(
      within(await screen.findByTestId('conversation-tab-manager')).getByRole('button', {
        name: '关闭标签 对话2',
      }),
    );
    expect(onClose).toHaveBeenCalledWith('c2');
  });

  it('flips the plus menu above the anchor when the tab strip is near the viewport bottom', async () => {
    const previousHeight = window.innerHeight;
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });

    try {
      render(
        <ConversationTabs
          paneId="pane-a"
          conversations={conversations}
          openIds={['c1']}
          activeId="c1"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onNew={vi.fn()}
        />,
      );

      const trigger = screen.getByTestId('conversation-tab-new');
      const anchor = trigger.parentElement as HTMLElement;
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        x: 40,
        y: 260,
        top: 260,
        left: 40,
        right: 120,
        bottom: 287,
        width: 80,
        height: 27,
        toJSON: () => ({}),
      });

      fireEvent.click(trigger);

      const menu = await screen.findByTestId('new-resource-menu');
      expect(menu.style.position).toBe('fixed');
      expect(menu.style.bottom).not.toBe('');
      expect(menu.style.top).toBe('auto');
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: previousHeight,
      });
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: previousWidth,
      });
    }
  });

  it('flips the split candidate picker above the tab strip near the viewport bottom', async () => {
    const previousHeight = window.innerHeight;
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });

    try {
      render(
        <ConversationTabs
          paneId="pane-a"
          conversations={[
            ...conversations,
            { id: 'c3', title: '对话三', track: 'team' } as unknown as Conversation,
          ]}
          openIds={['c1', 'c2']}
          activeId="c1"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onNew={vi.fn()}
          onOpenInSplit={vi.fn()}
        />,
      );

      const trigger = screen.getByTestId('chat-split-horizontal-pane-a');
      const anchor = trigger.parentElement as HTMLElement;
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        x: 700,
        y: 260,
        top: 260,
        left: 700,
        right: 800,
        bottom: 287,
        width: 100,
        height: 27,
        toJSON: () => ({}),
      });

      fireEvent.click(trigger);

      const picker = await screen.findByTestId('chat-split-picker-pane-a');
      expect(picker.style.position).toBe('fixed');
      expect(picker.style.bottom).not.toBe('');
      expect(picker.style.top).toBe('auto');
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: previousHeight,
      });
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: previousWidth,
      });
    }
  });

  it('opens the only candidate in a horizontal or vertical split', () => {
    const onOpenInSplit = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeId="c1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onOpenInSplit={onOpenInSplit}
      />,
    );

    fireEvent.click(screen.getByTestId('chat-split-horizontal-pane-a'));
    expect(onOpenInSplit).toHaveBeenCalledWith('c2', 'horizontal');
    fireEvent.click(screen.getByTestId('chat-split-vertical-pane-a'));
    expect(onOpenInSplit).toHaveBeenCalledWith('c2', 'vertical');
  });

  it('disables new splits at the pane limit and exposes pane close', () => {
    const onClosePane = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeId="c1"
        canSplit={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onOpenInSplit={vi.fn()}
        onClosePane={onClosePane}
      />,
    );

    expect(screen.getByTestId('chat-split-horizontal-pane-a')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByTestId('chat-close-pane-pane-a'));
    expect(onClosePane).toHaveBeenCalledOnce();
  });

  it('renders file resources in the pane strip and routes select/close separately', () => {
    const onSelectFile = vi.fn();
    const onCloseFile = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeFilePath="src/index.ts"
        fileTabs={[{ id: 'file:src/index.ts', path: 'src/index.ts', dirty: true }]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onSelectFile={onSelectFile}
        onCloseFile={onCloseFile}
        onNew={vi.fn()}
      />,
    );

    const fileTab = screen.getByTestId('file-tab-src/index.ts');
    expect(fileTab.getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('file-tab-dirty-src/index.ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开文件 src/index.ts' }));
    expect(onSelectFile).toHaveBeenCalledWith('src/index.ts');
    fireEvent.click(screen.getByRole('button', { name: '关闭文件 src/index.ts' }));
    expect(onCloseFile).toHaveBeenCalledWith('src/index.ts');
  });

  it('publishes a native drag payload so a conversation can move across panes', () => {
    const onTabDragStateChange = vi.fn();
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn((type: string, value: string) => values.set(type, value)),
      getData: vi.fn((type: string) => values.get(type) ?? ''),
    };

    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeId="c1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onTabDragStateChange={onTabDragStateChange}
      />,
    );

    const tab = screen.getByTestId('conversation-tab-c1');
    expect(tab.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(tab, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-sync-think-pane-resource',
      JSON.stringify({ type: 'conversation', id: 'c1' }),
    );
    expect(onTabDragStateChange).toHaveBeenCalledWith({ type: 'conversation', id: 'c1' });
  });

  it('renders terminal resources and exposes a pane-local terminal command', () => {
    const onSelectTerminal = vi.fn();
    const onCloseTerminal = vi.fn();
    const onNewTerminal = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        terminalTabs={[{ id: 'terminal:t1', terminalId: 't1', cwd: 'src' }]}
        activeTerminalId="t1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onSelectTerminal={onSelectTerminal}
        onCloseTerminal={onCloseTerminal}
        onNewTerminal={onNewTerminal}
        onNew={vi.fn()}
      />,
    );

    expect(screen.getByTestId('terminal-tab-t1').getAttribute('data-active')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '打开终端 t1' }));
    expect(onSelectTerminal).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByRole('button', { name: '关闭终端 t1' }));
    expect(onCloseTerminal).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByTestId('conversation-tab-new'));
    fireEvent.click(screen.getByTestId('new-resource-terminal'));
    expect(onNewTerminal).toHaveBeenCalledOnce();
  });

  it('renders review resources and routes select, close, and drag actions', () => {
    const onSelectReview = vi.fn();
    const onCloseReview = vi.fn();
    const onTabDragStateChange = vi.fn();
    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn((type: string, value: string) => values.set(type, value)),
      getData: vi.fn((type: string) => values.get(type) ?? ''),
    };
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        reviewTabs={[{ id: 'review:run-1', runId: 'run-1' }]}
        activeReviewRunId="run-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onSelectReview={onSelectReview}
        onCloseReview={onCloseReview}
        onTabDragStateChange={onTabDragStateChange}
      />,
    );

    const reviewTab = screen.getByTestId('review-tab-run-1');
    expect(reviewTab.getAttribute('data-active')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '打开审阅 run-1' }));
    expect(onSelectReview).toHaveBeenCalledWith('run-1');
    fireEvent.click(screen.getByRole('button', { name: '关闭审阅 run-1' }));
    expect(onCloseReview).toHaveBeenCalledWith('run-1');

    fireEvent.dragStart(reviewTab, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-sync-think-pane-resource',
      JSON.stringify({ type: 'review', id: 'run-1' }),
    );
    expect(onTabDragStateChange).toHaveBeenCalledWith({ type: 'review', id: 'run-1' });
  });

  it('keeps the plus button as a resource menu without splitting automatically', () => {
    const onNew = vi.fn();
    const onNewTerminal = vi.fn();
    const onNewBrowser = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeId="c1"
        canOpenTerminal
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={onNew}
        onNewTerminal={onNewTerminal}
        onNewBrowser={onNewBrowser}
      />,
    );

    fireEvent.click(screen.getByTestId('conversation-tab-new'));
    expect(screen.getByTestId('new-resource-menu')).toBeTruthy();
    expect(screen.getByTestId('new-resource-conversation')).toBeTruthy();
    expect(screen.getByTestId('new-resource-terminal')).toBeTruthy();
    expect(screen.getByTestId('new-resource-browser')).toBeTruthy();

    fireEvent.click(screen.getByTestId('new-resource-browser'));
    expect(onNewBrowser).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('new-resource-menu')).toBeNull();
    expect(screen.queryByTestId('chat-split-picker-pane-a')).toBeNull();
    expect(onNew).not.toHaveBeenCalled();
    expect(onNewTerminal).not.toHaveBeenCalled();
  });

  it('keeps workspace files on the right-side pane action and out of the plus menu', () => {
    const onToggleWorkspaceFilesPane = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeId="c1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onToggleWorkspaceFilesPane={onToggleWorkspaceFilesPane}
      />,
    );

    expect(screen.getByTestId('workspace-files-toggle-pane-a')).toBeTruthy();
    expect(screen.queryByTestId('chat-toggle-rail')).toBeNull();

    fireEvent.click(screen.getByTestId('conversation-tab-new'));
    expect(screen.queryByRole('menuitem', { name: /工作区文件/ })).toBeNull();

    fireEvent.click(screen.getByTestId('workspace-files-toggle-pane-a'));
    expect(onToggleWorkspaceFilesPane).toHaveBeenCalledOnce();
  });

  it('renders and toggles the workspace files resource separately from the pane split', () => {
    const onSelectWorkspaceFiles = vi.fn();
    const onCloseWorkspaceFiles = vi.fn();
    const onToggleWorkspaceFilesPane = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeId="c1"
        workspaceFilesTab
        workspaceFilesPaneOpen
        workspaceFilesActive
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onSelectWorkspaceFiles={onSelectWorkspaceFiles}
        onCloseWorkspaceFiles={onCloseWorkspaceFiles}
        onToggleWorkspaceFilesPane={onToggleWorkspaceFilesPane}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开工作区文件' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭工作区文件' }));
    fireEvent.click(screen.getByTestId('workspace-files-toggle-pane-a'));
    expect(onSelectWorkspaceFiles).toHaveBeenCalledOnce();
    expect(onCloseWorkspaceFiles).toHaveBeenCalledOnce();
    expect(onToggleWorkspaceFilesPane).toHaveBeenCalledOnce();
  });

  it('shows the workspace files split button before the resource is opened', () => {
    const onToggleWorkspaceFilesPane = vi.fn();
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1']}
        activeId="c1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
        onToggleWorkspaceFilesPane={onToggleWorkspaceFilesPane}
      />,
    );

    const toggle = screen.getByTestId('workspace-files-toggle-pane-a');
    expect(toggle.getAttribute('aria-label')).toBe('打开工作区文件');
    fireEvent.click(toggle);
    expect(onToggleWorkspaceFilesPane).toHaveBeenCalledOnce();
  });
});

describe('ConversationTabs activity markers', () => {
  it('shows a running marker on the left of the running conversation tab', () => {
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1', 'c2']}
        activeId="c1"
        conversationActivity={
          new Map([
            ['c1', { running: true, unread: false }],
            ['c2', { running: false, unread: false }],
          ])
        }
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    const tab = screen.getByTestId('conversation-tab-c1');
    const dot = screen.getByTestId('conversation-running-c1');
    expect(tab.querySelector('.shell-activity-dot--running')).toBeTruthy();
    // The marker sits before the track icon inside the tab (left side).
    expect(tab.compareDocumentPosition(dot)).toBeGreaterThan(0);
    expect(tab.firstElementChild?.getAttribute('data-testid')).toContain('conversation-running');
  });

  it('shows a static unread marker when finished but unseen (running wins)', () => {
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1', 'c2']}
        activeId="c1"
        conversationActivity={
          new Map([
            ['c1', { running: false, unread: true }],
            ['c2', { running: true, unread: true }],
          ])
        }
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    // c1: finished-but-unread → static unread dot.
    const unreadDot = screen.getByTestId('conversation-unread-c1');
    expect(unreadDot.className).toContain('shell-activity-dot--unread');
    // c2: running takes precedence over unread.
    expect(screen.getByTestId('conversation-running-c2')).toBeTruthy();
    expect(screen.queryByTestId('conversation-unread-c2')).toBeNull();
  });

  it('renders no marker for idle read conversations', () => {
    render(
      <ConversationTabs
        paneId="pane-a"
        conversations={conversations}
        openIds={['c1', 'c2']}
        activeId="c1"
        conversationActivity={
          new Map([
            ['c1', { running: false, unread: false }],
            ['c2', { running: false, unread: false }],
          ])
        }
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onNew={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('conversation-running-c1')).toBeNull();
    expect(screen.queryByTestId('conversation-unread-c1')).toBeNull();
    expect(screen.queryByTestId('conversation-running-c2')).toBeNull();
    expect(screen.queryByTestId('conversation-unread-c2')).toBeNull();
  });
});
