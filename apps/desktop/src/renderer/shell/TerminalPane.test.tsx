/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyTerminalBridge } from '../../terminal-pty-contract.js';
import { TerminalPane } from './TerminalPane.js';

class FakeTerminal {
  static instances: FakeTerminal[] = [];
  static lastOptions: Record<string, unknown> | undefined;
  writes: string[] = [];
  clear = vi.fn();
  reset = vi.fn();
  dispose = vi.fn();
  focus = vi.fn();
  resize = vi.fn();
  loadAddon = vi.fn();
  options: { theme?: Record<string, string> } = {};
  private dataListener?: (data: string) => void;

  constructor(options?: Record<string, unknown>) {
    FakeTerminal.lastOptions = options;
    this.options = { theme: options?.theme as Record<string, string> | undefined };
    FakeTerminal.instances.push(this);
  }

  open(): void {}

  write(text: string): void {
    this.writes.push(text);
  }

  writeln(text: string): void {
    this.writes.push(`${text}\n`);
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListener = listener;
    return { dispose: vi.fn() };
  }

  attachCustomKeyEventHandler(): void {}

  emitInput(data: string): void {
    this.dataListener?.(data);
  }
}

function installVendor() {
  Object.defineProperty(window, 'SyncThinkXterm', {
    configurable: true,
    value: { Terminal: FakeTerminal },
  });
}

function installTerminalBridge(overrides: Partial<PtyTerminalBridge> = {}): PtyTerminalBridge {
  const bridge: PtyTerminalBridge = {
    create: vi.fn(async () => ({ success: true, sessionId: 'terminal-1', created: true })),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(async () => undefined),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => []),
    getBuffer: vi.fn(async () => ''),
    onData: vi.fn(() => () => undefined),
    onExit: vi.fn(() => () => undefined),
    ...overrides,
  };
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: { runtime: { pathForFile: () => '' }, terminal: bridge },
  });
  return bridge;
}

beforeEach(() => {
  if (typeof ResizeObserver === 'undefined') {
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    });
  }
});

afterEach(() => {
  cleanup();
  FakeTerminal.instances = [];
  FakeTerminal.lastOptions = undefined;
  Reflect.deleteProperty(window, 'SyncThinkXterm');
  Reflect.deleteProperty(window, 'syncThink');
});

describe('TerminalPane', () => {
  it('creates an interactive NewMax PTY session and forwards stdin', async () => {
    installVendor();
    const bridge = installTerminalBridge();
    render(
      <TerminalPane
        terminalId="terminal-1"
        projectFolder="C:/workspace"
        cwd=""
        workspaceId="ws-1"
        title="Terminal"
      />,
    );

    await waitFor(() => expect(bridge.create).toHaveBeenCalledOnce());
    expect(FakeTerminal.lastOptions).toMatchObject({
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
    });
    expect(screen.queryByTestId('terminal-command-input')).toBeNull();
    expect(bridge.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'terminal-1',
        workspaceId: 'ws-1',
        cwd: 'C:/workspace',
        cols: 80,
        rows: 24,
      }),
    );

    FakeTerminal.instances[0]?.emitInput('ls\r');
    expect(bridge.write).toHaveBeenCalledWith('terminal-1', 'ls\r');
  });

  it('replays the PTY buffer when the session is already alive', async () => {
    installVendor();
    const bridge = installTerminalBridge({
      exists: vi.fn(async () => true),
      getBuffer: vi.fn(async () => 'cached prompt'),
    });
    render(<TerminalPane terminalId="terminal-1" cwd="/" />);
    await waitFor(() => expect(FakeTerminal.instances[0]?.writes.join('')).toContain('cached prompt'));
    expect(bridge.create).not.toHaveBeenCalled();
  });

  it('writes NewMax create-failed and process-exited lines', async () => {
    installVendor();
    let onExit: ((sessionId: string, exitCode: number) => void) | undefined;
    installTerminalBridge({
      create: vi.fn(async () => ({ success: false as const, error: 'spawn failed' })),
      onExit: (listener) => {
        onExit = listener;
        return () => undefined;
      },
    });
    render(<TerminalPane terminalId="terminal-1" cwd="/" />);
    await waitFor(() =>
      expect(FakeTerminal.instances[0]?.writes.join('')).toContain('[终端创建失败]'),
    );
    onExit?.('terminal-1', 1);
    expect(FakeTerminal.instances[0]?.writes.join('')).toContain('[进程已退出，代码 1]');
  });

  it('drops escaped file paths into the prompt', async () => {
    installVendor();
    const bridge = installTerminalBridge();
    render(<TerminalPane terminalId="terminal-1" cwd="/" />);
    await waitFor(() => expect(bridge.create).toHaveBeenCalled());
    const pane = screen.getByTestId('terminal-pane');
    fireEvent.drop(pane, {
      dataTransfer: {
        files: [],
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'newmax-file:D:/work/a.ts' : ''),
      },
    });
    expect(bridge.write).toHaveBeenCalledWith('terminal-1', 'D:/work/a.ts ');
  });
});
