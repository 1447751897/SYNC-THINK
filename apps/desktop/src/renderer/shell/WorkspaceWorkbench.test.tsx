/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { WorkspaceWorkbench } from './WorkspaceWorkbench.js';
import {
  browserWorkbenchTab,
  conversationWorkbenchTab,
  createWorkspaceWorkbenchLayout,
  fileWorkbenchTab,
  openWorkbenchTab,
  terminalWorkbenchTab,
  WORKBENCH_BOTTOM_DEFAULT_HEIGHT,
  WORKBENCH_RIGHT_PREVIEW_WIDTH,
  workspaceFilesWorkbenchTab,
} from './workspace-workbench.js';

class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const nativePointerEvent = window.PointerEvent;

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: PointerEventPolyfill,
  });
});

afterAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: nativePointerEvent,
  });
});

afterEach(() => {
  cleanup();
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

describe('WorkspaceWorkbench', () => {
  function rightScope() {
    const files = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'right',
      workspaceFilesWorkbenchTab(),
    );
    return openWorkbenchTab(files, 'right', fileWorkbenchTab('src/app.ts')).right;
  }

  it('renders shared resource tabs and activates or closes them', () => {
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={(tab) => <div>{tab.id}</div>}
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: '工作区文件' })).toBeTruthy();
    expect(document.querySelector('[data-workspace-empty-file-tab="true"]')).toBeTruthy();
    expect(document.querySelector('[data-pane-shell="true"]')).toBeTruthy();
    expect(document.querySelector('[data-pane-content-area="true"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '工作区文件' }));
    expect(onActivateTab).toHaveBeenCalledWith('workspace-files');
    fireEvent.click(screen.getByRole('tab', { name: /app.ts/ }));
    expect(onActivateTab).toHaveBeenCalledWith('file:src/app.ts');
    fireEvent.click(screen.getByRole('button', { name: '关闭 app.ts' }));
    expect(onCloseTab).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/app.ts' }));
    expect(screen.getByText('file:src/app.ts')).toBeTruthy();
  });

  it('renders the liquid tab surface for the active workbench tab', () => {
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={(tab) => <div>{tab.id}</div>}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    // The surface rail is painted behind the tab row and stays decorative.
    const surface = document.querySelector('.shell-workbench__tab-surface');
    expect(surface).toBeTruthy();
    expect(surface?.getAttribute('aria-hidden')).toBe('true');
    expect(surface?.querySelector('path')).toBeTruthy();

    // The hook locates the notch by this exact selector.
    const active = document.querySelector('.shell-workbench-tab.is-active');
    expect(active).toBeTruthy();
    expect(active?.getAttribute('aria-selected')).toBe('true');

    // The rail/panel rule is still mounted (hidden by CSS, not removed) so the
    // existing pane-tab-divider contract keeps holding.
    expect(document.querySelector('[data-pane-tab-divider="true"]')).toBeTruthy();
  });

  it('docks workspace files beside the active resource from the workbench header', () => {
    const onToggleFileBrowser = vi.fn();
    const scope = { ...rightScope(), fileBrowserOpen: true };
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={scope}
        renderContent={(tab) => <div>{tab.id}</div>}
        renderFileBrowser={() => <div>工作区文件树</div>}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onToggleFileBrowser={onToggleFileBrowser}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('tab', { name: '工作区文件' })).toBeNull();
    expect(screen.getByRole('tab', { name: /app.ts/ })).toBeTruthy();
    const toggle = screen.getByTestId('workspace-files-workbench-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-testid="workspace-workbench-file-browser"]')?.getAttribute('data-open')).toBe(
      'true',
    );
    expect(screen.getByText('工作区文件树')).toBeTruthy();
    expect(screen.getByText('file:src/app.ts')).toBeTruthy();
    fireEvent.click(toggle);
    expect(onToggleFileBrowser).toHaveBeenCalledOnce();
  });

  it('offers the NewMax-style add menu', () => {
    const onNewResource = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={onNewResource}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: '添加右侧工作台标签' });
    expect(trigger.closest('.shell-workbench__tabs')).toBeNull();
    expect(trigger.closest('.shell-workbench__tab-cluster')).not.toBeNull();
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu.classList.contains('shell-workbench-menu--end')).toBe(false);
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());
    expect(items[0]).toBe('工作区文件');
    expect(items[1]).toBe('新建对话');
    fireEvent.click(screen.getByRole('menuitem', { name: /新建终端/ }));
    expect(onNewResource).toHaveBeenCalledWith('terminal');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps 新建终端 enabled without a bound project folder', () => {
    const onNewResource = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="bottom"
        scope={createWorkspaceWorkbenchLayout().bottom}
        canOpenTerminal={false}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={onNewResource}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加底部工作台标签' }));
    const terminal = screen.getByRole('menuitem', { name: /新建终端/ });
    expect(terminal.hasAttribute('disabled')).toBe(false);
    fireEvent.click(terminal);
    expect(onNewResource).toHaveBeenCalledWith('terminal');
  });

  it('creates a conversation from the right-side add menu', () => {
    const onNewResource = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={onNewResource}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('workbench-tab-new'));
    fireEvent.click(screen.getByRole('menuitem', { name: /新建对话/ }));
    expect(onNewResource).toHaveBeenCalledWith('conversation');
  });

  it('renders a conversation tab in the workbench strip', () => {
    const scope = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'right',
      conversationWorkbenchTab('draft:ws-a:1'),
    ).right;
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={scope}
        conversationTabMeta={{ 'draft:ws-a:1': { title: '新对话', track: 'model' } }}
        renderContent={(tab) => <div data-testid={`content-${tab.id}`}>{tab.id}</div>}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: /新对话/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '工作区文件' })).toBeTruthy();
    expect(screen.getByTestId('content-conversation:draft:ws-a:1')).toBeTruthy();
  });

  it('keeps the labeled workspace-files tab when a conversation is active and the tree is open', () => {
    const opened = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'right',
      conversationWorkbenchTab('draft:ws-a:1'),
    );
    const scope = { ...opened.right, fileBrowserOpen: true };
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={scope}
        conversationTabMeta={{ 'draft:ws-a:1': { title: '新对话', track: 'model' } }}
        renderContent={(tab) => <div>{tab.id}</div>}
        renderFileBrowser={() => <div>工作区文件树</div>}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onToggleFileBrowser={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: '工作区文件' })).toBeTruthy();
    expect(document.querySelector('[data-workspace-empty-file-tab="true"]')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /新对话/ })).toBeTruthy();
    expect(screen.getByText('工作区文件树')).toBeTruthy();
  });

  it('hides the add button until the workbench chrome is focused', () => {
    const onChromeFocus = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        focused={false}
        scope={rightScope()}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onChromeFocus={onChromeFocus}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('workbench-tab-new');
    expect(trigger.closest('.shell-tab-add--hidden')).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole('tablist'));
    expect(onChromeFocus).toHaveBeenCalled();
  });

  it('offers workspace files only from the right-side workbench', () => {
    const bottomScope = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'bottom',
      terminalWorkbenchTab('terminal-1'),
    ).bottom;
    render(
      <WorkspaceWorkbench
        placement="bottom"
        scope={bottomScope}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加底部工作台标签' }));
    expect(screen.queryByRole('menuitem', { name: '工作区文件' })).toBeNull();
  });

  it('keeps a controlled resize active across preview rerenders', () => {
    const changes: Array<{ size: number; commit: boolean }> = [];

    function ControlledWorkbench() {
      const [scope, setScope] = useState(rightScope);
      return (
        <WorkspaceWorkbench
          placement="right"
          scope={scope}
          renderContent={() => null}
          onActivateTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewResource={vi.fn()}
          onClose={vi.fn()}
          onSizeChange={(size, commit) => {
            changes.push({ size, commit });
            setScope((current) => ({ ...current, size }));
          }}
        />
      );
    }

    render(<ControlledWorkbench />);
    const separator = screen.getByRole('separator', { name: '调整右侧工作台宽度' });
    fireEvent.pointerDown(separator, { pointerId: 7, clientX: 1_200 });
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 1_100 });
    fireEvent.pointerMove(separator, { pointerId: 7, clientX: 1_050 });
    fireEvent.pointerUp(separator, { pointerId: 7, clientX: 1_050 });

    expect(changes).toContainEqual({
      size: WORKBENCH_RIGHT_PREVIEW_WIDTH + 150,
      commit: false,
    });
    expect(changes.at(-1)).toEqual({
      size: WORKBENCH_RIGHT_PREVIEW_WIDTH + 150,
      commit: true,
    });
  });

  it('supports keyboard navigation and dismissal in the add menu', () => {
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: '添加右侧工作台标签' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem').filter((item) => !item.hasAttribute('disabled'));
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('resizes from its outer edge with pointer and keyboard controls', () => {
    const onSizeChange = vi.fn();
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={rightScope()}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={onSizeChange}
      />,
    );

    const separator = screen.getByRole('separator', { name: '调整右侧工作台宽度' });
    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 1_200 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 1_100 });
    expect(onSizeChange).toHaveBeenCalledWith(WORKBENCH_RIGHT_PREVIEW_WIDTH + 100, false);
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(onSizeChange).toHaveBeenLastCalledWith(WORKBENCH_RIGHT_PREVIEW_WIDTH + 100, true);

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onSizeChange).toHaveBeenLastCalledWith(WORKBENCH_RIGHT_PREVIEW_WIDTH - 16, true);
  });

  it('keeps a controlled bottom resize active across preview rerenders', () => {
    const changes: Array<{ size: number; commit: boolean }> = [];

    function ControlledBottomWorkbench() {
      const [scope, setScope] = useState(
        () =>
          openWorkbenchTab(
            createWorkspaceWorkbenchLayout(),
            'bottom',
            terminalWorkbenchTab('terminal-1'),
          ).bottom,
      );
      return (
        <WorkspaceWorkbench
          placement="bottom"
          scope={scope}
          renderContent={() => null}
          onActivateTab={vi.fn()}
          onCloseTab={vi.fn()}
          onNewResource={vi.fn()}
          onClose={vi.fn()}
          onSizeChange={(size, commit) => {
            changes.push({ size, commit });
            setScope((current) => ({ ...current, size }));
          }}
        />
      );
    }

    render(<ControlledBottomWorkbench />);
    const separator = screen.getByRole('separator', { name: '调整底部工作台高度' });
    fireEvent.pointerDown(separator, { pointerId: 8, clientY: 800 });
    fireEvent.pointerMove(separator, { pointerId: 8, clientY: 700 });
    fireEvent.pointerMove(separator, { pointerId: 8, clientY: 650 });
    fireEvent.pointerUp(separator, { pointerId: 8, clientY: 650 });

    expect(changes).toContainEqual({
      size: WORKBENCH_BOTTOM_DEFAULT_HEIGHT + 150,
      commit: false,
    });
    expect(changes.at(-1)).toEqual({
      size: WORKBENCH_BOTTOM_DEFAULT_HEIGHT + 150,
      commit: true,
    });
  });

  it('starts collapsed then reveals the right workbench so the width can animate', async () => {
    const scope = rightScope();
    const { rerender } = render(
      <WorkspaceWorkbench
        placement="right"
        open={false}
        scope={scope}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    const panel = document.querySelector('[data-workspace-file-inspector="true"]');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('data-workspace-panel-open')).toBe('false');
    expect((panel as HTMLElement).style.width).toBe('0px');
    expect((panel as HTMLElement).style.flexBasis).toBe('0px');

    rerender(
      <WorkspaceWorkbench
        placement="right"
        open
        scope={scope}
        renderContent={() => null}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(panel?.getAttribute('data-workspace-panel-open')).toBe('true');
      expect((panel as HTMLElement).style.width).toBe(`${scope.size}px`);
    });
  });

  it('shows the live site favicon on a browser workbench tab', () => {
    const scope = openWorkbenchTab(
      createWorkspaceWorkbenchLayout(),
      'right',
      browserWorkbenchTab('b1', 'https://yucoder.cn/index'),
    ).right;
    render(
      <WorkspaceWorkbench
        placement="right"
        scope={scope}
        browserPageMeta={{
          b1: { title: '摸鱼岛', favicon: 'https://yucoder.cn/favicon.ico' },
        }}
        renderContent={(tab) => <div data-testid={`content-${tab.id}`}>{tab.id}</div>}
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onNewResource={vi.fn()}
        onClose={vi.fn()}
        onSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('workbench-tab-favicon-b1').getAttribute('src')).toBe(
      'https://yucoder.cn/favicon.ico',
    );
    expect(screen.getByRole('tab', { name: /摸鱼岛/ })).toBeTruthy();
  });

  it('keeps a browser guest mounted after switching to a document tab', () => {
    const opened = openWorkbenchTab(
      openWorkbenchTab(createWorkspaceWorkbenchLayout(), 'right', fileWorkbenchTab('README.md')),
      'right',
      browserWorkbenchTab('b1', 'https://yucoder.cn/index'),
    );

    function Harness() {
      const [scope, setScope] = useState(opened.right);
      return (
        <WorkspaceWorkbench
          placement="right"
          scope={scope}
          renderContent={(tab) => <div data-testid={`content-${tab.id}`}>{tab.id}</div>}
          onActivateTab={(tabId) => setScope((current) => ({ ...current, activeTabId: tabId }))}
          onCloseTab={vi.fn()}
          onNewResource={vi.fn()}
          onClose={vi.fn()}
          onSizeChange={vi.fn()}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByTestId('workbench-surface-browser-b1').getAttribute('data-active')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: /README\.md/ }));
    expect(screen.getByTestId('workbench-surface-browser-b1').getAttribute('data-active')).toBe(
      'false',
    );
    expect(screen.getByTestId('content-browser:b1')).toBeTruthy();
    expect(screen.getByTestId('content-file:README.md')).toBeTruthy();
  });
});
