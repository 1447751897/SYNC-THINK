import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { EDIT_COMMANDS, type EditCommand } from '../context-menu-contract.js';

/** Only the trusted shell may operate its own focused editor or clipboard. */
export function registerContextMenuHandlers(deps: {
  ipcMain: Pick<IpcMain, 'handle'>;
  assertSource(event: IpcMainInvokeEvent): void;
  clipboard: { readText(): string; writeText(text: string): void };
}) {
  deps.ipcMain.handle('desktop:editing-command', (event, command: unknown) => {
    deps.assertSource(event);
    if (typeof command !== 'string' || !EDIT_COMMANDS.includes(command as EditCommand))
      throw new Error('desktop.invalid-edit-command');
    event.sender[command as EditCommand]();
  });
  deps.ipcMain.handle('desktop:clipboard-read-text', event => {
    deps.assertSource(event);
    return deps.clipboard.readText();
  });
  deps.ipcMain.handle('desktop:clipboard-write-text', (event, text: unknown) => {
    deps.assertSource(event);
    if (typeof text !== 'string') throw new Error('desktop.invalid-clipboard-text');
    deps.clipboard.writeText(text);
  });
}
