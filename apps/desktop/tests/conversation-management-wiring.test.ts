import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/conversation-management-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('conversation management IPC wiring', () => {
  it('registers catalog lifecycle commands through the typed conversation boundary', () => {
    for (const [channel, command] of [
      ['runtime:conversation-list', 'conversation.list'],
      ['runtime:conversation-create', 'conversation.create'],
      ['runtime:conversation-rename', 'conversation.rename'],
      ['runtime:conversation-set-pinned', 'conversation.setPinned'],
      ['runtime:conversation-set-archived', 'conversation.setArchived'],
      ['runtime:conversation-delete', 'conversation.delete'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerConversationManagementHandlers({');
    expect(mainSource).toContain('requestConversation:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:conversation-list',
      'runtime:conversation-create',
      'runtime:conversation-rename',
      'runtime:conversation-set-pinned',
      'runtime:conversation-set-archived',
      'runtime:conversation-delete',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('listConversations(');
    expect(globalSource).toContain('createConversation(');
    expect(globalSource).toContain('renameConversation(');
    expect(globalSource).toContain('setConversationPinned(');
    expect(globalSource).toContain('setConversationArchived(');
    expect(globalSource).toContain('deleteConversation(');
  });
});
