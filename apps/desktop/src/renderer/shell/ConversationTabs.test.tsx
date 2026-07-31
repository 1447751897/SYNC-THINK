/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import { ConversationTabs } from './ConversationTabs.js';

afterEach(cleanup);

const conversations = [
  { id: 'c1', title: '对话一', track: 'model' },
  { id: 'c2', title: '对话二', track: 'agent' },
] as unknown as Conversation[];

describe('ConversationTabs pane actions', () => {
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
    fireEvent.click(screen.getByTestId('pane-new-terminal-pane-a'));
    expect(onNewTerminal).toHaveBeenCalledOnce();
  });
});
