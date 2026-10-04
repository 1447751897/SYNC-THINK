import type { IpcMain, IpcMainEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPty, hasPty, killAllPtys, registerPtyTerminalHandlers, resizePty, writePty } from './pty-service.js';

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(), fromWebContents: vi.fn(() => ({ id: 1 })) },
}));

afterEach(() => { killAllPtys(); vi.restoreAllMocks(); });

function createTestPty(size: { cols?: number; rows?: number } = {}) {
  const resize = vi.fn((cols: number, rows: number) => {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0 || cols > 32767 || rows > 32767) {
      throw new Error('resizing must be done using positive cols and rows');
    }
  });
  const write = vi.fn();
  const spawn = vi.fn((_file: string, _args: string[], _options: Record<string, unknown>) => ({ onData: vi.fn(), onExit: vi.fn(), write, resize, kill: vi.fn() }));
  createPty(1, { sessionId: 'resize-test', cols: 80, rows: 24, ...size }, { spawn });
  return { resize, write, spawn };
}

const invalidSizes = [
  [0, 24], [80, 0], [-1, 24], [80, -1], [NaN, 24], [80, NaN],
  [Infinity, 24], [80, Infinity], [1.5, 24], [80, 1.5], [32768, 24], [80, 32768],
];

describe('PTY resize boundaries', () => {
  it.each(invalidSizes)('ignores invalid cols=%s rows=%s without poisoning the last size', (cols, rows) => {
    const { resize } = createTestPty();
    expect(() => resizePty(1, 'resize-test', cols!, rows!)).not.toThrow();
    expect(resize).not.toHaveBeenCalled();
    expect(hasPty(1, 'resize-test')).toBe(true);
    resizePty(1, 'resize-test', 80, 24);
    expect(resize).not.toHaveBeenCalled();
    resizePty(1, 'resize-test', 100, 30);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(100, 30);
  });

  it('deduplicates successful sizes but retries a failed native resize', () => {
    const { resize, write } = createTestPty();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    resize.mockImplementationOnce(() => { throw new Error('PTY exited during resize'); });
    expect(() => resizePty(1, 'resize-test', 100, 30)).not.toThrow();
    expect(warning).toHaveBeenCalled();
    resizePty(1, 'resize-test', 100, 30);
    resizePty(1, 'resize-test', 100, 30);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(hasPty(1, 'resize-test')).toBe(true);
    writePty(1, 'resize-test', 'still alive\r');
    expect(write).toHaveBeenCalledWith('still alive\r');
  });

  it('ignores resizes for a missing or exited terminal', () => {
    expect(() => resizePty(1, 'missing', 100, 30)).not.toThrow();
  });

  it('guards the actual terminal:resize IPC handler', () => {
    const { resize } = createTestPty();
    const listeners = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>();
    const ipc = {
      handle: vi.fn(),
      on: vi.fn((channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void) => { listeners.set(channel, listener); }),
    } as unknown as IpcMain;
    registerPtyTerminalHandlers(ipc);
    const handler = listeners.get('terminal:resize')!;
    const event = { sender: {} } as IpcMainEvent;
    expect(() => handler(event, 'resize-test', 0, 0)).not.toThrow();
    expect(() => handler(event, 'resize-test', NaN, NaN)).not.toThrow();
    expect(resize).not.toHaveBeenCalled();
    handler(event, 'resize-test', 120, 32);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith(120, 32);
  });
});

describe('PTY creation dimensions', () => {
  it.each([0, -1, NaN, Infinity, 1.5, 32768])('uses safe defaults for invalid initial dimension %s', value => {
    const { spawn } = createTestPty({ cols: value, rows: value });
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ cols: 80, rows: 24 });
  });

  it('preserves an independently valid initial dimension', () => {
    const { spawn } = createTestPty({ cols: 120, rows: 0 });
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ cols: 120, rows: 24 });
  });
});
