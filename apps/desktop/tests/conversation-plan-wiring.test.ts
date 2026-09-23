import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/conversation-plan-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('conversation Plan IPC wiring', () => {
  it('registers the Plan lifecycle through the typed conversation boundary', () => {
    for (const [channel, command] of [
      ['runtime:conversation-plan-submit', 'conversation.plan.submit'],
      ['runtime:conversation-plan-get', 'conversation.plan.get'],
      ['runtime:conversation-plan-approve', 'conversation.plan.approve'],
      ['runtime:conversation-plan-revise', 'conversation.plan.revise'],
      ['runtime:conversation-plan-cancel', 'conversation.plan.cancel'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerConversationPlanHandlers({');
    expect(mainSource).toContain('requestConversation:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:conversation-plan-submit',
      'runtime:conversation-plan-get',
      'runtime:conversation-plan-approve',
      'runtime:conversation-plan-revise',
      'runtime:conversation-plan-cancel',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('conversationPlanSubmit(');
    expect(globalSource).toContain('conversationPlanGet(');
    expect(globalSource).toContain('conversationPlanApprove(');
    expect(globalSource).toContain('conversationPlanRevise(');
    expect(globalSource).toContain('conversationPlanCancel(');
  });
});
