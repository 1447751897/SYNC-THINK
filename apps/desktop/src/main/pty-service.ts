import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { BrowserWindow } from 'electron';

const require = createRequire(import.meta.url);
const OUTPUT_BUFFER_LIMIT = 0x186a0;

export type PtyColorScheme = 'dark' | 'light' | string;

export interface CreatePtyParams {
  sessionId?: string;
  workspaceId?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
  colorScheme?: PtyColorScheme;
}

interface PtyLike {
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

interface PtyModule {
  spawn(file: string, args: string[], options: Record<string, unknown>): PtyLike;
}

interface PtySession {
  id: string;
  workspaceId: string;
  title: string;
  ptyProcess: PtyLike;
  cwd: string;
  createdAt: string;
  lastActiveAt: string;
  outputBuffer: string;
  cols: number;
  rows: number;
}

let cachedPty: PtyModule | undefined;
let cachedLoadError: { code: string; message: string } | undefined;
const ptySessionsByWindow = new Map<number, Map<string, PtySession>>();

export function resolveShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') return 'powershell.exe';
  const candidates = [env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(
    (value): value is string => Boolean(value),
  );
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try the next login shell */
    }
  }
  return '/bin/sh';
}

export function loginShellArgs(shell: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return [];
  return /(^|\/)(zsh|bash)$/.test(shell) ? ['-l'] : [];
}

export function buildTerminalEnv(
  env: NodeJS.ProcessEnv = process.env,
  colorScheme?: PtyColorScheme,
): NodeJS.ProcessEnv {
  const next = { ...env };
  delete next.CLAUDECODE;
  delete next.npm_config_prefix;
  delete next.NPM_CONFIG_PREFIX;
  if (colorScheme === 'dark') next.COLORFGBG = '15;0';
  else if (colorScheme === 'light') next.COLORFGBG = '0;15';
  return next;
}

export function resolveCwd(
  cwd: string | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  try {
    if (cwd && statSync(cwd).isDirectory()) return cwd;
  } catch {
    /* fall through */
  }
  const home = os.homedir();
  try {
    if (statSync(home).isDirectory()) return home;
  } catch {
    /* fall through */
  }
  return platform === 'win32' ? 'C:\\' : '/';
}

function formatPtyLoadFailureMessage(input: { code: string; rawMessage: string }): string {
  const code = input.code || 'UNKNOWN';
  return `终端组件 node-pty 加载失败 (${code})：${input.rawMessage}`;
}

export function loadPty(): PtyModule {
  if (cachedPty) return cachedPty;
  if (cachedLoadError) throw new Error(cachedLoadError.message);
  try {
    cachedPty = require('node-pty') as PtyModule;
    return cachedPty;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = formatPtyLoadFailureMessage({ code, rawMessage });
    cachedLoadError = { code: code || 'UNKNOWN', message };
    throw new Error(message);
  }
}

function getOrCreateWindowSessions(windowId: number): Map<string, PtySession> {
  let sessions = ptySessionsByWindow.get(windowId);
  if (!sessions) {
    sessions = new Map();
    ptySessionsByWindow.set(windowId, sessions);
  }
  return sessions;
}

function getWindowSessions(windowId: number): Map<string, PtySession> {
  return ptySessionsByWindow.get(windowId) ?? new Map();
}

function getSession(windowId: number, sessionId: string): PtySession | undefined {
  return getWindowSessions(windowId).get(sessionId);
}

function emitToWindow(windowId: number, channel: string, ...args: unknown[]): void {
  const window =
    typeof BrowserWindow?.fromId === 'function' ? BrowserWindow.fromId(windowId) : undefined;
  if (window && !window.isDestroyed()) window.webContents.send(channel, ...args);
}

function buildDefaultTitle(windowId: number): string {
  return `Terminal ${getWindowSessions(windowId).size + 1}`;
}

function hasTerminalSizeChanged(
  session: PtySession | undefined,
  size: { cols: number; rows: number },
): boolean {
  return !session || session.cols !== size.cols || session.rows !== size.rows;
}

