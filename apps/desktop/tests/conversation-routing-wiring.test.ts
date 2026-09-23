import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/conversation-routing-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('conversation routing IPC wiring', () => {
  it('registers mode and target commands through the typed conversation boundary', () => {
    for (const [channel, command] of [
      ['runtime:conversation-set-execution-mode', 'conversation.setExecutionMode'],
      ['runtime:conversation-set-interaction-mode', 'conversation.setInteractionMode'],
      ['runtime:conversation-set-context-window-override', 'conversation.setContextWindowOverride'],
      ['runtime:conversation-upgrade-track', 'conversation.upgradeTrack'],
      ['runtime:conversation-rebind-target', 'conversation.rebindTarget'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerConversationRoutingHandlers({');
    expect(mainSource).toContain('requestConversation:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:conversation-set-execution-mode',
      'runtime:conversation-set-interaction-mode',
      'runtime:conversation-set-context-window-override',
      'runtime:conversation-upgrade-track',
      'runtime:conversation-rebind-target',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('setConversationExecutionMode(');
    expect(globalSource).toContain('setConversationInteractionMode(');
    expect(globalSource).toContain('setConversationContextWindowOverride(');
    expect(globalSource).toContain('upgradeConversationTrack(');
    expect(globalSource).toContain('rebindConversationTarget(');
  });
});
