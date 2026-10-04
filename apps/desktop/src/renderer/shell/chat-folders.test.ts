/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { chatFoldersKey, readChatFolders, removeChatFolder, writeChatFolders } from './chat-folders.js';
beforeEach(() => localStorage.clear());
describe('workspace-scoped chat folders', () => {
  it('persists names, collapsed state and membership independently of other workspaces', () => {
    const state = { folders: [{ id: 'novels', name: '小说组', collapsed: true }], assignments: { bookA: 'novels', bookB: 'novels' } };
    expect(writeChatFolders('ws1', state)).toBe(true);
    expect(readChatFolders('ws1')).toEqual(state);
    expect(readChatFolders('ws2')).toEqual({ folders: [], assignments: {} });
  });
  it('deleting a folder removes only assignments, never mutates the source state or another folder', () => {
    const state = { folders: [{ id: 'novels', name: '小说组', collapsed: false }, { id: 'videos', name: '视频组', collapsed: false }], assignments: { bookA: 'novels', bookB: 'novels', video: 'videos' } };
    expect(removeChatFolder(state, 'novels')).toEqual({ folders: [state.folders[1]], assignments: { video: 'videos' } });
    expect(state.assignments.bookA).toBe('novels');
  });
  it('recovers corrupt data and dangling assignments without losing accessible chats', () => {
    localStorage.setItem(chatFoldersKey('ws1'), '{');
    expect(readChatFolders('ws1').folders).toEqual([]);
    localStorage.setItem(chatFoldersKey('ws1'), JSON.stringify({ folders: [null, { id: 'ok', name: '小说组' }, { id: 'ok', name: 'duplicate' }, { id: 'bad', name: ' ' }], assignments: { book: 'ok', lost: 'deleted' } }));
    expect(readChatFolders('ws1')).toEqual({ folders: [{ id: 'ok', name: '小说组', collapsed: false }], assignments: { book: 'ok' } });
  });
});
