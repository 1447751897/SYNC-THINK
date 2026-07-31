import { describe, expect, it, vi } from 'vitest';
import type { ProjectTerminalEvent } from '../../workspace-tools-contract.js';
import { createTerminalSessionStore } from './terminal-session-store.js';

describe('terminal session store', () => {
  it('keeps streamed output and history while enforcing one command per terminal', async () => {
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
        return () => {
          listener = undefined;
        };
      },
    });

    await store.startCommand({
      root: 'C:/workspace',
      terminalId: 'terminal-1',
      commandLine: 'node script.js',
      cwd: '',
    });
    expect(store.getSnapshot('terminal-1').status).toBe('running');
    expect(store.getSnapshot('terminal-1').history).toEqual(['node script.js']);
    await expect(
      store.startCommand({
        root: 'C:/workspace',
        terminalId: 'terminal-1',
        commandLine: 'pnpm test',
        cwd: '',
      }),
    ).rejects.toThrow(/already running/i);

    listener?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      type: 'stdout',
      text: 'first\n',
    });
    listener?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      type: 'stdout',
      text: 'second\n',
    });
    listener?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      type: 'completed',
      exitCode: 0,
      truncated: false,
      cwd: '',
    });

    const snapshot = store.getSnapshot('terminal-1');
    expect(snapshot.status).toBe('idle');
    expect(snapshot.chunks.map((chunk) => chunk.text).join('')).toContain('first\nsecond\n');
    expect(startProjectTerminal).toHaveBeenCalledOnce();
  });

  it('updates cwd for the validated cd built-in and cancels an active command', async () => {
    const cancelProjectTerminal = vi.fn(async () => ({ cancelled: true }));
    const startProjectTerminal = vi
      .fn()
      .mockResolvedValueOnce({
        terminalId: 'terminal-1',
        commandId: 'command-cd',
        cwd: 'src',
        state: 'completed' as const,
      })
      .mockResolvedValueOnce({
        terminalId: 'terminal-1',
        commandId: 'command-running',
        cwd: 'src',
        state: 'running' as const,
      });
    const store = createTerminalSessionStore({
      startProjectTerminal,
      cancelProjectTerminal,
      subscribeProjectTerminal: () => () => undefined,
    });

    const result = await store.startCommand({
      root: 'C:/workspace',
      terminalId: 'terminal-1',
      commandLine: 'cd src',
      cwd: '',
    });
    expect(result.cwd).toBe('src');
    expect(store.getSnapshot('terminal-1').cwd).toBe('src');
    expect(store.getSnapshot('terminal-1').status).toBe('idle');

    await store.startCommand({
      root: 'C:/workspace',
      terminalId: 'terminal-1',
      commandLine: 'pnpm test',
      cwd: 'src',
    });
    await store.cancelCommand('terminal-1');
    expect(cancelProjectTerminal).toHaveBeenCalledWith({
      terminalId: 'terminal-1',
      commandId: 'command-running',
    });
    expect(store.getSnapshot('terminal-1').status).toBe('stopping');
  });

  it('cancels a command that finishes starting while its terminal tab is closing', async () => {
    let resolveStart: ((result: {
      terminalId: string;
      commandId: string;
      cwd: string;
      state: 'running';
    }) => void) | undefined;
    const start = new Promise<{
      terminalId: string;
      commandId: string;
      cwd: string;
      state: 'running';
    }>((resolve) => {
      resolveStart = resolve;
    });
    const cancelProjectTerminal = vi.fn(async () => ({ cancelled: true }));
    const store = createTerminalSessionStore({
      startProjectTerminal: vi.fn(() => start),
      cancelProjectTerminal,
      subscribeProjectTerminal: () => () => undefined,
    });

    const starting = store.startCommand({
      root: 'C:/workspace',
      terminalId: 'terminal-1',
      commandLine: 'node slow.js',
      cwd: '',
    });
    const disposing = store.disposeSession('terminal-1');
    resolveStart?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      cwd: '',
      state: 'running',
    });
    await starting;
    await disposing;

    expect(cancelProjectTerminal).toHaveBeenCalledWith({
      terminalId: 'terminal-1',
      commandId: 'command-1',
    });
  });

  it('keeps the start invoke in flight after an early terminal event', async () => {
    let listener: ((event: ProjectTerminalEvent) => void) | undefined;
    let resolveFirst: ((result: {
      terminalId: string;
      commandId: string;
      cwd: string;
      state: 'running';
    }) => void) | undefined;
    const firstReply = new Promise<{
      terminalId: string;
      commandId: string;
      cwd: string;
      state: 'running';
    }>((resolve) => {
      resolveFirst = resolve;
    });
    const startProjectTerminal = vi
      .fn()
      .mockImplementationOnce(() => firstReply)
      .mockResolvedValueOnce({
        terminalId: 'terminal-1',
        commandId: 'command-2',
        cwd: '',
        state: 'running' as const,
      });
    const store = createTerminalSessionStore({
      startProjectTerminal,
      cancelProjectTerminal: vi.fn(async () => ({ cancelled: true })),
      subscribeProjectTerminal(next) {
        listener = next;
        return () => undefined;
      },
    });

    const firstStart = store.startCommand({
      root: 'C:/workspace',
      terminalId: 'terminal-1',
      commandLine: 'node fast.js',
      cwd: '',
    });
    listener?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      type: 'completed',
      exitCode: 0,
      truncated: false,
      cwd: '',
    });
    expect(store.getSnapshot('terminal-1').status).toBe('idle');
    await expect(
      store.startCommand({
        root: 'C:/workspace',
        terminalId: 'terminal-1',
        commandLine: 'node second.js',
        cwd: '',
      }),
    ).rejects.toThrow(/already running/i);

    resolveFirst?.({
      terminalId: 'terminal-1',
      commandId: 'command-1',
      cwd: '',
      state: 'running',
    });
    await firstStart;
    await store.startCommand({
      root: 'C:/workspace',
      terminalId: 'terminal-1',
      commandLine: 'node second.js',
      cwd: '',
    });
    expect(startProjectTerminal).toHaveBeenCalledTimes(2);
  });
});