function windowFromEvent(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

export function createPty(
  windowId: number,
  params: CreatePtyParams,
  ptyModule: PtyModule = loadPty(),
): { sessionId: string; created: boolean } {
  const sessionId =
    typeof params.sessionId === 'string' && params.sessionId.trim()
      ? params.sessionId
      : `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspaceId =
    typeof params.workspaceId === 'string' && params.workspaceId.trim()
      ? params.workspaceId.trim()
      : '__unknown_workspace__';
  const sessions = getOrCreateWindowSessions(windowId);
  if (sessions.has(sessionId)) return { sessionId, created: false };

  const cols = Number.isFinite(params.cols) ? Number(params.cols) : 80;
  const rows = Number.isFinite(params.rows) ? Number(params.rows) : 24;
  const shell = resolveShell();
  const cwd = resolveCwd(params.cwd);
  const env = buildTerminalEnv(process.env, params.colorScheme);
  let ptyProcess: PtyLike;
  let resolvedCwd = cwd;
  try {
    ptyProcess = ptyModule.spawn(shell, loginShellArgs(shell), {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
  } catch (firstError) {
    const fallbackCwd = process.platform === 'win32' ? 'C:\\' : os.homedir() || '/';
    const fallbackShell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
    resolvedCwd = fallbackCwd;
    try {
      ptyProcess = ptyModule.spawn(fallbackShell, loginShellArgs(fallbackShell), {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: fallbackCwd,
        env,
      });
      console.warn(
        `[ptyService] spawn failed with shell=${shell} cwd=${cwd}; retry shell=${fallbackShell} cwd=${fallbackCwd}: ${firstError}`,
      );
    } catch (secondError) {
      throw new Error(
        `终端创建失败，请检查系统 Shell 配置。\n首次尝试: shell=${shell} cwd=${cwd} error=${firstError}\n重试尝试: shell=${fallbackShell} cwd=${fallbackCwd} error=${secondError}`,
      );
    }
  }

  const now = new Date().toISOString();
  const session: PtySession = {
    id: sessionId,
    workspaceId,
    title: params.title?.trim() || buildDefaultTitle(windowId),
    ptyProcess,
    cwd: resolvedCwd,
    createdAt: now,
    lastActiveAt: now,
    outputBuffer: '',
    cols,
    rows,
  };
  sessions.set(sessionId, session);
  ptyProcess.onData((data) => {
    const current = sessions.get(sessionId);
    if (!current || current.ptyProcess !== ptyProcess) return;
    current.lastActiveAt = new Date().toISOString();
    current.outputBuffer = (current.outputBuffer + data).slice(-OUTPUT_BUFFER_LIMIT);
    emitToWindow(windowId, 'terminal:data', sessionId, data);
  });
  ptyProcess.onExit(({ exitCode }) => {
    const current = sessions.get(sessionId);
    if (!current || current.ptyProcess !== ptyProcess) return;
    sessions.delete(sessionId);
    if (sessions.size === 0) ptySessionsByWindow.delete(windowId);
    emitToWindow(windowId, 'terminal:exit', sessionId, exitCode);
  });
  return { sessionId, created: true };
}

export function writePty(windowId: number, sessionId: string, data: string): void {
  const session = getSession(windowId, sessionId);
  if (!session) return;
  session.lastActiveAt = new Date().toISOString();
  session.ptyProcess.write(data);
}

export function resizePty(windowId: number, sessionId: string, cols: number, rows: number): void {
  const session = getSession(windowId, sessionId);
  if (!session || !hasTerminalSizeChanged(session, { cols, rows })) return;
  session.cols = cols;
  session.rows = rows;
  session.ptyProcess.resize(cols, rows);
}

export function killPty(windowId: number, sessionId: string): void {
  const sessions = getWindowSessions(windowId);
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) ptySessionsByWindow.delete(windowId);
  session.ptyProcess.kill();
}

export function killWindowPtys(windowId: number): void {
  for (const sessionId of Array.from(getWindowSessions(windowId).keys())) {
    killPty(windowId, sessionId);
  }
}

export function killAllPtys(): void {
  for (const windowId of Array.from(ptySessionsByWindow.keys())) killWindowPtys(windowId);
}

export function hasPty(windowId: number, sessionId: string): boolean {
  return getWindowSessions(windowId).has(sessionId);
}

export function listPtys(windowId: number): Array<{
  id: string;
  workspaceId: string;
  title: string;
  cwd: string;
  createdAt: string;
  lastActiveAt: string;
  alive: boolean;
}> {
  return Array.from(getWindowSessions(windowId).values())
    .map((session) => ({
      id: session.id,
      workspaceId: session.workspaceId,
      title: session.title,
      cwd: session.cwd,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      alive: true,
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function getPtyBuffer(windowId: number, sessionId: string): string {
  return getSession(windowId, sessionId)?.outputBuffer ?? '';
}

export function registerPtyTerminalHandlers(
  ipc: IpcMain,
  options: { assertSource?: (event: IpcMainInvokeEvent) => void } = {},
): void {
  const assertSource = options.assertSource;
  ipc.handle('terminal:create', (event, params: CreatePtyParams) => {
    assertSource?.(event);
    const window = windowFromEvent(event);
    if (!window) return { success: false, error: 'windowUnavailable' };
    try {
      const result = createPty(window.id, params ?? {});
      return { success: true, sessionId: result.sessionId, created: result.created };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[terminal:create] failed:', message);
      return { success: false, error: message };
    }
  });
  ipc.on('terminal:write', (event, sessionId: string, data: string) => {
    const window = windowFromEvent(event);
    if (!window) return;
    writePty(window.id, sessionId, data);
  });
  ipc.on('terminal:resize', (event, sessionId: string, cols: number, rows: number) => {
    const window = windowFromEvent(event);
    if (!window) return;
    resizePty(window.id, sessionId, cols, rows);
  });
  ipc.handle('terminal:kill', (event, sessionId: string) => {
    assertSource?.(event);
    const window = windowFromEvent(event);
    if (!window) return;
    killPty(window.id, sessionId);
  });
  ipc.handle('terminal:exists', (event, sessionId: string) => {
    assertSource?.(event);
    const window = windowFromEvent(event);
    if (!window) return false;
    return hasPty(window.id, sessionId);
  });
  ipc.handle('terminal:list', (event) => {
    assertSource?.(event);
    const window = windowFromEvent(event);
    if (!window) return [];
    return listPtys(window.id);
  });
  ipc.handle('terminal:getBuffer', (event, sessionId: string) => {
    assertSource?.(event);
    const window = windowFromEvent(event);
    if (!window) return '';
    return getPtyBuffer(window.id, sessionId);
  });
}
