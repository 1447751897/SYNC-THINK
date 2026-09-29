import { describe, expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { registerContextMenuHandlers } from './context-menu-handlers.js';
import { EDIT_COMMANDS } from '../context-menu-contract.js';

function fixture(trusted = true) {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>();
  const sender = Object.fromEntries(EDIT_COMMANDS.map(command => [command, vi.fn()]));
  const clipboard = { readText: vi.fn(() => 'fixture'), writeText: vi.fn() };
  const assertSource = vi.fn(() => { if (!trusted) throw new Error('untrusted'); });
  registerContextMenuHandlers({ ipcMain: { handle: (channel: string, fn: (event: IpcMainInvokeEvent, payload?: unknown) => unknown) => handlers.set(channel, fn) } as unknown as IpcMain, assertSource, clipboard });
  return { handlers, sender, clipboard, assertSource, event: { sender } as unknown as IpcMainInvokeEvent };
}
describe('context-menu editing IPC', () => {
  it.each(EDIT_COMMANDS)('executes %s only on the authenticated sender', command => {
    const f = fixture(); f.handlers.get('desktop:editing-command')!(f.event, command);
    expect(f.assertSource).toHaveBeenCalledWith(f.event); expect(f.sender[command]).toHaveBeenCalledOnce();
  });
  it.each(['executeJavaScript', '__proto__', 'constructor', 'loadURL', {}, null])('rejects non-editing commands: %s', command => {
    const f = fixture(); expect(() => f.handlers.get('desktop:editing-command')!(f.event, command)).toThrow('invalid-edit-command');
    for (const fn of Object.values(f.sender)) expect(fn).not.toHaveBeenCalled();
  });
  it('rejects untrusted frames before reading or mutating the clipboard', () => {
    const f = fixture(false);
    for (const [channel, payload] of [['desktop:editing-command', 'paste'], ['desktop:clipboard-read-text', undefined], ['desktop:clipboard-write-text', 'fixture']]) {
      expect(() => f.handlers.get(channel as string)!(f.event, payload)).toThrow('untrusted');
    }
    expect(f.clipboard.readText).not.toHaveBeenCalled(); expect(f.clipboard.writeText).not.toHaveBeenCalled(); expect(f.sender.paste).not.toHaveBeenCalled();
  });
  it('keeps copied text byte-for-byte and validates its type', () => {
    const f = fixture(); const text = '中文\nconst count = 5;';
    f.handlers.get('desktop:clipboard-write-text')!(f.event, text);
    expect(f.clipboard.writeText).toHaveBeenCalledWith(text);
    expect(f.handlers.get('desktop:clipboard-read-text')!(f.event)).toBe('fixture');
    expect(() => f.handlers.get('desktop:clipboard-write-text')!(f.event, {})).toThrow('invalid-clipboard-text');
  });
});
