/** Sidebar organization only: folders never alter room membership or execution. */
export interface ChatFolder { id: string; name: string; collapsed: boolean }
export interface ChatFolders { folders: ChatFolder[]; assignments: Record<string, string> }
export const chatFoldersKey = (scope: string) => `sync-think.agent-workspace.chat-folders.v1:${scope}`;
export const emptyChatFolders = (): ChatFolders => ({ folders: [], assignments: {} });
export function readChatFolders(scope: string): ChatFolders {
  try {
    const value = JSON.parse(localStorage.getItem(chatFoldersKey(scope)) ?? 'null');
    if (!value || !Array.isArray(value.folders)) return emptyChatFolders();
    const ids = new Set<string>();
    const folders: ChatFolder[] = value.folders.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const folder = item as Partial<ChatFolder>;
      if (typeof folder.id !== 'string' || !folder.id || ids.has(folder.id) || typeof folder.name !== 'string' || !folder.name.trim()) return [];
      ids.add(folder.id);
      return [{ id: folder.id, name: folder.name.trim(), collapsed: folder.collapsed === true }];
    });
    const assignments: Record<string, string> = {};
    for (const [chat, id] of Object.entries(value.assignments && typeof value.assignments === 'object' ? value.assignments : {})) {
      if (chat && typeof id === 'string' && ids.has(id)) Object.defineProperty(assignments, chat, { value: id, enumerable: true, configurable: true, writable: true });
    }
    return { folders, assignments };
  } catch { return emptyChatFolders(); }
}
export function writeChatFolders(scope: string, state: ChatFolders): boolean {
  try { localStorage.setItem(chatFoldersKey(scope), JSON.stringify(state)); return true; }
  catch { return false; }
}
export function removeChatFolder(state: ChatFolders, id: string): ChatFolders {
  return { folders: state.folders.filter(folder => folder.id !== id), assignments: Object.fromEntries(Object.entries(state.assignments).filter(([, folder]) => folder !== id)) };
}
