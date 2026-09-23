import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/global-agent-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Global Agent IPC wiring', () => {
  it('registers all mutable Global Agent commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:global-agent-list', 'globalAgent.list'],
      ['runtime:global-agent-create', 'globalAgent.create'],
      ['runtime:global-agent-update', 'globalAgent.update'],
      ['runtime:global-agent-delete', 'globalAgent.delete'],
      ['runtime:global-agent-list-workspace-activations', 'globalAgent.listWorkspaceActivations'],
      ['runtime:global-agent-set-workspace-activation', 'globalAgent.setWorkspaceActivation'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerGlobalAgentHandlers({');
    expect(mainSource).toContain('requestGlobalAgent:');
  });

  it('keeps Renderer bridges typed, including soft-archive deletion details', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:global-agent-list', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:global-agent-create', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:global-agent-update', payload)");
    expect(preloadSource).toContain("'runtime:global-agent-delete'");
    expect(preloadSource).toContain('as Promise<DeleteGlobalAgentResponse>');
    expect(preloadSource).toContain("'runtime:global-agent-list-workspace-activations'");
    expect(preloadSource).toContain("'runtime:global-agent-set-workspace-activation'");
    expect(globalSource).toContain(
      "Promise<import('@sync-think/protocol').DeleteGlobalAgentResponse>",
    );
  });
});
