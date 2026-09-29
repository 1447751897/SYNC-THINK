export const EDIT_COMMANDS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const;
export type EditCommand = typeof EDIT_COMMANDS[number];
export interface DesktopEditingBridge {
  execute(command: EditCommand): Promise<void>;
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
}
