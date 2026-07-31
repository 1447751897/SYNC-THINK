/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectTerminalEvent } from '../../workspace-tools-contract.js';
import { TerminalPane } from './TerminalPane.js';
import { createTerminalSessionStore } from './terminal-session-store.js';

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  writes: string[] = [];
  clear = vi.fn();
  reset = vi.fn();
  dispose = vi.fn();
  focus = vi.fn();
  resize = vi.fn();
  options: { theme?: Record<string, string> } = {};

  constructor(options?: Record<string, unknown>) {
    this.options = { theme: options?.theme as Record<string, string> | undefined };
    FakeTerminal.instances.push(this);
  }

  open(): void {}

  write(text: string): void {
    this.writes.push(text);
  }
}

function installVendor() {
  Object.defineProperty(window, 'SyncThinkXterm', {
    configurable: true,
    value: { Terminal: FakeTerminal },
  });
}

afterEach(() => {
  cleanup();
  FakeTerminal.instances = [];
  Reflect.deleteProperty(window, 'SyncThinkXterm');
});

describe('TerminalPane', () => {
  it('runs a command, renders streaming output, clears, and recalls history', async () => {
    installVendor();
    let listener: ((event: ProjectTerminalEvent) => void) | undefined;
    const startProjectTerminal = vi.fn(async () => ({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      cwd: '',
      state: 'running' as const,
    }));
    const store = createTerminalSessionStore({
      startProjectTerminal,
      cancelProjectTerminal: vi.fn(async () => ({ cancelled: true })),
      subscribeProjectTerminal(next) {
        listener = next;
        return () => undefined;
      },
    });

    render(
      <TerminalPane
        terminalId="terminal-1"
        projectFolder="C:/workspace"
        cwd=""
        store={store}
      />,
    );

    const input = screen.getByTestId('terminal-command-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'node script.js' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(startProjectTerminal).toHaveBeenCalledOnce());

    listener?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      type: 'stdout',
      text: 'streamed output\n',
    });
    listener?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      type: 'completed',
      exitCode: 0,
      truncated: false,
      cwd: '',
    });
    await waitFor(() =>
      expect(FakeTerminal.instances[0]?.writes.join('')).toContain('streamed output\n'),
    );

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('node script.js');
    fireEvent.click(screen.getByRole('button', { name: '清空终端' }));
    await waitFor(() => expect(FakeTerminal.instances[0]?.reset).toHaveBeenCalled());
  });

  it('stops the active command with the exact command identity', async () => {
    installVendor();
    const cancelProjectTerminal = vi.fn(async () => ({ cancelled: true }));
    const store = createTerminalSessionStore({
      startProjectTerminal: vi.fn(async () => ({
        terminalId: 'terminal-1',
        commandId: 'command-1',
        cwd: 'src',
        state: 'running' as const,
      })),
      cancelProjectTerminal,
      subscribeProjectTerminal: () => () => undefined,
    });

    render(
      <TerminalPane
        terminalId="terminal-1"
        projectFolder="C:/workspace"
        cwd="src"
        store={store}
      />,
    );
    fireEvent.change(screen.getByTestId('terminal-command-input'), {
      target: { value: 'pnpm test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '运行命令' }));
    await screen.findByRole('button', { name: '停止命令' });
    fireEvent.click(screen.getByRole('button', { name: '停止命令' }));

    await waitFor(() =>
      expect(cancelProjectTerminal).toHaveBeenCalledWith({
        terminalId: 'terminal-1',
        commandId: 'command-1',
      }),
    );
  });

  it('does not erase a newly typed command when an older start reply arrives', async () => {
    installVendor();
    let resolveStart: ((result: {
      terminalId: string;
      commandId: string;
      cwd: string;
      state: 'running';
    }) => void) | undefined;
    const startReply = new Promise<{
      terminalId: string;
      commandId: string;
      cwd: string;
      state: 'running';
    }>((resolve) => {
      resolveStart = resolve;
    });
    const store = createTerminalSessionStore({
      startProjectTerminal: vi.fn(() => startReply),
      cancelProjectTerminal: vi.fn(async () => ({ cancelled: true })),
      subscribeProjectTerminal: () => () => undefined,
    });

    render(
      <TerminalPane
        terminalId="terminal-1"
        projectFolder="C:/workspace"
        cwd=""
        store={store}
      />,
    );
    const input = screen.getByTestId('terminal-command-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'node first.js' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'node next.js' } });
    resolveStart?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      cwd: '',
      state: 'running',
    });

    await waitFor(() => expect(input.value).toBe('node next.js'));
  });

  it('synchronizes the xterm palette when the shell theme changes', async () => {
    installVendor();
    const store = createTerminalSessionStore({
      startProjectTerminal: vi.fn(),
      cancelProjectTerminal: vi.fn(),
      subscribeProjectTerminal: () => () => undefined,
    });
    render(
      <TerminalPane
        terminalId="terminal-theme"
        projectFolder="C:/workspace"
        cwd=""
        store={store}
      />,
    );
    await waitFor(() => expect(FakeTerminal.instances).toHaveLength(1));
    const output = screen.getByTestId('terminal-output');
    output.style.setProperty('--color-page', '#101010');
    output.style.setProperty('--color-text', '#f0f0f0');
    window.dispatchEvent(new CustomEvent('shell-theme-applied'));

    expect(FakeTerminal.instances[0]?.options.theme).toMatchObject({
      background: '#101010',
      foreground: '#f0f0f0',
    });
  });
});
