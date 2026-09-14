import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTerminalEnv,
  createPty,
  getPtyBuffer,
  hasPty,
  killAllPtys,
  loginShellArgs,
  resolveCwd,
  resolveShell,
} from './pty-service.js';

describe('NewMax pty helpers', () => {
  it('uses powershell.exe on Windows and a login zsh/bash elsewhere', () => {
    expect(resolveShell('win32')).toBe('powershell.exe');
    expect(loginShellArgs('powershell.exe', 'win32')).toEqual([]);
    expect(loginShellArgs('/bin/zsh', 'darwin')).toEqual(['-l']);
    expect(loginShellArgs('/bin/sh', 'linux')).toEqual([]);
  });

  it('strips Claude/npm prefix vars and sets COLORFGBG from the theme', () => {
    const env = buildTerminalEnv(
      { CLAUDECODE: '1', npm_config_prefix: '/tmp', PATH: '/usr/bin', COLORFGBG: 'old' },
      'dark',
    );
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.COLORFGBG).toBe('15;0');
    expect(buildTerminalEnv({}, 'light').COLORFGBG).toBe('0;15');
  });

  it('keeps a real directory and otherwise falls back to home or the drive root', () => {
    expect(resolveCwd(process.cwd())).toBe(process.cwd());
    expect(resolveCwd('/this/path/does-not-exist-sync-think', 'win32')).toBeTruthy();
  });
});

describe('createPty', () => {
  afterEach(() => {
    killAllPtys();
  });

  it('spawns xterm-256color, buffers output, and is idempotent for the same session', () => {
    const writes: string[] = [];
    let onData: ((data: string) => void) | undefined;
    const spawn = vi.fn((_file: string, _args: string[], _options: Record<string, unknown>) => ({
      onData(listener: (data: string) => void) {
        onData = listener;
      },
      onExit() {},
      write(data: string) {
        writes.push(data);
      },
      resize: vi.fn(),
      kill: vi.fn(),
    }));

    const first = createPty(
      1,
      {
        sessionId: 'term-1',
        workspaceId: 'ws-1',
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        title: 'Terminal',
        colorScheme: 'dark',
      },
      { spawn },
    );
    const second = createPty(1, { sessionId: 'term-1' }, { spawn });
    expect(first).toEqual({ sessionId: 'term-1', created: true });
    expect(second).toEqual({ sessionId: 'term-1', created: false });
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
    });
    onData?.('hello');
    expect(getPtyBuffer(1, 'term-1')).toBe('hello');
    expect(hasPty(1, 'term-1')).toBe(true);
  });
});
