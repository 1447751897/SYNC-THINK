import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/conversation-ask-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('conversation Ask IPC wiring', () => {
  it('registers the Ask lifecycle through the typed conversation boundary', () => {
    for (const [channel, command] of [
      ['runtime:conversation-ask-answer', 'conversation.ask.answer'],
      ['runtime:conversation-ask-cancel', 'conversation.ask.cancel'],
      ['runtime:conversation-ask-pending', 'conversation.ask.pending'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerConversationAskHandlers({');
    expect(mainSource).toContain('requestConversation:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:conversation-ask-answer',
      'runtime:conversation-ask-cancel',
      'runtime:conversation-ask-pending',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('conversationAskAnswer(');
    expect(globalSource).toContain('conversationAskCancel(');
    expect(globalSource).toContain('conversationAskPending(');
  });
});
